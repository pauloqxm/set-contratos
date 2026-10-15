# Gestão de Contratos — SET / IDT

Painel estático para acompanhar os contratos da Secretaria do Trabalho do Ceará. Ele lê a planilha publicada **CONTROLE DE CONTRATOS** e monta indicadores, alertas de vencimento, gráficos e a lista filtrável.

Não há etapa de build. A página é HTML, CSS e JavaScript, com PapaParse, Chart.js e SheetJS carregados por CDN.

## Como abrir

O navegador bloqueia a leitura da planilha se o arquivo for aberto direto (`file://`). Use um servidor local:

```bash
npx serve .
```

Ou, com Python:

```bash
python -m http.server 8080
```

Depois acesse `http://localhost:8080` (ou a porta que o comando indicar).

## Publicar

O deploy usa a imagem Nginx do `Dockerfile`, na porta **8080**. Entram só `index.html`, `css/` e `js/`. A planilha continua sendo lida do link publicado; ela não vai para dentro da imagem.

Na pasta do projeto:

```bash
docker build -t set-contratos .
docker run --rm -p 8080:8080 set-contratos
```

Abra `http://localhost:8080`. No Railway, o serviço detecta o `Dockerfile` e usa a mesma porta.

A planilha precisa continuar publicada na web. O painel busca o CSV a cada carregamento e quando a pessoa clica em **Atualizar**. Se a rede falhar, a última cópia salva no navegador é exibida, com aviso de data.

Quando o SSO deste painel for cadastrado, a URL de retorno tem de ser a raiz do site publicado, com a barra final.

## Trocar a planilha

Edite as URLs em [`js/config.js`](js/config.js):

- `csvUrl` — link publicado terminando em `output=csv`
- `sheetUrl` — link `pubhtml` usado no rodapé

Os prazos dos alertas (`alertaCritico` e `alertaAtencao`) também ficam nesse arquivo. O padrão é 45 e 100 dias.

## O que o painel calcula

- **Valor total** de cada contrato = valor original + aditivo de valor. Se essa soma estiver zerada, usa Tesouro + outras fontes. O detalhe do contrato avisa quando as duas contas não fecham.
- **Término efetivo** = aditivo de prazo, quando a data é válida; senão, o término. A data `30/12/1899` é ignorada.
- **Dias restantes** são recalculados com a data de hoje. O número gravado na planilha aparece no detalhe do contrato e no tooltip da tabela.
- Contratos **vencendo** são os que ainda não passaram do término efetivo e estão abaixo do prazo do alerta. Contratos já vencidos continuam na tabela, em vermelho, mas não entram nesses dois cartões.

Filtros, ordenação e página ficam no endereço, então a visão pode ser compartilhada.
