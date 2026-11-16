/*
 * Consultas do Dashboard sobre o Data Mart (estrela de vendas).
 *
 * Objeto de filtros (vazio = todos):
 *   { inicio: 'AAAA-MM-DD' | '', fim: 'AAAA-MM-DD' | '',
 *     canais: ['iFood', ...], pagamentos: ['Pix', ...], entregas: [...], diasSemana: [1..7] }
 * Canais, pagamentos e entregas são filtrados pelo nome (chave natural da dimensão);
 * dias da semana pelo número da DIM_TEMPO (1 = segunda ... 7 = domingo).
 *
 *   BE.dash.filtrosPadrao(banco?)    último mês com pedidos, demais filtros vazios
 *   BE.dash.opcoesFiltros(banco?)    { canais, pagamentos, entregas, diasSemana, periodo: { min, max } }
 *   BE.dash.whereFiltros(f)          { sql, params }: cláusula WHERE com parâmetros "?"
 *
 * Painel principal (todas recebem f e, opcionalmente, o banco; padrão BE.db):
 *   kpis, faturamentoDiarioPorCanal, cascata, cancelamentoPorCanal,
 *   pedidosDiaSemanaPorSemana, mixPagamentos
 *
 * Seções detalhadas (mesma assinatura (f, banco?)):
 *   serieTempo(f, 'dia' | 'semana' | 'mes', medida, { total? })   roll-up e drill-down no tempo;
 *     medida = 'faturamento' | 'pedidos' | 'ticket' | 'retencao' | 'cancelados'
 *   pedidosPorDiaSemana, mediaPorDiaSemana, fimDeSemanaVsUtil, participacaoCanal, rentabilidadePorCanal,
 *   cancelamentosPorDiaSemana, receitaPerdida, descontoPorCanal, comSemDesconto, descontoVsTicket,
 *   distribuicaoTicket, ticketPorPagamentoCanal, pagamentoPorCanal, motoboyPorEntregaCanal,
 *   metasNoPeriodo, realizadoMensalVsMeta, pedidosDoDia(f, 'AAAA-MM-DD')
 *   comPeriodo(f, inicio, fim) e comCanais(f, canais): cópias do filtro com interseção
 *
 * Exploração OLAP:
 *   matriz(f, linhas, colunas, medida)   pivot com totais de linha, de coluna e geral
 *     dimensões: canal, pagamento, entrega, status, mes, semana, diaSemana (colunas: ou 'nenhuma')
 *     medidas: faturamento, pedidos, ticket, liquido, descontos, taxas, cancelados, taxaCancelamento
 *   operacoesOlap e olapMarkdown (js/consultas/olap.js) e insights (js/consultas/insights.js)
 *
 * Regras de negócio: venda = DIM_STATUS.CONSIDERA_VENDA = 1 (CONCLUIDO); cancelado =
 * DIM_STATUS.STATUS = 'CANCELADO'. Faturamento = SUM(VALOR_TOTAL_PAGO) das vendas.
 * Toda agregação é feita no banco (JOIN nas dimensões + GROUP BY). Divisão por zero = null.
 */
window.BE = window.BE || {};

