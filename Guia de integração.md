# SET Projetos → SET SSO: guia de integração

Oct 13, 2026 · @Someone

O SET Projetos passa a confiar o login ao SSO (`https://sso.idt.org.br`); papéis, permissões e a sessão `ct_session` continuam exatamente como estão.

## O que muda

Só a conferência de senha sai do SET Projetos: o SSO diz **quem** a pessoa é (`sub`, nome, e-mail), o SET Projetos continua decidindo **o que** ela pode fazer.

| Continua igual | Muda |
| --- | --- |
| Tabela `usuarios`, papéis (`admin`, `editor`, `consulta`, `reservas`) e `usuario_projetos` | A senha deixa de ser conferida no SET Projetos |
| Sessão `ct_session` (cookie, tabela `sessoes`, 7 dias) | "Entrar" redireciona para `https://sso.idt.org.br` e volta em `/signin-oidc` |
| `_require_user`, `_require_admin`, `_require_projeto_role` | A tela de usuários **convida** a pessoa pelo SSO (e-mail) em vez de criar senha |

O guia geral do SSO, válido para qualquer aplicação, está no repositório do SSO em `docs/integracao.md`.

## Dados da aplicação e variáveis

A aplicação já está cadastrada no SSO como **confidencial** (`set_projetos`); o `client_secret` é entregue à parte, por canal seguro, e nunca vai para o repositório.

| Item | Valor |
| --- | --- |
| SSO (issuer) | `https://sso.idt.org.br` |
| Descoberta | `https://sso.idt.org.br/.well-known/openid-configuration` |
| `client_id` | `set_projetos` |
| URL de retorno cadastrada | `https://set-projetos.up.railway.app/signin-oidc` (e `http://localhost:8765/signin-oidc` para teste local) |
| URL pós-logout cadastrada | `https://set-projetos.up.railway.app/` |
| Escopos | login: `openid profile email` · gestão de usuários: `sso_inscricoes` |

A URL de retorno precisa ser **idêntica** à cadastrada: `https`, mesmo host, mesmo caminho, sem barra no final. Se a rota mudar, peça para atualizar o cadastro no SSO (o segredo não muda).

Variáveis no Railway:

```
SSO_URL=https://sso.idt.org.br
SSO_CLIENT_ID=set_projetos
SSO_CLIENT_SECRET=<segredo>
SSO_REDIRECT_URI=https://set-projetos.up.railway.app/signin-oidc
SSO_LOGIN_LOCAL=1          # 1 = mantém o login antigo na transição; 0 = só SSO
```

`SSO_REDIRECT_URI` é fixo de propósito: atrás do proxy do Railway o servidor recebe `http`, e montar a URL pela requisição geraria `http://...`, que o SSO recusa. Para teste local: `SSO_REDIRECT_URI=http://localhost:8765/signin-oidc`.

## Banco e dependência

Duas colunas novas em `usuarios`; `sso_sub` é a ligação com o SSO e o usuário é sempre identificado por ela, nunca pelo e-mail (o e-mail pode mudar no SSO, o `sub` não).

```sql
ALTER TABLE usuarios ADD COLUMN email   TEXT NOT NULL DEFAULT '';
ALTER TABLE usuarios ADD COLUMN sso_sub TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_sso_sub ON usuarios(sso_sub) WHERE sso_sub IS NOT NULL;
```

- Siga o padrão de migração que o `db.py` já usa (`_has_col(...)` + `ALTER TABLE` dentro de `init_db`), para valer no SQLite local e no Postgres do Supabase.
- Usuários criados pelo SSO não têm senha local: grave em `senha_hash` um valor que nunca confere (por exemplo `"!sso"`), já que a coluna é `NOT NULL`.

No `requirements.txt`, para validar a assinatura do `id_token` (o `httpx` já está lá):

```
pyjwt[crypto]>=2.8,<3
```

## Módulo sso.py

Um arquivo único, ao lado do `server.py`, concentra todo o diálogo com o SSO: login (Authorization Code + PKCE), validação do `id_token` e a API de inscrições.

