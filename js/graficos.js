/*
 * Gráficos em SVG puro (sem bibliotecas).
 *
 *   BE.graficos.barras(el, {
 *     categorias: ['01', '02', ...],
 *     series: [{ nome: 'Meta', valores: [..], cor: '#0f3d2e' }, ...],
 *     formato: 'moeda' | 'inteiro' | function (v) -> texto,
 *     titulo: 'texto para leitores de tela' (opcional),
 *     rotuloCategoria: function (categoria) -> texto do tooltip (opcional)
 *   })
 *
 * Barras agrupadas, eixo Y com 4 a 5 marcas "redondas", grade horizontal clara, legenda,
 * tooltip nativo (<title>) em cada barra e viewBox responsivo (largura 100%).
 *
 *   BE.graficos.acumulado(el, serie, {
 *     hoje: 'AAAA-MM-DD' | null,        // marcador do dia de hoje (metas em andamento)
 *     meta: 'meta_acum', realizado: 'realizado_acum',  // campos da série (padrão)
 *     formato: 'moeda' | 'inteiro', titulo: 'texto para leitores de tela',
 *     largura: 280                       // opcional: largura do desenho em px (altura fixa 80)
 *   })
 *
 * Mini gráfico 280×80 da meta acumulada (linha tracejada floresta) e do realizado acumulado
 * (linha milho com área suave). serie = [{ data, meta_acum, realizado_acum }]; realizado null
 * (dias que ainda não chegaram) não é desenhado.
 *
 * Gráficos do Dashboard (todos com viewBox na largura real do contêiner, tooltip no mouse e no
 * foco do teclado, role="img" com resumo, botão "Ver dados" com a tabela dos mesmos valores e
 * estado vazio "Sem pedidos neste recorte"):
 *
 *   BE.graficos.linhas(el, { categorias, series: [{ nome, valores, cor? }], formato,
 *                            titulo?, rotuloCategoria?, rotuloEixo?, rotuloTabela? })
 *   BE.graficos.cascata(el, { etapas: [{ rotulo, valor, tipo: 'total' | 'reducao' }], formato, titulo? })
 *   BE.graficos.rosca(el, { fatias: [{ rotulo, valor, cor? }], formato, centro?, titulo? })
 *   BE.graficos.mapaCalor(el, { linhas, colunas, valores: [linha][coluna], formato, titulo? })
 *   BE.graficos.barrasEmpilhadas(el, { categorias, series: [{ nome, valores, cor? }], cem?, formato?, titulo? })
 *   BE.graficos.barras(el, { ..., interativo: true, rotulos?: true, corPorCategoria?: true,
 *                            referencia?: { nome, valores, cor? } })  modo do Dashboard; valor null = sem barra
 *   BE.graficos.dispersao(el, { pontos: [{ x, y, serie, rotulo }], formatoX, formatoY, rotuloX, rotuloY, titulo? })
 *   BE.graficos.boxplot(el, { grupos: [{ nome, n, media, q1, mediana, q3, limInf, limSup, fora }], formato, titulo? })
 *   BE.graficos.progresso(el, { itens: [{ rotulo, valor, meta, detalhe?, status? }], formato, titulo? })
 *   BE.graficos.redesenhar(raiz)   redesenha os gráficos cuja largura mudou (ex.: resize)
 *
 * formato: 'moeda' | 'inteiro' | 'percentual' (1 casa) | function (v) -> texto.
 * Opções comuns: aoClicar(...) em linhas (índice), barras (índice) e mapaCalor (linha, coluna):
 * clique ou Enter/Espaço no alvo; dica(i, serie, valor) troca o texto do tooltip (linhas e barras);
 * participacao: false tira o "(x%)" do tooltip das barras empilhadas.
 * Cores: canal iFood sempre floresta e 99Food sempre milho; demais séries em tons da paleta;
 * mapa de calor em escala sequencial de menta a floresta.
 */
window.BE = window.BE || {};

