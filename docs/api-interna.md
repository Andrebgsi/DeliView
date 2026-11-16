# API interna (`window.BE`)

Este é o detalhe da seção [API interna](../README.md#14-api-interna) do README. Todas as funções abaixo foram conferidas com `grep` em `js/`. Funções que começam com `_` existem só para os testes.

O parâmetro `banco` é opcional nos módulos que o aceitam. O padrão é `BE.db`; os testes passam um banco próprio, criado com `BE.criarBanco()`.

## Sumário

| Módulo | Arquivo | Para quê |
|---|---|---|
| [`BE.schema`](#beschema) | `js/schema.js` | Tabelas e migrações |
| [`BE.db` / `BE.criarBanco`](#bedb--becriarbanco) | `js/db.js` | Banco SQLite (sql.js) + IndexedDB |
| [`BE.xlsx`](#bexlsx) | `js/etl/zip-xlsx.js` | Leitura e escrita de .xlsx e .zip |
| [`BE.etl`](#beetl) | `js/etl/etl.js` | Motor ETL da Etapa 5 |
| [`BE.carga`](#becarga) | `js/etl/carga.js` | Gravação do ETL no banco e exportações |
| [`BE.metas`](#bemetas) | `js/consultas/metas.js` | Regras das metas por período |
| [`BE.backup`](#bebackup) | `js/backup.js` | Backup .zip, leitura e prévia |
| [`BE.arquivoBanco`](#bearquivobanco--becriararquivobanco) | `js/arquivo-banco.js` | Arquivo .sqlite vinculado |
| [`BE.bancoInicial`](#bebancoinicial) | `js/componentes/banco-inicial.js` | Pergunta inicial, faixa Reconectar |
| [`BE.dash`](#bedash) | `js/consultas/dashboard.js`, `olap.js`, `insights.js` | Consultas do Dashboard, matriz pivot, operações OLAP e insights |
| [`BE.graficos`](#begraficos) | `js/graficos.js` | Gráficos em SVG |
| [`BE.ui`](#beui) | `js/componentes/*.js` | Calendário e blocos do Dashboard |
| [`BE.textos` e utilitários](#betextos-e-utilitários-da-casca) | `js/app.js`, `js/icones.js` | Textos, toasts, tabelas, rotas, ícones |

## `BE.schema`

| Membro | O que é |
|---|---|
| `versao` | Versão atual do schema (2) |
| `tabelas` | As 10 tabelas, na ordem das contagens |
| `migracoes` | `[V1, V2]`: passos SQL ou funções `(db)` |
| `aplicar(db)` | Aplica as migrações pendentes num `Database` do sql.js, uma transação por versão |

## `BE.db` / `BE.criarBanco`

`BE.db = BE.criarBanco()`. Cada instância tem o seu banco em memória e o seu nome no IndexedDB.

| Função | O que faz |
|---|---|
| `abrir({ nome?, silencioso? })` → Promise | Carrega do IndexedDB (padrão `deliview`) ou cria vazio com o schema |
| `consultar(sql, params?)` → `Array<objeto>` | SELECT |
| `executar(sql, params?)` → `{ alteradas, ultimoId }` | INSERT/UPDATE/DELETE |
| `transacao(fn)` | BEGIN/COMMIT; ROLLBACK em erro; `fn` precisa ser síncrona |
| `exportar()` → `Uint8Array` | Bytes do banco (reaplica `PRAGMA foreign_keys`) |
| `salvar()` → Promise\<boolean\> | Grava no IndexedDB, dispara `be:banco-alterado` e avisa os observadores |
| `aoSalvar(fn)` | `fn({ motivo })` após cada `salvar` (`'salvar'`) e antes de `apagarTudo` (`'apagar'`) |
| `config.ler / gravar / apagar(chave[, valor])` | Store `config` do mesmo IndexedDB |
| `nomeBackup(data?)` | `deliview-AAAA-MM-DD.sqlite` |
| `baixarBackup()` | Baixa o `.sqlite` com esse nome |
| `restaurarBackup(arquivo)` → Promise | Valida "SQLite format 3" e as tabelas, migra, substitui e salva |
| `limparVendas()` / `limparMetas()` / `limparBanco()` → `{ apagadas, salvo }` | Limpezas seletivas, numa transação |
| `tabelasDaLimpeza(tipo)` | Tabelas de `'vendas'`, `'metas'` ou `'banco'` |
| `apagarTudo({ semConfirmar? })` | Apaga o IndexedDB e as chaves `be.*` e recria vazio (pede 2 confirmações) |
| `integridade()` → `{ ok, problemas }` | `PRAGMA integrity_check` + `foreign_key_check` |
| `resumo()` → `{ tabelas, pedidos, ultimaCarga, persistente }` | Linhas por tabela |
| `fechar()` | Fecha o banco em memória |
| `persistente`, `aberto` | Estado: o IndexedDB funciona? O banco está aberto? |
| `BE.criarBanco.ehSQLite(bytes)` | Confere o cabeçalho "SQLite format 3" |
| `BE.criarBanco.carregarSQL()` → Promise | Módulo sql.js (carregado uma vez) |

## `BE.xlsx`

| Função | O que faz |
|---|---|
| `lerXlsx(buf)` → `{ abas, ordem }` | Lê um .xlsx (cada aba vira uma matriz de textos) |
| `comoObjetos(linhas)` | Matriz com cabeçalho na linha 0 → lista de objetos |
| `lerZip(buf)` | Índice do zip, com `_ler(nome)` (texto) e `_lerBytes(nome)` |
| `inflar(bytes)` / `deflar(bytes)` | DEFLATE puro via `DecompressionStream` / `CompressionStream` (`deflar` devolve `null` sem a API) |
| `criarZip(arquivos, { comprimir? })` | Monta um .zip; com `comprimir`, devolve Promise e usa deflate |
| `criarXlsx(abas)` → Promise\<Blob\> | Gera um .xlsx a partir de `[{ nome, cab, linhas }]` |
| `crc32(bytes)`, `colIdx(ref)`, `letra(i)`, `esc(s)`, `xml(texto)` | Apoio: CRC-32, coluna "B3" → índice, índice → letra, escape XML, DOMParser |
| `enc`, `dec` | `TextEncoder` e `TextDecoder` UTF-8 |

## `BE.etl`

| Função | O que faz |
|---|---|
| `lerArquivos(arquivos)` → Promise | Lê e classifica cada .xlsx: `{ nome, tipo, rotulo, usado, aviso, erro, wb }` |
| `classificar(wb)` | `'ifood'`, `'n99'`, `'conc'`, `'loja'`, `'custos'` ou `null` |
| `executar(entrada)` | Roda o ETL e devolve também `conferencias` (com `naoSeAplica`), `aplicaveis`, `problemas`, `resumoCanal`, `lidos` e `canais` (`{ iFood, 99Food }`: `{ pedidos, inicio, fim }` ou `null` quando o canal não veio na carga). Aceita um canal só; sem nenhum, lança erro |
| `executarETL(src)` | Jobs 0 a 7 (código da Etapa 5) |
| `juntar(lista)` | Junta as linhas de vários arquivos do mesmo tipo |
| `tabelaVendas(resumo)` | Tabela "Vendas por plataforma" |
| `formaPagamento(texto)` | Texto livre → categoria padronizada |
| `num(x)`, `r2(x)`, `ymd(d)`, `iso(d)`, `dIfood(s)`, `d99(s)` | Números, arredondamento e datas |
| `TIPOS`, `IGNORADOS`, `NOMES_TIPO`, `BRL`, `INT` | Constantes e formatadores |

## `BE.carga`

| Função | O que faz |
|---|---|
| `gravar(resultado, arquivos, { banco?, confirmar? })` → Promise | Upsert numa transação, registra a carga e salva; se alguma conferência falhou, pergunta antes. Devolve `ausentes`: `[{ canal, inicio, fim, noBanco }]` dos canais sem relatório na carga |
| `tabelasDoBanco(banco?)` | Tabelas do Data Mart lidas do banco, no formato da Etapa 5 |
| `exportarXlsx(banco?)` / `exportarCsvZip(banco?)` / `exportarLog(banco?)` → `{ blob, nome }` | Exportações |
| `ultimaCarga(banco)` | Última linha de `CARGA_ETL` |
| `conferenciasDoLog(log)` | Recupera as conferências gravadas no log |
| `baixar(blob, nome)` | Download comum |
| `csvCel(v)`, `linhaDoBanco(o, cab)`, `BOOLEANAS` | Apoio às exportações |

## `BE.metas`

| Função | O que faz |
|---|---|
| `criar(def, banco?)` / `atualizar(id, def, banco?)` → `{ id, modo, dias, nome }` | Valida, distribui e grava |
| `excluir(id, banco?)` | Apaga a meta (a `FATO_META` vai por cascata) |
| `duplicar(id, 'proximo-mes' \| 'proxima-semana', banco?)` | Copia para o período seguinte |
| `ajustarDia(id, data, { valor, qtd }, banco?)` | Ajusta um dia; o total passa a ser a soma dos dias |
| `listar(banco?)` / `obter(id, banco?)` | Resumo: status, realizado, atingimento, série acumulada e ritmo |
| `detalhe(id, banco?)` | Uma linha por dia elegível, com desvio e atingimento |
| `diasElegiveis(inicio, fim, diasSemana)` | Datas que contam |
| `validarDefinicao(def, banco?)`, `validarValores(v)`, `numero(v)` | Validação com mensagens em pt-BR |
| `repartir(total, pesos)` | Divide um inteiro sem perder unidades |
| `nomePadrao(inicio, fim)`, `linhaTempo(data)` | Nome "Meta dd/mm a dd/mm"; linha da `DIM_TEMPO` |
| `canais(banco?)`, `diasComVenda(banco?)`, `ultimoMesComDados(banco?)` | Apoio à tela |
| `hoje()` | Data local AAAA-MM-DD (substituível nos testes) |
| `datas.*` | `paraData`, `paraIso`, `somarDias`, `somarMeses`, `diferencaDias`, `diaSemana`, `ultimoDiaDoMes`, `MESES`, `DIAS` |

## `BE.backup`

| Função | O que faz |
|---|---|
| `fazerBackup({ banco? })` → `{ salvo, cancelado, modo, nome }` | "Salvar como" quando existe; senão download |
| `gerarZip(banco?)` / `gerarZipDeBytes(bytes, info)` → Promise\<Blob\> | Monta o zip com manifesto e LEIA-ME |
| `lerArquivo(file)` → `{ tipo, bytes, manifesto }` | Aceita `.zip` (confere o SHA-256) ou `.sqlite` |
| `previa(leitura, banco?)` | Contagens do arquivo e do banco atual; diz se migra ou se é mais novo |
| `lerResumo(bytes)` | Contagens de um banco sem abri-lo no portal |
| `situacao(banco?)` | Pedidos, concluídos, metas, cargas, período, última alteração |
| `precisaBackup(ultimoBackup, ultimaAlteracao, hoje)` | Regra do lembrete de 7 dias |
| `ultimoBackup()` / `registrarBackup(data?)` | `localStorage` `be.ultimoBackup` |
| `nomeArquivo(data?)`, `isoLocal(d)`, `sha256(bytes)`, `baixar(blob, nome)` | Apoio |
| `ARQ_SQLITE`, `ARQ_MANIFESTO`, `ARQ_LEIA`, `CHAVE_ULTIMO` | Nomes fixos |

## `BE.arquivoBanco` / `BE.criarArquivoBanco`

`BE.arquivoBanco = BE.criarArquivoBanco({ banco: BE.db })`. As opções da fábrica são `{ banco, atraso, armazenamento, disponivel, silencioso }`.

| Função | O que faz |
|---|---|
| `disponivel()` | A File System Access API existe (e não foi bloqueada) |
| `estado()` → `{ situacao, nome, salvoEm, motivo }` | `'nao-suportado'`, `'desvinculado'`, `'vinculado'` ou `'reconectar'` |
| `iniciar()` | Lê o handle guardado e sincroniza, sem pedir permissão |
| `vincularNovo(handle?)` | "Salvar como" `deliview.sqlite` e grava o banco atual |
| `vincularExistente({ handle?, escolher? })` | Abre um `.sqlite`, valida e pergunta qual cópia vale quando os dois lados têm dados |
| `reconectar()` | `requestPermission` (precisa de clique) e sincroniza |
| `desvincular()` | Esquece o arquivo; os dados ficam no navegador |
| `decidirOrigem({ arquivoModificado, ultimaGravacaoNavegador })` | `'arquivo'`, `'navegador'` ou `'iguais'` (tolerância de 2 s) |
| `precisaPerguntaInicial({ pedidos, metas, inicioEscolhido })` | Mostra a pergunta inicial? |
| `inicioEscolhido()` / `escolherInicioVazio()` | `localStorage` `be.inicioEscolhido` |
| `_aoSalvar`, `_esperar` | Internas (testes) |

## `BE.bancoInicial`

| Função | O que faz |
|---|---|
| `iniciar()` | Na abertura: sincroniza o arquivo vinculado e, com banco vazio, abre a pergunta |
| `abrirPergunta()` | Modal "Onde está o banco de dados?" |
| `escolherOrigem(info)` → Promise | Diálogo "Qual banco usar?" |
| `vincularExistente()` / `vincularNovo()` / `reconectar(botao?)` | Fluxos dos botões, com toasts |
| `textoArquivo(estado)` | Texto da segunda linha do indicador da sidebar |

## `BE.dash`

Objeto de filtros `f` (vazio = todos): `{ inicio: 'AAAA-MM-DD' | '', fim, canais: [], pagamentos: [], entregas: [], diasSemana: [1..7] }` (1 = segunda). Todas as consultas recebem `(f, banco?)`, agregam no banco (JOIN nas dimensões + GROUP BY) e passam os valores do filtro como parâmetros `?`. Venda = `DIM_STATUS.CONSIDERA_VENDA = 1`; cancelado = `STATUS = 'CANCELADO'`. Razão com divisor zero devolve `null` (a tela mostra "—").

**Filtros e utilitários** (`js/consultas/dashboard.js`)

| Função | O que faz |
|---|---|
| `filtrosPadrao(banco?)` | Último mês com pedidos; demais filtros vazios |
| `opcoesFiltros(banco?)` → `{ canais, pagamentos, entregas, diasSemana, periodo: { min, max } }` | Opções lidas das dimensões |
| `whereFiltros(f, extra?)` → `{ sql, params }` | Cláusula WHERE com parâmetros; `extra` são condições SQL fixas |
| `normalizar(f)` | Limpa um filtro vindo da URL, do `localStorage` ou da tela |
| `periodoAnterior(inicio, fim)` → `{ inicio, fim }` ou `null` | Período anterior de igual duração (meses inteiros → os mesmos meses antes) |
| `resumoFiltros(f)`, `textoPeriodo(inicio, fim)` | "agosto/2026 · iFood · Pix" |
| `comPeriodo(f, inicio, fim)`, `comCanais(f, canais)` | Cópias do filtro com interseção (foco do drill-down, cascata por canal) |
| `GRANULARIDADES`, `MESES`, `DIAS_CURTOS`, `DIAS_NOMES` | Rótulos |

**Painel principal**

| Função | Devolve |
|---|---|
| `kpis(f, banco?)` | `{ faturamento, pedidosConcluidos, ticketMedio, liquido, cancelados, taxaCancelamento, pedidos, periodo, periodoAnterior, anterior }` (`anterior` = os mesmos campos no período anterior, ou `null`) |
| `faturamentoDiarioPorCanal(f, banco?)` | `{ categorias: ['AAAA-MM-DD'], series: [{ nome, valores }] }`, dias sem venda = 0 |
| `cascata(f, banco?)` | `[{ rotulo, valor, tipo: 'total' \| 'reducao' }]` do bruto ao líquido (motoboy só se a coluna existir) |
| `cancelamentoPorCanal(f, banco?)` | `[{ canal, pedidos, cancelados, taxa }]` |
| `pedidosDiaSemanaPorSemana(f, banco?)` | `{ linhas: 7 dias, colunas: ['Sem 1'…], valores }` |
| `mixPagamentos(f, banco?)` | `[{ forma, pedidos, valor }]` |

**Seções detalhadas e drill-down**

| Função | Devolve |
|---|---|
| `serieTempo(f, 'dia' \| 'semana' \| 'mes', medida, { total? }, banco?)` | `{ granularidade, medida, categorias: [{ chave, inicio, fim }], series: [{ nome, valores, extras }] }`; medida = `faturamento`, `pedidos`, `ticket`, `retencao` ou `cancelados` |
| `pedidosPorDiaSemana(f, banco?)` | `{ categorias, series }` por canal |
| `mediaPorDiaSemana(f, banco?)` | `[{ dia, nome, pedidos, dias, media }]` (média por ocorrência do dia no calendário) |
| `fimDeSemanaVsUtil(f, banco?)` | `[{ grupo, fimDeSemana, pedidos, faturamento, ticketMedio, dias, pedidosPorDia }]` |
| `participacaoCanal(f, banco?)` | `[{ canal, pedidos, faturamento, partPedidos, partFaturamento }]` |
| `rentabilidadePorCanal(f, banco?)` | `[{ canal, pedidos, bruto, descontos, taxas, motoboy, liquido, sobraCem, retencao, pctDescontos, pctTaxas, pctMotoboy }]` |
| `cancelamentosPorDiaSemana(f, banco?)` | `{ linhas, colunas: canais, valores }` |
| `receitaPerdida(f, banco?)` | `{ total, cancelados, porCanal: [{ canal, cancelados, valor }] }` |
| `descontoPorCanal(f, banco?)` | `[{ canal, pedidos, comDesconto, descontos, descontoMedio, descontoMedioComDesconto }]` |
| `comSemDesconto(f, banco?)` | `{ com, sem, total, ticketCom, ticketSem }` (só concluídos) |
| `descontoVsTicket(f, banco?)` | `[{ id, canal, desconto, ticket }]` |
| `distribuicaoTicket(f, banco?)` | `[{ nome, n, media, min, q1, mediana, q3, max, limInf, limSup, fora }]` |
| `ticketPorPagamentoCanal(f, banco?)`, `pagamentoPorCanal(f, banco?)`, `motoboyPorEntregaCanal(f, banco?)` | `{ categorias, series }` (motoboy: `null` sem a coluna) |
| `metasNoPeriodo(f, banco?)` | Metas de `BE.metas.listar` em andamento ou encerradas que cruzam o período |
| `realizadoMensalVsMeta(f, banco?)` | `[{ mes, realizado, meta }]` |
| `pedidosDoDia(f, 'AAAA-MM-DD', banco?)` | `[{ id, canal, status, venda, pagamento, entrega, bruto, desconto, taxas, motoboy, totalPago, liquido }]` |
| `coberturaCanais(f, banco?)` | `{ soUmCanal, meses: [{ mes, faltando, presentes }] }`: meses do período com pedidos de um canal só (importação de uma plataforma). Ignora os filtros que não são de período e canal |
| `textosCobertura(cobertura, { curto? })` | Textos do aviso amarelo do Dashboard; `curto: true` é a versão de uma linha do cartão de meta |

**Exploração OLAP e insights**

| Função | O que faz |
|---|---|
| `matriz(f, linhas, colunas, medida, banco?)` | Pivot: `{ linhas: { dim, rotulo, itens }, colunas: { dim, rotulo, itens }, medida: { id, rotulo, formato, somavel }, valores, totaisLinha, totaisColuna, total, pedidos, vazio }`. Dimensões: `canal`, `pagamento`, `entrega`, `status`, `mes`, `semana`, `diaSemana` (colunas também `'nenhuma'`); medidas: `faturamento`, `pedidos`, `ticket`, `liquido`, `descontos`, `taxas`, `cancelados`, `taxaCancelamento`. Células e totais vêm de quatro GROUP BY (UNION ALL) |
| `DIMENSOES_MATRIZ`, `MEDIDAS_MATRIZ` | `[{ id, rotulo }]` e `[{ id, rotulo, formato, somavel }]` para os seletores |
| `filtrosAtivos(f)` (`olap.js`) | `[{ dim, rotulo, texto, valores }]`; o período conta como filtro |
| `operacoesOlap(f, { drill, roll, pivot }, banco?)` (`olap.js`) | `[{ operacao, aplicacao, pergunta, analise }]` para Slice, Dice, Drill-down, Roll-up e Pivot, com números do recorte |
| `olapMarkdown(linhas, titulo?)` (`olap.js`) | A tabela acima em Markdown |
| `nomeDimensaoMatriz(id)` (`olap.js`) | Rótulo de uma dimensão da matriz |
| `insights(f, banco?)` (`insights.js`) | `[{ id, tema, visualizacao, insight, decisao, alerta }]`: de 0 a 6 cartões por regras (`cancelamento`, `meta-risco`, `canal`, `retencao`, `dia-semana`, `desconto`) |
| `LIMITES_INSIGHTS` (`insights.js`) | `{ cancelamento: 15, dominante: 60, retencao: 10, ritmo: 1.5 }` |

## `BE.graficos`

Gráficos do Dashboard: viewBox na largura real do contêiner, `role="img"` com resumo, tooltip no mouse e no foco (`tabindex="0"`), botão "Ver dados" com a tabela dos mesmos valores e "Sem pedidos neste recorte" quando não há dados. `formato` = `'moeda'`, `'inteiro'`, `'percentual'` ou `function (v)`. iFood sempre floresta e 99Food sempre milho.

| Função | O que faz |
|---|---|
| `barras(el, { categorias, series, formato, titulo?, rotuloCategoria?, rotuloEixo?, interativo?, rotulos?, corPorCategoria?, referencia?, dica?, aoClicar?, rotuloTabela? })` | Barras agrupadas. Sem `interativo` (tela de Metas): tooltip nativo, sem "Ver dados" |
| `acumulado(el, serie, { hoje?, meta?, realizado?, formato, titulo?, largura? })` | Linhas de meta e realizado acumulados (mini gráfico das metas) |
| `linhas(el, { categorias, series, formato, titulo?, rotuloCategoria?, rotuloEixo?, rotuloTabela?, dica?, aoClicar? })` | Linhas com pontos focáveis |
| `cascata(el, { etapas: [{ rotulo, valor, tipo }], formato, titulo? })` | Cascata do bruto ao líquido |
| `rosca(el, { fatias: [{ rotulo, valor, cor? }], formato, centro?: { valor, rotulo }, titulo? })` | Rosca com o total no centro |
| `mapaCalor(el, { linhas, colunas, valores, formato, titulo?, rotuloTabela?, dicaClique?, aoClicar? })` | Escala sequencial de menta a floresta; `aoClicar(linha, coluna)` |
| `barrasEmpilhadas(el, { categorias, series, cem?, formato?, participacao?, titulo?, rotuloTabela? })` | Barras horizontais empilhadas; `cem: true` = 100% |
| `dispersao(el, { pontos: [{ x, y, serie, rotulo }], formatoX, formatoY, rotuloX, rotuloY, titulo?, rotuloTabela? })` | Um ponto por pedido, cor por canal |
| `boxplot(el, { grupos, formato, titulo? })` | Quartis, bigodes de 1,5 × IQR e pontos fora da curva |
| `progresso(el, { itens: [{ rotulo, valor, meta, detalhe?, status? }], formato, titulo?, vazio? })` | Barras de atingimento de meta |
| `redesenhar(raiz)` | Redesenha os gráficos cuja largura mudou |
| `marcasEixo(maximo)` | Marcas "redondas" do eixo Y |
| `corCanal(nome, i?)`, `corCalor(t)` | Cor fixa do canal; cor da escala do mapa de calor (`t` de 0 a 1) |
| `TEXTO_VAZIO` | "Sem pedidos neste recorte" |

## `BE.ui`

| Função | O que faz |
|---|---|
| `calendario(el, opcoes)` | Calendário de período. Devolve `periodo()`, `definirPeriodo()`, `definirDiasSemana()`, `definirDiasComVenda()`, `definirMesComDados()`, `mesVisivel()` e `irPara()` |
| `placeholder({ titulo, pergunta, grafico, medidas, observacao?, icone?, largo? })` | HTML de um bloco reservado (título, pergunta e chips), sem consultar dados |
| `placeholder.iconeDoGrafico(grafico)` | Ícone deduzido do tipo de gráfico |

## `BE.textos` e utilitários da casca

| Membro | O que faz |
|---|---|
| `BE.textos.avisoSeguranca` | Texto único do aviso de segurança |
| `BE.avisoSegurancaHtml()` | O aviso com "Manual" como link |
| `BE.iniciar()` | Monta menu, drawer e rotas; abre o banco (`BE.dbPronto`) |
| `BE.dbPronto` | Promise do `BE.db.abrir()` da abertura |
| `BE.telas.<rota>` | `{ titulo, render(el) }` de cada tela |
| `BE.escapar(texto)` | Escape de HTML |
| `BE.cabecalho(titulo, subtitulo?)`, `BE.estadoVazio(icone, titulo, texto?)`, `BE.tabelaHtml(cab, linhas, numericas?, opcoes?)` | HTML padrão das telas |
| `BE.toast(msg, tipo?)` | Aviso temporário: `'sucesso'`, `'erro'`, `'aviso'` ou `'info'` |
| `BE.formatarDataHora(iso, comAno?)`, `BE.formatarDataHoraCurta(iso)` | "dd/mm[/aaaa] hh:mm" |
| `BE.icone(nome, tamanho?)` | SVG inline do ícone |

## Eventos no `document`

| Evento | Quando | `detail` |
|---|---|---|
| `be:banco-alterado` | Depois de abrir e de cada `salvar()` do `BE.db` | `BE.db.resumo()` |
| `be:arquivo-banco` | A cada mudança de estado do arquivo vinculado | `BE.arquivoBanco.estado()` |
