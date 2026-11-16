/*
 * Insights automáticos do recorte (Visualização → Insight → Decisão).
 *
 *   BE.dash.insights(f, banco?) -> [{ id, tema, visualizacao, insight, decisao, alerta }]
 *
 * Regras determinísticas: cada regra só gera cartão quando o gatilho é verdadeiro, e todo
 * número exibido vem das consultas de BE.dash (nada é estimado ou inventado).
 *
 *   cancelamento   algum canal com taxa de cancelamento acima de 15%
 *   meta-risco     meta em andamento cujo ritmo necessário passa de 1,5 × o ritmo atual
 *   canal          canal com mais de 60% dos pedidos concluídos
 *   retencao       diferença de retenção da plataforma entre canais acima de 10 pontos percentuais
 *   dia-semana     dia da semana mais forte e mais fraco (média de pedidos por ocorrência do dia)
 *   desconto       ticket dos pedidos com desconto × sem desconto (só se houver os dois grupos)
 * Sem pedidos no recorte: lista vazia.
 */
window.BE = window.BE || {};

(function (BE) {
  'use strict';

  var BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  var PCT = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var DEC = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  var LIMITES = { cancelamento: 15, dominante: 60, retencao: 10, ritmo: 1.5 };

  function p(v) { return PCT.format(v) + '%'; }
  function ddmm(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }

  function regraCancelamento(f, banco) {
    var acima = BE.dash.cancelamentoPorCanal(f, banco).filter(function (c) { return c.taxa != null && c.taxa > LIMITES.cancelamento; })
      .sort(function (a, b) { return b.taxa - a.taxa; });
    if (!acima.length) return null;
    var perdida = BE.dash.receitaPerdida(f, banco).porCanal;
    var valor = function (canal) {
      var x = perdida.filter(function (y) { return y.canal === canal; })[0];
      return x ? x.valor : 0;
    };
    var pior = acima[0];
    return {
      id: 'cancelamento', tema: 'Cancelamento acima de 15%', alerta: true,
      visualizacao: acima.map(function (c) {
        return 'O ' + c.canal + ' cancelou ' + INT.format(c.cancelados) + ' de ' + INT.format(c.pedidos) + ' pedidos (' + p(c.taxa) +
          '), com ' + BRL.format(valor(c.canal)) + ' de receita perdida (valor bruto)';
      }).join('; ') + '.',
      insight: 'A taxa do ' + pior.canal + ' está ' + DEC.format(pior.taxa - LIMITES.cancelamento) +
        ' pontos acima do limite de 15%: de cada 10 pedidos, cerca de ' + DEC.format(pior.taxa / 10) + ' não viram venda.',
      decisao: 'Avaliar os motivos de cancelamento no painel do ' + pior.canal +
        ' (tempo de preparo, itens em falta, área de entrega) e acompanhar a taxa semana a semana.'
    };
  }

  function regraMeta(f, banco) {
    var emRisco = BE.dash.metasNoPeriodo(f, banco).filter(function (m) {
      if (m.status !== 'andamento' || !(m.falta_valor > 0)) return false;
      var passados = m.dias_elegiveis - m.dias_restantes;
      if (passados <= 0) return false;
      m._ritmoAtual = Math.round(m.realizado_valor / passados * 100) / 100;
      m._passados = passados;
      return m.ritmo_necessario_dia > LIMITES.ritmo * m._ritmoAtual;
    });
    if (!emRisco.length) return null;
    var m = emRisco[0];
    return {
      id: 'meta-risco', tema: 'Meta em risco', alerta: true,
      visualizacao: 'A meta "' + m.nome + '" (' + ddmm(m.inicio) + ' a ' + ddmm(m.fim) + ') tem ' + BRL.format(m.realizado_valor) +
        ' de ' + BRL.format(m.meta_valor) + ' (' + p(m.atingimento_valor || 0) + '). Faltam ' + BRL.format(m.falta_valor) + ' em ' +
        INT.format(m.dias_restantes) + (m.dias_restantes === 1 ? ' dia' : ' dias') + ': ' + BRL.format(m.ritmo_necessario_dia) +
        ' por dia, contra ' + BRL.format(m._ritmoAtual) + ' por dia até agora.' +
        (emRisco.length > 1 ? ' Outras metas em risco: ' + emRisco.slice(1).map(function (x) { return x.nome; }).join(', ') + '.' : ''),
      insight: 'O ritmo necessário é ' + DEC.format(m._ritmoAtual > 0 ? m.ritmo_necessario_dia / m._ritmoAtual : 0) +
        ' vezes o ritmo atual' + (m._ritmoAtual > 0 ? '' : ' (ainda sem vendas nos dias da meta)') +
        ': mantido o ritmo, a meta não será batida.',
      decisao: 'Avaliar uma ação de vendas nos dias restantes (promoção, destaque no cardápio) ou revisar a meta na aba Metas.'
    };
  }

  function regraCanal(f, banco) {
    var part = BE.dash.participacaoCanal(f, banco);
    var dom = part.filter(function (x) { return x.partPedidos != null && x.partPedidos > LIMITES.dominante; })[0];
    if (!dom || f.canais.length === 1) return null;  /* com um canal só no filtro, a regra não tem sentido */
    var outros = part.filter(function (x) { return x !== dom; });
    var total = part.reduce(function (a, x) { return a + x.pedidos; }, 0);
    return {
      id: 'canal', tema: 'Canal dominante',
      visualizacao: 'O ' + dom.canal + ' fez ' + p(dom.partPedidos) + ' dos pedidos concluídos (' + INT.format(dom.pedidos) + ' de ' +
        INT.format(total) + ') e ' + p(dom.partFaturamento) + ' do faturamento (' + BRL.format(dom.faturamento) + ').',
      insight: 'As vendas dependem de um só canal: uma mudança de comissão, de visibilidade ou uma instabilidade no ' + dom.canal +
        ' afeta quase todo o faturamento.' + (outros.length ? '' : ' Nenhum outro canal teve pedidos concluídos neste recorte.'),
      decisao: 'Avaliar ações para fortalecer ' + (outros.length ? outros.map(function (x) { return 'o ' + x.canal; }).join(' e ') : 'outros canais') +
        ' e reduzir a dependência do ' + dom.canal + '.'
    };
  }

  function regraRetencao(f, banco) {
    var r = BE.dash.rentabilidadePorCanal(f, banco).filter(function (x) { return x.retencao != null; });
    if (r.length < 2) return null;
    var ord = r.slice().sort(function (a, b) { return b.retencao - a.retencao; });
    var pior = ord[0], melhor = ord[ord.length - 1];
    var dif = Math.round((pior.retencao - melhor.retencao) * 10) / 10;
    if (!(dif > LIMITES.retencao)) return null;
    return {
      id: 'retencao', tema: 'Diferença de retenção entre canais',
      visualizacao: 'A plataforma retém ' + p(pior.retencao) + ' do bruto no ' + pior.canal + ' e ' + p(melhor.retencao) + ' no ' +
        melhor.canal + ': diferença de ' + DEC.format(dif) + ' pontos percentuais.',
      insight: 'De cada R$ 100 vendidos, sobram ' + BRL.format(pior.sobraCem) + ' no ' + pior.canal + ' contra ' +
        BRL.format(melhor.sobraCem) + ' no ' + melhor.canal + '.',
      decisao: 'Avaliar preços diferentes por canal ou incentivar os pedidos pelo ' + melhor.canal + ', que deixa mais dinheiro na loja.'
    };
  }

  function regraDiaSemana(f, banco) {
    var d = BE.dash.mediaPorDiaSemana(f, banco).filter(function (x) { return x.media != null; });
    if (d.length < 2) return null;
    var ord = d.slice().sort(function (a, b) { return b.media - a.media || a.dia - b.dia; });
    var forte = ord[0], fraco = ord[ord.length - 1];
    if (!(forte.media > fraco.media)) return null;
    var desc = function (x) {
      return x.nome + ' (' + DEC.format(x.media) + ' pedidos por dia; ' + INT.format(x.pedidos) + ' em ' + INT.format(x.dias) +
        (x.dias === 1 ? ' ocorrência)' : ' ocorrências)');
    };
    return {
      id: 'dia-semana', tema: 'Dia da semana mais forte e mais fraco',
      visualizacao: 'O dia mais forte é ' + desc(forte) + '; o mais fraco é ' + desc(fraco) + '.',
      insight: fraco.media > 0
        ? 'Na média, ' + forte.nome + ' vende ' + DEC.format(forte.media / fraco.media) + ' vezes o que vende ' + fraco.nome + '.'
        : (/^(sábado|domingo)$/.test(fraco.nome) ? 'No ' : 'Na ') + fraco.nome + ' não houve pedido concluído neste recorte.',
      decisao: 'Avaliar promoções para ' + fraco.nome + ' e reforço de equipe e estoque para ' + forte.nome + '.'
    };
  }

  function regraDesconto(f, banco) {
    var r = BE.dash.comSemDesconto(f, banco);
    if (!(r.com > 0 && r.sem > 0) || r.ticketCom == null || r.ticketSem == null) return null;
    var dif = Math.round((r.ticketCom - r.ticketSem) * 100) / 100;
    return {
      id: 'desconto', tema: 'Ticket com desconto × sem desconto',
      visualizacao: 'Pedidos com desconto: ' + INT.format(r.com) + ', ticket médio de ' + BRL.format(r.ticketCom) +
        '. Sem desconto: ' + INT.format(r.sem) + ', ticket médio de ' + BRL.format(r.ticketSem) + '.',
      insight: dif > 0
        ? 'Quem usa desconto gasta ' + BRL.format(dif) + ' a mais por pedido: o desconto pode estar puxando pedidos maiores.'
        : 'Quem usa desconto gasta ' + BRL.format(-dif) + ' a menos por pedido: o desconto reduz o ticket sem aumentar o pedido.',
      decisao: dif > 0
        ? 'Avaliar descontos condicionados a um valor mínimo de pedido.'
        : 'Avaliar se as promoções compensam: rever o valor e as regras dos cupons.'
    };
  }

  var REGRAS = [regraCancelamento, regraMeta, regraCanal, regraRetencao, regraDiaSemana, regraDesconto];

  function insights(f, banco) {
    f = BE.dash.normalizar(f);
    if (!BE.dash.kpis(f, banco).pedidos) return [];
    var cartoes = [];
    REGRAS.forEach(function (regra) {
      var c = regra(f, banco);
      if (c) cartoes.push(c);
    });
    return cartoes.slice(0, 6);
  }

  BE.dash = BE.dash || {};
  BE.dash.insights = insights;
  BE.dash.LIMITES_INSIGHTS = LIMITES;
})(window.BE);
