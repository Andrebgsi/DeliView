/*
 * Interface do "onde está o banco", comum a todas as telas:
 *   BE.bancoInicial.iniciar()        depois do BE.dbPronto: sincroniza o arquivo vinculado e,
 *                                    se o banco estiver vazio, abre a pergunta inicial
 *   BE.bancoInicial.abrirPergunta()  modal "Onde está o banco de dados?" (também pela tela Dados e backup)
 *   BE.bancoInicial.escolherOrigem(info) -> Promise<'arquivo'|'navegador'|null>
 *   BE.bancoInicial.vincularExistente()  fluxo do botão, com a escolha da origem quando há dados aqui
 * Também cuida da faixa "Reconectar" (#faixa-arquivo) e da linha do arquivo no indicador da sidebar.
 * Os <dialog> ficam no <body>, fora da área das telas, porque a tela é redesenhada a cada rota.
 */
window.BE = window.BE || {};

(function (BE) {
  "use strict";

  const esc = (s) => BE.escapar(s);
  const ic = (n, t) => BE.icone(n, t);
  const INT = new Intl.NumberFormat("pt-BR");
  const FRASE = "Cada navegador guarda sua própria cópia. Para usar os mesmos dados aqui, abra o arquivo do banco ou um backup.";

  let dlgPergunta = null;
  let dlgOrigem = null;
  let leitura = null;      // { leitura, previa, arquivo } da pergunta inicial
  let ocupado = false;
  let resolverOrigem = null;

  function plural(n, um, varios) {
    return INT.format(n || 0) + " " + (n === 1 ? um : varios || um + "s");
  }

  function dataBr(iso) {
    const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso || "");
    return m ? m[3] + "/" + m[2] + "/" + m[1] : iso || "—";
  }

  function hora(ms) {
    const d = new Date(ms);
    if (isNaN(d.getTime())) return "";
    return (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
  }

  /* ------------------------------------------------------------------ */
  /* Pergunta inicial                                                    */
  /* ------------------------------------------------------------------ */

  function montarPergunta() {
    if (dlgPergunta) return dlgPergunta;
    const d = document.createElement("dialog");
    d.className = "painel";
    d.id = "pi-dlg";
    d.setAttribute("aria-labelledby", "pi-titulo");
    d.setAttribute("aria-describedby", "pi-frase");
    d.innerHTML =
      '<div class="painel__corpo">' +
      '  <header class="painel__topo"><div><h2 id="pi-titulo">Onde está o banco de dados?</h2>' +
      '    <p class="painel__sub">Este navegador ainda não tem pedidos nem metas do portal.</p></div>' +
      '    <button type="button" class="botao-icone botao-icone--claro" data-fechar aria-label="Fechar">' + ic("x", 20) + "</button></header>" +
      '  <div class="painel__rolagem">' +
      '    <p id="pi-frase">' + esc(FRASE) + "</p>" +
      '    <div class="opcoes-inicio" id="pi-opcoes">' +
      '      <button type="button" class="opcao-inicio" id="pi-abrir">' + ic("pastaAberta", 22) +
      "        <span><b>Abrir arquivo do banco (.sqlite ou .zip)</b><small>O arquivo vinculado em outro navegador, ou um backup .zip.</small></span></button>" +
      '      <button type="button" class="opcao-inicio" id="pi-vincular">' + ic("banco", 22) +
      "        <span><b>Vincular arquivo do banco (salva automaticamente)</b><small>Usa o mesmo arquivo .sqlite e grava nele a cada mudança.</small></span></button>" +
      '      <button type="button" class="opcao-inicio opcao-inicio--neutra" id="pi-vazio">' + ic("play", 22) +
      "        <span><b>Começar com banco vazio</b><small>Para importar as planilhas agora. A pergunta não aparece mais neste navegador.</small></span></button>" +
      "    </div>" +
      '    <input type="file" id="pi-input" accept=".sqlite,.zip,.db,.sqlite3" hidden>' +
      '    <div id="pi-previa" hidden></div>' +
      '    <p class="erro-campo" id="pi-erro" role="alert"></p>' +
      "  </div>" +
      '  <footer class="painel__rodape" id="pi-rodape" hidden>' +
      '    <button type="button" class="botao botao--secundario" id="pi-voltar">Voltar</button>' +
      '    <button type="button" class="botao botao--primario" id="pi-usar">' + ic("upload", 18) + "<span>Usar estes dados</span></button>" +
      "  </footer>" +
      "</div>";
    document.body.appendChild(d);

    const $ = (id) => d.querySelector("#" + id);
    d.querySelector("[data-fechar]").addEventListener("click", () => { if (!ocupado) d.close(); });
    d.addEventListener("cancel", (e) => { if (ocupado) e.preventDefault(); });
    $("pi-abrir").addEventListener("click", () => $("pi-input").click());
    $("pi-input").addEventListener("change", (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (f) prepararArquivo(f);
    });
    $("pi-vincular").addEventListener("click", async () => {
      if (ocupado) return;
      ocupado = true;
      $("pi-erro").textContent = "";
      try {
        const r = await vincularExistente();
        if (r && r.ok) d.close();
      } finally {
        ocupado = false;
      }
    });
    $("pi-vazio").addEventListener("click", () => {
      BE.arquivoBanco.escolherInicioVazio();
      d.close();
      BE.toast("Banco vazio. Importe as planilhas na Importação quando quiser.", "info");
    });
    $("pi-voltar").addEventListener("click", () => mostrarOpcoes());
    $("pi-usar").addEventListener("click", usarArquivo);
    dlgPergunta = d;
    return d;
  }

  function mostrarOpcoes() {
    const d = dlgPergunta;
    leitura = null;
    d.querySelector("#pi-opcoes").hidden = false;
    d.querySelector("#pi-previa").hidden = true;
    d.querySelector("#pi-rodape").hidden = true;
    d.querySelector("#pi-erro").textContent = "";
    d.querySelector("#pi-vincular").hidden = !BE.arquivoBanco.disponivel();
    d.querySelector("#pi-abrir").focus();
  }

  function abrirPergunta() {
    const d = montarPergunta();
    if (!d.open) d.showModal();
    mostrarOpcoes();
  }

  async function prepararArquivo(arquivo) {
    const d = dlgPergunta;
    const erro = d.querySelector("#pi-erro");
    erro.textContent = "";
    try {
      await BE.dbPronto;
      const l = await BE.backup.lerArquivo(arquivo);
      const p = await BE.backup.previa(l);
      leitura = { leitura: l, previa: p, arquivo };
      const b = p.backup;
      let data = p.data ? BE.formatarDataHora(p.data, true) : "";
      if (!data && arquivo.lastModified) data = BE.formatarDataHora(new Date(arquivo.lastModified).toISOString(), true) + " (data do arquivo)";
      const periodo = b.inicio ? (b.inicio === b.fim ? dataBr(b.inicio) : dataBr(b.inicio) + " a " + dataBr(b.fim)) : "—";
      d.querySelector("#pi-previa").innerHTML =
        '<h3 class="painel__secao">' + esc(arquivo.name) + "</h3>" +
        '<div class="tabela-wrap">' + BE.tabelaHtml(["", "Neste arquivo"], [
          ["Data", data || "—"],
          ["Pedidos (total)", INT.format(b.pedidos)],
          ["Pedidos concluídos", INT.format(b.concluidos)],
          ["Metas", INT.format(b.metas)],
          ["Cargas", INT.format(b.cargas)],
          ["Período coberto", periodo],
        ], [1]) + "</div>" +
        (p.maisNovo
          ? '<p class="alerta-milho">' + ic("alerta", 18) + "<span>Este arquivo é de uma versão mais nova do portal (v" + esc(b.versao) + ") e não pode ser aberto aqui.</span></p>"
          : p.migra
            ? '<p class="nota">' + ic("info", 16) + "<span>O arquivo é da versão v" + esc(b.versao) + " e será atualizado para a v" + esc(p.versaoPortal) + ".</span></p>"
            : "");
      d.querySelector("#pi-opcoes").hidden = true;
      d.querySelector("#pi-previa").hidden = false;
      d.querySelector("#pi-rodape").hidden = false;
      d.querySelector("#pi-usar").disabled = !!p.maisNovo;
      d.querySelector("#pi-usar").focus();
    } catch (e) {
      erro.textContent = e.message;
    }
  }

  async function usarArquivo() {
    if (!leitura || ocupado) return;
    const d = dlgPergunta;
    const botao = d.querySelector("#pi-usar");
    ocupado = true;
    botao.disabled = true;
    try {
      await BE.db.restaurarBackup(leitura.leitura.bytes);
      const r = BE.db.resumo();
      d.close();
      BE.toast("Dados abertos: " + plural(r.pedidos, "pedido") + ".", "sucesso");
      leitura = null;
    } catch (e) {
      d.querySelector("#pi-erro").textContent = e.message;
      botao.disabled = false;
    } finally {
      ocupado = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Escolha da origem (vincular existente com dados nos dois lados)     */
  /* ------------------------------------------------------------------ */

  function montarOrigem() {
    if (dlgOrigem) return dlgOrigem;
    const d = document.createElement("dialog");
    d.className = "painel";
    d.id = "origem-dlg";
    d.setAttribute("aria-labelledby", "origem-titulo");
    d.innerHTML =
      '<div class="painel__corpo">' +
      '  <header class="painel__topo"><div><h2 id="origem-titulo">Qual banco usar?</h2><p class="painel__sub" id="origem-sub"></p></div>' +
      '    <button type="button" class="botao-icone botao-icone--claro" data-fechar aria-label="Cancelar">' + ic("x", 20) + "</button></header>" +
      '  <div class="painel__rolagem">' +
      "    <p>O arquivo e este navegador têm dados. Escolha qual cópia vale; a outra é substituída.</p>" +
      '    <div class="opcoes-inicio">' +
      '      <button type="button" class="opcao-inicio" data-origem="arquivo">' + ic("pastaAberta", 22) + '<span id="origem-arquivo"></span></button>' +
      '      <button type="button" class="opcao-inicio" data-origem="navegador">' + ic("banco", 22) + '<span id="origem-navegador"></span></button>' +
      "    </div>" +
      "  </div>" +
      '  <footer class="painel__rodape"><button type="button" class="botao botao--secundario" data-fechar>Cancelar</button></footer>' +
      "</div>";
    document.body.appendChild(d);
    const fim = (v) => {
      if (resolverOrigem) { const r = resolverOrigem; resolverOrigem = null; r(v); }
      if (d.open) d.close();
    };
    d.querySelectorAll("[data-fechar]").forEach((b) => b.addEventListener("click", () => fim(null)));
    d.querySelectorAll("[data-origem]").forEach((b) => b.addEventListener("click", () => fim(b.getAttribute("data-origem"))));
    d.addEventListener("close", () => fim(null));
    dlgOrigem = d;
    return d;
  }

  function resumoLado(titulo, lado, extra) {
    const data = lado.data ? BE.formatarDataHora(lado.data, true) : "—";
    return "<b>" + esc(titulo) + "</b><small>" + esc(plural(lado.pedidos, "pedido") + " · " + plural(lado.metas, "meta") + " · " + data) + "</small>" +
      (extra ? "<small>" + esc(extra) + "</small>" : "");
  }

  function escolherOrigem(info) {
    const d = montarOrigem();
    d.querySelector("#origem-sub").textContent = info.nome || "";
    d.querySelector("#origem-arquivo").innerHTML = resumoLado("O do arquivo", info.arquivo, "Substitui os dados deste navegador.");
    d.querySelector("#origem-navegador").innerHTML = resumoLado("O deste navegador, que sobrescreve o arquivo", info.navegador);
    return new Promise((resolve) => {
      resolverOrigem = resolve;
      d.showModal();
      d.querySelector('[data-origem="arquivo"]').focus();
    });
  }

  /* Fluxo do botão "Vincular arquivo existente" (pergunta inicial e tela Dados e backup). */
  async function vincularExistente() {
    try {
      await BE.dbPronto;
      const r = await BE.arquivoBanco.vincularExistente({ escolher: escolherOrigem });
      if (r.ok) {
        BE.toast(r.origem === "navegador"
          ? "Arquivo vinculado: " + r.nome + " recebeu os dados deste navegador."
          : "Arquivo vinculado: dados carregados de " + r.nome + ".", "sucesso");
      }
      return r;
    } catch (e) {
      console.error(e);
      BE.toast(e.message, "erro");
      return { ok: false, erro: e };
    }
  }

  async function vincularNovo() {
    try {
      await BE.dbPronto;
      const r = await BE.arquivoBanco.vincularNovo();
      if (r.ok) BE.toast("Arquivo vinculado: " + r.nome + ". O portal salva nele sozinho.", "sucesso");
      return r;
    } catch (e) {
      console.error(e);
      BE.toast("Não foi possível vincular o arquivo: " + e.message, "erro");
      return { ok: false, erro: e };
    }
  }

  async function reconectar(botao) {
    if (botao) botao.disabled = true;
    try {
      const ok = await BE.arquivoBanco.reconectar();
      if (ok) BE.toast("Reconectado ao arquivo do banco.", "sucesso");
      else BE.toast("O arquivo não foi reconectado.", "aviso");
      return ok;
    } catch (e) {
      BE.toast("Não foi possível reconectar: " + e.message, "erro");
      return false;
    } finally {
      if (botao) botao.disabled = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Faixa "Reconectar" e indicador da sidebar                           */
  /* ------------------------------------------------------------------ */

  function textoArquivo(e) {
    if (e.situacao === "vinculado" || e.situacao === "reconectar") {
      return "Banco: arquivo " + (e.nome || "deliview.sqlite") + (e.salvoEm ? " · salvo " + hora(e.salvoEm) : "");
    }
    return "Banco: só neste navegador";
  }

  function desenharEstado(e) {
    const linha = document.getElementById("indicador-arquivo-texto");
    if (linha) {
      const alerta = e.situacao === "reconectar";
      linha.innerHTML = (alerta ? '<span class="indicador-banco__alerta" aria-hidden="true">' + ic("alerta", 12) + "</span>" : "") +
        "<span>" + esc(textoArquivo(e)) + (alerta ? '<span class="visualmente-oculto"> (precisa reconectar)</span>' : "") + "</span>";
    }
    const faixa = document.getElementById("faixa-arquivo");
    if (faixa) {
      const mostrar = e.situacao === "reconectar";
      if (mostrar) {
        faixa.querySelector(".faixa-arquivo__texto").textContent = "Reconectar ao arquivo do banco " + (e.nome || "deliview.sqlite");
      }
      faixa.hidden = !mostrar;
    }
  }

  function montarFaixa() {
    const faixa = document.getElementById("faixa-arquivo");
    if (!faixa) return;
    faixa.innerHTML =
      '<span class="faixa-arquivo__icone" aria-hidden="true">' + ic("alerta", 18) + "</span>" +
      '<p class="faixa-arquivo__texto">Reconectar ao arquivo do banco deliview.sqlite</p>' +
      '<button type="button" class="botao botao--primario botao--pequeno" id="faixa-reconectar">' + ic("repetir", 16) + "<span>Reconectar</span></button>";
    faixa.querySelector("#faixa-reconectar").addEventListener("click", (ev) => reconectar(ev.currentTarget));
  }

  /* ------------------------------------------------------------------ */
  /* Abertura do portal                                                  */
  /* ------------------------------------------------------------------ */

  async function iniciar() {
    montarFaixa();
    document.addEventListener("be:arquivo-banco", (e) => desenharEstado(e.detail));
    desenharEstado(BE.arquivoBanco.estado());
    try {
      await BE.dbPronto;
    } catch (e) {
      return; // banco indisponível: já avisado
    }
    const estado = await BE.arquivoBanco.iniciar();
    desenharEstado(estado);
    /* Com vínculo guardado (mesmo esperando reconectar), a faixa resolve; não pergunta. */
    if (estado.situacao === "vinculado" || estado.situacao === "reconectar") return;
    const s = BE.backup.situacao();
    if (BE.arquivoBanco.precisaPerguntaInicial({ pedidos: s.pedidos, metas: s.metas, inicioEscolhido: BE.arquivoBanco.inicioEscolhido() })) {
      abrirPergunta();
    }
  }

  BE.bancoInicial = {
    iniciar,
    abrirPergunta,
    escolherOrigem,
    vincularExistente,
    vincularNovo,
    reconectar,
    textoArquivo,
  };
})(window.BE);