```python
"""Integração com o SET SSO (OpenID Connect: Authorization Code + PKCE)."""

from __future__ import annotations

import base64
import hashlib
import os
import secrets
import time
from urllib.parse import urlencode

import httpx
import jwt  # pyjwt[crypto]

SSO_URL = os.environ.get("SSO_URL", "https://sso.idt.org.br").rstrip("/")
CLIENT_ID = os.environ.get("SSO_CLIENT_ID", "set_projetos")
CLIENT_SECRET = os.environ.get("SSO_CLIENT_SECRET", "")
REDIRECT_URI = os.environ.get("SSO_REDIRECT_URI", "")
ISSUER = SSO_URL + "/"
COOKIE_FLUXO = "ct_sso_fluxo"   # guarda state/nonce/verifier entre a ida e a volta do SSO

_jwks = jwt.PyJWKClient(f"{SSO_URL}/.well-known/jwks", cache_keys=True)
_token_app: dict = {"valor": None, "expira": 0.0}


def ativo() -> bool:
    return bool(CLIENT_SECRET and REDIRECT_URI)


def _b64url(dados: bytes) -> str:
    return base64.urlsafe_b64encode(dados).rstrip(b"=").decode()


# ---------- Login ----------

def iniciar_login() -> tuple[str, str]:
    """Devolve (url para redirecionar, valor do cookie do fluxo)."""
    state = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(48)
    challenge = _b64url(hashlib.sha256(verifier.encode()).digest())
    url = f"{SSO_URL}/connect/authorize?" + urlencode({
        "client_id": CLIENT_ID,
        "response_type": "code",
        "scope": "openid profile email",
        "redirect_uri": REDIRECT_URI,
        "state": state,
        "nonce": nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    })
    return url, f"{state}.{nonce}.{verifier}"


def concluir_login(query: dict[str, str], cookie_fluxo: str | None) -> dict:
    """Valida o retorno do SSO. Devolve {"sub", "email", "nome"} ou levanta ErroSso."""
    if query.get("error"):
        # access_denied = a pessoa entrou no SSO, mas não está inscrita no SET Projetos
        raise ErroSso(query.get("error", ""), query.get("error_description", ""))
    try:
        state, nonce, verifier = (cookie_fluxo or "").split(".")
    except ValueError:
        raise ErroSso("fluxo_expirado", "Login expirou. Tente de novo.")
    if not secrets.compare_digest(query.get("state", ""), state):
        raise ErroSso("state_invalido", "Login inválido. Tente de novo.")

    resp = httpx.post(
        f"{SSO_URL}/connect/token",
        auth=(CLIENT_ID, CLIENT_SECRET),
        data={
            "grant_type": "authorization_code",
            "code": query.get("code", ""),
            "redirect_uri": REDIRECT_URI,
            "code_verifier": verifier,
        },
        timeout=15,
    )
    if resp.status_code != 200:
        raise ErroSso("token", resp.text[:300])

    id_token = resp.json()["id_token"]
    chave = _jwks.get_signing_key_from_jwt(id_token).key
    claims = jwt.decode(id_token, chave, algorithms=["RS256"], audience=CLIENT_ID, issuer=ISSUER)
    if not secrets.compare_digest(claims.get("nonce", ""), nonce):
        raise ErroSso("nonce_invalido", "Login inválido. Tente de novo.")
    return {"sub": claims["sub"], "email": claims.get("email", ""), "nome": claims.get("name", "")}


def url_logout(id_token_hint: str | None = None) -> str:
    params = {"client_id": CLIENT_ID, "post_logout_redirect_uri": REDIRECT_URI.rsplit("/", 1)[0] + "/"}
    if id_token_hint:
        params["id_token_hint"] = id_token_hint
    return f"{SSO_URL}/connect/logout?" + urlencode(params)


# ---------- Gestão de usuários (API de inscrições) ----------

def _token_aplicacao() -> str:
    if _token_app["valor"] and time.time() < _token_app["expira"] - 60:
        return _token_app["valor"]
    resp = httpx.post(
        f"{SSO_URL}/connect/token",
        auth=(CLIENT_ID, CLIENT_SECRET),
        data={"grant_type": "client_credentials", "scope": "sso_inscricoes"},
        timeout=15,
    )
    resp.raise_for_status()
    dados = resp.json()
    _token_app.update(valor=dados["access_token"], expira=time.time() + dados.get("expires_in", 900))
    return _token_app["valor"]


def _api(metodo: str, caminho: str, **kwargs) -> httpx.Response:
    return httpx.request(
        metodo, f"{SSO_URL}/api/inscricoes{caminho}",
        headers={"Authorization": f"Bearer {_token_aplicacao()}"}, timeout=20, **kwargs,
    )


def inscrever(email: str, nome: str) -> dict:
    """Convida (ou só libera, se já tiver conta) e devolve a inscrição, com "sub".
    "emailEnviado": false = inscrição feita, mas o e-mail falhou (use reenviar_convite)."""
    resp = _api("POST", "", json={"email": email, "nome": nome})
    if resp.status_code not in (200, 201):
        raise ErroSso("inscricao", resp.text[:300])
    return resp.json()


def remover(sub: str) -> None:
    """Tira o acesso ao SET Projetos (não afeta outras aplicações)."""
    resp = _api("DELETE", f"/{sub}")
    if resp.status_code not in (204, 404):
        raise ErroSso("remocao", resp.text[:300])


def reenviar_convite(sub: str) -> None:
    _api("POST", f"/{sub}/reenviar-convite")


def situacao(sub: str) -> dict | None:
    resp = _api("GET", f"/{sub}")
    return resp.json() if resp.status_code == 200 else None


class ErroSso(Exception):
    def __init__(self, codigo: str, detalhe: str = ""):
        super().__init__(f"{codigo}: {detalhe}")
        self.codigo = codigo
        self.detalhe = detalhe
```

