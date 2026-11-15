"""Rutas y configuración compartida.

Los secretos (tokens, claves de apps, clave de cifrado del panel) viven FUERA de OneDrive,
en C:\\Users\\<usuario>\\.delga-canales\\ (o en DELGA_SECRETOS si se define).
"""
from __future__ import annotations

import json
import os
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DATOS = Path(os.environ.get("DELGA_DATOS", RAIZ / "datos"))
HISTORIAL = DATOS / "historial"
APP = RAIZ / "app"
SECRETOS = Path(os.environ.get("DELGA_SECRETOS", Path.home() / ".delga-canales"))

# Cliente OAuth de Google ya creado para el canal (el mismo que usa la subida de videos).
CLIENT_SECRET_YT = Path(
    os.environ.get("DELGA_YT_CLIENT_SECRET", Path.home() / ".youtube-delgatronics" / "client_secret.json")
)


def cargar_canales() -> list[dict]:
    return json.loads((RAIZ / "canales.json").read_text(encoding="utf-8"))["canales"]


def canal(cid: str) -> dict:
    for c in cargar_canales():
        if c["id"] == cid:
            return c
    ids = ", ".join(c["id"] for c in cargar_canales())
    raise SystemExit(f"Canal desconocido: {cid}. Opciones: {ids}")


def secreto(nombre: str) -> Path:
    SECRETOS.mkdir(parents=True, exist_ok=True)
    return SECRETOS / nombre


def leer_json(ruta: Path, defecto=None):
    try:
        return json.loads(ruta.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return defecto


def escribir_json(ruta: Path, datos) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    tmp = ruta.with_suffix(ruta.suffix + ".tmp")
    tmp.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(ruta)
