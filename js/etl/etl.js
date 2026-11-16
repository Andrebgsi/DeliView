/*
 * Motor ETL da Etapa 5 (modelo dimensional v2), sem DOM.
 * Código EXTRAÍDO de referencia/etl-etapa5.html (seções 3 e 4, TIPOS, IGNORADOS, classificar
 * e juntar), sem mudança de regra de negócio. Mudanças estruturais, todas no fim do arquivo:
 *   - dIfood, d99 e formaPagamento foram içados para fora de executarETL (são funções puras);
 *   - BE.etl.executar devolve { tabelas, conferencias, problemas, log, resumoCanal } além do
 *     retorno original (validacao, resumo, falhas);
 *   - classificar também reconhece a planilha de custos atual (abas Ingredientes + CUSTOS_BI),
 *     que continua IGNORADA pelo modelo v2, como na referência.
 * A opção de "tabelas de demonstração" não existe aqui: nenhum dado fictício é gerado.
 */
window.BE = window.BE || {};

(function (BE) {
  "use strict";
  const { comoObjetos } = BE.xlsx;

  /* ============================================================================
   * 3. FUNÇÕES UTILITÁRIAS DE PARSING, MATEMÁTICA E DATAS
   * ============================================================================ */

  /** Arredonda número para duas casas decimais evitando erros de ponto flutuante */
  const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

  /**
   * Converte valores de moeda ou números vindos das planilhas em ponto flutuante válido.
   * Suporta formato brasileiro com vírgula (ex.: "1.250,50") e notação padrão (ex.: "1250.50").
   *
   * @param {any} x - Valor da célula (string, número, nulo ou indefinido).
   * @returns {number} Valor numérico convertido ou 0 caso inválido/vazio.
   */
  function num(x) {
    if (x === null || x === undefined) return 0;
    const s = String(x).trim();
    if (s === "") return 0;
    const v = s.includes(",")
      ? parseFloat(s.replace(/\./g, "").replace(",", "."))
      : parseFloat(s);
    return isNaN(v) ? 0 : v;
  }

  /** Resultado de uma conferência que não se aplica à carga (canal sem relatório) */
  const NAO_SE_APLICA = "NÃO SE APLICA";

  /** Converte a chave YYYYMMDD (ex.: 20260915) em data ISO AAAA-MM-DD */
  const isoDeId = (n) => {
    const s = String(n);
    return s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8);
  };

  /** Converte objeto Date em chave numérica inteira YYYYMMDD (ex.: 20260915) */
  const ymd = (d) =>
    d.getUTCFullYear() * 10000 +
    (d.getUTCMonth() + 1) * 100 +
    d.getUTCDate();

  /** Converte objeto Date em string no padrão ISO YYYY-MM-DD */
  const iso = (d) => d.toISOString().slice(0, 10);

  /** Converte data do iFood (DD/MM/YYYY hh:mm:ss) em chave inteira YYYYMMDD */
  const dIfood = (s) => {
    const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? +(m[3] + m[2] + m[1]) : null;
  };

  /** Converte data da 99Food (YYYYMMDD ou YYYY-MM-DD) em chave inteira YYYYMMDD */
  const d99 = (s) => {
    const m = String(s)
      .trim()
      .match(/^(\d{4})(\d{2})(\d{2})/);
    return m ? +(m[1] + m[2] + m[3]) : null;
  };

  /**
   * Padroniza o texto livre da forma de pagamento em uma categoria comum aos
   * dois canais (a mesma lista recomendada na Etapa 5).
   *   iFood  : "Pgto via APP - Carteira Digital (Mastercard)" -> "Carteira Digital"
   *            "Pgto na Entrega - Crédito (Visa)"             -> "Crédito"
   *   99Food : "Pagamento em dinheiro" -> "Dinheiro"
   *            "Pagamento online"      -> "Online (sem detalhe)"  (o relatório
   *            não informa se foi Pix, cartão etc.)
   * Qualquer texto novo, não previsto, cai em "Outros" e é avisado na conferência.
   * O momento do pagamento (pelo app x na entrega) não faz parte do modelo.
   */
  const formaPagamento = (t) => {
    const s = String(t ?? "").toLowerCase().trim();
    if (s.includes("dinheiro")) return "Dinheiro";
    if (s.includes("pix")) return "Pix";
    if (s.includes("carteira digital")) return "Carteira Digital";
    if (s.includes("app do banco")) return "App do Banco";
    if (s.includes("crédito") || s.includes("credito")) return "Crédito";
    if (s.includes("débito") || s.includes("debito")) return "Débito";
    if (s === "pagamento online") return "Online (sem detalhe)";
    return "Outros";
  };

  /* ============================================================================
   * 4. MOTOR PRINCIPAL DO ETL (MODELAGEM DIMENSIONAL KIMBALL)
   * ============================================================================ */

  /**
   * Executa o pipeline completo de transformação e carga dos dados no modelo Star Schema.
   *
   * JOBS EXECUTADOS (numeração sequencial):
   * - JOB 0: Extração e deduplicação dos pedidos brutos (iFood e 99Food).
   * - JOB 1: DIM_TEMPO  - calendário diário contínuo.
   * - JOB 2: DIM_CANAL, DIM_STATUS, DIM_PAGAMENTO, DIM_TIPO_ENTREGA.
   * - JOB 3: Transformação dos pedidos do iFood  (medidas padronizadas + ZERA FATOS).
   * - JOB 4: Transformação dos pedidos do 99Food (medidas padronizadas + ZERA FATOS).
   * - JOB 5: Carga da FATO_PEDIDO (substituição por chaves estrangeiras).
   * - JOB 6: Criação da FATO_META (estrutura do modelo; sem fonte nas plataformas).
   * - JOB 7: Validação da carga: 3 conferências contábeis + 3 conferências de integridade.
   *
   * Etapa 7: a carga pode trazer só um dos canais. As conferências contábeis do canal ausente
   * ficam como "NÃO SE APLICA" (não contam como aprovadas nem como falhas).
   *
   * @param {Object} src - Fontes de dados {ifood, n99}: linhas dos relatórios "Dados do pedido".
   * @returns {Object} {tabelas, log, resumo, validacao, problemas, falhas, canais}.
   * @throws {Error} Se nenhum canal tiver pedidos ou não for possível ler as datas dos pedidos.
   */
  function executarETL(src) {
    const LOG = [],
      PROB = [],
      VAL = [];

    /** Retorna hora formatada HH:MM:SS para carimbo no log de execução */
    const horaLog = () => new Date().toTimeString().slice(0, 8);
    const log = (m) => LOG.push(`[${horaLog()}] ${m}`);

    /** Registra um problema de Data Quality na tabela de controle */
    const problema = (fonte, desc, trat) => {
      PROB.push([fonte, desc, trat]);
      log(`PROBLEMA [${fonte}] ${desc} -> ${trat}`);
    };

    /** Registra o resultado de uma validação automatizada */
    const valida = (teste, esp, obt, ok) => {
      VAL.push([teste, String(esp), String(obt), ok ? "OK" : "FALHA"]);
      log(
        `VALIDACAO ${ok ? "OK " : "FALHA"} | ${teste} | esperado=${esp} obtido=${obt}`,
      );
    };

    /** Conferência que não se aplica a esta carga (canal sem relatório) */
    const naoSeAplica = (teste, motivo) => {
      VAL.push([teste, "-", "-", NAO_SE_APLICA]);
      log(`VALIDACAO N/A | ${teste} | esperado=- obtido=- (${motivo})`);
    };

    /**
     * Deduplica linhas por chave primária, mantendo a 1ª ocorrência encontrada
     * e registrando alerta de qualidade caso encontre IDs duplicados.
     */
    const unico = (linhas, chave, nome) => {
      const v = new Set(),
        o = [];
      for (const l of linhas) {
        if (v.has(l[chave])) continue;
        v.add(l[chave]);
        o.push(l);
      }
      if (o.length < linhas.length)
        problema(
          nome,
          "IDs de pedido duplicados",
          "mantida a primeira ocorrência",
        );
      return o;
    };

    log("INICIO DO ETL - DeliView (modelo dimensional Etapa 5 v2)");

    // ========================================================================
    // JOB 0 - EXTRAÇÃO & DEDUPLICAÇÃO
    // Entrada : relatórios "Dados do pedido" do iFood e do 99Food.
    // Saída   : listas de pedidos sem IDs repetidos (1 linha = 1 pedido).
    // Regra   : se o mesmo pedido aparecer em dois arquivos (períodos que se
    //           sobrepõem), vale a primeira ocorrência.
    // ========================================================================
    log("JOB 0 - EXTRACAO");
    const ifood = unico(src.ifood, "ID COMPLETO DO PEDIDO", "iFood pedido"),
      n99 = unico(src.n99, "ID do pedido", "99Food pedido");
    log(`  ifood_pedidos: ${ifood.length} | 99_pedidos: ${n99.length}`);

    if (!ifood.length && !n99.length)
      throw new Error("envie o relatório de pedidos de pelo menos uma plataforma (iFood ou 99Food)");
    if (!ifood.length || !n99.length) {
      const so = ifood.length ? "iFood" : "99Food",
        falta = ifood.length ? "99Food" : "iFood";
      problema(
        `${falta} (Relatório)`,
        `Carga só com pedidos do ${so}`,
        `Pedidos do ${falta} já gravados continuam no banco; as conferências contábeis do ${falta} não se aplicam.`,
      );
    }

    // Consolida todas as datas encontradas para calcular a abrangência temporal
    const idsTempo = [
      ...ifood.map((r) => dIfood(r["DATA E HORA DO PEDIDO"])),
      ...n99.map((r) => d99(r["Data"])),
    ].filter(Boolean);

    if (!idsTempo.length)
      throw new Error("não foi possível ler as datas dos pedidos");

    // ========================================================================
    // JOB 1 - DIM_TEMPO (calendário contínuo, grão = 1 dia)
    // Colunas (iguais ao diagrama): ID_TEMPO, DATA, ANO, SEMESTRE, TRIMESTRE,
    //   MES, NOME_MES, DIA, DIA_SEMANA, NOME_DIA_SEMANA, FIM_DE_SEMANA.
    // Cobre de 01/01 do menor ano até 31/12 do maior ano encontrados nos
    // pedidos, para que toda FK de FATO_PEDIDO/FATO_META encontre o seu dia.
    // DIA_SEMANA: 1 = segunda-feira ... 7 = domingo. FIM_DE_SEMANA = sáb/dom.
    // ========================================================================
    const anoMin = Math.floor(Math.min(...idsTempo) / 10000),
      anoMax = Math.floor(Math.max(...idsTempo) / 10000);
    log(`JOB 1 - DIM_TEMPO (${anoMin} a ${anoMax})`);

    const meses = [
      "janeiro", "fevereiro", "março", "abril", "maio", "junho",
      "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
    ];
    const dias = [
      "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira",
      "sexta-feira", "sábado", "domingo",
    ];
    const tempo = [];

    for (
      let d = new Date(Date.UTC(anoMin, 0, 1));
      d <= new Date(Date.UTC(anoMax, 11, 31));
      d = new Date(d.getTime() + 864e5) // +24 h
    ) {
      const ds = ((d.getUTCDay() + 6) % 7) + 1, // 1 = segunda ... 7 = domingo
        m = d.getUTCMonth() + 1;
      tempo.push([
        ymd(d),               // ID_TEMPO (PK, ex.: 20260915)
        iso(d),               // DATA
        d.getUTCFullYear(),   // ANO
        m <= 6 ? 1 : 2,       // SEMESTRE
        Math.ceil(m / 3),     // TRIMESTRE
        m,                    // MES
        meses[m - 1],         // NOME_MES
        d.getUTCDate(),       // DIA
        ds,                   // DIA_SEMANA
        dias[ds - 1],         // NOME_DIA_SEMANA
        ds >= 6,              // FIM_DE_SEMANA
      ]);
    }

    // ========================================================================
    // JOB 2 - DIMENSÕES DE NEGÓCIO
    // DIM_CANAL(ID_CANAL, NOME_CANAL, TIPO_CANAL)
    // DIM_STATUS(ID_STATUS, STATUS, CONSIDERA_VENDA)
    // DIM_PAGAMENTO(ID_PAGAMENTO, FORMA_PAGAMENTO)
    // DIM_TIPO_ENTREGA(ID_TIPO_ENTREGA, TIPO_ENTREGA)
    // ========================================================================
    log("JOB 2 - DIM_CANAL, DIM_STATUS, DIM_PAGAMENTO, DIM_TIPO_ENTREGA");

    const canal = [
      [1, "iFood", "Aplicativo de delivery"],
      [2, "99Food", "Aplicativo de delivery"],
    ];

    const status = [
      [1, "CONCLUIDO", true],  // CONSIDERA_VENDA = Sim: entra nos totais de faturamento
      [2, "CANCELADO", false], // CONSIDERA_VENDA = Não
    ];

    // Uma linha por forma de pagamento distinta encontrada nos dois canais
    const pagSet = new Set([
      ...ifood.map((r) => formaPagamento(r["FORMA DE PAGAMENTO"])),
      ...n99.map((r) => formaPagamento(r["Forma de pagamento"])),
    ]);
    const pag = [...pagSet].sort().map((f, i) => [i + 1, f]);
    if (pagSet.has("Outros"))
      problema(
        "iFood / 99Food (Pagamento)",
        "Forma de pagamento não reconhecida",
        "Classificada como Outros; incluir a nova forma em formaPagamento().",
      );

    const ent = [
      [1, "Entrega parceira iFood"],
      [2, "Entrega da plataforma (99Food)"],
    ];

    // ========================================================================
    // JOB 3 - TRANSFORMAÇÃO DOS PEDIDOS DO iFood
    // Leva cada linha do relatório para as medidas padronizadas do modelo:
    //   bruto   <- VALOR DOS ITENS (R$)                          (nunca é zerado)
    //   desc    <- INCENTIVO PROMOCIONAL da LOJA + da REDE + do IFOOD
    //   motoboy <- 0 (entrega parceira: a taxa de entrega é cobrada do cliente
    //              e repassada à logística; não há custo de motoboy para a loja)
    //   taxas   <- |TAXAS E COMISSOES (R$)|
    //   pago    <- TOTAL PAGO PELO CLIENTE (R$)
    //   liq     <- VALOR LIQUIDO (R$)
    // Campos auxiliares (NÃO vão para o Data Mart; só servem à conferência do
    // JOB 7): descLoja, descPlat, entregaCli e servico.
    // ========================================================================
    log("JOB 3 - TRANSFORMACAO iFood (pedidos)");
    const A = ifood.map((x) => {
      const sts = String(x["STATUS FINAL DO PEDIDO"]).trim().toUpperCase();
      const isCanc = sts === "CANCELADO";

      // REGRA ZERA FATOS: cancelado mantém só o bruto; todo o resto vai a 0
      const z = (v) => (isCanc ? 0 : v);
      const descLoja = z(
        num(x["INCENTIVO PROMOCIONAL DA LOJA (R$)"]) +
          num(x["INCENTIVO PROMOCIONAL DA REDE (R$)"]),
      );
      const descPlat = z(num(x["INCENTIVO PROMOCIONAL DO IFOOD (R$)"]));

      return {
        id: x["ID COMPLETO DO PEDIDO"],
        canal: "iFood",
        tempo: dIfood(x["DATA E HORA DO PEDIDO"]),
        status: sts,
        pag: formaPagamento(x["FORMA DE PAGAMENTO"]),
        ent: "Entrega parceira iFood",
        bruto: num(x["VALOR DOS ITENS (R$)"]),
        desc: descLoja + descPlat,
        motoboy: 0,
        taxas: z(Math.abs(num(x["TAXAS E COMISSOES (R$)"]))),
        pago: z(num(x["TOTAL PAGO PELO CLIENTE (R$)"])),
        liq: z(num(x["VALOR LIQUIDO (R$)"])),
        // auxiliares de conferência
        descLoja,
        descPlat,
        entregaCli: z(num(x["TAXA DE ENTREGA PAGA PELO CLIENTE (R$)"])),
        servico: z(num(x["TAXA DE SERVIÇO (R$)"])),
      };
    });

    // ========================================================================
    // JOB 4 - TRANSFORMAÇÃO DOS PEDIDOS DO 99Food
    // Mesmas medidas, a partir das colunas do 99Food:
    //   status  <- CANCELADO se "Horário do cancelamento" estiver preenchido
    //   bruto   <- Preço original do item                        (nunca é zerado)
    //   desc    <- Despesas de marketing (= Preço original - Receita de vendas;
    //              "Recompensas da plataforma" é bônus à loja e não é desconto)
    //   motoboy <- Custos logísticos
    //   taxas   <- Despesas de comissão + Taxas de processamento de pagamento
    //   pago    <- Receita de vendas
    //   liq     <- Receita real da loja
    // ========================================================================
    log("JOB 4 - TRANSFORMACAO 99Food (pedidos)");
    const B = n99.map((x) => {
      const isCanc =
        String(x["Horário do cancelamento"] ?? "").trim() !== "";
      const z = (v) => (isCanc ? 0 : v); // REGRA ZERA FATOS

      return {
        id: x["ID do pedido"],
        canal: "99Food",
        tempo: d99(x["Data"]),
        status: isCanc ? "CANCELADO" : "CONCLUIDO",
        pag: formaPagamento(x["Forma de pagamento"]),
        ent: "Entrega da plataforma (99Food)",
        bruto: num(x["Preço original do item"]),
        desc: z(num(x["Despesas de marketing"])),
        motoboy: z(num(x["Custos logísticos"])),
        taxas: z(
          num(x["Despesas de comissão"]) +
            num(x["Taxas de processamento de pagamento"]),
        ),
        pago: z(num(x["Receita de vendas"])),
        liq: z(num(x["Receita real da loja"])),
      };
    });

    problema(
      "99Food / iFood (Cancelados)",
      "Pedidos cancelados distorciam agregacoes na fato",
      "Regra ZERA FATOS aplicada a todas as metricas (exceto bruto) nos dois canais.",
    );

    // ========================================================================
    // JOB 5 - CARGA DA FATO_PEDIDO (Estrela 1)
    // Grão: 1 linha por pedido. ID_PEDIDO é a chave (PK) e dimensão degenerada.
    // Cada texto é trocado pela chave substituta da dimensão (FK).
    // Colunas, na ordem do diagrama: ID_PEDIDO, ID_CANAL, ID_TEMPO, ID_STATUS,
    //   ID_PAGAMENTO, ID_TIPO_ENTREGA, VALOR_BRUTO_PEDIDO, VALOR_DESCONTOS,
    //   TAXA_MOTOBOY, VALOR_TAXAS, VALOR_TOTAL_PAGO, VALOR_LIQUIDO.
    // ========================================================================
    log("JOB 5 - CARGA DA FATO_PEDIDO");
    const base = [...A, ...B];

    // Dicionários chave de negócio -> chave substituta (FK)
    const idCanal = Object.fromEntries(canal.map((c) => [c[1], c[0]])),
      idSt = Object.fromEntries(status.map((s) => [s[1], s[0]])),
      idPag = Object.fromEntries(pag.map((p) => [p[1], p[0]])),
      idEnt = Object.fromEntries(ent.map((e) => [e[1], e[0]]));

    const fp = base.map((b) => [
      b.id,
      idCanal[b.canal],
      b.tempo,
      idSt[b.status],
      idPag[b.pag],
      idEnt[b.ent],
      r2(b.bruto),
      r2(b.desc),
      r2(b.motoboy),
      r2(b.taxas),
      r2(b.pago),
      r2(b.liq),
    ]);

    // ========================================================================
    // JOB 6 - FATO_META (Estrela 2)
    // Colunas do diagrama: ID_META, ID_TEMPO, QUANTIDADE, META_VALOR.
    // As exportações do iFood e do 99Food NÃO trazem metas. A tabela é criada
    // vazia, com a estrutura do modelo, e deve ser preenchida quando o parceiro
    // informar as metas (por dia/mês). Liga-se às vendas pela DIM_TEMPO.
    // ========================================================================
    log("JOB 6 - FATO_META (estrutura do modelo, sem carga)");
    const fm = [];
    problema(
      "FATO_META",
      "As plataformas não exportam metas de venda",
      "Tabela criada vazia, com a estrutura do modelo; carga manual quando o parceiro definir as metas.",
    );

    // ========================================================================
    // JOB 7 - VALIDAÇÃO DA CARGA
    // (a) Conferências contábeis: as medidas devem fechar a conta de cada canal.
    // (b) Conferências de integridade: o resultado deve respeitar o modelo.
    // ========================================================================
    log("JOB 7 - VALIDACAO DA CARGA");

    // (a1) iFood: Líquido = Bruto - Desconto da loja - Taxas
    const I = A.filter((b) => b.status === "CONCLUIDO");
    const C_A1 = "iFood: liquido = itens (bruto) - desconto loja - taxas",
      C_A2 = "iFood: pago cliente = itens + entrega + servico - descontos totais",
      C_A3 = "99Food: liquido = receita de vendas - taxas e comissoes - custos logísticos";
    let d;
    if (A.length) {
      d = I.filter(
        (b) => Math.abs(b.bruto - b.descLoja - b.taxas - b.liq) > 0.011,
      ).length;
      valida(C_A1, 0, d, d === 0);

      // (a2) iFood: Pago pelo cliente = Bruto + Entrega + Serviço - Descontos totais
      d = I.filter(
        (b) =>
          Math.abs(b.bruto + b.entregaCli + b.servico - b.desc - b.pago) >
          0.011,
      ).length;
      valida(C_A2, 0, d, d === 0);
    } else {
      naoSeAplica(C_A1, "carga sem pedidos do iFood");
      naoSeAplica(C_A2, "carga sem pedidos do iFood");
    }

    // (a3) 99Food: Líquido = Receita de vendas - Taxas - Custos logísticos (TAXA_MOTOBOY)
    const c99 = B.filter((b) => b.status === "CONCLUIDO");
    if (B.length) {
      d = c99.filter(
        (b) => Math.abs(b.pago - b.taxas - b.motoboy - b.liq) > 0.011,
      ).length;
      valida(C_A3, 0, d, d === 0);
    } else {
      naoSeAplica(C_A3, "carga sem pedidos do 99Food");
    }

    // (b1) Chave primária: ID_PEDIDO não pode se repetir na FATO_PEDIDO
    d = fp.length - new Set(fp.map((r) => r[0])).size;
    valida("FATO_PEDIDO: ID_PEDIDO unico (PK)", 0, d, d === 0);

    // (b2) Integridade referencial: toda FK deve existir na sua dimensão
    const ids = (t, i = 0) => new Set(t.map((r) => r[i]));
    const sT = ids(tempo), sC = ids(canal), sS = ids(status),
      sP = ids(pag), sE = ids(ent);
    d = fp.filter(
      (r) =>
        !sC.has(r[1]) || !sT.has(r[2]) || !sS.has(r[3]) ||
        !sP.has(r[4]) || !sE.has(r[5]),
    ).length;
    valida(
      "FATO_PEDIDO: toda FK existe na dimensao (canal, tempo, status, pagamento, entrega)",
      0, d, d === 0,
    );

    // (b3) ZERA FATOS: cancelado deve ter descontos, motoboy, taxas, pago e líquido = 0
    d = fp.filter(
      (r) => r[3] === 2 && [7, 8, 9, 10, 11].some((i) => r[i] !== 0),
    ).length;
    valida(
      "FATO_PEDIDO: cancelados com medidas zeradas (exceto valor bruto)",
      0, d, d === 0,
    );

    // Resumo financeiro exibido no painel (somente pedidos concluídos)
    const resumo = {};
    for (const c of ["iFood", "99Food"]) {
      const t = base.filter((b) => b.canal === c),
        v = t.filter((b) => b.status === "CONCLUIDO");
      resumo[c] = {
        pedidos: t.length,
        concluidos: v.length,
        cancelados: t.length - v.length,
        pago: v.reduce((a, b) => a + b.pago, 0),
        taxas: v.reduce((a, b) => a + b.taxas, 0),
      };
    }

    const falhas = VAL.filter((v) => v[3] === "FALHA").length,
      aplicaveis = VAL.filter((v) => v[3] !== NAO_SE_APLICA).length;
    log(`FIM DO ETL - ${aplicaveis - falhas}/${aplicaveis} validacoes OK`);

    // Etapa 7: canais presentes nesta carga e o período (datas ISO) dos pedidos de cada um
    const canais = {};
    for (const c of ["iFood", "99Food"]) {
      const datas = base.filter((b) => b.canal === c && b.tempo).map((b) => b.tempo);
      canais[c] = datas.length
        ? {
            pedidos: datas.length,
            inicio: isoDeId(Math.min(...datas)),
            fim: isoDeId(Math.max(...datas)),
          }
        : null;
    }

    // Tabelas finais do Data Mart (nomes e colunas idênticos ao diagrama v2)
    const tabelas = [
      {
        nome: "DIM_TEMPO",
        cab: [
          "ID_TEMPO", "DATA", "ANO", "SEMESTRE", "TRIMESTRE", "MES",
          "NOME_MES", "DIA", "DIA_SEMANA", "NOME_DIA_SEMANA", "FIM_DE_SEMANA",
        ],
        linhas: tempo,
      },
      {
        nome: "DIM_CANAL",
        cab: ["ID_CANAL", "NOME_CANAL", "TIPO_CANAL"],
        linhas: canal,
      },
      {
        nome: "DIM_STATUS",
        cab: ["ID_STATUS", "STATUS", "CONSIDERA_VENDA"],
        linhas: status,
      },
      {
        nome: "DIM_PAGAMENTO",
        cab: ["ID_PAGAMENTO", "FORMA_PAGAMENTO"],
        linhas: pag,
      },
      {
        nome: "DIM_TIPO_ENTREGA",
        cab: ["ID_TIPO_ENTREGA", "TIPO_ENTREGA"],
        linhas: ent,
      },
      {
        nome: "FATO_PEDIDO",
        cab: [
          "ID_PEDIDO", "ID_CANAL", "ID_TEMPO", "ID_STATUS", "ID_PAGAMENTO",
          "ID_TIPO_ENTREGA", "VALOR_BRUTO_PEDIDO", "VALOR_DESCONTOS",
          "TAXA_MOTOBOY", "VALOR_TAXAS", "VALOR_TOTAL_PAGO", "VALOR_LIQUIDO",
        ],
        linhas: fp,
      },
      {
        nome: "FATO_META",
        cab: ["ID_META", "ID_TEMPO", "QUANTIDADE", "META_VALOR"],
        linhas: fm,
      },
      {
        nome: "PROBLEMAS_E_TRATAMENTOS",
        cab: ["FONTE", "PROBLEMA ENCONTRADO", "TRATAMENTO NO ETL"],
        linhas: PROB,
      },
      {
        nome: "VALIDACAO_DA_CARGA",
        cab: ["TESTE", "ESPERADO", "OBTIDO", "RESULTADO"],
        linhas: VAL,
      },
    ];

    return {
      tabelas,
      log: LOG,
      resumo,
      validacao: VAL,
      problemas: PROB,
      falhas,
      canais,
    };
  }

  /**
   * Metadados dos 2 relatórios que alimentam o ETL.
   * O modelo v2 só é alimentado pelos relatórios "Dados do pedido" dos dois canais.
   * Etapa 7: basta um deles por carga (o outro canal pode vir numa carga separada).
   */
  const TIPOS = [
    {
      id: "ifood",
      nome: "Pedidos do iFood",
      dica: "Relatório “Dados do pedido” do iFood",
      multi: true,
    },
    {
      id: "n99",
      nome: "Pedidos do 99Food",
      dica: "Relatório “Dados do pedido” do 99Food",
      multi: true,
    },
  ];

  /**
   * Relatórios reconhecidos, mas que NÃO fazem parte do modelo v2 (não alimentam
   * nenhuma tabela). Se forem soltos na tela, são ignorados com um aviso claro.
   */
  const IGNORADOS = {
    conc: "Conciliação do iFood (FATO_LANCAMENTO não existe no modelo v2)",
    loja: "Dados da loja do 99Food (não existe fato de loja no modelo v2)",
    custos: "Planilha de custos (DIM_PRODUTO foi retirada do modelo v2)",
  };

  /**
   * Inspeciona os cabeçalhos de um arquivo Excel e identifica automaticamente a qual relatório ele pertence.
   *
   * @param {Object} wb - Pasta de trabalho retornada por lerXlsx().
   * @returns {string|null} "ifood", "n99", "conc", "loja", "custos" ou null se não reconhecido.
   */
  function classificar(wb) {
    if (wb.abas["Cardápio"] && wb.abas["Bebidas"]) return "custos";
    // Etapa 7: layout atual da planilha de custos (continua ignorada pelo modelo v2)
    if (wb.abas["Ingredientes"] && wb.abas["CUSTOS_BI"]) return "custos";
    const cab = (wb.abas[wb.ordem[0]]?.[0] || []).map((x) =>
      String(x).trim(),
    );
    const tem = (...c) => c.every((x) => cab.includes(x));
    if (tem("ID COMPLETO DO PEDIDO", "VALOR LIQUIDO (R$)")) return "ifood";
    if (tem("pedido_associado_ifood", "tipo_lancamento")) return "conc";
    if (tem("ID do pedido", "Horário do cancelamento")) return "n99";
    if (tem("Total de vendas realizadas", "Receita total de vendas"))
      return "loja";
    return null;
  }

  /** Mescla múltiplos relatórios carregados em uma lista única de objetos associativos */
  const juntar = (lista) =>
    lista.flatMap((x) => comoObjetos(x.wb.abas[x.wb.ordem[0]]));

  /* ============================================================================
   * 5. API DA ETAPA 7 (sem DOM): leitura dos arquivos, execução e tabela de vendas
   * ============================================================================ */

  /** Formatadores regionais (copiados da referência) */
  const BRL = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }),
    INT = new Intl.NumberFormat("pt-BR");

  /** Nome amigável de cada tipo devolvido por classificar() */
  const NOMES_TIPO = {
    ifood: "Pedidos do iFood",
    n99: "Pedidos do 99Food",
    conc: "Conciliação do iFood",
    loja: "Dados da loja do 99Food",
    custos: "Planilha de custos",
  };

  /**
   * Lê e classifica arquivos .xlsx. Aceita File/Blob (com .name) ou { nome, bytes }.
   * Devolve, para cada arquivo: { nome, tipo, rotulo, usado, aviso, erro, wb }.
   *   usado = true  -> alimenta o ETL (pedidos do iFood ou do 99Food)
   *   usado = false -> reconhecido mas fora do modelo v2 (aviso), ou não reconhecido/erro
   */
  async function lerArquivos(arquivos) {
    const saida = [];
    for (const f of arquivos) {
      const nome = f.nome || f.name || "arquivo.xlsx";
      const item = { nome, tipo: null, rotulo: "", usado: false, aviso: "", erro: "", wb: null };
      try {
        if (!/\.xlsx$/i.test(nome)) throw new Error("apenas arquivos .xlsx são aceitos");
        // Atenção: Blob.prototype.bytes() existe nos navegadores novos, então testa Blob primeiro
        const bytes = typeof Blob !== "undefined" && f instanceof Blob ? await f.arrayBuffer() : f.bytes;
        const buf = ArrayBuffer.isView(bytes)
          ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
          : bytes;
        item.wb = await BE.xlsx.lerXlsx(buf);
        item.tipo = classificar(item.wb);
        if (!item.tipo) {
          item.erro = "não reconhecido";
        } else {
          item.rotulo = NOMES_TIPO[item.tipo];
          item.usado = !IGNORADOS[item.tipo];
          if (!item.usado) item.aviso = "Reconhecido, mas não entra no modelo v2: " + IGNORADOS[item.tipo] + ".";
        }
      } catch (e) {
        item.erro = e && e.message ? e.message : String(e);
      }
      saida.push(item);
    }
    return saida;
  }

  /**
   * Executa o ETL. Entrada: o src da referência ({ ifood: [...], n99: [...] } já como objetos)
   * ou a lista devolvida por lerArquivos() (usa só os arquivos de pedidos).
   * Devolve o retorno original de executarETL + { conferencias, problemas, resumoCanal, lidos }.
   */
  function executar(entrada) {
    const src = Array.isArray(entrada)
      ? {
          ifood: juntar(entrada.filter((a) => a.tipo === "ifood")),
          n99: juntar(entrada.filter((a) => a.tipo === "n99")),
        }
      : entrada;
    const R = executarETL(src);
    return Object.assign({}, R, {
      conferencias: R.validacao.map((v) => ({
        teste: v[0],
        esperado: v[1],
        obtido: v[2],
        resultado: v[3],
        ok: v[3] === "OK",
        naoSeAplica: v[3] === NAO_SE_APLICA,
      })),
      aplicaveis: R.validacao.filter((v) => v[3] !== NAO_SE_APLICA).length,
      problemasLinhas: R.problemas,
      problemas: R.problemas.map((p) => ({ fonte: p[0], problema: p[1], tratamento: p[2] })),
      resumoCanal: R.resumo,
      lidos: { ifood: src.ifood.length, n99: src.n99.length },
    });
  }

  /**
   * Tabela "Vendas por plataforma" exatamente como a referência a monta em rodar()
   * (mesmos textos, fórmulas e formatação). Recebe resumoCanal ({ iFood, 99Food }).
   */
  function tabelaVendas(resumo) {
    const a = resumo.iFood,
      b = resumo["99Food"];

    // Funções auxiliares para cálculo de percentual de cancelamento e ticket médio
    const tx = (r) =>
      r.pedidos
        ? ((r.cancelados / r.pedidos) * 100).toFixed(1).replace(".", ",") +
          "%"
        : "-";
    const tk = (r) =>
      r.concluidos ? BRL.format(r.pago / r.concluidos) : "-";

    const tot = {
      concluidos: a.concluidos + b.concluidos,
      pedidos: a.pedidos + b.pedidos,
      cancelados: a.cancelados + b.cancelados,
      pago: a.pago + b.pago,
      taxas: a.taxas + b.taxas,
    };

    return {
      cab: ["", "iFood", "99Food", "Total"],
      linhas: [
        [
          "Pedidos concluídos",
          INT.format(a.concluidos),
          INT.format(b.concluidos),
          INT.format(tot.concluidos),
        ],
        [
          "Cancelamentos",
          `${INT.format(a.cancelados)} (${tx(a)})`,
          `${INT.format(b.cancelados)} (${tx(b)})`,
          `${INT.format(tot.cancelados)} (${tx(tot)})`,
        ],
        [
          "Valor pago pelos clientes",
          BRL.format(a.pago),
          BRL.format(b.pago),
          BRL.format(tot.pago),
        ],
        ["Ticket médio", tk(a), tk(b), tk(tot)],
        [
          "Taxas e comissões operacionais",
          BRL.format(a.taxas),
          BRL.format(b.taxas),
          BRL.format(tot.taxas),
        ],
      ],
      numericas: [1, 2, 3],
    };
  }

  BE.etl = {
    classificar,
    executar,
    executarETL,
    lerArquivos,
    juntar,
    tabelaVendas,
    TIPOS,
    IGNORADOS,
    NAO_SE_APLICA,
    NOMES_TIPO,
    BRL,
    INT,
    num,
    r2,
    ymd,
    iso,
    dIfood,
    d99,
    formaPagamento,
  };
})(window.BE);
