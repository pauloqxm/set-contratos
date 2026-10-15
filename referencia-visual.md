# Referência visual — SET Projetos

Identidade do painel SET / IDT (Secretaria do Trabalho). Use este arquivo para replicar estilo, tipografia, cores e imagens em outro projeto.

Fontes no código: `web/static/css/style.css`, `auth.css`, `salas.css`, `tarefas.css`.

---

## 1. Tipografia

**Família:** Montserrat  
**Fallback:** `system-ui, sans-serif`  
**Pesos usados:** 400, 500, 600, 700, 800

### Import (Google Fonts)

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap"
  rel="stylesheet"
/>
```

URL direta da folha:

```
https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap
```

### Escala

| Papel | Peso | Tamanho | Cor | Extras |
|-------|------|---------|-----|--------|
| Eyebrow / selo | 600 | `0.72rem` | `#6D6E71` | uppercase, `letter-spacing: 0.12em` |
| Título da barra (h1) | 700 | `clamp(0.78rem, 1.7vw, 1.05rem)` | `#7A7A7A` | uppercase, `letter-spacing: 0.06em` |
| Título de painel (h2) | 700 | `0.95rem` | `#4D4D4D` | — |
| Hero / valor de KPI | **800** | `1.15rem` a `clamp(2.2rem, 5vw, 3.4rem)` | `#39B54A` | `letter-spacing: -0.02em` |
| Corpo | 500 | `0.95rem` | `#4D4D4D` | line-height 1.45 |
| Texto de apoio | 500 | `0.78rem` | `#6D6E71` | line-height 1.4 |
| Botão | 700 | `0.92rem` (`0.78rem` se small) | branco ou `#4D4D4D` | `letter-spacing: 0.02em` |
| Link de ação | 700 | `0.78rem` | `#39B54A` | uppercase, `letter-spacing: 0.04em` |
| Chip / badge | 700 | `0.72rem` | conforme tom | uppercase, `letter-spacing: 0.04em` |
| Rodapé | 500 | `0.72rem` | `#6D6E71` | — |

```css
--font: "Montserrat", system-ui, sans-serif;
```

Botões, inputs, selects e textareas herdam a mesma fonte.

---

## 2. Paleta

### Tokens (`:root`)

| Token | Hex | Uso |
|-------|-----|-----|
| `--green` | `#39B54A` | Primária: CTA, valor de KPI, aba/slot ativo, sucesso |
| `--green-dark` | `#2F9A3D` | Hover do CTA; texto em chip verde |
| `--green-soft` | `#E8F7EA` | Fundo de chip, badge, item ativo |
| `--orange` | `#F15A24` | Acento institucional; bloco Período; alerta leve |
| `--orange-soft` | `#FFF0EA` | Fundo de chip laranja / papel Reservas |
| `--blue` | `#0071BC` | Apoio; bloco Local; papel Admin |
| `--blue-soft` | `#E6F3FB` | Fundo de chip azul |
| `--teal` | `#0D9488` | KPI secundário (ocupação / tempo) |
| `--teal-soft` | `#E6F7F5` | Fundo do KPI teal |
| `--bg` | `#F2F2F2` | Fundo da página |
| `--white` | `#FFFFFF` | Cards, topbar, painéis, login |
| `--ink` | `#4D4D4D` | Texto principal |
| `--ink-soft` | `#6D6E71` | Texto secundário |
| `--line` | `#D1D3D4` | Bordas |
| Título institucional | `#7A7A7A` | h1 da topbar |
| Menu hover/ativo | `#ED7526` | Destaque de item de menu e ênfase em tarefas |
| Perigo | `#C1443C` | Excluir / cancelar |
| Perigo fundo | `#FBEAE8` | Botão perigo outline |
| Perigo hover | `#A33832` | Botão perigo sólido |
| Aba inativa | `#E4E4E4` | Dias da grade, tabs |

### Copiar no outro projeto

```css
:root {
  --green: #39b54a;
  --green-dark: #2f9a3d;
  --green-soft: #e8f7ea;
  --orange: #f15a24;
  --orange-soft: #fff0ea;
  --blue: #0071bc;
  --blue-soft: #e6f3fb;
  --teal: #0d9488;
  --teal-soft: #e6f7f5;
  --bg: #f2f2f2;
  --white: #ffffff;
  --ink: #4d4d4d;
  --ink-soft: #6d6e71;
  --line: #d1d3d4;
  --danger: #c1443c;
  --danger-soft: #fbeae8;
  --menu-accent: #ed7526;
  --shadow: 0 10px 28px rgba(77, 77, 77, 0.08);
  --radius: 10px;
  --font: "Montserrat", system-ui, sans-serif;
}
```

### Fundo da página

```css
background:
  radial-gradient(circle at 12% 0%, rgba(57, 181, 74, 0.08), transparent 42%),
  radial-gradient(circle at 88% 8%, rgba(241, 90, 36, 0.07), transparent 36%),
  var(--bg);
```

Login usa um radial extra em azul:

```css
background:
  radial-gradient(ellipse 80% 50% at 50% -10%, rgba(57, 181, 74, 0.12), transparent 55%),
  radial-gradient(ellipse 60% 40% at 100% 100%, rgba(0, 113, 188, 0.08), transparent 50%),
  var(--bg);
```

### Faixa institucional (rodapé)

Proporção **verde 1,5 · azul 1 · laranja 0,7**, altura 6–8px, cantos 999px.

