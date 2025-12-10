# api/integra_api.py

from pathlib import Path
from typing import Optional
import tempfile
import shutil

# no topo de api/integra_api.py
from typing import List, Dict, Any
from pydantic import BaseModel

from api.gerador_atas_core import (
    listar_modelos,
    obter_campos_modelo,
    gerar_ata as gerar_ata_core,
)

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Importações dos módulos internos (sem circular)
from api.relatorio_ferias_core import split_pdf_relatorio_ferias
from api.holerites_core import split_pdf_holerites
from api.separador_ferias_funcionario_core import processar_ferias_por_funcionario

# imports (no topo de integra_api.py, se ainda não existirem)
import base64
from pydantic import BaseModel

from api.comprimir_pdf_core import comprimir_pdf_bytes

from pathlib import Path
from pydantic import BaseModel
from fastapi import HTTPException

from api.extrator_zip_rar_core import processar_pasta_zip_rar

# imports no topo do arquivo integra_api.py
from typing import List, Optional
from pydantic import BaseModel

from api.excel_abas_pdf_core import exportar_abas_para_pdf

app = FastAPI(title="Integração Python API")

from typing import Optional
from api.importador_recebimentos_madre_scp_core import (
    processar_importador_recebimentos_madre_scp,
)
from pydantic import BaseModel

# =========================
# MODELO DE ENTRADA (FÉRIAS)
# =========================

class SeparadorParams(BaseModel):
    input_pdf_path: str
    competencia: str
    output_dir: Optional[str] = None

# =========================
# ENDPOINT: RELATÓRIO DE FÉRIAS
# =========================

@app.post("/api/separador-pdf-relatorio-de-ferias/processar")
def processar_separador(params: SeparadorParams):

    input_pdf = Path(params.input_pdf_path)
    if not input_pdf.is_file():
        raise HTTPException(status_code=400, detail="Arquivo PDF de entrada não encontrado.")

    competencia = params.competencia.strip()
    if not competencia:
        raise HTTPException(status_code=400, detail="Competência não informada.")

    out_dir = Path(params.output_dir) if params.output_dir else input_pdf.parent / "output"

    try:
        zip_path = split_pdf_relatorio_ferias(input_pdf, out_dir, competencia)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao processar PDF: {e}")

    return {"ok": True, "zip_path": str(zip_path)}

# =========================
# ENDPOINT: HOLERITES (UPLOAD)
# =========================

@app.post("/processar-holerites-por-empresa")
async def processar_holerites_por_empresa(
    pdf: UploadFile = File(...),
    competencia: str = Form(...),
    background_tasks: BackgroundTasks = None,
):

    competencia = competencia.strip()
    if not competencia:
        raise HTTPException(status_code=400, detail="Competência obrigatória.")

    try:
        tmpdir = tempfile.mkdtemp()
        tmpdir_path = Path(tmpdir)

        pdf_filename = pdf.filename or "holerites.pdf"
        pdf_path = tmpdir_path / pdf_filename
        with open(pdf_path, "wb") as f:
            f.write(await pdf.read())

        out_dir = tmpdir_path / "output"
        zip_path = split_pdf_holerites(pdf_path, out_dir, competencia)

        zip_file = open(zip_path, "rb")

        if background_tasks:
            background_tasks.add_task(shutil.rmtree, tmpdir_path, ignore_errors=True)

        return StreamingResponse(
            zip_file,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename=\"{zip_path.name}\"'},
        )

    except Exception as e:
        print("Erro ao processar holerites:", e)
        raise HTTPException(status_code=500, detail="Erro interno ao processar o PDF.")

class FeriasFuncionarioRequest(BaseModel):
  pdf_path: str  # caminho absoluto do PDF salvo pelo Node (multer)

class FeriasFuncionarioResponse(BaseModel):
  ok: bool
  empresa: str
  total_paginas: int
  total_funcionarios: int
  pasta_saida: str
  zip_path: str
  arquivos: list[str]

@app.post("/api/ferias-funcionario/processar", response_model=FeriasFuncionarioResponse)
def ferias_funcionario_processar(payload: FeriasFuncionarioRequest):
  """
  Endpoint chamado pelo Node.js para processar o PDF de férias por funcionário.
  """
  result = processar_ferias_por_funcionario(Path(payload.pdf_path))
  return {
    "ok": True,
    **result,
  }

# PARA RODAR:
# uvicorn api.integra_api:app --host 127.0.0.1 --port 8001

class LucroItem(BaseModel):
    ano: int
    valor: str

