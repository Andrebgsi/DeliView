/*
 * Operações OLAP do recorte: monta, por regras, a tabela "Operação | Aplicação | Pergunta |
 * Análise" a partir do estado atual do Dashboard. Todo número vem de BE.dash (banco).
 *
 *   BE.dash.filtrosAtivos(f)                     [{ dim, rotulo, texto, valores }] (período conta como filtro)
 *   BE.dash.operacoesOlap(f, estado, banco?)     [{ operacao, aplicacao, pergunta, analise }] (Slice, Dice,
 *                                                Drill-down, Roll-up, Pivot)
 *     estado = {
 *       drill: { de, para, alvo, inicio, fim, gran, medida, data } | null,   última descida
 *       roll:  { de, para, alvo, inicio, fim, gran, medida } | null,         última subida
 *       pivot: { linhas, colunas, medida, invertida } | null                 configuração da matriz
 *     }
 *     de/para: rótulos ('Mês', 'Dia', 'Pedido'); gran: granularidade de destino ('dia' | 'semana' | 'mes');
 *     data: dia aberto na lista de pedidos (descida Dia → Pedido).
 *   BE.dash.olapMarkdown(linhas, titulo?)        tabela em Markdown (para a documentação)
 */
window.BE = window.BE || {};

(function (BE) {
  'use strict';

  var BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  var PCT = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  function fmt(v, formato) {
    if (v == null || !isFinite(v)) return '—';
    if (formato === 'moeda') return BRL.format(v);
    if (formato === 'percentual') return PCT.format(v) + '%';
    return INT.format(v);
  }
  function pct(parte, total) { return total > 0 ? PCT.format(parte / total * 100) + '%' : '—'; }
  function ddmm(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }
  function ddmmaaaa(iso) { return ddmm(iso) + '/' + iso.slice(0, 4); }

  var GRUPOS = [
    { dim: 'canais', rotulo: 'Canal' },
    { dim: 'pagamentos', rotulo: 'Forma de pagamento' },
    { dim: 'entregas', rotulo: 'Tipo de entrega' },
    { dim: 'diasSemana', rotulo: 'Dia da semana' }
  ];

  /* Filtros ativos do recorte, na ordem da barra de filtros; o período é um deles */
  function filtrosAtivos(f) {
    f = BE.dash.normalizar(f);
    var ativos = [];
    if (f.inicio || f.fim) ativos.push({ dim: 'periodo', rotulo: 'Período', texto: BE.dash.textoPeriodo(f.inicio, f.fim), valores: [1] });
    GRUPOS.forEach(function (g) {
      if (!f[g.dim].length) return;
      var nomes = g.dim === 'diasSemana' ? f[g.dim].map(function (d) { return BE.dash.DIAS_NOMES[d - 1]; }) : f[g.dim];
      ativos.push({ dim: g.dim, rotulo: g.rotulo, texto: nomes.join(', '), valores: f[g.dim].slice() });
    });
    return ativos;
  }

  /* Cópia do filtro sem uma dimensão (base de comparação do slice) */
  function semDimensao(f, dim) {
    var g = BE.dash.normalizar(f);
    if (dim === 'periodo') { g.inicio = ''; g.fim = ''; } else g[dim] = [];
    return g;
  }

  /* Cópia do filtro só com o período (base de comparação do dice) */
  function soPeriodo(f) {
    var g = BE.dash.normalizar(f);
    return BE.dash.normalizar({ inicio: g.inicio, fim: g.fim });
  }

  function emPeriodo(f) {
    var t = BE.dash.textoPeriodo(f.inicio, f.fim);
    if (t === 'Todo o período') return 'Em todo o período';
    if (/^(A partir|Até)/.test(t)) return t;
    return (/^\d/.test(t) ? 'De ' : 'Em ') + t;
  }

  /* ---------- Slice e Dice ---------- */

  function slice(f, banco) {
    var ativos = filtrosAtivos(f);
    var linha = { operacao: 'Slice' };
    if (!ativos.length) {
      linha.aplicacao = 'Nenhum filtro';
      linha.pergunta = 'Qual o recorte de uma única dimensão? Escolha um período, canal, pagamento, entrega ou dia.';
      linha.analise = 'Sem fatia: os números valem para todo o cubo de vendas.';
      return linha;
    }
    if (ativos.length > 1 || ativos[0].valores.length > 1) {
      linha.aplicacao = 'Nenhum filtro único (' + ativos.length + (ativos.length === 1 ? ' filtro com vários valores' : ' filtros ativos') + ': veja Dice)';
      linha.pergunta = 'Qual o recorte de uma única dimensão?';
      linha.analise = 'O recorte atual combina filtros; a análise está na linha Dice.';
      return linha;
    }
    var a = ativos[0];
    var k = BE.dash.kpis(f, banco);
    linha.aplicacao = a.rotulo + ' = ' + a.texto;
    if (a.dim === 'periodo') {
      linha.pergunta = 'Como foram as vendas em ' + a.texto + ' e qual canal puxou o resultado?';
      var part = BE.dash.participacaoCanal(f, banco);
      if (!k.pedidosConcluidos) { linha.analise = emPeriodo(f) + ', não há pedidos concluídos.'; return linha; }
      var dom = part.slice().sort(function (x, y) { return y.pedidos - x.pedidos; })[0];
      linha.analise = emPeriodo(f) + ', o ' + dom.canal + ' fez ' + fmt(dom.partPedidos, 'percentual') +
        ' dos pedidos concluídos (' + INT.format(dom.pedidos) + ' de ' + INT.format(k.pedidosConcluidos) + '); o faturamento foi de ' +
        BRL.format(k.faturamento) + ', com ticket médio de ' + fmt(k.ticketMedio, 'moeda') + '.';
      return linha;
    }
    var base = BE.dash.kpis(semDimensao(f, a.dim), banco);
    linha.pergunta = 'Qual o peso de ' + a.texto + ' nas vendas?';
    linha.analise = 'Em todo o período, ' + a.texto + ' teve ' + INT.format(k.pedidosConcluidos) + ' pedidos concluídos (' +
      pct(k.pedidosConcluidos, base.pedidosConcluidos) + ' dos ' + INT.format(base.pedidosConcluidos) + '), faturamento de ' +
      BRL.format(k.faturamento) + ' (' + pct(k.faturamento, base.faturamento) + ') e cancelamento de ' +
      fmt(k.taxaCancelamento, 'percentual') + '.';
    return linha;
  }

  function dice(f, banco) {
    var ativos = filtrosAtivos(f);
    var linha = { operacao: 'Dice' };
    var combina = ativos.length > 1 || (ativos.length === 1 && ativos[0].valores.length > 1);
    if (!combina) {
      linha.aplicacao = ativos.length ? 'Nenhuma combinação (só ' + ativos[0].rotulo.toLowerCase() + ': ' + ativos[0].texto + ')' : 'Nenhum filtro';
      linha.pergunta = 'Como se comporta a combinação de duas ou mais dimensões?';
      linha.analise = 'Ative mais um filtro (por exemplo, canal ou forma de pagamento) para formar um subcubo.';
      return linha;
    }
    linha.aplicacao = ativos.map(function (a) { return a.rotulo + ': ' + a.texto; }).join(' · ');
    linha.pergunta = 'Como se comporta o subcubo ' + BE.dash.resumoFiltros(f) + '?';
    var k = BE.dash.kpis(f, banco);
    var periodo = soPeriodo(f);
    var temOutros = ativos.some(function (a) { return a.dim !== 'periodo'; });
    var base = temOutros ? BE.dash.kpis(periodo, banco) : null;
    if (!k.pedidos) { linha.analise = 'Nenhum pedido neste subcubo.'; return linha; }
    linha.analise = 'Neste subcubo: ' + INT.format(k.pedidosConcluidos) + ' pedidos concluídos' +
      (base ? ' (' + pct(k.pedidosConcluidos, base.pedidosConcluidos) + ' dos ' + INT.format(base.pedidosConcluidos) + ' ' +
        (periodo.inicio || periodo.fim ? 'de ' + BE.dash.textoPeriodo(periodo.inicio, periodo.fim) : 'do período') + ')' : '') +
      ', faturamento de ' + BRL.format(k.faturamento) +
      (base ? ' (' + pct(k.faturamento, base.faturamento) + ')' : '') +
      ', ticket médio de ' + fmt(k.ticketMedio, 'moeda') +
      (base ? ' (geral: ' + fmt(base.ticketMedio, 'moeda') + ')' : '') +
      ' e cancelamento de ' + fmt(k.taxaCancelamento, 'percentual') + '.';
    return linha;
  }

  /* ---------- Drill-down e roll-up ---------- */

  var NOMES_GRAN = {
    dia: { um: 'o dia', varios: 'dias', maior: 'O dia' },
    semana: { um: 'a semana', varios: 'semanas', maior: 'A semana' },
    mes: { um: 'o mês', varios: 'meses', maior: 'O mês' }
  };
  var NOMES_MEDIDA = {
    faturamento: { nome: 'faturamento', maior: 'de maior faturamento', formato: 'moeda', somavel: true },
    pedidos: { nome: 'pedidos concluídos', maior: 'com mais pedidos concluídos', formato: 'inteiro', somavel: true },
    cancelados: { nome: 'cancelamentos', maior: 'com mais cancelamentos', formato: 'inteiro', somavel: true },
    ticket: { nome: 'ticket médio', maior: 'de maior ticket médio', formato: 'moeda' },
    retencao: { nome: 'retenção da plataforma', maior: 'de maior retenção da plataforma', formato: 'percentual' }
  };

  function rotuloCategoria(gran, c) {
    if (gran === 'mes') return BE.dash.MESES[+c.chave.slice(5, 7) - 1] + '/' + c.chave.slice(0, 4);
    if (gran === 'semana') return c.inicio === c.fim ? ddmm(c.inicio) : ddmm(c.inicio) + ' a ' + ddmm(c.fim);
    return ddmm(c.inicio) + ' (' + BE.dash.DIAS_CURTOS[BE.metas.datas.diaSemana(c.inicio) - 1] + ')';
  }

  /* Destaque de uma série no tempo: o maior período e a sua parte do total (medidas somáveis) */
  function destaqueTempo(f, op, banco) {
    var gran = NOMES_GRAN[op.gran] ? op.gran : 'dia';
    var med = NOMES_MEDIDA[op.medida] ? op.medida : 'faturamento';
    var M = NOMES_MEDIDA[med], G = NOMES_GRAN[gran];
    var g = BE.dash.comPeriodo(f, op.inicio || '', op.fim || '');
    var r = BE.dash.serieTempo(g, gran, med, { total: true }, banco);
    var s = r.series.filter(function (x) { return x.nome === 'Todos os canais'; })[0];
    if (!s) return 'Sem pedidos neste recorte.';
    var idx = -1;
    s.valores.forEach(function (v, i) { if (v != null && (idx < 0 || v > s.valores[idx])) idx = i; });
    if (idx < 0) return 'Sem valores de ' + M.nome + ' neste recorte.';
    var onde = op.alvo ? (/^\d/.test(op.alvo) ? 'De ' : 'Em ') + op.alvo : emPeriodo(g);
    var texto = onde + ', ' + G.um + ' ' + M.maior + ' foi ' + rotuloCategoria(gran, r.categorias[idx]) + ', com ' +
      fmt(s.valores[idx], M.formato);
    if (M.somavel) {
      var total = Math.round(s.valores.reduce(function (a, v) { return a + (v || 0); }, 0) * 100) / 100;
      texto += ' (' + pct(s.valores[idx], total) + ' dos ' + fmt(total, M.formato) + ', em ' + INT.format(s.valores.length) + ' ' +
        (s.valores.length === 1 ? G.um.slice(2) : G.varios) + ')';
    } else {
      texto += ' (' + INT.format(s.valores.filter(function (v) { return v != null; }).length) + ' ' + G.varios + ' com valor)';
    }
    return texto + '.';
  }

  function pedidosDoDiaTexto(f, data, banco) {
    var l = BE.dash.pedidosDoDia(f, data, banco);
    var concl = l.filter(function (x) { return x.venda; });
    var soma = function (campo) {
      return Math.round(concl.reduce(function (a, x) { return a + (x[campo] || 0); }, 0) * 100) / 100;
    };
    if (!l.length) return 'Nenhum pedido em ' + ddmmaaaa(data) + ' com os filtros ativos.';
    return 'Em ' + ddmmaaaa(data) + ', ' + INT.format(l.length) + (l.length === 1 ? ' pedido' : ' pedidos') + ' (' +
      INT.format(concl.length) + ' concluídos e ' + INT.format(l.length - concl.length) + ' cancelados); total pago dos concluídos de ' +
      BRL.format(soma('totalPago')) + ' e líquido de ' + BRL.format(soma('liquido')) + '.';
  }

  function descida(f, op, banco) {
    var linha = { operacao: 'Drill-down' };
    if (!op) {
      linha.aplicacao = 'Nenhuma descida feita';
      linha.pergunta = 'O que explica o resultado de um período? Desça do mês para a semana, o dia e os pedidos.';
      linha.analise = 'Clique num ponto de um gráfico de tempo, ou escolha uma granularidade menor, para descer.';
      return linha;
    }
    linha.aplicacao = op.de + ' → ' + op.para + (op.alvo ? ' (' + op.alvo + ')' : '');
    if (op.data) {
      linha.pergunta = 'Quais pedidos formam o resultado de ' + ddmmaaaa(op.data) + '?';
      linha.analise = pedidosDoDiaTexto(f, op.data, banco);
      return linha;
    }
    var G = NOMES_GRAN[op.gran] || NOMES_GRAN.dia;
    var M = NOMES_MEDIDA[op.medida] || NOMES_MEDIDA.faturamento;
    linha.pergunta = 'Quais ' + G.varios + ' explicam o ' + M.nome + ' de ' + (op.alvo || BE.dash.textoPeriodo(f.inicio, f.fim)) + '?';
    linha.analise = destaqueTempo(f, op, banco);
    return linha;
  }

  function subida(f, op, banco) {
    var linha = { operacao: 'Roll-up' };
    if (!op) {
      linha.aplicacao = 'Nenhuma subida feita';
      linha.pergunta = 'Qual o quadro geral quando agrupamos os dias em semanas ou meses?';
      linha.analise = 'Use "Voltar" num gráfico detalhado, ou escolha uma granularidade maior, para subir.';
      return linha;
    }
    linha.aplicacao = op.de + ' → ' + op.para + (op.alvo ? ' (' + op.alvo + ')' : '');
    var G = NOMES_GRAN[op.gran] || NOMES_GRAN.mes;
    var M = NOMES_MEDIDA[op.medida] || NOMES_MEDIDA.faturamento;
    linha.pergunta = 'Como fica o ' + M.nome + ' agrupado por ' + G.um.slice(2) + '?';
    linha.analise = destaqueTempo(f, { gran: op.gran, medida: op.medida, inicio: op.inicio, fim: op.fim }, banco);
    return linha;
  }

  /* ---------- Pivot ---------- */

  function nomeDimensao(id) {
    var d = BE.dash.DIMENSOES_MATRIZ.filter(function (x) { return x.id === id; })[0];
    return d ? d.rotulo : 'Nenhuma';
  }

  function pivot(f, p, banco) {
    var linha = { operacao: 'Pivot' };
    p = p || { linhas: 'canal', colunas: 'pagamento', medida: 'faturamento' };
    var m = BE.dash.matriz(f, p.linhas, p.colunas, p.medida, banco);
    var nL = m.linhas.rotulo, nC = m.colunas.dim ? m.colunas.rotulo : null;
    linha.aplicacao = 'Linhas: ' + nL + ' × Colunas: ' + (nC || 'nenhuma') + ' · Medida: ' + m.medida.rotulo +
      (p.invertida ? ' (eixos invertidos)' : '');
    linha.pergunta = 'Como ' + (m.medida.somavel ? 'o total de ' : 'o ') + m.medida.rotulo.toLowerCase() + ' se distribui por ' +
      nL.toLowerCase() + (nC ? ' e ' + nC.toLowerCase() : '') + '?';
    if (m.vazio) { linha.analise = 'Sem pedidos neste recorte.'; return linha; }
    var melhor = null;
    m.linhas.itens.forEach(function (l, i) {
      if (nC) {
        m.colunas.itens.forEach(function (c, j) {
          var v = m.valores[i][j];
          if (v != null && (!melhor || v > melhor.v)) melhor = { v: v, nome: l.rotulo + ' × ' + c.rotulo };
        });
      } else {
        var v = m.totaisLinha[i];
        if (v != null && (!melhor || v > melhor.v)) melhor = { v: v, nome: l.rotulo };
      }
    });
    var F = m.medida.formato;
    var unidade = F === 'inteiro' ? ' ' + m.medida.rotulo.toLowerCase() : '';
    if (!melhor) { linha.analise = 'Nenhuma célula com valor neste recorte.'; return linha; }
    linha.analise = 'A maior célula é ' + melhor.nome + ', com ' + fmt(melhor.v, F) + unidade +
      (m.medida.somavel ? ' (' + pct(melhor.v, m.total) + ' do total de ' + fmt(m.total, F) + unidade + ').'
        : '; no recorte inteiro, ' + m.medida.rotulo.toLowerCase() + ' de ' + fmt(m.total, F) + '.');
    return linha;
  }

  function operacoesOlap(f, estado, banco) {
    f = BE.dash.normalizar(f);
    estado = estado || {};
    return [slice(f, banco), dice(f, banco), descida(f, estado.drill, banco), subida(f, estado.roll, banco), pivot(f, estado.pivot, banco)];
  }

  /* Tabela em Markdown (barras verticais escapadas) */
  function olapMarkdown(linhas, titulo) {
    var cel = function (t) { return String(t == null ? '' : t).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); };
    var md = (titulo ? '**' + cel(titulo) + '**\n\n' : '') +
      '| Operação | Aplicação | Pergunta | Análise |\n|---|---|---|---|\n' +
      linhas.map(function (l) {
        return '| ' + [l.operacao, l.aplicacao, l.pergunta, l.analise].map(cel).join(' | ') + ' |';
      }).join('\n');
    return md + '\n';
  }

  BE.dash = BE.dash || {};
  BE.dash.filtrosAtivos = filtrosAtivos;
  BE.dash.operacoesOlap = operacoesOlap;
  BE.dash.olapMarkdown = olapMarkdown;
  BE.dash.nomeDimensaoMatriz = nomeDimensao;
})(window.BE);
