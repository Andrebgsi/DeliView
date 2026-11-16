/* Casca do portal: rotas por hash, menu lateral/drawer e toasts. */
window.BE = window.BE || {};

(function (BE) {
  BE.telas = BE.telas || {};

  var MENU = [
    { rota: 'dashboard', rotulo: 'Dashboard', icone: 'home' },
    { rota: 'metas', rotulo: 'Metas', icone: 'target' },
    { rota: 'importacao', rotulo: 'Importação', icone: 'upload' },
    { rota: 'dados', rotulo: 'Dados e backup', icone: 'bancoEscudo' },
    { rota: 'manual', rotulo: 'Manual', icone: 'bookOpen' }
  ];
  var ROTA_PADRAO = 'dashboard';
  var LARGURA_DRAWER = 1024;

  var el = {};

  /* ---------- Helpers ---------- */

  BE.escapar = function (texto) {
    return String(texto == null ? '' : texto)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  /* Textos compartilhados: fonte única para não divergirem entre telas. */
  BE.textos = BE.textos || {};
  BE.textos.avisoSeguranca = 'Esta página não envia seus dados a nenhum servidor: eles ficam só neste navegador, ' +
    'sem criptografia. Não use em computador compartilhado e faça backup. Detalhes em Manual.';

  /* Aviso de segurança em HTML, com "Manual" virando link para #/manual. */
  BE.avisoSegurancaHtml = function () {
    return BE.escapar(BE.textos.avisoSeguranca).replace(/Manual\.$/, '<a href="#/manual">Manual</a>.');
  };

  /* Cabeçalho padrão das telas, no estilo do v1. */
  BE.cabecalho = function (titulo, subtitulo) {
    return '<header class="cabecalho-tela"><div>' +
      '<h1>' + BE.escapar(titulo) + '</h1>' +
      (subtitulo ? '<p>' + BE.escapar(subtitulo) + '</p>' : '') +
      '</div></header>';
  };

  /* Estado vazio amigável. */
  BE.estadoVazio = function (icone, titulo, texto) {
    return '<div class="estado-vazio">' +
      '<div class="estado-vazio__icone">' + BE.icone(icone, 28) + '</div>' +
      '<h2>' + BE.escapar(titulo) + '</h2>' +
      (texto ? '<p>' + BE.escapar(texto) + '</p>' : '') +
      '</div>';
  };

  /*
   * Tabela HTML com cabeçalho. linhas = Array<Array<valor>>; numericas = índices alinhados à direita.
   * Valores são escapados; booleano vira Sim/Não. opcoes.html = índices cujo valor já é HTML seguro.
   */
  BE.tabelaHtml = function (cab, linhas, numericas, opcoes) {
    numericas = numericas || [];
    var html = (opcoes && opcoes.html) || [];
    var classe = function (i) { return numericas.indexOf(i) >= 0 ? ' class="num"' : ''; };
    var celula = function (v, i) {
      if (html.indexOf(i) >= 0) return String(v);
      if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
      return BE.escapar(v == null ? '' : v);
    };
    return '<table class="tabela"><thead><tr>' +
      cab.map(function (c, i) { return '<th scope="col"' + classe(i) + '>' + BE.escapar(c) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      linhas.map(function (r) {
        return '<tr>' + r.map(function (v, i) { return '<td' + classe(i) + '>' + celula(v, i) + '</td>'; }).join('') + '</tr>';
      }).join('') +
      '</tbody></table>';
  };

  /* Toast: tipo = 'sucesso' | 'erro' | 'aviso' | 'info'. */
  BE.toast = function (msg, tipo) {
    tipo = tipo || 'info';
    var icones = { sucesso: 'check', erro: 'alerta', aviso: 'alerta', info: 'info' };
    var caixa = document.getElementById('toasts');
    if (!caixa) return;
    var t = document.createElement('div');
    t.className = 'toast toast--' + tipo;
    t.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
    t.innerHTML = '<span class="toast__icone">' + BE.icone(icones[tipo] || 'info', 18) + '</span>' +
      '<span class="toast__msg"></span>' +
      '<button type="button" class="toast__fechar" aria-label="Fechar aviso">' + BE.icone('x', 16) + '</button>';
    t.querySelector('.toast__msg').textContent = msg;
    var remover = function () {
      if (!t.parentNode) return;
      t.classList.add('toast--saindo');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 200);
    };
    t.querySelector('.toast__fechar').addEventListener('click', remover);
    caixa.appendChild(t);
    setTimeout(remover, tipo === 'erro' ? 7000 : 4000);
  };

  /* ---------- Menu e drawer ---------- */

  function montarMenu() {
    el.menu.innerHTML = MENU.map(function (item) {
      return '<li><a class="menu__item" id="nav-' + item.rota + '" href="#/' + item.rota + '" data-rota="' + item.rota + '">' +
        '<span class="menu__barra" aria-hidden="true"></span>' +
        BE.icone(item.icone, 20) + '<span>' + BE.escapar(item.rotulo) + '</span></a></li>';
    }).join('');
    el.menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) fecharDrawer(false);
    });
  }

  function drawerAberto() {
    return document.body.classList.contains('drawer-aberto');
  }

  function abrirDrawer() {
    document.body.classList.add('drawer-aberto');
    el.backdrop.hidden = false;
    el.botaoMenu.setAttribute('aria-expanded', 'true');
    el.botaoMenu.setAttribute('aria-label', 'Fechar menu');
    el.botaoMenu.innerHTML = BE.icone('x', 22);
    el.sidebar.setAttribute('role', 'dialog');
    el.sidebar.setAttribute('aria-modal', 'true');
    el.botaoFechar.focus();
  }

  function fecharDrawer(devolverFoco) {
    if (!drawerAberto()) return;
    document.body.classList.remove('drawer-aberto');
    el.backdrop.hidden = true;
    el.botaoMenu.setAttribute('aria-expanded', 'false');
    el.botaoMenu.setAttribute('aria-label', 'Abrir menu de navegação');
    el.botaoMenu.innerHTML = BE.icone('menu', 22);
    el.sidebar.removeAttribute('role');
    el.sidebar.removeAttribute('aria-modal');
    if (devolverFoco !== false) el.botaoMenu.focus();
  }

  /* ---------- Rotas ---------- */

  function rotaAtual() {
    var nome = (location.hash || '').replace(/^#\/?/, '').split(/[/?]/)[0];
    return BE.telas[nome] ? nome : null;
  }

  function renderizar() {
    var nome = rotaAtual();
    if (!nome) {
      history.replaceState(null, '', '#/' + ROTA_PADRAO);
      nome = ROTA_PADRAO;
    }
    var tela = BE.telas[nome];

    Array.prototype.forEach.call(el.menu.querySelectorAll('.menu__item'), function (a) {
      var ativo = a.getAttribute('data-rota') === nome;
      a.classList.toggle('menu__item--ativo', ativo);
      if (ativo) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });

    document.title = tela.titulo + ' · DeliView';
    document.body.setAttribute('data-rota', nome);
    el.conteudo.innerHTML = '';
    var area = document.createElement('div');
    area.className = 'tela';
    el.conteudo.appendChild(area);
    try {
      tela.render(area);
    } catch (erro) {
      console.error(erro);
      area.innerHTML = BE.estadoVazio('alerta', 'Não foi possível abrir esta tela', String(erro && erro.message || erro));
    }
    window.scrollTo(0, 0);
  }

  BE.iniciar = function () {
    el.menu = document.getElementById('menu');
    el.sidebar = document.getElementById('sidebar');
    el.backdrop = document.getElementById('backdrop');
    el.botaoMenu = document.getElementById('botao-menu');
    el.botaoFechar = document.getElementById('botao-fechar');
    el.conteudo = document.getElementById('conteudo');

    el.botaoMenu.innerHTML = BE.icone('menu', 22);
    el.botaoFechar.innerHTML = BE.icone('x', 20);
    montarMenu();

    el.botaoMenu.addEventListener('click', function () {
      if (drawerAberto()) fecharDrawer(); else abrirDrawer();
    });
    el.botaoFechar.addEventListener('click', function () { fecharDrawer(); });
    el.backdrop.addEventListener('click', function () { fecharDrawer(); });
    /* O indicador do banco é um link para #/dados: no celular, fecha o drawer ao navegar */
    var indicador = document.getElementById('indicador-banco');
    if (indicador) indicador.addEventListener('click', function () { fecharDrawer(false); });
    /* Aviso de segurança fixo no rodapé da sidebar (também aparece no drawer) */
    var aviso = document.getElementById('aviso-sidebar');
    if (aviso) {
      aviso.innerHTML = '<span class="aviso-sidebar__icone" aria-hidden="true">' + BE.icone('triangulo', 14) + '</span>' +
        '<p>' + BE.avisoSegurancaHtml() + '</p>';
      aviso.addEventListener('click', function (e) { if (e.target.closest('a')) fecharDrawer(false); });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') fecharDrawer();
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth >= LARGURA_DRAWER) fecharDrawer(false);
    });
    /* Em qualquer tela: arquivo solto fora de uma área de soltar não faz o navegador sair do portal.
       As áreas de soltar tratam o próprio evento antes de ele chegar aqui. */
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });

    /* O banco abre antes da 1ª tela: as telas aguardam BE.dbPronto */
    document.addEventListener('be:banco-alterado', function (e) { atualizarIndicador(e.detail); });
    BE.dbPronto = BE.db.abrir().catch(function (erro) {
      console.error(erro);
      atualizarIndicador(null, 'Banco indisponível');
      BE.toast('Não foi possível abrir o banco local: ' + (erro && erro.message || erro), 'erro');
      throw erro;
    });
    BE.dbPronto.catch(function () { /* já avisado acima; telas que aguardam tratam o erro */ });

    window.addEventListener('hashchange', renderizar);
    renderizar();

    /* Arquivo do banco vinculado e pergunta "Onde está o banco de dados?" (js/componentes/banco-inicial.js) */
    if (BE.bancoInicial) BE.bancoInicial.iniciar();
  };

  /* ---------- Indicador do banco (rodapé da sidebar) ---------- */

  function doisDigitos(n) { return (n < 10 ? '0' : '') + n; }

  /* Data e hora local a partir de ISO: "dd/mm hh:mm" ou, com comAno, "dd/mm/aaaa hh:mm". */
  BE.formatarDataHora = function (iso, comAno) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return doisDigitos(d.getDate()) + '/' + doisDigitos(d.getMonth() + 1) +
      (comAno ? '/' + d.getFullYear() : '') + ' ' +
      doisDigitos(d.getHours()) + ':' + doisDigitos(d.getMinutes());
  };
  BE.formatarDataHoraCurta = function (iso) { return BE.formatarDataHora(iso, false); };

  function atualizarIndicador(resumo, textoErro) {
    var caixa = document.getElementById('indicador-banco');
    var texto = document.getElementById('indicador-banco-texto');
    if (!caixa || !texto) return;
    var classe, msg;
    if (!resumo) {
      classe = 'alerta';
      msg = textoErro || 'Banco indisponível';
    } else if (!resumo.pedidos && !resumo.ultimaCarga) {
      classe = 'vazio';
      msg = 'Banco vazio';
    } else {
      classe = 'cheio';
      msg = 'Banco: ' + resumo.pedidos.toLocaleString('pt-BR') + ' pedido' + (resumo.pedidos === 1 ? '' : 's');
      if (resumo.ultimaCarga) msg += ' · última carga ' + BE.formatarDataHoraCurta(resumo.ultimaCarga);
    }
    if (resumo && !resumo.persistente) {
      classe = 'alerta';
      msg += ' (não salvo neste navegador)';
    }
    caixa.className = 'indicador-banco indicador-banco--' + classe;
    texto.textContent = msg;
    caixa.title = 'Abrir Dados e backup';
  }
})(window.BE);
