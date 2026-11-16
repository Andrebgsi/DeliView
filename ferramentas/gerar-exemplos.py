#!/usr/bin/env python3
"""
Gera as planilhas de EXEMPLO (dados fictícios) usadas na versão publicada do portal.

Saída: ../site/exemplos/ifood-dados-do-pedido-exemplo.xlsx
       ../site/exemplos/99food-dados-do-pedido-exemplo.xlsx

Os arquivos têm os mesmos cabeçalhos dos relatórios "Dados do pedido" do iFood e do 99Food,
mas todos os valores são inventados: loja, identificadores, clientes, horários e valores.
As contas fecham do mesmo jeito que o ETL confere, então a importação passa em todas as conferências.

Uso:  python3 gerar-exemplos.py [ano] [mes]      (padrão: 2026 9 = setembro de 2026)
Só usa a biblioteca padrão do Python. A semente é fixa: rodar de novo gera os mesmos arquivos.
"""
import calendar
import random
import sys
import uuid
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from xml.sax.saxutils import escape

ANO = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
MES = int(sys.argv[2]) if len(sys.argv) > 2 else 9
SAIDA = Path(__file__).resolve().parent.parent / "site" / "exemplos"
LOJA = "Loja Exemplo"
rnd = random.Random(20260901 + ANO * 100 + MES)

# ---------------------------------------------------------------- xlsx mínimo


def letra(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def celula(ref, v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return f'<c r="{ref}"><v>{v}</v></c>'
    return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{escape(str(v))}</t></is></c>'


def gravar_xlsx(caminho, aba, linhas):
    xml_linhas = []
    for n, linha in enumerate(linhas, start=1):
        cels = "".join(celula(f"{letra(i)}{n}", v) for i, v in enumerate(linha))
        xml_linhas.append(f'<row r="{n}">{cels}</row>')
    folha = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
             f'<sheetData>{"".join(xml_linhas)}</sheetData></worksheet>')
    arquivos = {
        "[Content_Types].xml":
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '</Types>',
        "_rels/.rels":
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            '</Relationships>',
        "xl/workbook.xml":
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            f'<sheets><sheet name="{escape(aba)}" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels":
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '</Relationships>',
        "xl/worksheets/sheet1.xml": folha,
    }
    caminho.parent.mkdir(parents=True, exist_ok=True)
    data_fixa = (ANO, MES, 1, 0, 0, 0)
    with zipfile.ZipFile(caminho, "w", zipfile.ZIP_DEFLATED) as z:
        for nome, conteudo in arquivos.items():
            info = zipfile.ZipInfo(nome, date_time=data_fixa)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, conteudo.encode("utf-8"))


# ---------------------------------------------------------------- apoio

def r2(v):
    return round(v + 1e-9, 2)


def br(v):
    """Número no formato do 99Food: vírgula decimal, sem zeros à direita."""
    s = f"{r2(v):.2f}".rstrip("0").rstrip(".")
    return s.replace(".", ",") if s else "0"


def dias_do_mes():
    for d in range(1, calendar.monthrange(ANO, MES)[1] + 1):
        yield datetime(ANO, MES, d)


def pedidos_no_dia(dia, base):
    peso = {0: 0.7, 1: 0.75, 2: 0.85, 3: 0.95, 4: 1.3, 5: 1.5, 6: 1.25}[dia.weekday()]
    crescimento = 1 + (dia.day / 30) * 0.25
    return max(0, round(rnd.gauss(base * peso * crescimento, 1.0)))


def horario(dia):
    if rnd.random() < 0.58:
        h = rnd.choice([11, 12, 12, 12, 13, 13, 14])
    else:
        h = rnd.choice([18, 19, 19, 20, 20, 21, 22])
    return dia.replace(hour=h, minute=rnd.randrange(60), second=rnd.randrange(60))


PRECOS = [18.9, 22.9, 24.9, 27.9, 29.9, 31.9, 32.9, 34.9, 35.9, 38.9, 42.9, 47.4, 49.9, 54.8, 59.8]


def itens():
    v = rnd.choice(PRECOS)
    if rnd.random() < 0.25:
        v += rnd.choice([6.0, 7.5, 9.9, 12.0])
    return r2(v)


# ---------------------------------------------------------------- iFood

