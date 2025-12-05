# arquivo sugerido: api/separador_ferias_funcionario_core.py

from __future__ import annotations

import re
import zipfile
from pathlib import Path
from typing import List, Dict

from PyPDF2 import PdfReader, PdfWriter  # requer PyPDF2 instalado


def extrair_texto(pagina) -> str:
    """Wrapper seguro para extrair texto de uma página de PDF."""
    try:
        return pagina.extract_text() or ""
    except Exception:
        return ""


def encontrar_empresa(texto: str) -> str | None:
    """
    Tenta localizar o nome da empresa em padrões do tipo:
    EMPRESA : <nome> ou Empresa : <nome>
    """
    padroes = [
        r"EMPRESA\s*:\s*(.+)",
        r"Empresa\s*:\s*(.+)",
    ]
    for padrao in padroes:
        m = re.search(padrao, texto, flags=re.IGNORECASE)
        if m:
            empresa = m.group(1).strip()
            empresa = empresa.splitlines()[0].strip(" :-\u200b")
            return empresa
    return None


def encontrar_nome_funcionario(textos: list[str]) -> str | None:
    """
    Tenta achar o nome do funcionário nos textos das páginas do bloco.

    1) Linha "NOME COMPLETO : <nome>"
    2) No Aviso: linha com "Ilmo Sr(a)." seguida do nome antes de "Código:"
    """
    # 1) NOME COMPLETO :
    for t in textos:
        m = re.search(r"NOME\s+COMPLETO\s*:\s*(.+)", t, flags=re.IGNORECASE)
        if m:
            nome = m.group(1).strip()
            nome = nome.splitlines()[0].strip(" :-\u200b")
            if nome:
                return nome

    # 2) Ilmo Sr(a). <nome> Código:
    for t in textos:
        m = re.search(
            r"Ilmo\s*Sr\(a\)\.\s*(.+?)\s+Código\s*:",
            t,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if m:
            nome = m.group(1).strip()
            nome = nome.replace("\n", " ").strip(" :-\u200b")
            if nome:
                return nome

    return None


def sanitizar_para_arquivo(nome: str) -> str:
    """Remove caracteres proibidos em nomes de arquivo e compacta espaços."""
    nome = re.sub(r'[<>:"/\\|?*\n\r\t]', " ", nome)
    nome = re.sub(r"\s{2,}", " ", nome).strip()
    return nome


def caminho_unico(base_dir: Path, base_nome: str, ext: str = ".pdf") -> Path:
    """
    Gera um caminho único no formato:
    base_nome + ext
    base_nome + " 2" + ext
    base_nome + " 3" + ext
    ...
    """
    n = 1
    while True:
        if n == 1:
            candidato = base_dir / f"{base_nome}{ext}"
        else:
            candidato = base_dir / f"{base_nome} {n}{ext}"
        if not candidato.exists():
            return candidato
        n += 1


def processar_ferias_por_funcionario(pdf_path: Path | str) -> Dict:
  """
  Processa o PDF de férias e gera PDFs individuais por funcionário + um ZIP consolidando tudo.

  Retorna:
    {
      "empresa": str,
      "total_paginas": int,
      "total_funcionarios": int,
      "pasta_saida": str,
      "zip_path": str,
      "arquivos": [str, ...],
    }
  """
  pdf_path = Path(pdf_path)
  if not pdf_path.exists():
    raise FileNotFoundError(f"Arquivo não encontrado: {pdf_path}")

  reader = PdfReader(str(pdf_path))

  # Detecta a empresa nas primeiras páginas (até 6)
  empresa = None
  for idx in range(min(6, len(reader.pages))):
    texto = extrair_texto(reader.pages[idx])
    empresa = encontrar_empresa(texto)
    if empresa:
      break

  if not empresa:
    empresa = "sem_empresa"

  # Pasta da empresa (nível 1)
  pasta_empresa = pdf_path.parent / f"FERIAS - {sanitizar_para_arquivo(empresa)}"
  pasta_empresa.mkdir(exist_ok=True)

  # Subpasta por execução / por arquivo de origem (nível 2)
  # ex: FERIAS - MINHA EMPRESA/1764938570212-FERIAS TAXCO/
  nome_lote = sanitizar_para_arquivo(pdf_path.stem)
  pasta_saida = pasta_empresa / nome_lote
  pasta_saida.mkdir(exist_ok=True)

  total_paginas = len(reader.pages)
  if total_paginas % 2 != 0:
    # se for ímpar, ignora a última página
    total_blocos = total_paginas // 2
  else:
    total_blocos = total_paginas // 2

  arquivos_gerados: List[Path] = []

  for bloco in range(total_blocos):
    i = bloco * 2
    paginas_bloco = [reader.pages[i], reader.pages[i + 1]]
    textos_bloco = [extrair_texto(p) for p in paginas_bloco]

    nome = encontrar_nome_funcionario(textos_bloco)
    if not nome:
      nome = f"funcionario_{bloco+1:03d}"

    base_nome = f"FERIAS - {sanitizar_para_arquivo(nome)}"
    caminho_saida = caminho_unico(pasta_saida, base_nome, ext=".pdf")

    writer = PdfWriter()
    writer.add_page(paginas_bloco[0])
    writer.add_page(paginas_bloco[1])

    with open(caminho_saida, "wb") as f:
      writer.write(f)

    arquivos_gerados.append(caminho_saida)

  # Cria ZIP consolidando todos os PDFs gerados
  zip_path = pdf_path.parent / f"{pdf_path.stem}_FERIAS_POR_FUNCIONARIO.zip"
  with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for arq in arquivos_gerados:
      arcname = arq.relative_to(pdf_path.parent)
      zf.write(arq, arcname.as_posix())

  # ---------------------- BLOCO DE FAXINA ----------------------
  try:
    # Apaga cada PDF individual gerado
    for arq in arquivos_gerados:
      try:
        if arq.exists():
          arq.unlink()
      except Exception as e:
        print(f"[ferias-funcionario] Erro ao apagar arquivo {arq}: {e}")

    # Tenta remover a pasta do lote (pasta_saida) se estiver vazia
    try:
      pasta_saida.rmdir()
    except Exception:
      # se não estiver vazia ou der erro, apenas ignora
      pass

    # Se quiser, tenta remover a pasta da empresa se ficar vazia
    try:
      if not any(pasta_empresa.iterdir()):
        pasta_empresa.rmdir()
    except Exception:
      pass

    # Apaga também o PDF original de entrada
    try:
      if pdf_path.exists():
        pdf_path.unlink()
    except Exception as e:
      print(f"[ferias-funcionario] Erro ao apagar PDF original {pdf_path}: {e}")

  except Exception as e:
    # qualquer erro na limpeza não impede o retorno da função
    print(f"[ferias-funcionario] Erro na rotina de limpeza: {e}")
  # -------------------- FIM BLOCO DE FAXINA --------------------

  return {
    "empresa": empresa,
    "total_paginas": total_paginas,
    "total_funcionarios": total_blocos,
    "pasta_saida": str(pasta_saida),
    "zip_path": str(zip_path),
    "arquivos": [p.name for p in arquivos_gerados],
  }
