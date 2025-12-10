# api/ajuste_diario_gfbr_core.py
from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Optional, Dict, Any

import numpy as np
import pandas as pd
from openpyxl import load_workbook

# ================== CONFIGURAÇÕES / CONSTANTES ==================

ABA_ESTORNOS = "Estornos"

COL_NUM_TRANS = "Nº transação"
COL_CONTA = "Cta.contáb./cód.PN"
COL_VALOR = "Débito/crédito (MC)"
COL_NOME_CONTA = "Cta.cont./Nome PN"
COL_TEXTO_BUSCA = ["Observações", "Série", "Nº doc."]

KEYWORDS = [
    "estornar",
    "estorno",
    "estornado",
    "cancel",
    "cancellation",
    "cancelamento",
    "anula",
    "anulação",
    "anulado",
]

REMOVER_PALAVRAS = [
    "saída",
    "invoice",
    "rend pago",
    "retorno",
    "renegociacao",
    "renegociação",
    "rec nf",
    "refaturamento",
    "aplicacao aut mais",
    "refaturado",
]

PADRAO_CLIENTE = re.compile(r"CL\d{3,6}", re.IGNORECASE)
PALAVRAS_RECEBIMENTO = [
    "banco",
    "imposto",
    "compensar",
    "descontos concedidos",
    "juros recebidos",
    "a compensar",
]

PADRAO_FORNECEDOR = re.compile(r"^\s*[Ff]\d{3,6}\s*$")
PADRAO_IMOBILIZADO = re.compile(r"^\s*1\s*\.\s*2\s*\.\s*2\s*\.", re.IGNORECASE)
PADRAO_TRANSITORIA_NOME = re.compile(r"transit", re.IGNORECASE)

TOL = 0.01


# ================== FUNÇÕES AUXILIARES ==================


def detectar_grupos(df: pd.DataFrame) -> pd.DataFrame:
    """
    Atribui um __grupo_id baseado em Nº transação, preenchendo linhas
    sem número de transação com IDs sintéticos.
    """
    g = df.copy()
    g["__grupo_id"] = g[COL_NUM_TRANS].ffill()
    mask_nan = g["__grupo_id"].isna()
    if mask_nan.any():
        sint = mask_nan.cumsum()
        g.loc[mask_nan, "__grupo_id"] = "SINT_" + sint.astype(str)
        g["__grupo_id"] = g["__grupo_id"].ffill()
    return g


def assinatura_grupo(sub: pd.DataFrame):
    """
    Assinatura de um grupo: soma por conta, com valores arredondados a 2 casas.
    Usada para identificar estornos com valores opostos.:contentReference[oaicite:12]{index=12}
    """
    tmp = sub[[COL_CONTA, COL_VALOR]].copy()
    tmp[COL_CONTA] = tmp[COL_CONTA].astype(str)
    tmp[COL_VALOR] = tmp[COL_VALOR].astype(float).round(2)
    agg = tmp.groupby(COL_CONTA, dropna=False, as_index=False)[COL_VALOR].sum()
    pairs = tuple(
      (row[COL_CONTA], float(row[COL_VALOR]))
      for _, row in agg.iterrows()
    )
    pairs = tuple(sorted(pairs))
    return pairs


def eh_estorno_por_palavra(sub: pd.DataFrame) -> bool:
    """
    Verifica se há palavras de estorno nas colunas de texto do grupo.:contentReference[oaicite:13]{index=13}
    """
    texto_total = " ".join(
        sub[c].astype(str).str.casefold().str.cat(sep=" ")
        for c in COL_TEXTO_BUSCA
        if c in sub.columns
    )
    return any(k in texto_total for k in (kw.casefold() for kw in KEYWORDS))


def assinaturas_opostas(sig1, sig2) -> bool:
    """
    Verifica se duas assinaturas são opostas (mesmas contas, valores opostos).:contentReference[oaicite:14]{index=14}
    """
    d1, d2 = dict(sig1), dict(sig2)
    if set(d1.keys()) != set(d2.keys()):
        return False
    for conta in d1.keys():
        if not np.isclose(d1[conta], -d2[conta], atol=TOL):
            return False
    return True


