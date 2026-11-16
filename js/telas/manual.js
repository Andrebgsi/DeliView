/*
 * Tela: Manual
 * 1. Avisos de segurança (mesmo texto da barra lateral), sempre a primeira coisa visível.
 * 2. Como usar (Importar, Conferir, Dados e backup, Metas, Dashboard e onde fica o banco de dados).
 * 3. Sobre: "Documentação Técnica — Motor ETL DeliView" (referencia/etl-etapa5.html),
 *    adaptada só no que mudou: gravação em SQLite e nenhuma opção de dados de demonstração.
 * 4. Créditos.
 * O sumário usa botões de rolagem, e não âncoras "#id", porque o hash é a rota do portal.
 */
window.BE = window.BE || {};
BE.telas = BE.telas || {};

(function (BE) {
  var ic = function (n, t) { return BE.icone(n, t); };

  var SUMARIO = [
    ['man-seguranca', 'Avisos de segurança'],
    ['man-como-usar', 'Como usar'],
    ['man-importar', 'Importar', 1],
    ['man-conferir', 'Conferir', 1],
    ['man-backup', 'Dados e backup', 1],
    ['man-metas', 'Metas', 1],
    ['man-dashboard', 'Dashboard', 1],
    ['man-dados', 'Onde fica o banco de dados', 1],
    ['man-sobre', 'Sobre o motor ETL'],
    ['man-visao', 'Visão geral', 1],
    ['man-passos', 'Como executar', 1],
    ['man-jobs', 'Os jobs', 1],
    ['man-fato', 'FATO_PEDIDO', 1],
    ['man-decisoes', 'Decisões de modelagem', 1],
    ['man-mudancas', 'O que mudou', 1],
    ['man-creditos', 'Créditos']
  ];

  function tabela(cab, linhas) {
    return '<div class="tabela-wrap"><table class="tabela tabela--doc"><thead><tr>' +
      cab.map(function (c) { return '<th scope="col">' + c + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      linhas.map(function (l) { return '<tr>' + l.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>';
  }

  function h(nivel, id, texto) {
    return '<h' + nivel + ' id="' + id + '" tabindex="-1">' + texto + '</h' + nivel + '>';
  }

  /* ---------- 1. Segurança ---------- */

  function seguranca() {
    return '<section class="alerta-seguranca" aria-labelledby="man-seguranca">' +
      '<div class="alerta-seguranca__topo">' +
      '  <span class="alerta-seguranca__icone">' + ic('triangulo', 26) + '</span>' +
      '  ' + h(2, 'man-seguranca', 'Avisos de segurança') +
      '</div>' +
      '<ul>' +
      '  <li><strong>Nenhum dado vai para a internet.</strong> O site entrega só o programa (HTML, JavaScript e CSS). As planilhas que você ' +
      '  importa são lidas e gravadas <strong>apenas no navegador deste computador</strong>. Não há servidor nem conta: quem publicou o ' +
      '  site e as outras pessoas que o acessam não veem os seus dados.</li>' +
      '  <li>A página proíbe o próprio navegador de enviar dados para qualquer endereço (política de segurança <em>CSP</em>), ' +
      '  de modo que nem um arquivo malicioso importado consegue transmitir as informações.</li>' +
      '  <li>Os dados ficam <strong>sem criptografia e sem login</strong>, guardados no navegador. Qualquer pessoa com acesso a ' +
      '  esse computador e a esse perfil de navegador consegue vê-los.</li>' +
      '  <li><strong>Não use em computador compartilhado ou público.</strong> Ao terminar numa máquina que não é sua, use ' +
      '  <em>Apagar todos os dados</em> na aba <a href="#/dados">Dados e backup</a>.</li>' +
      '  <li>Os <strong>arquivos de exemplo</strong> oferecidos na aba <a href="#/importacao">Importação</a> são fictícios, ' +
      '  gerados só para demonstração. Nenhum número deles corresponde a vendas reais.</li>' +
      '  <li>O backup (<code>.zip</code> ou <code>.sqlite</code>) contém todos os pedidos, sem criptografia. Guarde-o como documento sigiloso.</li>' +
      '  <li>O botão <strong>"Apagar todos os dados"</strong> limpa o banco do navegador. Ele fica na aba ' +
      '  <a href="#/importacao">Importação</a>, no cartão <em>Zona de perigo</em>, e pede duas confirmações. A aba ' +
      '  <a href="#/dados">Dados e backup</a> tem a mesma opção e limpezas parciais, e pede para digitar APAGAR. ' +
      '  Não dá para desfazer: se precisar dos dados depois, faça antes um backup.</li>' +
      '  <li>O arquivo .sqlite vinculado fica numa pasta do seu computador, sem criptografia. Não o coloque em pastas sincronizadas públicas nem envie por e-mail.</li>' +
      '  <li>Este aviso também fica fixo no rodapé da barra lateral, em todas as telas.</li>' +
      '</ul>' +
      '</section>';
  }

  /* ---------- 2. Como usar ---------- */

  function comoUsar() {
    return '<section class="cartao manual" aria-labelledby="man-como-usar">' +
      '<div class="cartao__topo"><h2 id="man-como-usar" tabindex="-1">' + ic('bookOpen', 20) + 'Como usar</h2></div>' +
      '<p>O portal roda inteiro no navegador (Chrome, Edge ou Firefox), sem login e sem servidor de dados: basta abrir o endereço do site. ' +
      'Também funciona sem internet: numa cópia do repositório, abra o arquivo <code>portal.html</code>. ' +
      'Para experimentar sem dados reais, use os arquivos de exemplo fictícios da aba <a href="#/importacao">Importação</a>. ' +
      'O caminho normal é: importar as planilhas, conferir o resultado, salvar um backup, cadastrar as metas e acompanhar o dashboard.</p>' +

      h(3, 'man-importar', '1. Importar') +
      '<ol>' +
      '  <li>No portal do iFood e no da 99Food, exporte o relatório <strong>"Dados do pedido"</strong> do período desejado (arquivos <code>.xlsx</code>).</li>' +
      '  <li>Na aba <a href="#/importacao">Importação</a>, arraste os arquivos para a caixa pontilhada ou clique nela para escolher. ' +
      '  Cada arquivo reconhecido ganha uma marca verde. A conciliação do iFood, os dados da loja do 99Food e a planilha de custos ' +
      '  são reconhecidos, mas não entram no modelo e aparecem como ignorados.</li>' +
      '  <li>Com pelo menos um relatório de pedidos na lista (do iFood, do 99Food ou dos dois), clique em <strong>Processar e gravar no banco</strong>. ' +
      '  O ETL roda e o resultado é gravado no banco local. Se alguma conferência falhar, o portal pergunta antes de gravar.</li>' +
      '  <li>Cada plataforma pode vir numa importação separada: os pedidos se somam no banco. Quando vem só uma, as conferências ' +
      '  contábeis da outra aparecem como <em>não se aplica</em> e, se o banco não tiver pedidos dela no mesmo período, um aviso ' +
      '  amarelo lembra de importar o relatório que falta. O Dashboard e as Metas mostram o mesmo aviso nos meses que têm pedidos ' +
      '  de uma plataforma só.</li>' +
      '  <li>Pode importar de novo quando quiser. O mesmo pedido (mesmo ID) é <strong>substituído</strong>, e meses diferentes se ' +
      '  <strong>acumulam</strong>. Cada importação fica registrada no <em>Histórico de cargas</em>.</li>' +
      '</ol>' +

      h(3, 'man-conferir', '2. Conferir') +
      '<ol>' +
      '  <li>Depois de processar, o quadro verde mostra quantas <strong>conferências automáticas</strong> passaram (o esperado é todas). ' +
      '  Se aparecer em vermelho, veja abaixo quais falharam antes de usar os dados.</li>' +
      '  <li>A tabela <em>Vendas por plataforma</em> resume pedidos, cancelados, faturamento e ticket médio de cada canal. Compare com o portal de cada plataforma.</li>' +
      '  <li>Em <em>Conferir as tabelas</em>, escolha qualquer tabela do banco (dimensões, fatos, cargas e problemas) e veja as linhas gravadas.</li>' +
      '  <li>O rodapé do menu lateral mostra quantos pedidos há no banco e a data da última carga.</li>' +
      '</ol>' +

      h(3, 'man-backup', '3. Dados e backup') +
      '<p>A aba <a href="#/dados">Dados e backup</a> concentra a cópia de segurança e a limpeza dos dados. ' +
      'O rodapé do menu lateral (<em>Banco: N pedidos</em>) também leva para lá. Ela mostra quantos pedidos, metas e cargas há, ' +
      'o período coberto, o tamanho do banco e a data do último backup. Se nunca houve backup, ou se o último tem mais de 7 dias ' +
      'e houve importação ou mudança de meta depois dele, aparece o aviso amarelo <em>"Faça um backup: há dados novos sem cópia"</em>.</p>' +
      '<ol>' +
      '  <li><strong>Fazer o backup:</strong> clique em <strong>Fazer backup (.zip)</strong>. O arquivo se chama ' +
      '  <code>deliview-backup-AAAA-MM-DD_HHhMM.zip</code> e traz o banco (<code>deliview.sqlite</code>), um ' +
      '  <code>manifesto.json</code> com a data, as contagens e o código SHA-256 que confere o conteúdo, e um <code>LEIA-ME.txt</code>.</li>' +
      '  <li><strong>Onde fica salvo:</strong> no Chrome e no Edge abre a janela <em>Salvar como</em>, e você escolhe a pasta ' +
      '  (de preferência um pen drive ou uma pasta com cópia em nuvem privada). No Firefox o arquivo vai para a pasta de downloads; ' +
      '  para escolher a pasta, ative no navegador a opção <em>"Perguntar onde salvar cada arquivo"</em>.</li>' +
      '  <li><strong>Restaurar:</strong> clique em <strong>Restaurar backup (.zip ou .sqlite)</strong> e escolha o arquivo, sem descompactar. ' +
      '  Antes de trocar qualquer coisa, o portal mostra uma prévia com a data do backup e a contagem de pedidos, metas e cargas, lado a lado ' +
      '  com o banco atual. Só depois de confirmar o conteúdo do navegador é <strong>substituído</strong>. Um <code>.zip</code> alterado ' +
      '  ou danificado é recusado ("Backup corrompido"). Backups de versões anteriores do portal são atualizados automaticamente.</li>' +
      '  <li><strong>Proteção do armazenamento:</strong> o botão <em>Manter dados neste navegador</em> pede ao navegador que não apague ' +
      '  os dados do portal sozinho quando o disco enche. Não substitui o backup.</li>' +
      '  <li><strong>Verificar integridade:</strong> confere o arquivo do banco e as ligações entre as tabelas.</li>' +
      '</ol>' +
      '<p>Na <em>Zona de perigo</em> há quatro limpezas. Todas mostram o que será apagado, oferecem <em>Fazer backup antes</em> ' +
      'e pedem para digitar <strong>APAGAR</strong>:</p>' +
      tabela(['Opção', 'Apaga', 'Mantém'], [
        ['Limpar dados de vendas', 'Pedidos, histórico de cargas e problemas registrados', 'Dimensões e metas. As metas continuam, com o realizado em R$ 0,00 até a próxima importação.'],
        ['Limpar metas', 'Todas as metas e os valores diários delas', 'Pedidos, cargas e dimensões'],
        ['Limpar banco de dados', 'Todas as tabelas', 'A estrutura do banco e a data do último backup'],
        ['Limpar navegador (apagar tudo)', 'O banco inteiro guardado no navegador e as preferências do portal', 'Nada: começa um banco novo e vazio']
      ]) +
      '<p>Na aba Importação, os botões <strong>Salvar banco (.sqlite)</strong>, <strong>Abrir banco (.sqlite)</strong> e ' +
      '<strong>Apagar todos os dados</strong> continuam funcionando como antes. O <code>.sqlite</code> solto também é aceito na restauração. ' +
      'Ainda no cartão <em>Exportar</em> da Importação ficam o Data Mart em Excel, as tabelas em CSV (zip) e o registro de execução (.txt).</p>' +

      h(3, 'man-metas', '4. Metas') +
      '<p>Cada meta vale para um período que você escolhe: uma semana, um mês, um feriado prolongado ou ' +
      'qualquer intervalo de até 366 dias. O portal trabalha com dias inteiros (não há horário).</p>' +
      '<ol>' +
      '  <li><strong>Criar uma meta:</strong> na aba <a href="#/metas">Metas</a>, clique em <em>+ Nova meta</em> e dê um nome (por exemplo, "Agosto"). ' +
      '  No calendário, clique no dia inicial e depois no dia final; o intervalo fica verde-claro. Um terceiro clique recomeça a escolha. ' +
      '  Os atalhos acima do calendário preenchem períodos comuns, e <em>Mês com dados</em> escolhe o último mês com vendas importadas. ' +
      '  Os dias com um pontinho amarelo têm vendas no banco.</li>' +
      '  <li><strong>Marcar os dias da semana:</strong> desmarque os dias que não devem contar. Por exemplo, para uma meta só de ' +
      '  fins de semana, deixe marcados apenas sáb e dom. Os dias desmarcados aparecem riscados no calendário e ficam fora da meta e do realizado.</li>' +
      '  <li><strong>Filtrar por canal:</strong> escolha <em>Todos</em> para somar iFood + 99Food ou um canal específico para comparar ' +
      '  só com as vendas dele.</li>' +
      '  <li><strong>Valores:</strong> informe a meta de faturamento (R$), a de pedidos, ou as duas. O resumo mostra quantos dias contam ' +
      '  e quanto isso dá por dia. <em>Igual por dia</em> divide o total igualmente; <em>Proporcional ao dia da semana</em> dá mais meta ' +
      '  aos dias que costumam vender mais, conforme o histórico importado.</li>' +
      '  <li><strong>Ler o mini gráfico:</strong> a linha tracejada escura é a meta acumulada, dia após dia; a linha amarela com área ' +
      '  é o que já foi vendido, também acumulado. Se a amarela está abaixo da tracejada, a venda está atrás da meta. Nas metas em ' +
      '  andamento, uma linha vertical marca o dia de hoje, e o cartão mostra quanto falta e o ritmo necessário por dia.</li>' +
      '  <li><strong>A barra de atingimento</strong> fica verde a partir de 100%, amarela de 70% a 99% e vermelha abaixo de 70%.</li>' +
      '  <li><strong>Repetir no próximo mês:</strong> no cartão, o botão cria uma cópia com os mesmos dias da semana, canal e totais ' +
      '  para o mês seguinte. Edite depois se quiser outros valores.</li>' +
      '  <li><strong>Detalhes:</strong> mostra a meta e o realizado de cada dia. Você pode ajustar um dia; o total da meta passa a ser a ' +
      '  soma dos dias. Atenção: editar a meta e salvar distribui os valores de novo e desfaz esses ajustes manuais.</li>' +
      '</ol>' +
      '<p class="nota-rodape">Realizado = valor total pago pelos clientes nos pedidos concluídos.</p>' +

      h(3, 'man-dashboard', '5. Dashboard') +
      '<p>O <a href="#/dashboard">Dashboard</a> mostra as vendas importadas: o <strong>Painel principal</strong> (4 indicadores e ' +
      '5 gráficos), as <strong>Análises por tema</strong> (7 seções que abrem e fecham) e a <strong>Exploração OLAP</strong>. ' +
      'Se o banco estiver vazio, um aviso no topo lembra de importar e os blocos mostram <em>Sem pedidos neste recorte</em>.</p>' +
      '<ol>' +
      '  <li><strong>Filtros:</strong> período (início e fim), canal, forma de pagamento, tipo de entrega e dia da semana. Clique nos ' +
      '  chips para marcar um ou mais valores; <em>Todos</em> desmarca o grupo. Todos os gráficos, a matriz, a tabela OLAP e os insights ' +
      '  seguem o recorte, resumido abaixo dos filtros (ex.: <em>agosto/2026 · iFood · Pix</em>). O recorte fica no endereço da página ' +
      '  e no navegador: recarregar mantém os filtros. <em>Limpar filtros</em> volta ao último mês com dados, com todos os canais.</li>' +
      '  <li><strong>Indicadores:</strong> faturamento, pedidos concluídos, ticket médio e líquido recebido, com a variação contra o ' +
      '  período anterior de mesma duração (▲ verde, ▼ vermelho ou <em>sem base</em> quando o período anterior não tem dados).</li>' +
      '  <li><strong>Gráficos:</strong> passe o mouse (ou use Tab) sobre um ponto ou barra para ver o valor. O botão <em>Ver dados</em> ' +
      '  troca o gráfico por uma tabela com os mesmos números.</li>' +
      '  <li><strong>Drill-down:</strong> num gráfico de tempo, clique num ponto (ou Enter) para descer: Mês → Semana → Dia. No dia, ' +
      '  abre a lista dos pedidos daquele dia, com os valores e o botão <em>Exportar CSV</em>. <em>Voltar para…</em> sobe de novo ' +
      '  (roll-up). Nos mapas de calor, clicar numa célula aplica o filtro daquele dia da semana.</li>' +
      '  <li><strong>Granularidade:</strong> os botões <em>Dia</em>, <em>Semana</em> e <em>Mês</em> dos gráficos de tempo agrupam o mesmo ' +
      '  período de outra forma. A soma não muda: o mês é a soma dos seus dias.</li>' +
      '  <li><strong>Matriz (pivot):</strong> escolha a dimensão das <em>linhas</em> (canal, forma de pagamento, tipo de entrega, status, mês, ' +
      '  semana ou dia da semana), a das <em>colunas</em> (ou <em>Nenhuma</em>) e a <em>medida</em>. A tabela traz os totais de linha e de ' +
      '  coluna, e a cor da célula cresce com o valor. <em>Inverter</em> troca linhas e colunas sem mudar os totais; <em>Exportar CSV</em> ' +
      '  baixa a tabela.</li>' +
      '  <li><strong>Operações OLAP neste recorte:</strong> a tabela se preenche sozinha com o estado atual: <em>Slice</em> (um filtro só), ' +
      '  <em>Dice</em> (combinação de filtros), <em>Drill-down</em> e <em>Roll-up</em> (a última descida e a última subida feitas nos ' +
      '  gráficos de tempo) e <em>Pivot</em> (a configuração da matriz), cada uma com a pergunta e a análise com os números do recorte. ' +
      '  <em>Copiar para a documentação</em> copia a tabela em Markdown.</li>' +
      '  <li><strong>Insights:</strong> de 3 a 6 cartões gerados por regras fixas (canal com mais de 60% dos pedidos, cancelamento acima ' +
      '  de 15%, diferença de retenção acima de 10 pontos, dia da semana mais forte e mais fraco, ticket com × sem desconto e meta em ' +
      '  risco). Cada cartão traz <em>Visualização</em> (o fato), <em>Insight</em> (o que significa) e <em>Decisão</em> (o que avaliar). ' +
      '  Uma regra só aparece quando o gatilho acontece.</li>' +
      '  <li><strong>Impressão:</strong> <em>Imprimir / salvar PDF</em> abre a impressão do navegador já com todas as seções abertas. ' +
      '  O menu e os filtros saem da página, o recorte é impresso no topo, cada seção começa numa página nova e o rodapé traz a data ' +
      '  da impressão e o aviso de dados sigilosos. Para gerar PDF, escolha <em>Salvar como PDF</em> no destino.</li>' +
      '</ol>' +
      '<p class="nota-rodape">Faturamento = valor total pago dos pedidos concluídos. Cancelados entram só na taxa de cancelamento e na ' +
      'receita perdida (valor bruto preservado pela regra ZERA FATOS).</p>' +

      h(3, 'man-dados', 'Onde fica o banco de dados') +
      '<ul>' +
      '  <li><strong>Uma cópia por navegador (IndexedDB):</strong> o banco é um SQLite (sql.js) que roda dentro da página. Depois de cada ' +
      '  importação ou alteração de meta, o banco inteiro é salvo no <strong>IndexedDB</strong> do navegador. Ao abrir o portal de ' +
      '  novo, <strong>no mesmo navegador, no mesmo perfil e no mesmo computador</strong>, os dados estão lá. Outro navegador ou outro ' +
      '  perfil tem a própria cópia, que começa vazia.</li>' +
      '  <li><strong>Pergunta inicial:</strong> quando o portal abre num navegador sem pedidos e sem metas, aparece a janela ' +
      '  <em>"Onde está o banco de dados?"</em>, com três opções: <em>Abrir arquivo do banco (.sqlite ou .zip)</em>, <em>Vincular arquivo ' +
      '  do banco</em> (só no Chrome e no Edge) e <em>Começar com banco vazio</em>. Esta última faz a pergunta não aparecer mais naquele ' +
      '  navegador. Ela pode ser reaberta em <a href="#/dados">Dados e backup</a>, no botão <em>Abrir a pergunta inicial</em>.</li>' +
      '  <li><strong>Arquivo vinculado (Chrome e Edge):</strong> no cartão <em>Arquivo do banco</em> da aba Dados e backup, ' +
      '  <em>Vincular novo arquivo</em> cria um <code>deliview.sqlite</code> na pasta que você escolher, e <em>Vincular arquivo existente</em> ' +
      '  usa um que já existe. A partir daí, o portal grava nesse arquivo sozinho, cerca de 1 segundo depois de cada mudança, além de ' +
      '  continuar gravando no navegador. O rodapé do menu mostra <em>Banco: arquivo deliview.sqlite · salvo hh:mm</em>. Quando o navegador ' +
      '  é fechado, ele esquece a permissão: ao abrir de novo, aparece no topo a faixa <em>Reconectar ao arquivo do banco</em>; um clique ' +
      '  em <strong>Reconectar</strong> volta a gravar. Se o arquivo foi alterado por outro navegador depois da última gravação deste, ' +
      '  o portal carrega o arquivo. Não abra o portal em dois navegadores ao mesmo tempo com o mesmo arquivo: vale a última gravação.</li>' +
      '  <li><strong>Em outro navegador ou computador:</strong> no Chrome ou no Edge, vincule o mesmo arquivo (<em>Vincular arquivo existente</em>). ' +
      '  Se aquele navegador já tiver dados, o portal mostra as contagens e a data de cada lado e pergunta qual vale. No Firefox, que não ' +
      '  permite vincular, use <em>Abrir arquivo do banco</em> na pergunta inicial ou <em>Restaurar backup</em>, e leve os dados de volta com ' +
      '  <em>Fazer backup</em>.</li>' +
      '  <li><strong>Arquivo vinculado x backup .zip:</strong> o arquivo vinculado é <strong>sempre atual</strong>: muda a cada gravação, ' +
      '  inclusive quando você apaga dados. O backup <code>.zip</code> é uma <strong>foto de um momento</strong>: não muda depois de salvo, ' +
      '  e é ele que recupera os dados se algo for apagado por engano. Use os dois.</li>' +
      '  <li><strong>Se alguém limpar os dados do navegador</strong> (limpar histórico com "cookies e dados de sites", modo anônimo, ' +
      '  reinstalação ou troca de perfil), a cópia do navegador e o vínculo somem juntos. O arquivo vinculado continua na pasta: ' +
      '  vincule-o de novo ou abra-o pela pergunta inicial. Sem arquivo, use <strong>Restaurar backup</strong> com o último <code>.zip</code>, ' +
      '  ou importe as planilhas de novo e recadastre as metas.</li>' +
      '  <li>Se o rodapé do menu mostrar <em>(não salvo neste navegador)</em>, o IndexedDB está indisponível (comum em janela anônima): ' +
      '  os dados valem só até fechar a página. Faça um backup antes de sair.</li>' +
      '</ul>' +
      '</section>';
  }

  /* ---------- 3. Sobre (Documentação Técnica da Etapa 5, adaptada) ---------- */

  function sobre() {
    return '<section class="cartao manual" aria-labelledby="man-sobre">' +
      '<div class="cartao__topo"><h2 id="man-sobre" tabindex="-1">' + ic('info', 20) + 'Sobre: Documentação Técnica — Motor ETL DeliView</h2>' +
      '<span class="selo selo--ok">PUC Minas • 2026/02</span></div>' +

      '<div class="doc-meta">' +
      '  <div><small>Ambiente de Execução</small><b>Navegador (100% Client-side; nenhum dado sai do navegador)</b></div>' +
      '  <div><small>Padrão Arquitetural</small><b>Modelagem Kimball (Star Schema)</b></div>' +
      '  <div><small>Armazenamento</small><b>SQLite local (sql.js) + IndexedDB + arquivo .sqlite vinculado (opcional)</b></div>' +
      '  <div><small>Dependências Externas</small><b>Só o sql.js, servido junto com o portal (sem CDN)</b></div>' +
      '</div>' +

      h(3, 'man-visao', '2. Visão Geral') +
      '<p class="doc-destaque"><strong>Em uma frase:</strong> O sistema é um pipeline de ETL client-side em JavaScript puro que ' +
      'descompacta, valida, padroniza e consolida relatórios de pedidos heterogêneos do iFood e do 99Food em um Data Mart dimensional ' +
      'relacional (modelo da Etapa 5, v2), <strong>grava-o num banco SQLite local</strong> e o exporta em Excel (.xlsx), CSV e .sqlite, sem nenhum servidor.</p>' +
      '<p>O <strong>DeliView</strong> atende restaurantes que operam simultaneamente nos canais <strong>iFood</strong> e <strong>99Food</strong>. ' +
      'Cada plataforma emite extratos com formatos, nomenclaturas e critérios contábeis discrepantes (taxas, comissões e descontos ' +
      'concedidos pela loja ou subsidiados pela plataforma).</p>' +
      '<p>O motor resolve 3 desafios fundamentais:</p>' +
      '<ul>' +
      '  <li><strong>Padronização de Medidas:</strong> Equaliza, nos dois canais, o valor bruto, os descontos, a taxa de motoboy, ' +
      '  as taxas e comissões, o total pago e o líquido nas colunas da FATO_PEDIDO.</li>' +
      '  <li><strong>Regra ZERA FATOS (Data Quality):</strong> Em pedidos cancelados, o valor bruto é mantido para acompanhamento de ' +
      '  demanda perdida, enquanto taxas, fretes e repasses líquidos são zerados, evitando distorções em somatórios de faturamento.</li>' +
      '  <li><strong>Independência Tecnológica:</strong> Executa parsers binários de ZIP/Deflate e geradores OpenXML do zero usando ' +
      '  <code>DecompressionStream</code> e <code>DOMParser</code>, sem necessidade de SheetJS ou servidor Node.js. O banco usa o ' +
      '  sql.js (SQLite compilado para JavaScript), copiado para o portal, sem CDN.</li>' +
      '</ul>' +
      '<p>Só entram dados reais: <strong>não há opção de dados de demonstração</strong>. O portal trabalha apenas com os relatórios importados.</p>' +

      h(3, 'man-passos', '3. Como Usar / Como Executar') +
      '<ol>' +
      '  <li><strong>Carregue os 2 relatórios de pedidos.</strong> Na aba Importação, arraste para a caixa pontilhada (ou clique nela) os arquivos <code>.xlsx</code>:' +
      '    <ul>' +
      '      <li><strong>iFood (Pedidos):</strong> relatório "Dados do pedido" exportado do Portal do Parceiro.</li>' +
      '      <li><strong>99Food (Pedidos):</strong> relatório "Dados do pedido" da 99Food.</li>' +
      '    </ul>' +
      '    Se for solto outro relatório conhecido (conciliação do iFood, dados da loja do 99Food ou planilha de custos), ele é reconhecido, ' +
      '    mas ignorado com um aviso: essas fontes não alimentam o modelo v2.</li>' +
      '  <li><strong>Acompanhe a identificação automática.</strong> O sistema inspeciona os cabeçalhos de cada arquivo sem enviar nada ' +
      '  para a internet. Cada arquivo reconhecido ganha uma marca de verificação verde na lista.</li>' +
      '  <li><strong>Clique em "Processar e gravar no banco".</strong> Com os 2 relatórios carregados, o botão roda os 8 jobs (0 a 7) ' +
      '  descritos na seção 4 e grava o resultado no SQLite local.</li>' +
      '  <li><strong>Audite os resultados na tela.</strong> Confira os KPIs por plataforma, as 6 conferências automáticas, o histórico ' +
      '  de cargas e a prévia de qualquer tabela do banco no seletor.</li>' +
      '  <li><strong>Baixe o Data Mart nos formatos desejados.</strong> Excel (<strong>.xlsx</strong>) com uma aba por tabela, pacote de ' +
      '  <strong>CSVs (.zip)</strong> com acentos compatíveis com o Excel, o <strong>log (.txt)</strong> da execução ou o banco inteiro (<strong>.sqlite</strong>).</li>' +
      '</ol>' +

      h(3, 'man-jobs', '4. Os jobs, um a um') +
      '<p class="nota-rodape">O pipeline é fiel ao diagrama <code>ModelagemDimensional_Etapa05_v2.drawio</code>: toda tabela e toda coluna ' +
      'de saída existe no diagrama, com o mesmo nome.</p>' +
      tabela(['Job', 'O que faz', 'Lê', 'Gera'], [
        ['0', 'Extração e deduplicação: mantém a 1ª ocorrência de cada ID de pedido e registra alerta se houver repetidos.', 'iFood: ID COMPLETO DO PEDIDO · 99Food: ID do pedido', 'Listas de pedidos sem repetição'],
        ['1', 'Calendário diário contínuo, de 01/01 do menor ano a 31/12 do maior ano dos pedidos.', 'iFood: DATA E HORA DO PEDIDO · 99Food: Data', 'DIM_TEMPO'],
        ['2', 'Cria as dimensões de negócio. Padroniza a forma de pagamento numa categoria comum (Pix, Crédito, Débito, Carteira Digital, App do Banco, Dinheiro, Online sem detalhe, Outros).', 'FORMA DE PAGAMENTO / Forma de pagamento', 'DIM_CANAL, DIM_STATUS, DIM_PAGAMENTO, DIM_TIPO_ENTREGA'],
        ['3', 'Converte cada pedido do iFood nas medidas do modelo e aplica a regra ZERA FATOS.', 'Colunas do relatório do iFood (seção 5)', 'Pedidos iFood padronizados'],
        ['4', 'Idem para o 99Food. O status vem de "Horário do cancelamento" (preenchido = CANCELADO).', 'Colunas do relatório do 99Food (seção 5)', 'Pedidos 99Food padronizados'],
        ['5', 'Junta os dois canais e troca cada texto pela chave substituta da dimensão (FK).', 'Saídas dos jobs 2, 3 e 4', 'FATO_PEDIDO'],
        ['6', 'Cria a FATO_META com a estrutura do modelo. As plataformas não exportam metas, então a carga não a preenche; no portal, ela é preenchida pela aba Metas.', '(sem fonte)', 'FATO_META (vazia na carga)'],
        ['7', 'Validação da carga: 3 conferências contábeis (iFood x2, 99Food) e 3 de integridade (PK única, FKs existentes, cancelados zerados).', 'FATO_PEDIDO e dimensões', 'VALIDACAO_DA_CARGA, PROBLEMAS_E_TRATAMENTOS'],
        ['Gravação', 'Grava tudo no SQLite numa transação única, com upsert por ID_PEDIDO (o mesmo pedido é substituído; meses novos se acumulam), registra a carga e salva o banco no IndexedDB.', 'Saídas dos jobs 0 a 7', 'Banco SQLite: dimensões, FATO_PEDIDO, CARGA_ETL, PROBLEMA_TRATAMENTO']
      ]) +

      h(3, 'man-fato', '5. FATO_PEDIDO: de onde vem cada coluna') +
      tabela(['Coluna (diagrama)', 'iFood', '99Food'], [
        ['ID_PEDIDO (PK, dim. degenerada)', 'ID COMPLETO DO PEDIDO', 'ID do pedido'],
        ['ID_CANAL (FK)', '1 = iFood', '2 = 99Food'],
        ['ID_TEMPO (FK)', 'DATA E HORA DO PEDIDO (dia)', 'Data'],
        ['ID_STATUS (FK)', 'STATUS FINAL DO PEDIDO', 'CANCELADO se "Horário do cancelamento" estiver preenchido; senão CONCLUIDO'],
        ['ID_PAGAMENTO (FK)', 'FORMA DE PAGAMENTO, padronizada', 'Forma de pagamento, padronizada'],
        ['ID_TIPO_ENTREGA (FK)', 'Entrega parceira iFood', 'Entrega da plataforma (99Food)'],
        ['VALOR_BRUTO_PEDIDO', 'VALOR DOS ITENS (R$)', 'Preço original do item'],
        ['VALOR_DESCONTOS', 'Incentivo promocional da loja + da rede + do iFood', 'Despesas de marketing (= Preço original − Receita de vendas)'],
        ['TAXA_MOTOBOY', '0 (a taxa de entrega é paga pelo cliente e repassada à logística)', 'Custos logísticos'],
        ['VALOR_TAXAS', '|TAXAS E COMISSOES (R$)|', 'Despesas de comissão + Taxas de processamento de pagamento'],
        ['VALOR_TOTAL_PAGO', 'TOTAL PAGO PELO CLIENTE (R$)', 'Receita de vendas'],
        ['VALOR_LIQUIDO', 'VALOR LIQUIDO (R$)', 'Receita real da loja']
      ]) +
      '<p class="nota-rodape"><strong>Regra ZERA FATOS:</strong> em pedido CANCELADO só o VALOR_BRUTO_PEDIDO é mantido (demanda perdida); ' +
      'descontos, motoboy, taxas, total pago e líquido ficam em 0, para não distorcer somas de faturamento.</p>' +
      '<p class="nota-rodape"><strong>Fechamento das contas (concluídos):</strong> iFood: líquido = bruto − desconto da loja − taxas. ' +
      '99Food: líquido = total pago − taxas − motoboy. Essas contas são conferidas no job 7.</p>' +

      h(3, 'man-decisoes', '6. Decisões de modelagem e pontos a validar com o parceiro') +
      '<ul>' +
      '  <li><strong>Taxa de serviço do iFood</strong> e <strong>taxa de entrega paga pelo cliente</strong> não são colunas do modelo. ' +
      '  Elas já estão dentro de VALOR_TOTAL_PAGO e só são usadas na conferência 2 do job 7. [A VALIDAR] se devem virar medidas.</li>' +
      '  <li><strong>Recompensas da plataforma (99Food)</strong> não entram em VALOR_DESCONTOS: são bônus pago à loja, não desconto ao ' +
      '  cliente, e não participam do fechamento do líquido.</li>' +
      '  <li><strong>Forma de pagamento "Online (sem detalhe)":</strong> o 99Food só informa "Pagamento online" ou "em dinheiro"; não dá ' +
      '  para separar Pix de cartão nesse canal.</li>' +
      '  <li><strong>Momento do pagamento</strong> (pelo app x na entrega) e <strong>hora/turno</strong> do pedido não existem no diagrama ' +
      '  v2 e, por isso, não são carregados.</li>' +
      '  <li><strong>FATO_META</strong> sai vazia da carga: nenhuma plataforma exporta metas. Liga-se às vendas pela DIM_TEMPO. No portal, ' +
      '  ela recebe uma linha por dia elegível de cada meta cadastrada na aba Metas.</li>' +
      '  <li><strong>Base pequena:</strong> os dados de agosto/2026 têm 19 pedidos no iFood e 67 no 99Food; os percentuais são indicativos.</li>' +
      '</ul>' +

      h(3, 'man-mudancas', '7. O que mudou em relação à versão anterior') +
      tabela(['Item', 'Antes', 'Agora (v2)'], [
        ['Arquivos exigidos', '5 (pedidos x2, conciliação, loja, custos)', '1 ou 2 (pedidos do iFood, do 99Food ou dos dois)'],
        ['Jobs', '0 a 7 e 9 (sem 8)', '0 a 7, em sequência'],
        ['DIM_PRODUTO', 'Carregada do cardápio', 'Retirada (decisão da professora: não será implementada)'],
        ['FATO_LANCAMENTO', 'Carregada da conciliação do iFood', 'Retirada: não está no diagrama'],
        ['DIM_PAGAMENTO', 'METODO_PAGAMENTO + MOMENTO_PAGAMENTO', 'FORMA_PAGAMENTO (como no diagrama)'],
        ['FATO_PEDIDO', '17 colunas (inclui HORA, TURNO, DESCONTO_LOJA, DESCONTO_PLATAFORMA, TAXA_ENTREGA_CLIENTE, CUSTO_LOGISTICO, TAXA_SERVICO)', '12 colunas, as do diagrama'],
        ['FATO_META', 'Inexistente', 'Criada vazia; preenchida pela aba Metas'],
        ['DIM_TEMPO', 'Coluna NOME_DIA_SEMNA (erro de grafia)', 'NOME_DIA_SEMANA no banco e nas exportações (o diagrama ainda traz NOME_DIA_SEMNA)'],
        ['Conferências', '3', '6'],
        ['Armazenamento', 'Só na memória da página, até fechá-la', 'Banco SQLite local, salvo no IndexedDB e, no Chrome e no Edge, num arquivo .sqlite vinculado; backup .zip (ou .sqlite) e restauração com prévia'],
        ['Importações repetidas', 'Cada execução começava do zero', 'Upsert por ID_PEDIDO: meses se acumulam e cada carga fica em CARGA_ETL'],
        ['Dados de demonstração', '—', 'Não há essa opção: só os relatórios reais importados']
      ]) +
      '</section>';
  }

  /* ---------- 4. Créditos ---------- */

  function creditos() {
    return '<section class="cartao manual creditos" aria-labelledby="man-creditos">' +
      '<div class="cartao__topo"><h2 id="man-creditos" tabindex="-1">' + ic('capelo', 20) + 'Créditos</h2></div>' +
      '<p>PUC Minas · Sistemas de Informação · Eixo 4 · 2026/02 · Prof.ª Juliana Santiago Teixeira · André Bacelar</p>' +
      '</section>';
  }

  function sumario() {
    return '<nav class="cartao manual-indice" aria-labelledby="man-indice-t">' +
      '<p class="manual-indice__titulo" id="man-indice-t">' + ic('lista', 18) + 'Neste manual</p>' +
      '<ul>' + SUMARIO.map(function (s) {
        return '<li' + (s[2] ? ' class="sub"' : '') + '><a href="#/manual" data-ancora="' + s[0] + '">' + BE.escapar(s[1]) + '</a></li>';
      }).join('') + '</ul></nav>';
  }

  function render(el) {
    el.innerHTML =
      '<h1 class="visualmente-oculto">Manual</h1>' +
      seguranca() +
      '<div class="manual-layout">' +
      sumario() +
      '<div class="manual-conteudo">' + comoUsar() + sobre() + creditos() + '</div>' +
      '</div>';

    /* O hash é a rota: o sumário rola até a seção sem trocar o endereço */
    el.querySelector('.manual-indice').addEventListener('click', function (e) {
      var a = e.target.closest('a[data-ancora]');
      if (!a) return;
      e.preventDefault();
      var alvo = document.getElementById(a.getAttribute('data-ancora'));
      if (!alvo) return;
      var suave = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      alvo.scrollIntoView({ behavior: suave ? 'smooth' : 'auto', block: 'start' });
      alvo.focus({ preventScroll: true });
    });
  }

  BE.telas.manual = { titulo: 'Manual', render: render };
})(window.BE);
