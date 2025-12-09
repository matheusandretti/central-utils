# api/excel_abas_pdf_core.py
from pathlib import Path
import re
from typing import Iterable, List, Dict

# Reaproveita a mesma lógica de sanitização do script original :contentReference[oaicite:9]{index=9}
def sanitizar_nome(nome: str) -> str:
    """
    Limpa caracteres inválidos para nomes de arquivo no Windows
    e limita o tamanho para evitar problemas de path muito longo.
    """
    nome = re.sub(r'[<>:"/\\|?*]', "_", nome)
    nome = nome.strip().rstrip(".")
    return nome[:150] if len(nome) > 150 else nome


def exportar_abas_para_pdf(
    caminhos_arquivos: Iterable[str],
    pasta_destino: str
) -> List[Dict]:
    """
    Recebe uma lista de caminhos de arquivos Excel e exporta
    cada aba (Worksheet) como PDF em pasta_destino.

    Retorna uma lista de dicts com:
      - arquivo_excel
      - aba
      - nome_pdf
      - pdf (caminho completo)
      - sucesso (bool)
      - erro (opcional)
    """
    from win32com.client import DispatchEx  # import local para evitar overhead quando não usado

    resultados: List[Dict] = []

    pasta_destino_path = Path(pasta_destino)
    pasta_destino_path.mkdir(parents=True, exist_ok=True)

    excel = DispatchEx("Excel.Application")
    excel.Visible = False
    excel.DisplayAlerts = False

    try:
      for caminho_str in caminhos_arquivos:
        caminho = Path(caminho_str)
        if not caminho.exists():
            resultados.append(
                {
                    "arquivo_excel": str(caminho),
                    "aba": None,
                    "nome_pdf": None,
                    "pdf": None,
                    "sucesso": False,
                    "erro": f"Arquivo não encontrado: {caminho}",
                }
            )
            continue

        wb = None
        try:
            wb = excel.Workbooks.Open(str(caminho), ReadOnly=True)
            nome_wb = sanitizar_nome(caminho.stem)

            # Itera apenas por Worksheets (abas de planilha) :contentReference[oaicite:10]{index=10}
            for sh in wb.Worksheets:
                try:
                    # Define área de impressão A1:I32
                    sh.PageSetup.PrintArea = "$A$1:$I$32"

                    # Ajuste para caber em 1 página
                    sh.PageSetup.Zoom = False
                    sh.PageSetup.FitToPagesWide = 1
                    sh.PageSetup.FitToPagesTall = 1

                    nome_aba = sanitizar_nome(sh.Name)
                    nome_pdf = f"{nome_wb} - {nome_aba}.pdf"
                    caminho_pdf = str(pasta_destino_path / nome_pdf)

                    sh.ExportAsFixedFormat(
                        Type=0,  # xlTypePDF
                        Filename=caminho_pdf,
                        Quality=0,  # xlQualityStandard
                        IncludeDocProperties=True,
                        IgnorePrintAreas=False,
                        OpenAfterPublish=False,
                    )

                    resultados.append(
                        {
                            "arquivo_excel": str(caminho),
                            "aba": sh.Name,
                            "nome_pdf": nome_pdf,
                            "pdf": caminho_pdf,
                            "sucesso": True,
                            "erro": None,
                        }
                    )
                except Exception as e:  # noqa: BLE001
                    resultados.append(
                        {
                            "arquivo_excel": str(caminho),
                            "aba": getattr(sh, "Name", None),
                            "nome_pdf": None,
                            "pdf": None,
                            "sucesso": False,
                            "erro": f"Falha ao exportar aba: {e}",
                        }
                    )
        except Exception as e:  # noqa: BLE001
            resultados.append(
                {
                    "arquivo_excel": str(caminho),
                    "aba": None,
                    "nome_pdf": None,
                    "pdf": None,
                    "sucesso": False,
                    "erro": f"Não foi possível abrir o arquivo: {e}",
                }
            )
        finally:
            if wb is not None:
                wb.Close(SaveChanges=False)

    finally:
        excel.Quit()

    return resultados
