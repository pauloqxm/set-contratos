/* Login pelo SET SSO. Sem backend: Authorization Code + PKCE feito pelo navegador. */
const SSO = (() => {
  const base = `${location.origin}/`;
  const sso = CONFIG.ssoAuthority;
  const manager = window.oidc && CONFIG.ssoClientId
    ? new oidc.UserManager({
        authority: sso,
        // O SSO não libera CORS na descoberta (.well-known); só o /connect/token precisa dele.
        metadata: {
          issuer: `${sso}/`,
          authorization_endpoint: `${sso}/connect/authorize`,
          token_endpoint: `${sso}/connect/token`,
          end_session_endpoint: `${sso}/connect/logout`,
          userinfo_endpoint: `${sso}/connect/userinfo`,
          jwks_uri: `${sso}/.well-known/jwks`,
        },
        client_id: CONFIG.ssoClientId,
        redirect_uri: base,
        post_logout_redirect_uri: base,
        response_type: "code",
        scope: "openid profile email",
        loadUserInfo: true,
        userStore: new oidc.WebStorageStateStore({ store: window.sessionStorage }),
      })
    : null;
  let current = null;
  let pending = null;
  let forceLogin = false;
  const idleMs = 30 * 60 * 1000;
  const idleKey = "set-sso-atividade";
  let idleTimer = 0;
  let idleOn = false;
  let lastMark = 0;

  function gate(message, canRetry) {
    document.body.classList.remove("is-authed");
    document.getElementById("auth-message").textContent = message;
    document.getElementById("auth-retry").hidden = !canRetry;
  }

  /** Nome para tela e para a lista da ata. */
  function displayName(user = current) {
    const profile = user?.profile || {};
    return (
      profile.name ||
      [profile.given_name, profile.family_name].filter(Boolean).join(" ").trim() ||
      profile.preferred_username ||
      profile.email ||
      ""
    );
  }

  async function enrich(user) {
    if (!user) return null;
    if (displayName(user)) return user;
    if (!user.access_token) return user;
    try {
      const response = await fetch(`${sso}/connect/userinfo`, {
        headers: { Authorization: `Bearer ${user.access_token}` },
      });
      if (!response.ok) return user;
      const info = await response.json();
      user.profile = { ...(user.profile || {}), ...info };
      await manager.storeUser(user);
    } catch (error) {
      /* sem userinfo, segue só com o que veio no token */
    }
    return user;
  }

  function admit() {
    document.getElementById("sso-user").textContent = displayName();
    document.body.classList.add("is-authed");
    watchIdle();
  }

  function idleAge() {
    const last = Number(sessionStorage.getItem(idleKey) || 0);
    return last ? Date.now() - last : 0;
  }

  function armIdle() {
    clearTimeout(idleTimer);
    const wait = Math.max(0, idleMs - idleAge());
    idleTimer = setTimeout(idleOut, wait);
  }

  function touchActivity() {
    if (!idleOn) return;
    const now = Date.now();
    if (now - lastMark < 5000) return;
    lastMark = now;
    sessionStorage.setItem(idleKey, String(now));
    armIdle();
  }

  function stampActivity() {
    const now = Date.now();
    lastMark = now;
    sessionStorage.setItem(idleKey, String(now));
  }

  async function idleOut() {
    if (!idleOn && idleAge() < idleMs) return;
    const age = idleAge();
    if (age && age < idleMs - 1000) {
      armIdle();
      return;
    }
    idleOn = false;
    clearTimeout(idleTimer);
    if (!document.getElementById("view-ata").hidden) sessionStorage.setItem("set-ata-voltar", "1");
    current = null;
    forceLogin = true;
    try {
      await manager.removeUser();
    } catch (error) {
      /* a sessão local some mesmo se o SSO não responder */
    }
    gate("A sessão encerrou após 30 minutos sem atividade no teclado ou no mouse.", true);
  }

  function watchIdle() {
    if (idleAge() >= idleMs && sessionStorage.getItem(idleKey)) {
      idleOn = true;
      idleOut();
      return;
    }
    if (!sessionStorage.getItem(idleKey)) stampActivity();
    lastMark = Number(sessionStorage.getItem(idleKey) || Date.now());
    idleOn = true;
    armIdle();
  }

  function refused() {
    gate(
      `O SSO recusou este endereço (${location.origin}). Peça ao administrador do SSO para marcar a aplicação ${CONFIG.ssoClientId} como pública e cadastrar ${base} nas URLs de retorno.`,
      true,
    );
  }

  async function login() {
    const args = { state: { hash: location.hash } };
    if (forceLogin) args.prompt = "login";
    forceLogin = false;
    try {
      await manager.signinRedirect(args);
    } catch (error) {
      refused();
    }
    return null;
  }

  async function run() {
    if (!manager) {
      gate("O login do SSO não carregou. Confira a conexão e recarregue a página.", false);
      return null;
    }
    const url = new URL(location.href);
    if (url.searchParams.has("code") || url.searchParams.has("error")) {
      try {
        current = await enrich(await manager.signinRedirectCallback());
        stampActivity();
        history.replaceState(null, "", url.pathname + ((current.state && current.state.hash) || ""));
      } catch (error) {
        history.replaceState(null, "", url.pathname);
        if (error && error.error === "access_denied") {
          gate("Sua conta não tem acesso a este painel. Fale com o administrador do SSO.", false);
        } else if (error instanceof TypeError || /fetch|network/i.test(String(error && error.message))) {
          refused();
        } else {
          gate("Não foi possível concluir o login. Tente de novo.", true);
        }
        return null;
      }
    } else {
      current = await enrich(await manager.getUser());
      if (!current || current.expired) return login();
      if (sessionStorage.getItem(idleKey) && idleAge() >= idleMs) {
        await manager.removeUser();
        current = null;
        forceLogin = true;
        gate("A sessão encerrou após 30 minutos sem atividade no teclado ou no mouse.", true);
        return null;
      }
    }
    admit();
    return current;
  }

  /** Garante login. Devolve o usuário, ou null se foi para o SSO ou não tem acesso. */
  function exigirLogin() {
    if (!pending) pending = run();
    return pending;
  }

  function user() {
    return current;
  }

  async function sair() {
    idleOn = false;
    clearTimeout(idleTimer);
    sessionStorage.removeItem(idleKey);
    try {
      await manager.signoutRedirect();
    } catch (error) {
      await manager.removeUser();
      location.reload();
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("auth-retry").addEventListener("click", login);
    document.getElementById("btn-logout").addEventListener("click", sair);
    ["keydown", "pointerdown", "mousemove", "wheel", "touchstart"].forEach((type) => {
      document.addEventListener(type, touchActivity, { passive: true });
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || !idleOn) return;
      if (idleAge() >= idleMs) idleOut();
      else armIdle();
    });
  });

  return { exigirLogin, login, sair, user, displayName };
})();
