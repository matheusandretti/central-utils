# arquivo sugerido: api/comprimir_pdf_core.py
from __future__ import annotations

from typing import Dict, Any

import fitz  # PyMuPDF


def comprimir_pdf_bytes(
    pdf_bytes: bytes,
    jpeg_quality: int = 50,
    dpi_scale: float = 1.0,
) -> Dict[str, Any]:
    """
    Converte um PDF para tons de cinza, aplicando compressão nas páginas,
    e devolve o PDF resultante em memória + métricas de tamanho.
    """

    # Abre o PDF de entrada a partir de bytes
    in_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    out_doc = fitz.open()

    for page in in_doc:
        # Renderiza a página em tons de cinza com a escala configurada
        pix = page.get_pixmap(
            matrix=fitz.Matrix(dpi_scale, dpi_scale),
            colorspace=fitz.csGRAY,
        )
        img_bytes = pix.tobytes("jpeg", jpg_quality=jpeg_quality)

        # Cria nova página no PDF de saída e insere a imagem
        width_pt, height_pt = pix.width, pix.height
        new_page = out_doc.new_page(width=width_pt, height=height_pt)
        rect = fitz.Rect(0, 0, width_pt, height_pt)
        new_page.insert_image(rect, stream=img_bytes)

    output_bytes = out_doc.tobytes()

    in_doc.close()
    out_doc.close()

    original_size = len(pdf_bytes)
    compressed_size = len(output_bytes)
    reduction_percent = (
        (1 - compressed_size / original_size) * 100 if original_size else 0.0
    )

    return {
        "original_size": original_size,
        "compressed_size": compressed_size,
        "reduction_percent": reduction_percent,
        "compressed_bytes": output_bytes,
    }
