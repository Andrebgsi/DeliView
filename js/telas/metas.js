/*
 * Tela: Metas (metas por período)
 * Lista de metas em cartões, cada uma com período escolhido no calendário, dias da semana,
 * canal, barra de atingimento (cores do v1) e mini gráfico acumulado. O painel "Nova meta /
 * Editar meta" abre como modal no desktop e como folha de baixo para cima no celular.
 * Detalhes: gráfico diário Meta × Realizado e tabela por dia com ajuste manual.
 * Regras em BE.metas (js/consultas/metas.js); calendário em BE.ui.calendario; gráficos em BE.graficos.
 */
window.BE = window.BE || {};
BE.telas = BE.telas || {};

(function (BE) {
  'use strict';

  var esc = BE.escapar;
  var BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var BRL_SINAL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', signDisplay: 'exceptZero' });
  var INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  var DEC1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  var PCT = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var DIA_CURTO = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
  var COR_META = '#0f3d2e';
  var COR_REALIZADO = '#f2b544';
  var CANAIS_TODOS = 'iFood + 99Food';
  var FILTROS = [
    { id: 'todas', rotulo: 'Todas' },
    { id: 'andamento', rotulo: 'Em andamento' },
    { id: 'futura', rotulo: 'Futuras' },
    { id: 'encerrada', rotulo: 'Encerradas' }
  ];
  var SELOS = {
    andamento: { texto: 'Em andamento', classe: 'selo--andamento' },
    futura: { texto: 'Futura', classe: 'selo--futura' },
    encerrada: { texto: 'Encerrada', classe: 'selo--encerrada' }
  };

  /* Estado da sessão (sobrevive à troca de tela, não ao recarregar) */
  var estado = { filtro: 'todas', busca: '' };

  var raiz = null;
  var bancoAberto = false;
  var metas = [];
  var canais = [];
  var form = null;     // { id, cal, inicio, fim, opener }
  var det = null;      // { id, linhas, edicao: {}, salvando, opener }
  var $ = function (id) { return raiz && raiz.querySelector('#' + id); };

  function montada() { return raiz && document.body.contains(raiz); }

  /* ------------------------------------------------------------------ */
  /* Formatação                                                          */
  /* ------------------------------------------------------------------ */

  function pct(v) { return PCT.format(v) + '%'; }
  function ddmm(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }
  function ddmmaaaa(iso) { return ddmm(iso) + '/' + iso.slice(0, 4); }

  /* "01/08 a 31/08/2026"; anos diferentes: "15/12/2026 a 15/01/2027"; um dia: "15/08/2026" */
  function periodo(inicio, fim) {
    if (inicio === fim) return ddmmaaaa(inicio);
    if (inicio.slice(0, 4) === fim.slice(0, 4)) return ddmm(inicio) + ' a ' + ddmmaaaa(fim);
    return ddmmaaaa(inicio) + ' a ' + ddmmaaaa(fim);
  }

  function diasResumo(dias) {
    if (dias === '1234567') return 'todos os dias';
    if (dias === '12345') return 'seg a sex';
    return dias.split('').map(function (d) { return DIA_CURTO[+d]; }).join(', ');
  }

  function nomeCanal(id) {
    if (id == null) return CANAIS_TODOS;
    for (var i = 0; i < canais.length; i++) if (canais[i].id === id) return canais[i].nome;
    return 'Canal ' + id;
  }

  /* Regra de cor do v1: >= 100% folha, >= 70% milho, abaixo vermelho */
  function classeAtingimento(p) {
    if (p >= 100) return 'barra__preenchido--ok';
    if (p >= 70) return 'barra__preenchido--medio';
    return 'barra__preenchido--baixo';
  }

  function barra(p, rotulo) {
    return '<div class="barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
      Math.round(Math.min(100, p)) + '" aria-label="' + esc(rotulo) + '">' +
      '<div class="barra__preenchido ' + classeAtingimento(p) + '" style="width:' + Math.min(100, Math.max(0, p)) + '%"></div></div>';
  }

  /* ------------------------------------------------------------------ */
  /* Montagem                                                            */
  /* ------------------------------------------------------------------ */

  function render(el) {
    raiz = el;
    form = det = null;
    el.innerHTML =
      '<header class="cabecalho-tela"><div>' +
      '  <h1>Metas</h1><p>Crie metas para qualquer período e acompanhe o atingimento</p></div>' +
      '  <button type="button" class="botao botao--primario" id="met-nova" disabled>' +
      '    <span aria-hidden="true" class="mais">+</span><span>Nova meta</span></button>' +
      '</header>' +

      '<div id="met-aviso"></div>' +

      '<div class="metas-filtros" id="met-filtros" hidden>' +
      '  <div class="segmentado" role="group" aria-label="Filtrar metas por situação">' +
      FILTROS.map(function (f) {
        return '<button type="button" class="segmentado__botao" data-filtro="' + f.id + '" aria-pressed="false">' +
          esc(f.rotulo) + ' <span class="segmentado__contagem" data-contagem="' + f.id + '"></span></button>';
      }).join('') +
      '  </div>' +
      '  <label class="campo campo--busca" for="met-busca"><span class="visualmente-oculto">Buscar meta por nome</span>' +
      '    <input type="search" id="met-busca" placeholder="Buscar por nome" autocomplete="off"></label>' +
      '</div>' +

      '<section class="metas-lista" id="met-lista" aria-label="Lista de metas" aria-live="polite">' +
      '  <p class="carregando">' + BE.icone('carregando', 18) + '<span>Carregando o banco…</span></p></section>' +

      '<p class="nota-rodape">Realizado = valor total pago pelos clientes nos pedidos concluídos (iFood + 99Food, ou só o canal da meta).</p>' +

      dialogoForm() + dialogoDetalhe();

    $('met-busca').value = estado.busca;
    ligarEventos();

    BE.dbPronto.then(function () {
      bancoAberto = true;
      if (!montada()) return;
      $('met-nova').disabled = false;
      atualizar();
    }, function (erro) {
      if (!montada()) return;
      $('met-lista').innerHTML = BE.estadoVazio('alerta', 'Banco indisponível', String((erro && erro.message) || erro));
    });
  }

  function dialogoForm() {
    var chips = [1, 2, 3, 4, 5, 6, 7].map(function (d) {
      return '<label class="chip-dia"><input type="checkbox" name="dia" value="' + d + '" checked>' +
        '<span>' + DIA_CURTO[d] + '</span></label>';
    }).join('');
    return '<dialog class="painel" id="met-dlg-form" aria-labelledby="met-form-titulo">' +
      '<form class="painel__corpo" id="met-form" novalidate>' +
      '  <header class="painel__topo"><h2 id="met-form-titulo">Nova meta</h2>' +
      '    <button type="button" class="botao-icone botao-icone--claro" data-fechar aria-label="Fechar">' + BE.icone('x', 20) + '</button></header>' +
      '  <div class="painel__rolagem">' +
      '    <label class="campo" for="met-nome">Nome' +
      '      <input type="text" id="met-nome" maxlength="120" placeholder="ex.: Agosto" autocomplete="off"></label>' +
      '    <fieldset class="grupo"><legend>Período</legend><div id="met-cal"></div></fieldset>' +
      '    <fieldset class="grupo"><legend>Dias da semana que contam</legend>' +
      '      <div class="chips-dias" id="met-dias">' + chips + '</div></fieldset>' +
      '    <div class="form-grade">' +
      '      <label class="campo" for="met-canal">Canal<select id="met-canal"></select></label>' +
      '      <label class="campo" for="met-distribuicao">Distribuição<select id="met-distribuicao">' +
      '        <option value="igual">Igual por dia</option>' +
      '        <option value="proporcional">Proporcional ao dia da semana</option></select></label>' +
      '      <label class="campo" for="met-valor">Meta de faturamento (R$)' +
      '        <input type="text" id="met-valor" inputmode="decimal" placeholder="0,00" autocomplete="off"></label>' +
      '      <label class="campo" for="met-qtd">Meta de pedidos' +
      '        <input type="number" id="met-qtd" min="0" step="1" inputmode="numeric" placeholder="0"></label>' +
      '    </div>' +
      '    <p class="resumo-vivo" id="met-resumo" aria-live="polite"></p>' +
      '    <p class="aviso-edicao" id="met-aviso-edicao" hidden>' + BE.icone('alerta', 16) +
      '<span>Salvar redistribui os valores diários e desfaz ajustes manuais</span></p>' +
      '    <p class="erro-campo" id="met-erro-form" role="alert"></p>' +
      '  </div>' +
      '  <footer class="painel__rodape">' +
      '    <button type="button" class="botao botao--secundario" data-fechar>Cancelar</button>' +
      '    <button type="submit" class="botao botao--primario" id="met-salvar">' + BE.icone('check', 18) + '<span>Criar meta</span></button>' +
      '  </footer>' +
      '</form></dialog>';
  }

  function dialogoDetalhe() {
    return '<dialog class="painel painel--largo" id="met-dlg-det" aria-labelledby="met-det-titulo">' +
      '<div class="painel__corpo">' +
      '  <header class="painel__topo"><div><h2 id="met-det-titulo">Detalhes</h2><p class="painel__sub" id="met-det-sub"></p></div>' +
      '    <button type="button" class="botao-icone botao-icone--claro" data-fechar aria-label="Fechar">' + BE.icone('x', 20) + '</button></header>' +
      '  <div class="painel__rolagem">' +
      '    <h3 class="painel__secao">Meta × Realizado por dia</h3>' +
      '    <div id="met-det-grafico"></div>' +
      '    <h3 class="painel__secao">Metas por dia</h3>' +
      '    <p class="cartao__nota">Altere a meta de um dia e clique em Salvar. O total da meta passa a ser a soma dos dias.</p>' +
      '    <p class="erro-campo" id="met-erro-det" role="alert"></p>' +
      '    <div class="tabela-wrap" id="met-det-tabela"></div>' +
      '  </div>' +
      '</div></dialog>';
  }

  /* Atualiza a tela quando o banco muda por fora (importação, restauração, apagar) */
  document.addEventListener('be:banco-alterado', function () {
    if (bancoAberto && montada()) atualizar();
  });

  /* ------------------------------------------------------------------ */
  /* Eventos                                                             */
  /* ------------------------------------------------------------------ */

  function ligarEventos() {
    $('met-nova').addEventListener('click', function (e) { abrirForm(null, e.currentTarget); });

    $('met-filtros').addEventListener('click', function (e) {
      var b = e.target.closest('[data-filtro]');
      if (!b) return;
      estado.filtro = b.getAttribute('data-filtro');
      desenharLista();
    });
    $('met-busca').addEventListener('input', function (e) {
      estado.busca = e.target.value;
      desenharLista();
    });

    $('met-lista').addEventListener('click', function (e) {
      var b = e.target.closest('[data-acao]');
      if (!b) return;
      var id = +b.getAttribute('data-id');
      var acao = b.getAttribute('data-acao');
      if (acao === 'nova') abrirForm(null, b);
      else if (acao === 'detalhes') abrirDetalhe(id, b);
      else if (acao === 'editar') abrirForm(id, b);
      else if (acao === 'repetir') repetir(id, b);
      else if (acao === 'excluir') excluir(id);
    });

    /* Diálogos: botões de fechar, clique no fundo e Esc devolvem o foco a quem abriu */
    ['met-dlg-form', 'met-dlg-det'].forEach(function (id) {
      var dlg = $(id);
      dlg.addEventListener('click', function (e) {
        if (e.target === dlg || e.target.closest('[data-fechar]')) dlg.close();
      });
      dlg.addEventListener('close', function () {
        var info = id === 'met-dlg-form' ? form : det;
        if (id === 'met-dlg-form') form = null; else det = null;
        devolverFoco(info && info.opener);
      });
    });

    /* Formulário */
    $('met-form').addEventListener('submit', function (e) { e.preventDefault(); salvarForm(); });
    $('met-form').addEventListener('input', function (e) {
      if (e.target.removeAttribute) e.target.removeAttribute('aria-invalid');
      atualizarResumo();
    });
    $('met-form').addEventListener('change', function (e) {
      if (e.target.name === 'dia' && form && form.cal) form.cal.definirDiasSemana(diasMarcados());
      atualizarResumo();
    });

    /* Tabela do detalhe */
    var tabela = $('met-det-tabela');
    tabela.addEventListener('input', function (e) {
      var campo = e.target.getAttribute('data-campo');
      if (!campo || !det) return;
      var dia = e.target.getAttribute('data-dia');
      var ed = det.edicao[dia] || (det.edicao[dia] = valoresSalvos(dia));
      ed[campo] = e.target.value;
      e.target.removeAttribute('aria-invalid');
      var b = raiz.querySelector('[data-salvar="' + dia + '"]');
      if (b) b.hidden = !alterado(dia);
    });
    tabela.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.getAttribute('data-campo')) {
        e.preventDefault();
        salvarDia(e.target.getAttribute('data-dia'));
      }
    });
    tabela.addEventListener('click', function (e) {
      var b = e.target.closest('[data-salvar]');
      if (b) salvarDia(b.getAttribute('data-salvar'));
    });
  }

  /* O cartão pode ter sido redesenhado enquanto o painel estava aberto: procura o botão equivalente */
  function devolverFoco(opener) {
    if (!opener || !montada()) return;
    var alvo = opener;
    if (!document.body.contains(alvo)) {
      var acao = opener.getAttribute('data-acao'), id = opener.getAttribute('data-id');
      alvo = (acao && id && raiz.querySelector('[data-acao="' + acao + '"][data-id="' + id + '"]')) || $('met-nova');
    }
    if (alvo) alvo.focus();
  }

  function mostrarErro(id, msg) { var p = $(id); if (p) p.textContent = msg; }

  /* ------------------------------------------------------------------ */
  /* Lista                                                               */
  /* ------------------------------------------------------------------ */

  function atualizar() {
    if (!montada()) return;
    var temPedidos;
    try {
      metas = BE.metas.listar();
      canais = BE.metas.canais();
      temPedidos = BE.db.consultar('SELECT COUNT(*) AS n FROM FATO_PEDIDO')[0].n > 0;
    } catch (e) {
      $('met-lista').innerHTML = BE.estadoVazio('alerta', 'Não foi possível ler as metas', e.message);
      return;
    }
    desenharAviso(temPedidos);
    desenharLista();
    if (det) desenharDetalhe();
  }

  function desenharAviso(temPedidos) {
    $('met-aviso').innerHTML = temPedidos ? '' :
      '<div class="estado-vazio estado-vazio--compacto">' +
      '<div class="estado-vazio__icone">' + BE.icone('upload', 24) + '</div>' +
      '<h2>Ainda não há vendas no banco</h2>' +
      '<p>Importe os dados na aba Importação para comparar metas com vendas. Mesmo assim, você já pode cadastrar as metas.</p>' +
      '<a class="botao botao--secundario" href="#/importacao">' + BE.icone('upload', 18) + '<span>Ir para Importação</span></a>' +
      '</div>';
  }

  function filtradas() {
    var termo = estado.busca.trim().toLocaleLowerCase('pt-BR');
    return metas.filter(function (m) {
      return (estado.filtro === 'todas' || m.status === estado.filtro) &&
        (!termo || m.nome.toLocaleLowerCase('pt-BR').indexOf(termo) >= 0);
    });
  }

  function desenharLista() {
    var filtros = $('met-filtros');
    filtros.hidden = metas.length === 0;
    Array.prototype.forEach.call(filtros.querySelectorAll('[data-filtro]'), function (b) {
      var f = b.getAttribute('data-filtro');
      b.setAttribute('aria-pressed', f === estado.filtro ? 'true' : 'false');
      var n = f === 'todas' ? metas.length : metas.filter(function (m) { return m.status === f; }).length;
      b.querySelector('[data-contagem]').textContent = '(' + n + ')';
    });

    var lista = $('met-lista');
    if (!metas.length) {
      lista.innerHTML = estadoVazioMetas();
      return;
    }
    var itens = filtradas();
    if (!itens.length) {
      lista.innerHTML = '<p class="metas-lista__vazia">Nenhuma meta encontrada com este filtro' +
        (estado.busca.trim() ? ' e esta busca' : '') + '.</p>';
      return;
    }
    lista.innerHTML = itens.map(cartao).join('');
    var hoje = BE.metas.hoje();
    itens.forEach(function (m) {
      var alvo = lista.querySelector('[data-grafico="' + m.id + '"]');
      if (!alvo) return;
      var porValor = m.meta_valor > 0;
      BE.graficos.acumulado(alvo, m.serie, {
        hoje: m.status === 'andamento' ? hoje : null,
        meta: porValor ? 'meta_acum' : 'meta_qtd_acum',
        realizado: porValor ? 'realizado_acum' : 'realizado_qtd_acum',
        formato: porValor ? 'moeda' : 'inteiro',
        largura: alvo.clientWidth || 280
      });
    });
  }

  function estadoVazioMetas() {
    return '<div class="estado-vazio estado-vazio--metas">' +
      '<svg class="ilustracao" width="120" height="96" viewBox="0 0 120 96" aria-hidden="true" focusable="false">' +
      '<rect x="10" y="14" width="80" height="70" rx="12" fill="#e4f0e8"/>' +
      '<rect x="10" y="14" width="80" height="18" rx="9" fill="#2f7d4f"/>' +
      '<rect x="26" y="6" width="6" height="16" rx="3" fill="#0f3d2e"/><rect x="68" y="6" width="6" height="16" rx="3" fill="#0f3d2e"/>' +
      '<g fill="#ffffff"><rect x="20" y="40" width="12" height="10" rx="3"/><rect x="38" y="40" width="12" height="10" rx="3"/>' +
      '<rect x="56" y="40" width="12" height="10" rx="3"/><rect x="20" y="56" width="12" height="10" rx="3"/></g>' +
      '<rect x="38" y="56" width="30" height="10" rx="5" fill="#0f3d2e"/>' +
      '<circle cx="92" cy="66" r="20" fill="#ffffff" stroke="#f2b544" stroke-width="5"/>' +
      '<circle cx="92" cy="66" r="9" fill="none" stroke="#f2b544" stroke-width="5"/>' +
      '<circle cx="92" cy="66" r="2.5" fill="#0f3d2e"/></svg>' +
      '<h2>Suas metas aparecem aqui</h2>' +
      '<p>Nenhuma meta ainda. Crie a primeira escolhendo o período no calendário.</p>' +
      '<button type="button" class="botao botao--primario" data-acao="nova"><span aria-hidden="true" class="mais">+</span><span>Nova meta</span></button>' +
      '</div>';
  }

  /* Meses da meta sem pedidos de um canal no banco (carga com uma plataforma só) */
  function avisoCobertura(m) {
    if (!BE.dash || !BE.dash.coberturaCanais) return '';
    var textos = [];
    try {
      var canal = m.id_canal == null ? [] : [nomeCanal(m.id_canal)];
      textos = BE.dash.textosCobertura(BE.dash.coberturaCanais({ inicio: m.inicio, fim: m.fim, canais: canal }), { curto: true });
    } catch (e) { console.error(e); }
    return textos.map(function (x) {
      return '<p class="meta-cartao__aviso">' + BE.icone('alerta', 16) + '<span>' + esc(x) + '</span></p>';
    }).join('');
  }

  function cartao(m) {
    var selo = SELOS[m.status];
    var nome = esc(m.nome);
    var linhas = '';
    if (m.meta_valor > 0) {
      var p = m.atingimento_valor;
      linhas += '<div class="meta-cartao__medida">' +
        '<p><strong>' + BRL.format(m.realizado_valor) + '</strong> <span class="sutil-txt">/ ' + BRL.format(m.meta_valor) + '</span>' +
        '<span class="meta-cartao__pct">' + pct(p) + '</span></p>' +
        barra(p, 'Atingimento do faturamento de ' + m.nome) + '</div>';
    }
    if (m.meta_qtd > 0) {
      var pq = m.atingimento_qtd;
      linhas += '<div class="meta-cartao__medida meta-cartao__medida--pedidos">' +
        '<p><strong>' + INT.format(m.realizado_qtd) + '</strong> <span class="sutil-txt">/ ' + INT.format(m.meta_qtd) + ' pedidos</span>' +
        '<span class="meta-cartao__pct">' + pct(pq) + '</span></p>' +
        (m.meta_valor > 0 ? '' : barra(pq, 'Atingimento de pedidos de ' + m.nome)) + '</div>';
    }

    var rodape = '';
    if (m.status === 'andamento') {
      if (m.meta_valor > 0) {
        rodape = m.falta_valor > 0
          ? 'Faltam <strong>' + BRL.format(m.falta_valor) + '</strong> · ritmo necessário <strong>' + BRL.format(m.ritmo_necessario_dia) + '/dia</strong>'
          : '<strong>Meta de faturamento atingida.</strong>';
      } else {
        rodape = m.falta_qtd > 0
          ? 'Faltam <strong>' + INT.format(m.falta_qtd) + ' pedidos</strong> · ritmo necessário <strong>' + INT.format(m.ritmo_necessario_qtd_dia) + ' pedidos/dia</strong>'
          : '<strong>Meta de pedidos atingida.</strong>';
      }
    } else if (m.status === 'futura') {
      rodape = 'Começa em ' + ddmmaaaa(m.inicio) + ' · ' + m.dias_elegiveis + ' dia' + (m.dias_elegiveis === 1 ? '' : 's') + ' elegíve' + (m.dias_elegiveis === 1 ? 'l' : 'is');
    }

    var acao = function (a, icone, texto, extra) {
      return '<button type="button" class="botao-acao' + (extra || '') + '" data-acao="' + a + '" data-id="' + m.id + '"' +
        ' aria-label="' + esc(texto + ': ' + m.nome) + '">' + BE.icone(icone, 16) + '<span>' + texto + '</span></button>';
    };

    return '<article class="meta-cartao" aria-labelledby="met-c-' + m.id + '">' +
      '<header class="meta-cartao__topo"><div>' +
      '  <h2 class="meta-cartao__nome" id="met-c-' + m.id + '">' + nome + '</h2>' +
      '  <p class="meta-cartao__periodo">' + periodo(m.inicio, m.fim) + ' · ' + diasResumo(m.dias_semana) + '</p>' +
      '  <p class="meta-cartao__canal">' + esc(nomeCanal(m.id_canal)) + '</p>' +
      '</div><span class="selo ' + selo.classe + '">' + selo.texto + '</span></header>' +
      linhas +
      '<figure class="meta-cartao__grafico"><div data-grafico="' + m.id + '"></div>' +
      '<figcaption class="legenda-mini"><span class="legenda-mini__meta">Meta acumulada</span>' +
      '<span class="legenda-mini__real">Realizado acumulado</span></figcaption></figure>' +
      (rodape ? '<p class="meta-cartao__ritmo">' + rodape + '</p>' : '') +
      avisoCobertura(m) +
      '<footer class="meta-cartao__acoes">' +
      acao('detalhes', 'tabela', 'Detalhes') +
      acao('editar', 'lapis', 'Editar') +
      acao('repetir', 'repetir', 'Repetir no próximo mês') +
      acao('excluir', 'lixeira', 'Excluir', ' botao-acao--perigo') +
      '</footer></article>';
  }

  /* ------------------------------------------------------------------ */
  /* Ações da lista                                                      */
  /* ------------------------------------------------------------------ */

  function repetir(id, botao) {
    botao.disabled = true;
    BE.metas.duplicar(id, 'proximo-mes').then(function (r) {
      var nova = BE.metas.obter(r.id);
      BE.toast('Meta "' + nova.nome + '" criada para ' + periodo(nova.inicio, nova.fim) + '.', 'sucesso');
      if (estado.filtro !== 'todas' && estado.filtro !== nova.status) estado.filtro = 'todas';
    }, function (e) {
      BE.toast('Não foi possível repetir a meta: ' + e.message, 'erro');
    }).then(function () {
      if (montada()) atualizar();
    });
  }

  function excluir(id) {
    var m = metas.filter(function (x) { return x.id === id; })[0];
    if (!m) return;
    if (!window.confirm('Excluir a meta "' + m.nome + '" (' + periodo(m.inicio, m.fim) + ')? As metas diárias dela também serão apagadas.')) return;
    BE.metas.excluir(id).then(function () {
      BE.toast('Meta "' + m.nome + '" excluída.', 'sucesso');
    }, function (e) {
      BE.toast('Não foi possível excluir: ' + e.message, 'erro');
    }).then(function () {
      if (!montada()) return;
      atualizar();
      var foco = raiz.querySelector('.meta-cartao [data-acao="detalhes"]') || $('met-nova');
      foco.focus();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Painel Nova meta / Editar meta                                      */
  /* ------------------------------------------------------------------ */

  function abrirForm(id, opener) {
    var m = id == null ? null : metas.filter(function (x) { return x.id === id; })[0];
    if (id != null && !m) return;
    form = { id: m ? m.id : null, opener: opener, inicio: m ? m.inicio : null, fim: m ? m.fim : null };

    $('met-form-titulo').textContent = m ? 'Editar meta' : 'Nova meta';
    $('met-salvar').querySelector('span').textContent = m ? 'Salvar alterações' : 'Criar meta';
    $('met-aviso-edicao').hidden = !m;
    mostrarErro('met-erro-form', '');
    $('met-nome').value = m ? m.nome : '';
    $('met-valor').value = m && m.meta_valor ? String(m.meta_valor).replace('.', ',') : '';
    $('met-qtd').value = m && m.meta_qtd ? String(m.meta_qtd) : '';
    $('met-distribuicao').value = m ? m.distribuicao : 'igual';
    var dias = m ? m.dias_semana : '1234567';
    Array.prototype.forEach.call(raiz.querySelectorAll('#met-dias input'), function (c) { c.checked = dias.indexOf(c.value) >= 0; });
    Array.prototype.forEach.call(raiz.querySelectorAll('#met-form [aria-invalid]'), function (c) { c.removeAttribute('aria-invalid'); });

    $('met-canal').innerHTML = '<option value="">Todos (' + CANAIS_TODOS + ')</option>' +
      canais.map(function (c) { return '<option value="' + c.id + '">' + esc(c.nome) + '</option>'; }).join('');
    $('met-canal').value = m && m.id_canal != null ? String(m.id_canal) : '';

    var vendas = {}, mesDados = null;
    try { vendas = BE.metas.diasComVenda(); mesDados = BE.metas.ultimoMesComDados(); } catch (e) { /* banco sem dados */ }
    form.cal = BE.ui.calendario($('met-cal'), {
      inicio: form.inicio, fim: form.fim, diasSemana: dias, diasComVenda: vendas, mesComDados: mesDados,
      onChange: function (p) {
        form.inicio = p.inicio;
        form.fim = p.fim;
        atualizarResumo();
      }
    });
    atualizarResumo();
    $('met-dlg-form').showModal();
    $('met-nome').focus();
  }

  function diasMarcados() {
    return Array.prototype.filter.call(raiz.querySelectorAll('#met-dias input'), function (c) { return c.checked; })
      .map(function (c) { return c.value; }).join('');
  }

  function lerForm() {
    var inValor = $('met-valor');
    return {
      nome: $('met-nome').value,
      inicio: form.inicio,
      fim: form.fim,
      diasSemana: diasMarcados(),
      idCanal: $('met-canal').value === '' ? null : +$('met-canal').value,
      valor: inValor.value,
      qtd: $('met-qtd').validity && $('met-qtd').validity.badInput ? 'x' : $('met-qtd').value,
      distribuicao: $('met-distribuicao').value
    };
  }

  /* "23 dias elegíveis · R$ 434,78 por dia" */
  function atualizarResumo() {
    if (!form) return;
    var out = $('met-resumo');
    if (!form.inicio || !form.fim) {
      out.textContent = form.inicio ? 'Escolha o dia final do período no calendário.' : 'Escolha o período no calendário.';
      return;
    }
    var def = lerForm();
    var n = BE.metas.diasElegiveis(def.inicio, def.fim, def.diasSemana).length;
    if (!n) { out.textContent = 'Nenhum dia elegível: marque os dias da semana que contam.'; return; }
    var partes = [n + (n === 1 ? ' dia elegível' : ' dias elegíveis')];
    var valor = BE.metas.numero(def.valor), qtd = BE.metas.numero(def.qtd);
    if (valor > 0) partes.push(BRL.format(Math.round((valor / n) * 100) / 100) + ' por dia');
    if (qtd > 0) partes.push(DEC1.format(qtd / n) + ' pedidos por dia');
    out.textContent = partes.join(' · ');
  }

  function salvarForm() {
    if (!form) return;
    mostrarErro('met-erro-form', '');
    var def = lerForm();
    var editando = form.id != null;
    try {
      BE.metas.validarDefinicao(def, BE.db);
    } catch (e) {
      var msg = e.message;
      var alvo = /pedidos/.test(msg) && !/faturamento/.test(msg) ? $('met-qtd')
        : /faturamento|negativa|zero/.test(msg) ? $('met-valor')
        : /dia da semana|dias da semana/.test(msg) ? raiz.querySelector('#met-dias input')
        : /nome/.test(msg) ? $('met-nome')
        : raiz.querySelector('#met-cal .cal__dia[tabindex="0"]');
      if (alvo && alvo.tagName === 'INPUT' && alvo.type !== 'checkbox') alvo.setAttribute('aria-invalid', 'true');
      mostrarErro('met-erro-form', msg);
      if (alvo) alvo.focus();
      return;
    }
    var botao = $('met-salvar');
    botao.disabled = true;
    var acao = editando ? BE.metas.atualizar(form.id, def) : BE.metas.criar(def);
    acao.then(function (r) {
      var aviso = def.distribuicao === 'proporcional' && r.modo === 'igual'
        ? ' Sem histórico de pedidos concluídos: a meta foi dividida igualmente.' : '';
      BE.toast('Meta "' + r.nome + '" ' + (editando ? 'atualizada' : 'criada') + ' com ' + r.dias + ' dia' +
        (r.dias === 1 ? '' : 's') + ' elegíve' + (r.dias === 1 ? 'l' : 'is') + '.' + aviso, aviso ? 'aviso' : 'sucesso');
      if (!editando) estado.filtro = 'todas';
      var dlg = $('met-dlg-form');
      if (form) form.opener = null;
      if (dlg && dlg.open) dlg.close();
      if (!montada()) return;
      atualizar();
      var novo = raiz.querySelector('[data-acao="detalhes"][data-id="' + r.id + '"]');
      if (novo) {
        novo.closest('.meta-cartao').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        novo.focus({ preventScroll: true });
      }
    }, function (e) {
      mostrarErro('met-erro-form', 'Não foi possível salvar: ' + e.message);
    }).then(function () {
      botao.disabled = false;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Painel Detalhes                                                     */
  /* ------------------------------------------------------------------ */

  function abrirDetalhe(id, opener) {
    det = { id: id, opener: opener, edicao: {}, salvando: null, linhas: [] };
    mostrarErro('met-erro-det', '');
    desenharDetalhe();
    $('met-dlg-det').showModal();
    var fechar = raiz.querySelector('#met-dlg-det [data-fechar]');
    if (fechar) fechar.focus();
  }

  function desenharDetalhe() {
    var m;
    try {
      m = BE.metas.obter(det.id);
      det.linhas = BE.metas.detalhe(det.id);
    } catch (e) {
      $('met-det-tabela').innerHTML = BE.estadoVazio('alerta', 'Meta indisponível', e.message);
      return;
    }
    $('met-det-titulo').textContent = m.nome;
    $('met-det-sub').textContent = periodo(m.inicio, m.fim) + ' · ' + diasResumo(m.dias_semana) + ' · ' + nomeCanal(m.id_canal) +
      ' · meta ' + BRL.format(m.meta_valor) + (m.meta_qtd ? ' e ' + INT.format(m.meta_qtd) + ' pedidos' : '');

    var ano = m.inicio.slice(0, 4) !== m.fim.slice(0, 4);
    BE.graficos.barras($('met-det-grafico'), {
      categorias: det.linhas.map(function (l) { return ddmm(l.data); }),
      series: [
        { nome: 'Meta', cor: COR_META, valores: det.linhas.map(function (l) { return l.meta_valor; }) },
        { nome: 'Realizado', cor: COR_REALIZADO, valores: det.linhas.map(function (l) { return l.realizado_valor; }) }
      ],
      formato: 'moeda',
      titulo: 'Gráfico de barras: meta e realizado de faturamento por dia da meta ' + m.nome,
      rotuloCategoria: function (c) {
        var l = det.linhas.filter(function (x) { return ddmm(x.data) === c; })[0];
        return (ano && l ? ddmmaaaa(l.data) : c) + (l ? ' (' + DIA_CURTO[l.dia_semana] + ')' : '');
      }
    });
    desenharTabela();
  }

  function linhaDoDia(dia) {
    for (var i = 0; i < det.linhas.length; i++) if (det.linhas[i].data === dia) return det.linhas[i];
    return null;
  }

  function valoresSalvos(dia) {
    var l = linhaDoDia(dia);
    return { valor: l ? String(l.meta_valor).replace('.', ',') : '', qtd: l ? String(l.meta_qtd) : '' };
  }

  function alterado(dia) {
    var ed = det && det.edicao[dia];
    if (!ed) return false;
    var s = valoresSalvos(dia);
    return ed.valor !== s.valor || ed.qtd !== s.qtd;
  }

  function desenharTabela() {
    var ativo = document.activeElement;
    var chaveFoco = ativo && raiz.contains(ativo) && ativo.getAttribute('data-campo')
      ? '[data-campo="' + ativo.getAttribute('data-campo') + '"][data-dia="' + ativo.getAttribute('data-dia') + '"]'
      : null;

    var corpo = det.linhas.map(function (l) {
      var ed = det.edicao[l.data] || valoresSalvos(l.data);
      var rot = ddmm(l.data);
      var p = l.atingimento_valor;
      var atingimento = p === null
        ? '<span class="sutil">sem meta em R$</span>'
        : '<div class="atingimento">' + barra(p, 'Atingimento de ' + rot) + '<span>' + pct(p) + '</span></div>';
      var salvando = det.salvando === l.data;
      return '<tr' + (l.dia_semana >= 6 ? ' class="linha--fim-semana"' : '') + '>' +
        '<td><span class="dia">' + rot + '</span> <span class="dia__semana">' + DIA_CURTO[l.dia_semana] + '</span></td>' +
        '<td><div class="campo-meta">' +
        '<input type="text" class="entrada-tabela" inputmode="decimal" data-campo="valor" data-dia="' + l.data + '"' +
        ' value="' + esc(ed.valor) + '" aria-label="Meta em reais de ' + rot + '">' +
        '<button type="button" class="botao botao--primario botao--pequeno" data-salvar="' + l.data + '"' +
        (alterado(l.data) ? '' : ' hidden') + (salvando ? ' disabled' : '') + '>' +
        BE.icone('check', 16) + '<span>' + (salvando ? 'Salvando' : 'Salvar') + '</span></button>' +
        '</div></td>' +
        '<td><input type="number" class="entrada-tabela entrada-tabela--curta" min="0" step="1" inputmode="numeric" data-campo="qtd" data-dia="' + l.data + '"' +
        ' value="' + esc(ed.qtd) + '" aria-label="Meta de pedidos de ' + rot + '"></td>' +
        '<td class="num">' + BRL.format(l.realizado_valor) + '</td>' +
        '<td class="num">' + INT.format(l.realizado_qtd) + '</td>' +
        '<td>' + atingimento + '</td>' +
        '<td class="num"><span class="' + (l.desvio < 0 ? 'desvio--neg' : 'desvio--pos') + '">' + BRL_SINAL.format(l.desvio) + '</span></td>' +
        '</tr>';
    }).join('');

    $('met-det-tabela').innerHTML =
      '<table class="tabela tabela--metas"><thead><tr>' +
      '<th scope="col">Dia</th><th scope="col">Meta R$</th><th scope="col">Meta pedidos</th>' +
      '<th scope="col" class="num">Realizado R$</th><th scope="col" class="num">Realizado pedidos</th>' +
      '<th scope="col">Atingimento</th><th scope="col" class="num">Desvio</th>' +
      '</tr></thead><tbody>' + corpo + '</tbody></table>';

    if (chaveFoco) {
      var alvo = raiz.querySelector(chaveFoco);
      if (alvo) alvo.focus();
    }
  }

  function salvarDia(dia) {
    if (!det || det.salvando || !alterado(dia)) return;
    mostrarErro('met-erro-det', '');
    var inValor = raiz.querySelector('[data-campo="valor"][data-dia="' + dia + '"]');
    var inQtd = raiz.querySelector('[data-campo="qtd"][data-dia="' + dia + '"]');
    var valores = { valor: inValor.value, qtd: inQtd.validity && inQtd.validity.badInput ? 'x' : inQtd.value };
    var rot = ddmm(dia);
    try {
      BE.metas.validarValores(valores);
    } catch (e) {
      var alvo = /pedidos/.test(e.message) ? inQtd : inValor;
      alvo.setAttribute('aria-invalid', 'true');
      mostrarErro('met-erro-det', rot + ': ' + e.message);
      alvo.focus();
      return;
    }
    det.salvando = dia;
    var b = raiz.querySelector('[data-salvar="' + dia + '"]');
    if (b) { b.disabled = true; b.querySelector('span').textContent = 'Salvando'; }
    var id = det.id;
    BE.metas.ajustarDia(id, dia, valores).then(function (r) {
      if (det && det.id === id) delete det.edicao[dia];
      BE.toast('Meta de ' + rot + ' salva. Novo total: ' + BRL.format(r.total_valor) + ' e ' + INT.format(r.total_qtd) + ' pedidos.', 'sucesso');
    }, function (e) {
      mostrarErro('met-erro-det', rot + ': não foi possível salvar (' + e.message + ').');
    }).then(function () {
      if (det) det.salvando = null;
      if (montada()) atualizar();
    });
  }

  BE.telas.metas = { titulo: 'Metas', render: render };
})(window.BE);