CAB_IFOOD = ["ID COMPLETO DO PEDIDO", "NOME DA LOJA", "ID DA LOJA", "DATA E HORA DO PEDIDO", "TURNO",
             "ID CURTO DO PEDIDO", "STATUS FINAL DO PEDIDO", "VALOR DOS ITENS (R$)", "TOTAL PAGO PELO CLIENTE (R$)",
             "TAXA DE ENTREGA PAGA PELO CLIENTE (R$)", "INCENTIVO PROMOCIONAL DO IFOOD (R$)",
             "INCENTIVO PROMOCIONAL DA LOJA (R$)", "INCENTIVO PROMOCIONAL DA REDE (R$)", "TAXA DE SERVIÇO (R$)",
             "TAXAS E COMISSOES (R$)", "VALOR LIQUIDO (R$)", "FORMA DE PAGAMENTO", "TIPO DE ENTREGA",
             "PRODUTO LOGISTICO", "CANAL DE VENDA"]

PAG_IFOOD = ["Pgto via APP - PIX", "Pgto via APP - PIX", "Pgto via APP - Carteira Digital (Mastercard)",
             "Pgto via APP - Carteira Digital (Mastercard)", "Pgto via APP - Crédito (Visa)",
             "Pgto via APP - App do Banco", "Pgto na Entrega - Crédito (Mastercard)",
             "Pgto na Entrega - Crédito (Visa)", "Pgto na Entrega  - Débito (Mastercard)"]


def gerar_ifood():
    linhas = [CAB_IFOOD]
    curtos = set()
    for dia in dias_do_mes():
        for _ in range(pedidos_no_dia(dia, 2.4)):
            quando = horario(dia)
            cancelado = rnd.random() < 0.16
            bruto = itens()
            entrega = rnd.choice([0.0, 5.99, 7.99, 7.99, 9.99, 10.99])
            servico = 0.99
            inc_ifood = rnd.choice([0.0, 0.0, 0.0, 2.99, 5.0, 10.0])
            inc_loja = rnd.choice([0.0, 0.0, 0.0, 3.0, 5.0])
            taxas = r2(bruto * rnd.choice([0.12, 0.15, 0.20, 0.23]) + 1.0)
            pago = r2(bruto + entrega + servico - inc_ifood - inc_loja)
            liquido = r2(bruto - inc_loja - taxas)
            curto = rnd.randrange(1000, 9999)
            while curto in curtos:
                curto = rnd.randrange(1000, 9999)
            curtos.add(curto)
            linhas.append([
                str(uuid.UUID(int=rnd.getrandbits(128), version=4)), LOJA, "1000001",
                quando.strftime("%d/%m/%Y %H:%M:%S"), "ALMOÇO" if quando.hour < 16 else "JANTAR",
                str(curto), "CANCELADO" if cancelado else "CONCLUIDO",
                bruto, pago, entrega, inc_ifood, inc_loja, 0.0, servico, -taxas, liquido,
                rnd.choice(PAG_IFOOD), "ENTREGA", "ENTREGA PARCEIRA IFOOD", "iFood",
            ])
    return linhas


# ---------------------------------------------------------------- 99Food

CAB_99 = ["Data", "Nome do estabelecimento", "ID do loja", "Cidade", "Nome do signatário", "ID do signatário",
          "ID do pedido", "Horário do pedido", "Horário da conclusão", "Horário do cancelamento",
          "Tempo de pós-venda", "Receita de vendas", "Preço original do item", "Receita real da loja",
          "Despesas de marketing", "Despesas de comissão", "Taxas de processamento de pagamento",
          "Recompensas da plataforma", "Gorjeta", "Contagem do item", "Taxa de entrega original da loja",
          "Taxa de entrega paga por novos clientes", "ID do cliente que fez o pedido",
          "Quantidade de pedidos anteriores do cliente na loja", "Valor do reembolso",
          "Custo líquido da loja na oferta de entrega grátis", "Custos logísticos", "Tempo de preparo (minutos)",
          "Clicou em “Pronto para ser retirado”?", "Forma de pagamento", "Método de entrega",
          "Preparação atrasada?", "Parte responsável pelo cancelamento",
          "Motivos de cancelamentos por parte da loja", "Entrega verificada?", "Data da avaliação",
          "Nível de avaliação do cliente", "Conteúdo de avaliação do cliente", "Tag de avaliação do cliente",
          "Tempo para aceitação do pedido (segundos)", "Tempo de finalização do pedido (segundos)",
          "Duração da entrega (segundos)", "Tempo para confirmação do entregador parceiro (segundos)",
          "Tempo que o entregador parceiro levará para chegar à loja (segundos)",
          "Tempo entre o pedido ficar pronto e a chegada do entregador parceiro à loja (segundos)",
          "Tempo de espera da retirada pelo entregador parceiro (segundos)",
          "Tempo que o entregador parceiro levará para ir até o cliente (segundos)",
          "Tempo de espera do entregador parceiro pelo cliente (segundos)"]

