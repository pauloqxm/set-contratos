# Sugestões de melhoria: Painel de Gestão dos Contratos (SET / IDT)

Objetivo: organizar melhor os KPIs e deixar o visual mais limpo e moderno.

## Diagnóstico rápido

- Os KPIs estão espalhados em três lugares: total de contratos no cabeçalho, cinco cards empilhados na coluna da esquerda e alertas na coluna da direita.
- A coluna de cards ocupa muito espaço vertical e deixa áreas vazias embaixo dos gráficos e dos alertas.
- As cores dos cards (verde, azul, verde-água, laranja, vermelho) competem com as cores dos gráficos e não carregam significado.
- O número mais crítico do painel (42 de 86 contratos vencidos) aparece em letra pequena no cabeçalho.
- Há informação repetida: Empenhado aparece no card e no gráfico de Execução financeira.

## 1. Faixa única de KPIs no topo

Substituir a coluna lateral por uma faixa horizontal logo abaixo do cabeçalho, com 4 blocos lógicos:

| Carteira | Valor contratado | Execução | Prazos |
|---|---|---|---|
| **86 contratos**<br>39 ativos · 42 vencidos · 5 outros | **R$ 511,96 mi**<br>barra dividida: Tesouro 52,9% / Outras fontes 47,1% | **R$ 443,38 mi empenhado (86,6%)**<br>barra de progresso + saldo R$ 68,56 mi | **6** em menos de 45 dias<br>**17** em menos de 100 dias |

Mudanças decorrentes:

- O "Total de contratos" sai do cabeçalho e vai para o bloco Carteira.
- Tesouro e Outras Fontes viram uma única barra empilhada, já que são partes do mesmo total.
- Empenhado e Saldo viram um card só, com barra de progresso.
- O gráfico de "Execução financeira" pode ser removido, pois repete o card de execução.
- Os alertas de prazo passam a fazer parte da faixa, liberando a coluna da direita.

## 2. Destaque para os contratos vencidos

- Criar um card próprio para **42 vencidos**, em vermelho, clicável para filtrar a tabela (mesmo comportamento dos alertas atuais).
- É o indicador que mais pede ação e hoje está escondido.

## 3. Cores com significado

| Cor | Uso |
|---|---|
| Verde | Executado, ativo, dentro do prazo |
| Âmbar | Atenção (vencendo em menos de 100 dias, pendências) |
| Vermelho | Vencido, urgente (menos de 45 dias) |
| Azul institucional | Destaques neutros, mês atual, links |
| Cinza | Rótulos, textos de apoio, valores neutros |

- O Saldo em vermelho passa a ideia de problema. Saldo não é algo ruim: deixar em neutro.
- Trocar as faixas coloridas no topo dos cards por fundo branco, número grande em destaque e rótulo pequeno em cinza.

## 4. Valores abreviados

- Exibir valores resumidos nos cards: **R$ 511,96 mi** em vez de R$ 511.961.074,92.
- Mostrar o valor completo em tooltip ao passar o mouse.
- Aplicar o mesmo na tabela, o que resolve os valores cortados (ex.: "R$ 2.499.392,9…").

## 5. Gráficos

**Gestor por contrato e Fiscal por contrato**

- Trocar as roscas por barras horizontais ordenadas, com a quantidade absoluta ao lado do percentual (ex.: "Sheila · 33 · 38,4%").
- Com 8 fatias, os rótulos dentro dos pedaços pequenos ficam ilegíveis.

**Fiscal sem designação**

- Renomear "—" (16,3%) para **"Sem fiscal designado"** e pintar em âmbar.
- Isso é uma pendência administrativa, não uma categoria comum.

**Valor por categoria**

- Uma categoria domina a escala e as menores ficam invisíveis.
- Opções: mostrar o valor como rótulo em cada barra, usar escala em percentual do total ou agrupar as menores em "Outras".

**Vencimentos nos próximos 12 meses**

- Manter, mas colorir as barras por urgência (vermelho até 45 dias, âmbar até 100 dias, verde depois).

## 6. Tabela de contratos

- Remover o fundo rosa das linhas vencidas. Com metade da tabela vencida, o visual fica pesado. Usar apenas o selo "VENCIDO" e uma borda vermelha fina à esquerda da linha.
- Em "Dias restantes", trocar valores negativos por texto: "vencido há 986 d".
- Com 13 colunas, mover as menos consultadas (MAPP, Início, Modalidade) para o detalhe do contrato.
- Alinhar valores monetários à direita e usar fonte com números tabulares (`font-variant-numeric: tabular-nums`).
- Fixar o cabeçalho da tabela ao rolar.

## 7. Filtros e cabeçalho

- Filtros em uma única linha, com a busca integrada.
- Mostrar os filtros ativos como "chips" removíveis acima da tabela (ex.: `Gestor: Sheila ✕`).
- Título alinhado à esquerda, ao lado das logos.
- Data de atualização junto dos botões Atualizar e Redefinir filtros.

## Layout proposto

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Logos] GESTÃO DOS CONTRATOS        Atualizado 15/10 13:42 [Atualizar]│
├──────────────────────────────────────────────────────────────────────┤
│ [Situação][Órgão][Categoria][Modalidade][Gestor][Fiscal][🔍 Buscar…] │
├────────────┬──────────────┬──────────────┬────────────┬──────────────┤
│ CARTEIRA   │ VALOR        │ EXECUÇÃO     │ VENCIDOS   │ PRAZOS       │
│ 86         │ R$ 511,96 mi │ 86,6%        │ 42         │ 6  < 45 d    │
│ 39 ativos  │ ▓▓▓▓▓░░░░    │ ▓▓▓▓▓▓▓▓░    │ clique p/  │ 17 < 100 d   │
│            │ Tes. │ Outr. │ saldo 68,6mi │ filtrar    │              │
├────────────┴──────────────┴──────────────┴────────────┴──────────────┤
│ Gestor (barras)      │ Fiscal (barras)       │ Vencimentos 12 meses  │
├──────────────────────┴───────────────────────┴───────────────────────┤
│ Valor por categoria                                                  │
├──────────────────────────────────────────────────────────────────────┤
│ Tabela de contratos                                                  │
└──────────────────────────────────────────────────────────────────────┘
```

## Prioridade sugerida

1. Faixa única de KPIs e card de vencidos (maior impacto visual e de leitura).
2. Paleta de cores com significado e valores abreviados.
3. Ajustes na tabela.
4. Troca das roscas por barras e ajustes nos demais gráficos.
5. Filtros em chips e reorganização do cabeçalho.
