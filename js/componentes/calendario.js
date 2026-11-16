/*
 * Calendário para escolher um período (grão diário, sem horário).
 *
 *   var cal = BE.ui.calendario(el, {
 *     inicio: 'AAAA-MM-DD' | null, fim: 'AAAA-MM-DD' | null,
 *     diasSemana: '1234567',        // 1 = seg ... 7 = dom; os demais ficam riscados no intervalo
 *     diasComVenda: { 'AAAA-MM-DD': true },  // ganham um pontinho milho
 *     mesComDados: 'AAAA-MM' | null,         // atalho "Mês com dados"
 *     hoje: function () -> 'AAAA-MM-DD',     // opcional (padrão: data local)
 *     onChange: function ({ inicio, fim })   // fim = null enquanto falta o 2º clique
 *   });
 *   cal.definirDiasSemana('56'); cal.definirPeriodo(inicio, fim); cal.periodo();
 *
 * Semana começando no domingo. 1º clique = início, 2º = fim (se for antes, inverte), 3º recomeça.
 * Teclado: setas movem o foco, Enter/Espaço selecionam, PageUp/PageDown trocam de mês,
 * Home/End vão ao começo/fim da semana.
 */
window.BE = window.BE || {};
BE.ui = BE.ui || {};

(function (BE) {
  'use strict';

  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  /* Índice = getUTCDay() (0 = domingo) */
  var DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  var LETRAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  var DIA_MS = 864e5;
  var contador = 0;

  function dd(n) { return (n < 10 ? '0' : '') + n; }
  function paraData(iso) { return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))); }
  function paraIso(d) { return d.getUTCFullYear() + '-' + dd(d.getUTCMonth() + 1) + '-' + dd(d.getUTCDate()); }
  function somarDias(iso, n) { return paraIso(new Date(paraData(iso).getTime() + n * DIA_MS)); }
  function ultimoDia(ano, mes) { return new Date(Date.UTC(ano, mes, 0)).getUTCDate(); }
  function somarMeses(mes, n) { /* 'AAAA-MM' */
    var t = +mes.slice(0, 4) * 12 + (+mes.slice(5, 7) - 1) + n;
    return Math.floor(t / 12) + '-' + dd(t % 12 + 1);
  }
  function fimDoMes(mes) { return mes + '-' + dd(ultimoDia(+mes.slice(0, 4), +mes.slice(5, 7))); }
  /* Mesmo dia em outro mês, limitado ao último dia */
  function mesmoDiaEm(iso, mes) {
    return mes + '-' + dd(Math.min(+iso.slice(8, 10), ultimoDia(+mes.slice(0, 4), +mes.slice(5, 7))));
  }
  function hojeLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + dd(d.getMonth() + 1) + '-' + dd(d.getDate());
  }
  function valida(iso) { return typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso); }
  /* 1 = seg ... 7 = dom */
  function diaSemana(iso) { return ((paraData(iso).getUTCDay() + 6) % 7) + 1; }

  function porExtenso(iso) {
    var d = paraData(iso);
    return DIAS[d.getUTCDay()] + ', ' + d.getUTCDate() + ' de ' + MESES[d.getUTCMonth()] + ' de ' + d.getUTCFullYear();
  }
  function curta(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4); }

  function calendario(el, opcoes) {
    opcoes = opcoes || {};
    var id = 'cal' + (++contador);
    var hoje = typeof opcoes.hoje === 'function' ? opcoes.hoje
      : function () { return BE.metas && BE.metas.hoje ? BE.metas.hoje() : hojeLocal(); };
    var estado = {
      inicio: valida(opcoes.inicio) ? opcoes.inicio : null,
      fim: valida(opcoes.fim) ? opcoes.fim : null,
      previa: null,
      diasSemana: opcoes.diasSemana == null ? '1234567' : String(opcoes.diasSemana),
      vendas: opcoes.diasComVenda || {},
      mesComDados: opcoes.mesComDados || null
    };
    if (estado.inicio && estado.fim && estado.fim < estado.inicio) {
      var t = estado.inicio; estado.inicio = estado.fim; estado.fim = t;
    }
    estado.foco = estado.inicio || hoje();
    estado.mes = estado.foco.slice(0, 7);

    el.classList.add('cal');
    el.innerHTML =
      '<div class="cal__atalhos" role="group" aria-label="Atalhos de período">' +
      '  <button type="button" class="cal__atalho" data-atalho="semana">Esta semana</button>' +
      '  <button type="button" class="cal__atalho" data-atalho="mes">Este mês</button>' +
      '  <button type="button" class="cal__atalho" data-atalho="proximo">Próximo mês</button>' +
      '  <button type="button" class="cal__atalho" data-atalho="ultimos30">Últimos 30 dias</button>' +
      '  <button type="button" class="cal__atalho cal__atalho--dados" data-atalho="dados">Mês com dados</button>' +
      '</div>' +
      '<div class="cal__topo">' +
      '  <button type="button" class="cal__seta" data-navegar="-1" aria-label="Mês anterior">' + seta('m15 18-6-6 6-6') + '</button>' +
      '  <h3 class="cal__titulo" id="' + id + '-titulo" aria-live="polite"></h3>' +
      '  <button type="button" class="cal__seta" data-navegar="1" aria-label="Próximo mês">' + seta('m9 18 6-6-6-6') + '</button>' +
      '</div>' +
      '<div class="cal__grade" role="grid" aria-labelledby="' + id + '-titulo"></div>' +
      '<p class="cal__estado" aria-live="polite"></p>';

    var grade = el.querySelector('.cal__grade');
    var titulo = el.querySelector('.cal__titulo');
    var textoEstado = el.querySelector('.cal__estado');

    function seta(d) {
      return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="' + d + '"/></svg>';
    }

    /* ---------- Desenho ---------- */

    function desenhar() {
      var ano = +estado.mes.slice(0, 4), m = +estado.mes.slice(5, 7);
      titulo.textContent = MESES[m - 1] + ' de ' + ano;
      var primeiro = estado.mes + '-01';
      var vazios = paraData(primeiro).getUTCDay(); /* domingo = 0 colunas vazias */
      var total = ultimoDia(ano, m);

      var html = '<div class="cal__linha cal__linha--cab" role="row">' +
        LETRAS.map(function (l, i) {
          return '<div class="cal__cab" role="columnheader" aria-label="' + DIAS[i] + '"><span aria-hidden="true">' + l + '</span></div>';
        }).join('') + '</div>';
      var celulas = [];
      for (var v = 0; v < vazios; v++) celulas.push('<div class="cal__celula" role="gridcell"></div>');
      for (var d = 1; d <= total; d++) {
        var iso = estado.mes + '-' + dd(d);
        celulas.push('<div class="cal__celula" role="gridcell"><button type="button" class="cal__dia" data-data="' + iso +
          '" tabindex="-1">' + d + '</button></div>');
      }
      while (celulas.length % 7) celulas.push('<div class="cal__celula" role="gridcell"></div>');
      for (var i = 0; i < celulas.length; i += 7) {
        html += '<div class="cal__linha" role="row">' + celulas.slice(i, i + 7).join('') + '</div>';
      }
      grade.innerHTML = html;
      pintar();
    }

    function intervaloAtual() {
      if (!estado.inicio) return null;
      if (estado.fim) return { a: estado.inicio, b: estado.fim, previa: false };
      if (estado.previa) {
        return estado.previa < estado.inicio
          ? { a: estado.previa, b: estado.inicio, previa: true }
          : { a: estado.inicio, b: estado.previa, previa: true };
      }
      return { a: estado.inicio, b: estado.inicio, previa: false };
    }

    /* Atualiza classes e rótulos sem recriar os botões (passar o mouse não perde o foco) */
    function pintar() {
      var r = intervaloAtual();
      var h = hoje();
      if (estado.foco.slice(0, 7) !== estado.mes) estado.foco = estado.mes + '-01';
      Array.prototype.forEach.call(grade.querySelectorAll('.cal__dia'), function (b) {
        var iso = b.getAttribute('data-data');
        var dentro = r && iso >= r.a && iso <= r.b;
        var ponta = r && (iso === r.a || iso === r.b);
        var inelegivel = dentro && estado.diasSemana.indexOf(String(diaSemana(iso))) < 0;
        var cl = b.classList;
        cl.toggle('cal__dia--intervalo', !!dentro && !r.previa);
        cl.toggle('cal__dia--previa', !!dentro && r.previa);
        cl.toggle('cal__dia--ponta', !!ponta);
        cl.toggle('cal__dia--inicio', !!r && iso === r.a);
        cl.toggle('cal__dia--fim', !!r && iso === r.b);
        cl.toggle('cal__dia--inelegivel', !!inelegivel);
        cl.toggle('cal__dia--hoje', iso === h);
        cl.toggle('cal__dia--venda', !!estado.vendas[iso]);
        b.parentNode.setAttribute('aria-selected', dentro && !r.previa ? 'true' : 'false');
        b.tabIndex = iso === estado.foco ? 0 : -1;

        var extras = [];
        if (iso === h) extras.push('hoje');
        if (estado.inicio === iso) extras.push('início do período');
        if (estado.fim === iso) extras.push('fim do período');
        else if (dentro && !r.previa && !ponta) extras.push('no período');
        if (inelegivel && !r.previa) extras.push('fora dos dias da semana marcados');
        if (estado.vendas[iso]) extras.push('tem vendas');
        b.setAttribute('aria-label', porExtenso(iso) + (extras.length ? ' (' + extras.join(', ') + ')' : ''));
      });
      atualizarAtalhos();
      atualizarEstado();
    }

    function atualizarEstado() {
      if (!estado.inicio) textoEstado.textContent = 'Clique no dia inicial do período.';
      else if (!estado.fim) textoEstado.textContent = 'Início em ' + curta(estado.inicio) + '. Agora clique no dia final.';
      else {
        var n = Math.round((paraData(estado.fim) - paraData(estado.inicio)) / DIA_MS) + 1;
        textoEstado.textContent = (estado.inicio === estado.fim ? curta(estado.inicio) : curta(estado.inicio) + ' a ' + curta(estado.fim)) +
          ' · ' + n + ' dia' + (n === 1 ? '' : 's') + ' no período';
      }
    }

    function atualizarAtalhos() {
      var b = el.querySelector('[data-atalho="dados"]');
      b.disabled = !estado.mesComDados;
      b.title = estado.mesComDados ? 'Último mês com vendas no banco' : 'Ainda não há vendas no banco';
    }

    /* ---------- Ações ---------- */

    function avisar() {
      if (typeof opcoes.onChange === 'function') opcoes.onChange({ inicio: estado.inicio, fim: estado.fim });
    }

    function selecionar(iso) {
      if (!estado.inicio || estado.fim) {
        estado.inicio = iso;   /* 1º clique (ou 3º: recomeça) */
        estado.fim = null;
      } else if (iso < estado.inicio) {
        estado.fim = estado.inicio; /* 2º clique antes do início: inverte */
        estado.inicio = iso;
      } else {
        estado.fim = iso;
      }
      estado.previa = null;
      estado.foco = iso;
      pintar();
      avisar();
    }

    function irPara(mes, foco) {
      estado.mes = mes;
      estado.foco = foco || mesmoDiaEm(estado.foco, mes);
      desenhar();
    }

    function focar(iso) {
      if (iso.slice(0, 7) !== estado.mes) irPara(iso.slice(0, 7), iso);
      else { estado.foco = iso; }
      if (estado.inicio && !estado.fim) estado.previa = iso;
      pintar();
      var b = grade.querySelector('[data-data="' + iso + '"]');
      if (b) b.focus();
    }

    function aplicar(inicio, fim) {
      estado.inicio = inicio;
      estado.fim = fim;
      estado.previa = null;
      irPara(inicio.slice(0, 7), inicio);
      avisar();
    }

    function atalho(nome) {
      var h = hoje();
      var mes = h.slice(0, 7);
      if (nome === 'semana') {
        var dom = somarDias(h, -paraData(h).getUTCDay());
        aplicar(dom, somarDias(dom, 6));
      } else if (nome === 'mes') aplicar(mes + '-01', fimDoMes(mes));
      else if (nome === 'proximo') { var p = somarMeses(mes, 1); aplicar(p + '-01', fimDoMes(p)); }
      else if (nome === 'ultimos30') aplicar(somarDias(h, -29), h);
      else if (nome === 'dados' && estado.mesComDados) aplicar(estado.mesComDados + '-01', fimDoMes(estado.mesComDados));
    }

    /* ---------- Eventos ---------- */

    el.addEventListener('click', function (e) {
      var dia = e.target.closest('.cal__dia');
      if (dia) { selecionar(dia.getAttribute('data-data')); return; }
      var nav = e.target.closest('[data-navegar]');
      if (nav) { irPara(somarMeses(estado.mes, +nav.getAttribute('data-navegar'))); return; }
      var at = e.target.closest('[data-atalho]');
      if (at && !at.disabled) atalho(at.getAttribute('data-atalho'));
    });

    grade.addEventListener('mouseover', function (e) {
      var dia = e.target.closest('.cal__dia');
      if (!dia || !estado.inicio || estado.fim) return;
      var iso = dia.getAttribute('data-data');
      if (estado.previa !== iso) { estado.previa = iso; pintar(); }
    });
    grade.addEventListener('mouseleave', function () {
      if (estado.previa) { estado.previa = null; pintar(); }
    });

    grade.addEventListener('keydown', function (e) {
      var dia = e.target.closest('.cal__dia');
      if (!dia) return;
      var iso = dia.getAttribute('data-data');
      var ds = paraData(iso).getUTCDay();
      var alvo = null;
      switch (e.key) {
        case 'ArrowLeft': alvo = somarDias(iso, -1); break;
        case 'ArrowRight': alvo = somarDias(iso, 1); break;
        case 'ArrowUp': alvo = somarDias(iso, -7); break;
        case 'ArrowDown': alvo = somarDias(iso, 7); break;
        case 'Home': alvo = somarDias(iso, -ds); break;
        case 'End': alvo = somarDias(iso, 6 - ds); break;
        case 'PageUp': alvo = mesmoDiaEm(iso, somarMeses(iso.slice(0, 7), -1)); break;
        case 'PageDown': alvo = mesmoDiaEm(iso, somarMeses(iso.slice(0, 7), 1)); break;
        default: return; /* Enter e Espaço: o botão dispara o clique */
      }
      e.preventDefault();
      focar(alvo);
    });

    desenhar();

    return {
      periodo: function () { return { inicio: estado.inicio, fim: estado.fim }; },
      definirPeriodo: function (inicio, fim) {
        if (!valida(inicio)) return;
        estado.inicio = inicio;
        estado.fim = valida(fim) ? fim : null;
        irPara(inicio.slice(0, 7), inicio);
      },
      definirDiasSemana: function (dias) { estado.diasSemana = String(dias || ''); pintar(); },
      definirDiasComVenda: function (mapa) { estado.vendas = mapa || {}; pintar(); },
      definirMesComDados: function (mes) { estado.mesComDados = mes || null; atualizarAtalhos(); },
      mesVisivel: function () { return estado.mes; },
      irPara: function (mes) { irPara(mes); }
    };
  }

  BE.ui.calendario = calendario;
})(window.BE);