(function (BE) {
  'use strict';

  /* Junção da fato com todas as dimensões usadas pelos filtros */
  var DE = 'FROM FATO_PEDIDO f ' +
    'JOIN DIM_TEMPO t ON t.ID_TEMPO = f.ID_TEMPO ' +
    'JOIN DIM_CANAL c ON c.ID_CANAL = f.ID_CANAL ' +
    'JOIN DIM_STATUS s ON s.ID_STATUS = f.ID_STATUS ' +
    'JOIN DIM_PAGAMENTO p ON p.ID_PAGAMENTO = f.ID_PAGAMENTO ' +
    'JOIN DIM_TIPO_ENTREGA e ON e.ID_TIPO_ENTREGA = f.ID_TIPO_ENTREGA ';

  var VENDA = 's.CONSIDERA_VENDA = 1';
  var CANCELADO = "s.STATUS = 'CANCELADO'";

  var DIAS_CURTOS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
  var DIAS_NOMES = ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo'];

  /* Semana do mês (1 a 6), com semanas de segunda a domingo, calculada pelos atributos
     DIA e DIA_SEMANA da DIM_TEMPO: ((DIA_SEMANA - DIA) mod 7) é o deslocamento do dia 1. */
  var SEMANA_DO_MES = '((t.DIA - 1 + (((t.DIA_SEMANA - t.DIA) % 7) + 7) % 7) / 7 + 1)';

  function bd(banco) { return banco || BE.db; }

  function r2(v) { return v == null ? null : Math.round(v * 100) / 100; }
  function r1(v) { return v == null ? null : Math.round(v * 10) / 10; }
  function divisao(a, b) { return b > 0 ? a / b : null; }

  function doisDigitos(n) { return (n < 10 ? '0' : '') + n; }
  function ehData(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); }

  function lista(v) {
    if (v == null || v === '') return [];
    return [].concat(v).filter(function (x) { return x !== '' && x != null; });
  }

  /* Normaliza um objeto de filtros vindo da tela, da URL ou do localStorage */
  function normalizar(f) {
    f = f || {};
    return {
      inicio: ehData(f.inicio) ? f.inicio : '',
      fim: ehData(f.fim) ? f.fim : '',
      canais: lista(f.canais).map(String),
      pagamentos: lista(f.pagamentos).map(String),
      entregas: lista(f.entregas).map(String),
      diasSemana: lista(f.diasSemana).map(Number).filter(function (d) { return d >= 1 && d <= 7; })
        .sort(function (a, b) { return a - b; })
    };
  }

  /* ---------- Datas (texto AAAA-MM-DD, sem fuso) ---------- */

  function paraData(iso) { return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))); }
  function paraIso(d) {
    return d.getUTCFullYear() + '-' + doisDigitos(d.getUTCMonth() + 1) + '-' + doisDigitos(d.getUTCDate());
  }
  function somarDias(iso, n) { return paraIso(new Date(paraData(iso).getTime() + n * 86400000)); }
  function diferencaDias(a, b) { return Math.round((paraData(b) - paraData(a)) / 86400000); }
  function ultimoDia(ano, mes) { return new Date(Date.UTC(ano, mes, 0)).getUTCDate(); }

  /* Período anterior de igual duração. Recorte de meses inteiros -> os mesmos meses antes. */
  function periodoAnterior(inicio, fim) {
    if (!ehData(inicio) || !ehData(fim) || fim < inicio) return null;
    var ai = +inicio.slice(0, 4), mi = +inicio.slice(5, 7);
    var af = +fim.slice(0, 4), mf = +fim.slice(5, 7);
    if (inicio.slice(8) === '01' && +fim.slice(8) === ultimoDia(af, mf)) {
      var meses = (af - ai) * 12 + (mf - mi) + 1;
      var ini = new Date(Date.UTC(ai, mi - 1 - meses, 1));
      return { inicio: paraIso(ini), fim: somarDias(inicio, -1) };
    }
    var dur = diferencaDias(inicio, fim) + 1;
    return { inicio: somarDias(inicio, -dur), fim: somarDias(inicio, -1) };
  }

  /* ---------- Filtros ---------- */

  function emLista(coluna, valores, params) {
    valores.forEach(function (v) { params.push(v); });
    return coluna + ' IN (' + valores.map(function () { return '?'; }).join(', ') + ')';
  }

  /*
   * WHERE com parâmetros: nenhum valor do filtro entra no texto do SQL.
   * extra: condições fixas (texto SQL sem valores do usuário) somadas com AND.
   */
  function whereFiltros(f, extra) {
    f = normalizar(f);
    var cond = [], params = [];
    if (f.inicio) { cond.push('t.DATA >= ?'); params.push(f.inicio); }
    if (f.fim) { cond.push('t.DATA <= ?'); params.push(f.fim); }
    if (f.canais.length) cond.push(emLista('c.NOME_CANAL', f.canais, params));
    if (f.pagamentos.length) cond.push(emLista('p.FORMA_PAGAMENTO', f.pagamentos, params));
    if (f.entregas.length) cond.push(emLista('e.TIPO_ENTREGA', f.entregas, params));
    if (f.diasSemana.length) cond.push(emLista('t.DIA_SEMANA', f.diasSemana, params));
    lista(extra).forEach(function (c) { cond.push(c); });
    return { sql: cond.length ? 'WHERE ' + cond.join(' AND ') : '', params: params };
  }

  function consultar(banco, sqlAntes, f, extra, sqlDepois) {
    var w = whereFiltros(f, extra);
    return bd(banco).consultar(sqlAntes + ' ' + DE + w.sql + ' ' + (sqlDepois || ''), w.params);
  }

  function ultimoMesComDados(banco) {
    var r = bd(banco).consultar('SELECT MAX(t.DATA) AS d FROM FATO_PEDIDO f JOIN DIM_TEMPO t ON t.ID_TEMPO = f.ID_TEMPO')[0];
    return r && r.d ? r.d.slice(0, 7) : null;
  }

  function filtrosPadrao(banco) {
    var f = normalizar({});
    var mes = ultimoMesComDados(banco);
    if (mes) {
      f.inicio = mes + '-01';
      f.fim = mes + '-' + doisDigitos(ultimoDia(+mes.slice(0, 4), +mes.slice(5, 7)));
    }
    return f;
  }

  function opcoesFiltros(banco) {
    var b = bd(banco);
    var periodo = b.consultar(
      'SELECT MIN(t.DATA) AS min, MAX(t.DATA) AS max FROM FATO_PEDIDO f JOIN DIM_TEMPO t ON t.ID_TEMPO = f.ID_TEMPO')[0];
    return {
      canais: b.consultar('SELECT NOME_CANAL AS n FROM DIM_CANAL ORDER BY ID_CANAL').map(function (r) { return r.n; }),
      pagamentos: b.consultar('SELECT FORMA_PAGAMENTO AS n FROM DIM_PAGAMENTO ORDER BY FORMA_PAGAMENTO').map(function (r) { return r.n; }),
      entregas: b.consultar('SELECT TIPO_ENTREGA AS n FROM DIM_TIPO_ENTREGA ORDER BY ID_TIPO_ENTREGA').map(function (r) { return r.n; }),
      diasSemana: DIAS_CURTOS.map(function (c, i) { return { valor: i + 1, curto: c, nome: DIAS_NOMES[i] }; }),
      periodo: { min: periodo ? periodo.min : null, max: periodo ? periodo.max : null }
    };
  }

  /* ---------- KPIs ---------- */

  function medidasKpi(banco, f) {
    var r = consultar(banco,
      'SELECT COUNT(*) AS pedidos, ' +
      'COALESCE(SUM(CASE WHEN ' + VENDA + ' THEN 1 ELSE 0 END), 0) AS concluidos, ' +
      'COALESCE(SUM(CASE WHEN ' + CANCELADO + ' THEN 1 ELSE 0 END), 0) AS cancelados, ' +
      'ROUND(COALESCE(SUM(CASE WHEN ' + VENDA + ' THEN f.VALOR_TOTAL_PAGO ELSE 0 END), 0), 2) AS faturamento, ' +
      'ROUND(COALESCE(SUM(CASE WHEN ' + VENDA + ' THEN f.VALOR_LIQUIDO ELSE 0 END), 0), 2) AS liquido',
      f)[0];
    return {
      faturamento: r.faturamento,
      pedidosConcluidos: r.concluidos,
      ticketMedio: r2(divisao(r.faturamento, r.concluidos)),
      liquido: r.liquido,
      cancelados: r.cancelados,
      taxaCancelamento: r1(divisao(r.cancelados * 100, r.pedidos)),
      pedidos: r.pedidos
    };
  }

  /* Medidas do recorte + as mesmas do período anterior de igual duração (null sem período) */
  function kpis(f, banco) {
    f = normalizar(f);
    var atual = medidasKpi(banco, f);
    var ant = periodoAnterior(f.inicio, f.fim);
    atual.periodo = { inicio: f.inicio, fim: f.fim };
    atual.periodoAnterior = ant;
    if (ant) {
      var fa = normalizar(f);
      fa.inicio = ant.inicio;
      fa.fim = ant.fim;
      atual.anterior = medidasKpi(banco, fa);
    } else {
      atual.anterior = null;
    }
    return atual;
  }

  /* ---------- Faturamento diário por canal ---------- */

  /*
   * { categorias: ['AAAA-MM-DD', ...], series: [{ nome, valores }] }
   * Os dias vêm da DIM_TEMPO (do 1º ao último dia do recorte, respeitando o filtro de dia da
   * semana), para que dias sem venda apareçam como zero.
   */
  function faturamentoDiarioPorCanal(f, banco) {
    f = normalizar(f);
    var b = bd(banco);
    var linhas = consultar(banco,
      'SELECT t.DATA AS data, c.NOME_CANAL AS canal, ROUND(SUM(f.VALOR_TOTAL_PAGO), 2) AS valor',
      f, VENDA, 'GROUP BY t.DATA, c.ID_CANAL ORDER BY t.DATA, c.ID_CANAL');
    if (!linhas.length) return { categorias: [], series: [] };

    var ini = f.inicio || linhas[0].data;
    var fim = f.fim || linhas[linhas.length - 1].data;
    var p = [ini, fim];
    var sqlDias = 'SELECT DATA AS d FROM DIM_TEMPO WHERE DATA >= ? AND DATA <= ?';
    if (f.diasSemana.length) sqlDias += ' AND ' + emLista('DIA_SEMANA', f.diasSemana, p);
    var categorias = b.consultar(sqlDias + ' ORDER BY DATA', p).map(function (r) { return r.d; });
    var indice = {};
    categorias.forEach(function (d, i) { indice[d] = i; });

    var canais = b.consultar('SELECT NOME_CANAL AS n FROM DIM_CANAL ORDER BY ID_CANAL').map(function (r) { return r.n; });
    var porCanal = {};
    linhas.forEach(function (l) {
      if (!porCanal[l.canal]) porCanal[l.canal] = categorias.map(function () { return 0; });
      if (indice[l.data] != null) porCanal[l.canal][indice[l.data]] = l.valor;
    });
    return {
      categorias: categorias,
      series: canais.filter(function (c) { return porCanal[c]; }).map(function (c) { return { nome: c, valores: porCanal[c] }; })
    };
  }

  /* ---------- Do bruto ao líquido ---------- */

  function temColuna(banco, tabela, coluna) {
    return bd(banco).consultar('SELECT name FROM pragma_table_info(?)', [tabela])
      .some(function (r) { return r.name === coluna; });
  }

  /*
   * Etapas da cascata, só pedidos concluídos:
   *   Valor bruto (total) -> descontos -> taxas -> motoboy (se a coluna existir) ->
   *   outros ajustes (diferença que fecha a conta, se houver) -> Líquido recebido (total)
   * tipo 'reducao' com valor positivo tira do acumulado; valor negativo soma.
   */
  function cascata(f, banco) {
    var motoboy = temColuna(banco, 'FATO_PEDIDO', 'TAXA_MOTOBOY');
    var r = consultar(banco,
      'SELECT COUNT(*) AS n, ' +
      'ROUND(COALESCE(SUM(f.VALOR_BRUTO_PEDIDO), 0), 2) AS bruto, ' +
      'ROUND(COALESCE(SUM(f.VALOR_DESCONTOS), 0), 2) AS descontos, ' +
      'ROUND(COALESCE(SUM(f.VALOR_TAXAS), 0), 2) AS taxas, ' +
      (motoboy ? 'ROUND(COALESCE(SUM(f.TAXA_MOTOBOY), 0), 2) AS motoboy, ' : '') +
      'ROUND(COALESCE(SUM(f.VALOR_LIQUIDO), 0), 2) AS liquido',
      f, VENDA)[0];
    if (!r.n) return [];
    var etapas = [
      { rotulo: 'Valor bruto', valor: r.bruto, tipo: 'total' },
      { rotulo: 'Descontos', valor: r.descontos, tipo: 'reducao' },
      { rotulo: 'Taxas e comissões', valor: r.taxas, tipo: 'reducao' }
    ];
    if (motoboy) etapas.push({ rotulo: 'Motoboy', valor: r.motoboy, tipo: 'reducao' });
    var ajuste = r2(r.bruto - r.descontos - r.taxas - (motoboy ? r.motoboy : 0) - r.liquido);
    if (Math.abs(ajuste) >= 0.01) etapas.push({ rotulo: 'Outros ajustes', valor: ajuste, tipo: 'reducao' });
    etapas.push({ rotulo: 'Líquido recebido', valor: r.liquido, tipo: 'total' });
    return etapas;
  }

  /* ---------- Cancelamento por canal ---------- */

  /* [{ canal, pedidos, cancelados, taxa }] (taxa em %, 1 casa; null sem pedidos) */
  function cancelamentoPorCanal(f, banco) {
    return consultar(banco,
      'SELECT c.NOME_CANAL AS canal, COUNT(*) AS pedidos, ' +
      'SUM(CASE WHEN ' + CANCELADO + ' THEN 1 ELSE 0 END) AS cancelados',
      f, null, 'GROUP BY c.ID_CANAL ORDER BY c.ID_CANAL')
      .map(function (r) {
        return { canal: r.canal, pedidos: r.pedidos, cancelados: r.cancelados, taxa: r1(divisao(r.cancelados * 100, r.pedidos)) };
      });
  }

  /* ---------- Pedidos por dia da semana × semana do mês ---------- */

  /*
   * { linhas: ['seg', ..., 'dom'], colunas: ['Sem 1', ...], valores: [7][n] } com pedidos
   * concluídos. Recortes de vários meses somam a mesma semana de cada mês.
   */
  function pedidosDiaSemanaPorSemana(f, banco) {
    var r = consultar(banco,
      'SELECT t.DIA_SEMANA AS dia, ' + SEMANA_DO_MES + ' AS semana, COUNT(*) AS n',
      f, VENDA, 'GROUP BY t.DIA_SEMANA, semana ORDER BY semana, t.DIA_SEMANA');
    if (!r.length) return { linhas: DIAS_CURTOS.slice(), colunas: [], valores: [] };
    var maxSemana = Math.max.apply(null, r.map(function (x) { return x.semana; }));
    var colunas = [];
    for (var s = 1; s <= maxSemana; s++) colunas.push('Sem ' + s);
    var valores = DIAS_CURTOS.map(function () { return colunas.map(function () { return 0; }); });
    r.forEach(function (x) { valores[x.dia - 1][x.semana - 1] = x.n; });
    return { linhas: DIAS_CURTOS.slice(), colunas: colunas, valores: valores };
  }

  /* ---------- Formas de pagamento ---------- */

  /* [{ forma, pedidos, valor }] dos pedidos concluídos, do mais usado ao menos usado */
  function mixPagamentos(f, banco) {
    return consultar(banco,
      'SELECT p.FORMA_PAGAMENTO AS forma, COUNT(*) AS pedidos, ROUND(SUM(f.VALOR_TOTAL_PAGO), 2) AS valor',
      f, VENDA, 'GROUP BY p.ID_PAGAMENTO ORDER BY pedidos DESC, forma');
  }


  /* =====================================================================
   * Seções detalhadas
   * ===================================================================== */

  function nomesCanais(banco) {
    return bd(banco).consultar('SELECT NOME_CANAL AS n FROM DIM_CANAL ORDER BY ID_CANAL').map(function (r) { return r.n; });
  }

  /*
   * Cobertura dos canais no período do filtro (cargas que trouxeram só uma plataforma).
   * Olha mês a mês os meses do período que têm algum pedido no banco. Canais esperados: os do
   * filtro, ou, sem filtro de canal, os que aparecem em algum pedido do banco.
   * Ignora os demais filtros: a pergunta é o que foi importado, não o que o recorte mostra.
   * -> { soUmCanal: nome | null, outros: [nomes], meses: [{ mes: 'AAAA-MM', faltando: [nomes], presentes: [nomes] }] }
   *    soUmCanal: o banco inteiro só tem pedidos de um canal (e o filtro não escolheu canal);
   *    outros: os canais da DIM_CANAL que não têm nenhum pedido.
   */
  function coberturaCanais(f, banco) {
    f = normalizar(f);
    var b = bd(banco);
    var noBanco = b.consultar('SELECT DISTINCT c.NOME_CANAL AS n FROM FATO_PEDIDO f JOIN DIM_CANAL c ON c.ID_CANAL = f.ID_CANAL ' +
      'ORDER BY c.ID_CANAL').map(function (r) { return r.n; });
    var saida = { soUmCanal: null, outros: [], meses: [] };
    if (!noBanco.length) return saida;
    var esperados = f.canais.length ? f.canais.slice() : noBanco;
    if (!f.canais.length && noBanco.length === 1) {
      var outros = nomesCanais(b).filter(function (c) { return c !== noBanco[0]; });
      if (outros.length) { saida.soUmCanal = noBanco[0]; saida.outros = outros; }
      return saida;
    }
    var cond = [], params = [];
    if (f.inicio) { cond.push('t.DATA >= ?'); params.push(f.inicio); }
    if (f.fim) { cond.push('t.DATA <= ?'); params.push(f.fim); }
    var linhas = b.consultar('SELECT substr(t.DATA, 1, 7) AS mes, c.NOME_CANAL AS canal ' +
      'FROM FATO_PEDIDO f JOIN DIM_TEMPO t ON t.ID_TEMPO = f.ID_TEMPO JOIN DIM_CANAL c ON c.ID_CANAL = f.ID_CANAL ' +
      (cond.length ? 'WHERE ' + cond.join(' AND ') + ' ' : '') + 'GROUP BY mes, canal ORDER BY mes', params);
    var porMes = {};
    linhas.forEach(function (l) { (porMes[l.mes] = porMes[l.mes] || []).push(l.canal); });
    Object.keys(porMes).sort().forEach(function (mes) {
      var presentes = porMes[mes];
      var faltando = esperados.filter(function (c) { return presentes.indexOf(c) < 0; });
      if (faltando.length) saida.meses.push({ mes: mes, faltando: faltando, presentes: presentes });
    });
    return saida;
  }

  /* "setembro/2026", "setembro e outubro/2026", "dezembro/2025 e janeiro/2026" */
  function listaMeses(meses) {
    var nomes = meses.map(function (m) { return MESES[+m.slice(5, 7) - 1] + '/' + m.slice(0, 4); });
    if (nomes.length === 1) return nomes[0];
    return nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1];
  }

  /*
   * Textos do aviso de cobertura, um por canal faltando (vazio quando está tudo coberto).
   * opcoes.curto: versão de uma linha para o cartão de meta.
   */
  function textosCobertura(cob, opcoes) {
    opcoes = opcoes || {};
    if (!cob) return [];
    if (cob.soUmCanal) {
      var outros = (cob.outros || []).join(' e ');
      return [opcoes.curto
        ? 'Só há pedidos do ' + cob.soUmCanal + ' no banco: o realizado não inclui o ' + outros + '.'
        : 'O banco só tem pedidos do ' + cob.soUmCanal + '. Se o restaurante também vende pelo ' + outros +
          ', importe o relatório dele na aba Importação: até lá, os totais incluem só o ' + cob.soUmCanal + '.'];
    }
    var porCanal = {};
    cob.meses.forEach(function (m) {
      m.faltando.forEach(function (c) { (porCanal[c] = porCanal[c] || []).push(m.mes); });
    });
    return Object.keys(porCanal).map(function (c) {
      var meses = listaMeses(porCanal[c]);
      var plural = porCanal[c].length > 1;
      if (opcoes.curto) return 'Sem pedidos do ' + c + ' no banco em ' + meses + ': o realizado pode estar incompleto.';
      return 'Não há pedidos do ' + c + ' no banco em ' + meses + '. Se houve vendas por ele ' + (plural ? 'nesses meses' : 'nesse mês') +
        ', importe o relatório na aba Importação: até lá, os números ' + (plural ? 'desses meses' : 'desse mês') + ' não incluem o ' + c + '.';
    });
  }

  /* Copia o filtro trocando o período pela interseção com [inicio, fim] (foco do drill-down) */
  function comPeriodo(f, inicio, fim) {
    var g = normalizar(f);
    if (inicio && (!g.inicio || inicio > g.inicio)) g.inicio = inicio;
    if (fim && (!g.fim || fim < g.fim)) g.fim = fim;
    return g;
  }

  /* Copia o filtro restringindo os canais (interseção com o filtro ativo) */
  function comCanais(f, canais) {
    var g = normalizar(f);
    if (!canais || !canais.length) return g;
    g.canais = g.canais.length ? g.canais.filter(function (c) { return canais.indexOf(c) >= 0; }) : canais.slice();
    if (!g.canais.length) g.canais = ['\u0000sem canal'];  /* interseção vazia: nenhum pedido */
    return g;
  }

  /* ---------- Séries no tempo: dia, semana (seg a dom) ou mês ---------- */

  var GRANULARIDADES = {
    dia: { rotulo: 'Dia', chave: function (a) { return a + 'DATA'; } },
    semana: { rotulo: 'Semana', chave: function (a) { return "DATE(" + a + "DATA, '-' || (" + a + "DIA_SEMANA - 1) || ' days')"; } },
    mes: { rotulo: 'Mês', chave: function (a) { return "printf('%04d-%02d', " + a + 'ANO, ' + a + 'MES)'; } }
  };

  /*
   * Medidas das séries: calculadas sobre os agregados do banco de cada período e canal.
   *   faturamento, pedidos (concluídos), ticket, retencao (% do bruto que fica com a plataforma),
   *   cancelados (com a taxa do período em extras)
   */
  var MEDIDAS_TEMPO = {
    faturamento: function (a) { return a.faturamento; },
    pedidos: function (a) { return a.concluidos; },
    ticket: function (a) { return r2(divisao(a.faturamento, a.concluidos)); },
    retencao: function (a) { return r1(divisao((a.bruto - a.liquido) * 100, a.bruto)); },
    cancelados: function (a) { return a.cancelados; }
  };
  var MEDIDAS_SOMAVEIS = { faturamento: true, pedidos: true, cancelados: true };

  /*
   * serieTempo(f, granularidade, medida, opcoes?) ->
   *   { granularidade, medida,
   *     categorias: [{ chave, inicio, fim }],      // períodos do calendário (DIM_TEMPO) no recorte
   *     series: [{ nome, valores, extras: [{ pedidos, concluidos, cancelados, faturamento, bruto, liquido, taxaCancelamento }] }] }
   * opcoes.total: true acrescenta a série "Todos os canais" (agregada no banco, sem separar canal).
   * Medidas somáveis valem 0 nos períodos sem pedidos; razões valem null (sem base).
   */
  function serieTempo(f, granularidade, medida, opcoes, banco) {
    f = normalizar(f);
    opcoes = opcoes || {};
    var gran = GRANULARIDADES[granularidade] ? granularidade : 'dia';
    var med = MEDIDAS_TEMPO[medida] ? medida : 'faturamento';
    var b = bd(banco);
    var chave = GRANULARIDADES[gran].chave('t.');
    var agregados = 'COUNT(*) AS pedidos, ' +
      'SUM(CASE WHEN ' + VENDA + ' THEN 1 ELSE 0 END) AS concluidos, ' +
      'SUM(CASE WHEN ' + CANCELADO + ' THEN 1 ELSE 0 END) AS cancelados, ' +
      'ROUND(SUM(CASE WHEN ' + VENDA + ' THEN f.VALOR_TOTAL_PAGO ELSE 0 END), 2) AS faturamento, ' +
      'ROUND(SUM(CASE WHEN ' + VENDA + ' THEN f.VALOR_BRUTO_PEDIDO ELSE 0 END), 2) AS bruto, ' +
      'ROUND(SUM(CASE WHEN ' + VENDA + ' THEN f.VALOR_LIQUIDO ELSE 0 END), 2) AS liquido';
    var w = whereFiltros(f);
    var sql = 'SELECT ' + chave + ' AS chave, c.NOME_CANAL AS canal, ' + agregados + ' ' + DE + w.sql +
      ' GROUP BY chave, c.ID_CANAL';
    var params = w.params.slice();
    if (opcoes.total) {
      sql += ' UNION ALL SELECT ' + chave + ' AS chave, NULL AS canal, ' + agregados + ' ' + DE + w.sql + ' GROUP BY chave';
      params = params.concat(w.params);
    }
    var linhas = b.consultar(sql + ' ORDER BY chave', params);
    if (!linhas.length) return { granularidade: gran, medida: med, categorias: [], series: [] };

    /* Períodos do calendário entre o primeiro e o último dia do recorte (com o filtro de dia da semana) */
    var datas = linhas.map(function (l) { return l.chave; });
    var limites = b.consultar('SELECT MIN(t.DATA) AS ini, MAX(t.DATA) AS fim ' + DE + w.sql, w.params)[0];
    var p = [f.inicio || limites.ini, f.fim || limites.fim];
    var sqlCat = 'SELECT ' + GRANULARIDADES[gran].chave('') + ' AS chave, MIN(DATA) AS inicio, MAX(DATA) AS fim ' +
      'FROM DIM_TEMPO WHERE DATA >= ? AND DATA <= ?';
    if (f.diasSemana.length) sqlCat += ' AND ' + emLista('DIA_SEMANA', f.diasSemana, p);
    var categorias = b.consultar(sqlCat + ' GROUP BY chave ORDER BY chave', p);
    if (!categorias.length) categorias = datas.map(function (d) { return { chave: d, inicio: d, fim: d }; });
    var indice = {};
    categorias.forEach(function (c, i) { indice[c.chave] = i; });

    var calc = MEDIDAS_TEMPO[med];
    var somavel = MEDIDAS_SOMAVEIS[med];
    var porSerie = {};
    linhas.forEach(function (l) {
      var nome = l.canal == null ? 'Todos os canais' : l.canal;
      if (!porSerie[nome]) {
        porSerie[nome] = {
          valores: categorias.map(function () { return somavel ? 0 : null; }),
          extras: categorias.map(function () { return null; })
        };
      }
      var i = indice[l.chave];
      if (i == null) return;
      l.taxaCancelamento = r1(divisao(l.cancelados * 100, l.pedidos));
      porSerie[nome].valores[i] = calc(l);
      porSerie[nome].extras[i] = l;
    });
    var ordem = nomesCanais(banco).concat(['Todos os canais']);
    return {
      granularidade: gran,
      medida: med,
      categorias: categorias,
      series: ordem.filter(function (n) { return porSerie[n]; }).map(function (n) {
        return { nome: n, valores: porSerie[n].valores, extras: porSerie[n].extras };
      })
    };
  }

  /* ---------- Vendas e faturamento ---------- */

  /* Pedidos concluídos por dia da semana (seg a dom) e canal: { categorias, series } */
  function pedidosPorDiaSemana(f, banco) {
    var r = consultar(banco, 'SELECT t.DIA_SEMANA AS dia, c.NOME_CANAL AS canal, COUNT(*) AS n',
      f, VENDA, 'GROUP BY t.DIA_SEMANA, c.ID_CANAL ORDER BY c.ID_CANAL, t.DIA_SEMANA');
    if (!r.length) return { categorias: DIAS_CURTOS.slice(), series: [] };
    var porCanal = {};
    r.forEach(function (x) {
      if (!porCanal[x.canal]) porCanal[x.canal] = [0, 0, 0, 0, 0, 0, 0];
      porCanal[x.canal][x.dia - 1] = x.n;
    });
    return {
      categorias: DIAS_CURTOS.slice(),
      series: nomesCanais(banco).filter(function (c) { return porCanal[c]; }).map(function (c) {
        return { nome: c, valores: porCanal[c] };
      })
    };
  }

  /*
   * Fim de semana × dia útil (FIM_DE_SEMANA da DIM_TEMPO):
   * [{ grupo, fimDeSemana, pedidos, faturamento, ticketMedio, dias, pedidosPorDia }]
   * "dias" conta os dias do calendário no recorte, para comparar a média por dia.
   */
  function fimDeSemanaVsUtil(f, banco) {
    f = normalizar(f);
    var r = consultar(banco,
      'SELECT t.FIM_DE_SEMANA AS fds, COUNT(*) AS pedidos, ROUND(SUM(f.VALOR_TOTAL_PAGO), 2) AS faturamento',
      f, VENDA, 'GROUP BY t.FIM_DE_SEMANA');
    if (!r.length) return [];
    var w = whereFiltros(f);
    var lim = bd(banco).consultar('SELECT MIN(t.DATA) AS ini, MAX(t.DATA) AS fim ' + DE + w.sql, w.params)[0];
    var p = [f.inicio || lim.ini, f.fim || lim.fim];
    var sqlDias = 'SELECT FIM_DE_SEMANA AS fds, COUNT(*) AS dias FROM DIM_TEMPO WHERE DATA >= ? AND DATA <= ?';
    if (f.diasSemana.length) sqlDias += ' AND ' + emLista('DIA_SEMANA', f.diasSemana, p);
    var dias = {};
    bd(banco).consultar(sqlDias + ' GROUP BY FIM_DE_SEMANA', p).forEach(function (x) { dias[x.fds] = x.dias; });
    var por = {};
    r.forEach(function (x) { por[x.fds] = x; });
    return [0, 1].filter(function (fds) { return dias[fds] || por[fds]; }).map(function (fds) {
      var x = por[fds] || { pedidos: 0, faturamento: 0 };
      return {
        grupo: fds ? 'Fim de semana' : 'Dias úteis',
        fimDeSemana: fds,
        pedidos: x.pedidos,
        faturamento: x.faturamento,
        ticketMedio: r2(divisao(x.faturamento, x.pedidos)),
        dias: dias[fds] || 0,
        pedidosPorDia: r1(divisao(x.pedidos, dias[fds] || 0))
      };
    });
  }

  /*
   * Média de pedidos concluídos por dia da semana: [{ dia, nome, pedidos, dias, media }]
   * "dias" conta as ocorrências de cada dia da semana no calendário do recorte (DIM_TEMPO),
   * para não favorecer o dia que aparece 5 vezes no mês. Só dias com ocorrência no recorte.
   */
  function mediaPorDiaSemana(f, banco) {
    f = normalizar(f);
    var r = consultar(banco, 'SELECT t.DIA_SEMANA AS dia, COUNT(*) AS pedidos', f, VENDA, 'GROUP BY t.DIA_SEMANA');
    if (!r.length) return [];
    var w = whereFiltros(f);
    var lim = bd(banco).consultar('SELECT MIN(t.DATA) AS ini, MAX(t.DATA) AS fim ' + DE + w.sql, w.params)[0];
    var p = [f.inicio || lim.ini, f.fim || lim.fim];
    var sqlDias = 'SELECT DIA_SEMANA AS dia, COUNT(*) AS dias FROM DIM_TEMPO WHERE DATA >= ? AND DATA <= ?';
    if (f.diasSemana.length) sqlDias += ' AND ' + emLista('DIA_SEMANA', f.diasSemana, p);
    var ped = {};
    r.forEach(function (x) { ped[x.dia] = x.pedidos; });
    return bd(banco).consultar(sqlDias + ' GROUP BY DIA_SEMANA ORDER BY DIA_SEMANA', p).map(function (x) {
      var n = ped[x.dia] || 0;
      return { dia: x.dia, nome: DIAS_NOMES[x.dia - 1], pedidos: n, dias: x.dias, media: r2(divisao(n, x.dias)) };
    });
  }

  /* Participação de cada canal: [{ canal, pedidos, faturamento, partPedidos, partFaturamento }] (%) */
  function participacaoCanal(f, banco) {
    var r = consultar(banco,
      'SELECT c.NOME_CANAL AS canal, COUNT(*) AS pedidos, ROUND(SUM(f.VALOR_TOTAL_PAGO), 2) AS faturamento',
      f, VENDA, 'GROUP BY c.ID_CANAL ORDER BY c.ID_CANAL');
    var totP = r.reduce(function (a, x) { return a + x.pedidos; }, 0);
    var totF = r.reduce(function (a, x) { return a + x.faturamento; }, 0);
    return r.map(function (x) {
      x.partPedidos = r1(divisao(x.pedidos * 100, totP));
      x.partFaturamento = r1(divisao(x.faturamento * 100, totF));
      return x;
    });
  }

  /* ---------- Rentabilidade por canal ---------- */

  /*
   * Só concluídos, por canal: [{ canal, pedidos, bruto, descontos, taxas, motoboy, liquido,
   *   sobraCem (líquido ÷ bruto × 100, em R$), retencao (% (bruto − líquido) ÷ bruto),
   *   pctDescontos, pctTaxas, pctMotoboy (% do bruto) }]
   * motoboy é null quando a coluna TAXA_MOTOBOY não existe.
   */
  function rentabilidadePorCanal(f, banco) {
    var motoboy = temColuna(banco, 'FATO_PEDIDO', 'TAXA_MOTOBOY');
    return consultar(banco,
      'SELECT c.NOME_CANAL AS canal, COUNT(*) AS pedidos, ' +
      'ROUND(SUM(f.VALOR_BRUTO_PEDIDO), 2) AS bruto, ROUND(SUM(f.VALOR_DESCONTOS), 2) AS descontos, ' +
      'ROUND(SUM(f.VALOR_TAXAS), 2) AS taxas, ' + (motoboy ? 'ROUND(SUM(f.TAXA_MOTOBOY), 2)' : 'NULL') + ' AS motoboy, ' +
      'ROUND(SUM(f.VALOR_LIQUIDO), 2) AS liquido',
      f, VENDA, 'GROUP BY c.ID_CANAL ORDER BY c.ID_CANAL')
      .map(function (x) {
        x.sobraCem = r2(divisao(x.liquido * 100, x.bruto));
        x.retencao = r1(divisao((x.bruto - x.liquido) * 100, x.bruto));
        x.pctDescontos = r1(divisao(x.descontos * 100, x.bruto));
        x.pctTaxas = r1(divisao(x.taxas * 100, x.bruto));
        x.pctMotoboy = x.motoboy == null ? null : r1(divisao(x.motoboy * 100, x.bruto));
        return x;
      });
  }

  /* ---------- Cancelamentos ---------- */

  /* Pedidos cancelados por dia da semana (linhas) e canal (colunas) */
  function cancelamentosPorDiaSemana(f, banco) {
    var r = consultar(banco, 'SELECT t.DIA_SEMANA AS dia, c.NOME_CANAL AS canal, COUNT(*) AS n',
      f, CANCELADO, 'GROUP BY t.DIA_SEMANA, c.ID_CANAL');
    if (!r.length) return { linhas: DIAS_CURTOS.slice(), colunas: [], valores: [] };
    var colunas = nomesCanais(banco).filter(function (c) { return r.some(function (x) { return x.canal === c; }); });
    var valores = DIAS_CURTOS.map(function () { return colunas.map(function () { return 0; }); });
    r.forEach(function (x) { valores[x.dia - 1][colunas.indexOf(x.canal)] = x.n; });
    return { linhas: DIAS_CURTOS.slice(), colunas: colunas, valores: valores };
  }

  /*
   * Receita perdida: VALOR_BRUTO_PEDIDO dos cancelados (a regra ZERA FATOS preserva só o bruto).
   * { total, cancelados, porCanal: [{ canal, cancelados, valor }] }
   */
  function receitaPerdida(f, banco) {
    var porCanal = consultar(banco,
      'SELECT c.NOME_CANAL AS canal, COUNT(*) AS cancelados, ROUND(SUM(f.VALOR_BRUTO_PEDIDO), 2) AS valor',
      f, CANCELADO, 'GROUP BY c.ID_CANAL ORDER BY c.ID_CANAL');
    var t = consultar(banco,
      'SELECT COUNT(*) AS cancelados, ROUND(COALESCE(SUM(f.VALOR_BRUTO_PEDIDO), 0), 2) AS total', f, CANCELADO)[0];
    return { total: t.total, cancelados: t.cancelados, porCanal: porCanal };
  }

  /* ---------- Descontos ---------- */

  /* Só concluídos, por canal: [{ canal, pedidos, comDesconto, descontos, descontoMedio, descontoMedioComDesconto }] */
  function descontoPorCanal(f, banco) {
    return consultar(banco,
      'SELECT c.NOME_CANAL AS canal, COUNT(*) AS pedidos, ' +
      'SUM(CASE WHEN f.VALOR_DESCONTOS > 0 THEN 1 ELSE 0 END) AS comDesconto, ' +
      'ROUND(SUM(f.VALOR_DESCONTOS), 2) AS descontos, ROUND(AVG(f.VALOR_DESCONTOS), 2) AS descontoMedio, ' +
      'ROUND(AVG(CASE WHEN f.VALOR_DESCONTOS > 0 THEN f.VALOR_DESCONTOS END), 2) AS descontoMedioComDesconto',
      f, VENDA, 'GROUP BY c.ID_CANAL ORDER BY c.ID_CANAL');
  }

  /*
   * Pedidos com × sem desconto. Regra: só pedidos CONCLUÍDOS, porque a regra ZERA FATOS zera o
   * desconto dos cancelados (contá-los como "sem desconto" seria um artefato da carga).
   * { com, sem, total, ticketCom, ticketSem }
   */
  function comSemDesconto(f, banco) {
    var r = consultar(banco,
      'SELECT COUNT(*) AS total, ' +
      'COALESCE(SUM(CASE WHEN f.VALOR_DESCONTOS > 0 THEN 1 ELSE 0 END), 0) AS com, ' +
      'COALESCE(SUM(CASE WHEN f.VALOR_DESCONTOS > 0 THEN 0 ELSE 1 END), 0) AS sem, ' +
      'ROUND(AVG(CASE WHEN f.VALOR_DESCONTOS > 0 THEN f.VALOR_TOTAL_PAGO END), 2) AS ticketCom, ' +
      'ROUND(AVG(CASE WHEN f.VALOR_DESCONTOS > 0 THEN NULL ELSE f.VALOR_TOTAL_PAGO END), 2) AS ticketSem',
      f, VENDA)[0];
    return { com: r.com, sem: r.sem, total: r.total, ticketCom: r.ticketCom, ticketSem: r.ticketSem };
  }

  /* Um ponto por pedido concluído: [{ id, canal, desconto, ticket }] (grão da fato) */
  function descontoVsTicket(f, banco) {
    return consultar(banco,
      'SELECT f.ID_PEDIDO AS id, c.NOME_CANAL AS canal, f.VALOR_DESCONTOS AS desconto, f.VALOR_TOTAL_PAGO AS ticket',
      f, VENDA, 'ORDER BY c.ID_CANAL, f.VALOR_DESCONTOS, f.ID_PEDIDO');
  }

  /* ---------- Ticket ---------- */

  /*
   * Distribuição do ticket (VALOR_TOTAL_PAGO dos concluídos) por canal, para o boxplot.
   * Quartis por interpolação linear calculados no banco (funções de janela); bigodes até o
   * último valor dentro de 1,5 × IQR (Tukey); o que passa disso vai em "fora".
   * [{ nome, n, media, min, q1, mediana, q3, max, limInf, limSup, fora: [{ id, valor }] }]
   */
  function distribuicaoTicket(f, banco) {
    var w = whereFiltros(f, VENDA);
    var base = 'WITH v AS (SELECT c.ID_CANAL AS idc, c.NOME_CANAL AS canal, f.ID_PEDIDO AS id, f.VALOR_TOTAL_PAGO AS valor, ' +
      'ROW_NUMBER() OVER (PARTITION BY c.ID_CANAL ORDER BY f.VALOR_TOTAL_PAGO) - 1 AS i, ' +
      'COUNT(*) OVER (PARTITION BY c.ID_CANAL) AS n ' + DE + w.sql + '), ' +
      'p(q) AS (VALUES (0), (0.25), (0.5), (0.75), (1)), ' +
      'pos AS (SELECT v.idc, v.canal, v.n, p.q, (v.n - 1) * p.q AS x FROM (SELECT DISTINCT idc, canal, n FROM v) v, p), ' +
      'quartis AS (SELECT pos.idc, pos.canal, pos.n, pos.q, ' +
      '  SUM(CASE WHEN v.i = CAST(pos.x AS INTEGER) THEN v.valor * (1 - (pos.x - CAST(pos.x AS INTEGER))) ' +
      '           WHEN v.i = CAST(pos.x AS INTEGER) + 1 THEN v.valor * (pos.x - CAST(pos.x AS INTEGER)) ELSE 0 END) AS valor ' +
      '  FROM pos JOIN v ON v.idc = pos.idc GROUP BY pos.idc, pos.q) ';
    var qs = bd(banco).consultar(base +
      'SELECT idc, canal, n, ' +
      'MAX(CASE WHEN q = 0 THEN valor END) AS min, MAX(CASE WHEN q = 0.25 THEN valor END) AS q1, ' +
      'MAX(CASE WHEN q = 0.5 THEN valor END) AS mediana, MAX(CASE WHEN q = 0.75 THEN valor END) AS q3, ' +
      'MAX(CASE WHEN q = 1 THEN valor END) AS max, ' +
      '(SELECT ROUND(AVG(valor), 2) FROM v WHERE v.idc = quartis.idc) AS media ' +
      'FROM quartis GROUP BY idc ORDER BY idc', w.params);
    var lim = bd(banco).consultar(base +
      ', cercas AS (SELECT idc, MAX(CASE WHEN q = 0.25 THEN valor END) AS q1, MAX(CASE WHEN q = 0.75 THEN valor END) AS q3 FROM quartis GROUP BY idc) ' +
      'SELECT v.idc, v.id, v.valor, ' +
      'CASE WHEN v.valor < cercas.q1 - 1.5 * (cercas.q3 - cercas.q1) - 1e-9 OR v.valor > cercas.q3 + 1.5 * (cercas.q3 - cercas.q1) + 1e-9 THEN 1 ELSE 0 END AS fora ' +
      'FROM v JOIN cercas ON cercas.idc = v.idc ORDER BY v.idc, v.valor', w.params);
    return qs.map(function (x) {
      var dentro = lim.filter(function (l) { return l.idc === x.idc && !l.fora; }).map(function (l) { return l.valor; });
      return {
        nome: x.canal, n: x.n, media: x.media,
        min: r2(x.min), q1: r2(x.q1), mediana: r2(x.mediana), q3: r2(x.q3), max: r2(x.max),
        limInf: r2(dentro.length ? dentro[0] : x.min), limSup: r2(dentro.length ? dentro[dentro.length - 1] : x.max),
        fora: lim.filter(function (l) { return l.idc === x.idc && l.fora; }).map(function (l) { return { id: l.id, valor: l.valor }; })
      };
    });
  }

  /* Ticket médio por forma de pagamento (categorias) e canal (séries) */
  function ticketPorPagamentoCanal(f, banco) {
    var r = consultar(banco,
      'SELECT p.FORMA_PAGAMENTO AS forma, c.NOME_CANAL AS canal, COUNT(*) AS pedidos, ROUND(SUM(f.VALOR_TOTAL_PAGO), 2) AS faturamento',
      f, VENDA, 'GROUP BY p.ID_PAGAMENTO, c.ID_CANAL ORDER BY p.FORMA_PAGAMENTO');
    return cruzar(r, 'forma', function (x) { return r2(divisao(x.faturamento, x.pedidos)); }, null, banco);
  }

  /* Monta { categorias, series: [{ nome: canal, valores, extras }] } a partir de linhas por categoria e canal */
  function cruzar(r, campoCategoria, valor, vazio, banco) {
    var categorias = [];
    r.forEach(function (x) { if (categorias.indexOf(x[campoCategoria]) < 0) categorias.push(x[campoCategoria]); });
    var por = {};
    r.forEach(function (x) {
      if (!por[x.canal]) por[x.canal] = { valores: categorias.map(function () { return vazio; }), extras: categorias.map(function () { return null; }) };
      var i = categorias.indexOf(x[campoCategoria]);
      por[x.canal].valores[i] = valor(x);
      por[x.canal].extras[i] = x;
    });
    return {
      categorias: categorias,
      series: nomesCanais(banco).filter(function (c) { return por[c]; }).map(function (c) {
        return { nome: c, valores: por[c].valores, extras: por[c].extras };
      })
    };
  }

  /* ---------- Pagamento e entrega ---------- */

  /* Pedidos concluídos por canal (categorias) e forma de pagamento (séries) */
  function pagamentoPorCanal(f, banco) {
    var r = consultar(banco, 'SELECT c.NOME_CANAL AS canal, p.FORMA_PAGAMENTO AS forma, COUNT(*) AS n',
      f, VENDA, 'GROUP BY c.ID_CANAL, p.ID_PAGAMENTO ORDER BY c.ID_CANAL, p.FORMA_PAGAMENTO');
    var canais = nomesCanais(banco).filter(function (c) { return r.some(function (x) { return x.canal === c; }); });
    var formas = [];
    r.forEach(function (x) { if (formas.indexOf(x.forma) < 0) formas.push(x.forma); });
    formas.sort();
    return {
      categorias: canais,
      series: formas.map(function (fo) {
        return { nome: fo, valores: canais.map(function (c) {
          var x = r.filter(function (y) { return y.canal === c && y.forma === fo; })[0];
          return x ? x.n : 0;
        }) };
      })
    };
  }

  /*
   * Custo de motoboy por pedido concluído, por tipo de entrega (categorias) e canal (séries).
   * null quando a coluna TAXA_MOTOBOY não existe no banco.
   */
  function motoboyPorEntregaCanal(f, banco) {
    if (!temColuna(banco, 'FATO_PEDIDO', 'TAXA_MOTOBOY')) return null;
    var r = consultar(banco,
      'SELECT e.TIPO_ENTREGA AS entrega, c.NOME_CANAL AS canal, COUNT(*) AS pedidos, ROUND(SUM(f.TAXA_MOTOBOY), 2) AS motoboy',
      f, VENDA, 'GROUP BY e.ID_TIPO_ENTREGA, c.ID_CANAL ORDER BY e.ID_TIPO_ENTREGA');
    return cruzar(r, 'entrega', function (x) { return r2(divisao(x.motoboy, x.pedidos)); }, null, banco);
  }

  /* ---------- Metas × realizado ---------- */

  /* Metas em andamento ou encerradas (BE.metas) cujo período cruza o recorte */
  function metasNoPeriodo(f, banco) {
    f = normalizar(f);
    return BE.metas.listar(bd(banco)).filter(function (m) {
      return m.status !== 'futura' && (!f.fim || m.inicio <= f.fim) && (!f.inicio || m.fim >= f.inicio);
    });
  }

  /*
   * Realizado (faturamento dos concluídos, com os filtros) × meta (FATO_META) por mês.
   * Meta somada nos dias do recorte (período e dias da semana). Canal: com exatamente um canal
   * no filtro, as metas desse canal; senão, as metas da loja toda (sem canal).
   * [{ mes: 'AAAA-MM', realizado, meta }]
   */
  function realizadoMensalVsMeta(f, banco) {
    f = normalizar(f);
    var real = consultar(banco,
      "SELECT printf('%04d-%02d', t.ANO, t.MES) AS mes, ROUND(SUM(f.VALOR_TOTAL_PAGO), 2) AS valor",
      f, VENDA, 'GROUP BY mes');
    var cond = [], p = [];
    if (f.inicio) { cond.push('t.DATA >= ?'); p.push(f.inicio); }
    if (f.fim) { cond.push('t.DATA <= ?'); p.push(f.fim); }
    if (f.diasSemana.length) cond.push(emLista('t.DIA_SEMANA', f.diasSemana, p));
    if (f.canais.length === 1) {
      cond.push('m.ID_CANAL = (SELECT ID_CANAL FROM DIM_CANAL WHERE NOME_CANAL = ?)');
      p.push(f.canais[0]);
    } else {
      cond.push('m.ID_CANAL IS NULL');
    }
    var meta = bd(banco).consultar(
      "SELECT printf('%04d-%02d', t.ANO, t.MES) AS mes, ROUND(SUM(fm.META_VALOR), 2) AS valor " +
      'FROM FATO_META fm JOIN META_DEFINICAO m ON m.ID_META = fm.ID_META JOIN DIM_TEMPO t ON t.ID_TEMPO = fm.ID_TEMPO ' +
      'WHERE ' + cond.join(' AND ') + ' GROUP BY mes', p);
    var meses = {};
    real.forEach(function (x) { meses[x.mes] = { mes: x.mes, realizado: x.valor, meta: null }; });
    meta.forEach(function (x) {
      if (!meses[x.mes]) meses[x.mes] = { mes: x.mes, realizado: 0, meta: null };
      meses[x.mes].meta = x.valor;
    });
    return Object.keys(meses).sort().map(function (k) { return meses[k]; });
  }

  /* ---------- Drill-down: pedidos de um dia ---------- */

  /*
   * Pedidos de um dia (todos os status) com os demais filtros ativos:
   * [{ id, canal, status, venda, pagamento, entrega, bruto, desconto, taxas, motoboy, totalPago, liquido }]
   */
  function pedidosDoDia(f, data, banco) {
    if (!ehData(data)) return [];
    var g = normalizar(f);
    g.inicio = data;
    g.fim = data;
    return consultar(banco,
      'SELECT f.ID_PEDIDO AS id, c.NOME_CANAL AS canal, s.STATUS AS status, s.CONSIDERA_VENDA AS venda, ' +
      'p.FORMA_PAGAMENTO AS pagamento, e.TIPO_ENTREGA AS entrega, f.VALOR_BRUTO_PEDIDO AS bruto, ' +
      'f.VALOR_DESCONTOS AS desconto, f.VALOR_TAXAS AS taxas, f.TAXA_MOTOBOY AS motoboy, ' +
      'f.VALOR_TOTAL_PAGO AS totalPago, f.VALOR_LIQUIDO AS liquido',
      g, null, 'ORDER BY c.ID_CANAL, s.CONSIDERA_VENDA DESC, f.ID_PEDIDO');
  }

  /* =====================================================================
   * Matriz (pivot): qualquer dimensão × qualquer dimensão × uma medida
   * ===================================================================== */

  /* Dimensões da matriz: expressão SQL do membro, ordem de exibição e rótulo de cada membro */
  var DIMENSOES = {
    canal: { rotulo: 'Canal', membro: 'c.NOME_CANAL', ordem: 'c.ID_CANAL' },
    pagamento: { rotulo: 'Forma de pagamento', membro: 'p.FORMA_PAGAMENTO', ordem: 'p.FORMA_PAGAMENTO' },
    entrega: { rotulo: 'Tipo de entrega', membro: 'e.TIPO_ENTREGA', ordem: 'e.ID_TIPO_ENTREGA' },
    status: { rotulo: 'Status', membro: 's.STATUS', ordem: 's.ID_STATUS' },
    mes: { rotulo: 'Mês', membro: "printf('%04d-%02d', t.ANO, t.MES)", ordem: "printf('%04d-%02d', t.ANO, t.MES)",
      nome: function (k) { return MESES[+k.slice(5, 7) - 1] + '/' + k.slice(0, 4); } },
    semana: { rotulo: 'Semana', membro: GRANULARIDADES.semana.chave('t.'), ordem: GRANULARIDADES.semana.chave('t.'),
      nome: function (k) { return k.slice(8, 10) + '/' + k.slice(5, 7) + ' a ' + ddmm(somarDias(k, 6)); } },
    diaSemana: { rotulo: 'Dia da semana', membro: 't.DIA_SEMANA', ordem: 't.DIA_SEMANA',
      nome: function (k) { return DIAS_NOMES[k - 1]; } }
  };

  /* Medidas da matriz, calculadas sobre os agregados do banco de cada célula e de cada total */
  var MEDIDAS_MATRIZ = {
    faturamento: { rotulo: 'Faturamento', formato: 'moeda', somavel: true, calc: function (a) { return a.faturamento; } },
    pedidos: { rotulo: 'Pedidos concluídos', formato: 'inteiro', somavel: true, calc: function (a) { return a.concluidos; } },
    ticket: { rotulo: 'Ticket médio', formato: 'moeda', calc: function (a) { return r2(divisao(a.faturamento, a.concluidos)); } },
    liquido: { rotulo: 'Líquido recebido', formato: 'moeda', somavel: true, calc: function (a) { return a.liquido; } },
    descontos: { rotulo: 'Descontos', formato: 'moeda', somavel: true, calc: function (a) { return a.descontos; } },
    taxas: { rotulo: 'Taxas e comissões', formato: 'moeda', somavel: true, calc: function (a) { return a.taxas; } },
    cancelados: { rotulo: 'Pedidos cancelados', formato: 'inteiro', somavel: true, calc: function (a) { return a.cancelados; } },
    taxaCancelamento: { rotulo: 'Taxa de cancelamento', formato: 'percentual',
      calc: function (a) { return r1(divisao(a.cancelados * 100, a.pedidos)); } }
  };

  function ddmm(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }

  /*
   * matriz(f, linhas, colunas, medida) -> {
   *   linhas: { dim, rotulo, itens: [{ chave, rotulo }] },
   *   colunas: { dim | null, rotulo, itens },        // colunas null ou 'nenhuma' = só o total da linha
   *   medida: { id, rotulo, formato, somavel },
   *   valores: [linha][coluna], totaisLinha: [..], totaisColuna: [..], total, vazio }
   * Células, totais de linha, totais de coluna e total geral vêm de quatro GROUP BY no banco
   * (UNION ALL), então medidas não somáveis (ticket, taxa) têm totais corretos. Célula sem
   * pedidos: 0 nas medidas somáveis, null nas razões.
   */
  function matriz(f, linhas, colunas, medida, banco) {
    var dl = DIMENSOES[linhas] ? linhas : 'canal';
    var dc = DIMENSOES[colunas] && colunas !== dl ? colunas : null;
    var med = MEDIDAS_MATRIZ[medida] ? medida : 'faturamento';
    var L = DIMENSOES[dl], C = dc ? DIMENSOES[dc] : null, M = MEDIDAS_MATRIZ[med];
    var agregados = 'COUNT(*) AS pedidos, ' +
      'COALESCE(SUM(CASE WHEN ' + VENDA + ' THEN 1 ELSE 0 END), 0) AS concluidos, ' +
      'COALESCE(SUM(CASE WHEN ' + CANCELADO + ' THEN 1 ELSE 0 END), 0) AS cancelados, ' +
      'ROUND(COALESCE(SUM(CASE WHEN ' + VENDA + ' THEN f.VALOR_TOTAL_PAGO ELSE 0 END), 0), 2) AS faturamento, ' +
      'ROUND(COALESCE(SUM(CASE WHEN ' + VENDA + ' THEN f.VALOR_LIQUIDO ELSE 0 END), 0), 2) AS liquido, ' +
      'ROUND(COALESCE(SUM(CASE WHEN ' + VENDA + ' THEN f.VALOR_DESCONTOS ELSE 0 END), 0), 2) AS descontos, ' +
      'ROUND(COALESCE(SUM(CASE WHEN ' + VENDA + ' THEN f.VALOR_TAXAS ELSE 0 END), 0), 2) AS taxas';
    var w = whereFiltros(f);
    var partes = [], params = [];
    function nivel(n, comL, comC) {
      partes.push('SELECT ' + n + ' AS nivel, ' +
        (comL ? L.membro + ' AS l, MIN(' + L.ordem + ') AS ol' : 'NULL AS l, NULL AS ol') + ', ' +
        (comC ? C.membro + ' AS c, MIN(' + C.ordem + ') AS oc' : 'NULL AS c, NULL AS oc') + ', ' +
        agregados + ' ' + DE + w.sql +
        (comL || comC ? ' GROUP BY ' + [comL ? 'l' : null, comC ? 'c' : null].filter(Boolean).join(', ') : ''));
      params = params.concat(w.params);
    }
    if (C) nivel(1, true, true);
    nivel(2, true, false);
    if (C) nivel(3, false, true);
    nivel(4, false, false);
    var r = bd(banco).consultar(partes.join(' UNION ALL '), params);

    function itens(campo, ordem, dim) {
      return r.filter(function (x) { return x.nivel === (campo === 'l' ? 2 : 3); })
        .sort(function (a, b) { return a[ordem] < b[ordem] ? -1 : a[ordem] > b[ordem] ? 1 : 0; })
        .map(function (x) { return { chave: x[campo], rotulo: dim.nome ? dim.nome(x[campo]) : String(x[campo]) }; });
    }
    var il = itens('l', 'ol', L);
    var ic = C ? itens('c', 'oc', C) : [];
    var vazioCel = M.somavel ? 0 : null;
    var idxL = {}, idxC = {};
    il.forEach(function (x, i) { idxL[x.chave] = i; });
    ic.forEach(function (x, j) { idxC[x.chave] = j; });
    var valores = il.map(function () { return ic.map(function () { return vazioCel; }); });
    var totaisLinha = il.map(function () { return vazioCel; });
    var totaisColuna = ic.map(function () { return vazioCel; });
    var total = vazioCel, pedidos = 0;
    r.forEach(function (x) {
      var v = M.calc(x);
      if (x.nivel === 1) valores[idxL[x.l]][idxC[x.c]] = v;
      else if (x.nivel === 2) totaisLinha[idxL[x.l]] = v;
      else if (x.nivel === 3) totaisColuna[idxC[x.c]] = v;
      else { total = x.pedidos ? v : vazioCel; pedidos = x.pedidos; }
    });
    return {
      linhas: { dim: dl, rotulo: L.rotulo, itens: il },
      colunas: { dim: dc, rotulo: C ? C.rotulo : '', itens: ic },
      medida: { id: med, rotulo: M.rotulo, formato: M.formato, somavel: !!M.somavel },
      valores: valores, totaisLinha: totaisLinha, totaisColuna: totaisColuna, total: total,
      pedidos: pedidos, vazio: !pedidos
    };
  }

  /* ---------- Resumo legível do recorte ---------- */

  var MESES =['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  function ddmmaaaa(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4); }

  function textoPeriodo(inicio, fim) {
    if (!inicio && !fim) return 'Todo o período';
    if (inicio && fim) {
      var mesInteiro = inicio.slice(8) === '01' &&
        +fim.slice(8) === ultimoDia(+fim.slice(0, 4), +fim.slice(5, 7));
      if (mesInteiro && inicio.slice(0, 7) === fim.slice(0, 7)) {
        return MESES[+inicio.slice(5, 7) - 1] + '/' + inicio.slice(0, 4);
      }
      if (mesInteiro) {
        return MESES[+inicio.slice(5, 7) - 1] + '/' + inicio.slice(0, 4) + ' a ' +
          MESES[+fim.slice(5, 7) - 1] + '/' + fim.slice(0, 4);
      }
      if (inicio === fim) return ddmmaaaa(inicio);
      return ddmmaaaa(inicio) + ' a ' + ddmmaaaa(fim);
    }
    return inicio ? 'A partir de ' + ddmmaaaa(inicio) : 'Até ' + ddmmaaaa(fim);
  }

  /* "agosto/2026 · iFood · Pix" */
  function resumoFiltros(f) {
    f = normalizar(f);
    var partes = [textoPeriodo(f.inicio, f.fim)];
    if (f.canais.length) partes.push(f.canais.join(', '));
    if (f.pagamentos.length) partes.push(f.pagamentos.join(', '));
    if (f.entregas.length) partes.push(f.entregas.join(', '));
    if (f.diasSemana.length) partes.push(f.diasSemana.map(function (d) { return DIAS_CURTOS[d - 1]; }).join(', '));
    return partes.join(' · ');
  }

  BE.dash = {
    filtrosPadrao: filtrosPadrao,
    opcoesFiltros: opcoesFiltros,
    whereFiltros: whereFiltros,
    normalizar: normalizar,
    periodoAnterior: periodoAnterior,
    resumoFiltros: resumoFiltros,
    textoPeriodo: textoPeriodo,
    kpis: kpis,
    faturamentoDiarioPorCanal: faturamentoDiarioPorCanal,
    cascata: cascata,
    cancelamentoPorCanal: cancelamentoPorCanal,
    pedidosDiaSemanaPorSemana: pedidosDiaSemanaPorSemana,
    mixPagamentos: mixPagamentos,
    comPeriodo: comPeriodo,
    comCanais: comCanais,
    serieTempo: serieTempo,
    GRANULARIDADES: { dia: 'Dia', semana: 'Semana', mes: 'Mês' },
    pedidosPorDiaSemana: pedidosPorDiaSemana,
    fimDeSemanaVsUtil: fimDeSemanaVsUtil,
    mediaPorDiaSemana: mediaPorDiaSemana,
    participacaoCanal: participacaoCanal,
    rentabilidadePorCanal: rentabilidadePorCanal,
    cancelamentosPorDiaSemana: cancelamentosPorDiaSemana,
    receitaPerdida: receitaPerdida,
    descontoPorCanal: descontoPorCanal,
    comSemDesconto: comSemDesconto,
    descontoVsTicket: descontoVsTicket,
    distribuicaoTicket: distribuicaoTicket,
    ticketPorPagamentoCanal: ticketPorPagamentoCanal,
    pagamentoPorCanal: pagamentoPorCanal,
    motoboyPorEntregaCanal: motoboyPorEntregaCanal,
    metasNoPeriodo: metasNoPeriodo,
    realizadoMensalVsMeta: realizadoMensalVsMeta,
    pedidosDoDia: pedidosDoDia,
    coberturaCanais: coberturaCanais,
    textosCobertura: textosCobertura,
    matriz: matriz,
    DIMENSOES_MATRIZ: Object.keys(DIMENSOES).map(function (k) { return { id: k, rotulo: DIMENSOES[k].rotulo }; }),
    MEDIDAS_MATRIZ: Object.keys(MEDIDAS_MATRIZ).map(function (k) {
      return { id: k, rotulo: MEDIDAS_MATRIZ[k].rotulo, formato: MEDIDAS_MATRIZ[k].formato, somavel: !!MEDIDAS_MATRIZ[k].somavel };
    }),
    MESES: MESES,
    DIAS_CURTOS: DIAS_CURTOS,
    DIAS_NOMES: DIAS_NOMES
  };
})(window.BE);