(function (BE) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var COR_TEXTO = '#0f3d2e';
  var COR_GRADE = '#e4f0e8';

  var moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var moedaCurta = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  var inteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  var umaCasa = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  /* Formatação: completa (tooltip) e curta (eixo Y) */
  function formatadores(formato) {
    if (typeof formato === 'function') return { cheio: formato, eixo: formato };
    if (formato === 'moeda') {
      return { cheio: function (v) { return moeda.format(v); }, eixo: function (v) { return moedaCurta.format(v); } };
    }
    if (formato === 'percentual') {
      return {
        cheio: function (v) { return umaCasa.format(v) + '%'; },
        eixo: function (v) { return inteiro.format(v) + '%'; }
      };
    }
    var f = function (v) { return inteiro.format(v); };
    return { cheio: f, eixo: f };
  }

  /* Passo "redondo" (1, 2, 2,5 ou 5 × 10^n) que gera de 4 a 5 marcas acima de zero */
  function marcasEixo(maximo) {
    if (!(maximo > 0)) return [0, 1, 2, 3, 4];
    var bruto = maximo / 4;
    var potencia = Math.pow(10, Math.floor(Math.log10(bruto)));
    var opcoes = [1, 2, 2.5, 5, 10];
    var passo = potencia;
    for (var i = 0; i < opcoes.length; i++) {
      passo = opcoes[i] * potencia;
      if (Math.ceil(maximo / passo) <= 5) break;
    }
    var n = Math.max(4, Math.ceil(maximo / passo));
    var marcas = [];
    for (var k = 0; k <= n; k++) marcas.push(Math.round(k * passo * 1e6) / 1e6);
    return marcas;
  }

  function no(nome, atributos, pai) {
    var e = document.createElementNS(NS, nome);
    Object.keys(atributos || {}).forEach(function (k) { e.setAttribute(k, atributos[k]); });
    if (pai) pai.appendChild(e);
    return e;
  }

  function texto(conteudo, atributos, pai) {
    var t = no('text', atributos, pai);
    t.textContent = conteudo;
    return t;
  }

  /* Retângulo com cantos superiores arredondados (como o radius [6,6,0,0] do v1) */
  function caminhoBarra(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h));
    return 'M' + x + ',' + (y + h) +
      'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
      'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) +
      'V' + (y + h) + 'Z';
  }

  function barras(el, opcoes) {
    var categorias = opcoes.categorias || [];
    var series = opcoes.series || [];
    var fmt = formatadores(opcoes.formato);
    var rotuloCat = opcoes.rotuloCategoria || function (c) { return c; };
    /* Rótulo do eixo X: opcoes.rotuloEixo, ou o texto encurtado para caber no grupo */
    var rotuloEixoBarras = function (c) {
      if (opcoes.rotuloEixo) return opcoes.rotuloEixo(c);
      var t = String(c);
      if (!interativo) return t;
      var max = Math.max(4, Math.floor((larguraDe(el) - 76) / Math.max(1, categorias.length) / 6.5));
      return t.length > max ? t.slice(0, max - 1) + '…' : t;
    };
    /* Modo do Dashboard: largura real, tooltip próprio, foco, "Ver dados" e estado vazio */
    var interativo = !!opcoes.interativo;
    /* Linha de referência por categoria (ex.: meta), só no modo do Dashboard */
    var ref = interativo && opcoes.referencia && opcoes.referencia.valores ? opcoes.referencia : null;

    if (interativo) {
      registrar(el, barras, opcoes);
      if (!categorias.length || !series.length) return vazio(el, opcoes);
      series = series.map(function (s, i) { return comCor(s, i); });
    }

    el.innerHTML = '';
    el.classList.add('grafico');

    /* Legenda (HTML, fora do SVG, para quebrar linha no celular) */
    var legenda = document.createElement('ul');
    legenda.className = 'grafico__legenda';
    /* corPorCategoria: uma série só, cada barra com a cor da categoria (ex.: canal) */
    var porCategoria = interativo && opcoes.corPorCategoria && series.length === 1;
    (porCategoria ? categorias.map(function (c, i) { return { nome: String(c), cor: corSerie(c, i) }; }) : series).forEach(function (s) {
      var li = document.createElement('li');
      var marca = document.createElement('span');
      marca.className = 'grafico__marca';
      marca.style.background = s.cor;
      li.appendChild(marca);
      li.appendChild(document.createTextNode(s.nome));
      legenda.appendChild(li);
    });

    var q = null;
    if (interativo) {
      if (ref) {
        var liRef = document.createElement('li');
        var marcaRef = document.createElement('span');
        marcaRef.className = 'grafico__marca grafico__marca--linha';
        marcaRef.style.borderColor = ref.cor || COR_REFERENCIA;
        liRef.appendChild(marcaRef);
        liRef.appendChild(document.createTextNode(ref.nome || 'Referência'));
        legenda.appendChild(liRef);
      }
      q = quadro(el, opcoes, [opcoes.rotuloTabela || 'Categoria'].concat(series.map(function (s) { return s.nome; }))
        .concat(ref ? [ref.nome || 'Referência'] : []),
        categorias.map(function (c, i) {
          return [rotuloCat(c)].concat(series.map(function (s) {
            var v = (s.valores || [])[i];
            return v == null ? '—' : valorCelula(v, fmt);
          })).concat(ref ? [ref.valores[i] == null ? '—' : valorCelula(ref.valores[i], fmt)] : []);
        }), legenda);
    } else {
      el.appendChild(legenda);
    }

    /* Geometria em unidades do viewBox */
    var porGrupo = Math.max(28, series.length * 14 + 10);
    var M = { topo: opcoes.rotulos ? 24 : 12, dir: 12, base: 30, esq: 76 };
    var largura = interativo ? larguraDe(el) : Math.max(600, M.esq + M.dir + categorias.length * porGrupo);
    if (interativo && largura < 480) M.esq = 56;
    var altura = interativo ? 260 : 300;
    var areaW = largura - M.esq - M.dir;
    var areaH = altura - M.topo - M.base;

    var maximo = 0;
    series.forEach(function (s) {
      (s.valores || []).forEach(function (v) { if (v > maximo) maximo = v; });
    });
    if (ref) ref.valores.forEach(function (v) { if (v > maximo) maximo = v; });
    var marcas = marcasEixo(maximo);
    var teto = marcas[marcas.length - 1];
    var y = function (v) { return M.topo + areaH - (v / teto) * areaH; };

    var rolagem = document.createElement('div');
    rolagem.className = 'grafico__rolagem';
    (q ? q.area : el).appendChild(rolagem);

    var svg = no('svg', {
      viewBox: '0 0 ' + largura + ' ' + altura,
      width: '100%',
      role: 'img',
      'aria-label': opcoes.titulo || series.map(function (s) { return s.nome; }).join(' e ')
    }, rolagem);
    if (interativo) svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    else svg.style.minWidth = Math.min(largura, Math.max(560, categorias.length * 20)) + 'px';

    /* Grade horizontal + rótulos do eixo Y */
    var grade = no('g', { 'font-size': 12, fill: COR_TEXTO }, svg);
    marcas.forEach(function (m) {
      var yy = Math.round(y(m)) + 0.5;
      no('line', {
        x1: M.esq, x2: largura - M.dir, y1: yy, y2: yy,
        stroke: COR_GRADE, 'stroke-width': 1, 'stroke-dasharray': m === 0 ? '' : '3 3'
      }, grade);
      texto(fmt.eixo(m), { x: M.esq - 8, y: yy + 4, 'text-anchor': 'end', 'fill-opacity': 0.7 }, grade);
    });

    /* Barras agrupadas */
    var larguraGrupo = areaW / Math.max(1, categorias.length);
    var folga = Math.max(4, larguraGrupo * (interativo && categorias.length < 5 ? 0.45 : 0.2));
    var larguraBarra = Math.max(2, (larguraGrupo - folga) / Math.max(1, series.length));
    var corpo = no('g', {}, svg);
    categorias.forEach(function (c, i) {
      var x0 = M.esq + i * larguraGrupo + folga / 2;
      series.forEach(function (s, j) {
        if (interativo && (s.valores || [])[i] == null) return;
        var v = Number((s.valores || [])[i]) || 0;
        var topo = y(Math.max(0, v));
        var h = M.topo + areaH - topo;
        var x = x0 + j * larguraBarra;
        var forma = no('path', {
          d: h > 0 ? caminhoBarra(x, topo, larguraBarra - 1, h, 4) : 'M' + x + ',' + (M.topo + areaH) + 'h' + (larguraBarra - 1),
          fill: porCategoria ? corSerie(c, i) : s.cor,
          stroke: h > 0 ? 'none' : (porCategoria ? corSerie(c, i) : s.cor),
          class: 'grafico__barra'
        }, corpo);
        var dica = rotuloCat(c) + ' · ' + s.nome + ': ' + fmt.cheio(v);
        if (interativo) {
          marcar(forma, v, opcoes.dica ? opcoes.dica(i, s, v) : dica, opcoes.aoClicar ? i : null);
        } else {
          var t = no('title', {}, forma);
          t.textContent = dica;
        }
        if (opcoes.rotulos) {
          texto(fmt.cheio(v), {
            x: x + (larguraBarra - 1) / 2, y: topo - 6, 'text-anchor': 'middle',
            'font-size': 12, 'font-weight': 700, fill: COR_TEXTO
          }, corpo);
        }
      });
      if (ref && ref.valores[i] != null) {
        var yr = Math.round(y(ref.valores[i])) + 0.5;
        var linhaRef = no('line', { x1: M.esq + i * larguraGrupo + 4, x2: M.esq + (i + 1) * larguraGrupo - 4, y1: yr, y2: yr,
          stroke: ref.cor || COR_REFERENCIA, 'stroke-width': 3, 'stroke-dasharray': '6 3', class: 'grafico__referencia' }, corpo);
        marcar(linhaRef, ref.valores[i], rotuloCat(c) + ' · ' + (ref.nome || 'Referência') + ': ' + fmt.cheio(ref.valores[i]));
      }
      texto(rotuloEixoBarras(c), {
        x: M.esq + i * larguraGrupo + larguraGrupo / 2,
        y: altura - M.base + 18,
        'text-anchor': 'middle',
        'font-size': interativo ? 12 : 11,
        fill: COR_TEXTO,
        'fill-opacity': 0.75
      }, svg);
    });

    return svg;
  }

  function acumulado(el, serie, opcoes) {
    opcoes = opcoes || {};
    serie = serie || [];
    var campoMeta = opcoes.meta || 'meta_acum';
    var campoReal = opcoes.realizado || 'realizado_acum';
    var fmt = formatadores(opcoes.formato || 'moeda');
    /* 280×80 por padrão; opcoes.largura deixa o desenho ocupar o cartão sem distorcer */
    var W = Math.max(200, Math.round(opcoes.largura || 280)), H = 80, P = { x: 4, topo: 8, base: 6 };

    el.innerHTML = '';
    el.classList.add('grafico-mini');
    var n = serie.length;
    var maximo = 0;
    serie.forEach(function (p) {
      if (p[campoMeta] > maximo) maximo = p[campoMeta];
      if (p[campoReal] != null && p[campoReal] > maximo) maximo = p[campoReal];
    });
    if (!(maximo > 0)) maximo = 1;
    var x = function (i) { return n <= 1 ? W / 2 : P.x + (i / (n - 1)) * (W - 2 * P.x); };
    var y = function (v) { return P.topo + (H - P.topo - P.base) * (1 - v / maximo); };
    var r2 = function (v) { return Math.round(v * 10) / 10; };

    var ultimo = n ? serie[n - 1] : null;
    var ultimoReal = null;
    serie.forEach(function (p, i) { if (p[campoReal] != null) ultimoReal = i; });

    var svg = no('svg', {
      viewBox: '0 0 ' + W + ' ' + H, width: '100%', class: 'grafico-mini__svg', role: 'img',
      'aria-label': opcoes.titulo || ('Meta acumulada ' + fmt.cheio(ultimo ? ultimo[campoMeta] : 0) +
        '; realizado acumulado ' + fmt.cheio(ultimoReal === null ? 0 : serie[ultimoReal][campoReal]))
    }, el);
    no('line', { x1: 0, x2: W, y1: H - P.base + 0.5, y2: H - P.base + 0.5, stroke: COR_GRADE, 'stroke-width': 1 }, svg);
    if (!n) return svg;

    /* Realizado: área suave + linha milho */
    if (ultimoReal !== null) {
      var pts = [];
      for (var i = 0; i <= ultimoReal; i++) {
        if (serie[i][campoReal] != null) pts.push([r2(x(i)), r2(y(serie[i][campoReal]))]);
      }
      if (pts.length === 1) pts.unshift([r2(Math.max(0, pts[0][0] - 3)), pts[0][1]]);
      var linha = pts.map(function (p, k) { return (k ? 'L' : 'M') + p[0] + ',' + p[1]; }).join('');
      var base = r2(H - P.base);
      no('path', { d: linha + 'L' + pts[pts.length - 1][0] + ',' + base + 'L' + pts[0][0] + ',' + base + 'Z',
        fill: '#f2b544', 'fill-opacity': 0.22, stroke: 'none', class: 'grafico-mini__area' }, svg);
      no('path', { d: linha, fill: 'none', stroke: '#f2b544', 'stroke-width': 2.5, 'stroke-linejoin': 'round',
        'stroke-linecap': 'round', class: 'grafico-mini__realizado' }, svg);
    }

    /* Meta: tracejada floresta (por cima, para continuar visível onde se cruzam) */
    var dMeta = n === 1
      ? 'M' + r2(x(0) - 6) + ',' + r2(y(serie[0][campoMeta])) + 'H' + r2(x(0) + 6)
      : serie.map(function (p, k) { return (k ? 'L' : 'M') + r2(x(k)) + ',' + r2(y(p[campoMeta])); }).join('');
    no('path', { d: dMeta, fill: 'none', stroke: '#0f3d2e', 'stroke-width': 1.5, 'stroke-dasharray': '4 3',
      class: 'grafico-mini__meta' }, svg);

    /* Marcador do dia de hoje */
    if (opcoes.hoje) {
      var idx = -1;
      serie.forEach(function (p, k) { if (p.data <= opcoes.hoje) idx = k; });
      if (idx >= 0) {
        var xx = r2(x(idx));
        var g = no('g', { class: 'grafico-mini__hoje' }, svg);
        no('line', { x1: xx, x2: xx, y1: 2, y2: H - P.base, stroke: '#2f7d4f', 'stroke-width': 1, 'stroke-dasharray': '2 2' }, g);
        var vReal = serie[idx][campoReal];
        if (vReal != null) {
          no('circle', { cx: xx, cy: r2(y(vReal)), r: 3.5, fill: '#f2b544', stroke: '#ffffff', 'stroke-width': 1.5 }, g);
        }
        var dica = no('title', {}, g);
        dica.textContent = 'Hoje · realizado acumulado ' + fmt.cheio(vReal || 0) + ' de ' + fmt.cheio(serie[idx][campoMeta]) + ' previstos até aqui';
      }
    }
    return svg;
  }

  /* =====================================================================
   * Gráficos do Dashboard
   * ===================================================================== */

  var COR_CANAL = { iFood: '#0f3d2e', '99Food': '#f2b544' };
  /* Tons derivados da paleta (folha, menta, milho e floresta), em ordem de contraste */
  var TONS = ['#2f7d4f', '#c98a12', '#7fb393', '#1f5c44', '#f6cf7f', '#4f9a6c', '#8a5f0c', '#b9d8c4'];
  var COR_TOTAL = '#2f7d4f';
  var COR_REDUCAO = '#d9962b';
  var COR_AUMENTO = '#7fb393';
  var MENTA = [0xe4, 0xf0, 0xe8];
  var FLORESTA = [0x0f, 0x3d, 0x2e];
  var TEXTO_VAZIO = 'Sem pedidos neste recorte';
  var COR_REFERENCIA = '#c0392b';

  function corSerie(nome, i) { return COR_CANAL[nome] || TONS[i % TONS.length]; }
  function comCor(s, i) {
    var c = {};
    Object.keys(s).forEach(function (k) { c[k] = s[k]; });
    c.cor = s.cor || corSerie(s.nome, i);
    return c;
  }

  /* Escala sequencial menta -> floresta (t de 0 a 1) */
  function corCalor(t) {
    t = Math.max(0, Math.min(1, t || 0));
    return '#' + MENTA.map(function (a, i) {
      var v = Math.round(a + (FLORESTA[i] - a) * t);
      return (v < 16 ? '0' : '') + v.toString(16);
    }).join('');
  }

  /* Largura útil do contêiner (o viewBox usa a largura real para o texto não encolher) */
  function larguraDe(el) {
    var w = Math.floor(el.clientWidth || (el.parentNode && el.parentNode.clientWidth) || 0);
    return Math.max(260, Math.min(w || 600, 1400));
  }

  function registrar(el, fn, opcoes) {
    var antes = el._grafico;
    el._grafico = { fn: fn, opcoes: opcoes, largura: larguraDe(el), verDados: !!(antes && antes.verDados) };
  }

  function vazio(el, opcoes) {
    el.innerHTML = '';
    el.classList.add('grafico');
    var p = document.createElement('p');
    p.className = 'grafico__vazio';
    p.setAttribute('role', 'status');
    p.textContent = (opcoes && opcoes.vazio) || TEXTO_VAZIO;
    el.appendChild(p);
    return null;
  }

  /* Valor numérico + texto formatado para a tabela "Ver dados" */
  function valorCelula(v, fmt) {
    var n = Number(v) || 0;
    return { valor: n, texto: fmt.cheio(n) };
  }

  /* Ponto, barra ou fatia: focável, com tooltip e valor para os testes */
  function marcar(forma, valor, dica, clique) {
    forma.setAttribute('tabindex', '0');
    if (clique != null) {
      forma.setAttribute('data-clique', JSON.stringify([].concat(clique)));
      forma.classList.add('grafico__alvo--clicavel');
    }
    forma.setAttribute('focusable', 'true');
    forma.setAttribute('data-valor', String(valor));
    forma.setAttribute('data-dica', dica);
    forma.setAttribute('aria-label', dica);
    forma.classList.add('grafico__alvo');
  }

  function tabelaDados(cab, linhas) {
    var t = document.createElement('table');
    t.className = 'tabela tabela--grafico';
    var thead = t.createTHead().insertRow();
    cab.forEach(function (c, i) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = c;
      if (i > 0) th.className = 'num';
      thead.appendChild(th);
    });
    var corpo = t.createTBody();
    linhas.forEach(function (l) {
      var tr = corpo.insertRow();
      l.forEach(function (c, i) {
        var td = i === 0 ? document.createElement('th') : document.createElement('td');
        if (i === 0) td.scope = 'row';
        if (c && typeof c === 'object') {
          td.textContent = c.texto;
          if (c.valor != null) td.setAttribute('data-valor', String(c.valor));
          td.className = 'num';
        } else {
          td.textContent = c == null ? '' : String(c);
          if (i > 0) td.className = 'num';
        }
        tr.appendChild(td);
      });
    });
    return t;
  }

  /*
   * Moldura comum: barra com "Ver dados", legenda (opcional), área do desenho, tabela
   * alternativa (escondida) e tooltip. Devolve { area }.
   */
  function quadro(el, opcoes, cab, linhas, legenda) {
    el.innerHTML = '';
    el.classList.add('grafico');
    var estado = el._grafico || {};

    var barra = document.createElement('div');
    barra.className = 'grafico__ferramentas';
    var botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'grafico__ver-dados';
    barra.appendChild(botao);
    el.appendChild(barra);

    if (legenda) el.appendChild(legenda);

    var area = document.createElement('div');
    area.className = 'grafico__area';
    el.appendChild(area);

    var caixaTabela = document.createElement('div');
    caixaTabela.className = 'grafico__tabela tabela-wrap';
    caixaTabela.appendChild(tabelaDados(cab, linhas));
    el.appendChild(caixaTabela);

    var dica = document.createElement('div');
    dica.className = 'grafico__dica';
    dica.setAttribute('role', 'tooltip');
    dica.hidden = true;
    el.appendChild(dica);

    function aplicar(verDados) {
      estado.verDados = verDados;
      area.hidden = verDados;
      if (legenda) legenda.hidden = verDados;
      caixaTabela.hidden = !verDados;
      botao.textContent = verDados ? 'Ver gráfico' : 'Ver dados';
      botao.setAttribute('aria-pressed', verDados ? 'true' : 'false');
      dica.hidden = true;
    }
    aplicar(!!estado.verDados);
    botao.addEventListener('click', function () { aplicar(!estado.verDados); });

    function mostrar(alvo) {
      dica.textContent = alvo.getAttribute('data-dica');
      dica.hidden = false;
      var caixa = el.getBoundingClientRect();
      var r = alvo.getBoundingClientRect();
      var w = dica.offsetWidth;
      var x = r.left - caixa.left + r.width / 2 - w / 2;
      x = Math.max(0, Math.min(x, caixa.width - w));
      var y = r.top - caixa.top - dica.offsetHeight - 8;
      if (y < 0) y = r.bottom - caixa.top + 8;
      dica.style.left = Math.round(x) + 'px';
      dica.style.top = Math.round(y) + 'px';
    }
    function esconder() { dica.hidden = true; }
    var alvoDe = function (e) { return e.target && e.target.closest ? e.target.closest('[data-dica]') : null; };
    area.addEventListener('mouseover', function (e) { var a = alvoDe(e); if (a) mostrar(a); });
    area.addEventListener('mouseout', function (e) { if (alvoDe(e)) esconder(); });
    area.addEventListener('focusin', function (e) { var a = alvoDe(e); if (a) mostrar(a); });
    area.addEventListener('focusout', esconder);
    area.addEventListener('keydown', function (e) { if (e.key === 'Escape') esconder(); });

    /* Clique ou Enter/Espaço num alvo com data-clique chama opcoes.aoClicar(...argumentos) */
    if (typeof opcoes.aoClicar === 'function') {
      var acionar = function (alvo) {
        esconder();
        opcoes.aoClicar.apply(null, JSON.parse(alvo.getAttribute('data-clique')));
      };
      var clicavel = function (e) { return e.target && e.target.closest ? e.target.closest('[data-clique]') : null; };
      area.addEventListener('click', function (e) { var a = clicavel(e); if (a) acionar(a); });
      area.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var a = clicavel(e);
        if (a) { e.preventDefault(); acionar(a); }
      });
    }

    return { area: area };
  }

  function legendaHtml(itens) {
    var ul = document.createElement('ul');
    ul.className = 'grafico__legenda';
    itens.forEach(function (it) {
      var li = document.createElement('li');
      var marca = document.createElement('span');
      marca.className = 'grafico__marca';
      marca.style.background = it.cor;
      li.appendChild(marca);
      li.appendChild(document.createTextNode(it.nome));
      if (it.extra) {
        var b = document.createElement('span');
        b.className = 'grafico__legenda-valor';
        b.textContent = it.extra;
        li.appendChild(b);
      }
      ul.appendChild(li);
    });
    return ul;
  }

  function svgResponsivo(pai, w, h, rotulo) {
    return no('svg', {
      viewBox: '0 0 ' + w + ' ' + h, width: '100%', preserveAspectRatio: 'xMidYMid meet',
      role: 'img', 'aria-label': rotulo
    }, pai);
  }

  /* Texto em até duas linhas que caibam em "largura" (≈ 6,5 px por caractere a 12 px) */
  function textoQuebrado(conteudo, x, y, largura, atributos, pai) {
    var max = Math.max(4, Math.floor(largura / 6.5));
    var palavras = String(conteudo).split(' ');
    var linhasTxt = [''];
    palavras.forEach(function (p) {
      var atual = linhasTxt[linhasTxt.length - 1];
      if (atual && (atual + ' ' + p).length > max && linhasTxt.length < 2) linhasTxt.push(p);
      else linhasTxt[linhasTxt.length - 1] = atual ? atual + ' ' + p : p;
    });
    var t = no('text', atributos, pai);
    t.setAttribute('x', x);
    t.setAttribute('y', y);
    linhasTxt.forEach(function (l, i) {
      var ts = no('tspan', { x: x, dy: i ? '1.2em' : 0 }, t);
      ts.textContent = l.length > max + 2 ? l.slice(0, max) + '…' : l;
    });
    return t;
  }

  function soma(lista) { return lista.reduce(function (a, v) { return a + (Number(v) || 0); }, 0); }

  function grade(svg, marcas, y, x1, x2, fmt) {
    var g = no('g', { 'font-size': 12, fill: COR_TEXTO }, svg);
    marcas.forEach(function (m) {
      var yy = Math.round(y(m)) + 0.5;
      no('line', { x1: x1, x2: x2, y1: yy, y2: yy, stroke: COR_GRADE, 'stroke-width': 1,
        'stroke-dasharray': m === 0 ? '' : '3 3' }, g);
      texto(fmt.eixo(m), { x: x1 - 8, y: yy + 4, 'text-anchor': 'end', 'fill-opacity': 0.7 }, g);
    });
  }

  /* ---------- Linhas ---------- */

  function linhas(el, opcoes) {
    registrar(el, linhas, opcoes);
    var categorias = opcoes.categorias || [];
    var series = (opcoes.series || []).filter(function (s) { return s && s.valores; }).map(comCor);
    var temValor = series.some(function (s) { return s.valores.some(function (v) { return v != null; }); });
    if (!categorias.length || !series.length || !temValor) return vazio(el, opcoes);

    var fmt = formatadores(opcoes.formato);
    var rotulo = opcoes.rotuloCategoria || function (c) { return String(c); };
    var rotuloEixo = opcoes.rotuloEixo || rotulo;

    var q = quadro(el, opcoes, [opcoes.rotuloTabela || 'Categoria'].concat(series.map(function (s) { return s.nome; })),
      categorias.map(function (c, i) {
        return [rotulo(c)].concat(series.map(function (s) { return s.valores[i] == null ? '—' : valorCelula(s.valores[i], fmt); }));
      }),
      legendaHtml(series.map(function (s) { return { nome: s.nome, cor: s.cor }; })));

    var W = larguraDe(el), H = W < 480 ? 220 : 260;
    var M = { topo: 14, dir: 16, base: 28, esq: W < 480 ? 56 : 72 };
    var areaW = W - M.esq - M.dir, areaH = H - M.topo - M.base;
    var maximo = 0;
    series.forEach(function (s) { s.valores.forEach(function (v) { if (v > maximo) maximo = v; }); });
    var marcas = marcasEixo(maximo);
    var teto = marcas[marcas.length - 1];
    var n = categorias.length;
    var x = function (i) { return M.esq + (n <= 1 ? areaW / 2 : (i / (n - 1)) * areaW); };
    var y = function (v) { return M.topo + areaH - (v / teto) * areaH; };
    var r1 = function (v) { return Math.round(v * 10) / 10; };

    var resumo = opcoes.titulo || ('Gráfico de linhas com ' + n + ' pontos: ' + series.map(function (s) {
      return s.nome + ' soma ' + fmt.cheio(soma(s.valores));
    }).join('; '));
    var svg = svgResponsivo(q.area, W, H, resumo);
    grade(svg, marcas, y, M.esq, W - M.dir, fmt);

    /* Rótulos do eixo X: no máximo um a cada ~48 px */
    var passo = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(areaW / 48))));
    var eixo = no('g', { 'font-size': 11, fill: COR_TEXTO, 'fill-opacity': 0.75, 'text-anchor': 'middle' }, svg);
    categorias.forEach(function (c, i) {
      if (i % passo === 0 || (i === n - 1 && (n - 1) % passo > passo / 2)) {
        texto(rotuloEixo(c), { x: r1(x(i)), y: H - M.base + 18 }, eixo);
      }
    });

    series.forEach(function (s) {
      var d = '';
      var caneta = false;
      s.valores.forEach(function (v, i) {
        if (v == null) { caneta = false; return; }
        d += (caneta ? 'L' : 'M') + r1(x(i)) + ',' + r1(y(v));
        caneta = true;
      });
      no('path', { d: d, fill: 'none', stroke: s.cor, 'stroke-width': 2.5, 'stroke-linejoin': 'round',
        'stroke-linecap': 'round', class: 'grafico__linha' }, svg);
    });
    var pontos = no('g', {}, svg);
    series.forEach(function (s) {
      s.valores.forEach(function (v, i) {
        if (v == null) return;
        var c = no('circle', { cx: r1(x(i)), cy: r1(y(v)), r: n > 40 ? 3 : 4, fill: '#ffffff', stroke: s.cor,
          'stroke-width': 2, class: 'grafico__ponto' }, pontos);
        marcar(c, v, opcoes.dica ? opcoes.dica(i, s, v) : rotulo(categorias[i]) + ' · ' + s.nome + ': ' + fmt.cheio(v),
          opcoes.aoClicar ? i : null);
      });
    });
    return svg;
  }

  /* ---------- Cascata ---------- */

  function cascata(el, opcoes) {
    registrar(el, cascata, opcoes);
    var etapas = (opcoes.etapas || []).filter(function (e) { return e && e.valor != null; });
    if (!etapas.length) return vazio(el, opcoes);
    var fmt = formatadores(opcoes.formato || 'moeda');

    /* Posição de cada barra: total parte do zero; redução tira do acumulado (negativa soma) */
    var acum = 0, minimo = 0, maximo = 0;
    var barrasC = etapas.map(function (e) {
      var de, ate;
      if (e.tipo === 'total') { de = 0; ate = e.valor; acum = e.valor; } else { de = acum; ate = acum - e.valor; acum = ate; }
      minimo = Math.min(minimo, de, ate);
      maximo = Math.max(maximo, de, ate);
      return { e: e, de: de, ate: ate };
    });
    var sinal = function (e) { return e.tipo === 'total' ? fmt.cheio(e.valor) : (e.valor >= 0 ? '− ' : '+ ') + fmt.cheio(Math.abs(e.valor)); };

    var q = quadro(el, opcoes, ['Etapa', 'Valor'], etapas.map(function (e) {
      return [e.rotulo, { valor: e.valor, texto: sinal(e) }];
    }));

    var W = larguraDe(el);
    var resumoH = opcoes.titulo || ('Cascata: ' + etapas.map(function (e) { return e.rotulo + ' ' + sinal(e); }).join('; '));
    if (W < 560) return cascataHorizontal(q.area, W, barrasC, minimo, maximo, fmt, sinal, resumoH);
    var H = 280;
    var M = { topo: 24, dir: 12, base: 40, esq: W < 480 ? 56 : 72 };
    var areaW = W - M.esq - M.dir, areaH = H - M.topo - M.base;
    var marcas = marcasEixo(maximo);
    var teto = marcas[marcas.length - 1];
    var piso = Math.min(0, minimo);
    var y = function (v) { return M.topo + areaH - ((v - piso) / (teto - piso)) * areaH; };

    var resumo = opcoes.titulo || ('Cascata: ' + etapas.map(function (e) { return e.rotulo + ' ' + sinal(e); }).join('; '));
    var svg = svgResponsivo(q.area, W, H, resumo);
    grade(svg, marcas, y, M.esq, W - M.dir, fmt);

    var larg = areaW / etapas.length;
    var barraW = Math.max(14, larg * 0.62);
    var g = no('g', {}, svg);
    barrasC.forEach(function (b, i) {
      var x = M.esq + i * larg + (larg - barraW) / 2;
      var topo = y(Math.max(b.de, b.ate)), base = y(Math.min(b.de, b.ate));
      var h = Math.max(1, base - topo);
      var cor = b.e.tipo === 'total' ? (i === 0 ? COR_TEXTO : COR_TOTAL) : (b.e.valor >= 0 ? COR_REDUCAO : COR_AUMENTO);
      var r = no('rect', { x: Math.round(x * 10) / 10, y: Math.round(topo * 10) / 10, width: Math.round(barraW * 10) / 10,
        height: Math.round(h * 10) / 10, rx: 4, fill: cor, class: 'grafico__barra' }, g);
      marcar(r, b.e.valor, b.e.rotulo + ': ' + sinal(b.e));
      /* Conector tracejado até a próxima barra */
      if (i < barrasC.length - 1) {
        var yy = Math.round(y(b.ate)) + 0.5;
        no('line', { x1: x + barraW, x2: x + larg, y1: yy, y2: yy, stroke: COR_TEXTO, 'stroke-opacity': 0.35,
          'stroke-dasharray': '3 3' }, g);
      }
      texto(W < 480 ? fmt.eixo(b.e.tipo === 'total' ? b.e.valor : -b.e.valor) : sinal(b.e), {
        x: x + barraW / 2, y: topo - 6, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: COR_TEXTO
      }, g);
      textoQuebrado(b.e.rotulo, x + barraW / 2, H - M.base + 16, larg, {
        'text-anchor': 'middle', 'font-size': 11, fill: COR_TEXTO, 'fill-opacity': 0.8
      }, g);
    });
    return svg;
  }

  /* Cascata em contêiner estreito: uma linha por etapa, rótulo acima da barra e valor ao lado */
  function cascataHorizontal(area, W, barrasC, minimo, maximo, fmt, sinal, resumo) {
    var M = { topo: 4, esq: 8, dir: 12, base: 8 };
    var linha = 44, barraH = 18;
    var H = M.topo + barrasC.length * linha + M.base;
    var piso = Math.min(0, minimo);
    var areaW = W - M.esq - M.dir;
    var x = function (v) { return M.esq + ((v - piso) / ((maximo - piso) || 1)) * areaW; };
    var svg = svgResponsivo(area, W, H, resumo);
    var g = no('g', { 'font-size': 12 }, svg);
    barrasC.forEach(function (b, i) {
      var y0 = M.topo + i * linha;
      var x0 = x(Math.min(b.de, b.ate)), x1 = x(Math.max(b.de, b.ate));
      var cor = b.e.tipo === 'total' ? (i === 0 ? COR_TEXTO : COR_TOTAL) : (b.e.valor >= 0 ? COR_REDUCAO : COR_AUMENTO);
      texto(b.e.rotulo, { x: M.esq, y: y0 + 13, fill: COR_TEXTO, 'font-weight': 600 }, g);
      texto(sinal(b.e), { x: W - M.dir, y: y0 + 13, 'text-anchor': 'end', fill: COR_TEXTO, 'font-weight': 700 }, g);
      var r = no('rect', { x: Math.round(x0 * 10) / 10, y: y0 + 19, width: Math.max(1, Math.round((x1 - x0) * 10) / 10),
        height: barraH, rx: 3, fill: cor, class: 'grafico__barra' }, g);
      marcar(r, b.e.valor, b.e.rotulo + ': ' + sinal(b.e));
      if (i < barrasC.length - 1) {
        var xx = Math.round(x(b.ate)) + 0.5;
        no('line', { x1: xx, x2: xx, y1: y0 + 19 + barraH, y2: y0 + linha + 19, stroke: COR_TEXTO, 'stroke-opacity': 0.35,
          'stroke-dasharray': '3 3' }, g);
      }
    });
    return svg;
  }

  /* ---------- Rosca ---------- */

  function arco(cx, cy, r, a0, a1) {
    var p = function (a) { return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; };
    return { de: p(a0), ate: p(a1), grande: a1 - a0 > Math.PI ? 1 : 0 };
  }

  function caminhoFatia(cx, cy, R, r, a0, a1) {
    var f = function (v) { return Math.round(v * 100) / 100; };
    if (a1 - a0 >= Math.PI * 2 - 1e-6) {
      /* Fatia única: anel completo em duas metades */
      return caminhoFatia(cx, cy, R, r, 0, Math.PI) + caminhoFatia(cx, cy, R, r, Math.PI, Math.PI * 2);
    }
    var o = arco(cx, cy, R, a0, a1), i = arco(cx, cy, r, a0, a1);
    return 'M' + f(o.de[0]) + ',' + f(o.de[1]) +
      'A' + R + ',' + R + ' 0 ' + o.grande + ' 1 ' + f(o.ate[0]) + ',' + f(o.ate[1]) +
      'L' + f(i.ate[0]) + ',' + f(i.ate[1]) +
      'A' + r + ',' + r + ' 0 ' + i.grande + ' 0 ' + f(i.de[0]) + ',' + f(i.de[1]) + 'Z';
  }

  function rosca(el, opcoes) {
    registrar(el, rosca, opcoes);
    var fatias = (opcoes.fatias || []).filter(function (f) { return f && Number(f.valor) > 0; })
      .map(function (f, i) { return { rotulo: f.rotulo, valor: Number(f.valor), cor: f.cor || corSerie(f.rotulo, i) }; });
    if (!fatias.length) return vazio(el, opcoes);
    var fmt = formatadores(opcoes.formato);
    var total = soma(fatias.map(function (f) { return f.valor; }));
    var pct = function (v) { return umaCasa.format(v / total * 100) + '%'; };

    var q = quadro(el, opcoes, ['Categoria', 'Valor', 'Participação'], fatias.map(function (f) {
      return [f.rotulo, valorCelula(f.valor, fmt), pct(f.valor)];
    }));
    q.area.classList.add('grafico__area--rosca');

    var S = 220, cx = S / 2, cy = S / 2, R = 100, r = 64;
    var centro = opcoes.centro == null ? { valor: fmt.cheio(total), rotulo: 'Total' }
      : (typeof opcoes.centro === 'object' ? opcoes.centro : { valor: String(opcoes.centro), rotulo: '' });
    var resumo = opcoes.titulo || ('Rosca: ' + fatias.map(function (f) {
      return f.rotulo + ' ' + fmt.cheio(f.valor) + ' (' + pct(f.valor) + ')';
    }).join('; ') + '. ' + (centro.rotulo || 'Total') + ' ' + centro.valor);
    var svg = svgResponsivo(q.area, S, S, resumo);
    svg.setAttribute('class', 'grafico__rosca');
    var a = 0;
    var g = no('g', {}, svg);
    fatias.forEach(function (f) {
      var a1 = a + (f.valor / total) * Math.PI * 2;
      var p = no('path', { d: caminhoFatia(cx, cy, R, r, a, a1), fill: f.cor, stroke: '#ffffff', 'stroke-width': 2,
        class: 'grafico__fatia' }, g);
      marcar(p, f.valor, f.rotulo + ': ' + fmt.cheio(f.valor) + ' (' + pct(f.valor) + ')');
      a = a1;
    });
    texto(centro.valor, { x: cx, y: cy + (centro.rotulo ? 2 : 7), 'text-anchor': 'middle', 'font-size': 22,
      'font-weight': 800, fill: COR_TEXTO }, svg);
    if (centro.rotulo) {
      texto(centro.rotulo, { x: cx, y: cy + 22, 'text-anchor': 'middle', 'font-size': 12, fill: COR_TEXTO,
        'fill-opacity': 0.7 }, svg);
    }
    q.area.appendChild(legendaHtml(fatias.map(function (f) {
      return { nome: f.rotulo, cor: f.cor, extra: fmt.cheio(f.valor) + ' · ' + pct(f.valor) };
    })));
    return svg;
  }

  /* ---------- Mapa de calor ---------- */

  function mapaCalor(el, opcoes) {
    registrar(el, mapaCalor, opcoes);
    var nomesL = opcoes.linhas || [], nomesC = opcoes.colunas || [], valores = opcoes.valores || [];
    var maximo = 0;
    valores.forEach(function (l) { (l || []).forEach(function (v) { if (v > maximo) maximo = v; }); });
    if (!nomesL.length || !nomesC.length || !valores.length || !(maximo > 0)) return vazio(el, opcoes);
    var fmt = formatadores(opcoes.formato);

    var q = quadro(el, opcoes, [opcoes.rotuloTabela || ''].concat(nomesC), nomesL.map(function (l, i) {
      return [l].concat(nomesC.map(function (c, j) { return valorCelula((valores[i] || [])[j], fmt); }));
    }));

    var W = larguraDe(el);
    var M = { topo: 24, esq: 44, dir: 4, base: 30 };
    var celW = (W - M.esq - M.dir) / nomesC.length;
    var celH = 30;
    var H = M.topo + nomesL.length * celH + M.base;
    var resumo = opcoes.titulo || ('Mapa de calor ' + nomesL.length + ' por ' + nomesC.length + '; máximo ' + fmt.cheio(maximo));
    var svg = svgResponsivo(q.area, W, H, resumo);
    var g = no('g', { 'font-size': 12 }, svg);
    nomesC.forEach(function (c, j) {
      texto(c, { x: M.esq + j * celW + celW / 2, y: 16, 'text-anchor': 'middle', fill: COR_TEXTO, 'fill-opacity': 0.75 }, g);
    });
    nomesL.forEach(function (l, i) {
      texto(l, { x: M.esq - 8, y: M.topo + i * celH + celH / 2 + 4, 'text-anchor': 'end', fill: COR_TEXTO, 'fill-opacity': 0.75 }, g);
      nomesC.forEach(function (c, j) {
        var v = Number((valores[i] || [])[j]) || 0;
        var t = v / maximo;
        var x = M.esq + j * celW, y = M.topo + i * celH;
        var r = no('rect', { x: Math.round((x + 1) * 10) / 10, y: y + 1, width: Math.max(1, Math.round((celW - 2) * 10) / 10),
          height: celH - 2, rx: 4, fill: corCalor(t), class: 'grafico__celula' }, g);
        marcar(r, v, l + ' · ' + c + ': ' + fmt.cheio(v) + (opcoes.dicaClique ? ' · ' + opcoes.dicaClique : ''),
          opcoes.aoClicar ? [i, j] : null);
        if (celW >= 26) {
          texto(fmt.cheio(v), { x: x + celW / 2, y: y + celH / 2 + 4, 'text-anchor': 'middle', 'font-weight': 600,
            fill: t > 0.5 ? '#ffffff' : COR_TEXTO, 'pointer-events': 'none' }, g);
        }
      });
    });
    /* Legenda da escala */
    var ly = H - 14, lw = Math.min(160, W - M.esq - 80);
    var grad = no('defs', {}, svg);
    var id = 'calor-' + Math.random().toString(36).slice(2, 8);
    var lg = no('linearGradient', { id: id }, grad);
    no('stop', { offset: '0', 'stop-color': corCalor(0) }, lg);
    no('stop', { offset: '1', 'stop-color': corCalor(1) }, lg);
    texto(fmt.eixo(0), { x: M.esq, y: ly + 9, 'font-size': 11, fill: COR_TEXTO, 'fill-opacity': 0.7 }, svg);
    no('rect', { x: M.esq + 18, y: ly, width: lw, height: 10, rx: 3, fill: 'url(#' + id + ')' }, svg);
    texto(fmt.cheio(maximo), { x: M.esq + 24 + lw, y: ly + 9, 'font-size': 11, fill: COR_TEXTO, 'fill-opacity': 0.7 }, svg);
    return svg;
  }

  /* ---------- Barras empilhadas (horizontais; cem: true = 100%) ---------- */

  function barrasEmpilhadas(el, opcoes) {
    registrar(el, barrasEmpilhadas, opcoes);
    var categorias = opcoes.categorias || [];
    var series = (opcoes.series || []).filter(function (s) { return s && s.valores; }).map(comCor);
    var totais = categorias.map(function (c, i) { return soma(series.map(function (s) { return s.valores[i]; })); });
    if (!categorias.length || !series.length || !totais.some(function (t) { return t > 0; })) return vazio(el, opcoes);
    var fmt = formatadores(opcoes.formato);
    var cem = !!opcoes.cem;
    var pct = function (v, t) { return t > 0 ? umaCasa.format(v / t * 100) + '%' : '—'; };

    var q = quadro(el, opcoes, [opcoes.rotuloTabela || 'Categoria'].concat(series.map(function (s) { return s.nome; })),
      categorias.map(function (c, i) {
        return [c].concat(series.map(function (s) {
          var v = Number(s.valores[i]) || 0;
          return { valor: v, texto: fmt.cheio(v) + (cem ? ' (' + pct(v, totais[i]) + ')' : '') };
        }));
      }),
      legendaHtml(series.map(function (s) { return { nome: s.nome, cor: s.cor }; })));

    var W = larguraDe(el);
    var M = { topo: 4, esq: 8, dir: 16, base: 24 };
    var linha = 52, barraH = 24;
    var H = M.topo + categorias.length * linha + M.base;
    var areaW = W - M.esq - M.dir;
    var teto = cem ? 100 : marcasEixo(Math.max.apply(null, totais)).slice(-1)[0];
    var marcas = cem ? [0, 25, 50, 75, 100] : marcasEixo(Math.max.apply(null, totais));
    var x = function (v) { return M.esq + (v / teto) * areaW; };
    var fmtEixo = cem ? function (v) { return v + '%'; } : fmt.eixo;

    var resumo = opcoes.titulo || ('Barras empilhadas' + (cem ? ' 100%' : '') + ': ' + categorias.map(function (c, i) {
      return c + ' — ' + series.map(function (s) { return s.nome + ' ' + (cem ? pct(s.valores[i] || 0, totais[i]) : fmt.cheio(s.valores[i] || 0)); }).join(', ');
    }).join('; '));
    var svg = svgResponsivo(q.area, W, H, resumo);
    var g = no('g', { 'font-size': 12 }, svg);
    marcas.forEach(function (m) {
      var xx = Math.round(x(m)) + 0.5;
      no('line', { x1: xx, x2: xx, y1: M.topo, y2: H - M.base, stroke: COR_GRADE, 'stroke-dasharray': m ? '3 3' : '' }, g);
      texto(fmtEixo(m), { x: xx, y: H - 6, 'text-anchor': m === 0 ? 'start' : (m === teto ? 'end' : 'middle'),
        'font-size': 11, fill: COR_TEXTO, 'fill-opacity': 0.7 }, g);
    });
    categorias.forEach(function (c, i) {
      var y0 = M.topo + i * linha;
      texto(c, { x: M.esq, y: y0 + 14, 'font-weight': 600, fill: COR_TEXTO }, g);
      var acum = 0;
      series.forEach(function (s) {
        var v = Number(s.valores[i]) || 0;
        var base = cem ? (totais[i] > 0 ? v / totais[i] * 100 : 0) : v;
        var x0 = x(acum), w = x(acum + base) - x0;
        acum += base;
        var r = no('rect', { x: Math.round(x0 * 10) / 10, y: y0 + 20, width: Math.max(0, Math.round(w * 10) / 10),
          height: barraH, fill: s.cor, class: 'grafico__barra' }, g);
        marcar(r, v, c + ' · ' + s.nome + ': ' + fmt.cheio(v) + (opcoes.participacao === false ? '' : ' (' + pct(v, totais[i]) + ')'));
        var rotulo = cem ? pct(v, totais[i]) : fmt.cheio(v);
        if (w > rotulo.length * 7 + 8) {
          var escuro = s.cor === COR_CANAL.iFood || s.cor === TONS[0] || s.cor === TONS[3] || s.cor === TONS[6];
          texto(rotulo, { x: x0 + w / 2, y: y0 + 20 + barraH / 2 + 4, 'text-anchor': 'middle', 'font-size': 11,
            'font-weight': 700, fill: escuro ? '#ffffff' : COR_TEXTO, 'pointer-events': 'none' }, g);
        }
      });
    });
    return svg;
  }


  /* ---------- Dispersão ---------- */

  /*
   * dispersao(el, { pontos: [{ x, y, serie, rotulo }], formatoX, formatoY, rotuloX, rotuloY, titulo? })
   * Um ponto por registro, cor pela série (canal). A tabela "Ver dados" tem uma linha por ponto.
   */
  function dispersao(el, opcoes) {
    registrar(el, dispersao, opcoes);
    var pontos = (opcoes.pontos || []).filter(function (p) { return p && p.x != null && p.y != null; });
    if (!pontos.length) return vazio(el, opcoes);
    var fx = formatadores(opcoes.formatoX), fy = formatadores(opcoes.formatoY);
    var nomes = [];
    pontos.forEach(function (p) { if (nomes.indexOf(p.serie) < 0) nomes.push(p.serie); });
    var cores = {};
    nomes.forEach(function (n, i) { cores[n] = corSerie(n, i); });
    var rx = opcoes.rotuloX || 'X', ry = opcoes.rotuloY || 'Y';

    var q = quadro(el, opcoes, [opcoes.rotuloTabela || 'Registro', 'Série', rx, ry], pontos.map(function (p, i) {
      return [p.rotulo || String(i + 1), p.serie, fx.cheio(p.x), valorCelula(p.y, fy)];
    }), legendaHtml(nomes.map(function (n) { return { nome: n, cor: cores[n] }; })));

    var W = larguraDe(el), H = W < 480 ? 240 : 280;
    var M = { topo: 12, dir: 16, base: 44, esq: W < 480 ? 56 : 72 };
    var areaW = W - M.esq - M.dir, areaH = H - M.topo - M.base;
    var mx = 0, my = 0;
    pontos.forEach(function (p) { if (p.x > mx) mx = p.x; if (p.y > my) my = p.y; });
    var marcasY = marcasEixo(my), marcasX = marcasEixo(mx);
    var tetoY = marcasY[marcasY.length - 1], tetoX = marcasX[marcasX.length - 1];
    var x = function (v) { return M.esq + (v / tetoX) * areaW; };
    var y = function (v) { return M.topo + areaH - (v / tetoY) * areaH; };
    var r1 = function (v) { return Math.round(v * 10) / 10; };

    var resumo = opcoes.titulo || ('Dispersão de ' + pontos.length + ' pontos: ' + rx + ' × ' + ry);
    var svg = svgResponsivo(q.area, W, H, resumo);
    grade(svg, marcasY, y, M.esq, W - M.dir, fy);
    var gx = no('g', { 'font-size': 11, fill: COR_TEXTO, 'fill-opacity': 0.7, 'text-anchor': 'middle' }, svg);
    marcasX.forEach(function (m) {
      var xx = Math.round(x(m)) + 0.5;
      no('line', { x1: xx, x2: xx, y1: M.topo, y2: M.topo + areaH, stroke: COR_GRADE, 'stroke-dasharray': m ? '3 3' : '' }, gx);
      texto(fx.eixo(m), { x: xx, y: M.topo + areaH + 16 }, gx);
    });
    texto(rx, { x: M.esq + areaW / 2, y: H - 6, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 600, fill: COR_TEXTO }, svg);
    var g = no('g', {}, svg);
    pontos.forEach(function (p) {
      var c = no('circle', { cx: r1(x(p.x)), cy: r1(y(p.y)), r: 5, fill: cores[p.serie], 'fill-opacity': 0.75,
        stroke: '#ffffff', 'stroke-width': 1, class: 'grafico__ponto' }, g);
      marcar(c, p.y, (p.rotulo ? p.rotulo + ' · ' : '') + p.serie + ' · ' + rx + ' ' + fx.cheio(p.x) + ' · ' + ry + ' ' + fy.cheio(p.y));
    });
    return svg;
  }

  /* ---------- Boxplot ---------- */

  /*
   * boxplot(el, { grupos: [{ nome, n, media, q1, mediana, q3, limInf, limSup, fora: [{ id, valor }] }], formato, titulo? })
   * Uma linha horizontal por grupo (legível em 375 px): bigodes até limInf/limSup, caixa de Q1 a Q3,
   * mediana em destaque e os pontos fora da curva. Alvos focáveis: os 5 números e cada ponto fora.
   */
  function boxplot(el, opcoes) {
    registrar(el, boxplot, opcoes);
    var grupos = (opcoes.grupos || []).filter(function (g) { return g && g.n > 0; });
    if (!grupos.length) return vazio(el, opcoes);
    var fmt = formatadores(opcoes.formato || 'moeda');
    var NOMES = [['limInf', 'Mínimo (sem fora da curva)'], ['q1', '1º quartil'], ['mediana', 'Mediana'], ['q3', '3º quartil'], ['limSup', 'Máximo (sem fora da curva)']];

    var linhasTab = [];
    grupos.forEach(function (g) {
      linhasTab.push([g.nome + ' (' + inteiro.format(g.n) + ')'].concat(NOMES.map(function (k) { return valorCelula(g[k[0]], fmt); })));
      (g.fora || []).forEach(function (o) {
        linhasTab.push([g.nome + ' · fora da curva' + (o.id ? ' (' + String(o.id).slice(0, 8) + ')' : ''), '', '', valorCelula(o.valor, fmt), '', '']);
      });
    });
    var q = quadro(el, opcoes, ['Grupo (pedidos)', 'Mín.', 'Q1', 'Mediana', 'Q3', 'Máx.'], linhasTab,
      legendaHtml(grupos.map(function (g, i) { return { nome: g.nome, cor: corSerie(g.nome, i) }; })));

    var W = larguraDe(el);
    var M = { topo: 8, esq: 12, dir: 16, base: 26 };
    var linha = 64, caixaH = 24;
    var H = M.topo + grupos.length * linha + M.base;
    var maximo = 0, minimo = Infinity;
    grupos.forEach(function (g) {
      maximo = Math.max(maximo, g.limSup, g.q3);
      minimo = Math.min(minimo, g.limInf, g.q1);
      (g.fora || []).forEach(function (o) { maximo = Math.max(maximo, o.valor); minimo = Math.min(minimo, o.valor); });
    });
    /* Eixo começa no primeiro múltiplo "redondo" abaixo do menor valor, para a caixa não sumir */
    var passoBase = marcasEixo(maximo)[1] || 1;
    var piso = Math.max(0, Math.floor(minimo / passoBase) * passoBase);
    var marcas = marcasEixo(maximo - piso).map(function (m) { return Math.round((m + piso) * 1e6) / 1e6; });
    while (marcas.length > 2 && marcas[marcas.length - 2] >= maximo) marcas.pop();
    var teto = marcas[marcas.length - 1];
    var areaW = W - M.esq - M.dir;
    var x = function (v) { return M.esq + ((v - piso) / ((teto - piso) || 1)) * areaW; };
    var r1 = function (v) { return Math.round(v * 10) / 10; };

    var resumo = opcoes.titulo || ('Boxplot: ' + grupos.map(function (g) {
      return g.nome + ' mediana ' + fmt.cheio(g.mediana) + ', de ' + fmt.cheio(g.q1) + ' a ' + fmt.cheio(g.q3) +
        ' (metade central), ' + (g.fora || []).length + ' fora da curva';
    }).join('; '));
    var svg = svgResponsivo(q.area, W, H, resumo);
    var eixo = no('g', { 'font-size': 11, fill: COR_TEXTO, 'fill-opacity': 0.7 }, svg);
    marcas.forEach(function (m, k) {
      var xx = Math.round(x(m)) + 0.5;
      no('line', { x1: xx, x2: xx, y1: M.topo, y2: H - M.base, stroke: COR_GRADE, 'stroke-dasharray': m ? '3 3' : '' }, eixo);
      texto(fmt.eixo(m), { x: xx, y: H - 8, 'text-anchor': k === 0 ? 'start' : (k === marcas.length - 1 ? 'end' : 'middle') }, eixo);
    });
    grupos.forEach(function (g, i) {
      var cor = corSerie(g.nome, i);
      var y0 = M.topo + i * linha;
      var meio = y0 + 22 + caixaH / 2;
      var gg = no('g', {}, svg);
      texto(g.nome + ' · média ' + fmt.cheio(g.media), { x: M.esq, y: y0 + 13, 'font-size': 12, 'font-weight': 600, fill: COR_TEXTO }, gg);
      no('line', { x1: r1(x(g.limInf)), x2: r1(x(g.limSup)), y1: meio, y2: meio, stroke: cor, 'stroke-width': 2 }, gg);
      no('rect', { x: r1(x(g.q1)), y: y0 + 22, width: Math.max(1, r1(x(g.q3) - x(g.q1))), height: caixaH, rx: 4,
        fill: cor, 'fill-opacity': 0.22, stroke: cor, 'stroke-width': 1.5 }, gg);
      NOMES.forEach(function (k) {
        var v = g[k[0]];
        var central = k[0] === 'mediana';
        var alto = k[0] === 'limInf' || k[0] === 'limSup' ? caixaH * 0.6 : caixaH;
        var w = central ? 4 : 3;
        var r = no('rect', { x: r1(x(v) - w / 2), y: r1(meio - alto / 2), width: w, height: r1(alto), fill: central ? COR_TEXTO : cor,
          class: 'grafico__barra' }, gg);
        marcar(r, v, g.nome + ' · ' + k[1] + ': ' + fmt.cheio(v));
      });
      (g.fora || []).forEach(function (o) {
        var c = no('circle', { cx: r1(x(o.valor)), cy: meio, r: 5, fill: '#ffffff', stroke: cor, 'stroke-width': 2, class: 'grafico__ponto' }, gg);
        marcar(c, o.valor, g.nome + ' · fora da curva: ' + fmt.cheio(o.valor));
      });
    });
    return svg;
  }

  /* ---------- Progresso (atingimento de metas) ---------- */

  /*
   * progresso(el, { itens: [{ rotulo, valor, meta, detalhe?, status? }], formato, titulo? })
   * Uma barra por item: trilho = 100% da meta, preenchimento = realizado (limitado ao trilho),
   * percentual ao lado. Cores: meta batida folha; encerrada sem bater vermelho; em andamento milho.
   */
  function progresso(el, opcoes) {
    registrar(el, progresso, opcoes);
    var itens = (opcoes.itens || []).filter(function (it) { return it && it.meta > 0; });
    if (!itens.length) return vazio(el, opcoes);
    var fmt = formatadores(opcoes.formato || 'moeda');
    var pct = function (it) { return it.valor / it.meta * 100; };

    var q = quadro(el, opcoes, [opcoes.rotuloTabela || 'Meta', 'Realizado', 'Meta', 'Atingimento'], itens.map(function (it) {
      return [it.rotulo, valorCelula(it.valor, fmt), fmt.cheio(it.meta), umaCasa.format(pct(it)) + '%'];
    }));

    var W = larguraDe(el);
    var M = { topo: 4, esq: 8, dir: 8, base: 4 };
    var linha = 62, barraH = 16;
    var H = M.topo + itens.length * linha + M.base;
    var areaW = W - M.esq - M.dir;
    var resumo = opcoes.titulo || ('Atingimento: ' + itens.map(function (it) {
      return it.rotulo + ' ' + umaCasa.format(pct(it)) + '%';
    }).join('; '));
    var svg = svgResponsivo(q.area, W, H, resumo);
    itens.forEach(function (it, i) {
      var y0 = M.topo + i * linha;
      var p = pct(it);
      var cor = p >= 100 ? '#2f7d4f' : (it.status === 'encerrada' ? '#c0392b' : '#f2b544');
      var g = no('g', {}, svg);
      var maxCar = Math.max(6, Math.floor((areaW - 70) / 6.8));
      var nome = String(it.rotulo);
      texto(nome.length > maxCar ? nome.slice(0, maxCar - 1) + '…' : nome,
        { x: M.esq, y: y0 + 13, 'font-size': 12, 'font-weight': 600, fill: COR_TEXTO }, g);
      texto(umaCasa.format(p) + '%', { x: W - M.dir, y: y0 + 13, 'text-anchor': 'end', 'font-size': 13, 'font-weight': 800, fill: COR_TEXTO }, g);
      no('rect', { x: M.esq, y: y0 + 20, width: areaW, height: barraH, rx: 8, fill: COR_GRADE }, g);
      var r = no('rect', { x: M.esq, y: y0 + 20, width: Math.max(2, Math.round(Math.min(1, p / 100) * areaW * 10) / 10),
        height: barraH, rx: 8, fill: cor, class: 'grafico__barra' }, g);
      marcar(r, it.valor, it.rotulo + ': ' + fmt.cheio(it.valor) + ' de ' + fmt.cheio(it.meta) + ' (' + umaCasa.format(p) + '%)');
      texto(it.detalhe || (fmt.cheio(it.valor) + ' de ' + fmt.cheio(it.meta)),
        { x: M.esq, y: y0 + 20 + barraH + 15, 'font-size': 11, fill: COR_TEXTO, 'fill-opacity': 0.7 }, g);
    });
    return svg;
  }

  /* Redesenha os gráficos de "raiz" cuja largura mudou (chamado no resize da tela) */
  function redesenhar(raiz) {
    Array.prototype.forEach.call((raiz || document).querySelectorAll('.grafico'), function (el) {
      var g = el._grafico;
      if (!g || !el.offsetParent) return;
      if (Math.abs(larguraDe(el) - g.largura) < 8) return;
      g.fn(el, g.opcoes);
    });
  }

  BE.graficos = {
    barras: barras,
    acumulado: acumulado,
    linhas: linhas,
    cascata: cascata,
    rosca: rosca,
    mapaCalor: mapaCalor,
    barrasEmpilhadas: barrasEmpilhadas,
    dispersao: dispersao,
    boxplot: boxplot,
    progresso: progresso,
    redesenhar: redesenhar,
    marcasEixo: marcasEixo,
    corCanal: function (nome, i) { return corSerie(nome, i || 0); },
    corCalor: corCalor,
    TEXTO_VAZIO: TEXTO_VAZIO
  };
})(window.BE);
