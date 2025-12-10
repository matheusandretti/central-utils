# api/importador_recebimentos_madre_scp_core.py
from __future__ import annotations

from pathlib import Path
from datetime import datetime
import os
import re

try:
    import pdfplumber
    import pandas as pd
except ImportError as exc:
    # Deixe o erro claro no log do backend
    raise RuntimeError(
        "Dependências faltando para Importador Recebimentos Madre SCP. "
        "Instale: pdfplumber, pandas, XlsxWriter."
    ) from exc

# Configurações de parsing (baseadas no script original) :contentReference[oaicite:11]{index=11}
ACCOUNT_REGEX = re.compile(r"\bSCO_[A-Z0-9_]+\b")
DATE_REGEX = re.compile(r"\d{2}/\d{2}/\d{4}")
MONEY_REGEX = re.compile(r"\d{1,3}(?:\.\d{3})*,\d{2}")
TOTAL_CLIENTE_REGEX = re.compile(r"Total do cliente", re.IGNORECASE)


def clean_spaces(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()  # :contentReference[oaicite:12]{index=12}


def br_money_to_float(s):
    if isinstance(s, str):
        return float(s.replace(".", "").replace(",", "."))
    return s  # :contentReference[oaicite:13]{index=13}


def extrair_registros(pdf_path: Path) -> list[str]:
    """
    Percorre as páginas do PDF e costura linhas de cada lançamento.
    Retorna uma lista de strings, cada uma representando um lançamento bruto.:contentReference[oaicite:14]{index=14}
    """
    registros: list[str] = []
    with pdfplumber.open(str(pdf_path)) as pdf:  # pdfplumber espera caminho str
        for page in pdf.pages:
            text = page.extract_text() or ""
            text = text.replace("\xa0", " ")
            linhas = text.split("\n")

            buffer = ""
            for linha in linhas:
                linha = clean_spaces(linha)
                if TOTAL_CLIENTE_REGEX.search(linha):
                    buffer = ""
                    continue

                # nova data -> flush anterior, se estiver completo
                if re.match(r"^\d{2}/\d{2}/\d{4}\b", linha) and buffer:
                    if len(MONEY_REGEX.findall(buffer)) >= 6:
                        registros.append(buffer.strip())
                    buffer = linha
                else:
                    buffer += (" " if buffer else "") + linha

                # flush automático se já tem 6+ valores monetários
                if len(MONEY_REGEX.findall(buffer)) >= 6:
                    registros.append(buffer.strip())
                    buffer = ""

            # flush final da página
            if len(MONEY_REGEX.findall(buffer)) >= 6:
                registros.append(buffer.strip())
    return registros  # :contentReference[oaicite:15]{index=15}


def parsear_registros(registros: list[str]) -> "pd.DataFrame":
    """
    Transforma cada string bruta em um dicionário com os campos desejados.:contentReference[oaicite:16]{index=16}
    """
    parsed = []
    for rec in registros:
        try:
            amounts = MONEY_REGEX.findall(rec)
            if len(amounts) < 6:
                continue

            # últimos 6 campos monetários (ordem baseada no layout observado):contentReference[oaicite:17]{index=17}
            vl_baixa, acrescimo, seguro, taxa_adm, desconto, liquido = amounts[-6:]

            # conta corrente
            acc_match = ACCOUNT_REGEX.search(rec)
            conta_corrente = acc_match.group(0) if acc_match else ""  # :contentReference[oaicite:18]{index=18}

            # datas
            datas = DATE_REGEX.findall(rec)
            dt_baixa = datas[0] if datas else ""
            data_vecto = datas[-1] if len(datas) > 1 else ""  # :contentReference[oaicite:19]{index=19}

            # cliente: trecho entre dt_baixa e o primeiro valor monetário:contentReference[oaicite:20]{index=20}
            first_money = rec.find(amounts[0])
            cliente = clean_spaces(rec)
            if dt_baixa:
                start = cliente.find(dt_baixa) + len(dt_baixa)
                cliente = (
                    cliente[start:first_money] if first_money != -1 else cliente[start:]
                )
            cliente = re.sub(r"\(\d+\)", "", cliente).strip(" -")

            parsed.append(
                {
                    "Dt. baixa": dt_baixa,
                    "Cliente": cliente,
                    "Data vecto": data_vecto,
                    "Vl. baixa": vl_baixa,
                    "Acréscimo": acrescimo,
                    "Líquido": liquido,
                    "Conta corrente": conta_corrente,
                }
            )
        except Exception:
            continue

    return pd.DataFrame(parsed)


def expandir_campos_cliente(df: "pd.DataFrame") -> "pd.DataFrame":
    """
    A partir de 'Cliente', cria colunas:
      - nome do cliente, documento, titulo, parcela, TC, Unid. princ, port, oper, data, data vecto.:contentReference[oaicite:21]{index=21}
    """

    def parse_cliente(texto: str):
        if not isinstance(texto, str):
            return {
                "nome do cliente": "",
                "documento": "",
                "titulo": "",
                "parcela": "",
                "TC": "",
                "Unid. princ": "",
                "port": "",
                "oper": "",
                "data": "",
                "data vecto": "",
            }

        tokens = [t for t in texto.split() if t]

        if len(tokens) < 7:
            # não tem tokens suficientes – considere tudo como nome
            return {
                "nome do cliente": texto.strip(),
                "documento": "",
                "titulo": "",
                "parcela": "",
                "TC": "",
                "Unid. princ": "",
                "port": "",
                "oper": "",
                "data": "",
                "data vecto": "",
            }  # :contentReference[oaicite:22]{index=22}

        # heurística a partir do fim (documento, titulo, parcela, TC, Unid. princ, port, oper):contentReference[oaicite:23]{index=23}
        oper = tokens[-1]
        port = tokens[-2]
        unid_princ = tokens[-3]
        tc = tokens[-4]
        parcela = tokens[-5]
        titulo = tokens[-6]
        documento = tokens[-7]
        nome = " ".join(tokens[:-7]).strip()

        return {
            "nome do cliente": nome,
            "documento": documento,
            "titulo": titulo,
            "parcela": parcela,
            "TC": tc,
            "Unid. princ": unid_princ,
            "port": port,
            "oper": oper,
            "data": "",
            "data vecto": "",
        }

    parsed_rows = df["Cliente"].map(parse_cliente).tolist()
    parsed_df = pd.DataFrame(parsed_rows, index=df.index)
    df_out = pd.concat([df, parsed_df], axis=1)
    return df_out


def salvar_excel(df: "pd.DataFrame", output_path: Path) -> tuple[Path, "pd.DataFrame", "pd.DataFrame"]:
    """
    Gera o Excel com 'Detalhe' e 'Resumo por Cliente' formatados e retorna
    (output_path, summary, df_final).:contentReference[oaicite:24]{index=24}
    """
    # Colunas numéricas para somar
    for col in ["Vl. baixa", "Acréscimo", "Líquido"]:
        df[col + " (num)"] = df[col].map(br_money_to_float)

    # remove duplicados óbvios
    df_final = df.drop_duplicates(
        subset=["Cliente", "Dt. baixa", "Data vecto", "Vl. baixa", "Acréscimo", "Líquido"]
    ).copy()

    # 🔹 remove linhas de totais do relatório (ex.: "Total da empresa", "Total geral")
    mask_totais = (
        df_final["Cliente"]
        .fillna("")
        .str.strip()
        .str.upper()
        .str.startswith("TOTAL ")
    )
    df_final = df_final[~mask_totais]

    # resumo por cliente (agora sem linhas de total)
    summary = (
        df_final.groupby("Cliente", as_index=False)[
            ["Vl. baixa (num)", "Acréscimo (num)", "Líquido (num)"]
        ]
        .sum()
        .sort_values("Líquido (num)", ascending=False)
    )

    # Garante diretório
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Decide quais colunas mostrar na planilha "Detalhe":contentReference[oaicite:27]{index=27}
    cols_detalhe = [
        "Dt. baixa",
        "nome do cliente" if "nome do cliente" in df_final.columns else "Cliente",
        "Unid. princ",
        "Vl. baixa",
        "Acréscimo",
        "Líquido",
        "Conta corrente",
    ]
    cols_detalhe = [c for c in cols_detalhe if c in df_final.columns]

    with pd.ExcelWriter(output_path, engine="xlsxwriter") as writer:
        # Detalhe
        df_export = df_final[cols_detalhe].copy()
        df_export.to_excel(writer, index=False, sheet_name="Detalhe")
        workbook = writer.book
        ws_det = writer.sheets["Detalhe"]

        header_fmt = workbook.add_format({"bold": True, "border": 1})
        money_fmt = workbook.add_format({"num_format": u"R$ #,##0.00"})

        # Ajuste de larguras e formatação, mantendo lógica do script original:contentReference[oaicite:28]{index=28}
        if "Dt. baixa" in cols_detalhe:
            ws_det.set_column(cols_detalhe.index("Dt. baixa"), cols_detalhe.index("Dt. baixa"), 12)
        if ("nome do cliente" in cols_detalhe) or ("Cliente" in cols_detalhe):
            colname = "nome do cliente" if "nome do cliente" in cols_detalhe else "Cliente"
            ws_det.set_column(cols_detalhe.index(colname), cols_detalhe.index(colname), 45)
        if "Data vecto" in cols_detalhe:
            ws_det.set_column(cols_detalhe.index("Data vecto"), cols_detalhe.index("Data vecto"), 12)

        for money_col in ["Vl. baixa", "Acréscimo", "Líquido"]:
            if money_col in cols_detalhe:
                idx = cols_detalhe.index(money_col)
                ws_det.set_column(idx, idx, 14, money_fmt)

        if "Conta corrente" in cols_detalhe:
            idx = cols_detalhe.index("Conta corrente")
            ws_det.set_column(idx, idx, 18)

        # cabeçalhos e filtros
        for col_idx, col_name in enumerate(df_export.columns):
            ws_det.write(0, col_idx, col_name, header_fmt)

        ws_det.autofilter(0, 0, len(df_export), df_export.shape[1] - 1)
        ws_det.freeze_panes(1, 0)

        # Resumo por Cliente em aba separada
        summary_export = summary.rename(
            columns={
                "Vl. baixa (num)": "Vl. baixa",
                "Acréscimo (num)": "Acréscimo",
                "Líquido (num)": "Líquido",
            }
        )
        summary_export.to_excel(writer, index=False, sheet_name="Resumo por Cliente")
        ws_sum = writer.sheets["Resumo por Cliente"]
        for col_idx, col_name in enumerate(summary_export.columns):
            ws_sum.write(0, col_idx, col_name, header_fmt)
        ws_sum.set_column("A:A", 45)
        ws_sum.set_column("B:D", 16, money_fmt)
        ws_sum.autofilter(0, 0, len(summary_export), summary_export.shape[1] - 1)
        ws_sum.freeze_panes(1, 0)

    return output_path, summary, df_final


def processar_importador_recebimentos_madre_scp(
    pdf_path: str | Path,
    output_dir: str | Path | None = None,
) -> dict:
    """
    Pipeline principal para uso via API:
      - recebe caminho do PDF
      - processa registros
      - gera Excel (Detalhe + Resumo por Cliente)
      - retorna metadados e resumo para o front-end.:contentReference[oaicite:29]{index=29}
    """
    pdf_path = Path(pdf_path)

    if output_dir is None:
        output_dir = pdf_path.parent
    else:
        output_dir = Path(output_dir)

    output_dir.mkdir(parents=True, exist_ok=True)

    registros = extrair_registros(pdf_path)
    if not registros:
        raise RuntimeError("Nenhum lançamento encontrado. Verifique se o PDF é o esperado.")

    df = parsear_registros(registros)
    if df.empty:
        raise RuntimeError("Não foi possível parsear os lançamentos.")

    df = expandir_campos_cliente(df)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    excel_path = output_dir / f"Contas_Recebidas_{timestamp}.xlsx"

    excel_path, summary, df_final = salvar_excel(df, excel_path)

    totais = {
        "vl_baixa": float(summary["Vl. baixa (num)"].sum())
        if "Vl. baixa (num)" in summary.columns
        else 0.0,
        "acrescimo": float(summary["Acréscimo (num)"].sum())
        if "Acréscimo (num)" in summary.columns
        else 0.0,
        "liquido": float(summary["Líquido (num)"].sum())
        if "Líquido (num)" in summary.columns
        else 0.0,
    }

    resumo_clientes = []
    for _, row in summary.iterrows():
        resumo_clientes.append(
            {
                "cliente": row.get("Cliente", ""),
                "vl_baixa": float(row.get("Vl. baixa (num)", 0.0)),
                "acrescimo": float(row.get("Acréscimo (num)", 0.0)),
                "liquido": float(row.get("Líquido (num)", 0.0)),
            }
        )

    return {
        "output_excel_path": str(excel_path),
        "output_excel_name": excel_path.name,
        "total_registros": int(len(df_final)),
        "total_clientes": int(len(summary)),
        "totais": totais,
        "resumo_clientes": resumo_clientes,
    }
