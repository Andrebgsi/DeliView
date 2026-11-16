/*
 * Regras das metas por período (schema v2).
 *
 * META_DEFINICAO guarda o cadastro (nome, período, dias da semana, canal, totais, distribuição).
 * FATO_META (ID_META, ID_TEMPO, QUANTIDADE, META_VALOR) tem uma linha por dia elegível da meta.
 * Grão diário: não há horário. O realizado vem da FATO_PEDIDO: soma de VALOR_TOTAL_PAGO e
 * contagem dos pedidos com status CONCLUIDO, nos dias elegíveis, filtrando o canal se houver.
 *
 *   BE.metas.diasElegiveis(inicio, fim, diasSemana)   -> ['AAAA-MM-DD', ...]
 *   await BE.metas.criar(def [, banco])               -> { id, modo, dias }
 *   await BE.metas.atualizar(id, def [, banco])       -> { id, modo, dias }
 *   await BE.metas.excluir(id [, banco])
 *   await BE.metas.duplicar(id, 'proximo-mes' | 'proxima-semana' [, banco]) -> { id, ... }
 *   await BE.metas.ajustarDia(id, 'AAAA-MM-DD', { valor, qtd } [, banco])
 *   BE.metas.listar([banco])     -> uma entrada por meta, DATA_INICIO decrescente
 *   BE.metas.detalhe(id [, banco]) -> uma linha por dia elegível
 *   BE.metas.validarDefinicao(def [, banco]) -> definição normalizada (lança Error em pt-BR)
 *   BE.metas.hoje()              -> 'AAAA-MM-DD' (substituível nos testes)
 *
 * def = { nome, inicio, fim, diasSemana: '1234567', idCanal: null | número,
 *         valor, qtd, distribuicao: 'igual' | 'proporcional' }
 * O parâmetro banco é opcional (padrão BE.db); os testes passam um banco próprio.
 */
window.BE = window.BE || {};

