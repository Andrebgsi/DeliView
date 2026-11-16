/*
 * Backup compactado do portal (.zip com o banco, um manifesto e um LEIA-ME).
 *
 *   await BE.backup.gerarZip([banco])          -> Blob do .zip (banco padrão: BE.db)
 *   await BE.backup.gerarZipDeBytes(bytes, info) -> Blob (monta o zip a partir de bytes .sqlite)
 *   await BE.backup.fazerBackup([opcoes])      -> { salvo, cancelado, modo: 'pasta'|'download', nome }
 *        abre "Salvar como" (showSaveFilePicker) quando existe; senão baixa com <a download>
 *   await BE.backup.lerArquivo(file)           -> { tipo: 'zip'|'sqlite', bytes, manifesto|null }
 *   await BE.backup.previa(leitura [, banco])  -> contagens do backup e do banco atual
 *   BE.backup.situacao([banco])                -> contagens, período, versão, última alteração
 *   BE.backup.precisaBackup(ultimoBackup, ultimaAlteracao, hoje) -> boolean (função pura)
 *   BE.backup.ultimoBackup() / registrarBackup(data)   data em localStorage "be.ultimoBackup"
 *   BE.backup.nomeArquivo(data)                -> deliview-backup-AAAA-MM-DD_HHhMM.zip
 *
 * A restauração em si é a mesma da Importação: BE.db.restaurarBackup(bytes), que aplica as
 * migrações quando o backup é de uma versão anterior do schema.
 */
window.BE = window.BE || {};

