# Modelo de dados: tabela por tabela

Este é o detalhe da seção [Modelo de dados](../README.md#8-modelo-de-dados) do README. A fonte de verdade é `js/schema.js` (schema v2, `PRAGMA user_version = 2`).

**Origem** indica de onde vem cada valor:
- **iFood:** relatório "Dados do pedido" do iFood.
- **99Food:** relatório "Dados do pedido" do 99Food.
- **calculado:** gerado pelo ETL ou pelo portal.
- **cadastro:** digitado na aba Metas.

## Estrela 1: vendas

### `DIM_TEMPO` (grão: 1 dia)

O JOB 1 cria um calendário contínuo de 01/01 do menor ano a 31/12 do maior ano dos pedidos. A aba Metas acrescenta os dias que faltarem (`BE.metas.linhaTempo`, mesmas regras).

| Coluna | Tipo | Descrição | Origem |
|---|---|---|---|
| `ID_TEMPO` | INTEGER, PK | Data no formato AAAAMMDD, ex.: 20260815 | calculado |
| `DATA` | TEXT, único | AAAA-MM-DD | calculado |
| `ANO` | INTEGER | Ano | calculado |
| `SEMESTRE` | INTEGER (1–2) | 1 = jan a jun | calculado |
| `TRIMESTRE` | INTEGER (1–4) | Trimestre | calculado |
| `MES` | INTEGER (1–12) | Mês | calculado |
| `NOME_MES` | TEXT | "janeiro" … "dezembro" | calculado |
| `DIA` | INTEGER (1–31) | Dia do mês | calculado |
| `DIA_SEMANA` | INTEGER (1–7) | 1 = segunda … 7 = domingo | calculado |
| `NOME_DIA_SEMANA` | TEXT | "segunda-feira" … "domingo" | calculado |
| `FIM_DE_SEMANA` | INTEGER (0/1) | 1 em sábado e domingo | calculado |

### `DIM_CANAL`

| Coluna | Tipo | Descrição | Origem |
|---|---|---|---|
| `ID_CANAL` | INTEGER, PK | 1 = iFood, 2 = 99Food | calculado |
| `NOME_CANAL` | TEXT, único | "iFood" ou "99Food" (chave natural) | calculado |
| `TIPO_CANAL` | TEXT | "Aplicativo de delivery" | calculado |

### `DIM_STATUS`

| Coluna | Tipo | Descrição | Origem |
|---|---|---|---|
| `ID_STATUS` | INTEGER, PK | 1 = CONCLUIDO, 2 = CANCELADO | calculado |
| `STATUS` | TEXT, único | Chave natural | iFood: `STATUS FINAL DO PEDIDO`; 99Food: `Horário do cancelamento` preenchido = CANCELADO |
| `CONSIDERA_VENDA` | INTEGER (0/1) | 1 só em CONCLUIDO | calculado |

### `DIM_PAGAMENTO`

| Coluna | Tipo | Descrição | Origem |
|---|---|---|---|
| `ID_PAGAMENTO` | INTEGER, PK | Numerado em ordem alfabética na 1ª carga; nas cargas seguintes a forma é casada pelo nome (`BE.carga`) | calculado |
| `FORMA_PAGAMENTO` | TEXT, único | Categoria padronizada por `BE.etl.formaPagamento` | iFood: `FORMA DE PAGAMENTO`; 99Food: `Forma de pagamento` |

### `DIM_TIPO_ENTREGA`

| Coluna | Tipo | Descrição | Origem |
|---|---|---|---|
| `ID_TIPO_ENTREGA` | INTEGER, PK | 1 ou 2 | calculado |
| `TIPO_ENTREGA` | TEXT, único | "Entrega parceira iFood" ou "Entrega da plataforma (99Food)", fixo por canal | calculado |

### `FATO_PEDIDO` (grão: 1 pedido)

Todos os valores são REAL em R$, arredondados para 2 casas (`BE.etl.r2`). Em pedido cancelado, só `VALOR_BRUTO_PEDIDO` é mantido (regra ZERA FATOS).

| Coluna | Tipo | Descrição | iFood | 99Food |
|---|---|---|---|---|
| `ID_PEDIDO` | TEXT, PK | Dimensão degenerada | `ID COMPLETO DO PEDIDO` | `ID do pedido` |
| `ID_CANAL` | FK → `DIM_CANAL` | Canal | 1 | 2 |
| `ID_TEMPO` | FK → `DIM_TEMPO` | Dia do pedido | `DATA E HORA DO PEDIDO` (dd/mm/aaaa) | `Data` (aaaammdd) |
| `ID_STATUS` | FK → `DIM_STATUS` | Concluído ou cancelado | `STATUS FINAL DO PEDIDO` | `Horário do cancelamento` |
| `ID_PAGAMENTO` | FK → `DIM_PAGAMENTO` | Forma padronizada | `FORMA DE PAGAMENTO` | `Forma de pagamento` |
| `ID_TIPO_ENTREGA` | FK → `DIM_TIPO_ENTREGA` | Tipo de entrega | 1 | 2 |
| `VALOR_BRUTO_PEDIDO` | REAL | Valor dos itens | `VALOR DOS ITENS (R$)` | `Preço original do item` |
| `VALOR_DESCONTOS` | REAL | Descontos ao cliente | incentivos da LOJA + da REDE + do IFOOD | `Despesas de marketing` |
| `TAXA_MOTOBOY` | REAL | Custo de entrega da loja | 0 | `Custos logísticos` |
| `VALOR_TAXAS` | REAL | Taxas e comissões | \|`TAXAS E COMISSOES (R$)`\| | `Despesas de comissão` + `Taxas de processamento de pagamento` |
| `VALOR_TOTAL_PAGO` | REAL | Pago pelo cliente | `TOTAL PAGO PELO CLIENTE (R$)` | `Receita de vendas` |
| `VALOR_LIQUIDO` | REAL | Recebido pela loja | `VALOR LIQUIDO (R$)` | `Receita real da loja` |

Índices: `IX_FATO_PEDIDO_TEMPO`, `IX_FATO_PEDIDO_CANAL` e `IX_FATO_PEDIDO_STATUS`.

## Estrela 2: metas

### `META_DEFINICAO` (acrescentada na v2; 1 linha por meta)

| Coluna | Tipo | Descrição | Origem |
|---|---|---|---|
| `ID_META` | INTEGER, PK | Identificador da meta | calculado |
| `NOME` | TEXT | Até 120 caracteres; vazio vira "Meta dd/mm a dd/mm" | cadastro |
| `DATA_INICIO` | TEXT | AAAA-MM-DD | cadastro |
| `DATA_FIM` | TEXT | AAAA-MM-DD, `>= DATA_INICIO`, período de até 366 dias | cadastro |
| `DIAS_SEMANA` | TEXT | Dias que contam, ex.: `'1234567'` ou `'67'` | cadastro |
| `ID_CANAL` | FK → `DIM_CANAL`, opcional | NULL = todos os canais | cadastro |
| `META_VALOR` | REAL ≥ 0 | Meta de faturamento do período (R$) | cadastro (ou soma dos dias após ajuste manual) |
| `QUANTIDADE` | INTEGER ≥ 0 | Meta de pedidos do período | cadastro (ou soma dos dias) |
| `DISTRIBUICAO` | TEXT | `'igual'` ou `'proporcional'` | cadastro |
| `CRIADA_EM` | TEXT | ISO 8601 | calculado |
| `ATUALIZADA_EM` | TEXT | ISO 8601 | calculado |

### `FATO_META` (grão: 1 dia elegível de 1 meta)

| Coluna | Tipo | Descrição | Origem |
|---|---|---|---|
| `ID_META` | FK → `META_DEFINICAO`, `ON DELETE CASCADE` | Meta | calculado |
| `ID_TEMPO` | FK → `DIM_TEMPO` | Dia | calculado |
| `QUANTIDADE` | INTEGER ≥ 0 | Meta de pedidos do dia | calculado (distribuição) ou ajuste manual |
| `META_VALOR` | REAL ≥ 0 | Meta em R$ do dia | calculado (distribuição) ou ajuste manual |

Chave primária: (`ID_META`, `ID_TEMPO`). Índices: `IX_FATO_META_TEMPO` e `IX_META_DEFINICAO_INICIO`.

## Controle

### `CARGA_ETL` (1 linha por importação)

| Coluna | Tipo | Descrição | Origem |
|---|---|---|---|
| `id` | INTEGER, PK AUTOINCREMENT | Número da carga | calculado |
| `data_hora` | TEXT | ISO 8601 da gravação | calculado |
| `arquivos` | TEXT (JSON) | Lista `{ nome, tipo, usado }` dos arquivos escolhidos | calculado |
| `pedidos_lidos` | INTEGER | Linhas lidas nos dois relatórios | calculado |
| `pedidos_gravados` | INTEGER | Pedidos enviados à `FATO_PEDIDO` (após deduplicação) | calculado |
| `conferencias_ok` | INTEGER | Conferências aprovadas | calculado |
| `conferencias_total` | INTEGER | Conferências executadas (6) | calculado |
| `log` | TEXT | Registro completo da execução | calculado |

### `PROBLEMA_TRATAMENTO`

| Coluna | Tipo | Descrição | Origem |
|---|---|---|---|
| `id` | INTEGER, PK AUTOINCREMENT | Identificador | calculado |
| `id_carga` | FK → `CARGA_ETL`, `ON DELETE CASCADE` | Carga em que o problema apareceu | calculado |
| `onde` | TEXT | Fonte do problema | calculado |
| `problema` | TEXT | O que foi encontrado | calculado |
| `tratamento` | TEXT | O que o ETL fez | calculado |

## Migrações

`BE.schema.aplicar(db)` lê `PRAGMA user_version` e aplica, numa transação por versão, os passos que faltam. Se o banco for de versão mais nova que a do portal, recusa a abertura.

| Versão | O que faz |
|---|---|
| v1 | Cria as dimensões, `FATO_PEDIDO`, `FATO_META` (uma linha por dia, `UNIQUE (ID_TEMPO)`), `CARGA_ETL` e `PROBLEMA_TRATAMENTO`. |
| v2 | Cria `META_DEFINICAO`. Recria a `FATO_META` com a chave (`ID_META`, `ID_TEMPO`). Cada mês que já tinha metas vira uma definição "Metas de &lt;mês&gt;/&lt;ano&gt;", com todos os dias da semana e totais iguais à soma dos dias. As linhas diárias são copiadas sem redistribuir. |

Backups `.zip` ou `.sqlite` de versões anteriores passam pela mesma migração ao serem restaurados.
