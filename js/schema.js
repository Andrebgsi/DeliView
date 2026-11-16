/*
 * Schema do Data Mart (modelo dimensional v2 da Etapa 5) + tabelas de controle.
 * Nomes de tabelas e colunas idênticos ao diagrama e ao ETL
 * (referencia/ModelagemDimensional_Etapa05_v2.drawio e referencia/etl-etapa5.html).
 * Obs.: o diagrama ainda traz "NOME_DIA_SEMNA"; o ETL corrigiu para NOME_DIA_SEMANA.
 * A versão fica em PRAGMA user_version.
 *
 * v1: modelo da Etapa 5 (FATO_META com uma linha por dia, UNIQUE(ID_TEMPO)).
 * v2: metas por período. META_DEFINICAO guarda o cadastro (período, dias da semana, canal,
 *     totais) e a FATO_META passa a ter chave (ID_META, ID_TEMPO): uma linha por dia elegível
 *     de cada meta. Metas que se sobrepõem convivem, cada uma com o seu ID_META.
 */
window.BE = window.BE || {};

(function (BE) {
  var V1 = [
    /* ---------- Estrela 1 e 2: dimensões ---------- */
    'CREATE TABLE IF NOT EXISTS DIM_TEMPO (' +
    '  ID_TEMPO INTEGER PRIMARY KEY,' +              /* AAAAMMDD, ex.: 20260915 */
    '  DATA TEXT NOT NULL UNIQUE,' +                 /* AAAA-MM-DD */
    '  ANO INTEGER NOT NULL,' +
    '  SEMESTRE INTEGER NOT NULL CHECK (SEMESTRE IN (1, 2)),' +
    '  TRIMESTRE INTEGER NOT NULL CHECK (TRIMESTRE BETWEEN 1 AND 4),' +
    '  MES INTEGER NOT NULL CHECK (MES BETWEEN 1 AND 12),' +
    '  NOME_MES TEXT NOT NULL,' +
    '  DIA INTEGER NOT NULL CHECK (DIA BETWEEN 1 AND 31),' +
    '  DIA_SEMANA INTEGER NOT NULL CHECK (DIA_SEMANA BETWEEN 1 AND 7),' + /* 1 = segunda ... 7 = domingo */
    '  NOME_DIA_SEMANA TEXT NOT NULL,' +
    '  FIM_DE_SEMANA INTEGER NOT NULL CHECK (FIM_DE_SEMANA IN (0, 1))' +
    ')',

    'CREATE TABLE IF NOT EXISTS DIM_CANAL (' +
    '  ID_CANAL INTEGER PRIMARY KEY,' +
    '  NOME_CANAL TEXT NOT NULL UNIQUE,' +
    '  TIPO_CANAL TEXT' +
    ')',

    'CREATE TABLE IF NOT EXISTS DIM_STATUS (' +
    '  ID_STATUS INTEGER PRIMARY KEY,' +
    '  STATUS TEXT NOT NULL UNIQUE,' +
    '  CONSIDERA_VENDA INTEGER NOT NULL CHECK (CONSIDERA_VENDA IN (0, 1))' +
    ')',

    'CREATE TABLE IF NOT EXISTS DIM_PAGAMENTO (' +
    '  ID_PAGAMENTO INTEGER PRIMARY KEY,' +
    '  FORMA_PAGAMENTO TEXT NOT NULL UNIQUE' +
    ')',

    'CREATE TABLE IF NOT EXISTS DIM_TIPO_ENTREGA (' +
    '  ID_TIPO_ENTREGA INTEGER PRIMARY KEY,' +
    '  TIPO_ENTREGA TEXT NOT NULL UNIQUE' +
    ')',

    /* ---------- Estrela 1: FATO_PEDIDO (grão = 1 pedido) ---------- */
    'CREATE TABLE IF NOT EXISTS FATO_PEDIDO (' +
    '  ID_PEDIDO TEXT PRIMARY KEY,' +                /* dimensão degenerada */
    '  ID_CANAL INTEGER NOT NULL REFERENCES DIM_CANAL (ID_CANAL),' +
    '  ID_TEMPO INTEGER NOT NULL REFERENCES DIM_TEMPO (ID_TEMPO),' +
    '  ID_STATUS INTEGER NOT NULL REFERENCES DIM_STATUS (ID_STATUS),' +
    '  ID_PAGAMENTO INTEGER NOT NULL REFERENCES DIM_PAGAMENTO (ID_PAGAMENTO),' +
    '  ID_TIPO_ENTREGA INTEGER NOT NULL REFERENCES DIM_TIPO_ENTREGA (ID_TIPO_ENTREGA),' +
    '  VALOR_BRUTO_PEDIDO REAL NOT NULL DEFAULT 0,' +
    '  VALOR_DESCONTOS REAL NOT NULL DEFAULT 0,' +
    '  TAXA_MOTOBOY REAL NOT NULL DEFAULT 0,' +
    '  VALOR_TAXAS REAL NOT NULL DEFAULT 0,' +
    '  VALOR_TOTAL_PAGO REAL NOT NULL DEFAULT 0,' +
    '  VALOR_LIQUIDO REAL NOT NULL DEFAULT 0' +
    ')',
    'CREATE INDEX IF NOT EXISTS IX_FATO_PEDIDO_TEMPO ON FATO_PEDIDO (ID_TEMPO)',
    'CREATE INDEX IF NOT EXISTS IX_FATO_PEDIDO_CANAL ON FATO_PEDIDO (ID_CANAL)',
    'CREATE INDEX IF NOT EXISTS IX_FATO_PEDIDO_STATUS ON FATO_PEDIDO (ID_STATUS)',

    /* ---------- Estrela 2: FATO_META (grão = 1 dia, sem produto; a v2 troca a chave) ---------- */
    'CREATE TABLE IF NOT EXISTS FATO_META (' +
    '  ID_META INTEGER PRIMARY KEY,' +
    '  ID_TEMPO INTEGER NOT NULL REFERENCES DIM_TEMPO (ID_TEMPO),' +
    '  QUANTIDADE INTEGER NOT NULL DEFAULT 0 CHECK (QUANTIDADE >= 0),' +
    '  META_VALOR REAL NOT NULL DEFAULT 0 CHECK (META_VALOR >= 0),' +
    '  UNIQUE (ID_TEMPO)' +
    ')',

    /* ---------- Controle das cargas ---------- */
    'CREATE TABLE IF NOT EXISTS CARGA_ETL (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  data_hora TEXT NOT NULL,' +                   /* ISO 8601 */
    '  arquivos TEXT NOT NULL DEFAULT \'[]\',' +     /* JSON */
    '  pedidos_lidos INTEGER NOT NULL DEFAULT 0,' +
    '  pedidos_gravados INTEGER NOT NULL DEFAULT 0,' +
    '  conferencias_ok INTEGER NOT NULL DEFAULT 0,' +
    '  conferencias_total INTEGER NOT NULL DEFAULT 0,' +
    '  log TEXT' +
    ')',

    'CREATE TABLE IF NOT EXISTS PROBLEMA_TRATAMENTO (' +
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  id_carga INTEGER NOT NULL REFERENCES CARGA_ETL (id) ON DELETE CASCADE,' +
    '  onde TEXT,' +
    '  problema TEXT,' +
    '  tratamento TEXT' +
    ')',
    'CREATE INDEX IF NOT EXISTS IX_PROBLEMA_CARGA ON PROBLEMA_TRATAMENTO (id_carga)'
  ];

  /* Nomes dos meses iguais aos do JOB 1 do ETL (DIM_TEMPO.NOME_MES) */
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  function doisDigitos(n) { return (n < 10 ? '0' : '') + n; }

  /*
   * v1 -> v2. Recria a FATO_META com a chave nova (tabela nova, cópia, apaga a antiga, renomeia)
   * e cria uma META_DEFINICAO por mês que já tinha metas: "Metas de <mês>/<ano>", do dia 1 ao
   * último dia do mês, todos os dias da semana, totais = soma dos dias. As linhas diárias são
   * copiadas como estão (sem redistribuir). Um banco sem metas apenas recebe o schema novo.
   */
  var V2 = [
    'CREATE TABLE META_DEFINICAO (' +
    '  ID_META INTEGER PRIMARY KEY,' +
    '  NOME TEXT NOT NULL,' +
    '  DATA_INICIO TEXT NOT NULL,' +                 /* AAAA-MM-DD */
    '  DATA_FIM TEXT NOT NULL,' +                    /* >= DATA_INICIO, período máx. 366 dias */
    '  DIAS_SEMANA TEXT NOT NULL,' +                 /* '1234567' (1 = seg ... 7 = dom) */
    '  ID_CANAL INTEGER NULL REFERENCES DIM_CANAL (ID_CANAL),' + /* NULL = todos os canais */
    '  META_VALOR REAL NOT NULL DEFAULT 0 CHECK (META_VALOR >= 0),' +
    '  QUANTIDADE INTEGER NOT NULL DEFAULT 0 CHECK (QUANTIDADE >= 0),' +
    "  DISTRIBUICAO TEXT NOT NULL CHECK (DISTRIBUICAO IN ('igual', 'proporcional'))," +
    '  CRIADA_EM TEXT NOT NULL,' +
    '  ATUALIZADA_EM TEXT NOT NULL,' +
    '  CHECK (DATA_FIM >= DATA_INICIO)' +
    ')',

    'CREATE TABLE FATO_META_V2 (' +
    '  ID_META INTEGER NOT NULL REFERENCES META_DEFINICAO (ID_META) ON DELETE CASCADE,' +
    '  ID_TEMPO INTEGER NOT NULL REFERENCES DIM_TEMPO (ID_TEMPO),' +
    '  QUANTIDADE INTEGER NOT NULL DEFAULT 0 CHECK (QUANTIDADE >= 0),' +
    '  META_VALOR REAL NOT NULL DEFAULT 0 CHECK (META_VALOR >= 0),' +
    '  PRIMARY KEY (ID_META, ID_TEMPO)' +
    ')',

    function (db) {
      var agora = new Date().toISOString();
      var meses = db.exec(
        'SELECT ID_TEMPO / 100 AS mes, ROUND(SUM(META_VALOR), 2), SUM(QUANTIDADE) ' +
        'FROM FATO_META GROUP BY ID_TEMPO / 100 ORDER BY 1');
      (meses.length ? meses[0].values : []).forEach(function (r) {
        var ano = Math.floor(r[0] / 100), mes = r[0] % 100;
        var ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
        var prefixo = ano + '-' + doisDigitos(mes) + '-';
        db.run(
          'INSERT INTO META_DEFINICAO (NOME, DATA_INICIO, DATA_FIM, DIAS_SEMANA, ID_CANAL, META_VALOR, ' +
          "QUANTIDADE, DISTRIBUICAO, CRIADA_EM, ATUALIZADA_EM) VALUES (?, ?, ?, '1234567', NULL, ?, ?, 'igual', ?, ?)",
          ['Metas de ' + MESES[mes - 1] + '/' + ano, prefixo + '01', prefixo + doisDigitos(ultimo),
            r[1], r[2], agora, agora]);
        var id = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
        db.run(
          'INSERT INTO FATO_META_V2 (ID_META, ID_TEMPO, QUANTIDADE, META_VALOR) ' +
          'SELECT ?, ID_TEMPO, QUANTIDADE, META_VALOR FROM FATO_META WHERE ID_TEMPO / 100 = ?',
          [id, r[0]]);
      });
    },

    'DROP TABLE FATO_META',
    'ALTER TABLE FATO_META_V2 RENAME TO FATO_META',
    'CREATE INDEX IX_FATO_META_TEMPO ON FATO_META (ID_TEMPO)',
    'CREATE INDEX IX_META_DEFINICAO_INICIO ON META_DEFINICAO (DATA_INICIO)'
  ];

  BE.schema = {
    versao: 2,

    tabelas: [
      'DIM_TEMPO', 'DIM_CANAL', 'DIM_STATUS', 'DIM_PAGAMENTO', 'DIM_TIPO_ENTREGA',
      'FATO_PEDIDO', 'META_DEFINICAO', 'FATO_META', 'CARGA_ETL', 'PROBLEMA_TRATAMENTO'
    ],

    /*
     * Migrações por versão: índice 0 leva da versão 0 para a 1, e assim por diante.
     * Cada passo é um texto SQL ou uma função (db) para o que o SQL sozinho não resolve.
     */
    migracoes: [V1, V2],

    /* Aplica as migrações pendentes num objeto Database do sql.js, uma transação por versão. */
    aplicar: function (db) {
      db.run('PRAGMA foreign_keys = ON');
      var atual = db.exec('PRAGMA user_version')[0].values[0][0];
      if (atual > this.versao) {
        throw new Error('O banco é de uma versão mais nova do portal (v' + atual + ').');
      }
      for (var v = atual; v < this.versao; v++) {
        db.run('BEGIN');
        try {
          this.migracoes[v].forEach(function (passo) {
            if (typeof passo === 'function') passo(db); else db.run(passo);
          });
          db.run('PRAGMA user_version = ' + (v + 1));
          db.run('COMMIT');
        } catch (e) {
          db.run('ROLLBACK');
          throw e;
        }
      }
    }
  };
})(window.BE);
