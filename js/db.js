/*
 * Banco SQLite local (sql.js, build asm) com persistência no IndexedDB.
 *
 *   await BE.db.abrir()               carrega do IndexedDB ou cria vazio com o schema
 *   BE.db.consultar(sql, params)      -> Array<objeto>
 *   BE.db.executar(sql, params)       -> { alteradas, ultimoId }
 *   BE.db.transacao(fn)               BEGIN/COMMIT, ROLLBACK em erro (fn síncrona)
 *   await BE.db.salvar()              grava db.export() no IndexedDB
 *   BE.db.baixarBackup()              baixa deliview-AAAA-MM-DD.sqlite
 *   await BE.db.restaurarBackup(file) valida "SQLite format 3", substitui e salva
 *   await BE.db.apagarTudo()          confirmação dupla, apaga o IndexedDB e as chaves be.* do
 *                                     localStorage e recria vazio
 *   await BE.db.limparVendas()        apaga FATO_PEDIDO, CARGA_ETL e PROBLEMA_TRATAMENTO
 *   await BE.db.limparMetas()         apaga FATO_META e META_DEFINICAO
 *   await BE.db.limparBanco()         esvazia todas as tabelas (mantém schema e versão)
 *   BE.db.integridade()               PRAGMA integrity_check + foreign_key_check
 *   BE.db.resumo()                    linhas por tabela + última carga
 *
 *   BE.db.config.ler/gravar/apagar(chave)  valores no store "config" do mesmo IndexedDB
 *                                     (ex.: o FileSystemFileHandle do arquivo vinculado)
 *   BE.db.aoSalvar(fn)                fn({ motivo }) depois de cada salvar ('salvar') e antes de
 *                                     apagarTudo ('apagar'); usado pelo arquivo vinculado
 *
 * BE.criarBanco() cria instâncias independentes (usado nos testes).
 * A cada mudança salva, dispara o evento "be:banco-alterado" no document.
 */
window.BE = window.BE || {};