MOTIVOS = [("Responsabilidade da loja", "A loja não confirmou o pedido no prazo"),
           ("Responsabilidade da plataforma", ""),
           ("Responsabilidade do cliente", "")]


def id19():
    return str(rnd.randrange(10 ** 18, 10 ** 19))


def gerar_99():
    linhas = [CAB_99]
    id_loja, id_sig = id19(), id19()
    clientes = [str(rnd.randrange(10 ** 14, 10 ** 15)) for _ in range(90)]
    vistos = {}
    for dia in dias_do_mes():
        for _ in range(pedidos_no_dia(dia, 5.6)):
            quando = horario(dia)
            cancelado = rnd.random() < 0.11
            fim = quando + timedelta(minutes=rnd.randrange(35, 95))
            original = itens()
            cliente = rnd.choice(clientes)
            anteriores = vistos.get(cliente, 0)
            vistos[cliente] = anteriores + 1
            if cancelado:
                receita = real = marketing = comissao = processamento = recompensa = logistica = 0.0
                parte, motivo = rnd.choice(MOTIVOS)
            else:
                marketing = rnd.choice([0.0, 0.0, 2.0, 4.0, 8.57, 10.0])
                receita = r2(original - marketing)
                comissao = r2(receita * 0.10)
                processamento = r2(receita * 0.035)
                logistica = rnd.choice([0.0, 3.99, 4.99, 6.49])
                real = r2(receita - comissao - processamento - logistica)
                recompensa = rnd.choice([0.0, 0.0, 2.0, 5.0])
                parte = motivo = ""
            avaliou = (not cancelado) and rnd.random() < 0.3
            linhas.append([
                dia.strftime("%Y%m%d"), LOJA, id_loja, "Cidade Exemplo", LOJA, id_sig, id19(),
                quando.strftime("%Y-%m-%d %H:%M:%S"), fim.strftime("%Y-%m-%d %H:%M:%S"),
                fim.strftime("%Y-%m-%d %H:%M:%S") if cancelado else "",
                fim.strftime("%Y-%m-%d %H:%M:%S") if cancelado else "",
                br(receita), br(original), br(real), br(marketing), br(comissao), br(processamento),
                br(recompensa), "0", str(rnd.choice([1, 1, 1, 2, 2, 3])), "0", "0",
                cliente, str(anteriores) if anteriores else "", "0",
                br(rnd.choice([0.0, 0.0, 1.99])) if not cancelado else "0", br(logistica),
                br(rnd.uniform(12, 35)), rnd.choice(["Sim", "Sim", "Não"]),
                "Pagamento online" if rnd.random() < 0.97 else "Pagamento em dinheiro",
                "Entrega da plataforma", rnd.choice(["Sim", "Não"]), parte, motivo, "Não",
                fim.strftime("%Y-%m-%d") if avaliou else "", str(rnd.choice([4, 5, 5, 5])) if avaliou else "",
                "", "", str(rnd.randrange(0, 60)), str(rnd.randrange(1500, 6000)),
                str(rnd.randrange(600, 2400)) if not cancelado else "0",
                str(rnd.randrange(60, 3000)), str(rnd.randrange(200, 900)), str(rnd.randrange(0, 2500)),
                str(rnd.randrange(0, 400)), str(rnd.randrange(400, 1800)) if not cancelado else "0",
                str(rnd.randrange(0, 120)),
            ])
    return linhas


if __name__ == "__main__":
    a = gerar_ifood()
    b = gerar_99()
    gravar_xlsx(SAIDA / "ifood-dados-do-pedido-exemplo.xlsx", "Página 1", a)
    gravar_xlsx(SAIDA / "99food-dados-do-pedido-exemplo.xlsx", "Sheet1", b)
    print(f"iFood: {len(a) - 1} pedidos · 99Food: {len(b) - 1} pedidos · {MES:02d}/{ANO} · em {SAIDA}")
