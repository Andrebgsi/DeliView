/*
 * Arquivo do banco vinculado no disco (File System Access API: Chrome e Edge).
 *
 *   BE.arquivoBanco.disponivel()            -> a API existe neste navegador
 *   BE.arquivoBanco.estado()                -> { situacao, nome, salvoEm, motivo }
 *        situacao: 'nao-suportado' | 'desvinculado' | 'vinculado' | 'reconectar'
 *   await BE.arquivoBanco.iniciar()         lê o handle guardado e sincroniza (sem pedir permissão)
 *   await BE.arquivoBanco.vincularNovo()    "Salvar como" deliview.sqlite e grava o banco atual
 *   await BE.arquivoBanco.vincularExistente({ escolher })  abre um .sqlite e o vincula
 *   await BE.arquivoBanco.reconectar()      requestPermission (precisa de clique) e sincroniza
 *   await BE.arquivoBanco.desvincular()     esquece o arquivo; os dados continuam no navegador
 *
 * Depois de cada BE.db.salvar(), com vínculo e permissão "granted", grava o arquivo
 * (createWritable → write → close) com debounce de 1 s. Falha de gravação marca "reconectar";
 * o IndexedDB continua sendo gravado normalmente pelo BE.db.
 *
 * localStorage "be.ultimaGravacao" (ms): última alteração deste navegador já conhecida pelo
 * vínculo. Ao abrir o portal, é comparada com file.lastModified (decidirOrigem).
 *
 * Funções puras (testes): BE.arquivoBanco.decidirOrigem e BE.arquivoBanco.precisaPerguntaInicial.
 * BE.criarArquivoBanco(opcoes) cria instâncias independentes (testes usam handle falso).
 * A cada mudança de estado, dispara "be:arquivo-banco" no document.
 */
window.BE = window.BE || {};

