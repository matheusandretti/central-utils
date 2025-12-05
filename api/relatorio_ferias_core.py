# api/relatorio_ferias_core.py

from pathlib import Path
from typing import Dict, List
from zipfile import ZipFile, ZIP_DEFLATED
import re

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
        if "Folha de Pagamento" in ln and i > 0:
            return lines[i - 1].strip()

    return first_line or "DESCONHECIDO"


def split_pdf_relatorio_ferias(input_pdf: Path, out_dir: Path, competencia: str) -> Path:
    """
    Relatório de férias: separa por empresa usando extração de texto normal.
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    reader = PdfReader(str(input_pdf))
    company_pages: Dict[str, List[int]] = {}

    for idx, page in enumerate(reader.pages):
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        company = extract_company_from_page_text(text)
        company_pages.setdefault(company, []).append(idx)

    created_files: List[Path] = []

    for company, pages in company_pages.items():
        writer = PdfWriter()
        for p in pages:
            writer.add_page(reader.pages[p])

        out_path = out_dir / f"{simplify_name(company)} {competencia}.pdf"
        with open(out_path, "wb") as f:
            writer.write(f)

        created_files.append(out_path)

    zip_path = out_dir / f"{input_pdf.stem}_empresas_{competencia}.zip"
    with ZipFile(zip_path, "w", compression=ZIP_DEFLATED) as zf:
        for f in created_files:
            zf.write(f, arcname=f.name)

    return zip_path