(function (BE) {
  'use strict';

  /* Mesmos nomes do JOB 1 do ETL (js/etl/etl.js) */
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var DIAS = ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira',
    'sexta-feira', 'sábado', 'domingo'];
  var MAX_DIAS = 366;
  var DIA_MS = 864e5;

  /* ---------- Datas ---------- */

  function doisDigitos(n) { return (n < 10 ? '0' : '') + n; }

  function paraData(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    var d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (!d || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
    return d;
  }

  function conferirData(iso, rotulo) {
    var d = paraData(iso);
    if (!d) throw new Error((rotulo || 'Data') + ' inválida: use o formato AAAA-MM-DD.');
    return d;
  }

  function paraIso(d) {
    return d.getUTCFullYear() + '-' + doisDigitos(d.getUTCMonth() + 1) + '-' + doisDigitos(d.getUTCDate());
  }

  function somarDias(iso, n) { return paraIso(new Date(paraData(iso).getTime() + n * DIA_MS)); }

  function diferencaDias(a, b) { return Math.round((paraData(b) - paraData(a)) / DIA_MS); }

  /* 1 = segunda ... 7 = domingo (igual à DIM_TEMPO) */
  function diaSemana(iso) { return ((paraData(iso).getUTCDay() + 6) % 7) + 1; }

  function ultimoDiaDoMes(ano, mes) { return new Date(Date.UTC(ano, mes, 0)).getUTCDate(); }

  /* Soma meses mantendo o dia (limitado ao fim do mês: 31/01 + 1 mês = 28/02) */
  function somarMeses(iso, n) {
    var d = paraData(iso);
    var total = d.getUTCFullYear() * 12 + d.getUTCMonth() + n;
    var ano = Math.floor(total / 12), mes = total % 12 + 1;
    return ano + '-' + doisDigitos(mes) + '-' + doisDigitos(Math.min(d.getUTCDate(), ultimoDiaDoMes(ano, mes)));
  }

  function ehMesInteiro(inicio, fim) {
    var a = paraData(inicio), b = paraData(fim);
    return a.getUTCDate() === 1 && b.getUTCDate() === ultimoDiaDoMes(b.getUTCFullYear(), b.getUTCMonth() + 1);
  }

  function hojeLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + doisDigitos(d.getMonth() + 1) + '-' + doisDigitos(d.getDate());
  }

  function idTempo(data) { return +String(data).replace(/-/g, ''); }

  function ddmm(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }

  /* Linha da DIM_TEMPO com as colunas derivadas, idêntica ao JOB 1 do ETL (FIM_DE_SEMANA em 0/1) */
  function linhaTempo(data) {
    var d = conferirData(data);
    var ds = ((d.getUTCDay() + 6) % 7) + 1;
    var m = d.getUTCMonth() + 1;
    return [
      idTempo(data), data, d.getUTCFullYear(), m <= 6 ? 1 : 2, Math.ceil(m / 3), m,
      MESES[m - 1], d.getUTCDate(), ds, DIAS[ds - 1], ds >= 6 ? 1 : 0
    ];
  }

  function garantirTempo(banco, data) {
    banco.executar('INSERT OR IGNORE INTO DIM_TEMPO VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', linhaTempo(data));
  }

  /* ---------- Dias elegíveis ---------- */

  /* '7 15' -> '157': só dígitos de 1 a 7, sem repetição, em ordem */
  function normalizarDiasSemana(texto) {
    var marcados = {};
    String(texto == null ? '' : texto).replace(/[1-7]/g, function (c) { marcados[c] = true; return c; });
    return Object.keys(marcados).sort().join('');
  }

  function diasElegiveis(inicio, fim, diasSemana) {
    conferirData(inicio, 'Data de início');
    conferirData(fim, 'Data de fim');
    var marcados = normalizarDiasSemana(diasSemana);
    var lista = [];
    if (fim < inicio) return lista;
    var ds = diaSemana(inicio);
    for (var d = inicio; d <= fim; d = somarDias(d, 1)) {
      if (marcados.indexOf(String(ds)) >= 0) lista.push(d);
      ds = ds % 7 + 1;
    }
    return lista;
  }

  /* ---------- Números e validação ---------- */

  /* Aceita número ou texto ("1.234,56", "1234.56"); vazio vira null, texto inválido vira NaN */
  function numero(v) {
    if (typeof v === 'number') return v;
    var s = String(v == null ? '' : v).trim();
    if (!s) return null;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); /* "2.500" = dois mil e quinhentos */
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }

  /* Valor (R$) e quantidade de pedidos: >= 0, quantidade inteira. Vazio vale 0. */
  function validarValores(valores) {
    valores = valores || {};
    var valor = numero(valores.valor), qtd = numero(valores.qtd);
    if (valor === null) valor = 0;
    if (qtd === null) qtd = 0;
    if (!isFinite(valor)) throw new Error('A meta de faturamento precisa ser um número em reais (ex.: 2500,00).');
    if (valor < 0) throw new Error('A meta de faturamento não pode ser negativa.');
    if (!isFinite(qtd)) throw new Error('A meta de pedidos precisa ser um número inteiro.');
    if (qtd < 0) throw new Error('A meta de pedidos não pode ser negativa.');
    if (Math.floor(qtd) !== qtd) throw new Error('A meta de pedidos precisa ser um número inteiro.');
    return { valor: Math.round(valor * 100) / 100, qtd: qtd };
  }

  function nomePadrao(inicio, fim) { return 'Meta ' + ddmm(inicio) + ' a ' + ddmm(fim); }

  /*
   * Confere a definição e devolve a versão normalizada, com a lista de dias elegíveis.
   * Mensagens em pt-BR, prontas para mostrar ao usuário.
   */
  function validarDefinicao(def, banco) {
    def = def || {};
    if (!def.inicio) throw new Error('Escolha a data de início no calendário.');
    if (!def.fim) throw new Error('Escolha a data de fim no calendário.');
    conferirData(def.inicio, 'Data de início');
    conferirData(def.fim, 'Data de fim');
    if (def.fim < def.inicio) throw new Error('A data de fim precisa ser igual ou posterior à data de início.');
    if (diferencaDias(def.inicio, def.fim) + 1 > MAX_DIAS) {
      throw new Error('O período pode ter no máximo ' + MAX_DIAS + ' dias.');
    }
    var diasSemana = normalizarDiasSemana(def.diasSemana);
    if (!diasSemana) throw new Error('Marque pelo menos um dia da semana.');
    var dias = diasElegiveis(def.inicio, def.fim, diasSemana);
    if (!dias.length) throw new Error('O período escolhido não tem nenhum dos dias da semana marcados.');

    var v = validarValores({ valor: def.valor, qtd: def.qtd });
    if (v.valor === 0 && v.qtd === 0) {
      throw new Error('Informe a meta de faturamento ou a meta de pedidos (pelo menos uma maior que zero).');
    }

    var distribuicao = def.distribuicao || 'igual';
    if (distribuicao !== 'igual' && distribuicao !== 'proporcional') {
      throw new Error('Distribuição desconhecida: use "igual" ou "proporcional".');
    }

    var idCanal = def.idCanal === '' || def.idCanal == null ? null : Number(def.idCanal);
    if (idCanal !== null) {
      if (!Number.isInteger(idCanal)) throw new Error('Canal inválido.');
      if (banco && !banco.consultar('SELECT 1 FROM DIM_CANAL WHERE ID_CANAL = ?', [idCanal]).length) {
        throw new Error('O canal escolhido não existe no banco.');
      }
    }

    var nome = String(def.nome == null ? '' : def.nome).trim() || nomePadrao(def.inicio, def.fim);
    if (nome.length > 120) throw new Error('O nome pode ter no máximo 120 caracteres.');

    return {
      nome: nome, inicio: def.inicio, fim: def.fim, diasSemana: diasSemana, idCanal: idCanal,
      valor: v.valor, qtd: v.qtd, distribuicao: distribuicao, dias: dias
    };
  }

  /* ---------- Distribuição ---------- */

  /*
   * Peso de cada dia da semana (1..7) na média histórica dos pedidos concluídos:
   * total do dia da semana ÷ quantas vezes ele ocorreu no período com vendas.
   * Assim, um mês com 5 sábados no histórico não pesa mais que um com 4.
   */
  function pesosDiaSemana(banco, idCanal) {
    var filtro = idCanal == null ? '' : ' AND f.ID_CANAL = ' + Number(idCanal);
    var r = banco.consultar(
      'SELECT t.DIA_SEMANA AS ds, SUM(f.VALOR_TOTAL_PAGO) AS valor, COUNT(*) AS qtd, ' +
      'MIN(f.ID_TEMPO) AS ini, MAX(f.ID_TEMPO) AS fim ' +
      'FROM FATO_PEDIDO f JOIN DIM_STATUS s ON s.ID_STATUS = f.ID_STATUS ' +
      'JOIN DIM_TEMPO t ON t.ID_TEMPO = f.ID_TEMPO ' +
      "WHERE s.STATUS = 'CONCLUIDO'" + filtro + ' GROUP BY t.DIA_SEMANA');
    if (!r.length) return null;
    var ini = Math.min.apply(null, r.map(function (x) { return x.ini; }));
    var fim = Math.max.apply(null, r.map(function (x) { return x.fim; }));
    var iso = function (id) { var s = String(id); return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8); };
    /* Ocorrências de cada dia da semana entre o primeiro e o último dia com vendas */
    var ocorrencias = [0, 0, 0, 0, 0, 0, 0, 0];
    diasElegiveis(iso(ini), iso(fim), '1234567').forEach(function (d) { ocorrencias[diaSemana(d)]++; });

    var pesos = { valor: [0, 0, 0, 0, 0, 0, 0, 0], qtd: [0, 0, 0, 0, 0, 0, 0, 0] };
    r.forEach(function (x) {
      var n = ocorrencias[x.ds] || 1;
      pesos.valor[x.ds] = x.valor / n;
      pesos.qtd[x.ds] = x.qtd / n;
    });
    return pesos;
  }

  /*
   * Reparte um total inteiro (centavos ou pedidos) conforme os pesos, sem perder unidades.
   * Cada dia recebe a sua parte arredondada sobre o acumulado (nenhum dia fica negativo nem
   * se afasta mais de 1 unidade da parte exata) e o último dia recebe o resíduo, de modo que
   * a soma bate exatamente com o total.
   */
  function repartir(total, pesos) {
    var soma = pesos.reduce(function (a, p) { return a + p; }, 0);
    if (!(soma > 0)) {
      pesos = pesos.map(function () { return 1; });
      soma = pesos.length;
    }
    var partes = [];
    var acumulado = 0, entregue = 0;
    for (var i = 0; i < pesos.length - 1; i++) {
      acumulado += pesos[i];
      var alvo = Math.round((total * acumulado) / soma);
      partes.push(alvo - entregue);
      entregue = alvo;
    }
    partes.push(total - entregue); /* resíduo no último dia */
    return partes;
  }

  /* Divide os totais pelos dias elegíveis. Devolve { modo efetivo, partes: [{ data, valor, qtd }] } */
  function distribuir(def, banco) {
    var modo = def.distribuicao;
    var pesosValor = def.dias.map(function () { return 1; });
    var pesosQtd = pesosValor.slice();
    if (modo === 'proporcional') {
      var p = pesosDiaSemana(banco, def.idCanal);
      var ds = def.dias.map(diaSemana);
      var pv = p && ds.map(function (x) { return p.valor[x]; });
      var pq = p && ds.map(function (x) { return p.qtd[x]; });
      var positivo = function (l) { return l && l.some(function (x) { return x > 0; }); };
      if (positivo(pv) && positivo(pq)) {
        pesosValor = pv;
        pesosQtd = pq;
      } else {
        modo = 'igual'; /* sem histórico de pedidos concluídos nesses dias da semana */
      }
    }
    var centavos = repartir(Math.round(def.valor * 100), pesosValor);
    var pedidos = repartir(def.qtd, pesosQtd);
    return {
      modo: modo,
      partes: def.dias.map(function (d, i) { return { data: d, valor: centavos[i] / 100, qtd: pedidos[i] }; })
    };
  }

  /* ---------- Gravação ---------- */

  function obterDefinicao(banco, id) {
    var r = banco.consultar('SELECT * FROM META_DEFINICAO WHERE ID_META = ?', [Number(id)]);
    if (!r.length) throw new Error('Meta não encontrada (ela pode ter sido excluída).');
    return r[0];
  }

  function paraDef(linha) {
    return {
      nome: linha.NOME, inicio: linha.DATA_INICIO, fim: linha.DATA_FIM, diasSemana: linha.DIAS_SEMANA,
      idCanal: linha.ID_CANAL, valor: linha.META_VALOR, qtd: linha.QUANTIDADE, distribuicao: linha.DISTRIBUICAO
    };
  }

  /* Grava a definição e regenera as linhas da FATO_META. id = null cria uma meta nova. */
  function gravar(banco, id, def) {
    var v = validarDefinicao(def, banco);
    var dist = distribuir(v, banco);
    var agora = new Date().toISOString();
    banco.transacao(function () {
      var campos = [v.nome, v.inicio, v.fim, v.diasSemana, v.idCanal, v.valor, v.qtd, v.distribuicao, agora];
      if (id == null) {
        id = banco.executar(
          'INSERT INTO META_DEFINICAO (NOME, DATA_INICIO, DATA_FIM, DIAS_SEMANA, ID_CANAL, META_VALOR, ' +
          'QUANTIDADE, DISTRIBUICAO, ATUALIZADA_EM, CRIADA_EM) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          campos.concat([agora])).ultimoId;
      } else {
        banco.executar(
          'UPDATE META_DEFINICAO SET NOME = ?, DATA_INICIO = ?, DATA_FIM = ?, DIAS_SEMANA = ?, ID_CANAL = ?, ' +
          'META_VALOR = ?, QUANTIDADE = ?, DISTRIBUICAO = ?, ATUALIZADA_EM = ? WHERE ID_META = ?',
          campos.concat([id]));
        banco.executar('DELETE FROM FATO_META WHERE ID_META = ?', [id]);
      }
      dist.partes.forEach(function (x) {
        garantirTempo(banco, x.data);
        banco.executar('INSERT INTO FATO_META (ID_META, ID_TEMPO, QUANTIDADE, META_VALOR) VALUES (?, ?, ?, ?)',
          [id, idTempo(x.data), x.qtd, x.valor]);
      });
    });
    return { id: id, modo: dist.modo, dias: dist.partes.length, nome: v.nome };
  }

  /* Executa fn de forma síncrona; erros viram Promise rejeitada; no sucesso, salva o banco. */
  function comSalvar(banco, fn) {
    var r;
    try {
      r = fn();
    } catch (e) {
      return Promise.reject(e);
    }
    return banco.salvar().then(function (salvo) { r.salvo = salvo; return r; });
  }

  function criar(def, banco) {
    banco = banco || BE.db;
    return comSalvar(banco, function () { return gravar(banco, null, def); });
  }

  function atualizar(id, def, banco) {
    banco = banco || BE.db;
    return comSalvar(banco, function () {
      obterDefinicao(banco, id);
      return gravar(banco, Number(id), def);
    });
  }

  function excluir(id, banco) {
    banco = banco || BE.db;
    return comSalvar(banco, function () {
      obterDefinicao(banco, id);
      banco.executar('DELETE FROM META_DEFINICAO WHERE ID_META = ?', [Number(id)]); /* FATO_META por cascata */
      return { id: Number(id) };
    });
  }

  /* Troca o nome do mês (e o ano) no nome da meta; sem mês no nome, acrescenta o novo período */
  function nomeDeslocado(nome, antigo, novo, deslocamento) {
    var a = paraData(antigo), n = paraData(novo);
    if (deslocamento === 'proximo-mes') {
      var mesA = MESES[a.getUTCMonth()], mesN = MESES[n.getUTCMonth()];
      var re = new RegExp(mesA, 'i');
      if (re.test(nome)) {
        var trocado = nome.replace(re, function (achado) {
          return achado[0] === achado[0].toUpperCase() ? mesN[0].toUpperCase() + mesN.slice(1) : mesN;
        });
        return trocado.replace(String(a.getUTCFullYear()), String(n.getUTCFullYear()));
      }
      return nome + ' (' + mesN + '/' + n.getUTCFullYear() + ')';
    }
    return nome + ' (semana de ' + ddmm(novo) + ')';
  }

  /* Copia a meta para o próximo mês ou a próxima semana, com os mesmos dias da semana e totais */
  function duplicar(id, deslocamento, banco) {
    banco = banco || BE.db;
    return comSalvar(banco, function () {
      if (deslocamento !== 'proximo-mes' && deslocamento !== 'proxima-semana') {
        throw new Error('Deslocamento desconhecido: use "proximo-mes" ou "proxima-semana".');
      }
      var def = paraDef(obterDefinicao(banco, id));
      var inicio, fim;
      if (deslocamento === 'proxima-semana') {
        inicio = somarDias(def.inicio, 7);
        fim = somarDias(def.fim, 7);
      } else if (ehMesInteiro(def.inicio, def.fim)) {
        /* Mês(es) inteiro(s): ocupa o(s) mês(es) seguinte(s) inteiro(s) */
        inicio = somarMeses(def.inicio, 1);
        var f = paraData(somarMeses(def.fim.slice(0, 8) + '01', 1));
        fim = paraIso(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), ultimoDiaDoMes(f.getUTCFullYear(), f.getUTCMonth() + 1))));
      } else {
        inicio = somarMeses(def.inicio, 1);
        fim = somarMeses(def.fim, 1);
      }
      def.nome = nomeDeslocado(def.nome, def.inicio, inicio, deslocamento);
      def.inicio = inicio;
      def.fim = fim;
      return gravar(banco, null, def);
    });
  }

  /* Edita a meta de um dia elegível e recalcula os totais da definição como a soma dos dias */
  function ajustarDia(id, data, valores, banco) {
    banco = banco || BE.db;
    return comSalvar(banco, function () {
      var linha = obterDefinicao(banco, id);
      conferirData(data);
      if (diasElegiveis(linha.DATA_INICIO, linha.DATA_FIM, linha.DIAS_SEMANA).indexOf(data) < 0) {
        throw new Error('O dia ' + ddmm(data) + ' não faz parte desta meta.');
      }
      var v = validarValores(valores);
      banco.transacao(function () {
        garantirTempo(banco, data);
        banco.executar(
          'INSERT INTO FATO_META (ID_META, ID_TEMPO, QUANTIDADE, META_VALOR) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(ID_META, ID_TEMPO) DO UPDATE SET QUANTIDADE = excluded.QUANTIDADE, META_VALOR = excluded.META_VALOR',
          [linha.ID_META, idTempo(data), v.qtd, v.valor]);
        banco.executar(
          'UPDATE META_DEFINICAO SET ' +
          'META_VALOR = (SELECT ROUND(COALESCE(SUM(META_VALOR), 0), 2) FROM FATO_META WHERE ID_META = ?), ' +
          'QUANTIDADE = (SELECT COALESCE(SUM(QUANTIDADE), 0) FROM FATO_META WHERE ID_META = ?), ' +
          'ATUALIZADA_EM = ? WHERE ID_META = ?',
          [linha.ID_META, linha.ID_META, new Date().toISOString(), linha.ID_META]);
      });
      var t = banco.consultar('SELECT META_VALOR AS valor, QUANTIDADE AS qtd FROM META_DEFINICAO WHERE ID_META = ?', [linha.ID_META])[0];
      return { id: linha.ID_META, data: data, valor: v.valor, qtd: v.qtd, total_valor: t.valor, total_qtd: t.qtd };
    });
  }

  /* ---------- Leitura ---------- */

  function status(def, hoje) {
    if (def.DATA_INICIO > hoje) return 'futura';
    if (def.DATA_FIM < hoje) return 'encerrada';
    return 'andamento';
  }

  /* Meta e realizado de cada dia elegível de uma definição */
  function diasDaMeta(banco, def) {
    var dias = diasElegiveis(def.DATA_INICIO, def.DATA_FIM, def.DIAS_SEMANA);
    var metas = {};
    banco.consultar('SELECT ID_TEMPO AS id, META_VALOR AS valor, QUANTIDADE AS qtd FROM FATO_META WHERE ID_META = ?', [def.ID_META])
      .forEach(function (r) { metas[r.id] = r; });
    var params = [idTempo(def.DATA_INICIO), idTempo(def.DATA_FIM)];
    var filtroCanal = '';
    if (def.ID_CANAL != null) { filtroCanal = ' AND f.ID_CANAL = ?'; params.push(def.ID_CANAL); }
    var real = {};
    banco.consultar(
      'SELECT f.ID_TEMPO AS id, SUM(f.VALOR_TOTAL_PAGO) AS valor, COUNT(*) AS qtd ' +
      'FROM FATO_PEDIDO f JOIN DIM_STATUS s ON s.ID_STATUS = f.ID_STATUS ' +
      "WHERE s.STATUS = 'CONCLUIDO' AND f.ID_TEMPO BETWEEN ? AND ?" + filtroCanal + ' GROUP BY f.ID_TEMPO',
      params).forEach(function (r) { real[r.id] = r; });

    return dias.map(function (data) {
      var id = idTempo(data), m = metas[id], r = real[id];
      return {
        data: data,
        dia_semana: diaSemana(data),
        meta_valor: m ? m.valor : 0,
        meta_qtd: m ? m.qtd : 0,
        realizado_valor: r ? Math.round(r.valor * 100) / 100 : 0,
        realizado_qtd: r ? r.qtd : 0
      };
    });
  }

  function percentual(parte, total) { return total > 0 ? Math.round((parte / total) * 10000) / 100 : null; }

  function resumirMeta(banco, def, hoje) {
    var dias = diasDaMeta(banco, def);
    var st = status(def, hoje);
    var serie = [];
    var metaC = 0, realC = 0, metaQ = 0, realQ = 0;
    dias.forEach(function (d) {
      metaC += Math.round(d.meta_valor * 100);
      realC += Math.round(d.realizado_valor * 100);
      metaQ += d.meta_qtd;
      realQ += d.realizado_qtd;
      var passou = d.data <= hoje;
      serie.push({
        data: d.data,
        meta_acum: metaC / 100,
        realizado_acum: passou ? realC / 100 : null,
        meta_qtd_acum: metaQ,
        realizado_qtd_acum: passou ? realQ : null
      });
    });
    var realizadoValor = realC / 100;
    var item = {
      id: def.ID_META,
      nome: def.NOME,
      inicio: def.DATA_INICIO,
      fim: def.DATA_FIM,
      dias_semana: def.DIAS_SEMANA,
      id_canal: def.ID_CANAL,
      meta_valor: def.META_VALOR,
      meta_qtd: def.QUANTIDADE,
      distribuicao: def.DISTRIBUICAO,
      criada_em: def.CRIADA_EM,
      atualizada_em: def.ATUALIZADA_EM,
      dias_elegiveis: dias.length,
      status: st,
      realizado_valor: realizadoValor,
      realizado_qtd: realQ,
      atingimento_valor: percentual(realizadoValor, def.META_VALOR),
      atingimento_qtd: percentual(realQ, def.QUANTIDADE),
      serie: serie
    };
    if (st === 'andamento') {
      var restantes = dias.filter(function (d) { return d.data >= hoje; }).length;
      item.dias_restantes = restantes;
      item.falta_valor = Math.max(0, Math.round((def.META_VALOR - realizadoValor) * 100) / 100);
      item.falta_qtd = Math.max(0, def.QUANTIDADE - realQ);
      item.ritmo_necessario_dia = restantes ? Math.round((item.falta_valor / restantes) * 100) / 100 : 0;
      item.ritmo_necessario_qtd_dia = restantes ? Math.ceil(item.falta_qtd / restantes) : 0;
    }
    return item;
  }

  function listar(banco) {
    banco = banco || BE.db;
    var hoje = BE.metas.hoje();
    return banco.consultar('SELECT * FROM META_DEFINICAO ORDER BY DATA_INICIO DESC, ID_META DESC')
      .map(function (def) { return resumirMeta(banco, def, hoje); });
  }

  function obter(id, banco) {
    banco = banco || BE.db;
    return resumirMeta(banco, obterDefinicao(banco, id), BE.metas.hoje());
  }

  function detalhe(id, banco) {
    banco = banco || BE.db;
    return diasDaMeta(banco, obterDefinicao(banco, id)).map(function (d) {
      d.desvio = Math.round((d.realizado_valor - d.meta_valor) * 100) / 100;
      d.atingimento_valor = percentual(d.realizado_valor, d.meta_valor);
      return d;
    });
  }

  /* ---------- Apoio à tela ---------- */

  function canais(banco) {
    banco = banco || BE.db;
    return banco.consultar('SELECT ID_CANAL AS id, NOME_CANAL AS nome FROM DIM_CANAL ORDER BY ID_CANAL');
  }

  /* { 'AAAA-MM-DD': true } dos dias com pedidos concluídos */
  function diasComVenda(banco) {
    banco = banco || BE.db;
    var mapa = {};
    banco.consultar(
      'SELECT DISTINCT t.DATA AS d FROM FATO_PEDIDO f JOIN DIM_STATUS s ON s.ID_STATUS = f.ID_STATUS ' +
      "JOIN DIM_TEMPO t ON t.ID_TEMPO = f.ID_TEMPO WHERE s.STATUS = 'CONCLUIDO'")
      .forEach(function (r) { mapa[r.d] = true; });
    return mapa;
  }

  /* Último mês com vendas no banco: 'AAAA-MM' ou null */
  function ultimoMesComDados(banco) {
    banco = banco || BE.db;
    var id = banco.consultar('SELECT MAX(ID_TEMPO) AS p FROM FATO_PEDIDO')[0].p;
    if (!id) return null;
    var s = String(id);
    return s.slice(0, 4) + '-' + s.slice(4, 6);
  }

  BE.metas = {
    /* "Hoje" é substituível nos testes: BE.metas.hoje = function () { return '2026-08-15'; } */
    hoje: hojeLocal,
    diasElegiveis: diasElegiveis,
    criar: criar,
    atualizar: atualizar,
    excluir: excluir,
    duplicar: duplicar,
    ajustarDia: ajustarDia,
    listar: listar,
    obter: obter,
    detalhe: detalhe,
    validarDefinicao: validarDefinicao,
    validarValores: validarValores,
    nomePadrao: nomePadrao,
    numero: numero,
    repartir: repartir,
    linhaTempo: linhaTempo,
    canais: canais,
    diasComVenda: diasComVenda,
    ultimoMesComDados: ultimoMesComDados,
    datas: {
      paraData: paraData, paraIso: paraIso, somarDias: somarDias, somarMeses: somarMeses,
      diferencaDias: diferencaDias, diaSemana: diaSemana, ultimoDiaDoMes: ultimoDiaDoMes, MESES: MESES, DIAS: DIAS
    }
  };
})(window.BE);
