"""Publica el panel (PWA + datos cifrados) en GitHub Pages."""
from __future__ import annotations

import shutil
import subprocess

from .cifrado import cifrar, clave_panel
from .config import APP, DATOS, escribir_json, leer_json, secreto

REPO = "delga-panel"


def _git(*args, cwd=None, check=True) -> str:
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8")
    if check and r.returncode != 0:
        raise SystemExit(f"git {' '.join(args)} falló: {r.stderr.strip()}")
    return r.stdout.strip()


def _gh(*args, check=True) -> str:
    r = subprocess.run(["gh", *args], capture_output=True, text=True, encoding="utf-8")
    if check and r.returncode != 0:
        raise SystemExit(f"gh {' '.join(args)} falló: {r.stderr.strip()}")
    return r.stdout.strip()


def usuario_github() -> str:
    return _gh("api", "user", "--jq", ".login")


def url_panel() -> str:
    return f"https://{usuario_github()}.github.io/{REPO}/"


def crear_repo() -> str:
    """Crea el repositorio público y activa GitHub Pages (una sola vez)."""
    usuario = usuario_github()
    existe = subprocess.run(["gh", "repo", "view", f"{usuario}/{REPO}"], capture_output=True).returncode == 0
    if not existe:
        _gh("repo", "create", REPO, "--public", "--description", "Panel de métricas Delgatronics/Delgafutbol (datos cifrados)")
    return usuario


def publicar() -> str:
    usuario = crear_repo()
    sitio = secreto("sitio")
    if not (sitio / ".git").exists():
        sitio.mkdir(parents=True, exist_ok=True)
        _git("init", "-b", "main", cwd=sitio)
        _git("remote", "add", "origin", f"https://github.com/{usuario}/{REPO}.git", cwd=sitio)
    # copiar la app
    for f in APP.rglob("*"):
        if f.is_file():
            destino = sitio / f.relative_to(APP)
            destino.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, destino)
    (sitio / ".nojekyll").write_text("", encoding="utf-8")
    datos = leer_json(DATOS / "metricas.json")
    if not datos:
        raise SystemExit("Primero ejecuta  delga metricas")
    escribir_json(sitio / "datos.enc.json", cifrar(datos, clave_panel()))
    from .calendario import generar_ics

    (sitio / "recordatorios.ics").write_text(generar_ics(datos), encoding="utf-8", newline="")
    _git("add", "-A", cwd=sitio)
    if _git("status", "--porcelain", cwd=sitio):
        _git("-c", "user.name=delga-bot", "-c", "user.email=delga-bot@users.noreply.github.com", "commit", "-m", f"Métricas {datos['generado']}", cwd=sitio)
        _git("push", "-u", "origin", "main", cwd=sitio)
    # activar Pages (si ya está activo, falla en silencio)
    subprocess.run(
        ["gh", "api", "-X", "POST", f"repos/{usuario}/{REPO}/pages", "-f", "source[branch]=main", "-f", "source[path]=/"],
        capture_output=True,
    )
    return url_panel()
