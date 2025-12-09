# api/extrator_zip_rar_core.py
from __future__ import annotations

from pathlib import Path
from io import BytesIO
import zipfile

try:
    import rarfile  # type: ignore
    RAR_AVAILABLE = True
except Exception:
    RAR_AVAILABLE = False

# profundidade máxima de compactados internos
MAX_DEPTH = 5


def _log(msg: str, logs: list[str] | None = None) -> None:
    """
    Faz o log de forma segura no Windows, evitando erro:
    'charmap' codec can't encode character ...
    - Converte para latin-1 com 'replace' (caracteres fora viram '?')
    - Em último caso, cai para ASCII.
    - Sempre adiciona na lista logs, se fornecida.
    """
    try:
        safe = msg.encode("latin-1", "replace").decode("latin-1", "replace")
    except Exception:
        safe = msg

    try:
        print(safe)
    except Exception:
        # última defesa: só ASCII
        try:
            print(safe.encode("ascii", "replace").decode("ascii"))
        except Exception:
            # se até isso der problema, ignora o print para não travar
            pass

    if logs is not None:
        logs.append(safe)


def is_archive_filename(name: str) -> bool:
    low = name.lower()
    return low.endswith(".zip") or low.endswith(".rar")


def unique_name_for_size(
    dest_dir: Path,
    base_name: str,
    size: int,
    used_sizes_for_name: dict,
) -> Path:
    """
    Gera um nome único em dest_dir, evitando sobrescrever arquivos com mesmo
    nome mas tamanho distinto, reaproveitando o arquivo se o tamanho coincidir.
    Lógica baseada no script original EXTRATOR DE ZIP-RAR.py. :contentReference[oaicite:7]{index=7}
    """
    name = base_name
    stem = Path(base_name).stem
    suffix = Path(base_name).suffix

    sizes = used_sizes_for_name.setdefault(base_name.lower(), [])
    if size in sizes:
        # já temos um arquivo com esse nome e tamanho
        return dest_dir / name
    else:
        if len(sizes) == 0 and not (dest_dir / name).exists():
            return dest_dir / name
        idx = 2
        while True:
            cand = f"{stem} ({idx}){suffix}"
            cand_path = dest_dir / cand
            if cand_path.exists():
                if cand_path.stat().st_size == size:
                    return cand_path
                idx += 1
            else:
                return cand_path


def add_record_for_written(
    filepath: Path,
    base_name: str,
    size: int,
    used_sizes_for_name: dict,
):
    sizes = used_sizes_for_name.setdefault(base_name.lower(), [])
    if size not in sizes:
        sizes.append(size)


def save_file(
    member_name: str,
    data: bytes,
    dest_dir: Path,
    used_sizes_for_name: dict,
    logs: list[str] | None = None,
):
    base_name = Path(member_name).name
    size = len(data)
    out_path = unique_name_for_size(dest_dir, base_name, size, used_sizes_for_name)
    if out_path.exists() and out_path.stat().st_size == size:
        # já existe um arquivo idêntico, não grava novamente
        return

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(data)

    add_record_for_written(out_path, base_name, size, used_sizes_for_name)
    msg = f"[+] {out_path.name} ({size} bytes)"
    _log(msg, logs)


def extract_zipfile(
    zf: zipfile.ZipFile,
    dest_dir: Path,
    used_sizes_for_name: dict,
    depth: int,
    logs: list[str],
):
    for member in zf.infolist():
        if member.is_dir():
            continue

        member_name = Path(member.filename).name
        if not member_name or member_name in (".", ".."):
            continue

        try:
            data = zf.read(member)
        except RuntimeError as e:
            msg = f"[ERRO] Zip protegido por senha ou inválido: {member.filename} ({e})"
            _log(msg, logs)
            continue
        except Exception as e:
            msg = f'[ERRO] Falha ao ler "{member.filename}": {e}'
            _log(msg, logs)
            continue

        if depth < MAX_DEPTH and is_archive_filename(member_name):
            msg = f"[*] Encontrado compactado interno: {member_name} (profundidade {depth+1})"
            _log(msg, logs)
            process_archive_bytes(
                member_name, data, dest_dir, used_sizes_for_name, depth + 1, logs
            )
        else:
            save_file(member_name, data, dest_dir, used_sizes_for_name, logs)


def extract_rarfile(
    rf,
    dest_dir: Path,
    used_sizes_for_name: dict,
    depth: int,
    logs: list[str],
):
    for member in rf.infolist():
        # rarfile tem compatibilidade diferente, então usamos getattr
        if getattr(member, "is_dir", lambda: False)():
            continue

        member_name = Path(member.filename).name
        if not member_name or member_name in (".", ".."):
            continue

        try:
            data = rf.read(member)
        except rarfile.NeedFirstVolume:  # type: ignore[attr-defined]
            msg = f"[ERRO] Parte inicial de multi-volume RAR ausente: {member.filename}"
            _log(msg, logs)
            continue
        except rarfile.BadRarFile as e:  # type: ignore[attr-defined]
            msg = f"[ERRO] RAR inválido: {member.filename} ({e})"
            _log(msg, logs)
            continue
        except Exception as e:
            msg = f'[ERRO] Falha ao ler "{member.filename}": {e}'
            _log(msg, logs)
            continue

        if depth < MAX_DEPTH and is_archive_filename(member_name):
            msg = f"[*] Encontrado compactado interno: {member_name} (profundidade {depth+1})"
            _log(msg, logs)
            process_archive_bytes(
                member_name, data, dest_dir, used_sizes_for_name, depth + 1, logs
            )
        else:
            save_file(member_name, data, dest_dir, used_sizes_for_name, logs)


