/*
 * Tela: Dados e backup (#/dados)
 * Situação do banco, backup .zip (BE.backup), restauração com prévia, proteção do armazenamento,
 * verificação de integridade e as quatro limpezas do BE.db, todas com o mesmo fluxo seguro:
 * contagens → "Fazer backup antes" ou "Continuar sem backup" → digitar APAGAR.
 * Os botões da Importação continuam lá e chamam as mesmas funções do BE.db.
 * O cartão "Arquivo do banco" usa BE.arquivoBanco (estado) e BE.bancoInicial (fluxos com diálogo).
 */
window.BE = window.BE || {};
BE.telas = BE.telas || {};

(function (BE) {
  "use strict";

  const esc = (s) => BE.escapar(s);
  const ic = (n, t) => BE.icone(n, t);
  const INT = new Intl.NumberFormat("pt-BR");
  const PALAVRA = "APAGAR";
  const DICA_PASTA = "Para escolher a pasta, ative no navegador a opção “Perguntar onde salvar cada arquivo”.";
  const TEXTO_ARQUIVO = "Com o arquivo vinculado, o portal salva sozinho no arquivo que você escolheu. Para usar em outro navegador, " +
    "vincule o mesmo arquivo. No Firefox, use Abrir arquivo e Fazer backup.";
  const AVISO_ARQUIVO = "Não abra o portal em dois navegadores ao mesmo tempo com o mesmo arquivo: vale a última gravação.";

  let raiz = null;
  let ocupado = false;
  let limpezaAtual = null;  // chave de LIMPEZAS aberta no diálogo
  let leituraAtual = null;  // { leitura, previa, arquivo } do diálogo de restauração
  const $ = (id) => raiz && raiz.querySelector("#" + id);
  const montada = () => raiz && document.body.contains(raiz);

  /* ------------------------------------------------------------------ */
  /* Utilitários                                                         */
  /* ------------------------------------------------------------------ */

  function plural(n, um, varios) {
    return INT.format(n) + " " + (n === 1 ? um : varios || um + "s");
  }

  function dataBr(iso) {
    if (!iso) return "—";
    const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso);
    return m ? m[3] + "/" + m[2] + "/" + m[1] : iso;
  }

  function periodo(s) {
    if (!s.inicio) return "—";
    return s.inicio === s.fim ? dataBr(s.inicio) : dataBr(s.inicio) + " a " + dataBr(s.fim);
  }

  function tamanho(bytes) {
    if (bytes == null || !isFinite(bytes)) return "—";
    const un = ["bytes", "KB", "MB", "GB", "TB"];
    let i = 0;
    let v = bytes;
    while (v >= 1024 && i < un.length - 1) { v /= 1024; i++; }
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: i ? 1 : 0 }).format(v) + " " + un[i];
  }

  function diasDesde(iso) {
    const t = new Date(iso).getTime();
    if (isNaN(t)) return null;
    return Math.floor((Date.now() - t) / 86400000);
  }

  /* ------------------------------------------------------------------ */
  /* Limpezas: o que apaga e o que mantém                                */
  /* ------------------------------------------------------------------ */

  const LIMPEZAS = {
    vendas: {
      titulo: "Limpar dados de vendas",
      efeito: "Apaga os pedidos, o histórico de cargas e os problemas registrados. As metas continuam, com o realizado zerado.",
      apaga: (s) => [plural(s.pedidos, "pedido"), plural(s.cargas, "carga"), plural(s.problemas, "problema registrado", "problemas registrados")],
      mantem: "Dimensões e metas. As metas continuam, e o realizado volta a R$ 0,00.",
      executar: () => BE.db.limparVendas(),
      sucesso: "Dados de vendas apagados. As metas continuam.",
    },
    metas: {
      titulo: "Limpar metas",
      efeito: "Apaga todas as metas e os valores diários delas. Os pedidos continuam.",
      apaga: (s) => [plural(s.metas, "meta"), plural(s.diasMeta, "dia de meta", "dias de meta")],
      mantem: "Pedidos, cargas e dimensões.",
      executar: () => BE.db.limparMetas(),
      sucesso: "Metas apagadas. Os pedidos continuam.",
    },
    banco: {
      titulo: "Limpar banco de dados",
      efeito: "Esvazia todas as tabelas: pedidos, metas, cargas e dimensões. A estrutura do banco continua.",
      apaga: (s) => [plural(s.pedidos, "pedido"), plural(s.metas, "meta"), plural(s.cargas, "carga"), "todas as tabelas de dimensão"],
      mantem: "A estrutura do banco (versão do schema) e a data do último backup.",
      executar: () => BE.db.limparBanco(),
      sucesso: "Banco de dados esvaziado.",
    },
    navegador: {
      titulo: "Limpar navegador (apagar tudo)",
      efeito: "Apaga o banco guardado neste navegador e as preferências do portal. Um banco novo e vazio é criado.",
      apaga: (s) => [plural(s.pedidos, "pedido"), plural(s.metas, "meta"), plural(s.cargas, "carga"),
        "o banco inteiro deste navegador (IndexedDB)", "as preferências do portal, como a data do último backup"],
      mantem: "Nada. É o mesmo que limpar os dados do portal no navegador.",
      executar: () => BE.db.apagarTudo({ semConfirmar: true }),
      sucesso: "Todos os dados foram apagados deste navegador.",
    },
  };

  /* ------------------------------------------------------------------ */
  /* Montagem                                                            */
  /* ------------------------------------------------------------------ */

  function render(el) {
    raiz = el;
    ocupado = false;
    const temPicker = typeof window.showSaveFilePicker === "function";

    el.innerHTML =
      BE.cabecalho("Dados e backup", "Guarde uma cópia dos dados e limpe o que não precisa mais") +

      '<section class="cartao" aria-labelledby="dad-t-situacao">' +
      '  <div class="cartao__topo"><h2 id="dad-t-situacao">' + ic("banco", 20) + "Situação do banco</h2></div>" +
      '  <div id="dad-situacao" aria-live="polite">' + carregando() + "</div>" +
      "</section>" +

      '<section class="cartao" aria-labelledby="dad-t-arquivo">' +
      '  <div class="cartao__topo"><h2 id="dad-t-arquivo">' + ic("banco", 20) + "Arquivo do banco</h2>" +
      '    <span class="chip" id="dad-arq-chip"></span></div>' +
      "  <p>" + esc(TEXTO_ARQUIVO) + "</p>" +
      '  <div id="dad-arq-estado" aria-live="polite"></div>' +
      '  <div class="acoes">' +
      '    <button type="button" class="botao botao--primario" id="dad-arq-novo">' + ic("download", 18) + "<span>Vincular novo arquivo</span></button>" +
      '    <button type="button" class="botao botao--secundario" id="dad-arq-existente">' + ic("pastaAberta", 18) + "<span>Vincular arquivo existente</span></button>" +
      '    <button type="button" class="botao botao--primario" id="dad-arq-reconectar">' + ic("repetir", 18) + "<span>Reconectar</span></button>" +
      '    <button type="button" class="botao botao--secundario" id="dad-arq-desvincular">' + ic("x", 18) + "<span>Desvincular</span></button>" +
      '    <button type="button" class="botao botao--secundario" id="dad-arq-pergunta">' + ic("info", 18) + "<span>Abrir a pergunta inicial</span></button>" +
      "  </div>" +
      '  <p class="alerta-milho">' + ic("alerta", 18) + "<span>" + esc(AVISO_ARQUIVO) + "</span></p>" +
      "</section>" +

      '<section class="cartao" aria-labelledby="dad-t-backup">' +
      '  <div class="cartao__topo"><h2 id="dad-t-backup">' + ic("arquivoZip", 20) + "Backup</h2></div>" +
      "  <p>O arquivo contém todos os pedidos, sem criptografia. Guarde-o em local seguro.</p>" +
      '  <div class="acoes">' +
      '    <button type="button" class="botao botao--primario" id="dad-backup">' + ic("download", 18) + "<span>Fazer backup (.zip)</span></button>" +
      '    <button type="button" class="botao botao--secundario" id="dad-restaurar">' + ic("upload", 18) + "<span>Restaurar backup (.zip ou .sqlite)</span></button>" +
      '    <input type="file" id="dad-input" accept=".zip,.sqlite,.db,.sqlite3" hidden>' +
      "  </div>" +
      '  <p class="nota nota--dica" id="dad-dica-pasta"' + (temPicker ? " hidden" : "") + ">" + ic("info", 16) + "<span>" + esc(DICA_PASTA) + "</span></p>" +
      "</section>" +

      '<section class="cartao" id="dad-armazenamento" aria-labelledby="dad-t-armaz" hidden>' +
      '  <div class="cartao__topo"><h2 id="dad-t-armaz">' + ic("escudo", 20) + "Proteção do armazenamento</h2></div>" +
      "  <p>Quando o disco enche, o navegador pode apagar sozinho os dados de sites. Peça para ele manter os dados do portal.</p>" +
      '  <div id="dad-armaz-info" aria-live="polite"></div>' +
      '  <div class="acoes"><button type="button" class="botao botao--secundario" id="dad-persistir">' + ic("escudo", 18) + "<span>Manter dados neste navegador</span></button></div>" +
      "</section>" +

      '<section class="cartao" aria-labelledby="dad-t-integ">' +
      '  <div class="cartao__topo"><h2 id="dad-t-integ">' + ic("checkCirculo", 20) + "Verificar integridade</h2></div>" +
      "  <p>Confere se o arquivo do banco está íntegro e se todas as chaves estrangeiras apontam para linhas que existem.</p>" +
      '  <div class="acoes"><button type="button" class="botao botao--secundario" id="dad-integridade">' + ic("checkCirculo", 18) + "<span>Verificar integridade</span></button></div>" +
      '  <div id="dad-integ-resultado" aria-live="polite"></div>' +
      "</section>" +

      '<section class="cartao cartao--perigo" aria-labelledby="dad-t-perigo">' +
      '  <div class="cartao__topo"><h2 id="dad-t-perigo">' + ic("triangulo", 20) + "Zona de perigo</h2></div>" +
      "  <p>Nada aqui pode ser desfeito. Cada opção mostra o que será apagado e oferece um backup antes.</p>" +
      '  <ul class="lista-perigo">' +
      Object.keys(LIMPEZAS).map((k) =>
        "<li>" +
        '<button type="button" class="botao botao--perigo" data-limpar="' + k + '">' + ic("lixeira", 18) + "<span>" + esc(LIMPEZAS[k].titulo) + "</span></button>" +
        "<p>" + esc(LIMPEZAS[k].efeito) + "</p></li>").join("") +
      "  </ul>" +
      "</section>" +

      '<div class="rodape-aviso" role="note">' +
      '  <span aria-hidden="true">⚠</span>' +
      "  <p>" + BE.avisoSegurancaHtml() + "</p>" +
      "</div>" +

      dialogoLimpar() + dialogoRestaurar();

    ligarEventos();
    desenharArquivo(BE.arquivoBanco.estado());
    desenharArmazenamento();

    BE.dbPronto.then(() => desenharSituacao(), (erro) => {
      $("dad-situacao").innerHTML = BE.estadoVazio("alerta", "Banco indisponível", String((erro && erro.message) || erro));
    });
  }

  function carregando() {
    return '<p class="carregando">' + ic("carregando", 18) + "<span>Carregando o banco…</span></p>";
  }

  function dialogoLimpar() {
    return '<dialog class="painel" id="dad-dlg-limpar" aria-labelledby="dad-limpar-titulo">' +
      '<form class="painel__corpo" id="dad-form-limpar" novalidate>' +
      '  <header class="painel__topo"><h2 id="dad-limpar-titulo">Limpar</h2>' +
      '    <button type="button" class="botao-icone botao-icone--claro" data-fechar aria-label="Fechar">' + ic("x", 20) + "</button></header>" +
      '  <div class="painel__rolagem">' +
      '    <div><h3 class="painel__secao">Será apagado</h3><ul class="lista-apagar" id="dad-limpar-apaga"></ul></div>' +
      '    <div><h3 class="painel__secao">Continua</h3><p class="cartao__nota" id="dad-limpar-mantem"></p></div>' +
      '    <div class="passo" id="dad-passo-backup">' +
      '      <p class="passo__titulo">1. Quer guardar uma cópia antes?</p>' +
      '      <div class="acoes acoes--justas">' +
      '        <button type="button" class="botao botao--primario" id="dad-limpar-backup">' + ic("download", 18) + "<span>Fazer backup antes</span></button>" +
      '        <button type="button" class="botao botao--secundario" id="dad-limpar-pular">Continuar sem backup</button>' +
      "      </div>" +
      '      <p class="nota nota--ok" id="dad-limpar-backup-ok" hidden></p>' +
      "    </div>" +
      '    <div class="passo" id="dad-passo-confirmar" hidden>' +
      '      <label class="campo" for="dad-palavra"><span class="passo__titulo">2. Para confirmar, digite ' + PALAVRA + "</span>" +
      '        <input type="text" id="dad-palavra" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="dad-palavra-dica"></label>' +
      '      <p class="cartao__nota" id="dad-palavra-dica">Em letras maiúsculas, sem espaços.</p>' +
      "    </div>" +
      '    <p class="erro-campo" id="dad-limpar-erro" role="alert"></p>' +
      "  </div>" +
      '  <footer class="painel__rodape">' +
      '    <button type="button" class="botao botao--secundario" data-fechar>Cancelar</button>' +
      '    <button type="submit" class="botao botao--perigo" id="dad-limpar-ok" disabled>' + ic("lixeira", 18) + "<span>Apagar</span></button>" +
      "  </footer>" +
      "</form></dialog>";
  }

  function dialogoRestaurar() {
    return '<dialog class="painel" id="dad-dlg-restaurar" aria-labelledby="dad-rest-titulo">' +
      '<div class="painel__corpo">' +
      '  <header class="painel__topo"><div><h2 id="dad-rest-titulo">Restaurar backup</h2><p class="painel__sub" id="dad-rest-sub"></p></div>' +
      '    <button type="button" class="botao-icone botao-icone--claro" data-fechar aria-label="Fechar">' + ic("x", 20) + "</button></header>" +
      '  <div class="painel__rolagem" id="dad-rest-corpo"></div>' +
      '  <footer class="painel__rodape">' +
      '    <button type="button" class="botao botao--secundario" data-fechar>Cancelar</button>' +
      '    <button type="button" class="botao botao--primario" id="dad-rest-ok">' + ic("upload", 18) + "<span>Substituir os dados atuais</span></button>" +
      "  </footer>" +
      "</div></dialog>";
  }

  /* ------------------------------------------------------------------ */
  /* Eventos                                                             */
  /* ------------------------------------------------------------------ */

  function ligarEventos() {
    $("dad-backup").addEventListener("click", (e) => backup(e.currentTarget));
    $("dad-restaurar").addEventListener("click", () => $("dad-input").click());
    $("dad-input").addEventListener("change", (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (f) prepararRestauracao(f);
    });
    $("dad-persistir").addEventListener("click", persistir);
    $("dad-arq-novo").addEventListener("click", (e) => comBotao(e.currentTarget, () => BE.bancoInicial.vincularNovo()));
    $("dad-arq-existente").addEventListener("click", (e) => comBotao(e.currentTarget, () => BE.bancoInicial.vincularExistente()));
    $("dad-arq-reconectar").addEventListener("click", (e) => BE.bancoInicial.reconectar(e.currentTarget));
    $("dad-arq-desvincular").addEventListener("click", (e) => comBotao(e.currentTarget, async () => {
      if (!window.confirm("Desvincular o arquivo do banco? Os dados continuam neste navegador, e o arquivo no disco não é apagado.")) return;
      await BE.arquivoBanco.desvincular();
      BE.toast("Arquivo desvinculado. Os dados continuam neste navegador.", "info");
    }));
    $("dad-arq-pergunta").addEventListener("click", () => BE.bancoInicial.abrirPergunta());
    $("dad-integridade").addEventListener("click", verificarIntegridade);
    raiz.querySelectorAll("[data-limpar]").forEach((b) =>
      b.addEventListener("click", () => abrirLimpeza(b.getAttribute("data-limpar"))));

    raiz.querySelectorAll("dialog [data-fechar]").forEach((b) =>
      b.addEventListener("click", () => b.closest("dialog").close()));
    raiz.querySelectorAll("dialog").forEach((d) => {
      d.addEventListener("cancel", (e) => { if (ocupado) e.preventDefault(); });
      d.addEventListener("click", (e) => { if (e.target === d && !ocupado) d.close(); }); // clique fora
    });

    $("dad-limpar-backup").addEventListener("click", backupAntesDeLimpar);
    $("dad-limpar-pular").addEventListener("click", () => mostrarConfirmacao());
    $("dad-palavra").addEventListener("input", (e) => {
      $("dad-limpar-ok").disabled = e.target.value.trim() !== PALAVRA || ocupado;
      $("dad-limpar-erro").textContent = "";
    });
    $("dad-form-limpar").addEventListener("submit", (e) => {
      e.preventDefault();
      executarLimpeza();
    });
    $("dad-rest-ok").addEventListener("click", confirmarRestauracao);
  }

  document.addEventListener("be:banco-alterado", () => {
    if (montada() && BE.db.aberto) desenharSituacao();
  });
  document.addEventListener("be:arquivo-banco", (e) => {
    if (montada()) desenharArquivo(e.detail);
  });

  async function comBotao(botao, fn) {
    botao.disabled = true;
    try {
      await fn();
    } finally {
      if (montada()) desenharArquivo(BE.arquivoBanco.estado()); // reabilita conforme o estado
    }
  }

  /* ------------------------------------------------------------------ */
  /* Arquivo do banco                                                    */
  /* ------------------------------------------------------------------ */

  const ESTADOS_ARQUIVO = {
    vinculado: { chip: "Vinculado", classe: "chip--ok", icone: "checkCirculo" },
    reconectar: { chip: "Precisa reconectar", classe: "chip--pendente", icone: "alerta" },
    desvinculado: { chip: "Não vinculado", classe: "chip--neutro", icone: "info" },
    "nao-suportado": { chip: "Não suportado neste navegador", classe: "chip--neutro", icone: "info" },
  };

  function desenharArquivo(e) {
    if (!montada()) return;
    const cfg = ESTADOS_ARQUIVO[e.situacao] || ESTADOS_ARQUIVO.desvinculado;
    const chip = $("dad-arq-chip");
    chip.className = "chip " + cfg.classe;
    chip.innerHTML = ic(cfg.icone, 16) + "<span>" + esc(cfg.chip) + "</span>";

    const salvo = e.salvoEm ? BE.formatarDataHora(new Date(e.salvoEm).toISOString(), true) : null;
    let html;
    if (e.situacao === "vinculado") {
      html = "Vinculado a <strong>" + esc(e.nome) + "</strong>" + (salvo ? " · última gravação: <strong>" + esc(salvo) + "</strong>" : "") + ".";
    } else if (e.situacao === "reconectar") {
      html = "O arquivo <strong>" + esc(e.nome) + "</strong> continua vinculado, mas o navegador pede permissão de novo. " +
        "Clique em <strong>Reconectar</strong>. Enquanto isso, as mudanças ficam só neste navegador." +
        (e.motivo ? " <small>(" + esc(e.motivo) + ")</small>" : "");
    } else if (e.situacao === "nao-suportado") {
      html = "Este navegador não permite vincular um arquivo. Use <strong>Abrir arquivo</strong> (pergunta inicial ou Restaurar backup) e <strong>Fazer backup</strong>." +
        (e.motivo ? " <small>Motivo: " + esc(e.motivo) + "</small>" : "");
    } else {
      html = "Não vinculado: os dados ficam só neste navegador (IndexedDB).";
    }
    $("dad-arq-estado").innerHTML = '<p class="linha-info">' + ic(cfg.icone, 16) + "<span>" + html + "</span></p>";

    const mostrar = {
      "dad-arq-novo": e.situacao === "desvinculado",
      "dad-arq-existente": e.situacao === "desvinculado",
      "dad-arq-reconectar": e.situacao === "reconectar",
      "dad-arq-desvincular": e.situacao === "vinculado" || e.situacao === "reconectar",
    };
    Object.keys(mostrar).forEach((id) => {
      $(id).hidden = !mostrar[id];
      $(id).disabled = false;
    });
    $("dad-arq-pergunta").disabled = false;
  }

  /* ------------------------------------------------------------------ */
  /* Situação do banco                                                   */
  /* ------------------------------------------------------------------ */

  function desenharSituacao() {
    if (!montada()) return;
    let s;
    try {
      s = BE.backup.situacao();
    } catch (e) {
      $("dad-situacao").innerHTML = BE.estadoVazio("alerta", "Não foi possível ler o banco", e.message);
      return;
    }
    let kb = null;
    try { kb = BE.db.exportar().length; } catch (e) { /* ignora */ }
    const ultimo = BE.backup.ultimoBackup();
    const alerta = BE.backup.precisaBackup(ultimo, s.ultimaAlteracao, new Date());
    const vazio = !s.pedidos && !s.metas && !s.cargas;

    const n = (rotulo, valor, extra) =>
      '<div class="numero-banco' + (extra || "") + '"><small>' + esc(rotulo) + "</small><b>" + esc(valor) + "</b></div>";

    let ultimoTxt = "Nunca foi feito um backup .zip neste navegador.";
    if (ultimo) {
      const d = diasDesde(ultimo);
      ultimoTxt = "Último backup: <strong>" + esc(BE.formatarDataHora(ultimo, true)) + "</strong>" +
        (d === 0 ? " (hoje)" : d === 1 ? " (ontem)" : d > 1 ? " (há " + d + " dias)" : "");
    } else {
      ultimoTxt = esc(ultimoTxt);
    }

    $("dad-situacao").innerHTML =
      '<div class="numeros-banco">' +
      n("Pedidos", INT.format(s.pedidos)) +
      n("Metas", INT.format(s.metas)) +
      n("Cargas", INT.format(s.cargas)) +
      n("Período coberto", periodo(s), " numero-banco--largo") +
      n("Versão do schema", "v" + s.versao) +
      n("Tamanho do banco", kb == null ? "—" : INT.format(Math.max(1, Math.round(kb / 1024))) + " KB") +
      "</div>" +
      '<p class="linha-info">' + ic("historico", 16) + "<span>" + ultimoTxt +
      (s.ultimaAlteracao ? " · Última alteração: " + esc(BE.formatarDataHora(s.ultimaAlteracao, true)) : "") + "</span></p>" +
      (alerta
        ? '<p class="alerta-milho" role="status">' + ic("alerta", 18) + "<span>Faça um backup: há dados novos sem cópia</span></p>"
        : "") +
      (vazio
        ? '<p class="linha-info">' + ic("info", 16) + '<span>O banco está vazio. Importe as planilhas na <a href="#/importacao">Importação</a> ' +
          "ou restaure um backup abaixo.</span></p>"
        : "");
  }

  /* ------------------------------------------------------------------ */
  /* Backup                                                              */
  /* ------------------------------------------------------------------ */

  /* Fluxo comum do botão principal e do "Fazer backup antes". Retorna o resultado de BE.backup.fazerBackup. */
  async function backup(botao) {
    if (botao) botao.disabled = true;
    try {
      await BE.dbPronto;
      const r = await BE.backup.fazerBackup();
      if (r.cancelado) return r;
      if (r.modo === "download" && montada()) $("dad-dica-pasta").hidden = false;
      BE.toast("Backup salvo: " + r.nome, "sucesso");
      if (montada()) desenharSituacao();
      return r;
    } catch (e) {
      console.error(e);
      BE.toast("Não foi possível fazer o backup: " + e.message, "erro");
      return { salvo: false, erro: e };
    } finally {
      if (botao) botao.disabled = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Restauração                                                         */
  /* ------------------------------------------------------------------ */

  async function prepararRestauracao(arquivo) {
    const botao = $("dad-restaurar");
    botao.disabled = true;
    try {
      await BE.dbPronto;
      const leitura = await BE.backup.lerArquivo(arquivo);
      const previa = await BE.backup.previa(leitura);
      leituraAtual = { leitura, previa, arquivo };
      desenharPrevia();
      $("dad-dlg-restaurar").showModal();
    } catch (e) {
      BE.toast(e.message, "erro");
    } finally {
      botao.disabled = false;
    }
  }

  function desenharPrevia() {
    const { previa: p, arquivo } = leituraAtual;
    const b = p.backup;
    const a = p.atual || {};
    let data;
    if (p.data) data = BE.formatarDataHora(p.data, true) || p.data;
    else data = arquivo.lastModified ? BE.formatarDataHora(new Date(arquivo.lastModified).toISOString(), true) + " (data do arquivo)" : "—";

    const linhas = [
      ["Data do backup", data, "—"],
      ["Versão do schema", "v" + b.versao, "v" + (a.versao != null ? a.versao : p.versaoPortal)],
      ["Pedidos (total)", INT.format(b.pedidos), INT.format(a.pedidos || 0)],
      ["Pedidos concluídos", INT.format(b.concluidos), INT.format(a.concluidos || 0)],
      ["Metas", INT.format(b.metas), INT.format(a.metas || 0)],
      ["Cargas", INT.format(b.cargas), INT.format(a.cargas || 0)],
      ["Período coberto", periodo(b), periodo(a)],
    ];

    $("dad-rest-sub").textContent = arquivo.name + " · " + (p.tipo === "zip" ? "backup .zip conferido (SHA-256)" : "banco .sqlite solto");
    $("dad-rest-corpo").innerHTML =
      '<div class="tabela-wrap">' + BE.tabelaHtml(["", "Neste backup", "Banco atual"], linhas, [1, 2]) + "</div>" +
      (p.tipo === "sqlite"
        ? '<p class="nota">' + ic("info", 16) + "<span>Arquivo .sqlite solto (formato antigo): não há manifesto, então não dá para conferir o conteúdo.</span></p>"
        : "") +
      (p.migra
        ? '<p class="nota">' + ic("info", 16) + "<span>Este backup é da versão v" + esc(b.versao) +
          " do schema. Ao restaurar, ele é atualizado para a v" + esc(p.versaoPortal) + ", e as metas antigas são preservadas.</span></p>"
        : "") +
      (p.maisNovo
        ? '<p class="alerta-milho">' + ic("alerta", 18) + "<span>Este backup é de uma versão mais nova do portal (v" + esc(b.versao) +
          ") e não pode ser aberto aqui.</span></p>"
        : '<p class="alerta-milho">' + ic("alerta", 18) + "<span>Os dados atuais deste navegador serão substituídos pelo conteúdo do backup.</span></p>");
    $("dad-rest-ok").disabled = !!p.maisNovo;
  }

  async function confirmarRestauracao() {
    if (!leituraAtual || ocupado) return;
    const botao = $("dad-rest-ok");
    ocupado = true;
    botao.disabled = true;
    try {
      await BE.db.restaurarBackup(leituraAtual.leitura.bytes);
      const r = BE.db.resumo();
      $("dad-dlg-restaurar").close();
      BE.toast("Backup restaurado: " + plural(r.pedidos, "pedido") + ".", "sucesso");
      leituraAtual = null;
    } catch (e) {
      BE.toast(e.message, "erro");
      botao.disabled = false;
    } finally {
      ocupado = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Limpezas                                                            */
  /* ------------------------------------------------------------------ */

  async function abrirLimpeza(tipo) {
    try {
      await BE.dbPronto;
    } catch (e) {
      BE.toast("Banco indisponível.", "erro");
      return;
    }
    limpezaAtual = tipo;
    const L = LIMPEZAS[tipo];
    const s = BE.backup.situacao();
    $("dad-limpar-titulo").textContent = L.titulo;
    $("dad-limpar-apaga").innerHTML = L.apaga(s).map((t) => "<li>" + esc(t) + "</li>").join("");
    $("dad-limpar-mantem").textContent = L.mantem;
    $("dad-passo-backup").hidden = false;
    $("dad-limpar-backup").disabled = false;
    $("dad-limpar-pular").disabled = false;
    $("dad-limpar-backup-ok").hidden = true;
    $("dad-passo-confirmar").hidden = true;
    $("dad-palavra").value = "";
    $("dad-limpar-ok").disabled = true;
    $("dad-limpar-erro").textContent = "";
    $("dad-dlg-limpar").showModal();
    $("dad-limpar-backup").focus();
  }

  async function backupAntesDeLimpar() {
    const botao = $("dad-limpar-backup");
    $("dad-limpar-pular").disabled = true;
    const r = await backup(botao);
    $("dad-limpar-pular").disabled = false;
    if (!r || !r.salvo) return; // cancelado ou erro: continua no passo 1
    const ok = $("dad-limpar-backup-ok");
    ok.innerHTML = ic("checkCirculo", 16) + "<span>Backup salvo: " + esc(r.nome) + "</span>";
    ok.hidden = false;
    mostrarConfirmacao();
  }

  function mostrarConfirmacao() {
    $("dad-passo-confirmar").hidden = false;
    $("dad-palavra").focus();
  }

  async function executarLimpeza() {
    const L = LIMPEZAS[limpezaAtual];
    if (!L || ocupado) return;
    if ($("dad-palavra").value.trim() !== PALAVRA) {
      $("dad-limpar-erro").textContent = "Digite " + PALAVRA + " para confirmar.";
      return;
    }
    ocupado = true;
    $("dad-limpar-ok").disabled = true;
    try {
      await L.executar();
      $("dad-dlg-limpar").close();
      BE.toast(L.sucesso, "sucesso");
      desenharSituacao();
    } catch (e) {
      console.error(e);
      $("dad-limpar-erro").textContent = "Não foi possível apagar: " + e.message;
      $("dad-limpar-ok").disabled = false;
    } finally {
      ocupado = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Armazenamento e integridade                                         */
  /* ------------------------------------------------------------------ */

  function apiArmazenamento() {
    const s = navigator.storage;
    return s && typeof s.estimate === "function" && typeof s.persist === "function" && typeof s.persisted === "function" ? s : null;
  }

  async function desenharArmazenamento() {
    const s = apiArmazenamento();
    const cartao = $("dad-armazenamento");
    if (!s || !cartao) return; // sem as APIs: o cartão fica escondido
    try {
      const [est, protegido] = await Promise.all([s.estimate(), s.persisted()]);
      if (!montada()) return;
      const pct = est.quota ? Math.min(100, (est.usage / est.quota) * 100) : 0;
      $("dad-armaz-info").innerHTML =
        '<p class="linha-info"><span>Uso: <strong>' + esc(tamanho(est.usage)) + "</strong> de " + esc(tamanho(est.quota)) + " disponíveis para o portal</span></p>" +
        '<div class="barra barra--uso" role="img" aria-label="' + esc(new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(pct)) + '% da cota em uso">' +
        '<div class="barra__preenchido barra__preenchido--ok" style="width:' + Math.max(pct, 0.5).toFixed(2) + '%"></div></div>' +
        '<p class="estado-protecao"><span class="chip ' + (protegido ? "chip--ok" : "chip--pendente") + '">' +
        ic(protegido ? "checkCirculo" : "alerta", 16) + "<span>" + (protegido ? "Protegido" : "Pode ser apagado pelo navegador") + "</span></span></p>";
      $("dad-persistir").disabled = protegido;
      cartao.hidden = false;
    } catch (e) {
      cartao.hidden = true;
    }
  }

  async function persistir() {
    const s = apiArmazenamento();
    if (!s) return;
    const botao = $("dad-persistir");
    botao.disabled = true;
    try {
      const ok = await s.persist();
      BE.toast(ok ? "Pronto: o navegador vai manter os dados do portal." :
        "O navegador recusou o pedido. Faça backups com frequência.", ok ? "sucesso" : "aviso");
    } catch (e) {
      BE.toast("Não foi possível pedir a proteção: " + e.message, "erro");
    } finally {
      await desenharArmazenamento(); // reabilita o botão se ainda não estiver protegido
    }
  }

  async function verificarIntegridade() {
    const botao = $("dad-integridade");
    const alvo = $("dad-integ-resultado");
    botao.disabled = true;
    try {
      await BE.dbPronto;
      const r = BE.db.integridade();
      alvo.innerHTML = r.ok
        ? '<p class="nota nota--ok">' + ic("checkCirculo", 16) + "<span>Banco íntegro.</span></p>"
        : '<p class="nota nota--erro">' + ic("alerta", 16) + "<span>" + plural(r.problemas.length, "problema encontrado", "problemas encontrados") + ":</span></p>" +
          '<ul class="lista-problemas">' + r.problemas.slice(0, 100).map((p) => "<li>" + esc(p) + "</li>").join("") + "</ul>" +
          (r.problemas.length > 100 ? '<p class="cartao__nota">Mostrando os 100 primeiros.</p>' : "") +
          '<p class="cartao__nota">Restaure um backup recente ou importe as planilhas de novo.</p>';
    } catch (e) {
      alvo.innerHTML = '<p class="nota nota--erro">' + ic("alerta", 16) + "<span>Não foi possível verificar: " + esc(e.message) + "</span></p>";
    } finally {
      botao.disabled = false;
    }
  }

  BE.telas.dados = {
    titulo: "Dados e backup",
    render,
  };
})(window.BE);
