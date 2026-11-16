/*
 * Gravação do resultado do ETL no SQLite (BE.db) e exportações lidas DO BANCO.
 *
 *   await BE.carga.gravar(resultado, arquivos, opcoes)
 *     - transação única; upsert das dimensões e da FATO_PEDIDO por ID_PEDIDO
 *       (o mesmo pedido é substituído; meses novos se acumulam);
 *     - registra CARGA_ETL e PROBLEMA_TRATAMENTO; chama salvar() no fim;
 *     - se alguma conferência falhou, pergunta antes de gravar.
 *     opcoes: { banco, confirmar(msg) -> bool }  (padrões: BE.db e window.confirm)
 *
 *   BE.carga.tabelasDoBanco(banco)  -> [{ nome, cab, linhas }] no formato da referência
 *   BE.carga.exportarXlsx / exportarCsvZip / exportarLog (banco) -> Promise<{ blob, nome }>
 *   BE.carga.baixar(blob, nome)
 *
 * Dimensões com chave substituta (canal, status, pagamento, tipo de entrega) são casadas pela
 * chave natural (o nome). Motivo: o ETL numera DIM_PAGAMENTO pela ordem alfabética das formas
 * encontradas NAQUELA carga; numa carga posterior com uma forma nova, os números mudariam e os
 * pedidos antigos apontariam para a forma errada. Por isso as FKs da fato são remapeadas para o
 * ID já existente no banco. Na primeira carga, os IDs ficam iguais aos do ETL.
 */
window.BE = window.BE || {};