(function (BE) {
  'use strict';

  var APP = 'DeliView';
  var ARQ_SQLITE = 'deliview.sqlite';
  var ARQ_SQLITE_ANTIGO = 'boaescolha.sqlite'; /* nome nos backups feitos antes do DeliView: continuam aceitos */
  var ARQ_MANIFESTO = 'manifesto.json';
  var ARQ_LEIA = 'LEIA-ME.txt';
  var CHAVE_ULTIMO = 'be.ultimoBackup';
  var DIA_MS = 24 * 60 * 60 * 1000;
  var PRAZO_DIAS = 7;

  function dd(n) { return (n < 10 ? '0' : '') + n; }

  /* ISO 8601 no fuso local, ex.: 2026-11-13T14:05:09-03:00 */
  function isoLocal(d) {
    var off = -d.getTimezoneOffset();
    var sinal = off >= 0 ? '+' : '-';
    off = Math.abs(off);
    return d.getFullYear() + '-' + dd(d.getMonth() + 1) + '-' + dd(d.getDate()) + 'T' +
      dd(d.getHours()) + ':' + dd(d.getMinutes()) + ':' + dd(d.getSeconds()) +
      sinal + dd(Math.floor(off / 60)) + ':' + dd(off % 60);
  }

  function nomeArquivo(data) {
    var d = data || new Date();
    return 'deliview-backup-' + d.getFullYear() + '-' + dd(d.getMonth() + 1) + '-' + dd(d.getDate()) +
      '_' + dd(d.getHours()) + 'h' + dd(d.getMinutes()) + '.zip';
  }

  function paraBytes(arquivo) {
    if (arquivo instanceof Uint8Array) return Promise.resolve(arquivo);
    if (arquivo instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(arquivo));
    return arquivo.arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  function sha256(bytes) {
    if (!window.crypto || !window.crypto.subtle) {
      return Promise.reject(new Error('Este navegador não calcula SHA-256 (crypto.subtle indisponível).'));
    }
    return window.crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return (b < 16 ? '0' : '') + b.toString(16);
      }).join('');
    });
  }

  function ehZip(bytes) {
    return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  }

  function leiaMe(m) {
    return [
      'Backup do ' + APP,
      'Criado em: ' + m.criado_em,
      'Versão do schema: ' + m.versao_schema,
      '',
      'CONTEÚDO',
      '  ' + ARQ_SQLITE + '   banco de dados completo (pedidos, metas, cargas)',
      '  ' + ARQ_MANIFESTO + '      data, contagens por tabela e SHA-256 do banco',
      '  ' + ARQ_LEIA + '         este arquivo',
      '',
      'COMO RESTAURAR',
      '  1. Abra o portal (o endereço do site ou o portal.html) no Chrome, no Edge ou no Firefox.',
      '  2. No menu, entre em "Dados e backup" e clique em "Restaurar backup".',
      '  3. Escolha ESTE arquivo .zip (não precisa descompactar).',
      '  4. Confira a prévia e confirme. Os dados atuais do navegador são substituídos.',
      '',
      'ATENÇÃO: DADOS SIGILOSOS',
      '  Este arquivo contém todos os pedidos, SEM CRIPTOGRAFIA. Qualquer pessoa que tiver',
      '  o arquivo consegue ler os dados. Guarde-o em local seguro e não o publique na internet.',
      ''
    ].join('\r\n');
  }

  /* info = { versao_schema, tabelas, criado_em? (Date) } */
  function gerarZipDeBytes(bytes, info) {
    info = info || {};
    return sha256(bytes).then(function (hash) {
      var manifesto = {
        app: APP,
        versao_schema: info.versao_schema,
        criado_em: isoLocal(info.criado_em || new Date()),
        tabelas: info.tabelas || {},
        sha256_sqlite: hash
      };
      var enc = BE.xlsx.enc;
      return Promise.resolve(BE.xlsx.criarZip([
        { nome: ARQ_SQLITE, bytes: bytes },
        { nome: ARQ_MANIFESTO, bytes: enc.encode(JSON.stringify(manifesto, null, 2)) },
        { nome: ARQ_LEIA, bytes: enc.encode(leiaMe(manifesto)) }
      ], { comprimir: true }));
    }).then(function (blob) {
      return new Blob([blob], { type: 'application/zip' });
    });
  }

  function gerarZip(banco) {
    banco = banco || BE.db;
    return Promise.resolve().then(function () {
      var bytes = banco.exportar();
      return gerarZipDeBytes(bytes, {
        versao_schema: banco.consultar('PRAGMA user_version')[0].user_version,
        tabelas: banco.resumo().tabelas
      });
    });
  }

  /* ---------- Salvar ---------- */

  function baixar(blob, nome) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function registrarBackup(data) {
    try { localStorage.setItem(CHAVE_ULTIMO, (data || new Date()).toISOString()); } catch (e) { /* sem localStorage */ }
  }

  function ultimoBackup() {
    try { return localStorage.getItem(CHAVE_ULTIMO); } catch (e) { return null; }
  }

  /*
   * Abre "Salvar como" ANTES de gerar o zip: o navegador só aceita a janela logo após o clique.
   * Cancelar a janela devolve { salvo: false, cancelado: true }, sem erro.
   * Sem a API (Firefox) ou se ela falhar (ex.: bloqueada em file://), baixa com <a download>.
   */
  async function fazerBackup(opcoes) {
    opcoes = opcoes || {};
    var banco = opcoes.banco || BE.db;
    var nome = nomeArquivo(new Date());
    var handle = null;

    if (typeof window.showSaveFilePicker === 'function') {
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: nome,
          types: [{ description: 'Backup do portal (.zip)', accept: { 'application/zip': ['.zip'] } }]
        });
      } catch (e) {
        if (e && e.name === 'AbortError') return { salvo: false, cancelado: true, modo: null, nome: nome };
        console.warn('Janela "Salvar como" indisponível; usando download:', e);
      }
    }

    var blob = await gerarZip(banco);
    var modo = 'download';
    if (handle) {
      try {
        var w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        modo = 'pasta';
        nome = handle.name || nome;
      } catch (e) {
        console.warn('Falha ao gravar pela janela "Salvar como"; usando download:', e);
      }
    }
    if (modo === 'download') baixar(blob, nome);
    registrarBackup(new Date());
    return { salvo: true, cancelado: false, modo: modo, nome: nome };
  }

  /* ---------- Ler e conferir ---------- */

  var CORROMPIDO = 'Backup corrompido';

  function lerArquivo(arquivo) {
    return paraBytes(arquivo).then(function (bytes) {
      if (ehZip(bytes)) return lerZipBackup(bytes);
      if (BE.criarBanco.ehSQLite(bytes)) return { tipo: 'sqlite', bytes: bytes, manifesto: null };
      throw new Error('Arquivo não reconhecido: escolha um backup .zip feito por este portal ou um banco .sqlite.');
    });
  }

  function lerZipBackup(bytes) {
    var buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    var z, sqlite, manifesto, arqSqlite;
    return Promise.resolve().then(function () {
      return BE.xlsx.lerZip(buf);
    }).catch(function () {
      throw new Error(CORROMPIDO + ': o arquivo .zip não pôde ser lido.');
    }).then(function (zip) {
      z = zip;
      arqSqlite = z[ARQ_SQLITE] ? ARQ_SQLITE : (z[ARQ_SQLITE_ANTIGO] ? ARQ_SQLITE_ANTIGO : null);
      if (!arqSqlite) throw new Error('Este .zip não é um backup do portal: falta o arquivo ' + ARQ_SQLITE + '.');
      if (!z[ARQ_MANIFESTO]) throw new Error('Este .zip não é um backup do portal: falta o arquivo ' + ARQ_MANIFESTO + '.');
      return Promise.all([z._lerBytes(arqSqlite), z._ler(ARQ_MANIFESTO)]).catch(function () {
        throw new Error(CORROMPIDO + ': não foi possível descompactar o conteúdo.');
      });
    }).then(function (r) {
      sqlite = r[0];
      try { manifesto = JSON.parse(r[1]); } catch (e) { throw new Error(CORROMPIDO + ': o manifesto.json não pôde ser lido.'); }
      if (!manifesto || typeof manifesto.sha256_sqlite !== 'string') {
        throw new Error(CORROMPIDO + ': o manifesto.json não traz o SHA-256 do banco.');
      }
      return sha256(sqlite);
    }).then(function (hash) {
      if (hash !== manifesto.sha256_sqlite.toLowerCase()) {
        throw new Error(CORROMPIDO + ': o banco não confere com o SHA-256 do manifesto.');
      }
      if (!BE.criarBanco.ehSQLite(sqlite)) throw new Error(CORROMPIDO + ': o ' + arqSqlite + ' não é um banco SQLite.');
      return { tipo: 'zip', bytes: sqlite, manifesto: manifesto };
    });
  }

  /* ---------- Contagens (banco aberto ou temporário) ---------- */

  /* consulta(sql) -> Array<objeto>. Funciona também com bancos de versões anteriores do schema. */
  function contar(consulta) {
    var tem = {};
    consulta("SELECT name FROM sqlite_master WHERE type = 'table'").forEach(function (r) { tem[r.name] = true; });
    var n = function (tabela, sql) {
      if (!tem[tabela]) return 0;
      return consulta(sql || 'SELECT COUNT(*) AS n FROM ' + tabela)[0].n || 0;
    };
    var r = {
      versao: consulta('PRAGMA user_version')[0].user_version,
      pedidos: n('FATO_PEDIDO'),
      concluidos: tem.DIM_STATUS ? n('FATO_PEDIDO',
        'SELECT COUNT(*) AS n FROM FATO_PEDIDO f JOIN DIM_STATUS s ON s.ID_STATUS = f.ID_STATUS ' +
        "WHERE s.STATUS = 'CONCLUIDO'") : 0,
      /* v1 não tinha META_DEFINICAO: conta os meses com meta, como a migração fará */
      metas: tem.META_DEFINICAO ? n('META_DEFINICAO') : n('FATO_META', 'SELECT COUNT(DISTINCT ID_TEMPO / 100) AS n FROM FATO_META'),
      diasMeta: n('FATO_META'),
      cargas: n('CARGA_ETL'),
      problemas: n('PROBLEMA_TRATAMENTO'),
      inicio: null,
      fim: null,
      ultimaCarga: null,
      ultimaMeta: null,
      ultimaAlteracao: null
    };
    if (tem.FATO_PEDIDO && tem.DIM_TEMPO) {
      var p = consulta('SELECT MIN(t.DATA) AS ini, MAX(t.DATA) AS fim FROM FATO_PEDIDO f JOIN DIM_TEMPO t ON t.ID_TEMPO = f.ID_TEMPO')[0];
      r.inicio = p.ini || null;
      r.fim = p.fim || null;
    }
    if (tem.CARGA_ETL) r.ultimaCarga = consulta('SELECT MAX(data_hora) AS d FROM CARGA_ETL')[0].d || null;
    if (tem.META_DEFINICAO) r.ultimaMeta = consulta('SELECT MAX(ATUALIZADA_EM) AS d FROM META_DEFINICAO')[0].d || null;
    r.ultimaAlteracao = [r.ultimaCarga, r.ultimaMeta].filter(Boolean).sort(function (a, b) {
      return tempo(a) - tempo(b);
    }).pop() || null;
    return r;
  }

  function situacao(banco) {
    banco = banco || BE.db;
    return contar(banco.consultar);
  }

  /* Abre os bytes num banco temporário (sem migrar) só para contar. */
  function lerResumo(bytes) {
    return BE.criarBanco.carregarSQL().then(function (SQL) {
      var db = new SQL.Database(bytes);
      try {
        return contar(function (sql) {
          var res = db.exec(sql);
          if (!res.length) return [];
          return res[0].values.map(function (v) {
            var o = {};
            res[0].columns.forEach(function (c, i) { o[c] = v[i]; });
            return o;
          });
        });
      } finally {
        db.close();
      }
    }).catch(function (e) {
      throw new Error('Não foi possível ler o banco do backup: ' + (e && e.message || e));
    });
  }

  function previa(leitura, banco) {
    banco = banco || BE.db;
    return lerResumo(leitura.bytes).then(function (doBackup) {
      return {
        tipo: leitura.tipo,
        data: leitura.manifesto ? leitura.manifesto.criado_em : null,
        backup: doBackup,
        atual: banco.aberto ? situacao(banco) : null,
        versaoPortal: BE.schema.versao,
        migra: doBackup.versao < BE.schema.versao,
        maisNovo: doBackup.versao > BE.schema.versao
      };
    });
  }

  /* ---------- Lembrete ---------- */

  function tempo(v) {
    if (v == null || v === '') return null;
    var t = v instanceof Date ? v.getTime() : new Date(v).getTime();
    return isNaN(t) ? null : t;
  }

  /*
   * Precisa de backup quando há dados (carga ou meta) e:
   *   - nunca houve backup; ou
   *   - houve alteração depois do último backup e esse backup tem mais de 7 dias.
   * Datas em ISO ou Date. Sem alteração nenhuma (banco vazio), não há o que guardar.
   */
  function precisaBackup(ultimoBkp, ultimaAlteracao, hoje) {
    var alt = tempo(ultimaAlteracao);
    if (alt == null) return false;
    var bk = tempo(ultimoBkp);
    if (bk == null) return true;
    if (alt <= bk) return false;
    var h = tempo(hoje);
    if (h == null) h = Date.now();
    return h - bk > PRAZO_DIAS * DIA_MS;
  }

  BE.backup = {
    ARQ_SQLITE: ARQ_SQLITE,
    ARQ_MANIFESTO: ARQ_MANIFESTO,
    ARQ_LEIA: ARQ_LEIA,
    CHAVE_ULTIMO: CHAVE_ULTIMO,
    nomeArquivo: nomeArquivo,
    isoLocal: isoLocal,
    sha256: sha256,
    gerarZip: gerarZip,
    gerarZipDeBytes: gerarZipDeBytes,
    fazerBackup: fazerBackup,
    baixar: baixar,
    registrarBackup: registrarBackup,
    ultimoBackup: ultimoBackup,
    lerArquivo: lerArquivo,
    lerResumo: lerResumo,
    previa: previa,
    situacao: situacao,
    precisaBackup: precisaBackup
  };
})(window.BE);