O cookie `ct_sso_fluxo` vive 10 minutos e só serve para ligar a ida ao SSO com a volta; o `state` e o `nonce` impedem que um retorno forjado seja aceito.

## Mudanças no server.py e no db.py

Duas rotas novas fazem o login: `/login/sso` manda a pessoa ao SSO e `/signin-oidc` recebe a volta e cria a **mesma** sessão `ct_session` de hoje.

**1. Caminhos públicos**

```python
PUBLIC_PATHS = {
    "/login.html", "/api/login", "/api/logout", "/api/me", "/api/health", "/favicon.ico",
    "/login/sso", "/signin-oidc",
}
```

**2. No `do_GET`**

```python
import sso

if path == "/login/sso":
    url, fluxo = sso.iniciar_login()
    self.send_response(302)
    self.send_header("Location", url)
    self.send_header(
        "Set-Cookie",
        f"{sso.COOKIE_FLUXO}={fluxo}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax"
        + ("; Secure" if COOKIE_SECURE else ""),
    )
    self.send_header("Cache-Control", "no-store")
    self.end_headers()
    return

if path == "/signin-oidc":
    query = {k: v[0] for k, v in parse_qs(parsed.query).items()}
    limpar = f"{sso.COOKIE_FLUXO}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"
    try:
        info = sso.concluir_login(query, self._cookies().get(sso.COOKIE_FLUXO))
    except sso.ErroSso as exc:
        destino = "/login.html?erro=" + ("sem_acesso" if exc.codigo == "access_denied" else "sso")
        self.send_response(302)
        self.send_header("Location", destino)
        self.send_header("Set-Cookie", limpar)
        self.end_headers()
        return

    user = db.get_usuario_by_sso_sub(info["sub"])
    if not user:
        self.send_response(302)
        self.send_header("Location", "/login.html?erro=sem_acesso")
        self.send_header("Set-Cookie", limpar)
        self.end_headers()
        return

    token = db.create_session(user["id"])               # a MESMA sessão de hoje
    self.send_response(302)
    self.send_header("Location", self._home_for_user(user))
    self.send_header("Set-Cookie", self._session_cookie(token))
    self.send_header("Set-Cookie", limpar)
    self.send_header("Cache-Control", "no-store")
    self.end_headers()
    return
```

**3. `/api/login` na transição** (antes de `db.authenticate(...)`):

```python
if os.environ.get("SSO_LOGIN_LOCAL", "1") != "1":
    self._send_json({"ok": False, "erro": "Use o login pelo SSO"}, 410)
    return
```

**4. No `db.py`**

```python
def get_usuario_by_sso_sub(sub: str) -> dict | None:
    with connect() as conn:
        init_db(conn)
        row = conn.execute(
            """
            SELECT id, usuario, nome, papel, ativo, criado_em, atualizado_em
            FROM usuarios WHERE sso_sub = ? AND ativo = 1
            """,
            (sub,),
        ).fetchone()
        return _user_public(row) if row else None   # mesma forma de retorno de authenticate()
```

Ajuste `create_usuario` (ou crie `create_usuario_sso`) para receber `email` e `sso_sub` e gravar `senha_hash = "!sso"`.

**5. Logout.** O `/api/logout` continua igual. Para sair também do SSO, depois de apagar a sessão local o front redireciona para `sso.url_logout()` (exponha a URL, por exemplo, no `/api/me`). Sem isso, o próximo "Entrar" volta logado direto, porque a sessão do SSO continua aberta; num sistema interno isso costuma ser o desejado.

**6. `login.html`.** O botão principal **Entrar** vira `href="/login/sso"`. O parâmetro `?erro=` mostra `sem_acesso` ("Sua conta não tem acesso ao SET Projetos. Fale com o administrador.") ou `sso` ("Não foi possível concluir o login. Tente de novo."). O formulário antigo de usuário e senha fica só enquanto `SSO_LOGIN_LOCAL=1`.

