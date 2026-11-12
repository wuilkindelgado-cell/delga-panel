"""Buzón de audios: app «Delga Grabar» (celular) ⇄ repositorio privado delga-buzon ⇄ carpetas de la PC.

- publicar_guiones(): sube guiones.json con los videos que aún no tienen voz grabada (para el teleprompter).
- recoger(): baja cada audio de entrada/ a la carpeta de su video como voz-<tema>.<ext> y lo borra del buzón.
Usa el `gh` ya autenticado de la PC (no guarda tokens aquí).
"""
from __future__ import annotations

import base64
import json
import re
import subprocess
from datetime import datetime
from pathlib import Path

from .config import RAIZ

REPO = "wuilkindelgado-cell/delga-buzon"
VIDEOS = RAIZ.parent
CATEGORIAS = {"Futbol": "Delgafutbol", "Electronica-Mecatronica": "Delgatronics", "Cultura general": "Cultura general"}
EXT_AUDIO = {".m4a", ".mp4", ".mp3", ".wav", ".aac", ".webm", ".ogg", ".caf", ".mov"}


def _gh(*args: str, entrada: str | None = None, crudo: bool = False) -> str:
    cmd = ["gh", "api", *args]
    r = subprocess.run(cmd, input=entrada, capture_output=True, text=not crudo, encoding=None if crudo else "utf-8", errors=None if crudo else "replace")
    if r.returncode != 0:
        err = r.stderr if isinstance(r.stderr, str) else r.stderr.decode("utf-8", "replace")
        raise RuntimeError(f"gh api {' '.join(args[:2])}: {err.strip()}")
    return r.stdout


def _sha(ruta: str) -> str | None:
    try:
        return json.loads(_gh(f"repos/{REPO}/contents/{ruta}"))["sha"]
    except RuntimeError:
        return None


def _poner(ruta: str, contenido: bytes, mensaje: str) -> None:
    cuerpo = {"message": mensaje, "content": base64.b64encode(contenido).decode()}
    sha = _sha(ruta)
    if sha:
        cuerpo["sha"] = sha
    _gh("-X", "PUT", f"repos/{REPO}/contents/{ruta}", "--input", "-", entrada=json.dumps(cuerpo))


def _tiene_voz(carpeta: Path) -> bool:
    return any(p.name.lower().startswith("voz") and p.suffix.lower() in EXT_AUDIO for p in carpeta.iterdir())


def _leer_guion(md: Path) -> dict:
    texto = md.read_text(encoding="utf-8")
    titulo_md = next((l[2:].strip() for l in texto.splitlines() if l.startswith("# ")), md.parent.name)
    m = re.search(r"\*\*Título:\*\*\s*(.+)", texto)
    cuerpo = texto.split("## Edición")[0]
    lineas = []
    for l in cuerpo.splitlines():
        s = l.strip()
        if re.match(r"^\d+\.\s", s) or (lineas and l.startswith("   ") and s):
            lineas.append(re.sub(r"^\d+\.\s*", "", s))
    return {"tema": titulo_md.split(" — ")[0], "titulo": m.group(1).strip() if m else "", "lineas": lineas}


def pendientes() -> list[dict]:
    out = []
    for cat, canal in CATEGORIAS.items():
        base = VIDEOS / cat
        if not base.exists():
            continue
        for d in sorted(base.iterdir()):
            md = d / "guion-grabacion.md"
            if not d.is_dir() or not md.exists() or (d / "NO-GRABAR").exists() or _tiene_voz(d):
                continue
            g = _leer_guion(md)
            if g["lineas"]:
                out.append({"id": f"{cat}/{d.name}", "canal": canal, **g, "fecha": datetime.fromtimestamp(md.stat().st_mtime).isoformat(timespec="minutes")})
    out.sort(key=lambda g: g["fecha"], reverse=True)
    return out


def publicar_guiones() -> int:
    gs = pendientes()
    datos = json.dumps({"generado": datetime.now().isoformat(timespec="seconds"), "guiones": gs}, ensure_ascii=False, indent=1).encode("utf-8")
    actual = None
    try:
        actual = _gh("-H", "Accept: application/vnd.github.raw", f"repos/{REPO}/contents/guiones.json")
    except RuntimeError:
        pass
    viejo = json.loads(actual)["guiones"] if actual else None
    if viejo != gs:
        _poner("guiones.json", datos, "Guiones pendientes")
    return len(gs)


def recoger() -> list[Path]:
    try:
        items = json.loads(_gh(f"repos/{REPO}/contents/entrada"))
    except RuntimeError:
        return []
    bajados = []
    for it in items:
        if it["type"] != "file" or it["name"].startswith("."):
            continue
        nombre = it["name"]
        destino_id, _, resto = nombre.partition("@@")
        carpeta = VIDEOS / destino_id.replace("__", "/")
        if not resto or not carpeta.is_dir():
            carpeta = VIDEOS / "_entrada"
            carpeta.mkdir(exist_ok=True)
        ext = Path(nombre).suffix.lower() or ".m4a"
        tema = re.sub(r"^\d+-", "", carpeta.name) if carpeta.name != "_entrada" else "audio"
        destino = carpeta / f"voz-{tema}{ext}"
        n = 2
        while destino.exists():
            destino = carpeta / f"voz-{tema}-{n}{ext}"
            n += 1
        datos = subprocess.run(
            ["gh", "api", "-H", "Accept: application/vnd.github.raw", f"repos/{REPO}/contents/{it['path']}"],
            capture_output=True, check=True,
        ).stdout
        destino.write_bytes(datos)
        _gh("-X", "DELETE", f"repos/{REPO}/contents/{it['path']}", "-f", f"message=Recogido {nombre}", "-f", f"sha={it['sha']}")
        bajados.append(destino)
    return bajados


def ciclo() -> None:
    bajados = recoger()
    for b in bajados:
        print(f"✔ audio nuevo: {b.relative_to(VIDEOS)}")
    n = publicar_guiones()
    if not bajados:
        print(f"Sin audios nuevos · {n} guiones pendientes en la app")
    if bajados:
        _registrar(bajados)


def _registrar(bajados: list[Path]) -> None:
    log = VIDEOS / "_entrada-registro.txt"
    with log.open("a", encoding="utf-8") as f:
        for b in bajados:
            f.write(f"{datetime.now():%Y-%m-%d %H:%M} {b.relative_to(VIDEOS)}\n")