(function (BE) {
  var NOME_PADRAO = 'deliview';
  var NOME_ANTIGO = 'boaescolha'; /* nome do banco antes do DeliView: migrado uma vez para NOME_PADRAO */
  var STORE = 'sqlite';
  var STORE_CONFIG = 'config';
  var VERSAO_IDB = 2; /* v2: store "config" */
  var CHAVE = 'principal';
  var CABECALHO_SQLITE = 'SQLite format 3\u0000';
  var AVISO_SEM_IDB = 'Os dados não serão guardados neste navegador: use Salvar banco';

  /* ---------- sql.js (carregado uma vez) ---------- */

  var promessaSQL = null;
  function carregarSQL() {
    if (!promessaSQL) {
      if (typeof window.initSqlJs !== 'function') {
        return Promise.reject(new Error('Biblioteca vendor/sql-asm.js não foi carregada.'));
      }
      promessaSQL = window.initSqlJs();
    }
    return promessaSQL;
  }

  /* ---------- IndexedDB ---------- */

  function idbAbrir(nome) {
    return new Promise(function (resolve, reject) {
      var req;
      try {
        if (!window.indexedDB) throw new Error('IndexedDB indisponível');
        req = window.indexedDB.open(nome, VERSAO_IDB);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
        if (!req.result.objectStoreNames.contains(STORE_CONFIG)) req.result.createObjectStore(STORE_CONFIG);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Falha ao abrir o IndexedDB')); };
      req.onblocked = function () { reject(new Error('IndexedDB bloqueado por outra aba')); };
    });
  }

  function idbOperacao(nome, modo, fn, store) {
    store = store || STORE;
    return idbAbrir(nome).then(function (idb) {
      return new Promise(function (resolve, reject) {
        var tx = idb.transaction(store, modo);
        var req = fn(tx.objectStore(store));
        var resultado;
        req.onsuccess = function () { resultado = req.result; };
        tx.oncomplete = function () { idb.close(); resolve(resultado); };
        tx.onerror = tx.onabort = function () {
          idb.close();
          reject(tx.error || req.error || new Error('Falha no IndexedDB'));
        };
      });
    });
  }

  function idbLer(nome) {
    return idbOperacao(nome, 'readonly', function (s) { return s.get(CHAVE); });
  }

  function idbGravar(nome, bytes) {
    return idbOperacao(nome, 'readwrite', function (s) { return s.put(bytes, CHAVE); });
  }

  function idbApagar(nome) {
    return new Promise(function (resolve, reject) {
      var req = window.indexedDB.deleteDatabase(nome);
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { resolve(); }; /* conexões são fechadas após cada operação */
    });
  }

  /* Lê o banco e o store "config" de uma vez (usado na migração do nome antigo). */
  function idbLerTudo(nome) {
    return idbAbrir(nome).then(function (idb) {
      return new Promise(function (resolve, reject) {
        var tx = idb.transaction([STORE, STORE_CONFIG], 'readonly');
        var r = { bytes: null, config: [] };
        var req = tx.objectStore(STORE).get(CHAVE);
        req.onsuccess = function () { r.bytes = req.result || null; };
        var cursor = tx.objectStore(STORE_CONFIG).openCursor();
        cursor.onsuccess = function () {
          var c = cursor.result;
          if (c) { r.config.push([c.key, c.value]); c.continue(); }
        };
        tx.oncomplete = function () { idb.close(); resolve(r); };
        tx.onerror = tx.onabort = function () { idb.close(); reject(tx.error || new Error('Falha no IndexedDB')); };
      });
    });
  }

  /*
   * Primeira abertura depois da troca de nome: se o banco novo está vazio e o antigo tem dados,
   * copia o banco (com as metas) e o store "config" para o nome novo e apaga o antigo.
   * Devolve os bytes migrados ou null. Uma falha aqui não impede o portal de abrir.
   */
  function migrarNomeAntigo() {
    return idbLerTudo(NOME_ANTIGO).then(function (r) {
      var bytes = r.bytes ? new Uint8Array(r.bytes) : null;
      if (bytes && !ehSQLite(bytes)) bytes = null;
      var passos = r.config.map(function (kv) {
        return idbOperacao(NOME_PADRAO, 'readwrite', function (s) { return s.put(kv[1], kv[0]); }, STORE_CONFIG);
      });
      if (bytes) passos.push(idbGravar(NOME_PADRAO, bytes));
      return Promise.all(passos).then(function () { return idbApagar(NOME_ANTIGO); }).then(function () {
        if (bytes) console.info('Banco do nome antigo migrado para "' + NOME_PADRAO + '".');
        return bytes;
      });
    }).catch(function (erro) {
      console.warn('Não foi possível migrar o banco do nome antigo:', erro);
      return null;
    });
  }

  /* ---------- Utilitários ---------- */

  function doisDigitos(n) { return (n < 10 ? '0' : '') + n; }

  function nomeBackup(data) {
    var d = data || new Date();
    return 'deliview-' + d.getFullYear() + '-' + doisDigitos(d.getMonth() + 1) + '-' +
      doisDigitos(d.getDate()) + '.sqlite';
  }

  function ehSQLite(bytes) {
    if (!bytes || bytes.length < 100) return false;
    for (var i = 0; i < CABECALHO_SQLITE.length; i++) {
      if (bytes[i] !== CABECALHO_SQLITE.charCodeAt(i)) return false;
    }
    return true;
  }

  function lerArquivo(arquivo) {
    if (arquivo instanceof Uint8Array) return Promise.resolve(arquivo);
    if (arquivo instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(arquivo));
    if (arquivo && typeof arquivo.arrayBuffer === 'function') {
      return arquivo.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    }
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(new Uint8Array(r.result)); };
      r.onerror = function () { reject(r.error); };
      r.readAsArrayBuffer(arquivo);
    });
  }

  /* Remove as preferências do portal (chaves "be.*") do localStorage. */
  function limparPreferencias() {
    try {
      var chaves = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('be.') === 0) chaves.push(k);
      }
      chaves.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* localStorage indisponível */ }
  }

  /* Tabelas de cada limpeza, na ordem que respeita as chaves estrangeiras. */
  var LIMPEZAS = {
    vendas: ['PROBLEMA_TRATAMENTO', 'CARGA_ETL', 'FATO_PEDIDO'],
    metas: ['FATO_META', 'META_DEFINICAO'],
    banco: ['PROBLEMA_TRATAMENTO', 'CARGA_ETL', 'FATO_META', 'META_DEFINICAO', 'FATO_PEDIDO',
      'DIM_TEMPO', 'DIM_CANAL', 'DIM_STATUS', 'DIM_PAGAMENTO', 'DIM_TIPO_ENTREGA']
  };

  function avisar(msg, tipo) {
    if (typeof BE.toast === 'function') BE.toast(msg, tipo);
    else console.warn(msg);
  }

  /* ---------- Fábrica ---------- */

  BE.criarBanco = function () {
    var SQL = null;
    var db = null;
    var nomeIdb = NOME_PADRAO;
    var silencioso = false;

    var observadores = [];

    var api = {
      persistente: false, /* true quando o IndexedDB está funcionando */
      aberto: false
    };

    /* fn({ motivo: 'salvar' | 'apagar' }). Erros do observador não atrapalham o banco. */
    api.aoSalvar = function (fn) { observadores.push(fn); };
    function avisarObservadores(motivo) {
      observadores.forEach(function (fn) {
        try { fn({ motivo: motivo }); } catch (e) { console.error(e); }
      });
    }

    /* Valores no store "config" do mesmo IndexedDB (structured clone). */
    api.config = {
      ler: function (chave) {
        return idbOperacao(nomeIdb, 'readonly', function (s) { return s.get(chave); }, STORE_CONFIG);
      },
      gravar: function (chave, valor) {
        return idbOperacao(nomeIdb, 'readwrite', function (s) { return s.put(valor, chave); }, STORE_CONFIG);
      },
      apagar: function (chave) {
        return idbOperacao(nomeIdb, 'readwrite', function (s) { return s.delete(chave); }, STORE_CONFIG);
      }
    };

    function exigirAberto() {
      if (!db) throw new Error('Banco não aberto: chame await BE.db.abrir() antes.');
    }

    function novoBanco(bytes) {
      var novo = bytes ? new SQL.Database(bytes) : new SQL.Database();
      try {
        BE.schema.aplicar(novo);
      } catch (e) {
        novo.close();
        throw e;
      }
      return novo;
    }

    function trocar(novo) {
      if (db) db.close();
      db = novo;
      api.aberto = true;
    }

    function notificar() {
      if (silencioso) return;
      try {
        document.dispatchEvent(new CustomEvent('be:banco-alterado', { detail: api.resumo() }));
      } catch (e) { /* sem DOM: ignora */ }
    }

    function marcarSemPersistencia(erro) {
      if (!api._avisado) { /* avisa uma vez por instância */
        api._avisado = true;
        console.warn('IndexedDB indisponível:', erro);
        if (!silencioso) avisar(AVISO_SEM_IDB, 'aviso');
      }
      api.persistente = false;
    }

    /*
     * opcoes.nome: nome do banco no IndexedDB (padrão "deliview"; nos testes "deliview-teste").
     * opcoes.silencioso: não dispara toast nem evento (testes).
     */
    api.abrir = function (opcoes) {
      opcoes = opcoes || {};
      nomeIdb = opcoes.nome || NOME_PADRAO;
      silencioso = !!opcoes.silencioso;
      return carregarSQL().then(function (modulo) {
        SQL = modulo;
        return idbLer(nomeIdb).then(function (bytes) {
          api.persistente = true;
          if (!bytes && nomeIdb === NOME_PADRAO) return migrarNomeAntigo();
          return bytes;
        }, function (erro) {
          marcarSemPersistencia(erro);
          return null;
        });
      }).then(function (bytes) {
        var dados = bytes ? new Uint8Array(bytes) : null;
        if (dados && !ehSQLite(dados)) {
          console.warn('Conteúdo salvo no IndexedDB não é SQLite; criando banco vazio.');
          dados = null;
        }
        trocar(novoBanco(dados));
        if (!dados && api.persistente) return api.salvar();
      }).then(function () {
        notificar();
        return api;
      });
    };

    api.consultar = function (sql, params) {
      exigirAberto();
      var stmt = db.prepare(sql);
      var linhas = [];
      try {
        if (params != null) stmt.bind(params);
        while (stmt.step()) linhas.push(stmt.getAsObject());
      } finally {
        stmt.free();
      }
      return linhas;
    };

    api.executar = function (sql, params) {
      exigirAberto();
      db.run(sql, params == null ? undefined : params);
      return {
        alteradas: db.getRowsModified(),
        ultimoId: db.exec('SELECT last_insert_rowid()')[0].values[0][0]
      };
    };

    api.transacao = function (fn) {
      exigirAberto();
      db.run('BEGIN');
      try {
        var r = fn(api);
        if (r && typeof r.then === 'function') {
          throw new Error('BE.db.transacao aceita apenas funções síncronas.');
        }
        db.run('COMMIT');
        return r;
      } catch (e) {
        try { db.run('ROLLBACK'); } catch (e2) { /* já desfeita */ }
        throw e;
      }
    };

    /* Bytes do banco atual. O sql.js reabre a conexão no export, então o PRAGMA é reaplicado. */
    api.exportar = function () {
      exigirAberto();
      var bytes = db.export();
      db.run('PRAGMA foreign_keys = ON');
      return bytes;
    };

    api.salvar = function () {
      var bytes = api.exportar();
      return idbGravar(nomeIdb, bytes).then(function () {
        api.persistente = true;
        notificar();
        avisarObservadores('salvar');
        return true;
      }, function (erro) {
        marcarSemPersistencia(erro);
        notificar();
        avisarObservadores('salvar');
        return false;
      });
    };

    api.nomeBackup = nomeBackup;

    api.baixarBackup = function () {
      var nome = nomeBackup();
      var blob = new Blob([api.exportar()], { type: 'application/vnd.sqlite3' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return nome;
    };

    api.restaurarBackup = function (arquivo) {
      return lerArquivo(arquivo).then(function (bytes) {
        if (!ehSQLite(bytes)) {
          throw new Error('O arquivo escolhido não é um banco SQLite (.sqlite) válido.');
        }
        var novo;
        try {
          novo = novoBanco(bytes);
          var faltando = BE.schema.tabelas.filter(function (t) {
            return !novo.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '" + t + "'").length;
          });
          if (faltando.length) throw new Error('Tabelas ausentes: ' + faltando.join(', '));
        } catch (e) {
          if (novo) novo.close();
          throw new Error('Não foi possível usar este backup: ' + e.message);
        }
        trocar(novo);
        return api.salvar();
      });
    };

    /* Apaga as tabelas numa transação e salva. Retorna { apagadas: { TABELA: linhas }, salvo }. */
    function limpar(tabelas) {
      exigirAberto();
      var apagadas = {};
      api.transacao(function () {
        tabelas.forEach(function (t) {
          db.run('DELETE FROM ' + t);
          apagadas[t] = db.getRowsModified();
        });
        /* reinicia os ids AUTOINCREMENT das tabelas esvaziadas */
        if (db.exec("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_sequence'").length) {
          tabelas.forEach(function (t) { db.run('DELETE FROM sqlite_sequence WHERE name = ?', [t]); });
        }
      });
      return api.salvar().then(function (salvo) { return { apagadas: apagadas, salvo: salvo }; });
    }

    /* Vendas: pedidos, cargas e problemas. Dimensões e metas ficam (o realizado volta a zero). */
    api.limparVendas = function () { return limpar(LIMPEZAS.vendas); };
    /* Metas: definições e linhas diárias. As vendas ficam. */
    api.limparMetas = function () { return limpar(LIMPEZAS.metas); };
    /* Todas as tabelas. O schema, a versão e o banco aberto ficam. */
    api.limparBanco = function () { return limpar(LIMPEZAS.banco); };
    api.tabelasDaLimpeza = function (tipo) { return (LIMPEZAS[tipo] || []).slice(); };

    /* { ok, problemas: [texto] } a partir de PRAGMA integrity_check e foreign_key_check. */
    api.integridade = function () {
      exigirAberto();
      var problemas = [];
      api.consultar('PRAGMA integrity_check').forEach(function (r) {
        var t = r.integrity_check;
        if (t !== 'ok') problemas.push('Integridade: ' + t);
      });
      api.consultar('PRAGMA foreign_key_check').forEach(function (r) {
        problemas.push('Chave estrangeira: ' + r.table + ' (linha ' + r.rowid + ') aponta para ' +
          r.parent + ' inexistente');
      });
      return { ok: !problemas.length, problemas: problemas };
    };

    /*
     * Apaga o IndexedDB do portal e as chaves "be.*" do localStorage, e cria um banco vazio.
     * opcoes.semConfirmar: pula as duas confirmações (testes e tela Dados e backup, que já
     * pediu para digitar APAGAR).
     */
    api.apagarTudo = function (opcoes) {
      opcoes = opcoes || {};
      if (!opcoes.semConfirmar) {
        if (!window.confirm('Apagar TODOS os dados do portal guardados neste navegador?')) {
          return Promise.resolve(false);
        }
        if (!window.confirm('Tem certeza? Esta ação não pode ser desfeita. ' +
          'Se precisar dos dados, cancele e use "Salvar banco (.sqlite)" antes.')) {
          return Promise.resolve(false);
        }
      }
      return carregarSQL().then(function (modulo) {
        SQL = modulo;
        if (db) { db.close(); db = null; }
        avisarObservadores('apagar'); /* o arquivo vinculado é desligado antes, para não ser zerado */
        limparPreferencias();
        return idbApagar(nomeIdb).catch(function (erro) { marcarSemPersistencia(erro); });
      }).then(function () {
        trocar(novoBanco(null));
        return api.salvar();
      }).then(function () { return true; });
    };

    api.resumo = function () {
      exigirAberto();
      var tabelas = {};
      BE.schema.tabelas.forEach(function (t) {
        tabelas[t] = db.exec('SELECT COUNT(*) FROM ' + t)[0].values[0][0];
      });
      var ultima = api.consultar('SELECT data_hora FROM CARGA_ETL ORDER BY id DESC LIMIT 1');
      return {
        tabelas: tabelas,
        pedidos: tabelas.FATO_PEDIDO,
        ultimaCarga: ultima.length ? ultima[0].data_hora : null,
        persistente: api.persistente
      };
    };

    api.fechar = function () {
      if (db) db.close();
      db = null;
      api.aberto = false;
    };

    return api;
  };

  BE.criarBanco.ehSQLite = ehSQLite;
  BE.criarBanco.carregarSQL = carregarSQL; /* módulo sql.js, para bancos temporários (prévia do backup) */
  BE.db = BE.criarBanco();
})(window.BE);