## Gestão de usuários e migração

O admin do SET Projetos continua cadastrando pessoas e papéis na mesma tela; a diferença é que, em vez de criar senha, o sistema pede ao SSO para convidar a pessoa por e-mail.

| Ação na tela de usuários | O que o sistema faz |
| --- | --- |
| Criar usuário (`POST /api/usuarios` recebe `email`, `nome`, `papel`) | `sso.inscrever(email, nome)` → grava o usuário com `sso_sub = insc["sub"]` e o papel escolhido |
| Desativar ou excluir | `ativo = 0` e `sso.remover(sso_sub)` (só tira o acesso ao SET Projetos) |
| Reenviar convite | `sso.reenviar_convite(sso_sub)` (só envia se a pessoa ainda não criou a senha) |

```python
insc = sso.inscrever(email, nome)          # o convite por e-mail sai pelo SSO
created = db.create_usuario_sso(usuario=email, email=email, nome=nome, papel=papel, sso_sub=insc["sub"])
if insc.get("emailEnviado") is False:
    ...  # avise o admin: "usuário criado, mas o e-mail falhou; reenvie o convite"
```

**Usuários atuais.** Hoje o campo `usuario` é um nome de login e não há e-mail cadastrado, então a ligação não pode ser automática. Para cada pessoa, o admin informa o e-mail e o sistema:

```python
insc = sso.inscrever(email, nome)
# UPDATE usuarios SET email = ?, sso_sub = ? WHERE id = ?
```

A pessoa recebe o convite, cria a senha do SSO e passa a entrar pelo SSO, com os mesmos papéis e projetos (é o mesmo registro em `usuarios`). Pode ser um botão "Ligar ao SSO" na tela de usuários ou um script rodado uma vez. Quando todos tiverem `sso_sub`, troque para `SSO_LOGIN_LOCAL=0`.

## Entrada pelo portal "Meus sistemas"

O SSO tem um portal (`https://sso.idt.org.br/conta`) que mostra um cartão para cada sistema em que a pessoa está inscrita; o cartão do SET Projetos leva à **URL de entrada** cadastrada no SSO. Para quem vem do portal já entrar logado, sem passar pela tela de login do Projetos:

- **Durante a transição** (`SSO_LOGIN_LOCAL=1`): a URL de entrada é `https://set-projetos.up.railway.app/login/sso`. Ela leva direto ao SSO, que já reconhece a pessoa e devolve logada em `/signin-oidc`, sem pedir senha.
- **Depois da transição** (`SSO_LOGIN_LOCAL=0`): o `_require_user` passa a redirecionar para `/login/sso` em vez de `/login.html`, e a URL de entrada pode voltar a ser a raiz do sistema.

```python
# _require_user, no lugar do redirect para /login.html:
destino = "/login/sso" if os.environ.get("SSO_LOGIN_LOCAL", "1") != "1" else "/login.html"
self.send_header("Location", destino)
```

Avise o administrador do SSO quando `/login/sso` estiver no ar, para ele atualizar a URL de entrada (em `/admin` → Aplicações → `set_projetos`). Nada mais muda: `client_id`, segredo, URLs de retorno e API de inscrições continuam os mesmos.

## Roteiro de teste

Teste primeiro na máquina local (porta 8765) e depois no Railway, com a URL de produção.

1. Rodar local com `SSO_REDIRECT_URI=http://localhost:8765/signin-oidc` e o segredo.
2. Pela tela de usuários, criar um usuário com o próprio e-mail → o convite chega → criar a senha.
3. Clicar **Entrar** → tela do SSO → volta logado em `/`, com o papel que foi dado.
4. Desativar o usuário no SET Projetos → tentar entrar → volta com `?erro=sem_acesso`.
5. No Railway: os mesmos testes com `https://set-projetos.up.railway.app`.

| Sintoma | Causa provável |
| --- | --- |
| Página do SSO "pedido de login inválido", detalhe `redirect_uri` | `SSO_REDIRECT_URI` diferente da cadastrada (http × https, barra no final) |
| Volta com `?erro=sem_acesso` | Pessoa não inscrita no `set_projetos`, ou sem `sso_sub` no banco local |
| `invalid_client` ao trocar o código | `SSO_CLIENT_SECRET` errado |
| `fluxo_expirado` | Cookie `ct_sso_fluxo` não voltou: login demorou mais de 10 min, ou `COOKIE_SECURE=1` testando em `http://localhost` |
| Erro de assinatura ou `issuer` | Relógio do servidor errado, ou `SSO_URL` diferente de `https://sso.idt.org.br` |
