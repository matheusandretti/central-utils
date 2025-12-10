# arquivo sugerido: api/separador_csv_baixa_automatica_core.py

from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional, Tuple
import math

import pandas as pd


# Mesma ideia do script original:
# - sheet_name padrão "BAIXAS"
# - coluna para ano padrão "DATA EMISSÃO"
# - formatação de datas e decimais
COL_C = 2   # terceira coluna (C)
COL_G = 6   # sétima coluna (G)
DECIMAL_COLS = [5, 7, 8, 9, 10, 11, 12, 13]  # F, H, I, J, K, L, M, N (0-based)


def _normalize_colname(name: str) -> str:
  return str(name).strip().lower()


def _series_to_year(series: pd.Series) -> Optional[pd.Series]:
  s = pd.to_numeric(series, errors="coerce").astype("Int64")
  valid = (s >= 1900) & (s <= 2100)
  if valid.sum() == 0:
    return None
  return s.astype("Int64")


def _series_to_year_from_date(series: pd.Series) -> Optional[pd.Series]:
  dt = pd.to_datetime(series, errors="coerce", dayfirst=True, infer_datetime_format=True)
  if dt.notna().sum() == 0:
    return None
  return dt.dt.year.astype("Int64")


def _try_year_from_col(df: pd.DataFrame, forced_col: str) -> Tuple[pd.Series, str]:
  cols = list(df.columns)
  norm_forced = _normalize_colname(forced_col)
  col = forced_col if forced_col in df.columns else next(
    (c for c in cols if _normalize_colname(c) == norm_forced),
    None
  )
  if not col:
    raise ValueError(f"Coluna '{forced_col}' não encontrada.")

  yr = _series_to_year(df[col]) or _series_to_year_from_date(df[col])
  if yr is None:
    raise ValueError(f"Não foi possível extrair ANO da coluna '{col}'.")
  return yr, col


def _chunk_dataframe(df: pd.DataFrame, size: int) -> List[pd.DataFrame]:
  if size <= 0:
    return [df]
  n = int(math.ceil(len(df) / float(size)))
  return [df.iloc[i * size:(i + 1) * size] for i in range(n)]


def _format_columns(df: pd.DataFrame) -> pd.DataFrame:
  df = df.copy()

  # Colunas C e G como dd/mm/aaaa
  for col_idx in [COL_C, COL_G]:
    if col_idx < len(df.columns):
      col_name = df.columns[col_idx]
      df[col_name] = pd.to_datetime(df[col_name], errors="coerce", dayfirst=True)
      df[col_name] = df[col_name].dt.strftime("%d/%m/%Y")

  # Colunas decimais (F, H, I, J, K, L, M, N) com vírgula
  for col_idx in DECIMAL_COLS:
    if col_idx < len(df.columns):
      col_name = df.columns[col_idx]
      df[col_name] = pd.to_numeric(df[col_name], errors="coerce")
      df[col_name] = df[col_name].map(
        lambda x: f"{x:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
        if pd.notna(x) else ""
      )

  return df


def processar_baixa_automatica_arquivo(
  input_path: str,
  output_dir: str,
  sheet_name: str = "BAIXAS",
  year_source_column: str = "DATA EMISSÃO",
  max_linhas_por_arquivo: int = 50,
  csv_sep: str = ";",
) -> Dict:
  """
  Processa um Excel de baixas e gera vários CSVs no diretório de saída.

  Retorna:
      {
        "ok": bool,
        "arquivos_gerados": [
          {"arquivo": str, "ano": int, "linhas": int},
          ...
        ],
        "resumo_por_ano": {"2024": 123, "2025": 456, ...},
        "logs": [ "...", ... ],
        "output_dir": "caminho/absoluto"
      }
  """
  input_path = Path(input_path)
  output_dir_path = Path(output_dir)
  output_dir_path.mkdir(parents=True, exist_ok=True)

  logs: List[str] = []

  def _log(msg: str) -> None:
    logs.append(msg)

  _log(f"Lendo arquivo: {input_path.name}")

  engine = "openpyxl" if input_path.suffix.lower() in {".xlsx", ".xlsm"} else None

  try:
    df = pd.read_excel(
      input_path,
      sheet_name=sheet_name,
      engine=engine,
      dtype=object
    )
  except Exception as e:  # noqa: BLE001
    _log(f"Erro ao ler Excel: {e}")
    return {
      "ok": False,
      "arquivos_gerados": [],
      "resumo_por_ano": {},
      "logs": logs,
      "output_dir": str(output_dir_path),
    }

  df = df.dropna(how="all").copy()
  if df.empty:
    _log("Aba sem dados.")
    return {
      "ok": False,
      "arquivos_gerados": [],
      "resumo_por_ano": {},
      "logs": logs,
      "output_dir": str(output_dir_path),
    }

  try:
    anos_series, col_usada = _try_year_from_col(df, year_source_column)
    df["__ANO__"] = anos_series
    df = df.dropna(subset=["__ANO__"])
    df["__ANO__"] = df["__ANO__"].astype("Int64")
    _log(f"Coluna usada para ano: {col_usada}")
  except ValueError as e:
    _log(str(e))
    return {
      "ok": False,
      "arquivos_gerados": [],
      "resumo_por_ano": {},
      "logs": logs,
      "output_dir": str(output_dir_path),
    }

  if df.empty:
    _log("Após extrair ano, não restaram linhas válidas.")
    return {
      "ok": False,
      "arquivos_gerados": [],
      "resumo_por_ano": {},
      "logs": logs,
      "output_dir": str(output_dir_path),
    }

  arquivos_gerados: List[Dict] = []
  resumo_por_ano: Dict[str, int] = {}

  for ano, df_ano in df.groupby("__ANO__", dropna=True):
    ano_int = int(ano)
    df_ano = df_ano.drop(columns=["__ANO__"])
    df_ano = _format_columns(df_ano)

    partes = _chunk_dataframe(df_ano, max_linhas_por_arquivo)

    for idx, pedaco in enumerate(partes, start=1):
      out_name = f"{input_path.stem}__{ano_int}__parte-{idx:02d}.csv"
      out_path = output_dir_path / out_name

      pedaco.to_csv(out_path, sep=csv_sep, index=False, encoding="utf-8-sig")

      n_linhas = len(pedaco)
      arquivos_gerados.append({
        "arquivo": out_name,
        "ano": ano_int,
        "linhas": n_linhas,
      })
      resumo_por_ano[str(ano_int)] = resumo_por_ano.get(str(ano_int), 0) + n_linhas

      _log(f"Gerado {out_name} ({n_linhas} linhas)")

  if not arquivos_gerados:
    _log("Nenhum arquivo gerado para este Excel.")

  return {
    "ok": bool(arquivos_gerados),
    "arquivos_gerados": arquivos_gerados,
    "resumo_por_ano": resumo_por_ano,
    "logs": logs,
    "output_dir": str(output_dir_path),
  }
