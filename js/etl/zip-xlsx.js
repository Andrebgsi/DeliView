/*
 * Leitura e escrita de .xlsx e .zip, sem bibliotecas.
 * Código EXTRAÍDO de referencia/etl-etapa5.html (Etapa 5), seções 1 e 2, sem mudança de lógica.
 * Exposto em BE.xlsx: crc32, inflar, deflar, lerZip, lerXlsx, comoObjetos, criarZip, criarXlsx,
 * colIdx, letra, xml, esc, enc, dec.
 * Acréscimos da Etapa 7 (sem mudar o .xlsx): criarZip({ comprimir: true }) com deflate,
 * deflar() e lerZip()._lerBytes() para o backup .zip (js/backup.js).
 */
window.BE = window.BE || {};

(function (BE) {
  "use strict";

  /* ============================================================================
   * 1. CAMADA DE BAIXO NÍVEL: DECOMPRESSÃO E PARSER OPENXML / ZIP
   * ============================================================================ */

  /** Encoders nativos para conversão de texto UTF-8 em buffers de bytes e vice-versa */
  const enc = new TextEncoder(),
    dec = new TextDecoder("utf-8");

  /**
   * Descompacta um fluxo de bytes comprimido com o algoritmo DEFLATE (RFC 1951).
   * Utiliza a API nativa do navegador DecompressionStream, dispensando bibliotecas como pako ou zlib.
   *
   * @async
   * @param {Uint8Array} bytes - Array de bytes comprimidos brutos extraídos do arquivo ZIP.
   * @returns {Promise<Uint8Array>} Promessa com os bytes descompactados em memória.
   * @example
   * const xmlBytes = await inflar(bytesComprimidos);
   */
  async function inflar(bytes) {
    const s = new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  /**
   * Lê e decodifica a estrutura binária de um arquivo no formato PKZIP (.xlsx).
   * Varre o arquivo para localizar o registro de fim do diretório central (End of Central Directory),
   * mapeando os arquivos internos para permitir leitura assíncrona sob demanda com descompressão.
   *
   * @async
   * @param {ArrayBuffer} buf - Conteúdo binário bruto do arquivo compactado.
   * @returns {Promise<Object>} Dicionário onde cada chave é o nome do arquivo interno e possui o método `_ler(nome)`.
   * @throws {Error} Lança erro caso a assinatura do cabeçalho PKZIP (0x06054b50) não seja encontrada.
   */
  async function lerZip(buf) {
    const u = new Uint8Array(buf),
      dv = new DataView(buf);

    // Varre de trás para frente procurando a assinatura do registro 'End of Central Directory' (0x06054b50)
    let e = u.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error("não é um arquivo .xlsx válido");

    // Extrai a contagem de entradas e o ponteiro para o início do Diretório Central
    const n = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const out = {};

    // Itera sobre cada cabeçalho de arquivo no Diretório Central
    for (let i = 0; i < n; i++) {
      const met = dv.getUint16(p + 10, true), // Método de compressão (0 = armazenado, 8 = deflate)
        cs = dv.getUint32(p + 20, true),      // Tamanho comprimido (Compressed Size)
        nl = dv.getUint16(p + 28, true),      // Comprimento do nome do arquivo
        el = dv.getUint16(p + 30, true),      // Comprimento do campo extra
        cl = dv.getUint16(p + 32, true),      // Comprimento do comentário
        lo = dv.getUint32(p + 42, true);      // Offset do cabeçalho local do arquivo

      // Decodifica o caminho interno do arquivo (ex.: "xl/workbook.xml")
      const nome = dec.decode(u.subarray(p + 46, p + 46 + nl));

      // Calcula onde os dados reais do arquivo começam, pulando o cabeçalho local (30 bytes + nomes/extras)
      const ini =
        lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);

      out[nome] = { met, dados: u.subarray(ini, ini + cs) };

      // Salta para o próximo cabeçalho no diretório central
      p += 46 + nl + el + cl;
    }

    /**
     * Método utilitário para ler e descompactar sob demanda um arquivo interno do ZIP como string UTF-8.
     * @param {string} nome - Caminho interno do arquivo (ex.: "xl/sharedStrings.xml").
     * @returns {Promise<string|null>} Conteúdo decodificado ou null se o arquivo não existir.
     */
    out._ler = async (nome) => {
      const f = out[nome];
      if (!f) return null;
      return dec.decode(f.met === 0 ? f.dados : await inflar(f.dados));
    };

    /**
     * Igual a _ler, mas devolve os bytes (para arquivos binários, como o .sqlite do backup).
     * @param {string} nome - Caminho interno do arquivo.
     * @returns {Promise<Uint8Array|null>}
     */
    out._lerBytes = async (nome) => {
      const f = out[nome];
      if (!f || typeof f !== "object" || !f.dados) return null;
      if (f.met === 0) return f.dados.slice();
      if (f.met === 8) return inflar(f.dados);
      throw new Error("método de compressão " + f.met + " não suportado");
    };
    return out;
  }

  /**
   * Utilitário para realizar o parse de uma string XML em uma árvore DOM navegável.
   * @param {string} t - Texto XML a ser interpretado.
   * @returns {Document} Documento XML manipulável com querySelector / getElementsByTagName.
   */
  const xml = (t) => new DOMParser().parseFromString(t, "application/xml");

  /**
   * Converte referências de coordenadas de colunas alfabéticas do Excel em índices numéricos de base zero.
   * Exemplo: "A1" -> 0, "B5" -> 1, "Z3" -> 25, "AA1" -> 26.
   *
   * @param {string} ref - Referência alfanumérica da célula no Excel (ex.: "C12").
   * @returns {number} Índice numérico da coluna (0-based).
   */
  function colIdx(ref) {
    let n = 0;
    // Remove a parte numérica (número da linha), mantendo apenas as letras da coluna
    for (const ch of ref.replace(/[0-9]/g, ""))
      n = n * 26 + ch.charCodeAt(0) - 64; // Cálculo posicional em base 26
    return n - 1;
  }

  /**
   * Interpreta um arquivo Excel (.xlsx) OpenXML binário e extrai todas as suas abas e linhas de dados.
   * Lê a estrutura interna de pastas do Excel, processa as strings compartilhadas (Shared Strings Table)
   * e alinha as células nas colunas corretas de acordo com a notação A1, B1, C1.
   *
   * @async
   * @param {ArrayBuffer} buf - Buffer de memória contendo os bytes do arquivo .xlsx.
   * @returns {Promise<{abas: Object<string, Array<Array<string>>>, ordem: string[]}>}
   * Objeto contendo o mapa de abas (matrizes de strings) e a ordem original das abas.
   */
  async function lerXlsx(buf) {
    const z = await lerZip(buf),
      wb = xml(await z._ler("xl/workbook.xml")),
      rels = xml(await z._ler("xl/_rels/workbook.xml.rels"));

    // Mapeia relacionamentos rId -> caminho do arquivo da aba (ex.: rId1 -> worksheets/sheet1.xml)
    const alvo = {};
    for (const r of rels.getElementsByTagName("Relationship"))
      alvo[r.getAttribute("Id")] = r.getAttribute("Target");

    // Carrega a Shared Strings Table (tabela onde o Excel guarda strings para não repetir textos)
    let sst = [];
    const sstTxt = await z._ler("xl/sharedStrings.xml");
    if (sstTxt)
      for (const si of xml(sstTxt).getElementsByTagName("si"))
        sst.push(
          [...si.getElementsByTagName("t")]
            .map((t) => t.textContent)
            .join(""),
        );

    const abas = {},
      ordem = [];

    // Itera sobre as abas declaradas no workbook
    for (const s of wb.getElementsByTagName("sheet")) {
      const nome = s.getAttribute("name"),
        rid =
          s.getAttribute("r:id") ||
          s.getAttributeNS(
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
            "id",
          );
      let t = alvo[rid];
      t = t.startsWith("/") ? t.slice(1) : "xl/" + t;
      const doc = xml(await z._ler(t)),
        linhas = [];

      // Percorre as linhas (<row>) e células (<c>) da planilha
      for (const row of doc.getElementsByTagName("row")) {
        const r = [];
        for (const c of row.getElementsByTagName("c")) {
          const i = colIdx(c.getAttribute("r")), // Coluna 0-based
            tp = c.getAttribute("t"),            // Tipo de dado (s = shared string, inlineStr, etc.)
            v = c.getElementsByTagName("v")[0];  // Valor bruto do nó <v>

          let val = "";
          if (tp === "s") val = v ? (sst[+v.textContent] ?? "") : "";
          else if (tp === "inlineStr")
            val = [...c.getElementsByTagName("t")]
              .map((x) => x.textContent)
              .join("");
          else val = v ? v.textContent : "";

          // Preenche lacunas de colunas vazias anteriores para manter a indexação alinhada
          while (r.length < i) r.push("");
          r[i] = val;
        }
        linhas.push(r);
      }
      abas[nome] = linhas;
      ordem.push(nome);
    }
    return { abas, ordem };
  }

  /**
   * Converte uma matriz bidimensional (linhas e colunas) em uma lista de objetos JavaScript estruturados,
   * utilizando os valores da primeira linha como chaves dos objetos.
   *
   * @param {Array<Array<any>>} linhas - Matriz onde a linha 0 representa o cabeçalho.
   * @returns {Array<Object>} Lista de registros chave-valor.
   * @example
   * comoObjetos([["Nome", "Idade"], ["Ana", "25"]]) // -> [{ Nome: "Ana", Idade: "25" }]
   */
  function comoObjetos(linhas) {
    if (!linhas || !linhas.length) return [];
    const h = linhas[0].map((x) => String(x).trim());
    return linhas
      .slice(1)
      .filter((r) => r.some((c) => String(c).trim() !== "")) // Remove linhas totalmente vazias
      .map((r) => {
        const o = {};
        h.forEach((k, i) => (o[k] = r[i] ?? ""));
        return o;
      });
  }

  /* ============================================================================
   * 2. CAMADA DE EXPORTAÇÃO: GERADOR BINÁRIO ZIP E OPENXML (.XLSX)
   * ============================================================================ */

  /** Tabela pré-calculada de consulta polinomial para aceleração do cálculo de CRC32 */
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++)
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  /**
   * Calcula o checksum de redundância cíclica de 32 bits (CRC32) de um buffer de bytes.
   * Necessário para a integridade exigida pela especificação do formato PKZIP.
   *
   * @param {Uint8Array} b - Vetor de bytes a ter o hash calculado.
   * @returns {number} Inteiro sem sinal de 32 bits representando o CRC32.
   */
  const crc32 = (b) => {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++)
      c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  /**
   * Comprime bytes com DEFLATE puro (RFC 1951) via CompressionStream("deflate-raw"), o mesmo
   * formato que o método 8 do ZIP espera. Sem a API no navegador, retorna null.
   *
   * @async
   * @param {Uint8Array} bytes - Bytes originais.
   * @returns {Promise<Uint8Array|null>} Bytes comprimidos, ou null se não houver CompressionStream.
   */
  async function deflar(bytes) {
    if (typeof CompressionStream !== "function") return null;
    try {
      const s = new Blob([bytes])
        .stream()
        .pipeThrough(new CompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(s).arrayBuffer());
    } catch (e) {
      return null; // navegador sem suporte a "deflate-raw": grava sem compressão
    }
  }

  /**
   * Monta o binário ZIP a partir de entradas já preparadas (método, CRC e bytes finais).
   * @param {Array<{nome: string, crc: number, metodo: number, dados: Uint8Array, tamanho: number}>} entradas
   * @returns {Blob}
   */
  function montarZip(entradas) {
    const partes = [],
      cd = [];
    let off = 0;

    // Converte data e hora atuais para o formato MS-DOS (armazenamento em bitfields exigido pelo ZIP)
    const d = new Date(),
      hora =
        (d.getHours() << 11) |
        (d.getMinutes() << 5) |
        (d.getSeconds() >> 1),
      dia =
        ((d.getFullYear() - 1980) << 9) |
        ((d.getMonth() + 1) << 5) |
        d.getDate();

    for (const a of entradas) {
      const nome = enc.encode(a.nome),
        L = new DataView(new ArrayBuffer(30)); // Local File Header (30 bytes fixos)

      L.setUint32(0, 0x04034b50, true);       // Assinatura de cabeçalho local
      L.setUint16(4, 20, true);               // Versão mínima necessária (2.0)
      L.setUint16(6, 0x0800, true);           // Flags de uso geral (bit 11 = UTF-8 no nome do arquivo)
      L.setUint16(8, a.metodo, true);         // Método de compressão (0 = Store, 8 = Deflate)
      L.setUint16(10, hora, true);            // Hora MS-DOS
      L.setUint16(12, dia, true);             // Data MS-DOS
      L.setUint32(14, a.crc, true);           // Checksum CRC-32 (dos bytes originais)
      L.setUint32(18, a.dados.length, true);  // Tamanho comprimido
      L.setUint32(22, a.tamanho, true);       // Tamanho descomprimido
      L.setUint16(26, nome.length, true);     // Comprimento do nome do arquivo
      partes.push(new Uint8Array(L.buffer), nome, a.dados);

      // Central Directory Header (46 bytes fixos)
      const C = new DataView(new ArrayBuffer(46));
      C.setUint32(0, 0x02014b50, true);       // Assinatura do diretório central
      C.setUint16(4, 20, true);               // Versão que criou
      C.setUint16(6, 20, true);               // Versão necessária para extrair
      C.setUint16(8, 0x0800, true);           // Flags UTF-8
      C.setUint16(10, a.metodo, true);        // Método de compressão
      C.setUint16(12, hora, true);            // Hora
      C.setUint16(14, dia, true);             // Data
      C.setUint32(16, a.crc, true);           // CRC-32
      C.setUint32(20, a.dados.length, true);  // Tamanho comprimido
      C.setUint32(24, a.tamanho, true);       // Tamanho descomprimido
      C.setUint16(28, nome.length, true);     // Comprimento do nome
      C.setUint32(42, off, true);             // Offset relativo do cabeçalho local
      cd.push(new Uint8Array(C.buffer), nome);

      off += 30 + nome.length + a.dados.length;
    }

    // End of Central Directory Record (22 bytes)
    const tam = cd.reduce((s, x) => s + x.length, 0),
      E = new DataView(new ArrayBuffer(22));
    E.setUint32(0, 0x06054b50, true);         // Assinatura de fim do diretório central
    E.setUint16(8, entradas.length, true);    // Entradas no diretório neste disco
    E.setUint16(10, entradas.length, true);   // Total de entradas no diretório
    E.setUint32(12, tam, true);               // Tamanho do diretório central
    E.setUint32(16, off, true);               // Offset do início do diretório central

    return new Blob([...partes, ...cd, new Uint8Array(E.buffer)]);
  }

  /**
   * Cria um arquivo binário ZIP completo em memória a partir de uma lista de arquivos.
   * Monta os Local File Headers (0x04034b50), Central Directory (0x02014b50)
   * e o End of Central Directory (0x06054b50).
   *
   * Sem opções (uso do .xlsx e do CSV), grava sem compressão (Store / método 0) e retorna o Blob
   * na hora, como na Etapa 5. Com { comprimir: true }, retorna uma Promise<Blob>: cada arquivo
   * é comprimido com deflate (método 8) via CompressionStream; se o navegador não tiver a API,
   * ou se o resultado não ficar menor, o arquivo é gravado sem compressão (método 0).
   *
   * @param {Array<{nome: string, bytes: Uint8Array}>} arquivos - Arquivos a incluir no ZIP.
   * @param {{comprimir?: boolean}} [opcoes]
   * @returns {Blob|Promise<Blob>} Blob do ZIP (Promise quando opcoes.comprimir).
   */
  function criarZip(arquivos, opcoes) {
    const armazenado = (a) => ({
      nome: a.nome, crc: crc32(a.bytes), metodo: 0, dados: a.bytes, tamanho: a.bytes.length,
    });
    if (!(opcoes && opcoes.comprimir)) return montarZip(arquivos.map(armazenado));

    return Promise.all(
      arquivos.map(async (a) => {
        const e = armazenado(a);
        const z = await deflar(a.bytes);
        if (z && z.length < a.bytes.length) {
          e.metodo = 8;
          e.dados = z;
        }
        return e;
      }),
    ).then(montarZip);
  }

  /**
   * Escapa caracteres especiais de XML para evitar quebras sintáticas nos arquivos gerados.
   * @param {any} s - Texto a ser sanitizado.
   * @returns {string} Texto seguro para injeção em tags XML.
   */
  const esc = (s) =>
    String(s)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "") // Remove caracteres de controle ASCII inválidos
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  /**
   * Converte um índice de coluna numérico (0-based) na letra correspondente do Excel.
   * Exemplo: 0 -> "A", 1 -> "B", 25 -> "Z", 26 -> "AA".
   *
   * @param {number} i - Índice da coluna (0-based).
   * @returns {string} Identificador alfabético da coluna.
   */
  const letra = (i) => {
    let s = "";
    i++;
    while (i > 0) {
      const m = (i - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  };

  /**
   * Constrói e empacota um arquivo Excel nativo (.xlsx) a partir de uma lista de tabelas/abas.
   * Gera os metadados OpenXML ([Content_Types].xml, _rels, workbook.xml, styles.xml e worksheets),
   * aplicando estilos como cabeçalho em negrito, colunas com larguras autoajustadas e painel superior congelado.
   *
   * @async
   * @param {Array<{nome: string, cab: string[], linhas: Array<Array<any>>}>} abas - Abas do Excel a gerar.
   * @returns {Promise<Blob>} Blob binário contendo a pasta de trabalho .xlsx pronta para download.
   */
  async function criarXlsx(abas) {
    const NS =
      'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
    const arqs = [];
    const add = (nome, txt) => arqs.push({ nome, bytes: enc.encode(txt) });

    // 1. Tipos de Conteúdo MIME
    add(
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        abas
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join("") +
        "</Types>",
    );

    // 2. Relacionamento Raiz
    add(
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    );

    // 3. Estrutura do Workbook
    add(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
        abas
          .map(
            (a, i) =>
              `<sheet name="${esc(a.nome.replace(/[\[\]:*?\/\\]/g, "_").slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
          )
          .join("") +
        "</sheets></workbook>",
    );

    // 4. Relacionamentos do Workbook
    add(
      "xl/_rels/workbook.xml.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        abas
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join("") +
        `<Relationship Id="rId${abas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    );

    // 5. Folha de Estilos (Cabeçalho em negrito com fonte Calibri)
    add(
      "xl/styles.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet ${NS}><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
    );

    // 6. Planilhas individuais (worksheets)
    abas.forEach((a, i) => {
      const todas = [a.cab, ...a.linhas];

      // Calcula a largura ideal das colunas avaliando os primeiros 60 registros
      const larg = a.cab.map((_, c) =>
        Math.min(
          60,
          Math.max(
            12,
            ...todas.slice(0, 60).map((r) => String(r[c] ?? "").length + 2),
          ),
        ),
      );

      // Congela a 1ª linha (cabeçalho) com o nó <pane ySplit="1" state="frozen"/>
      let x =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${NS}><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>` +
        larg
          .map(
            (w, c) =>
              `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`,
          )
          .join("") +
        "</cols><sheetData>";

      // Serializa cada linha e cada célula
      todas.forEach((r, ri) => {
        x += `<row r="${ri + 1}">`;
        r.forEach((v, c) => {
          const ref = letra(c) + (ri + 1),
            est = ri === 0 ? ' s="1"' : ""; // Estilo 1 = negrito no cabeçalho
          if (v === null || v === undefined || v === "") return;
          if (typeof v === "number" && isFinite(v))
            x += `<c r="${ref}"${est}><v>${v}</v></c>`;
          else if (typeof v === "boolean")
            x += `<c r="${ref}" t="b"${est}><v>${v ? 1 : 0}</v></c>`;
          else
            x += `<c r="${ref}" t="inlineStr"${est}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        });
        x += "</row>";
      });
      add(
        `xl/worksheets/sheet${i + 1}.xml`,
        x + "</sheetData></worksheet>",
      );
    });
    return criarZip(arqs);
  }

  BE.xlsx = {
    enc, dec, inflar, deflar, lerZip, xml, colIdx, lerXlsx, comoObjetos,
    crc32, criarZip, esc, letra, criarXlsx,
  };
})(window.BE);