def process_archive_bytes(
    name: str,
    data: bytes,
    dest_dir: Path,
    used_sizes_for_name: dict,
    depth: int,
    logs: list[str],
):
    ext = Path(name).suffix.lower()
    bio = BytesIO(data)

    if ext == ".zip":
        try:
            with zipfile.ZipFile(bio, "r") as zf:
                extract_zipfile(zf, dest_dir, used_sizes_for_name, depth, logs)
        except zipfile.BadZipFile:
            msg = f"[ERRO] Compactado interno .zip corrompido: {name}"
            _log(msg, logs)
    elif ext == ".rar":
        if not RAR_AVAILABLE:
            msg = (
                f'[AVISO] Encontrado RAR interno "{name}", '
                "mas suporte .rar não está disponível."
            )
            _log(msg, logs)
            return
        try:
            import rarfile  # type: ignore

            with rarfile.RarFile(fileobj=bio) as rf:  # type: ignore[arg-type]
                extract_rarfile(rf, dest_dir, used_sizes_for_name, depth, logs)
        except Exception as e:
            msg = f'[ERRO] RAR interno inválido "{name}": {e}'
            _log(msg, logs)


def process_zip_path(
    zip_path: Path,
    dest_dir: Path,
    used_sizes_for_name: dict,
    logs: list[str],
    depth: int = 0,
):
    msg = f"[ZIP] {zip_path.name}"
    _log(msg, logs)

    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            extract_zipfile(zf, dest_dir, used_sizes_for_name, depth, logs)
    except zipfile.BadZipFile:
        msg = "[ERRO] Arquivo .zip corrompido ou inválido."
        _log(msg, logs)
    except Exception as e:
        msg = f"[ERRO] {e}"
        _log(msg, logs)


def process_rar_path(
    rar_path: Path,
    dest_dir: Path,
    used_sizes_for_name: dict,
    logs: list[str],
    depth: int = 0,
):
    msg = f"[RAR] {rar_path.name}"
    _log(msg, logs)

    if not RAR_AVAILABLE:
        aviso = (
            "[AVISO] Suporte a .rar indisponível. "
            'Instale "rarfile" e o utilitário "unrar" ou "bsdtar".'
        )
        _log(aviso, logs)
        return

    try:
        import rarfile  # type: ignore

        with rarfile.RarFile(rar_path, "r") as rf:
            extract_rarfile(rf, dest_dir, used_sizes_for_name, depth, logs)
    except Exception as e:
        msg = f"[ERRO] {e}"
        _log(msg, logs)


def ensure_arquivos_dir(base_dir: Path) -> Path:
    dest = base_dir / "ARQUIVOS"
    dest.mkdir(exist_ok=True)
    return dest


def processar_pasta_zip_rar(base_dir: Path, max_depth: int = MAX_DEPTH) -> dict:
    """
    Aplica a lógica do EXTRATOR DE ZIP-RAR.py a um diretório já existente no servidor,
    contendo arquivos .zip e .rar na raiz. Não há interação com Tkinter aqui. :contentReference[oaicite:8]{index=8}
    """
    global MAX_DEPTH
    MAX_DEPTH = max_depth

    logs: list[str] = []
    dest_dir = ensure_arquivos_dir(base_dir)

    used_sizes_for_name: dict[str, list[int]] = {}

    # registra arquivos já existentes em ARQUIVOS, se houver
    for existing in dest_dir.glob("*"):
        if existing.is_file():
            base_name = existing.name
            size = existing.stat().st_size
            add_record_for_written(existing, base_name, size, used_sizes_for_name)

    arquivos_antes = sum(len(v) for v in used_sizes_for_name.values())

    archives: list[Path] = []
    for p in base_dir.iterdir():
        if p.is_file() and p.suffix.lower() in (".zip", ".rar"):
            archives.append(p)

    if not archives:
        msg = "Nenhum .zip ou .rar encontrado na pasta de trabalho."
        _log(msg, logs)
        arquivos_depois = sum(len(v) for v in used_sizes_for_name.values())
        return {
            "dest_dir": str(dest_dir),
            "total_archives": 0,
            "total_unique_files": arquivos_depois,
            "total_new_files": max(arquivos_depois - arquivos_antes, 0),
            "message": msg,
            "logs": logs,
        }

    # processa todos os compactados
    for a in archives:
        if a.suffix.lower() == ".zip":
            process_zip_path(a, dest_dir, used_sizes_for_name, logs, depth=0)
        elif a.suffix.lower() == ".rar":
            process_rar_path(a, dest_dir, used_sizes_for_name, logs, depth=0)

    arquivos_depois = sum(len(v) for v in used_sizes_for_name.values())
    total_novos = max(arquivos_depois - arquivos_antes, 0)

    resumo = {
        "dest_dir": str(dest_dir),
        "total_archives": len(archives),
        "total_unique_files": arquivos_depois,
        "total_new_files": total_novos,
        "message": (
            "Processamento concluído. Veja o ZIP consolidado para os arquivos extraídos."
        ),
        "logs": logs,
    }

    return resumo
