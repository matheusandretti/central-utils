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


app = FastAPI(title="Integração Python API")


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