(function (BE) {
  "use strict";

  /* Dimensões com chave substituta: [tabela, coluna id, coluna nome (chave natural), índice da FK na fato] */
  const DIMS = [
    ["DIM_CANAL", "ID_CANAL", "NOME_CANAL", 1],
    ["DIM_STATUS", "ID_STATUS", "STATUS", 3],
    ["DIM_PAGAMENTO", "ID_PAGAMENTO", "FORMA_PAGAMENTO", 4],
    ["DIM_TIPO_ENTREGA", "ID_TIPO_ENTREGA", "TIPO_ENTREGA", 5],
  ];

  /* Colunas guardadas como 0/1 no SQLite e devolvidas como booleano nas exportações (igual à referência) */
  const BOOLEANAS = { FIM_DE_SEMANA: true, CONSIDERA_VENDA: true };

  /* Ordem e cabeçalhos das tabelas exportadas: os mesmos da referência */
  const TABELAS_EXPORTACAO = [
    ["DIM_TEMPO", "ID_TEMPO"],
    ["DIM_CANAL", "ID_CANAL"],
    ["DIM_STATUS", "ID_STATUS"],
    ["DIM_PAGAMENTO", "ID_PAGAMENTO"],
    ["DIM_TIPO_ENTREGA", "ID_TIPO_ENTREGA"],
    ["FATO_PEDIDO", "ID_CANAL, rowid"],
    ["FATO_META", "ID_META, ID_TEMPO"],
  ];

  const sql = (v) => (typeof v === "boolean" ? (v ? 1 : 0) : v);
  const tabela = (R, nome) => R.tabelas.find((t) => t.nome === nome);

  function mapearDimensao(banco, t, colId, colNome) {
    const existentes = {};
    let maior = 0;
    const usados = new Set();
    for (const r of banco.consultar(`SELECT ${colId} AS id, ${colNome} AS nome FROM ${t.nome}`)) {
      existentes[r.nome] = r.id;
      usados.add(r.id);
      if (r.id > maior) maior = r.id;
    }
    const outras = t.cab.slice(2);
    const mapa = {};
    for (const linha of t.linhas) {
      const idEtl = linha[0],
        nome = linha[1],
        resto = linha.slice(2).map(sql);
      if (Object.prototype.hasOwnProperty.call(existentes, nome)) {
        const id = existentes[nome];
        if (outras.length) {
          banco.executar(
            `UPDATE ${t.nome} SET ${outras.map((c) => c + " = ?").join(", ")} WHERE ${colId} = ?`,
            resto.concat([id]),
          );
        }
        mapa[idEtl] = id;
      } else {
        const id = usados.has(idEtl) ? ++maior : idEtl;
        if (id > maior) maior = id;
        usados.add(id);
        existentes[nome] = id;
        banco.executar(
          `INSERT INTO ${t.nome} (${t.cab.join(", ")}) VALUES (${t.cab.map(() => "?").join(", ")})`,
          [id, nome].concat(resto),
        );
        mapa[idEtl] = id;
      }
    }
    return mapa;
  }

  function upsert(banco, nome, cab, chave, linhas) {
    const atualiza = cab.filter((c) => c !== chave).map((c) => `${c} = excluded.${c}`).join(", ");
    const comando =
      `INSERT INTO ${nome} (${cab.join(", ")}) VALUES (${cab.map(() => "?").join(", ")}) ` +
      `ON CONFLICT(${chave}) DO UPDATE SET ${atualiza}`;
    for (const l of linhas) banco.executar(comando, l.map(sql));
  }

  /*
   * Canais sem relatório nesta carga: [{ canal, inicio, fim, noBanco }], com o período coberto
   * pelos pedidos da carga e quantos pedidos desse canal o banco já tem nesse período.
   * noBanco = 0 quer dizer que o faturamento do canal ausente está faltando nesse período.
   */
  function canaisAusentes(banco, canais) {
    if (!canais) return [];
    const presentes = Object.keys(canais).filter((c) => canais[c]);
    if (!presentes.length) return [];
    const inicio = presentes.map((c) => canais[c].inicio).sort()[0];
    const fim = presentes.map((c) => canais[c].fim).sort().pop();
    return Object.keys(canais)
      .filter((c) => !canais[c])
      .map((c) => ({
        canal: c,
        inicio,
        fim,
        noBanco: banco.consultar(
          "SELECT COUNT(*) AS n FROM FATO_PEDIDO f JOIN DIM_CANAL c ON c.ID_CANAL = f.ID_CANAL " +
            "JOIN DIM_TEMPO t ON t.ID_TEMPO = f.ID_TEMPO WHERE c.NOME_CANAL = ? AND t.DATA BETWEEN ? AND ?",
          [c, inicio, fim],
        )[0].n,
      }));
  }

  function plural(n, um, varios) {
    return n === 1 ? um : varios;
  }

  async function gravar(resultado, arquivos, opcoes) {
    opcoes = opcoes || {};
    const banco = opcoes.banco || BE.db;
    const confirmar = opcoes.confirmar || ((m) => window.confirm(m));
    const R = resultado;

    if (R.falhas > 0) {
      const msg = `${R.falhas} ${plural(R.falhas, "conferência falhou", "conferências falharam")}. Gravar mesmo assim?`;
      if (!confirmar(msg)) return { gravado: false, motivo: "cancelado" };
    }

    const fp = tabela(R, "FATO_PEDIDO");
    const tempo = tabela(R, "DIM_TEMPO");
    const lidos = R.lidos ? R.lidos.ifood + R.lidos.n99 : fp.linhas.length;
    const listaArquivos = (arquivos || []).map((a) => ({
      nome: a.nome || a.name,
      tipo: a.tipo || null,
      usado: a.usado !== undefined ? !!a.usado : true,
    }));
    // Conferências que não se aplicam (canal sem relatório nesta carga) ficam fora das duas contas
    const confAplicaveis = R.validacao.filter((v) => v[3] !== BE.etl.NAO_SE_APLICA);
    const confOk = confAplicaveis.filter((v) => v[3] === "OK").length;
    const logCarga = [];
    const hora = () => new Date().toTimeString().slice(0, 8);

    const info = banco.transacao(() => {
      // Dimensões
      upsert(banco, "DIM_TEMPO", tempo.cab, "ID_TEMPO", tempo.linhas);
      const mapas = {};
      for (const [nome, colId, colNome, idx] of DIMS) {
        mapas[idx] = mapearDimensao(banco, tabela(R, nome), colId, colNome);
      }

      // Fato: remapeia FKs e faz upsert por ID_PEDIDO
      const existentes = new Set(banco.consultar("SELECT ID_PEDIDO FROM FATO_PEDIDO").map((r) => r.ID_PEDIDO));
      let novos = 0,
        atualizados = 0;
      const linhas = fp.linhas.map((l) => {
        const c = l.slice();
        c[0] = String(c[0]);
        for (const idx of Object.keys(mapas)) c[idx] = mapas[idx][c[idx]];
        if (existentes.has(c[0])) atualizados++;
        else novos++;
        return c;
      });
      upsert(banco, "FATO_PEDIDO", fp.cab, "ID_PEDIDO", linhas);

      logCarga.push(`[${hora()}] CARGA NO SQLITE - FATO_PEDIDO: ${novos} novos, ${atualizados} substituídos`);
      const log = R.log.concat(logCarga).join("\n");

      // Controle
      const reg = banco.executar(
        "INSERT INTO CARGA_ETL (data_hora, arquivos, pedidos_lidos, pedidos_gravados, conferencias_ok, conferencias_total, log) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
        [new Date().toISOString(), JSON.stringify(listaArquivos), lidos, fp.linhas.length, confOk, confAplicaveis.length, log],
      );
      for (const p of R.problemas) {
        const [onde, problema, tratamento] = Array.isArray(p) ? p : [p.fonte, p.problema, p.tratamento];
        banco.executar(
          "INSERT INTO PROBLEMA_TRATAMENTO (id_carga, onde, problema, tratamento) VALUES (?, ?, ?, ?)",
          [reg.ultimoId, onde, problema, tratamento],
        );
      }
      return { idCarga: reg.ultimoId, novos, atualizados, ausentes: canaisAusentes(banco, R.canais) };
    });

    const salvo = await banco.salvar();
    return Object.assign({ gravado: true, salvo, logCarga }, info);
  }

  /* ---------- Leitura do banco no formato de tabelas da referência ---------- */

  function ultimaCarga(banco) {
    const r = banco.consultar("SELECT * FROM CARGA_ETL ORDER BY id DESC LIMIT 1");
    return r.length ? r[0] : null;
  }

  /* As conferências da carga ficam no log ("VALIDACAO OK  | teste | esperado=x obtido=y") */
  function conferenciasDoLog(log) {
    const out = [];
    for (const linha of String(log || "").split("\n")) {
      const m = linha.match(/VALIDACAO (OK |FALHA|N\/A) \| (.*) \| esperado=(\S*) obtido=(\S*)/);
      if (!m) continue;
      const r = m[1].trim();
      out.push([m[2], m[3], m[4], r === "OK" ? "OK" : r === "N/A" ? BE.etl.NAO_SE_APLICA : "FALHA"]);
    }
    return out;
  }

  function tabelasDoBanco(banco) {
    banco = banco || BE.db;
    const saida = [];
    for (const [nome, ordem] of TABELAS_EXPORTACAO) {
      const cab = banco.consultar(`PRAGMA table_info(${nome})`).map((c) => c.name);
      const linhas = banco
        .consultar(`SELECT ${cab.join(", ")} FROM ${nome} ORDER BY ${ordem}`)
        .map((o) => linhaDoBanco(o, cab));
      saida.push({ nome, cab, linhas });
    }
    const u = ultimaCarga(banco);
    saida.push({
      nome: "PROBLEMAS_E_TRATAMENTOS",
      cab: ["FONTE", "PROBLEMA ENCONTRADO", "TRATAMENTO NO ETL"],
      linhas: u
        ? banco
            .consultar("SELECT onde, problema, tratamento FROM PROBLEMA_TRATAMENTO WHERE id_carga = ? ORDER BY id", [u.id])
            .map((r) => [r.onde, r.problema, r.tratamento])
        : [],
    });
    saida.push({
      nome: "VALIDACAO_DA_CARGA",
      cab: ["TESTE", "ESPERADO", "OBTIDO", "RESULTADO"],
      linhas: u ? conferenciasDoLog(u.log) : [],
    });
    return saida;
  }

  /* ---------- Exportações ---------- */

  /** Formata células para CSV no padrão brasileiro (copiado da referência) */
  const csvCel = (v) => {
    if (v === null || v === undefined) return "";
    if (typeof v === "boolean") return v ? "VERDADEIRO" : "FALSO";
    let s = typeof v === "number" ? String(v).replace(".", ",") : String(v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  async function exportarXlsx(banco) {
    const blob = await BE.xlsx.criarXlsx(tabelasDoBanco(banco));
    return { blob, nome: "DataMart_DeliView_Dimensionado.xlsx" };
  }

  async function exportarCsvZip(banco) {
    const blob = BE.xlsx.criarZip(
      tabelasDoBanco(banco).map((t) => ({
        nome: `${t.nome}.csv`,
        bytes: BE.xlsx.enc.encode(
          "﻿" + [t.cab, ...t.linhas].map((r) => r.map(csvCel).join(";")).join("\r\n"),
        ),
      })),
    );
    return { blob, nome: "DataMart_DeliView_csv.zip" };
  }

  async function exportarLog(banco) {
    const u = ultimaCarga(banco || BE.db);
    if (!u) throw new Error("Nenhuma carga registrada no banco ainda.");
    const blob = new Blob([u.log || ""], { type: "text/plain;charset=utf-8" });
    return { blob, nome: "log_execucao.txt" };
  }

  function baixar(blob, nome) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* Converte uma linha do banco (objeto) para array na ordem de cab, com 0/1 -> booleano */
  const linhaDoBanco = (o, cab) => cab.map((c) => (BOOLEANAS[c] ? o[c] === 1 : o[c]));

  BE.carga = {
    BOOLEANAS,
    linhaDoBanco,
    gravar,
    tabelasDoBanco,
    conferenciasDoLog,
    ultimaCarga,
    exportarXlsx,
    exportarCsvZip,
    exportarLog,
    baixar,
    csvCel,
  };
})(window.BE);