(function (BE) {
  'use strict';

  var NOME_PADRAO = 'deliview.sqlite';
  var CHAVE_HANDLE = 'arquivoBanco';
  var CHAVE_GRAVACAO = 'be.ultimaGravacao';
  var CHAVE_INICIO = 'be.inicioEscolhido';
  var TOLERANCIA_MS = 2000; /* relógio do sistema de arquivos x Date.now() */
  var MSG_FALHA = 'Não foi possível salvar no arquivo do banco';
  var TIPOS = [{ description: 'Banco do portal (.sqlite)', accept: { 'application/vnd.sqlite3': ['.sqlite'] } }];

  /* ---------- Funções puras ---------- */

  /*
   * Qual cópia vale ao abrir o portal com vínculo ativo.
   * arquivoModificado: file.lastModified (ms). ultimaGravacaoNavegador: be.ultimaGravacao (ms ou null).
   * -> 'arquivo' (outro navegador alterou o arquivo), 'navegador' (há mudanças só aqui) ou 'iguais'.
   */
  function decidirOrigem(p) {
    var arq = Number(p && p.arquivoModificado);
    var nav = p && p.ultimaGravacaoNavegador != null && p.ultimaGravacaoNavegador !== '' ? Number(p.ultimaGravacaoNavegador) : NaN;
    if (!isFinite(arq)) return 'navegador';
    if (!isFinite(nav)) return 'arquivo';
    if (Math.abs(arq - nav) <= TOLERANCIA_MS) return 'iguais';
    return arq > nav ? 'arquivo' : 'navegador';
  }

  /* A pergunta "Onde está o banco de dados?" aparece com o banco vazio, se ainda não escolheram começar vazio. */
  function precisaPerguntaInicial(p) {
    p = p || {};
    return !p.inicioEscolhido && !(Number(p.pedidos) > 0) && !(Number(p.metas) > 0);
  }

  function disponivelPadrao() {
    return typeof window.showSaveFilePicker === 'function' && typeof window.showOpenFilePicker === 'function';
  }

  function lerLocal(chave) {
    try { return localStorage.getItem(chave); } catch (e) { return null; }
  }
  function gravarLocal(chave, valor) {
    try {
      if (valor == null) localStorage.removeItem(chave);
      else localStorage.setItem(chave, String(valor));
    } catch (e) { /* sem localStorage */ }
  }

  function ehSeguranca(e) { return e && e.name === 'SecurityError'; }
  function ehCancelado(e) { return e && e.name === 'AbortError'; }

  /* ---------- Fábrica ---------- */

  /*
   * opcoes.banco: instância de BE.criarBanco (padrão BE.db)
   * opcoes.atraso: debounce em ms (padrão 1000)
   * opcoes.armazenamento: { ler, gravar, apagar } do handle (padrão banco.config, no IndexedDB)
   * opcoes.disponivel: função que diz se a API existe (padrão: detecta no window)
   * opcoes.silencioso: sem toast e sem evento (testes)
   */
  BE.criarArquivoBanco = function (opcoes) {
    opcoes = opcoes || {};
    var banco = opcoes.banco || BE.db;
    var atraso = opcoes.atraso != null ? opcoes.atraso : 1000;
    var armazenamento = opcoes.armazenamento || banco.config;
    var temApi = opcoes.disponivel || disponivelPadrao;
    var silencioso = !!opcoes.silencioso;

    var handle = null;
    var timer = null;
    var gravando = null;       /* promessa da gravação em curso */
    var suprimir = 0;          /* > 0 enquanto o próprio vínculo carrega o arquivo no banco */
    var bloqueado = null;      /* motivo quando a API existe mas falhou com SecurityError */
    var st = { situacao: 'desvinculado', nome: null, salvoEm: null, motivo: null };

    function avisar(msg, tipo) {
      if (silencioso) return;
      if (typeof BE.toast === 'function') BE.toast(msg, tipo);
    }

    function mudar(parcial) {
      Object.keys(parcial).forEach(function (k) { st[k] = parcial[k]; });
      if (silencioso) return;
      try { document.dispatchEvent(new CustomEvent('be:arquivo-banco', { detail: api.estado() })); } catch (e) { /* sem DOM */ }
    }

    function disponivel() { return !bloqueado && !!temApi(); }

    function marcarBloqueado(e) {
      bloqueado = 'O navegador bloqueou o acesso a arquivos nesta página (' + (e && e.message || 'SecurityError') + ').';
      cancelarTimer();
      handle = null;
      mudar({ situacao: 'nao-suportado', motivo: bloqueado, nome: null, salvoEm: null });
    }

    function cancelarTimer() {
      if (timer) { clearTimeout(timer); timer = null; }
    }

    function lerBytes(h) {
      return h.getFile().then(function (f) {
        return f.arrayBuffer().then(function (buf) { return { arquivo: f, bytes: new Uint8Array(buf) }; });
      });
    }

    function validar(bytes) {
      if (!BE.criarBanco.ehSQLite(bytes)) {
        throw new Error('O arquivo escolhido não é um banco SQLite válido (falta o cabeçalho "SQLite format 3").');
      }
    }

    function permissao(h, pedir) {
      var fn = pedir ? h.requestPermission : h.queryPermission;
      if (typeof fn !== 'function') return Promise.resolve('granted');
      return Promise.resolve(fn.call(h, { mode: 'readwrite' }));
    }

    function guardarHandle(h) {
      return Promise.resolve(armazenamento.gravar(CHAVE_HANDLE, h)).catch(function (e) {
        console.warn('Não foi possível guardar o vínculo do arquivo:', e);
      });
    }

    /* Grava os bytes atuais do banco no arquivo. Falha -> "reconectar" e toast. */
    function gravarAgora() {
      cancelarTimer();
      if (!handle) return Promise.resolve(false);
      var h = handle;
      var anterior = gravando || Promise.resolve();
      gravando = anterior.then(function () {
        var bytes = banco.exportar();
        return h.createWritable().then(function (w) {
          return Promise.resolve(w.write(bytes)).then(function () { return w.close(); });
        }).then(function () {
          return typeof h.getFile === 'function' ? h.getFile().then(function (f) { return f.lastModified; }, function () { return Date.now(); }) : Date.now();
        }).then(function (quando) {
          if (handle !== h) return true;
          quando = Math.max(Number(quando) || 0, Date.now());
          gravarLocal(CHAVE_GRAVACAO, quando);
          mudar({ situacao: 'vinculado', salvoEm: quando, motivo: null });
          return true;
        });
      }).catch(function (e) {
        console.warn(MSG_FALHA + ':', e);
        if (handle === h) {
          mudar({ situacao: 'reconectar', motivo: (e && e.message) || String(e) });
          avisar(MSG_FALHA, 'erro');
        }
        return false;
      });
      return gravando;
    }

    /* Carrega os bytes do arquivo no banco sem gravá-los de volta no arquivo. */
    function carregar(bytes, modificado) {
      suprimir++;
      return Promise.resolve().then(function () {
        return banco.restaurarBackup(bytes);
      }).then(function () {
        gravarLocal(CHAVE_GRAVACAO, modificado);
      }).then(function () { suprimir--; }, function (e) { suprimir--; throw e; });
    }

    function vazio() {
      var r = banco.resumo();
      return !r.pedidos && !r.tabelas.META_DEFINICAO;
    }

    /* Compara arquivo e navegador e deixa os dois iguais. */
    function sincronizar() {
      var h = handle;
      return lerBytes(h).then(function (r) {
        validar(r.bytes);
        var origem = decidirOrigem({ arquivoModificado: r.arquivo.lastModified, ultimaGravacaoNavegador: lerLocal(CHAVE_GRAVACAO) });
        /* Proteção: um navegador vazio nunca sobrescreve um arquivo com dados */
        if (origem === 'navegador' && vazio()) origem = 'arquivo';
        if (origem === 'arquivo') {
          return carregar(r.bytes, r.arquivo.lastModified).then(function () {
            mudar({ situacao: 'vinculado', salvoEm: r.arquivo.lastModified, motivo: null });
            avisar('Banco carregado do arquivo ' + h.name + '.', 'info');
            return 'arquivo';
          });
        }
        if (origem === 'navegador') return gravarAgora().then(function () { return 'navegador'; });
        mudar({ situacao: 'vinculado', salvoEm: r.arquivo.lastModified, motivo: null });
        return 'iguais';
      });
    }

    var api = {};

    api.disponivel = disponivel;

    api.estado = function () {
      return { situacao: st.situacao, nome: st.nome, salvoEm: st.salvoEm, motivo: st.motivo };
    };

    /* Chamado pelo BE.db depois de cada salvar() e antes de apagarTudo(). */
    function aoSalvar(info) {
      if (info && info.motivo === 'apagar') {
        cancelarTimer();
        handle = null;
        gravarLocal(CHAVE_GRAVACAO, null);
        mudar({ situacao: disponivel() ? 'desvinculado' : 'nao-suportado', nome: null, salvoEm: null, motivo: bloqueado });
        return;
      }
      if (!handle || suprimir) return;
      gravarLocal(CHAVE_GRAVACAO, Date.now()); /* este navegador tem mudança nova */
      if (st.situacao !== 'vinculado') return; /* sem permissão: grava ao reconectar */
      cancelarTimer();
      timer = setTimeout(function () { timer = null; gravarAgora(); }, atraso);
    }
    banco.aoSalvar(aoSalvar);
    api._aoSalvar = aoSalvar;

    /* Ao abrir o portal. Nunca chama requestPermission (exige clique). */
    api.iniciar = function () {
      if (!disponivel()) {
        mudar({ situacao: 'nao-suportado', motivo: bloqueado });
        return Promise.resolve(api.estado());
      }
      return Promise.resolve(armazenamento.ler(CHAVE_HANDLE)).catch(function () { return null; }).then(function (h) {
        if (!h || typeof h.getFile !== 'function') {
          mudar({ situacao: 'desvinculado', nome: null, salvoEm: null, motivo: null });
          return api.estado();
        }
        handle = h;
        st.nome = h.name || NOME_PADRAO;
        return permissao(h, false).then(function (p) {
          if (p !== 'granted') {
            mudar({ situacao: 'reconectar', motivo: null });
            return api.estado();
          }
          return sincronizar().then(function () { return api.estado(); });
        }).catch(function (e) {
          if (ehSeguranca(e)) { marcarBloqueado(e); return api.estado(); }
          console.warn('Arquivo do banco indisponível:', e);
          mudar({ situacao: 'reconectar', motivo: (e && e.message) || String(e) });
          return api.estado();
        });
      });
    };

    /* h opcional (testes); senão abre "Salvar como". -> { ok, cancelado, nome } */
    api.vincularNovo = function (h) {
      return Promise.resolve().then(function () {
        if (h) return h;
        return window.showSaveFilePicker({ suggestedName: NOME_PADRAO, types: TIPOS });
      }).then(function (escolhido) {
        handle = escolhido;
        return guardarHandle(escolhido).then(function () {
          mudar({ situacao: 'vinculado', nome: escolhido.name || NOME_PADRAO, motivo: null });
          return gravarAgora();
        }).then(function (ok) {
          if (!ok) throw new Error(MSG_FALHA + '.');
          return { ok: true, cancelado: false, nome: st.nome };
        });
      }, function (e) {
        if (ehCancelado(e)) return { ok: false, cancelado: true };
        if (ehSeguranca(e)) marcarBloqueado(e);
        throw e;
      });
    };

    /*
     * h opcional (testes); senão abre "Abrir". Valida "SQLite format 3".
     * Se o navegador tiver dados, opcoes.escolher(info) decide: 'arquivo' | 'navegador' | null (cancela).
     * info = { arquivo: { pedidos, metas, data }, navegador: { pedidos, metas, data } }
     */
    api.vincularExistente = function (opcoesV) {
      opcoesV = opcoesV || {};
      var escolhido, leitura;
      return Promise.resolve().then(function () {
        if (opcoesV.handle) return opcoesV.handle;
        return window.showOpenFilePicker({ types: TIPOS, multiple: false }).then(function (lista) { return lista[0]; });
      }).then(function (h) {
        escolhido = h;
        /* pede a gravação logo após a janela, enquanto o clique ainda vale */
        return permissao(h, true);
      }).then(function (p) {
        if (p !== 'granted') throw new Error('Sem permissão para gravar no arquivo escolhido.');
        return lerBytes(escolhido);
      }).then(function (r) {
        leitura = r;
        validar(r.bytes);
        if (vazio()) return 'arquivo';
        if (typeof opcoesV.escolher !== 'function') return 'arquivo';
        return BE.backup.lerResumo(leitura.bytes).then(function (doArquivo) {
          var atual = BE.backup.situacao(banco);
          var ult = Number(lerLocal(CHAVE_GRAVACAO));
          return opcoesV.escolher({
            nome: escolhido.name || NOME_PADRAO,
            arquivo: { pedidos: doArquivo.pedidos, metas: doArquivo.metas, data: new Date(leitura.arquivo.lastModified).toISOString() },
            navegador: { pedidos: atual.pedidos, metas: atual.metas, data: isFinite(ult) && ult > 0 ? new Date(ult).toISOString() : atual.ultimaAlteracao }
          });
        });
      }).then(function (origem) {
        if (origem !== 'arquivo' && origem !== 'navegador') return { ok: false, cancelado: true };
        var anterior = handle;
        handle = escolhido;
        var passo = origem === 'arquivo'
          ? carregar(leitura.bytes, leitura.arquivo.lastModified).then(function () {
              mudar({ situacao: 'vinculado', nome: escolhido.name || NOME_PADRAO, salvoEm: leitura.arquivo.lastModified, motivo: null });
              return true;
            })
          : (mudar({ situacao: 'vinculado', nome: escolhido.name || NOME_PADRAO, motivo: null }), gravarAgora());
        return passo.then(function (ok) {
          if (!ok) throw new Error(MSG_FALHA + '.');
          return guardarHandle(escolhido);
        }).then(function () {
          return { ok: true, cancelado: false, origem: origem, nome: st.nome };
        }, function (e) {
          if (origem === 'arquivo') { handle = anterior; }
          throw e;
        });
      }).catch(function (e) {
        if (ehCancelado(e)) return { ok: false, cancelado: true };
        if (ehSeguranca(e)) marcarBloqueado(e);
        throw e;
      });
    };

    /* Botão "Reconectar": pede a permissão (precisa de clique) e sincroniza. */
    api.reconectar = function () {
      if (!handle) return Promise.resolve(false);
      return permissao(handle, true).then(function (p) {
        if (p !== 'granted') {
          mudar({ situacao: 'reconectar', motivo: 'A permissão para gravar no arquivo foi negada.' });
          return false;
        }
        return sincronizar().then(function () { return st.situacao === 'vinculado'; });
      }).catch(function (e) {
        if (ehSeguranca(e)) { marcarBloqueado(e); return false; }
        mudar({ situacao: 'reconectar', motivo: (e && e.message) || String(e) });
        throw e;
      });
    };

    api.desvincular = function () {
      cancelarTimer();
      handle = null;
      gravarLocal(CHAVE_GRAVACAO, null);
      return Promise.resolve(armazenamento.apagar(CHAVE_HANDLE)).catch(function () { /* já não existe */ }).then(function () {
        mudar({ situacao: disponivel() ? 'desvinculado' : 'nao-suportado', nome: null, salvoEm: null, motivo: bloqueado });
        return true;
      });
    };

    /* Espera a gravação pendente (testes). */
    api._esperar = function () {
      return new Promise(function (resolve) {
        (function checar() {
          if (timer) setTimeout(checar, 10);
          else Promise.resolve(gravando).then(function () { resolve(); });
        })();
      });
    };

    return api;
  };

  BE.criarArquivoBanco.decidirOrigem = decidirOrigem;
  BE.criarArquivoBanco.precisaPerguntaInicial = precisaPerguntaInicial;
  BE.criarArquivoBanco.CHAVE_INICIO = CHAVE_INICIO;
  BE.criarArquivoBanco.CHAVE_GRAVACAO = CHAVE_GRAVACAO;

  if (BE.db) {
    BE.arquivoBanco = BE.criarArquivoBanco({ banco: BE.db });
    BE.arquivoBanco.decidirOrigem = decidirOrigem;
    BE.arquivoBanco.precisaPerguntaInicial = precisaPerguntaInicial;
    BE.arquivoBanco.inicioEscolhido = function () { return lerLocal(CHAVE_INICIO) === '1'; };
    BE.arquivoBanco.escolherInicioVazio = function () { gravarLocal(CHAVE_INICIO, '1'); };
  }
})(window.BE);