def encontrar_pares(df: pd.DataFrame):
    """
    Localiza pares de grupos que se anulam (estornos) e separa em:
    - df_est: linhas que formam os pares de estorno
    - df_rest: demais linhas
    :contentReference[oaicite:15]{index=15}
    """
    df = detectar_grupos(df)
    grupos = [(gid, sub) for gid, sub in df.groupby("__grupo_id", sort=False)]
    info = []
    for i, (gid, sub) in enumerate(grupos):
        info.append(
            dict(
                idx=i,
                gid=gid,
                assinatura=assinatura_grupo(sub),
                estorno_flag=eh_estorno_por_palavra(sub),
                pos_ini=sub.index.min(),
                pos_fim=sub.index.max(),
            )
        )

    pares, linhas = set(), []
    for i, cur in enumerate(info):
        if not cur["estorno_flag"]:
            continue
        for j in range(i - 1, -1, -1):
            prev = info[j]
            if j in pares or i in pares:
                continue
            if assinaturas_opostas(cur["assinatura"], prev["assinatura"]):
                pares.update({i, j})
                linhas.extend(
                    range(
                        grupos[j][1].index.min(), grupos[j][1].index.max() + 1
                    )
                )
                linhas.extend(
                    range(
                        grupos[i][1].index.min(), grupos[i][1].index.max() + 1
                    )
                )
                break

    linhas = sorted(set(linhas))
    df_est = df.loc[linhas].copy()
    df_rest = df.drop(index=linhas).copy()
    for d in (df_est, df_rest):
        d.drop(columns="__grupo_id", inplace=True, errors="ignore")
    return df_rest, df_est


def contem_remover_palavra(row: pd.Series) -> bool:
    """
    True se alguma palavra de REMOVER_PALAVRAS aparecer nas colunas de texto.:contentReference[oaicite:16]{index=16}
    """
    texto = " ".join(str(row.get(c, "")).casefold() for c in COL_TEXTO_BUSCA)
    return any(p in texto for p in (p.casefold() for p in REMOVER_PALAVRAS))


def grupo_recebimento(sub: pd.DataFrame) -> bool:
    """
    Identifica grupos de recebimento (cliente CLxxx + palavras de recebimento no nome).:contentReference[oaicite:17]{index=17}
    """
    codigos = " ".join(str(x) for x in sub[COL_CONTA].values)
    tem_cliente = PADRAO_CLIENTE.search(codigos)
    if not tem_cliente:
        return False
    nome_contas = " ".join(
        str(x).casefold()
        for x in sub.get(COL_NOME_CONTA, pd.Series([], dtype=str)).values
    )
    return any(p in nome_contas for p in PALAVRAS_RECEBIMENTO)


def classificar_codigo(cod: str) -> str:
    """
    Classifica o código contábil como fornecedor, imobilizado ou outro.:contentReference[oaicite:18]{index=18}
    """
    s = "" if pd.isna(cod) else str(cod)
    if PADRAO_FORNECEDOR.search(s):
        return "fornecedor"
    if PADRAO_IMOBILIZADO.search(s):
        return "imobilizado"
    return "outro"


def ajustar_transitoria_pairs(df: pd.DataFrame) -> pd.DataFrame:
    """
    Procura pares consecutivos com 'Transitoria' no nome e valores opostos.
    Remove SEMPRE as linhas transitórias e mantém preferencialmente
    fornecedor (Fxxxxx) x imobilizado (1.2.2.*); se não houver, mantém um par +/-,
    copiando o histórico do POSITIVO para o NEGATIVO.:contentReference[oaicite:19]{index=19}
    """
    g = detectar_grupos(df)
    groups = [(gid, sub) for gid, sub in g.groupby("__grupo_id", sort=False)]
    result_parts = []

    i = 0
    while i < len(groups):
        gid, sub = groups[i]
        is_trans = sub.get(
            COL_NOME_CONTA, pd.Series([], dtype=str)
        ).astype(str).str.contains(PADRAO_TRANSITORIA_NOME)
        if is_trans.any() and i + 1 < len(groups):
            gid2, sub2 = groups[i + 1]
            is_trans2 = sub2.get(
                COL_NOME_CONTA, pd.Series([], dtype=str)
            ).astype(str).str.contains(PADRAO_TRANSITORIA_NOME)

            if is_trans2.any():
                val_trans1 = sub.loc[is_trans, COL_VALOR].sum()
                val_trans2 = sub2.loc[is_trans2, COL_VALOR].sum()

                if abs(val_trans1 + val_trans2) < 0.01:
                    a_nt = sub.loc[~is_trans].copy()
                    b_nt = sub2.loc[~is_trans2].copy()

                    a_nt["__tipo"] = a_nt[COL_CONTA].apply(classificar_codigo)
                    b_nt["__tipo"] = b_nt[COL_CONTA].apply(classificar_codigo)

                    keep_a = a_nt.loc[
                        a_nt["__tipo"].isin(["fornecedor", "imobilizado"])
                    ].copy()
                    keep_b = b_nt.loc[
                        b_nt["__tipo"].isin(["fornecedor", "imobilizado"])
                    ].copy()

                    total_tipos = pd.concat(
                        [keep_a["__tipo"], keep_b["__tipo"]]
                    ).tolist()
                    if not (
                        ("fornecedor" in total_tipos)
                        and ("imobilizado" in total_tipos)
                    ):
                        comb = pd.concat(
                            [
                                a_nt.drop(columns="__tipo", errors="ignore"),
                                b_nt.drop(columns="__tipo", errors="ignore"),
                            ]
                        )
                        pos = comb.loc[comb[COL_VALOR] > 0]
                        neg = comb.loc[comb[COL_VALOR] < 0]
                        if not pos.empty and not neg.empty:
                            comb_keep = pd.concat(
                                [neg.iloc[[0]], pos.iloc[[0]]]
                            ).sort_index()
                        else:
                            comb_keep = comb
                    else:
                        comb_keep = pd.concat(
                            [
                                keep_a.drop(columns="__tipo", errors="ignore"),
                                keep_b.drop(columns="__tipo", errors="ignore"),
                            ]
                        ).sort_index()

                    if "Observações" in comb_keep.columns:
                        pos_hist = comb_keep.loc[
                            comb_keep[COL_VALOR] > 0, "Observações"
                        ]
                        if not pos_hist.empty:
                            hist_text = pos_hist.iloc[0]
                            comb_keep.loc[
                                comb_keep[COL_VALOR] < 0, "Observações"
                            ] = hist_text

                    result_parts.append(comb_keep)
                    i += 2
                    continue

        result_parts.append(sub)
        i += 1

    newg = pd.concat(result_parts).sort_index()
    if "__grupo_id" in newg.columns:
        newg = newg.drop(columns="__grupo_id")
    return newg


