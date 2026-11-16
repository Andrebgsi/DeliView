/*
 * Tela: Dashboard
 * Barra de filtros (período, canal, forma de pagamento, tipo de entrega e dia da semana) e
 * Painel principal com dados reais (BE.dash + BE.graficos). O recorte fica na URL
 * (#/dashboard?inicio=…&canal=…) e no localStorage (be.dash.filtros); mudar um filtro
 * redesenha só o que depende dele: o painel e as seções abertas (as fechadas são desenhadas
 * ao abrir). As 7 seções detalhadas têm gráficos reais; os de tempo têm seletor Dia/Semana/Mês
 * (roll-up e drill-down) e, no dia, abrem a lista de pedidos (painel com exportação CSV).
 * Exploração OLAP: matriz pivot (linhas × colunas × medida, com "Inverter" e CSV), comparação
 * com drill-down (Mês → Semana → Dia → pedidos) e a tabela "Operações OLAP neste recorte",
 * preenchida a partir do estado atual (filtros, última descida e subida e configuração da matriz).
 * Insights: cartões Visualização → Insight → Decisão gerados por regras (BE.dash.insights).
 */
window.BE = window.BE || {};
BE.telas = BE.telas || {};

(function (BE) {
  var esc = function (s) { return BE.escapar(s); };
  var ic = function (n, t) { return BE.icone(n, t); };
  var CHAVE_FILTROS = 'be.dash.filtros';
  var BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  var PCT = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var VERDE = '#2f7d4f';
  var VERMELHO = '#c0392b';

  /* ---------- Conteúdo ---------- */

  /* Grupos de chips: campo do objeto de filtros, parâmetro da URL e rótulo */
  var GRUPOS = [
    { campo: 'canais', param: 'canal', rotulo: 'Canal', opcoes: 'canais' },
    { campo: 'pagamentos', param: 'pagamento', rotulo: 'Forma de pagamento', opcoes: 'pagamentos' },
    { campo: 'entregas', param: 'entrega', rotulo: 'Tipo de entrega', opcoes: 'entregas' },
    { campo: 'diasSemana', param: 'dia', rotulo: 'Dia da semana', opcoes: 'diasSemana' }
  ];

  var KPIS = [
    { campo: 'faturamento', titulo: 'Faturamento', formato: 'moeda' },
    { campo: 'pedidosConcluidos', titulo: 'Pedidos concluídos', formato: 'inteiro' },
    { campo: 'ticketMedio', titulo: 'Ticket médio', formato: 'moeda' },
    { campo: 'liquido', titulo: 'Líquido recebido', formato: 'moeda' }
  ];

  var PAINEL = [
    { id: 'faturamento', titulo: 'Faturamento diário por canal', largo: true, icone: 'grafLinha',
      pergunta: 'Como o faturamento evolui dia a dia em cada canal?',
      tempo: { medida: 'faturamento', padrao: 'dia', pedidos: true },
      observacao: 'VALOR_TOTAL_PAGO, só pedidos concluídos. Clique num dia (ou Enter) para ver a lista de pedidos.' },
    { id: 'cascata', titulo: 'Do bruto ao líquido', icone: 'grafCascata',
      pergunta: 'Quanto do valor vendido chega de fato ao caixa?',
      observacao: 'Só pedidos concluídos. "Outros ajustes" fecha a conta entre o bruto e o líquido informado pelas plataformas.' },
    { id: 'cancelamento', titulo: 'Cancelamento por canal', icone: 'grafBarras',
      pergunta: 'Qual canal perde mais pedidos para cancelamento?' },
    { id: 'calor', titulo: 'Pedidos por dia da semana', icone: 'grafCalor',
      pergunta: 'Em que dias da semana o restaurante vende mais?',
      observacao: 'Pedidos concluídos por dia da semana e semana do mês (semanas de segunda a domingo). Clique numa célula para filtrar o dia da semana.' },
    { id: 'pagamentos', titulo: 'Formas de pagamento', icone: 'grafRosca',
      pergunta: 'Como os clientes preferem pagar?',
      observacao: 'Pedidos concluídos por forma de pagamento.' }
  ];

  /*
   * Seções detalhadas. Cada bloco: id, título, pergunta de negócio (subtítulo do gráfico),
   * ícone, largo (duas colunas) e tempo (gráfico de tempo com seletor Dia/Semana/Mês:
   * medida da BE.dash.serieTempo, granularidade inicial e se soma a série "Todos os canais").
   */
  var SECOES = [
    { titulo: 'Vendas e faturamento', blocos: [
      { id: 's1-evolucao', titulo: 'Evolução diária do faturamento', icone: 'grafLinha', largo: true,
        pergunta: 'O faturamento está crescendo, caindo ou estável ao longo do período?',
        tempo: { medida: 'faturamento', padrao: 'dia', total: true, pedidos: true },
        observacao: 'VALOR_TOTAL_PAGO dos concluídos, uma linha por canal e o total. Clique num ponto para descer (Mês → Semana → Dia → pedidos).' },
      { id: 's1-diasemana', titulo: 'Pedidos por dia da semana', icone: 'grafBarras',
        pergunta: 'Quais dias da semana concentram mais pedidos?',
        observacao: 'Pedidos concluídos por canal. Clique numa barra para filtrar o dia da semana.' },
      { id: 's1-fds', titulo: 'Fim de semana × dia útil', icone: 'grafBarras',
        pergunta: 'O fim de semana vende mais, e com ticket maior, que os dias úteis?' },
      { id: 's1-participacao', titulo: 'Participação de cada canal', icone: 'grafEmpilhado',
        pergunta: 'Qual a fatia do iFood e do 99Food no faturamento?' },
      { id: 's1-kpis', titulo: 'Números-chave do recorte', icone: 'indicadorNum',
        pergunta: 'Quais são os números-chave do período escolhido?' }
    ] },
    { titulo: 'Rentabilidade por canal', blocos: [
      { id: 's2-cascata', titulo: 'Cascata do bruto ao líquido', icone: 'grafCascata', canalCascata: true,
        pergunta: 'Para onde vai o dinheiro entre o valor bruto e o líquido em cada canal?' },
      { id: 's2-sobra', titulo: 'Quanto sobra de cada R$ 100 vendidos', icone: 'grafBarras',
        pergunta: 'De cada R$ 100 vendidos, quanto fica com a loja em cada canal?',
        observacao: 'VALOR_LIQUIDO ÷ VALOR_BRUTO_PEDIDO × 100, só concluídos.' },
      { id: 's2-custos', titulo: 'Taxas, descontos e motoboy como % do bruto', icone: 'grafEmpilhado',
        pergunta: 'Qual custo pesa mais em cada canal?' },
      { id: 's2-retencao', titulo: 'Evolução semanal da retenção', icone: 'grafLinha', largo: true,
        pergunta: 'A parte do bruto que fica com a loja melhora ou piora semana a semana?',
        tempo: { medida: 'retencao', padrao: 'semana' },
        observacao: 'Retenção da plataforma = (bruto − líquido) ÷ bruto, só concluídos. Quanto menor, mais sobra para a loja.' }
    ] },
    { titulo: 'Cancelamentos', blocos: [
      { id: 's3-taxa', titulo: 'Taxa de cancelamento por canal', icone: 'grafBarras',
        pergunta: 'Qual canal tem a maior taxa de cancelamento?' },
      { id: 's3-tempo', titulo: 'Cancelamentos ao longo do tempo', icone: 'grafLinha', largo: true,
        pergunta: 'Os cancelamentos estão aumentando ou diminuindo?',
        tempo: { medida: 'cancelados', padrao: 'dia', pedidos: true },
        observacao: 'Pedidos cancelados por canal; o tooltip mostra a taxa do período.' },
      { id: 's3-perdida', titulo: 'Receita perdida', icone: 'indicadorNum',
        pergunta: 'Quanto deixamos de vender por causa dos cancelamentos?',
        observacao: 'A regra ZERA FATOS preserva o valor bruto dos cancelados; as outras medidas ficam em 0.' },
      { id: 's3-calor', titulo: 'Cancelamentos por dia da semana', icone: 'grafCalor',
        pergunta: 'Em que dias os cancelamentos se concentram?',
        observacao: 'Clique numa célula para filtrar o dia da semana.' }
    ] },
    { titulo: 'Descontos e promoções', blocos: [
      { id: 's4-medio', titulo: 'Desconto médio por pedido e canal', icone: 'grafBarras',
        pergunta: 'Quanto cada canal concede de desconto, em média, por pedido?' },
      { id: 's4-comsem', titulo: 'Pedidos com × sem desconto', icone: 'grafRosca',
        pergunta: 'Que parte dos pedidos usa algum desconto?',
        observacao: 'Só pedidos concluídos: a regra ZERA FATOS zera o desconto dos cancelados.' },
      { id: 's4-dispersao', titulo: 'Desconto × ticket', icone: 'grafDispersao', largo: true,
        pergunta: 'Pedidos com mais desconto têm ticket maior?',
        observacao: 'Um ponto por pedido concluído: desconto (VALOR_DESCONTOS) no eixo horizontal e total pago no vertical.' }
    ] },
    { titulo: 'Ticket médio', blocos: [
      { id: 's5-distribuicao', titulo: 'Distribuição do ticket', icone: 'grafCaixa',
        pergunta: 'Os pedidos têm valores parecidos ou há muitos fora da curva?',
        observacao: 'Boxplot do total pago dos concluídos: a caixa vai do 1º ao 3º quartil (metade central dos pedidos), o traço escuro é a mediana e os círculos são os pedidos fora da curva (além de 1,5 × a altura da caixa).' },
      { id: 's5-pagamento', titulo: 'Ticket por forma de pagamento e canal', icone: 'grafBarras',
        pergunta: 'O ticket médio muda conforme a forma de pagamento?' },
      { id: 's5-evolucao', titulo: 'Evolução semanal do ticket', icone: 'grafLinha', largo: true,
        pergunta: 'O ticket médio está subindo ou caindo?',
        tempo: { medida: 'ticket', padrao: 'semana', total: true },
        observacao: 'Faturamento ÷ pedidos concluídos de cada período.' }
    ] },
    { titulo: 'Pagamento e entrega', blocos: [
      { id: 's6-mix', titulo: 'Mix de pagamentos', icone: 'grafRosca',
        pergunta: 'Como os pedidos se dividem entre as formas de pagamento?',
        observacao: 'Pedidos concluídos por forma de pagamento.' },
      { id: 's6-canal', titulo: 'Pagamento × canal', icone: 'grafEmpilhado',
        pergunta: 'Cada canal tem um perfil de pagamento diferente?',
        observacao: 'Participação de cada forma de pagamento nos pedidos concluídos do canal.' },
      { id: 's6-entrega', titulo: 'Tipo de entrega × canal', icone: 'grafBarras',
        pergunta: 'Quanto a entrega custa à loja em cada canal?' }
    ] },
    { titulo: 'Metas × realizado',
      nota: 'Depende das metas cadastradas na aba Metas (FATO_META).',
      link: { href: '#/metas', texto: 'Ir para Metas' },
      blocos: [
        { id: 's7-atingimento', titulo: 'Atingimento da meta', icone: 'grafVelocimetro',
          pergunta: 'Quanto da meta do período já foi alcançado?' },
        { id: 's7-mensal', titulo: 'Realizado mensal × meta', icone: 'grafBarras',
          pergunta: 'Em quais meses a meta foi batida?' }
      ] }
  ];

  /* Exploração OLAP: matriz (montada à parte), comparação com drill-down e insights */
  var MATRIZ = { id: 'matriz', titulo: 'Matriz (pivot)', icone: 'tabela',
    pergunta: 'Escolha linhas, colunas e medida para cruzar qualquer dimensão com qualquer medida.' };
  var OLAP_DRILL = { id: 'olap-drill', titulo: 'Comparação com drill-down', icone: 'lupaMais', largo: true, inteiro: true,
    pergunta: 'O que explica a variação de um mês? Desça do mês para o dia.',
    tempo: { medida: 'faturamento', padrao: 'mes', pedidos: true, barras: true },
    observacao: 'Faturamento dos concluídos por canal. Clique numa barra (ou Enter) para descer: Mês → Semana → Dia → pedidos.' };
  var OLAP_INSIGHTS = { id: 'insights', titulo: 'Insights', icone: 'lampada', largo: true, inteiro: true,
    pergunta: 'O que os dados mostram e o que fazer a respeito?',
    observacao: 'Gerados por regras fixas sobre o recorte (Visualização → Insight → Decisão). Todo número vem das consultas.' };

  var PIVOT_PADRAO = { linhas: 'canal', colunas: 'pagamento', medida: 'faturamento', invertida: false };

  /* ---------- Estado dos filtros: URL > localStorage > padrão ---------- */

  function filtrosDaUrl() {
    var h = location.hash || '';
    var i = h.indexOf('?');
    if (i < 0) return null;
    var q = new URLSearchParams(h.slice(i + 1));
    var f = { inicio: q.get('inicio') || '', fim: q.get('fim') || '' };
    GRUPOS.forEach(function (g) { f[g.campo] = q.getAll(g.param); });
    return BE.dash.normalizar(f);
  }

  function filtrosParaUrl(f) {
    var q = new URLSearchParams();
    if (f.inicio) q.append('inicio', f.inicio);
    if (f.fim) q.append('fim', f.fim);
    GRUPOS.forEach(function (g) { f[g.campo].forEach(function (v) { q.append(g.param, v); }); });
    return '#/dashboard?' + q.toString();
  }

  function lerGuardado() {
    try {
      var t = localStorage.getItem(CHAVE_FILTROS);
      return t ? BE.dash.normalizar(JSON.parse(t)) : null;
    } catch (e) { return null; }
  }

  function guardar(f) {
    try { localStorage.setItem(CHAVE_FILTROS, JSON.stringify(f)); } catch (e) { /* sem localStorage */ }
    var alvo = filtrosParaUrl(f);
    if (location.hash !== alvo) history.replaceState(null, '', alvo);
  }

  /* ---------- Formatação ---------- */

  function formatar(v, formato) {
    if (v == null || !isFinite(v)) return '—';
    if (formato === 'moeda') return BRL.format(v);
    if (formato === 'percentual') return PCT.format(v) + '%';
    return INT.format(v);
  }

  function ddmm(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }
  function ddmmaaaa(iso) { return ddmm(iso) + '/' + iso.slice(0, 4); }

  /* Variação contra o período anterior: ▲ verde, ▼ vermelho ou "sem base" */
  function variacao(atual, anterior) {
    if (atual == null || anterior == null || !(anterior > 0)) return { classe: 'neutra', texto: 'sem base' };
    var v = (atual - anterior) / anterior * 100;
    if (Math.abs(v) < 0.05) return { classe: 'neutra', texto: '= 0,0%' };
    return v > 0
      ? { classe: 'sobe', texto: '▲ ' + PCT.format(v) + '%' }
      : { classe: 'desce', texto: '▼ ' + PCT.format(Math.abs(v)) + '%' };
  }

  /* ---------- Montagem ---------- */

  function chips(grupo, opcoes, selecionados) {
    var itens = opcoes[grupo.opcoes] || [];
    if (!itens.length) return '<p class="filtro__vazio">Sem opções: importe dados.</p>';
    var todos = !selecionados.length;
    return '<div class="chips-filtro" role="group" aria-labelledby="dash-f-' + grupo.param + '">' +
      '<button type="button" class="chip-filtro chip-filtro--todos" data-grupo="' + grupo.campo + '" data-todos="1" ' +
      'aria-pressed="' + todos + '">Todos</button>' +
      itens.map(function (o) {
        var valor = typeof o === 'object' ? o.valor : o;
        var rotulo = typeof o === 'object' ? o.curto : o;
        var titulo = typeof o === 'object' ? ' title="' + esc(o.nome) + '" aria-label="' + esc(o.nome) + '"' : '';
        var marcado = selecionados.map(String).indexOf(String(valor)) >= 0;
        return '<button type="button" class="chip-filtro" data-grupo="' + grupo.campo + '" data-valor="' + esc(valor) + '"' +
          titulo + ' aria-pressed="' + marcado + '">' + esc(rotulo) + '</button>';
      }).join('') +
      '</div>';
  }

  function barraFiltros() {
    return '<section class="cartao filtros" aria-labelledby="dash-t-filtros">' +
      '<div class="cartao__topo"><h2 id="dash-t-filtros">' + ic('filtro', 20) + 'Filtros</h2>' +
      '<div class="filtros__acoes">' +
      '<button type="button" class="botao botao--secundario botao--pequeno" id="dash-imprimir">' + ic('impressora', 16) +
      'Imprimir / salvar PDF</button>' +
      '<button type="button" class="botao botao--secundario botao--pequeno" id="dash-limpar">' + ic('repetir', 16) +
      'Limpar filtros</button></div></div>' +
      '<div class="filtros__grade" id="dash-filtros"></div>' +
      '<p class="filtros__resumo" id="dash-resumo" aria-live="polite"></p>' +
      '</section>';
  }

  function controlesFiltros(f, opcoes) {
    var min = opcoes.periodo.min || '', max = opcoes.periodo.max || '';
    var limites = (min ? ' min="' + esc(min) + '"' : '') + (max ? ' max="' + esc(max) + '"' : '');
    return '<div class="filtro filtro--periodo">' +
      '<span class="filtro__rotulo" id="dash-f-periodo">Período</span>' +
      '<div class="filtro__datas" role="group" aria-labelledby="dash-f-periodo">' +
      '<label class="filtro__data"><span>Início</span><input type="date" id="dash-f-inicio" value="' + esc(f.inicio) + '"' + limites + '></label>' +
      '<label class="filtro__data"><span>Fim</span><input type="date" id="dash-f-fim" value="' + esc(f.fim) + '"' + limites + '></label>' +
      '</div></div>' +
      GRUPOS.map(function (g) {
        return '<div class="filtro"><span class="filtro__rotulo" id="dash-f-' + g.param + '">' + esc(g.rotulo) + '</span>' +
          chips(g, opcoes, f[g.campo]) + '</div>';
      }).join('');
  }

  function blocoDados(b) {
    return '<article class="bloco bloco--dados' + (b.largo ? ' bloco--largo' : '') + (b.inteiro ? ' bloco--inteiro' : '') +
      '" aria-labelledby="dash-b-' + b.id + '">' +
      '<div class="bloco__cab"><span class="bloco__icone bloco__icone--ativo" aria-hidden="true">' + ic(b.icone, 22) + '</span>' +
      '<div><h3 class="bloco__titulo" id="dash-b-' + b.id + '">' + esc(b.titulo) + '</h3>' +
      '<p class="bloco__pergunta">' + esc(b.pergunta) + '</p></div></div>' +
      controlesBloco(b) +
      '<div class="bloco__grafico" id="dash-g-' + b.id + '"></div>' +
      '<p class="bloco__obs" id="dash-o-' + b.id + '"' + (b.observacao ? '' : ' hidden') + '>' + esc(b.observacao || '') + '</p>' +
      '</article>';
  }

  function painelPrincipal() {
    return '<section class="pilha" aria-labelledby="dash-t-painel">' +
      '<div class="titulo-secao"><h2 id="dash-t-painel">Painel principal</h2>' +
      '<p>Uma página com o essencial das vendas no recorte escolhido.</p></div>' +
      '<div class="indicadores" id="dash-kpis">' +
      KPIS.map(function (k) {
        return '<div class="indicador" data-kpi="' + k.campo + '"><h3>' + esc(k.titulo) + '</h3>' +
          '<p class="indicador__valor">—</p><p class="indicador__var indicador__var--neutra">sem base</p>' +
          '<p class="indicador__sub"></p></div>';
      }).join('') +
      '</div>' +
      '<div class="grade-blocos grade-blocos--dados">' + PAINEL.map(blocoDados).join('') + '</div>' +
      '</section>';
  }

  function controlesBloco(b) {
    var html = '';
    if (b.tempo) {
      html += '<div class="segmentado segmentado--compacto" role="group" aria-label="Granularidade do tempo">' +
        ['dia', 'semana', 'mes'].map(function (g) {
          return '<button type="button" class="segmentado__botao" data-gran="' + g + '" data-bloco="' + b.id + '" aria-pressed="false">' +
            esc(BE.dash.GRANULARIDADES[g]) + '</button>';
        }).join('') + '</div>' +
        '<p class="bloco__foco" id="dash-foco-' + b.id + '" hidden></p>';
    }
    if (b.canalCascata) {
      html += '<div class="segmentado segmentado--compacto" role="group" aria-label="Canal da cascata" id="dash-cc-' + b.id + '"></div>';
    }
    return html ? '<div class="bloco__controles">' + html + '</div>' : '';
  }

  function secoes() {
    return '<section class="pilha" aria-labelledby="dash-t-analises">' +
      '<div class="titulo-secao"><h2 id="dash-t-analises">Análises por tema</h2>' +
      '<p>Abra cada tema para ver os gráficos do recorte. Todos respeitam os filtros acima.</p></div>' +
      SECOES.map(function (s, i) {
        return '<details class="cartao recolhivel secao-dash" data-secao="' + i + '"' + (i === 0 ? ' open' : '') + '>' +
          '<summary><span class="secao-dash__num">' + (i + 1) + '</span>' +
          '<span class="secao-dash__titulo">' + esc(s.titulo) + '</span>' +
          '<span class="contador">' + s.blocos.length + ' gráficos</span></summary>' +
          (s.nota ? '<p class="secao-dash__nota">' + ic('info', 16) + '<span>' + esc(s.nota) +
            (s.link ? ' <a href="' + s.link.href + '">' + esc(s.link.texto) + '</a>' : '') + '</span></p>' : '') +
          '<div class="grade-blocos grade-blocos--dados">' + s.blocos.map(blocoDados).join('') + '</div>' +
          '</details>';
      }).join('') +
      '</section>';
  }

  function opcoesSelect(lista, atual) {
    return lista.map(function (o) {
      return '<option value="' + esc(o.id) + '"' + (o.id === atual ? ' selected' : '') + '>' + esc(o.rotulo) + '</option>';
    }).join('');
  }

  function blocoMatriz() {
    var p = PIVOT_PADRAO;
    return '<article class="bloco bloco--dados bloco--largo bloco--inteiro" aria-labelledby="dash-b-matriz">' +
      '<div class="bloco__cab"><span class="bloco__icone bloco__icone--ativo" aria-hidden="true">' + ic(MATRIZ.icone, 22) + '</span>' +
      '<div><h3 class="bloco__titulo" id="dash-b-matriz">' + esc(MATRIZ.titulo) + '</h3>' +
      '<p class="bloco__pergunta">' + esc(MATRIZ.pergunta) + '</p></div></div>' +
      '<div class="matriz__controles">' +
      '<label class="campo"><span>Linhas</span><select id="dash-mx-linhas">' + opcoesSelect(BE.dash.DIMENSOES_MATRIZ, p.linhas) + '</select></label>' +
      '<label class="campo"><span>Colunas</span><select id="dash-mx-colunas">' +
      opcoesSelect([{ id: 'nenhuma', rotulo: 'Nenhuma' }].concat(BE.dash.DIMENSOES_MATRIZ), p.colunas) + '</select></label>' +
      '<label class="campo"><span>Medida</span><select id="dash-mx-medida">' + opcoesSelect(BE.dash.MEDIDAS_MATRIZ, p.medida) + '</select></label>' +
      '<div class="matriz__botoes">' +
      '<button type="button" class="botao botao--secundario botao--pequeno" id="dash-mx-inverter">' + ic('inverter', 16) + 'Inverter</button>' +
      '<button type="button" class="botao botao--secundario botao--pequeno" id="dash-mx-csv">' + ic('download', 16) + 'Exportar CSV</button>' +
      '</div></div>' +
      '<div class="bloco__grafico" id="dash-g-matriz"></div>' +
      '<p class="bloco__obs" id="dash-o-matriz"></p>' +
      '</article>';
  }

  function exploracao() {
    return '<section class="pilha" aria-labelledby="dash-t-olap">' +
      '<div class="titulo-secao"><h2 id="dash-t-olap">Exploração OLAP</h2>' +
      '<p>Ferramentas para navegar pelo cubo de vendas. Todas respeitam os filtros acima (slice e dice).</p></div>' +
      '<div class="grade-blocos grade-blocos--dados">' + blocoMatriz() + blocoDados(OLAP_DRILL) +
      blocoDados(OLAP_INSIGHTS) + '</div>' +
      '<div class="cartao olap-tabela">' +
      '<div class="cartao__topo"><h3 class="cartao__h3">' + ic('cubo', 20) + 'Operações OLAP neste recorte</h3>' +
      '<button type="button" class="botao botao--secundario botao--pequeno" id="dash-olap-copiar">' + ic('copiar', 16) +
      'Copiar para a documentação</button></div>' +
      '<p class="cartao__nota">Preenchida a partir do estado atual: filtros, última descida, última subida e configuração da matriz.</p>' +
      '<div class="tabela-wrap" id="dash-olap"></div></div>' +
      '</section>';
  }

  /* =====================================================================
   * Gráficos de tempo: granularidade (roll-up / drill-down) e foco
   * ===================================================================== */

  var ORDEM_GRAN = ['mes', 'semana', 'dia'];
  var MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  function rotuloPeriodo(gran, c) {
    if (gran === 'mes') return BE.dash.MESES[+c.chave.slice(5, 7) - 1] + '/' + c.chave.slice(0, 4);
    if (gran === 'semana') return c.inicio === c.fim ? ddmmaaaa(c.inicio) : ddmm(c.inicio) + ' a ' + ddmmaaaa(c.fim);
    return ddmmaaaa(c.inicio) + ' (' + BE.dash.DIAS_CURTOS[BE.metas.datas.diaSemana(c.inicio) - 1] + ')';
  }

  function rotuloEixoPeriodo(gran, c) {
    if (gran === 'mes') return MESES_CURTOS[+c.chave.slice(5, 7) - 1] + '/' + c.chave.slice(2, 4);
    return ddmm(c.inicio);
  }

  /* Estado de cada gráfico de tempo: { gran, foco: { inicio, fim, rotulo, gran } | null } */
  function estadoTempo(ctx, b) {
    if (!ctx.estado.tempo[b.id]) ctx.estado.tempo[b.id] = { gran: b.tempo.padrao, foco: null };
    return ctx.estado.tempo[b.id];
  }

  /*
   * Registra a última descida (drill) ou subida (roll), para a tabela de operações OLAP.
   * extra: { inicio, fim, gran (destino), medida } ou { data } (descida até os pedidos de um dia)
   */
  function registrarOlap(ctx, tipo, de, para, alvo, extra) {
    var op = { de: BE.dash.GRANULARIDADES[de] || de, para: BE.dash.GRANULARIDADES[para] || para, alvo: alvo || '' };
    Object.keys(extra || {}).forEach(function (k) { op[k] = extra[k]; });
    ctx.estado.olap[tipo] = op;
    if (ctx.desenharOlap) ctx.desenharOlap();
  }

  function desenharTempo(ctx, b) {
    var el = ctx.g(b.id);
    var et = estadoTempo(ctx, b);
    var f = et.foco ? BE.dash.comPeriodo(ctx.f, et.foco.inicio, et.foco.fim) : ctx.f;
    var r = BE.dash.serieTempo(f, et.gran, b.tempo.medida, { total: !!b.tempo.total });
    var formato = { faturamento: 'moeda', ticket: 'moeda', retencao: 'percentual', cancelados: 'inteiro', pedidos: 'inteiro' }[b.tempo.medida];
    var porChave = {};
    r.categorias.forEach(function (c) { porChave[c.chave] = c; });
    var gran = r.granularidade;
    var dica = null;
    if (b.tempo.medida === 'cancelados') {
      dica = function (i, serie, v) {
        var x = serie.extras && serie.extras[i];
        return rotuloPeriodo(gran, r.categorias[i]) + ' · ' + serie.nome + ': ' + formatar(v, 'inteiro') +
          (v === 1 ? ' cancelado' : ' cancelados') + (x ? ' de ' + formatar(x.pedidos, 'inteiro') + ' pedidos (taxa ' +
          formatar(x.taxaCancelamento, 'percentual') + ')' : ' (sem pedidos)');
      };
    } else if (b.tempo.medida === 'retencao') {
      dica = function (i, serie, v) {
        var x = serie.extras && serie.extras[i];
        return rotuloPeriodo(gran, r.categorias[i]) + ' · ' + serie.nome + ': retenção ' + formatar(v, 'percentual') +
          (x ? ' (bruto ' + BRL.format(x.bruto) + ', líquido ' + BRL.format(x.liquido) + ')' : '');
      };
    }
    var proxima = { mes: 'semana', semana: 'dia' }[gran];
    var desenho = b.tempo.barras ? BE.graficos.barras : BE.graficos.linhas;
    desenho(el, {
      interativo: true,
      categorias: r.categorias.map(function (c) { return c.chave; }),
      series: r.series,
      formato: formato,
      rotuloTabela: BE.dash.GRANULARIDADES[gran],
      rotuloCategoria: function (k) { return rotuloPeriodo(gran, porChave[k]); },
      rotuloEixo: function (k) { return rotuloEixoPeriodo(gran, porChave[k]); },
      dica: dica,
      titulo: (b.tempo.barras ? 'Gráfico de barras: ' : 'Gráfico de linhas: ') + b.titulo + ' por ' +
        BE.dash.GRANULARIDADES[gran].toLowerCase() + ', ' +
        r.categorias.length + ' períodos; ' + r.series.map(function (s) { return s.nome; }).join(', '),
      aoClicar: (proxima || b.tempo.pedidos) ? function (i) {
        var c = r.categorias[i];
        if (!c) return;
        if (proxima) {
          registrarOlap(ctx, 'drill', gran, proxima, rotuloPeriodo(gran, c),
            { inicio: c.inicio, fim: c.fim, gran: proxima, medida: b.tempo.medida });
          et.foco = { inicio: c.inicio, fim: c.fim, rotulo: rotuloPeriodo(gran, c), gran: gran };
          et.gran = proxima;
          desenharTempo(ctx, b);
          var alvo = ctx.g(b.id).querySelector('[data-clique]');
          if (alvo) alvo.focus();
        } else {
          registrarOlap(ctx, 'drill', 'dia', 'Pedido', ddmm(c.inicio), { data: c.inicio });
          ctx.abrirDia(c.inicio, document.activeElement);
        }
      } : null
    });

    /* Seletor e trilha do foco */
    Array.prototype.forEach.call(ctx.raiz.querySelectorAll('[data-bloco="' + b.id + '"][data-gran]'), function (bt) {
      bt.setAttribute('aria-pressed', String(bt.getAttribute('data-gran') === gran));
    });
    var foco = ctx.raiz.querySelector('#dash-foco-' + b.id);
    if (foco) {
      foco.hidden = !et.foco;
      foco.innerHTML = et.foco
        ? '<span>Detalhe de <strong>' + esc(et.foco.rotulo) + '</strong> por ' + esc(BE.dash.GRANULARIDADES[gran].toLowerCase()) + '</span>' +
          '<button type="button" class="botao-link" data-subir="' + b.id + '">Voltar para ' +
          esc(BE.dash.GRANULARIDADES[et.foco.gran].toLowerCase()) + '</button>'
        : '';
    }
  }

  /* Troca de granularidade pelo seletor (subir = roll-up, descer = drill-down) */
  function trocarGranularidade(ctx, b, nova) {
    var et = estadoTempo(ctx, b);
    if (nova === et.gran && !et.foco) return;
    var tipo = ORDEM_GRAN.indexOf(nova) < ORDEM_GRAN.indexOf(et.gran) ? 'roll' : 'drill';
    if (nova !== et.gran) {
      registrarOlap(ctx, tipo, et.gran, nova, BE.dash.textoPeriodo(ctx.f.inicio, ctx.f.fim),
        { inicio: ctx.f.inicio, fim: ctx.f.fim, gran: nova, medida: b.tempo.medida });
    }
    et.gran = nova;
    et.foco = null;
    desenharTempo(ctx, b);
  }

  function subirFoco(ctx, b) {
    var et = estadoTempo(ctx, b);
    if (!et.foco) return;
    registrarOlap(ctx, 'roll', et.gran, et.foco.gran, BE.dash.textoPeriodo(ctx.f.inicio, ctx.f.fim),
      { inicio: ctx.f.inicio, fim: ctx.f.fim, gran: et.foco.gran, medida: b.tempo.medida });
    et.gran = et.foco.gran;
    et.foco = null;
    desenharTempo(ctx, b);
  }

  /* =====================================================================
   * Seções detalhadas: um desenho por bloco
   * ===================================================================== */

  function somaLista(l) { return l.reduce(function (a, v) { return a + (Number(v) || 0); }, 0); }

  function cartoesHtml(itens) {
    return '<div class="mini-indicadores">' + itens.map(function (it) {
      return '<div class="mini-indicador' + (it.alerta ? ' mini-indicador--alerta' : '') + '"><span class="mini-indicador__rotulo">' +
        esc(it.rotulo) + '</span><strong class="mini-indicador__valor">' + esc(it.valor) + '</strong>' +
        (it.sub ? '<span class="mini-indicador__sub">' + esc(it.sub) + '</span>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function vazioHtml(el, texto, extraHtml) {
    el._grafico = null;
    el.innerHTML = '<p class="grafico__vazio" role="status">' + esc(texto || BE.graficos.TEXTO_VAZIO) + '</p>' + (extraHtml || '');
  }

  /* Bloco com dois gráficos lado a lado: devolve os dois contêineres */
  function duplo(el, t1, t2) {
    el._grafico = null;
    el.innerHTML = '<div class="bloco__duplo"><div><h4 class="bloco__subtitulo">' + esc(t1) + '</h4><div></div></div>' +
      '<div><h4 class="bloco__subtitulo">' + esc(t2) + '</h4><div></div></div></div>';
    var caixas = el.querySelectorAll('.bloco__duplo > div > div');
    return [caixas[0], caixas[1]];
  }

  function filtrarDiaSemana(ctx, dia) {
    var f = JSON.parse(JSON.stringify(ctx.f));
    var unico = f.diasSemana.length === 1 && f.diasSemana[0] === dia;
    f.diasSemana = unico ? [] : [dia];
    ctx.aplicarFiltro(f);
    BE.toast(unico ? 'Filtro de dia da semana removido.' : 'Filtro aplicado: ' + BE.dash.DIAS_NOMES[dia - 1] + '.', 'info');
  }

  var DESENHOS = {
    /* ---------- 1. Vendas e faturamento ---------- */
    's1-diasemana': function (ctx, el, obs) {
      var r = BE.dash.pedidosPorDiaSemana(ctx.f);
      BE.graficos.barras(el, {
        interativo: true, formato: 'inteiro', rotuloTabela: 'Dia da semana',
        categorias: r.categorias, series: r.series,
        rotuloCategoria: function (c) { return BE.dash.DIAS_NOMES[BE.dash.DIAS_CURTOS.indexOf(c)]; },
        titulo: 'Barras de pedidos concluídos por dia da semana e canal',
        aoClicar: function (i) { filtrarDiaSemana(ctx, i + 1); }
      });
      if (r.series.length) {
        var tot = r.categorias.map(function (c, i) { return somaLista(r.series.map(function (s) { return s.valores[i]; })); });
        var max = Math.max.apply(null, tot);
        obs.textContent = 'Mais pedidos: ' + r.categorias.filter(function (c, i) { return tot[i] === max; })
          .map(function (c) { return BE.dash.DIAS_NOMES[BE.dash.DIAS_CURTOS.indexOf(c)]; }).join(', ') +
          ' (' + formatar(max, 'inteiro') + '). Clique numa barra para filtrar o dia da semana.';
      } else {
        obs.textContent = 'Clique numa barra para filtrar o dia da semana.';
      }
    },
    's1-fds': function (ctx, el, obs) {
      var r = BE.dash.fimDeSemanaVsUtil(ctx.f);
      if (!r.length) { vazioHtml(el); obs.hidden = true; return; }
      var caixas = duplo(el, 'Pedidos por dia (média)', 'Ticket médio');
      var cats = r.map(function (x) { return x.grupo; });
      BE.graficos.barras(caixas[0], {
        interativo: true, rotulos: true, formato: function (v) { return PCT.format(v); }, rotuloTabela: 'Grupo', categorias: cats,
        series: [{ nome: 'Pedidos por dia', cor: '#2f7d4f', valores: r.map(function (x) { return x.pedidosPorDia; }) }],
        titulo: 'Pedidos concluídos por dia: ' + r.map(function (x) { return x.grupo + ' ' + PCT.format(x.pedidosPorDia || 0); }).join('; ')
      });
      BE.graficos.barras(caixas[1], {
        interativo: true, rotulos: true, formato: 'moeda', rotuloTabela: 'Grupo', categorias: cats,
        series: [{ nome: 'Ticket médio', cor: '#c98a12', valores: r.map(function (x) { return x.ticketMedio; }) }],
        titulo: 'Ticket médio: ' + r.map(function (x) { return x.grupo + ' ' + formatar(x.ticketMedio, 'moeda'); }).join('; ')
      });
      obs.hidden = false;
      obs.textContent = r.map(function (x) {
        return x.grupo + ': ' + formatar(x.pedidos, 'inteiro') + ' pedidos em ' + formatar(x.dias, 'inteiro') + ' dias, ' +
          formatar(x.faturamento, 'moeda');
      }).join(' · ') + '. A média por dia compensa o fim de semana ter menos dias.';
    },
    's1-participacao': function (ctx, el, obs) {
      var r = BE.dash.participacaoCanal(ctx.f);
      BE.graficos.barrasEmpilhadas(el, {
        cem: true, formato: 'percentual', participacao: false, rotuloTabela: 'Medida',
        categorias: r.length ? ['Faturamento', 'Pedidos'] : [],
        series: r.map(function (x) { return { nome: x.canal, valores: [x.partFaturamento, x.partPedidos] }; }),
        titulo: 'Barra 100% da participação de cada canal: ' + r.map(function (x) {
          return x.canal + ' ' + formatar(x.partFaturamento, 'percentual') + ' do faturamento';
        }).join('; ')
      });
      obs.hidden = !r.length;
      obs.textContent = r.map(function (x) {
        return x.canal + ': ' + formatar(x.faturamento, 'moeda') + ' em ' + formatar(x.pedidos, 'inteiro') + ' pedidos';
      }).join(' · ');
    },
    's1-kpis': function (ctx, el) {
      var k = BE.dash.kpis(ctx.f);
      if (!k.pedidos) { vazioHtml(el); return; }
      var rent = BE.dash.rentabilidadePorCanal(ctx.f);
      var bruto = somaLista(rent.map(function (x) { return x.bruto; }));
      var liq = somaLista(rent.map(function (x) { return x.liquido; }));
      var nDias = somaLista(BE.dash.fimDeSemanaVsUtil(ctx.f).map(function (x) { return x.dias; }));
      el._grafico = null;
      el.innerHTML = cartoesHtml([
        { rotulo: 'Pedidos no recorte', valor: formatar(k.pedidos, 'inteiro'), sub: 'concluídos e cancelados' },
        { rotulo: 'Concluídos por dia', valor: nDias ? PCT.format(k.pedidosConcluidos / nDias) : '—', sub: formatar(nDias, 'inteiro') + ' dias no calendário' },
        { rotulo: 'Cancelados', valor: formatar(k.cancelados, 'inteiro'), sub: 'taxa ' + formatar(k.taxaCancelamento, 'percentual'),
          alerta: k.taxaCancelamento > 15 },
        { rotulo: 'Retenção da plataforma', valor: formatar(bruto > 0 ? (bruto - liq) / bruto * 100 : null, 'percentual'),
          sub: '(bruto − líquido) ÷ bruto' },
        { rotulo: 'Valor bruto', valor: formatar(bruto, 'moeda'), sub: 'só concluídos' },
        { rotulo: 'Sobra de cada R$ 100', valor: formatar(bruto > 0 ? liq / bruto * 100 : null, 'moeda'), sub: 'líquido ÷ bruto × 100' }
      ]);
    },

    /* ---------- 2. Rentabilidade por canal ---------- */
    's2-cascata': function (ctx, el, obs) {
      var canais = (ctx.estado.opcoes && ctx.estado.opcoes.canais) || [];
      var escolha = ctx.estado.cascataCanal || 'Todos';
      if (escolha !== 'Todos' && canais.indexOf(escolha) < 0) escolha = ctx.estado.cascataCanal = 'Todos';
      var cc = ctx.raiz.querySelector('#dash-cc-s2-cascata');
      cc.innerHTML = ['Todos'].concat(canais).map(function (c) {
        return '<button type="button" class="segmentado__botao" data-cascata="' + esc(c) + '" aria-pressed="' + (c === escolha) + '">' +
          esc(c) + '</button>';
      }).join('');
      var f = escolha === 'Todos' ? ctx.f : BE.dash.comCanais(ctx.f, [escolha]);
      var etapas = BE.dash.cascata(f);
      BE.graficos.cascata(el, { etapas: etapas, formato: 'moeda',
        titulo: 'Cascata do bruto ao líquido (' + escolha + '): ' + etapas.map(function (e) { return e.rotulo + ' ' + BRL.format(e.valor); }).join('; ') });
      obs.hidden = !etapas.length;
      if (etapas.length) {
        var bruto = etapas[0].valor, liq = etapas[etapas.length - 1].valor;
        obs.textContent = (escolha === 'Todos' ? 'Todos os canais' : escolha) + ': de ' + BRL.format(bruto) + ' de valor bruto, chegam ' +
          BRL.format(liq) + ' ao caixa (' + formatar(bruto > 0 ? liq / bruto * 100 : null, 'percentual') + ').';
      }
    },
    's2-sobra': function (ctx, el) {
      var r = BE.dash.rentabilidadePorCanal(ctx.f);
      BE.graficos.barras(el, {
        interativo: true, rotulos: true, corPorCategoria: true, formato: 'moeda', rotuloTabela: 'Canal',
        categorias: r.map(function (x) { return x.canal; }),
        series: [{ nome: 'Sobra de cada R$ 100', cor: VERDE, valores: r.map(function (x) { return x.sobraCem; }) }],
        titulo: 'Quanto sobra de cada R$ 100 vendidos: ' + r.map(function (x) { return x.canal + ' ' + formatar(x.sobraCem, 'moeda'); }).join('; ')
      });
    },
    's2-custos': function (ctx, el, obs) {
      var r = BE.dash.rentabilidadePorCanal(ctx.f);
      var series = [
        { nome: 'Descontos', cor: '#c98a12', valores: r.map(function (x) { return x.pctDescontos; }) },
        { nome: 'Taxas e comissões', cor: VERDE, valores: r.map(function (x) { return x.pctTaxas; }) }
      ];
      if (r.length && r[0].pctMotoboy != null) series.push({ nome: 'Motoboy', cor: '#7fb393', valores: r.map(function (x) { return x.pctMotoboy; }) });
      BE.graficos.barrasEmpilhadas(el, {
        formato: 'percentual', participacao: false, rotuloTabela: 'Canal',
        categorias: r.map(function (x) { return x.canal; }), series: series,
        titulo: 'Custos como % do bruto por canal: ' + r.map(function (x) {
          return x.canal + ' descontos ' + formatar(x.pctDescontos, 'percentual') + ', taxas ' + formatar(x.pctTaxas, 'percentual') +
            (x.pctMotoboy != null ? ', motoboy ' + formatar(x.pctMotoboy, 'percentual') : '');
        }).join('; ')
      });
      obs.hidden = !r.length;
      obs.textContent = 'Cada barra soma o que sai do valor bruto dos concluídos. ' + r.map(function (x) {
        var custos = [['descontos', x.pctDescontos], ['taxas', x.pctTaxas], ['motoboy', x.pctMotoboy]]
          .filter(function (c) { return c[1] != null; }).sort(function (a, b) { return b[1] - a[1]; });
        return x.canal + ': o maior peso é ' + custos[0][0] + ' (' + formatar(custos[0][1], 'percentual') + ')';
      }).join(' · ') + '.';
    },

    /* ---------- 3. Cancelamentos ---------- */
    's3-taxa': function (ctx, el, obs) {
      var canc = BE.dash.cancelamentoPorCanal(ctx.f);
      BE.graficos.barras(el, {
        interativo: true, rotulos: true, corPorCategoria: true, formato: 'percentual', rotuloTabela: 'Canal',
        categorias: canc.map(function (c) { return c.canal; }),
        series: [{ nome: 'Taxa de cancelamento', cor: VERDE, valores: canc.map(function (c) { return c.taxa; }) }],
        titulo: 'Taxa de cancelamento por canal: ' + canc.map(function (c) { return c.canal + ' ' + formatar(c.taxa, 'percentual'); }).join('; ')
      });
      obs.hidden = !canc.length;
      obs.textContent = canc.map(function (c) {
        return c.canal + ': ' + formatar(c.cancelados, 'inteiro') + ' de ' + formatar(c.pedidos, 'inteiro') + ' pedidos';
      }).join(' · ');
    },
    's3-perdida': function (ctx, el, obs) {
      var r = BE.dash.receitaPerdida(ctx.f);
      var k = BE.dash.kpis(ctx.f);
      if (!r.cancelados) {
        vazioHtml(el, k.pedidos ? 'Nenhum pedido cancelado neste recorte' : null);
        obs.hidden = true;
        return;
      }
      el._grafico = null;
      el.innerHTML = cartoesHtml([{ rotulo: 'Receita perdida (bruto dos cancelados)', valor: BRL.format(r.total),
        sub: formatar(r.cancelados, 'inteiro') + ' pedidos · equivale a ' +
          formatar(k.faturamento > 0 ? r.total / k.faturamento * 100 : null, 'percentual') + ' do faturamento', alerta: true }]
        .concat(r.porCanal.map(function (x) {
          return { rotulo: x.canal, valor: BRL.format(x.valor), sub: formatar(x.cancelados, 'inteiro') + (x.cancelados === 1 ? ' cancelado' : ' cancelados') };
        })));
      obs.hidden = false;
    },
    's3-calor': function (ctx, el) {
      var m = BE.dash.cancelamentosPorDiaSemana(ctx.f);
      BE.graficos.mapaCalor(el, {
        linhas: m.linhas, colunas: m.colunas, valores: m.valores, formato: 'inteiro', rotuloTabela: 'Dia',
        titulo: 'Mapa de calor de pedidos cancelados por dia da semana e canal',
        dicaClique: 'clique para filtrar o dia',
        aoClicar: function (i) { filtrarDiaSemana(ctx, i + 1); }
      });
    },

    /* ---------- 4. Descontos e promoções ---------- */
    's4-medio': function (ctx, el, obs) {
      var r = BE.dash.descontoPorCanal(ctx.f);
      BE.graficos.barras(el, {
        interativo: true, rotulos: true, corPorCategoria: true, formato: 'moeda', rotuloTabela: 'Canal',
        categorias: r.map(function (x) { return x.canal; }),
        series: [{ nome: 'Desconto médio por pedido', cor: VERDE, valores: r.map(function (x) { return x.descontoMedio; }) }],
        titulo: 'Desconto médio por pedido concluído: ' + r.map(function (x) { return x.canal + ' ' + formatar(x.descontoMedio, 'moeda'); }).join('; ')
      });
      obs.hidden = !r.length;
      obs.textContent = r.map(function (x) {
        return x.canal + ': ' + BRL.format(x.descontos) + ' em ' + formatar(x.pedidos, 'inteiro') + ' pedidos concluídos';
      }).join(' · ');
    },
    's4-comsem': function (ctx, el) {
      var r = BE.dash.comSemDesconto(ctx.f);
      BE.graficos.rosca(el, {
        fatias: r.total ? [{ rotulo: 'Com desconto', valor: r.com, cor: '#c98a12' }, { rotulo: 'Sem desconto', valor: r.sem, cor: VERDE }] : [],
        formato: 'inteiro', centro: { valor: formatar(r.total, 'inteiro'), rotulo: r.total === 1 ? 'pedido' : 'pedidos' }
      });
    },
    's4-dispersao': function (ctx, el) {
      var r = BE.dash.descontoVsTicket(ctx.f);
      BE.graficos.dispersao(el, {
        pontos: r.map(function (x) { return { x: x.desconto, y: x.ticket, serie: x.canal, rotulo: String(x.id).slice(0, 8) }; }),
        formatoX: 'moeda', formatoY: 'moeda', rotuloX: 'Desconto', rotuloY: 'Total pago', rotuloTabela: 'Pedido',
        titulo: 'Dispersão de ' + r.length + ' pedidos concluídos: desconto × total pago, cor por canal'
      });
    },

    /* ---------- 5. Ticket médio ---------- */
    's5-distribuicao': function (ctx, el) {
      BE.graficos.boxplot(el, { grupos: BE.dash.distribuicaoTicket(ctx.f), formato: 'moeda' });
    },
    's5-pagamento': function (ctx, el) {
      var r = BE.dash.ticketPorPagamentoCanal(ctx.f);
      BE.graficos.barras(el, {
        interativo: true, formato: 'moeda', rotuloTabela: 'Forma de pagamento',
        categorias: r.categorias, series: r.series,
        dica: function (i, s, v) {
          var x = s.extras[i];
          return r.categorias[i] + ' · ' + s.nome + ': ticket ' + BRL.format(v) + ' (' + formatar(x.pedidos, 'inteiro') + (x.pedidos === 1 ? ' pedido)' : ' pedidos)');
        },
        titulo: 'Barras do ticket médio por forma de pagamento e canal'
      });
    },

    /* ---------- 6. Pagamento e entrega ---------- */
    's6-mix': function (ctx, el) {
      var mix = BE.dash.mixPagamentos(ctx.f);
      var total = somaLista(mix.map(function (x) { return x.pedidos; }));
      BE.graficos.rosca(el, {
        fatias: mix.map(function (x) { return { rotulo: x.forma, valor: x.pedidos }; }),
        formato: 'inteiro', centro: { valor: formatar(total, 'inteiro'), rotulo: total === 1 ? 'pedido' : 'pedidos' }
      });
    },
    's6-canal': function (ctx, el) {
      var r = BE.dash.pagamentoPorCanal(ctx.f);
      BE.graficos.barrasEmpilhadas(el, {
        cem: true, formato: 'inteiro', rotuloTabela: 'Canal', categorias: r.categorias, series: r.series,
        titulo: 'Barras 100% das formas de pagamento por canal'
      });
    },
    's6-entrega': function (ctx, el, obs) {
      var r = BE.dash.motoboyPorEntregaCanal(ctx.f);
      if (!r) {
        vazioHtml(el, 'Este banco não tem a coluna TAXA_MOTOBOY.');
        obs.hidden = true;
        return;
      }
      BE.graficos.barras(el, {
        interativo: true, rotulos: true, formato: 'moeda', rotuloTabela: 'Tipo de entrega',
        categorias: r.categorias, series: r.series,
        dica: function (i, s, v) {
          var x = s.extras[i];
          return r.categorias[i] + ' · ' + s.nome + ': ' + BRL.format(v) + ' por pedido (' + BRL.format(x.motoboy) + ' em ' +
            formatar(x.pedidos, 'inteiro') + ' pedidos)';
        },
        titulo: 'Custo de motoboy por pedido, por tipo de entrega e canal'
      });
      obs.hidden = !r.categorias.length;
      obs.textContent = 'TAXA_MOTOBOY ÷ pedidos concluídos. ' + r.series.map(function (s) {
        var tot = somaLista(s.extras.map(function (x) { return x ? x.motoboy : 0; }));
        var ped = somaLista(s.extras.map(function (x) { return x ? x.pedidos : 0; }));
        return s.nome + ': ' + BRL.format(tot) + ' no recorte (' + formatar(ped ? tot / ped : null, 'moeda') + ' por pedido)';
      }).join(' · ') + '.';
    },

    /* ---------- 7. Metas × realizado ---------- */
    's7-atingimento': function (ctx, el, obs) {
      var metas = BE.dash.metasNoPeriodo(ctx.f);
      var link = '<a href="#/metas">Cadastrar ou ver metas</a>';
      if (!metas.length) {
        vazioHtml(el, 'Nenhuma meta em andamento ou encerrada cruza este período.', '<p class="grafico__vazio-acao">' + link + '</p>');
        obs.hidden = true;
        return;
      }
      BE.graficos.progresso(el, {
        formato: 'moeda',
        vazio: 'As metas deste período têm valor zero.',
        itens: metas.map(function (m) {
          return {
            rotulo: m.nome, valor: m.realizado_valor, meta: m.meta_valor, status: m.status,
            detalhe: (m.status === 'andamento' ? 'em andamento, faltam ' + BRL.format(m.falta_valor) : 'encerrada') +
              ' · ' + ddmm(m.inicio) + ' a ' + ddmm(m.fim)
          };
        })
      });
      obs.hidden = false;
      obs.innerHTML = esc('Metas em andamento ou encerradas que cruzam o período do filtro. O realizado segue o canal e os dias da própria meta. ') + link;
    },
    's7-mensal': function (ctx, el, obs) {
      var r = BE.dash.realizadoMensalVsMeta(ctx.f);
      var temMeta = r.some(function (x) { return x.meta != null; });
      BE.graficos.barras(el, {
        interativo: true, rotulos: true, formato: 'moeda', rotuloTabela: 'Mês',
        categorias: r.map(function (x) { return x.mes; }),
        rotuloCategoria: function (m) { return BE.dash.MESES[+m.slice(5, 7) - 1] + '/' + m.slice(0, 4); },
        rotuloEixo: function (m) { return MESES_CURTOS[+m.slice(5, 7) - 1] + '/' + m.slice(2, 4); },
        series: [{ nome: 'Realizado', cor: '#f2b544', valores: r.map(function (x) { return x.realizado; }) }],
        referencia: temMeta ? { nome: 'Meta', valores: r.map(function (x) { return x.meta; }) } : null,
        titulo: 'Realizado mensal × meta: ' + r.map(function (x) {
          return x.mes + ' realizado ' + BRL.format(x.realizado) + (x.meta != null ? ', meta ' + BRL.format(x.meta) : ', sem meta');
        }).join('; ')
      });
      obs.hidden = !r.length;
      var unico = ctx.f.canais.length === 1 ? ctx.f.canais[0] : null;
      obs.innerHTML = esc(temMeta
        ? r.map(function (x) {
          return BE.dash.MESES[+x.mes.slice(5, 7) - 1] + ': ' + (x.meta == null ? 'sem meta' :
            (x.realizado >= x.meta ? 'meta batida' : 'faltaram ' + BRL.format(x.meta - x.realizado)));
        }).join(' · ') + '. Meta = soma das metas ' + (unico ? 'do canal ' + unico : 'da loja toda (sem canal)') + ' nos dias do recorte. '
        : 'Nenhuma meta ' + (unico ? 'do canal ' + unico : 'da loja toda') + ' nos meses do recorte. ') +
        '<a href="#/metas">Ir para Metas</a>';
    }
  };

  /* Desenha uma lista de blocos com o filtro do contexto; um erro não derruba os outros */
  function desenharBlocos(ctx, blocos) {
    blocos.forEach(function (b) {
      var el = ctx.g(b.id);
      var obs = ctx.raiz.querySelector('#dash-o-' + b.id);
      if (!el) return;
      try {
        if (b.tempo) desenharTempo(ctx, b);
        else if (DESENHOS[b.id]) DESENHOS[b.id](ctx, el, obs);
      } catch (e) {
        console.error(e);
        vazioHtml(el, 'Não foi possível montar este gráfico: ' + (e && e.message || e));
      }
    });
  }

  /* =====================================================================
   * Drill-down: pedidos de um dia
   * ===================================================================== */

  var COLUNAS_PEDIDOS = [
    ['id', 'ID'], ['canal', 'Canal'], ['status', 'Status'], ['pagamento', 'Pagamento'], ['entrega', 'Entrega'],
    ['bruto', 'Bruto'], ['desconto', 'Desconto'], ['taxas', 'Taxas'], ['totalPago', 'Total pago'], ['liquido', 'Líquido']
  ];
  var COLUNAS_MOEDA = ['bruto', 'desconto', 'taxas', 'totalPago', 'liquido'];

  function dialogoDia() {
    return '<dialog class="painel painel--largo" id="dash-dlg-dia" aria-labelledby="dash-dia-titulo">' +
      '<div class="painel__corpo">' +
      '  <header class="painel__topo"><div><h2 id="dash-dia-titulo">Pedidos do dia</h2><p class="painel__sub" id="dash-dia-sub"></p></div>' +
      '    <button type="button" class="botao-icone botao-icone--claro" data-fechar aria-label="Fechar">' + ic('x', 20) + '</button></header>' +
      '  <div class="painel__rolagem">' +
      '    <div id="dash-dia-resumo"></div>' +
      '    <div class="tabela-wrap" id="dash-dia-tabela"></div>' +
      '  </div>' +
      '  <footer class="painel__rodape">' +
      '    <button type="button" class="botao botao--secundario" id="dash-dia-csv">' + ic('download', 18) + '<span>Exportar CSV</span></button>' +
      '    <button type="button" class="botao botao--primario" data-fechar>Fechar</button>' +
      '  </footer>' +
      '</div></dialog>';
  }

  function celulaCsv(v) {
    if (v == null) return '';
    var t = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return /[;"\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }

  /* CSV no padrão brasileiro: separador ";", vírgula decimal e BOM para o Excel */
  function csvPedidos(linhas) {
    return '﻿' + [COLUNAS_PEDIDOS.map(function (c) { return c[1]; })].concat(linhas.map(function (l) {
      return COLUNAS_PEDIDOS.map(function (c) { return l[c[0]]; });
    })).map(function (r) { return r.map(celulaCsv).join(';'); }).join('\r\n');
  }

  function baixar(texto, nome) {
    var blob = new Blob([texto], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* =====================================================================
   * Exploração OLAP: matriz pivot e tabela de operações
   * ===================================================================== */

  /* Tabela da matriz: células coloridas na escala do mapa de calor (menta -> floresta) */
  function matrizHtml(m) {
    var F = m.medida.formato;
    var temColunas = !!m.colunas.dim;
    var internos = [];
    m.linhas.itens.forEach(function (l, i) {
      (temColunas ? m.valores[i] : [m.totaisLinha[i]]).forEach(function (v) { if (v != null) internos.push(v); });
    });
    var maximo = Math.max.apply(null, internos.concat([0]));
    function celula(v, colorir) {
      var estilo = '';
      if (colorir && v != null && maximo > 0 && v > 0) {
        var t = v / maximo;
        estilo = ' style="background:' + BE.graficos.corCalor(t) + ';color:' + (t > 0.5 ? '#ffffff' : '#0f3d2e') + '"';
      }
      return '<td class="num matriz__celula"' + estilo + ' data-valor="' + (v == null ? '' : v) + '">' + esc(formatar(v, F)) + '</td>';
    }
    var canto = m.linhas.rotulo + (temColunas ? ' \\ ' + m.colunas.rotulo : '');
    return '<div class="tabela-wrap"><table class="tabela tabela--matriz">' +
      '<caption class="visualmente-oculto">Matriz de ' + esc(m.medida.rotulo.toLowerCase()) + ' por ' + esc(m.linhas.rotulo.toLowerCase()) +
      (temColunas ? ' e ' + esc(m.colunas.rotulo.toLowerCase()) : '') + ', com totais</caption>' +
      '<thead><tr><th scope="col">' + esc(canto) + '</th>' +
      (temColunas ? m.colunas.itens.map(function (c) { return '<th scope="col" class="num">' + esc(c.rotulo) + '</th>'; }).join('') : '') +
      '<th scope="col" class="num matriz__total">' + (temColunas ? 'Total' : esc(m.medida.rotulo)) + '</th></tr></thead>' +
      '<tbody>' + m.linhas.itens.map(function (l, i) {
        return '<tr><th scope="row">' + esc(l.rotulo) + '</th>' +
          (temColunas ? m.valores[i].map(function (v) { return celula(v, true); }).join('') : '') +
          celula(m.totaisLinha[i], !temColunas).replace('matriz__celula"', 'matriz__celula matriz__total"') + '</tr>';
      }).join('') + '</tbody>' +
      '<tfoot><tr><th scope="row">Total</th>' +
      (temColunas ? m.totaisColuna.map(function (v) { return celula(v, false).replace('matriz__celula"', 'matriz__celula matriz__total"'); }).join('') : '') +
      celula(m.total, false).replace('matriz__celula"', 'matriz__celula matriz__total"') + '</tr></tfoot>' +
      '</table></div>';
  }

  /* Cartões de insight: Visualização → Insight → Decisão */
  function desenharInsights(caixa, f) {
    var vazioBanco;
    try { vazioBanco = !BE.db.resumo().pedidos; } catch (e) { vazioBanco = true; }
    if (vazioBanco) { vazioHtml(caixa, 'Importe dados para gerar insights'); return; }
    var cartoes;
    try {
      cartoes = BE.dash.insights(f);
    } catch (e) {
      console.error(e);
      vazioHtml(caixa, 'Não foi possível gerar os insights: ' + (e && e.message || e));
      return;
    }
    if (!cartoes.length) {
      vazioHtml(caixa, BE.dash.kpis(f).pedidos ? 'Nenhuma regra disparou neste recorte.' : null);
      return;
    }
    caixa._grafico = null;
    caixa.innerHTML = '<div class="insights">' + cartoes.map(function (c) {
      return '<article class="insight' + (c.alerta ? ' insight--alerta' : '') + '" data-insight="' + esc(c.id) + '">' +
        '<h4 class="insight__tema">' + ic(c.alerta ? 'alerta' : 'lampada', 18) + esc(c.tema) + '</h4>' +
        '<dl class="insight__passos">' +
        '<div><dt>Visualização</dt><dd>' + esc(c.visualizacao) + '</dd></div>' +
        '<div><dt>Insight</dt><dd>' + esc(c.insight) + '</dd></div>' +
        '<div><dt>Decisão</dt><dd>' + esc(c.decisao) + '</dd></div>' +
        '</dl></article>';
    }).join('') + '</div>';
  }

  /* CSV da matriz no padrão brasileiro, com os totais */
  function csvMatriz(m) {
    var temColunas = !!m.colunas.dim;
    var cab = [m.linhas.rotulo + (temColunas ? ' \\ ' + m.colunas.rotulo : '')]
      .concat(temColunas ? m.colunas.itens.map(function (c) { return c.rotulo; }) : [])
      .concat([temColunas ? 'Total' : m.medida.rotulo]);
    var linhas = m.linhas.itens.map(function (l, i) {
      return [l.rotulo].concat(temColunas ? m.valores[i] : []).concat([m.totaisLinha[i]]);
    });
    linhas.push(['Total'].concat(temColunas ? m.totaisColuna : []).concat([m.total]));
    return '﻿' + [cab].concat(linhas).map(function (r) { return r.map(celulaCsv).join(';'); }).join('\r\n');
  }

  function copiarTexto(texto) {
    function alternativo() {
      var ta = document.createElement('textarea');
      ta.value = texto;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok ? Promise.resolve() : Promise.reject(new Error('cópia bloqueada pelo navegador'));
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(texto).catch(alternativo);
    }
    return alternativo();
  }

  /* ---------- Desenho do painel (só o que depende do filtro) ---------- */

  function desenharKpis(raiz, f) {
    var k = BE.dash.kpis(f);
    var base = k.periodoAnterior ? BE.dash.textoPeriodo(k.periodoAnterior.inicio, k.periodoAnterior.fim) : '';
    KPIS.forEach(function (d) {
      var card = raiz.querySelector('[data-kpi="' + d.campo + '"]');
      var valor = k[d.campo];
      var ant = k.anterior ? k.anterior[d.campo] : null;
      var v = variacao(valor, ant);
      card.querySelector('.indicador__valor').textContent = formatar(valor, d.formato);
      var el = card.querySelector('.indicador__var');
      el.className = 'indicador__var indicador__var--' + v.classe;
      el.textContent = v.texto;
      el.title = v.classe === 'neutra' && v.texto === 'sem base'
        ? (k.periodoAnterior ? 'Sem dados em ' + base + ' para comparar' : 'Escolha início e fim para comparar com o período anterior')
        : 'Antes: ' + formatar(ant, d.formato) + ' (' + base + ')';
      card.querySelector('.indicador__sub').textContent = k.periodoAnterior ? 'vs. ' + base : 'sem período anterior';
    });
    return k;
  }

  function desenharPainel(ctx) {
    var raiz = ctx.raiz, f = ctx.f;
    var g = ctx.g;
    var obs = function (id) { return raiz.querySelector('#dash-o-' + id); };
    var k = desenharKpis(raiz, f);

    desenharTempo(ctx, PAINEL[0]);

    var etapas = BE.dash.cascata(f);
    BE.graficos.cascata(g('cascata'), { etapas: etapas, formato: 'moeda' });
    var bruto = etapas.length ? etapas[0].valor : 0;
    var liquido = etapas.length ? etapas[etapas.length - 1].valor : 0;
    obs('cascata').textContent = bruto > 0
      ? 'De cada R$ 100 vendidos (bruto), sobram ' + BRL.format(liquido / bruto * 100) + ' para a loja. ' +
        'Só pedidos concluídos; "Outros ajustes" fecha a conta entre o bruto e o líquido informado pelas plataformas.'
      : PAINEL[1].observacao;

    var canc = BE.dash.cancelamentoPorCanal(f);
    BE.graficos.barras(g('cancelamento'), {
      interativo: true, rotulos: true, corPorCategoria: true, formato: 'percentual', rotuloTabela: 'Canal',
      categorias: canc.map(function (c) { return c.canal; }),
      series: [{ nome: 'Taxa de cancelamento', cor: VERDE, valores: canc.map(function (c) { return c.taxa; }) }],
      titulo: 'Gráfico de barras da taxa de cancelamento por canal: ' + canc.map(function (c) {
        return c.canal + ' ' + formatar(c.taxa, 'percentual');
      }).join('; ')
    });
    var oc = obs('cancelamento');
    oc.hidden = !canc.length;
    oc.textContent = canc.map(function (c) {
      return c.canal + ': ' + INT.format(c.cancelados) + ' de ' + INT.format(c.pedidos) + ' pedidos';
    }).join(' · ') + (canc.length ? ' · total ' + formatar(k.taxaCancelamento, 'percentual') : '');

    var m = BE.dash.pedidosDiaSemanaPorSemana(f);
    BE.graficos.mapaCalor(g('calor'), {
      linhas: m.linhas, colunas: m.colunas, valores: m.valores, formato: 'inteiro', rotuloTabela: 'Dia',
      titulo: 'Mapa de calor de pedidos concluídos por dia da semana e semana do mês',
      dicaClique: 'clique para filtrar o dia',
      aoClicar: function (i) { filtrarDiaSemana(ctx, i + 1); }
    });

    var mix = BE.dash.mixPagamentos(f);
    var totalMix = mix.reduce(function (a, x) { return a + x.pedidos; }, 0);
    BE.graficos.rosca(g('pagamentos'), {
      fatias: mix.map(function (x) { return { rotulo: x.forma, valor: x.pedidos }; }),
      formato: 'inteiro', centro: { valor: INT.format(totalMix), rotulo: totalMix === 1 ? 'pedido' : 'pedidos' }
    });
  }

  /* ---------- Tela ---------- */

  function render(el) {
    el.classList.add('tela-dashboard');
    el.innerHTML = BE.cabecalho('Dashboard', 'Visão geral das vendas do iFood e do 99Food') +
      '<p class="impressao-recorte" id="dash-recorte-impressao"></p>' +
      barraFiltros() +
      '<div id="dash-aviso" aria-live="polite"></div>' +
      '<div id="dash-cobertura" aria-live="polite"></div>' +
      painelPrincipal() +
      secoes() +
      exploracao() +
      '<footer class="impressao-rodape" id="dash-rodape-impressao"></footer>' +
      dialogoDia();

    var aviso = el.querySelector('#dash-aviso');
    var cobertura = el.querySelector('#dash-cobertura');
    var caixaFiltros = el.querySelector('#dash-filtros');
    var resumo = el.querySelector('#dash-resumo');
    /* tempo: granularidade e foco de cada gráfico de tempo; olap: última descida e subida */
    var estado = { f: null, opcoes: null, tempo: {}, olap: { drill: null, roll: null }, cascataCanal: 'Todos', dia: null,
      pivot: JSON.parse(JSON.stringify(PIVOT_PADRAO)), matriz: null };
    var ctx = {
      raiz: el,
      estado: estado,
      g: function (id) { return el.querySelector('#dash-g-' + id); },
      aplicarFiltro: function (f) { aplicar(f, false); },
      abrirDia: abrirDia,
      desenharOlap: function () { if (estado.f) desenharOlap(); }
    };
    Object.defineProperty(ctx, 'f', { get: function () { return estado.f; } });

    function ativa() { return document.body.contains(el); }

    function blocoPorId(id) {
      var achado = null;
      PAINEL.concat.apply(PAINEL, SECOES.map(function (s) { return s.blocos; })).concat([OLAP_DRILL])
        .forEach(function (b) { if (b.id === id) achado = b; });
      return achado;
    }

    /* Seções abertas são desenhadas já; as fechadas, quando o usuário abrir (largura correta) */
    function desenharSecoes() {
      Array.prototype.forEach.call(el.querySelectorAll('details.secao-dash'), function (d) {
        if (d.open) {
          desenharBlocos(ctx, SECOES[+d.getAttribute('data-secao')].blocos);
          d.removeAttribute('data-sujo');
        } else {
          d.setAttribute('data-sujo', '1');
        }
      });
    }

    el.addEventListener('toggle', function (e) {
      var d = e.target;
      if (!d.classList || !d.classList.contains('secao-dash') || !d.open || !estado.f) return;
      if (d.hasAttribute('data-sujo')) {
        desenharBlocos(ctx, SECOES[+d.getAttribute('data-secao')].blocos);
        d.removeAttribute('data-sujo');
      } else {
        BE.graficos.redesenhar(d);
      }
    }, true);

    /* Seletor de granularidade, "voltar" do foco e canal da cascata */
    el.addEventListener('click', function (e) {
      var bt = e.target.closest('[data-gran], [data-subir], [data-cascata]');
      if (!bt || !estado.f) return;
      if (bt.hasAttribute('data-gran')) {
        trocarGranularidade(ctx, blocoPorId(bt.getAttribute('data-bloco')), bt.getAttribute('data-gran'));
      } else if (bt.hasAttribute('data-subir')) {
        var b = blocoPorId(bt.getAttribute('data-subir'));
        subirFoco(ctx, b);
        var sel = el.querySelector('[data-bloco="' + b.id + '"][aria-pressed="true"]');
        if (sel) sel.focus();
      } else {
        estado.cascataCanal = bt.getAttribute('data-cascata');
        desenharBlocos(ctx, [blocoPorId('s2-cascata')]);
        var novo = el.querySelector('[data-cascata="' + estado.cascataCanal.replace(/"/g, '\\"') + '"]');
        if (novo) novo.focus();
      }
    });

    /* ---------- Matriz (pivot) e operações OLAP ---------- */

    var selL = el.querySelector('#dash-mx-linhas'), selC = el.querySelector('#dash-mx-colunas'), selM = el.querySelector('#dash-mx-medida');

    function desenharMatriz() {
      var p = estado.pivot;
      selL.value = p.linhas;
      selC.value = p.colunas;
      selM.value = p.medida;
      /* A mesma dimensão não pode estar nas linhas e nas colunas */
      Array.prototype.forEach.call(selC.options, function (o) { o.disabled = o.value === p.linhas; });
      Array.prototype.forEach.call(selL.options, function (o) { o.disabled = o.value === p.colunas; });
      el.querySelector('#dash-mx-inverter').disabled = p.colunas === 'nenhuma';
      var caixa = ctx.g('matriz'), obs = el.querySelector('#dash-o-matriz');
      try {
        var m = BE.dash.matriz(estado.f, p.linhas, p.colunas, p.medida);
        estado.matriz = m;
        el.querySelector('#dash-mx-csv').disabled = m.vazio;
        if (m.vazio) {
          vazioHtml(caixa);
          obs.hidden = true;
          return;
        }
        caixa.innerHTML = matrizHtml(m);
        obs.hidden = false;
        obs.textContent = (m.medida.somavel
          ? 'Soma das linhas = soma das colunas = ' + formatar(m.total, m.medida.formato) + ' (total do recorte). '
          : 'Os totais são recalculados no banco (não são soma das células). ') +
          'Cores na escala do mapa de calor: quanto mais escuro, maior o valor.';
      } catch (e) {
        console.error(e);
        estado.matriz = null;
        vazioHtml(caixa, 'Não foi possível montar a matriz: ' + (e && e.message || e));
      }
    }

    function mudarPivot(novo, inverteu) {
      estado.pivot = novo;
      if (inverteu) estado.pivot.invertida = !estado.pivot.invertida;
      desenharMatriz();
      desenharOlap();
    }

    function aoMudarSelect() {
      var p = estado.pivot;
      var novo = { linhas: selL.value, colunas: selC.value, medida: selM.value, invertida: p.invertida };
      if (novo.colunas === novo.linhas) novo.colunas = 'nenhuma';
      mudarPivot(novo, false);
    }
    selL.addEventListener('change', aoMudarSelect);
    selC.addEventListener('change', aoMudarSelect);
    selM.addEventListener('change', aoMudarSelect);

    el.querySelector('#dash-mx-inverter').addEventListener('click', function () {
      var p = estado.pivot;
      if (p.colunas === 'nenhuma') return;
      mudarPivot({ linhas: p.colunas, colunas: p.linhas, medida: p.medida, invertida: p.invertida }, true);
      BE.toast('Pivot: linhas e colunas trocadas.', 'info');
    });

    el.querySelector('#dash-mx-csv').addEventListener('click', function () {
      var m = estado.matriz;
      if (!m || m.vazio) return;
      baixar(csvMatriz(m), 'matriz-' + m.linhas.dim + (m.colunas.dim ? '-' + m.colunas.dim : '') + '-' + m.medida.id + '.csv');
      BE.toast('CSV da matriz exportado.', 'sucesso');
    });

    function linhasOlap() {
      return BE.dash.operacoesOlap(estado.f, { drill: estado.olap.drill, roll: estado.olap.roll, pivot: estado.pivot });
    }

    function desenharOlap() {
      var caixa = el.querySelector('#dash-olap');
      try {
        var linhas = linhasOlap();
        estado.olapLinhas = linhas;
        caixa.innerHTML = BE.tabelaHtml(['Operação', 'Aplicação', 'Pergunta', 'Análise'],
          linhas.map(function (l) { return [l.operacao, l.aplicacao, l.pergunta, l.analise]; }))
          .replace('<table class="tabela">', '<table class="tabela tabela--olap">');
      } catch (e) {
        console.error(e);
        estado.olapLinhas = null;
        caixa.innerHTML = '<p class="grafico__vazio">Não foi possível montar a tabela: ' + esc(e && e.message || e) + '</p>';
      }
    }

    el.querySelector('#dash-olap-copiar').addEventListener('click', function () {
      if (!estado.olapLinhas) return;
      var md = BE.dash.olapMarkdown(estado.olapLinhas, 'Recorte: ' + BE.dash.resumoFiltros(estado.f));
      copiarTexto(md).then(function () {
        BE.toast('Tabela copiada em Markdown para a área de transferência.', 'sucesso');
      }, function (e) {
        BE.toast('Não foi possível copiar: ' + (e && e.message || e), 'erro');
      });
    });

    /* ---------- Painel com os pedidos de um dia ---------- */

    var dlgDia = el.querySelector('#dash-dlg-dia');

    function abrirDia(data, origem) {
      var linhas = BE.dash.pedidosDoDia(estado.f, data);
      estado.dia = { data: data, linhas: linhas, origem: origem };
      var concl = linhas.filter(function (l) { return l.venda; });
      var totalPago = Math.round(somaLista(concl.map(function (l) { return l.totalPago; })) * 100) / 100;
      var liquido = Math.round(somaLista(concl.map(function (l) { return l.liquido; })) * 100) / 100;
      el.querySelector('#dash-dia-titulo').textContent = 'Pedidos de ' + ddmmaaaa(data) + ' (' +
        BE.dash.DIAS_NOMES[BE.metas.datas.diaSemana(data) - 1] + ')';
      var resumoF = BE.dash.resumoFiltros(BE.dash.comPeriodo(estado.f, data, data));
      el.querySelector('#dash-dia-sub').textContent = 'Recorte: ' + resumoF;
      el.querySelector('#dash-dia-resumo').innerHTML = cartoesHtml([
        { rotulo: 'Pedidos', valor: formatar(linhas.length, 'inteiro'), sub: formatar(concl.length, 'inteiro') + ' concluídos · ' +
          formatar(linhas.length - concl.length, 'inteiro') + ' cancelados' },
        { rotulo: 'Total pago dos concluídos', valor: BRL.format(totalPago), sub: 'soma dos canais no gráfico do dia' },
        { rotulo: 'Líquido dos concluídos', valor: BRL.format(liquido) }
      ]);
      el.querySelector('#dash-dia-tabela').innerHTML = linhas.length
        ? BE.tabelaHtml(COLUNAS_PEDIDOS.map(function (c) { return c[1]; }), linhas.map(function (l) {
          return COLUNAS_PEDIDOS.map(function (c) {
            return COLUNAS_MOEDA.indexOf(c[0]) >= 0 ? BRL.format(l[c[0]]) : l[c[0]];
          });
        }), [5, 6, 7, 8, 9]).replace('<table class="tabela">', '<table class="tabela tabela--pedidos" data-total-pago="' + totalPago + '">')
        : '<p class="grafico__vazio">Nenhum pedido neste dia com os filtros ativos.</p>';
      el.querySelector('#dash-dia-csv').disabled = !linhas.length;
      if (!dlgDia.open) dlgDia.showModal();
      var fechar = dlgDia.querySelector('[data-fechar]');
      if (fechar) fechar.focus();
    }

    dlgDia.addEventListener('click', function (e) {
      if (e.target === dlgDia || e.target.closest('[data-fechar]')) dlgDia.close();
    });
    dlgDia.addEventListener('close', function () {
      var o = estado.dia && estado.dia.origem;
      if (o && document.body.contains(o)) o.focus();
    });
    el.querySelector('#dash-dia-csv').addEventListener('click', function () {
      if (!estado.dia || !estado.dia.linhas.length) return;
      baixar(csvPedidos(estado.dia.linhas), 'pedidos-' + estado.dia.data + '.csv');
      BE.toast('CSV com ' + estado.dia.linhas.length + ' pedidos exportado.', 'sucesso');
    });

    function aplicar(f, redesenharControles) {
      estado.f = BE.dash.normalizar(f);
      guardar(estado.f);
      if (redesenharControles) caixaFiltros.innerHTML = controlesFiltros(estado.f, estado.opcoes);
      else sincronizarChips();
      resumo.innerHTML = '<span class="filtros__resumo-rotulo">Recorte:</span> ' + esc(BE.dash.resumoFiltros(estado.f));
      el.querySelector('#dash-recorte-impressao').textContent = 'Recorte: ' + BE.dash.resumoFiltros(estado.f);
      desenharCobertura();
      /* Novo recorte: os gráficos de tempo mantêm a granularidade, mas saem do foco */
      Object.keys(estado.tempo).forEach(function (k) { estado.tempo[k].foco = null; });
      try {
        desenharPainel(ctx);
      } catch (e) {
        console.error(e);
        BE.toast('Não foi possível montar o painel: ' + (e && e.message || e), 'erro');
      }
      desenharSecoes();
      desenharBlocos(ctx, [OLAP_DRILL]);
      desenharMatriz();
      desenharOlap();
      desenharInsights(ctx.g('insights'), estado.f);
    }

    /* Mês do recorte sem pedidos de um canal (carga com uma plataforma só) */
    function desenharCobertura() {
      var textos = [];
      try { textos = BE.dash.textosCobertura(BE.dash.coberturaCanais(estado.f)); } catch (e) { console.error(e); }
      cobertura.innerHTML = textos.map(function (t) {
        return '<p class="alerta-milho alerta-milho--dash">' + ic('alerta', 18) + '<span>' + esc(t) + '</span></p>';
      }).join('');
    }

    function sincronizarChips() {
      Array.prototype.forEach.call(caixaFiltros.querySelectorAll('.chip-filtro'), function (b) {
        var lista = estado.f[b.getAttribute('data-grupo')];
        var marcado = b.hasAttribute('data-todos') ? !lista.length : lista.map(String).indexOf(b.getAttribute('data-valor')) >= 0;
        b.setAttribute('aria-pressed', String(marcado));
      });
      var ini = caixaFiltros.querySelector('#dash-f-inicio'), fim = caixaFiltros.querySelector('#dash-f-fim');
      if (ini && ini.value !== estado.f.inicio) ini.value = estado.f.inicio;
      if (fim && fim.value !== estado.f.fim) fim.value = estado.f.fim;
    }

    function copia() { return JSON.parse(JSON.stringify(estado.f)); }

    caixaFiltros.addEventListener('click', function (e) {
      var b = e.target.closest('.chip-filtro');
      if (!b) return;
      var f = copia();
      var campo = b.getAttribute('data-grupo');
      if (b.hasAttribute('data-todos')) {
        f[campo] = [];
      } else {
        var v = campo === 'diasSemana' ? +b.getAttribute('data-valor') : b.getAttribute('data-valor');
        var i = f[campo].indexOf(v);
        if (i >= 0) f[campo].splice(i, 1); else f[campo].push(v);
      }
      aplicar(f, false);
    });

    caixaFiltros.addEventListener('change', function (e) {
      if (e.target.type !== 'date') return;
      var f = copia();
      f.inicio = caixaFiltros.querySelector('#dash-f-inicio').value || '';
      f.fim = caixaFiltros.querySelector('#dash-f-fim').value || '';
      if (f.inicio && f.fim && f.inicio > f.fim) { var t = f.inicio; f.inicio = f.fim; f.fim = t; }
      aplicar(f, false);
    });

    el.querySelector('#dash-limpar').addEventListener('click', function () {
      aplicar(BE.dash.filtrosPadrao(), false);
      BE.toast('Filtros limpos: último mês com dados, todos os canais.', 'info');
    });

    var atualizar = function () {
      if (!ativa()) {
        document.removeEventListener('be:banco-alterado', atualizar);
        return;
      }
      var vazio;
      try { vazio = !BE.db.resumo().pedidos; } catch (e) { return; }
      aviso.innerHTML = vazio
        ? '<p class="aviso-discreto">' + ic('info', 18) +
          '<span>Ainda não há dados. Importe na aba <a href="#/importacao">Importação</a>.</span></p>'
        : '';
      estado.opcoes = BE.dash.opcoesFiltros();
      var f = estado.f || filtrosDaUrl() || lerGuardado() || BE.dash.filtrosPadrao();
      /* Banco que ganhou dados depois de aberto vazio: passa para o último mês com dados */
      if (estado.semDados && !vazio) f = BE.dash.filtrosPadrao();
      estado.semDados = vazio;
      aplicar(f, true);
    };

    /* ---------- Impressão: abre e desenha todas as seções; rodapé com data e aviso ---------- */

    var abertasAntes = null;
    var antesDeImprimir = function () {
      if (!ativa()) { window.removeEventListener('beforeprint', antesDeImprimir); return; }
      var agora = new Date();
      el.querySelector('#dash-rodape-impressao').textContent = 'Impresso em ' +
        agora.toLocaleDateString('pt-BR') + ' às ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) +
        ' · Documento com dados sigilosos da loja: uso interno, não compartilhe fora da equipe.';
      if (abertasAntes) return;
      abertasAntes = [];
      Array.prototype.forEach.call(el.querySelectorAll('details.secao-dash'), function (d) {
        abertasAntes.push(d.open);
        d.open = true;
        if (d.hasAttribute('data-sujo') && estado.f) {
          desenharBlocos(ctx, SECOES[+d.getAttribute('data-secao')].blocos);
          d.removeAttribute('data-sujo');
        }
      });
    };
    var depoisDeImprimir = function () {
      if (!ativa()) { window.removeEventListener('afterprint', depoisDeImprimir); return; }
      if (!abertasAntes) return;
      var antes = abertasAntes;
      abertasAntes = null;
      Array.prototype.forEach.call(el.querySelectorAll('details.secao-dash'), function (d, i) { d.open = antes[i]; });
    };
    window.addEventListener('beforeprint', antesDeImprimir);
    window.addEventListener('afterprint', depoisDeImprimir);
    el.querySelector('#dash-imprimir').addEventListener('click', function () {
      antesDeImprimir();
      window.print();
    });

    var espera = null;
    var aoRedimensionar = function () {
      if (!ativa()) { window.removeEventListener('resize', aoRedimensionar); return; }
      clearTimeout(espera);
      espera = setTimeout(function () { BE.graficos.redesenhar(el); }, 150);
    };
    window.addEventListener('resize', aoRedimensionar);

    BE.dbPronto.then(function () {
      atualizar();
      document.addEventListener('be:banco-alterado', atualizar);
    }, function () { /* o app já avisa que o banco está indisponível */ });
  }

  BE.telas.dashboard = { titulo: 'Dashboard', render: render };
})(window.BE);
