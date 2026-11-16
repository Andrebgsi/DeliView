/*
 * Bloco reservado do Dashboard: descreve o que o gráfico vai mostrar, sem consultar dados.
 *
 *   BE.ui.placeholder({ titulo, pergunta, grafico, medidas, observacao, icone, largo })
 *     titulo     texto do bloco
 *     pergunta   pergunta de negócio que o bloco responde (itálico)
 *     grafico    tipo de gráfico ("Linha", "Cascata", "Rosca"...); vira chip e escolhe o ícone
 *     medidas    texto ou lista de textos; cada um vira um chip
 *     observacao nota curta abaixo dos chips (opcional)
 *     icone      nome do ícone em BE.icone (opcional; padrão: deduzido de `grafico`)
 *     largo      true ocupa duas colunas na grade em telas largas
 *   -> string HTML (textos escapados)
 */
window.BE = window.BE || {};
BE.ui = BE.ui || {};

(function (BE) {
  /* Ordem importa: o primeiro termo encontrado no tipo do gráfico define o ícone */
  var ICONES = [
    ['cascata', 'grafCascata'],
    ['calor', 'grafCalor'],
    ['dispers', 'grafDispersao'],
    ['histograma', 'grafCaixa'],
    ['boxplot', 'grafCaixa'],
    ['velocímetro', 'grafVelocimetro'],
    ['progresso', 'grafVelocimetro'],
    ['empilhad', 'grafEmpilhado'],
    ['100%', 'grafEmpilhado'],
    ['rosca', 'grafRosca'],
    ['matriz', 'tabela'],
    ['tabela', 'tabela'],
    ['drill', 'lupaMais'],
    ['quadro', 'lampada'],
    ['indicador', 'indicadorNum'],
    ['linha', 'grafLinha'],
    ['barra', 'grafBarras']
  ];

  function iconeDoGrafico(grafico) {
    var g = String(grafico || '').toLowerCase();
    for (var i = 0; i < ICONES.length; i++) {
      if (g.indexOf(ICONES[i][0]) >= 0) return ICONES[i][1];
    }
    return 'grafBarras';
  }

  BE.ui.placeholder = function (o) {
    o = o || {};
    var esc = BE.escapar;
    var medidas = o.medidas == null ? [] : [].concat(o.medidas);
    var chips = (o.grafico ? ['<li class="bloco__chip bloco__chip--grafico">' + esc(o.grafico) + '</li>'] : [])
      .concat(medidas.map(function (m) { return '<li class="bloco__chip">' + esc(m) + '</li>'; }));

    return '<article class="bloco' + (o.largo ? ' bloco--largo' : '') + '">' +
      '<div class="bloco__topo">' +
      '  <span class="bloco__icone">' + BE.icone(o.icone || iconeDoGrafico(o.grafico), 32) + '</span>' +
      '  <span class="bloco__selo">' + BE.icone('relogio', 14) + 'Próxima fase</span>' +
      '</div>' +
      '<h3 class="bloco__titulo">' + esc(o.titulo) + '</h3>' +
      (o.pergunta ? '<p class="bloco__pergunta">' + esc(o.pergunta) + '</p>' : '') +
      (chips.length ? '<ul class="bloco__chips" aria-label="Gráfico e medidas">' + chips.join('') + '</ul>' : '') +
      (o.observacao ? '<p class="bloco__obs">' + esc(o.observacao) + '</p>' : '') +
      '</article>';
  };

  BE.ui.placeholder.iconeDoGrafico = iconeDoGrafico;
})(window.BE);