# ================== FUNÇÃO PRINCIPAL ==================


def ajustar_diario_gfbr(
    input_xlsx_path: str,
    aba_origem: Optional[str] = None,
    criar_backup: bool = True,
) -> Dict[str, Any]:
    """
    Executa todo o fluxo de ajuste do diário GFBR, modificando o arquivo
    Excel em disco e retornando um resumo do processamento.:contentReference[oaicite:20]{index=20}:contentReference[oaicite:21]{index=21}
    """
    caminho = Path(input_xlsx_path)
    if not caminho.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {caminho}")

    backup_path: Optional[str] = None
    if criar_backup:
        backup = caminho.with_suffix(".backup.xlsx")
        shutil.copyfile(caminho, backup)
        backup_path = str(backup)

    # 0) Carrega DF ORIGINAL
    xl = pd.ExcelFile(caminho, engine="openpyxl")
    aba = aba_origem or xl.sheet_names[0]
    df_original = pd.read_excel(caminho, sheet_name=aba, engine="openpyxl")
    total_rows = len(df_original)

    # 1) Ajusta pares Transitoria no DF ORIGINAL
    df1 = ajustar_transitoria_pairs(df_original)

    # 2) Estornos -> separa
    df_rest, df_est = encontrar_pares(df1)

    # 3) Limpeza (recebimentos e palavras) sobre df_rest
    grupos = detectar_grupos(df_rest)
    remover = []

    grupos_recebimento = 0
    grupos_palavra = 0

    for gid, sub in grupos.groupby("__grupo_id"):
        if grupo_recebimento(sub):
            grupos_recebimento += 1
            remover.extend(sub.index)
        else:
            if sub.apply(contem_remover_palavra, axis=1).any():
                grupos_palavra += 1
                remover.extend(sub.index)

    df_final = grupos.loc[~grupos.index.isin(remover)].copy()
    for d in (df_final, df_est):
        d.drop(columns="__grupo_id", inplace=True, errors="ignore")

    # 4) Escreve Estornos em aba própria
    with pd.ExcelWriter(
        caminho, engine="openpyxl", mode="a", if_sheet_exists="replace"
    ) as w:
        df_est.to_excel(w, sheet_name=ABA_ESTORNOS, index=False)

    # 5) Remove linhas na planilha física preservando formatação
    manter_rows_1based = set((df_final.index + 2).tolist())  # +2 por causa do header
    total_rows_original = len(df_original)

    # IMPORTANTE: abrir como file-like para o openpyxl não checar a extensão
    with open(caminho, "rb") as fh:
        wb = load_workbook(fh)

    ws = wb[aba]

    for r in range(total_rows_original + 1, 1, -1):
        if r not in manter_rows_1based:
            ws.delete_rows(r)

    wb.save(caminho)

    rows_final = len(df_final)
    rows_removed = total_rows_original - rows_final
    num_linhas_estornos = len(df_est)

    resumo = {
        "total_rows": int(total_rows_original),
        "rows_final": int(rows_final),
        "rows_removed": int(rows_removed),
        "num_linhas_estornos": int(num_linhas_estornos),
        "num_grupos_recebimento_removidos": int(grupos_recebimento),
        "num_grupos_palavra_removidos": int(grupos_palavra),
        "aba_utilizada": aba,
        "backup_path": backup_path,
        "mensagem": (
            "Diário ajustado com sucesso; estornos enviados para a aba "
            f"'{ABA_ESTORNOS}' e linhas removidas diretamente na planilha."
        ),
    }

    return resumo
