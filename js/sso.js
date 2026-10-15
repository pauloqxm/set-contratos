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
        userStore: new oidc.WebStorageStateStore({ store: window.sessionStorage }),
      })
    : null;
  let current = null;
  let pending = null;

  function gate(message, canRetry) {
    document.body.classList.remove("is-authed");
    document.getElementById("auth-message").textContent = message;
    document.getElementById("auth-retry").hidden = !canRetry;
  }

  function admit() {
    const name = current.profile?.name || current.profile?.email || "";
    document.getElementById("sso-user").textContent = name;
    document.body.classList.add("is-authed");
  }

  function refused() {
    gate(
      `O SSO recusou este endereço (${location.origin}). Peça ao administrador do SSO para marcar a aplicação ${CONFIG.ssoClientId} como pública e cadastrar ${base} nas URLs de retorno.`,
      true,
    );
  }

  async function login() {
    try {
      await manager.signinRedirect({ state: { hash: location.hash } });
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
        current = await manager.signinRedirectCallback();
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
      current = await manager.getUser();
      if (!current || current.expired) return login();
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
  });

  return { exigirLogin, login, sair, user };
})();
