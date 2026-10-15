# Site estático → SET SSO (só "quem entra")

Para aplicações **sem backend** (HTML + JavaScript servidos como arquivos, como o Catálogo de
Processos) que só precisam garantir que **quem usa está autorizado**. Não há papéis nem tabela de
usuários na aplicação: quem libera e remove o acesso é o administrador do SSO, em `/admin`.

Para aplicações com backend e gestão própria de usuários, use [integracao.md](integracao.md).

## 1. Cadastro no SSO (administrador)

`/admin` → **Aplicações** → **Nova aplicação**:

| Campo | Exemplo (Catálogo de Processos) |
|---|---|
| client_id | `set_processos` |
| Nome | Catálogo de Processos |
| URLs de retorno | `https://set-processos.up.railway.app/` |
| URL pós-logout | `https://set-processos.up.railway.app/` |
| Aplicação pública | **marcada** (site sem backend: não há segredo) |
| Quem gerencia os usuários | **O SSO** |
| URL de entrada (portal) | `https://set-processos.up.railway.app/` |

A URL de retorno é a **raiz do site**, exatamente como cadastrada (com a barra final). Ao cadastrar a
aplicação como pública, o SSO já libera o CORS para `https://set-processos.up.railway.app`, e só
para ela.

Depois, na tela da aplicação, **Copiar acessos de outra aplicação** (por exemplo, todos os usuários
do SET Projetos) ou **Liberar acesso** por e-mail.

## 2. Código no site

Carregue a biblioteca [oidc-client-ts](https://github.com/authts/oidc-client-ts) **antes** dos
scripts do site:

```html
<script src="https://cdn.jsdelivr.net/npm/oidc-client-ts@3.1.0/dist/browser/oidc-client-ts.min.js"></script>
<script src="js/sso.js"></script>
```

`js/sso.js`:

```javascript
/* Login pelo SET SSO. Sem backend: Authorization Code + PKCE feito pelo navegador. */
window.SSO = (function () {
  const BASE = location.origin + "/";            // = URL de retorno cadastrada no SSO
  const sso = new oidc.UserManager({
    authority: "https://sso.idt.org.br",
    client_id: "set_processos",
    redirect_uri: BASE,
    post_logout_redirect_uri: BASE,
    response_type: "code",
    scope: "openid profile email",
    userStore: new oidc.WebStorageStateStore({ store: window.sessionStorage }),
  });

  /** Garante login. Devolve o usuário ({ profile: { name, email, sub } }) ou null se redirecionou. */
  async function exigirLogin() {
    const url = new URL(location.href);

    // Voltando do SSO (?code=... ou ?error=...)
    if (url.searchParams.has("code") || url.searchParams.has("error")) {
      try {
        const user = await sso.signinRedirectCallback();
        // Volta para a tela (#/...) em que a pessoa estava antes do login
        history.replaceState(null, "", url.pathname + (user.state || ""));
        return user;
      } catch (e) {
        history.replaceState(null, "", url.pathname);
        if (e && e.error === "access_denied") return semAcesso();
        throw e;
      }
    }

    const user = await sso.getUser();
    if (user) return user;                       // já logado nesta aba

    await sso.signinRedirect({ state: location.hash });   // vai para o SSO
    return null;
  }

  function semAcesso() {
    document.body.innerHTML =
      '<main style="max-width:520px;margin:15vh auto;font-family:sans-serif;text-align:center">' +
      "<h1>Sem acesso</h1><p>Sua conta não tem acesso a este sistema. " +
      "Fale com o administrador.</p><p><a href=\"https://sso.idt.org.br/conta\">Meus sistemas</a></p></main>";
    return null;
  }

  function sair() {
    return sso.signoutRedirect();               // sai do site e do SSO
  }

  return { exigirLogin, sair };
})();
```

No início do script principal (por exemplo, `js/app.js`), **antes** de carregar dados ou montar a
tela:

```javascript
(async function () {
  const usuario = await SSO.exigirLogin();
  if (!usuario) return;                          // foi para o SSO ou não tem acesso
  // usuario.profile.name, usuario.profile.email
  iniciarApp();                                  // o que o site já fazia ao carregar
})();
```

E um botão **Sair** que chama `SSO.sair()`.

## 3. Como funciona

1. A pessoa abre o site (ou clica no cartão em "Meus sistemas").
2. Sem login na aba → vai para `sso.idt.org.br`. Se já entrou em qualquer sistema nas últimas 12 h,
   volta na hora, sem digitar senha.
3. O SSO só devolve quem tem acesso liberado. Quem não tem volta com `access_denied` e vê
   "Sem acesso".
4. A sessão fica na aba (`sessionStorage`): fechar a aba encerra; outra aba entra direto pelo SSO.

O login é conferido **ao abrir o site**. Como o site não chama nenhuma API protegida, não é preciso
renovar token durante o uso.

## 4. Limite

O login controla **quem usa o site**. Os arquivos e dados que o site carrega (por exemplo, o CSV
publicado do Google Sheets citado no `config.js`) continuam acessíveis a quem tiver o endereço
deles. Se o conteúdo passar a ser sensível, é preciso um backend que entregue os dados só para
quem está logado.

## 5. Teste

1. Rodar o site localmente? Cadastre também a URL de retorno local (ex.: `http://localhost:5500/`)
   na aplicação, no `/admin`.
2. Com uma conta **com** acesso: abrir o site → entra (ou passa pelo login do SSO) → telas normais.
3. Com uma conta **sem** acesso: "Sem acesso".
4. **Sair** → volta ao site → pede login de novo.

| Sintoma | Causa provável |
|---|---|
| Página do SSO "pedido de login inválido", detalhe `redirect_uri` | URL de retorno diferente da cadastrada (barra final, http × https) |
| Erro de CORS no console ao voltar do SSO | A aplicação não está como **pública** no SSO, está desativada, ou a origem do site não bate com a URL de retorno; o SSO atualiza a lista de origens em até 5 min |
| Volta sempre para o SSO, em loop | O `exigirLogin()` roda antes de o `?code=` ser tratado, ou o `sessionStorage` está bloqueado |
| "Sem acesso" para quem deveria ter | Acesso não liberado em `/admin` → Aplicações → a aplicação → Quem tem acesso |
