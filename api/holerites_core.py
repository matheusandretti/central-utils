# api/holerites_core.py

from pathlib import Path
from typing import Dict, List
from zipfile import ZipFile, ZIP_DEFLATED
import re

import pdfplumber
from PyPDF2 import PdfReader, PdfWriter


def simplify_name(name: str) -> str:
    """Normaliza o nome da empresa, removendo acentos e caracteres especiais."""
    import unicodedata
    name = name.replace("&", " E ")
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    name = name.upper()
    name = re.sub(r"[^A-Z0-9 ]+", " ", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name


def extract_first_line_pdfplumber(page):
    """
    Extrai a primeira linha (topo/esquerda) da página usando pdfplumber.
    """
    words = page.extract_words(x_tolerance=1, y_tolerance=1, keep_blank_chars=False)
    if not words:
        return ""
    min_top = min(w.get("top", 0) for w in words)
    tol = 4
    same_line = [w for w in words if abs(w.get("top", 0) - min_top) <= tol]
    same_line.sort(key=lambda w: w.get("x0", 0))
    return " ".join(w.get("text", "").strip() for w in same_line if w.get("text", "").strip())


def extract_company_from_page_plumber(page):
    """
    Usa a primeira linha da página como base para o nome da empresa.
    Fallback: primeira linha de texto extraído.
    """
    candidate = re.sub(r"\s+", " ", (extract_first_line_pdfplumber(page) or "")).strip()
    if candidate:
        if re.match(r"^\d{1,6}\s+.+$", candidate):
            return candidate
        if len(candidate) >= 3:
            return candidate

    try:
        txt = page.extract_text() or ""
        for ln in txt.splitlines():
            s = ln.strip()
            if s:
                return s
    except Exception:
        pass

    return "DESCONHECIDO"


def split_pdf_holerites(input_pdf: Path, out_dir: Path, competencia: str) -> Path:
    """
    Holerites: separa por empresa usando pdfplumber (primeira linha da página).
    Gera um ZIP com um PDF por empresa.
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    reader = PdfReader(str(input_pdf))
    company_pages: Dict[str, List[int]] = {}

    with pdfplumber.open(str(input_pdf)) as pdf:
        for idx, page in enumerate(pdf.pages):
            company_raw = extract_company_from_page_plumber(page)
            key = simplify_name(company_raw) if company_raw else f"DESCONHECIDO_PAG_{idx+1}"
            company_pages.setdefault(key, []).append(idx)

    created_paths: List[Path] = []

    for key, pages in company_pages.items():
        writer = PdfWriter()
        for p in pages:
            writer.add_page(reader.pages[p])

        out_path = out_dir / f"{key} {competencia}.pdf"
        with open(out_path, "wb") as f:
            writer.write(f)

        created_paths.append(out_path)

    zip_path = out_dir / f"{input_pdf.stem}_empresas_{competencia}.zip"
    with ZipFile(zip_path, "w", compression=ZIP_DEFLATED) as zf:
        for p in created_paths:
            zf.write(p, arcname=p.name)

    return zip_path
