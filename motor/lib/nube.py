"""Actualización automática en la nube con GitHub Actions (sin depender de la laptop).

- `preparar()` (en la PC): sube al repo del panel el motor (este código), el flujo de GitHub Actions
  y un `estado.enc.json` con los tokens + historial CIFRADOS con una clave que se guarda como
  secreto de GitHub (DELGA_ESTADO_CLAVE). Ejecutarlo de nuevo si se reconecta alguna cuenta en la PC.
- `ciclo()` (en GitHub Actions, cada 3 h): descifra el estado, recolecta las métricas, escribe
  `datos.enc.json` para la app y vuelve a cifrar el estado (con los tokens renovados).
"""
from __future__ import annotations

import os
import secrets
import shutil
import subprocess
from pathlib import Path

from .cifrado import cifrar, clave_panel, descifrar
from .config import HISTORIAL, RAIZ, SECRETOS, escribir_json, leer_json, secreto

ARCHIVOS_SECRETOS = ["tiktok_app.json", "clave_panel.txt"]  # + yt_*.json y tt_*.json

FLUJO = """name: Actualizar métricas
on:
  schedule:
    - cron: "17 */3 * * *"   # cada 3 horas
  workflow_dispatch: {}
permissions:
  contents: write
concurrency:
  group: metricas
  cancel-in-progress: false
jobs:
  actualizar:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install -q -r motor/requirements.txt
      - name: Recolectar métricas
        env:
          DELGA_ESTADO_CLAVE: ${{ secrets.DELGA_ESTADO_CLAVE }}
          DELGA_SECRETOS: ${{ runner.temp }}/secretos
          DELGA_DATOS: ${{ runner.temp }}/datos
        run: python motor/delga.py nube-ciclo
      - name: Guardar
        run: |
          git config user.name "delga-bot"
          git config user.email "delga-bot@users.noreply.github.com"
          git add datos.enc.json estado.enc.json
          git diff --cached --quiet || git commit -m "Métricas $(date -u +%Y-%m-%dT%H:%MZ)"
          git push
"""


def _clave_estado() -> str:
    ruta = secreto("clave_estado.txt")
    if not ruta.exists():
        ruta.write_text(secrets.token_urlsafe(32), encoding="utf-8")
    return ruta.read_text(encoding="utf-8").strip()


def _empaquetar() -> dict:
    archivos = {}
    for p in sorted(SECRETOS.glob("*.json")) + [SECRETOS / "clave_panel.txt"]:
        if p.name.startswith(("yt_", "tt_")) or p.name in ARCHIVOS_SECRETOS:
            if p.exists():
                archivos[p.name] = p.read_text(encoding="utf-8")
    historial = {p.name: p.read_text(encoding="utf-8") for p in sorted(HISTORIAL.glob("*.json"))} if HISTORIAL.exists() else {}
    return {"secretos": archivos, "historial": historial}


def _desempaquetar(estado: dict) -> None:
    SECRETOS.mkdir(parents=True, exist_ok=True)
    HISTORIAL.mkdir(parents=True, exist_ok=True)
    for nombre, txt in estado.get("secretos", {}).items():
        (SECRETOS / nombre).write_text(txt, encoding="utf-8")
    for nombre, txt in estado.get("historial", {}).items():
        (HISTORIAL / nombre).write_text(txt, encoding="utf-8")


def preparar(sitio: Path) -> None:
    """Copia el motor + flujo al clon local del repo y genera estado.enc.json. No hace commit."""
    motor = sitio / "motor"
    if motor.exists():
        shutil.rmtree(motor)
    (motor / "lib").mkdir(parents=True)
    for f in (RAIZ / "lib").glob("*.py"):
        shutil.copy2(f, motor / "lib" / f.name)
    for f in ("delga.py", "canales.json", "requirements.txt"):
        shutil.copy2(RAIZ / f, motor / f)
    flujo = sitio / ".github" / "workflows" / "actualizar.yml"
    flujo.parent.mkdir(parents=True, exist_ok=True)
    flujo.write_text(FLUJO, encoding="utf-8")
    escribir_json(sitio / "estado.enc.json", cifrar(_empaquetar(), _clave_estado()))


def guardar_secreto_github(repo: str) -> None:
    subprocess.run(["gh", "secret", "set", "DELGA_ESTADO_CLAVE", "--repo", repo, "--body", _clave_estado()], check=True)


def ciclo() -> None:
    """Se ejecuta en GitHub Actions."""
    from .metricas import recolectar

    raiz_repo = RAIZ.parent  # motor/ está dentro del repo
    clave = os.environ["DELGA_ESTADO_CLAVE"]
    _desempaquetar(descifrar(leer_json(raiz_repo / "estado.enc.json"), clave))
    datos = recolectar()
    escribir_json(raiz_repo / "datos.enc.json", cifrar(datos, clave_panel()))
    escribir_json(raiz_repo / "estado.enc.json", cifrar(_empaquetar(), clave))
    ok = [c["id"] for c in datos["canales"] if c["estado"] == "ok"]
    print(f"Actualizado {datos['generado']} · canales OK: {ok}")
