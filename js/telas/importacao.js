/*
 * Tela: Importação
 * Recebe os .xlsx, roda o ETL da Etapa 5 (BE.etl), grava no SQLite (BE.carga) e mostra
 * conferências, exportações (lidas do banco), histórico de cargas e as tabelas gravadas.
 */
window.BE = window.BE || {};
BE.telas = BE.telas || {};

(function (BE) {
  "use strict";

  const esc = (s) => BE.escapar(s);
  const ic = (n, t) => BE.icone(n, t);
  const LIMITE_PREVIA = 50;

  /* Estado da sessão (sobrevive à troca de tela, não ao recarregar a página) */
  const estado = {
    arquivos: [],     // itens de BE.etl.lerArquivos
    resultado: null,  // retorno de BE.etl.executar
    gravacao: null,   // retorno de BE.carga.gravar
    leituras: 0,      // leituras de arquivo em andamento
    processando: false,
    tabelaEscolhida: "FATO_PEDIDO",
  };

  let raiz = null;
  let bancoAberto = false; // vira true quando BE.dbPronto resolve (antes disso, quem atualiza é o render)
  const $ = (id) => raiz && raiz.querySelector("#" + id);

  /* ------------------------------------------------------------------ */
  /* Montagem                                                            */
  /* ------------------------------------------------------------------ */

  function render(el) {
    raiz = el;
    el.innerHTML =
      BE.cabecalho("Importação", "Envie os relatórios de pedidos do iFood, do 99Food ou dos dois") +

      '<section class="cartao" aria-labelledby="imp-t-arquivos">' +
      '  <div class="cartao__topo"><h2 id="imp-t-arquivos">' + ic("planilha", 20) + "Arquivos</h2></div>" +
      '  <div class="dropzone" id="imp-drop" role="button" tabindex="0" aria-describedby="imp-drop-dica">' +
      '    <span class="dropzone__icone">' + ic("nuvemUpload", 36) + "</span>" +
      '    <span class="dropzone__titulo">Arraste os arquivos .xlsx aqui ou clique para escolher</span>' +
      '    <span class="dropzone__dica" id="imp-drop-dica">Use o relatório “Dados do pedido” do iFood, do 99Food ou dos dois. ' +
      "Conciliação do iFood, dados da loja do 99Food e planilha de custos são reconhecidos, mas não entram no modelo v2.</span>" +
      '    <input type="file" id="imp-input" accept=".xlsx" multiple hidden>' +
      "  </div>" +
      '  <p class="cartao__nota">Quer só conhecer o portal? Baixe os arquivos de exemplo, com dados <strong>fictícios</strong>: ' +
      '<a href="exemplos/ifood-dados-do-pedido-exemplo.xlsx" download>iFood</a> e <a href="exemplos/99food-dados-do-pedido-exemplo.xlsx" download>99Food</a>. Depois arraste os dois para a caixa acima.</p>' +
      '  <div class="requisitos" id="imp-requisitos"></div>' +
      '  <ul class="lista-arquivos" id="imp-lista" aria-live="polite"></ul>' +
      '  <div class="acoes">' +
      '    <button type="button" class="botao botao--primario" id="imp-processar">' + ic("play", 18) + "<span>Processar e gravar no banco</span></button>" +
      '    <button type="button" class="botao botao--secundario" id="imp-limpar">Limpar lista</button>' +
      "  </div>" +
      "</section>" +

      '<section id="imp-resultado" class="pilha" hidden aria-live="polite"></section>' +

      '<section class="cartao" aria-labelledby="imp-t-exportar">' +
      '  <div class="cartao__topo"><h2 id="imp-t-exportar">' + ic("download", 20) + "Exportar</h2>" +
      '  <p class="cartao__nota">As exportações leem do banco salvo neste navegador.</p></div>' +
      '  <div class="grade-botoes">' +
      '    <button type="button" class="botao botao--secundario" data-exportar="xlsx">' + ic("planilha", 18) + "<span>Data Mart em Excel</span></button>" +
      '    <button type="button" class="botao botao--secundario" data-exportar="csv">' + ic("arquivoZip", 18) + "<span>Tabelas em CSV (zip)</span></button>" +
      '    <button type="button" class="botao botao--secundario" data-exportar="log">' + ic("arquivoTexto", 18) + "<span>Registro de execução (.txt)</span></button>" +
      '    <button type="button" class="botao botao--secundario" data-exportar="sqlite">' + ic("banco", 18) + "<span>Salvar banco (.sqlite)</span></button>" +
      '    <button type="button" class="botao botao--secundario" id="imp-abrir-banco">' + ic("pastaAberta", 18) + "<span>Abrir banco (.sqlite)</span></button>" +
      '    <input type="file" id="imp-input-banco" accept=".sqlite,.db,.sqlite3" hidden>' +
      "  </div>" +
      '  <p class="link-mais"><a href="#/dados">' + ic("bancoEscudo", 16) + "<span>Mais opções em Dados e backup</span>" + ic("setaDireita", 16) + "</a></p>" +
      "</section>" +

      '<section class="cartao" aria-labelledby="imp-t-historico">' +
      '  <div class="cartao__topo"><h2 id="imp-t-historico">' + ic("historico", 20) + "Histórico de cargas</h2></div>" +
      '  <div id="imp-historico">' + carregando() + "</div>" +
      "</section>" +

      '<section class="cartao" aria-labelledby="imp-t-tabelas">' +
      '  <div class="cartao__topo"><h2 id="imp-t-tabelas">' + ic("tabela", 20) + "Conferir as tabelas</h2>" +
      '    <label class="campo campo--linha" for="imp-seletor">Tabela <select id="imp-seletor"></select></label></div>' +
      '  <div id="imp-tabela">' + carregando() + "</div>" +
      "</section>" +

      '<section class="cartao cartao--perigo" aria-labelledby="imp-t-perigo">' +
      '  <div class="cartao__topo"><h2 id="imp-t-perigo">' + ic("triangulo", 20) + "Zona de perigo</h2></div>" +
      "  <p>Apaga o banco guardado neste navegador: pedidos, metas, histórico de cargas e problemas. " +
      "Não dá para desfazer. Se precisar dos dados, use antes “Salvar banco (.sqlite)”.</p>" +
      '  <div class="acoes"><button type="button" class="botao botao--perigo" id="imp-apagar">' + ic("lixeira", 18) + "<span>Apagar todos os dados</span></button></div>" +
      "</section>" +

      '<div class="rodape-aviso" role="note">' +
      '  <span aria-hidden="true">⚠</span>' +
      "  <p>" + BE.avisoSegurancaHtml() + "</p>" +
      "</div>";

    ligarEventos();
    desenharArquivos();
    if (estado.resultado) desenharResultado();

    const seletor = $("imp-seletor");
    seletor.innerHTML = BE.schema.tabelas.map((t) => "<option>" + esc(t) + "</option>").join("");
    seletor.value = estado.tabelaEscolhida;

    BE.dbPronto.then(() => {
      bancoAberto = true;
      atualizarDoBanco();
    }, (erro) => {
      const msg = BE.estadoVazio("alerta", "Banco indisponível", String((erro && erro.message) || erro));
      $("imp-historico").innerHTML = msg;
      $("imp-tabela").innerHTML = msg;
    });
  }

  function carregando() {
    return '<p class="carregando">' + ic("carregando", 18) + "<span>Carregando o banco…</span></p>";
  }

  function montada() {
    return raiz && document.body.contains(raiz);
  }

  /* ------------------------------------------------------------------ */
  /* Eventos                                                             */
  /* ------------------------------------------------------------------ */

  function ligarEventos() {
    const drop = $("imp-drop");
    const input = $("imp-input");

    drop.addEventListener("click", () => input.click());
    drop.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        input.click();
      }
    });
    input.addEventListener("change", () => {
      receber(Array.from(input.files));
      input.value = "";
    });
    ["dragenter", "dragover"].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add("dropzone--sobre");
      }),
    );
    ["dragleave", "drop"].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.remove("dropzone--sobre");
      }),
    );
    drop.addEventListener("drop", (e) => receber(Array.from(e.dataTransfer.files)));

    $("imp-lista").addEventListener("click", (e) => {
      const b = e.target.closest("[data-remover]");
      if (!b) return;
      estado.arquivos.splice(+b.getAttribute("data-remover"), 1);
      desenharArquivos();
    });
    $("imp-limpar").addEventListener("click", () => {
      estado.arquivos = [];
      desenharArquivos();
    });
    $("imp-processar").addEventListener("click", processar);

    raiz.querySelectorAll("[data-exportar]").forEach((b) =>
      b.addEventListener("click", () => exportar(b.getAttribute("data-exportar"), b)),
    );
    $("imp-abrir-banco").addEventListener("click", () => $("imp-input-banco").click());
    $("imp-input-banco").addEventListener("change", (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (f) abrirBanco(f);
    });

    $("imp-seletor").addEventListener("change", (e) => {
      estado.tabelaEscolhida = e.target.value;
      desenharTabela();
    });

    $("imp-apagar").addEventListener("click", apagarTudo);
  }

  /* Atualiza histórico e tabelas quando o banco muda (importação, restauração, apagar) */
  document.addEventListener("be:banco-alterado", () => {
    if (bancoAberto && montada()) atualizarDoBanco();
  });

  /* ------------------------------------------------------------------ */
  /* Arquivos                                                            */
  /* ------------------------------------------------------------------ */

  async function receber(files) {
    if (!files.length) return;
    estado.leituras++;
    desenharArquivos();
    try {
      const lidos = await BE.etl.lerArquivos(files);
      for (const novo of lidos) {
        const i = estado.arquivos.findIndex((a) => a.nome === novo.nome);
        if (i >= 0) estado.arquivos[i] = novo;
        else estado.arquivos.push(novo);
      }
      const ruins = lidos.filter((a) => a.erro).length;
      if (ruins) BE.toast(ruins + (ruins === 1 ? " arquivo não foi reconhecido." : " arquivos não foram reconhecidos."), "aviso");
    } catch (e) {
      BE.toast("Não foi possível ler os arquivos: " + e.message, "erro");
    } finally {
      estado.leituras--;
      if (montada()) desenharArquivos();
    }
  }

  function prontos() {
    const tem = (t) => estado.arquivos.some((a) => a.tipo === t);
    return { ifood: tem("ifood"), n99: tem("n99") };
  }

  function desenharArquivos() {
    if (!montada()) return;
    const p = prontos();
    const req = (ok, nome) =>
      '<span class="chip ' + (ok ? "chip--ok" : "chip--pendente") + '">' +
      ic(ok ? "checkCirculo" : "info", 16) + "<span>" + esc(nome) + (ok ? "" : " (não enviado)") + "</span></span>";
    $("imp-requisitos").innerHTML = req(p.ifood, "Pedidos do iFood") + req(p.n99, "Pedidos do 99Food");

    const lista = $("imp-lista");
    if (!estado.arquivos.length && !estado.leituras) {
      lista.innerHTML = '<li class="lista-arquivos__vazia">Nenhum arquivo escolhido ainda.</li>';
    } else {
      lista.innerHTML =
        estado.arquivos
          .map((a, i) => {
            const ok = !a.erro;
            const detalhe = a.erro
              ? a.erro === "não reconhecido" ? "não reconhecido" : "não reconhecido: " + a.erro
              : a.usado ? a.rotulo : a.rotulo + " — " + a.aviso.replace(/^Reconhecido, mas /, "");
            return (
              '<li class="arquivo ' + (ok ? (a.usado ? "arquivo--ok" : "arquivo--ignorado") : "arquivo--erro") + '">' +
              '<span class="arquivo__icone">' + ic(ok ? "checkCirculo" : "alerta", 20) + "</span>" +
              '<span class="arquivo__texto"><span class="arquivo__nome">' + esc(a.nome) + "</span>" +
              '<span class="arquivo__tipo">' + esc(detalhe) + "</span></span>" +
              '<button type="button" class="botao-texto" data-remover="' + i + '" aria-label="Remover ' + esc(a.nome) + '">remover</button>' +
              "</li>"
            );
          })
          .join("") +
        (estado.leituras > 0 ? '<li class="carregando">' + ic("carregando", 18) + "<span>Lendo arquivos…</span></li>" : "");
    }

    const botao = $("imp-processar");
    botao.disabled = !(p.ifood || p.n99) || estado.processando || estado.leituras > 0;
    botao.title = p.ifood || p.n99 ? "" : "Envie o relatório de pedidos do iFood, do 99Food ou dos dois";
    botao.querySelector("span").textContent = estado.processando ? "Processando…" : "Processar e gravar no banco";
    $("imp-limpar").disabled = !estado.arquivos.length || estado.processando;
  }

  /* ------------------------------------------------------------------ */
  /* Processamento                                                       */
  /* ------------------------------------------------------------------ */

  async function processar() {
    estado.processando = true;
    desenharArquivos();
    try {
      estado.resultado = null;
      estado.gravacao = null;
      if (montada()) $("imp-resultado").hidden = true;
      await BE.dbPronto;
      const R = BE.etl.executar(estado.arquivos);
      estado.resultado = R;
      const g = await BE.carga.gravar(R, estado.arquivos.filter((a) => !a.erro));
      estado.gravacao = g;
      if (g.gravado) {
        BE.toast(
          "Carga gravada no banco: " + g.novos + " pedidos novos e " + g.atualizados + " substituídos.",
          g.salvo ? "sucesso" : "aviso",
        );
      } else {
        BE.toast("A carga não foi gravada no banco.", "aviso");
      }
    } catch (e) {
      console.error(e);
      BE.toast("Erro no processamento: " + e.message, "erro");
    } finally {
      estado.processando = false;
      if (montada()) {
        desenharArquivos();
        if (estado.resultado) {
          desenharResultado();
          $("imp-resultado").scrollIntoView({
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
            block: "start",
          });
        }
      }
    }
  }

  function desenharResultado() {
    const R = estado.resultado;
    const g = estado.gravacao;
    const total = R.aplicaveis;
    const ok = total - R.falhas;
    const vendas = BE.etl.tabelaVendas(R.resumoCanal);
    const selo = (c) =>
      c.naoSeAplica
        ? '<span class="selo selo--neutro" title="O relatório deste canal não veio nesta carga">NÃO SE APLICA</span>'
        : '<span class="selo ' + (c.ok ? "selo--ok" : "selo--falha") + '">' + (c.ok ? "OK" : "FALHOU") + "</span>";

    let gravacao;
    if (!g) gravacao = '<p class="nota nota--aviso">A carga não foi gravada no banco.</p>';
    else if (!g.gravado) gravacao = '<p class="nota nota--aviso">Gravação cancelada: o banco não foi alterado.</p>';
    else
      gravacao =
        '<p class="nota nota--ok">' + ic("banco", 16) + "<span>Gravado no banco: " +
        BE.etl.INT.format(g.novos) + " pedidos novos e " + BE.etl.INT.format(g.atualizados) + " substituídos" +
        (g.salvo ? "." : " (não foi possível salvar no navegador: use “Salvar banco”).") + "</span></p>";

    const log = R.log.concat((g && g.logCarga) || []).join("\n");

    $("imp-resultado").innerHTML =
      '<div class="cartao destaque ' + (R.falhas ? "destaque--falha" : "destaque--ok") + '">' +
      '  <div class="destaque__numero">' + ok + " de " + total + "</div>" +
      '  <div><p class="destaque__titulo">conferências aprovadas</p>' +
      '  <p class="destaque__texto">' +
      (R.falhas ? "Veja as que falharam abaixo antes de usar os dados." : "A base está pronta para uso.") +
      "</p>" + gravacao + "</div>" +
      "</div>" +
      avisoAusentes(g) +

      '<div class="cartao"><div class="cartao__topo"><h2>Vendas por plataforma</h2></div>' +
      '<div class="tabela-wrap">' + BE.tabelaHtml(vendas.cab, vendas.linhas, vendas.numericas) + "</div></div>" +

      '<div class="cartao"><div class="cartao__topo"><h2>Conferências</h2></div>' +
      '<div class="tabela-wrap">' +
      BE.tabelaHtml(
        ["Conferência", "Esperado", "Obtido", "Resultado"],
        R.conferencias.map((c) => [c.teste, c.esperado, c.obtido, selo(c)]),
        [1, 2],
        { html: [3] },
      ) +
      "</div></div>" +

      '<details class="cartao recolhivel"><summary>Problemas encontrados e como foram tratados <span class="contador">' +
      R.problemas.length + "</span></summary>" +
      '<div class="tabela-wrap">' +
      BE.tabelaHtml(
        ["Fonte", "Problema encontrado", "Tratamento"],
        R.problemas.map((p) => [p.fonte, p.problema, p.tratamento]),
      ) +
      "</div></details>" +

      '<details class="cartao recolhivel"><summary>Registro passo a passo</summary>' +
      '<pre class="log">' + esc(log) + "</pre></details>";
    $("imp-resultado").hidden = false;
  }

  /* Canal sem relatório nesta carga: avisa se o faturamento dele está faltando no período */
  function avisoAusentes(g) {
    if (!g || !g.gravado || !g.ausentes || !g.ausentes.length) return "";
    const data = (iso) => iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4);
    return g.ausentes
      .map((a) => {
        const periodo = a.inicio === a.fim ? "em " + data(a.inicio) : "de " + data(a.inicio) + " a " + data(a.fim);
        const presente = a.canal === "iFood" ? "99Food" : "iFood";
        if (a.noBanco) {
          return '<p class="aviso-discreto">' + ic("info", 18) + "<span>Esta carga trouxe só o " + esc(presente) +
            ". O banco já tinha " + BE.etl.INT.format(a.noBanco) + " pedidos do " + esc(a.canal) + " " + periodo +
            ", de uma importação anterior, e eles continuam lá.</span></p>";
        }
        return '<p class="alerta-milho" role="status">' + ic("alerta", 18) + "<span>Só o " + esc(presente) +
          " foi importado. O banco não tem pedidos do " + esc(a.canal) + " " + periodo +
          ": o faturamento desse canal fica de fora do Dashboard e das Metas até você importar o relatório dele.</span></p>";
      })
      .join("");
  }

  /* ------------------------------------------------------------------ */
  /* Banco: histórico, tabelas, exportar, abrir, apagar                  */
  /* ------------------------------------------------------------------ */

  function atualizarDoBanco() {
    if (!montada()) return;
    for (const [desenhar, alvo] of [[desenharHistorico, "imp-historico"], [desenharTabela, "imp-tabela"]]) {
      try {
        desenhar();
      } catch (e) {
        console.error(e);
        $(alvo).innerHTML = BE.estadoVazio(
          "alerta",
          "Não foi possível ler o banco",
          "O banco aberto não tem a estrutura esperada (" + e.message + "). Restaure um backup do portal ou apague os dados.",
        );
      }
    }
  }

  function desenharHistorico() {
    const cargas = BE.db.consultar(
      "SELECT id, data_hora, arquivos, pedidos_lidos, pedidos_gravados, conferencias_ok, conferencias_total FROM CARGA_ETL ORDER BY id DESC",
    );
    if (!cargas.length) {
      $("imp-historico").innerHTML = BE.estadoVazio(
        "historico",
        "Nenhuma carga ainda",
        "Depois de processar os arquivos, cada carga aparece aqui com data, arquivos, pedidos e conferências.",
      );
      return;
    }
    const linhas = cargas.map((c) => {
      let arquivos = [];
      try {
        arquivos = JSON.parse(c.arquivos || "[]");
      } catch (e) {
        arquivos = [];
      }
      const lista =
        '<ul class="lista-curta">' +
        arquivos
          .map((a) => "<li" + (a.usado === false ? ' class="lista-curta__ignorado" title="Reconhecido, mas não usado no modelo v2"' : "") + ">" + esc(a.nome) + "</li>")
          .join("") +
        "</ul>";
      // Valores do banco podem vir de um .sqlite restaurado (não confiável): tudo é escapado
      const tudoOk = c.conferencias_ok === c.conferencias_total;
      const conf =
        '<span class="selo ' + (tudoOk ? "selo--ok" : "selo--falha") + '">' +
        esc(c.conferencias_ok) + " de " + esc(c.conferencias_total) + "</span>";
      const inteiro = (v) => esc(typeof v === "number" ? BE.etl.INT.format(v) : v);
      return [
        esc(BE.formatarDataHora(c.data_hora, true) || c.data_hora),
        lista,
        inteiro(c.pedidos_gravados) + ' <span class="sutil">de ' + inteiro(c.pedidos_lidos) + " lidos</span>",
        conf,
      ];
    });
    $("imp-historico").innerHTML =
      '<div class="tabela-wrap">' +
      BE.tabelaHtml(["Data e hora", "Arquivos", "Pedidos gravados", "Conferências"], linhas, [2], { html: [0, 1, 2, 3] }) +
      "</div>";
  }

  function desenharTabela() {
    if (!montada() || !BE.db.aberto) return;
    const nome = estado.tabelaEscolhida;
    if (BE.schema.tabelas.indexOf(nome) < 0) return;
    const total = BE.db.consultar("SELECT COUNT(*) AS n FROM " + nome)[0].n;
    const cab = BE.db.consultar("PRAGMA table_info(" + nome + ")").map((c) => c.name);
    if (!total) {
      $("imp-tabela").innerHTML = BE.estadoVazio(
        "tabela",
        "A tabela " + nome + " está vazia",
        nome === "FATO_META" || nome === "META_DEFINICAO" ? "As metas são cadastradas na tela Metas." : "Importe os arquivos para preencher o banco.",
      );
      return;
    }
    const linhas = BE.db
      .consultar("SELECT * FROM " + nome + " LIMIT " + LIMITE_PREVIA)
      .map((o) => {
        const l = BE.carga.linhaDoBanco(o, cab);
        if (nome === "CARGA_ETL") l[cab.indexOf("log")] = resumirLog(o.log);
        return l;
      });
    const numericas = cab
      .map((c, i) => (linhas.some((l) => typeof l[i] === "number") ? i : -1))
      .filter((i) => i >= 0);
    $("imp-tabela").innerHTML =
      '<p class="cartao__nota">' + BE.etl.INT.format(total) + (total === 1 ? " registro" : " registros") +
      (total > LIMITE_PREVIA ? " · mostrando os primeiros " + LIMITE_PREVIA : "") + "</p>" +
      '<div class="tabela-wrap tabela-wrap--alta">' + BE.tabelaHtml(cab, linhas, numericas) + "</div>";
  }

  function resumirLog(t) {
    const linhas = String(t || "").split("\n");
    return linhas.length + " linhas (baixe em “Registro de execução”)";
  }

  async function exportar(tipo, botao) {
    try {
      await BE.dbPronto;
      if (tipo === "sqlite") {
        BE.db.baixarBackup();
        BE.toast("Banco salvo. Guarde o arquivo como documento sigiloso.", "sucesso");
        return;
      }
      if ((tipo === "xlsx" || tipo === "csv") && !BE.db.resumo().pedidos) {
        BE.toast("O banco ainda não tem pedidos. Importe os arquivos antes de exportar.", "aviso");
        return;
      }
      botao.disabled = true;
      const fn = { xlsx: BE.carga.exportarXlsx, csv: BE.carga.exportarCsvZip, log: BE.carga.exportarLog }[tipo];
      const r = await fn(BE.db);
      BE.carga.baixar(r.blob, r.nome);
      BE.toast("Arquivo gerado: " + r.nome, "sucesso");
    } catch (e) {
      BE.toast(e.message, "aviso");
    } finally {
      botao.disabled = false;
    }
  }

  async function abrirBanco(arquivo) {
    try {
      await BE.dbPronto;
      const r = BE.db.resumo();
      const temDados = Object.keys(r.tabelas).some((t) => r.tabelas[t] > 0);
      if (temDados && !window.confirm("Substituir os dados atuais deste navegador pelo conteúdo de “" + arquivo.name + "”?")) return;
      await BE.db.restaurarBackup(arquivo);
      estado.resultado = null;
      estado.gravacao = null;
      if (montada()) $("imp-resultado").hidden = true;
      BE.toast("Banco restaurado a partir de " + arquivo.name + ".", "sucesso");
    } catch (e) {
      BE.toast(e.message, "erro");
    }
  }

  async function apagarTudo() {
    try {
      await BE.dbPronto;
      const apagou = await BE.db.apagarTudo();
      if (!apagou) return;
      estado.resultado = null;
      estado.gravacao = null;
      if (montada()) $("imp-resultado").hidden = true;
      BE.toast("Todos os dados foram apagados deste navegador.", "sucesso");
    } catch (e) {
      BE.toast("Não foi possível apagar: " + e.message, "erro");
    }
  }

  BE.telas.importacao = {
    titulo: "Importação",
    render,
  };
})(window.BE);
