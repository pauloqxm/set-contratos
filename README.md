# Gestão de Contratos — SET / IDT

Painel estático para acompanhar os contratos da Secretaria do Trabalho do Ceará. Ele lê a planilha publicada **CONTROLE DE CONTRATOS** e monta indicadores, alertas de vencimento, gráficos e a lista filtrável.

Endereço publicado: [https://set-contratos.up.railway.app/](https://set-contratos.up.railway.app/)

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

Abra `http://localhost:8080`. No Railway, o serviço detecta o `Dockerfile` e usa a mesma porta; o site fica em `https://set-contratos.up.railway.app/`.

A planilha precisa continuar publicada na web. O painel busca o CSV a cada carregamento e quando a pessoa clica em **Atualizar**. Se a rede falhar, a última cópia salva no navegador é exibida, com aviso de data.

## Acesso pelo SSO

O site inteiro (abas **Painel**, **Ata** e **Frequência**) só abre depois do login no SSO (`https://sso.idt.org.br`, aplicação `set_contratos`). Quem não tem sessão vai para a tela do SSO; quem não tem acesso vê um aviso. O botão **Sair** fica na barra superior.

O site não tem servidor, então o login é feito no navegador, sem segredo. No `/admin` do SSO, a aplicação `set_contratos` precisa estar como:

- **Aplicação pública** marcada. Com ela confidencial, o navegador não consegue trocar o código pelo token, e o painel mostra “O SSO recusou este endereço”.
- **URLs de retorno** e **pós-logout**: a raiz de cada endereço do painel, com a barra final — `https://set-contratos.up.railway.app/` e, para teste local, `http://127.0.0.1:8080/`.
- **URL de entrada (portal)**: `https://set-contratos.up.railway.app/`.
- Acesso liberado para quem vai usar o painel (dá para copiar os acessos do SET Projetos).

O login protege a tela, não a planilha: quem tiver o link do CSV publicado ainda consegue baixá-lo. As atas, no Supabase, só são lidas e gravadas com o token do SSO.

## Ata da reunião

A aba **Ata** grava no Supabase `ftuycoafwraxaachidlh`, usando o mesmo login do painel.

O **Responsável** da ata é um campo de texto livre. Em ata nova, o site sugere o nome de quem está logado, se o SSO tiver informado; dá para editar à vontade.

Os **participantes** vêm da aba **Frequência**: na data da ata, a lista é quem confirmou presença na planilha do Comitê Executivo. Dá para desmarcar nomes antes de salvar.

## Frequência

A aba **Frequência** lê a planilha publicada de presença (`frequenciaCsvUrl` em [`js/config.js`](js/config.js)). O filtro escolhe a data da reunião e mostra o total e os nomes, sem repetir quem registrou mais de uma vez no mesmo dia.

No Supabase, uma vez (e de novo sempre que estes arquivos mudarem):

1. **SQL Editor**: rode [`supabase/ata.sql`](supabase/ata.sql). Ele cria `ata_reunioes` e `ata_itens` (e colunas do responsável), fechadas para a chave publicável. Rodar de novo não apaga atas.
2. **Edge Functions**: publique [`supabase/functions/ata/index.ts`](supabase/functions/ata/index.ts) com o nome `ata` e a verificação de JWT **desligada**. Quem confere o acesso é o token do SSO. Pela CLI:

   ```bash
   supabase functions deploy ata --project-ref ftuycoafwraxaachidlh --no-verify-jwt
   ```

3. A função já aceita `https://set-contratos.up.railway.app` e o endereço local. Só se o painel mudar de endereço: em **Edge Functions → Secrets**, crie `ALLOWED_ORIGINS` com os endereços separados por vírgula, sem barra final.

A chave de serviço fica só no ambiente da função; o Supabase a injeta sozinho. Ela e o `client_secret` do SSO não entram neste repositório.

## Trocar a planilha

Edite as URLs em [`js/config.js`](js/config.js):

- `csvUrl` — link publicado terminando em `output=csv`
- `sheetUrl` — link `pubhtml` usado no rodapé
- `frequenciaCsvUrl` — presença do comitê, também em `output=csv`

Os prazos dos alertas (`alertaCritico` e `alertaAtencao`) também ficam nesse arquivo. O padrão é 45 e 100 dias.

## O que o painel calcula

- **Valor total** de cada contrato = valor original + aditivo de valor. Se essa soma estiver zerada, usa Tesouro + outras fontes. O detalhe do contrato avisa quando as duas contas não fecham.
- **Término efetivo** = aditivo de prazo, quando a data é válida; senão, o término. A data `30/12/1899` é ignorada.
- **Dias restantes** são recalculados com a data de hoje. O número gravado na planilha aparece no detalhe do contrato e no tooltip da tabela.
- Contratos **vencendo** são os que ainda não passaram do término efetivo e estão abaixo do prazo do alerta. Contratos já vencidos continuam na tabela, em vermelho, mas não entram nesses dois cartões.

Filtros, ordenação e página ficam no endereço, então a visão pode ser compartilhada.
