# arquivo sugerido: backend/separador_relatorio_ferias_api.py

#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Backend FastAPI para separar PDF de "Relatório de Férias" por empresa.

Recebe via JSON:
    - input_pdf_path: caminho absoluto do PDF salvo pelo Node (multer)
    - competencia: string da competência (ex.: "112025")
    - output_dir (opcional): pasta onde o ZIP será gerado

Retorna JSON com:
    - ok: bool
    - zip_path: caminho absoluto do ZIP gerado
"""

import os
import re
import unicodedata
import time
from pathlib import Path
from typing import Dict, List

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from zipfile import ZipFile, ZIP_DEFLATED

from PyPDF2 import PdfReader, PdfWriter  # requer: pip install PyPDF2

app = FastAPI(title="Separador Relatório de Férias API")


class SeparadorParams(BaseModel):
    input_pdf_path: str
    competencia: str
    output_dir: str | None = None


def simplify_name(name: str) -> str:
    """Normaliza o nome da empresa, removendo acentos e caracteres especiais."""
    name = name.replace("&", " E ")
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    name = name.upper()
    name = re.sub(r"[^A-Z0-9 ]+", " ", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name  # :contentReference[oaicite:10]{index=10}


def extract_company_from_page_text(text: str) -> str:
    """
    Tenta extrair o nome da empresa da parte superior da página.

    Padrões:
    1) "<EMPRESA> Página: N"
    2) Linha imediatamente anterior à que contém "Folha de Pagamento"
    3) Primeira linha não vazia
    """
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    first_line = lines[0] if lines else ""

    m = re.search(r"(.+?)\s+P[aá]gina\s*:\s*\d+", first_line, flags=re.IGNORECASE)
    if m:
        return m.group(1).strip()

    for i, ln in enumerate(lines):
        if "Folha de Pagamento" in ln:
            if i > 0:
                return lines[i - 1].strip()

    return first_line.strip() or "DESCONHECIDO"  # :contentReference[oaicite:11]{index=11}


def split_pdf_by_company(input_pdf: Path, out_dir: Path, competencia: str) -> Path:
    inicio_total = time.time()

    out_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    reader = PdfReader(str(input_pdf))
    print(f"[PY] Leitura do PDF: {time.time() - t0:.2f} s")

    t1 = time.time()
    company_pages: Dict[str, List[int]] = {}

    for idx, page in enumerate(reader.pages):
        t_p_ini = time.time()
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        company = extract_company_from_page_text(text) or f"DESCONHECIDO_PAG_{idx+1}"
        company_pages.setdefault(company, []).append(idx)
        print(f"[PY] Página {idx+1}: {time.time() - t_p_ini:.2f} s")
    print(f"[PY] Loop páginas: {time.time() - t1:.2f} s")

    t2 = time.time()
    created_files: list[Path] = []
    for company, pages in company_pages.items():
        writer = PdfWriter()
        for p in pages:
            writer.add_page(reader.pages[p])
        simple_name = simplify_name(company)
        filename = f"{simple_name} {competencia}.pdf"
        out_path = out_dir / filename
        with open(out_path, "wb") as f:
            writer.write(f)
        created_files.append(out_path)
    print(f"[PY] Geração dos PDFs por empresa: {time.time() - t2:.2f} s")

    t3 = time.time()
    zip_name = f"{input_pdf.stem}_empresas_{competencia}.zip"
    zip_path = out_dir / zip_name
    with ZipFile(zip_path, "w", compression=ZIP_DEFLATED) as zf:
        for f in sorted(created_files):
            zf.write(f, arcname=f.name)
    print(f"[PY] Criação do ZIP: {time.time() - t3:.2f} s")

    print(f"[PY] Tempo total processamento: {time.time() - inicio_total:.2f} s")
    return zip_path


@app.post("/api/separador-pdf-relatorio-de-ferias/processar")
def processar_separador(params: SeparadorParams):
    input_pdf = Path(params.input_pdf_path)
    if not input_pdf.is_file():
        raise HTTPException(status_code=400, detail="Arquivo PDF de entrada não encontrado no servidor.")

    competencia = params.competencia.strip()
    if not competencia:
        raise HTTPException(status_code=400, detail="Competência não informada.")

    if params.output_dir:
        out_dir = Path(params.output_dir)
    else:
        # pasta "output" ao lado do arquivo de entrada
        out_dir = input_pdf.parent / "output"

    try:
        zip_path = split_pdf_by_company(input_pdf, out_dir, competencia)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao processar PDF: {e}")

    return {
        "ok": True,
        "zip_path": str(zip_path),
    }


# Para rodar:
# uvicorn separador_relatorio_ferias_api:app --reload --port 8001