```css
.footer-strip {
  display: grid;
  grid-template-columns: 1.5fr 1fr 0.7fr;
  height: 6px;
  border-radius: 999px;
  overflow: hidden;
}
.strip-green  { background: #39b54a; }
.strip-blue   { background: #0071bc; }
.strip-orange { background: #f15a24; }
```

Progresso: `linear-gradient(90deg, #39b54a, #5fc86d 55%, #0071bc)`.  
Barra de tarefa em atraso: `linear-gradient(90deg, #ed7526, #c1443c)`.

---

## 3. Superfície e layout

| Item | Valor |
|------|--------|
| Largura máxima | `min(1200px, calc(100% - 32px))` |
| Raio de painel | `10px` |
| Raio de card/botão | `8px` |
| Raio de chip / filtro | `999px` |
| Sombra | `0 10px 28px rgba(77, 77, 77, 0.08)` |
| Sombra do login | `0 16px 40px rgba(77, 77, 77, 0.12)` |
| Painel | fundo branco, borda `#D1D3D4`, padding 12px |
| Topbar | branco, borda inferior `#D1D3D4`, sombra |

Cabeçalhos de módulo (ex.: grade de salas) podem ser **três blocos** com texto branco:

- Agenda → `#39B54A`
- Local → `#0071BC`
- Período → `#F15A24`

Controles sobre esses blocos: fundo `rgba(255,255,255,0.16)`, borda `rgba(255,255,255,0.42)`, texto branco.

---

## 4. Componentes

### Botão primário (`.btn-run`)

Fundo `#39B54A`, texto branco, raio 8px, sombra `0 8px 18px rgba(57, 181, 74, 0.28)`.  
Hover: `#2F9A3D` e `translateY(-1px)`.

### Botão fantasma (`.btn-ghost`)

Fundo branco, borda `#D1D3D4`, texto `#4D4D4D`.  
Ativo: borda verde, fundo `#E8F7EA`, texto `#2F9A3D`.  
Menu: hover/ativo `#ED7526`.

### Botão perigo (`.btn-danger`)

Outline: borda/texto `#C1443C`, fundo `#FBEAE8`.  
Sólido: fundo `#C1443C`; hover `#A33832`.

### KPI

1. Faixa superior na cor do tom (verde / azul / laranja / teal), rótulo branco uppercase  
2. Valor extra-bold na mesma cor  
3. Texto de apoio cinza  
4. Rodapé uppercase com borda superior `#D1D3D4`

### Chips de papel

| Papel | Fundo | Texto |
|-------|-------|-------|
| Administrador | `#E6F3FB` | `#0071BC` |
| Editor | `#E8F7EA` | `#2F9A3D` |
| Consulta | `#F2F2F2` | `#6D6E71` |
| Reservas | `#FFF0EA` | `#F15A24` |

---

## 5. Imagens (URLs)

Caminhos servidos pelo app (copie os arquivos para `/static/img/` do novo projeto):

| Uso | Arquivo local | URL no app |
|-----|---------------|------------|
| Logo SET / Governo do Ceará | `web/static/img/logo-set.jpg` | `/static/img/logo-set.jpg` |
| Logo IDT | `web/static/img/logo-idt.png` | `/static/img/logo-idt.png` |

URLs públicas no repositório (branch `main`):

```
https://raw.githubusercontent.com/pauloqxm/set-casa/main/web/static/img/logo-set.jpg
https://raw.githubusercontent.com/pauloqxm/set-casa/main/web/static/img/logo-idt.png
```

HTML da marca (topbar):

```html
<div class="topbar-logos" aria-label="Logos institucionais">
  <img
    class="logo logo-set"
    src="/static/img/logo-set.jpg"
    alt="Ceará — Governo do Estado · Secretaria do Trabalho"
    width="120"
    height="120"
  />
  <img
    class="logo logo-idt"
    src="/static/img/logo-idt.png"
    alt="Instituto de Desenvolvimento do Trabalho"
    width="220"
    height="72"
  />
</div>
```

Tamanhos de exibição:

| Contexto | SET | IDT |
|----------|-----|-----|
| Topbar | altura 56px, max-width 90px | altura 42px, max-width 160px |
| Login | altura 64px | altura 48px |

`object-fit: contain`. Fundo da logo SET: branco.

Textos da marca:

- Eyebrow: `SET / IDT · Secretaria do Trabalho`
- Rodapé: `SET Projetos — SET / IDT`

Não há favicon versionado neste repositório. Fotos de tarefas vêm do storage (`GET /api/fotos/...`) e não fazem parte da identidade.

---

## 6. Checklist para o outro projeto

1. Importar Montserrat 400–800 pela URL do Google Fonts.  
2. Colar as variáveis `:root`.  
3. Fundo cinza `#F2F2F2` com radiais verde e laranja.  
4. Números e CTA em `#39B54A` / hover `#2F9A3D`.  
5. Acentos pontuais em `#F15A24` e `#0071BC`.  
6. Menu hover em `#ED7526`.  
7. Exclusão em `#C1443C`.  
8. Faixa de rodapé verde–azul–laranja (1,5 / 1 / 0,7).  
9. Logos SET (jpg) + IDT (png) nas URLs acima.  
10. Largura de conteúdo até 1200px; raios 8–10px; sombra suave cinza.

---

*Referência extraída do frontend SET Projetos (`casa_trabalhador` / repositório `pauloqxm/set-casa`).*