class SocioPF(BaseModel):
    nome: str = ""
    cpf: str = ""
    qualificacao: str = ""

class SocioPJ(BaseModel):
    pj: str = ""
    representante: str = ""
    cpf: str = ""
    qualificacao: str = ""

class GerarAtaParams(BaseModel):
    modelo_id: str
    campos: Dict[str, str]
    lucros: List[LucroItem] = []
    assinaturasPF: List[SocioPF] = []
    assinaturasPJ: List[SocioPJ] = []

@app.get("/api/gerador-atas/modelos")
def api_gerador_atas_modelos():
    modelos = listar_modelos()
    return {"ok": True, "modelos": modelos}


@app.get("/api/gerador-atas/modelos/{modelo_id}")
def api_gerador_atas_campos(modelo_id: str):
    campos = obter_campos_modelo(modelo_id)
    return {"ok": True, **campos}


@app.post("/api/gerador-atas/gerar")
def api_gerador_atas_gerar(params: GerarAtaParams):
    file_name = gerar_ata_core(
        modelo_id=params.modelo_id,
        campos=params.campos,
        lucros=[l.dict() for l in params.lucros],
        assinaturas_pf=[s.dict() for s in params.assinaturasPF],
        assinaturas_pj=[s.dict() for s in params.assinaturasPJ],
    )
    return {
        "ok": True,
        "fileName": file_name,
    }

# modelo Pydantic
class ComprimirPdfParams(BaseModel):
  file_name: str
  file_base64: str
  jpeg_quality: int = 50
  dpi_scale: float = 1.0

# endpoint FastAPI
@app.post("/api/comprimir-pdf/processar")
def processar_comprimir_pdf(params: ComprimirPdfParams):
  pdf_bytes = base64.b64decode(params.file_base64)

  resultado = comprimir_pdf_bytes(
      pdf_bytes=pdf_bytes,
      jpeg_quality=params.jpeg_quality,
      dpi_scale=params.dpi_scale,
  )

  compressed_base64 = base64.b64encode(resultado["compressed_bytes"]).decode("ascii")

  return {
      "ok": True,
      "file_name": params.file_name,
      "original_size": resultado["original_size"],
      "compressed_size": resultado["compressed_size"],
      "reduction_percent": resultado["reduction_percent"],
      "compressed_base64": compressed_base64,
  }

class ExtratorZipRarParams(BaseModel):
    base_dir: str
    max_depth: int = 5

@app.post("/api/extrator-zip-rar/process")
def api_extrator_zip_rar(params: ExtratorZipRarParams):
    base_dir = Path(params.base_dir)

    if not base_dir.exists() or not base_dir.is_dir():
        raise HTTPException(status_code=400, detail="Diretório base inválido.")

    resultado = processar_pasta_zip_rar(base_dir=base_dir, max_depth=params.max_depth)

    return {
        "ok": True,
        "resultado": resultado,
    }
    
class ExcelAbasPdfParams(BaseModel):
    arquivos: List[str]
    pasta_destino: str

class ExcelAbasPdfResultado(BaseModel):
    arquivo_excel: str
    aba: Optional[str] = None
    nome_pdf: Optional[str] = None
    pdf: Optional[str] = None
    sucesso: bool
    erro: Optional[str] = None

class ExcelAbasPdfResponse(BaseModel):
    ok: bool
    resultados: List[ExcelAbasPdfResultado]

@app.post("/api/excel-abas-pdf/processar", response_model=ExcelAbasPdfResponse)
def processar_excel_abas_pdf(params: ExcelAbasPdfParams):
    """
    Endpoint que recebe caminhos de arquivos Excel e uma pasta de destino,
    chama o core e devolve os resultados de cada aba gerada.
    """
    resultados = exportar_abas_para_pdf(
        caminhos_arquivos=params.arquivos,
        pasta_destino=params.pasta_destino,
    )
    return ExcelAbasPdfResponse(ok=True, resultados=resultados)

class ParametrosImportadorRecebimentosMadreScp(BaseModel):
    pdf_path: str
    output_dir: Optional[str] = None

@app.post("/api/importador-recebimentos-madre-scp/processar")
def processar_importador_recebimentos_madre_scp_endpoint(
    params: ParametrosImportadorRecebimentosMadreScp,
):
    resultado = processar_importador_recebimentos_madre_scp(
        pdf_path=params.pdf_path,
        output_dir=params.output_dir,
    )
    return {
        "ok": True,
        "resultado": resultado,
    }