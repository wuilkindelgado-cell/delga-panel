"""Cifra los datos del panel (AES-256-GCM + PBKDF2) para poder publicarlos en una web pública.

La app del celular los descifra con la misma clave (WebCrypto). Sin la clave, el archivo es ilegible.
"""
from __future__ import annotations

import base64
import json
import os
import secrets

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from .config import secreto

ITERACIONES = 310_000


def clave_panel() -> str:
    """Clave del panel, generada una vez y guardada fuera de OneDrive."""
    ruta = secreto("clave_panel.txt")
    if not ruta.exists():
        palabras = ["placa", "balon", "servo", "gol", "chip", "cancha", "led", "taco", "robot", "pase", "motor", "pared"]
        clave = "-".join(secrets.choice(palabras) for _ in range(3)) + "-" + str(secrets.randbelow(900) + 100)
        ruta.write_text(clave, encoding="utf-8")
    return ruta.read_text(encoding="utf-8").strip()


def descifrar(enc: dict, clave: str) -> dict:
    d = lambda x: base64.b64decode(x)
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=d(enc["sal"]), iterations=enc["it"])
    k = kdf.derive(clave.encode("utf-8"))
    return json.loads(AESGCM(k).decrypt(d(enc["iv"]), d(enc["datos"]), None).decode("utf-8"))


def cifrar(datos: dict, clave: str) -> dict:
    sal = os.urandom(16)
    iv = os.urandom(12)
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=sal, iterations=ITERACIONES)
    k = kdf.derive(clave.encode("utf-8"))
    texto = json.dumps(datos, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    cif = AESGCM(k).encrypt(iv, texto, None)
    b = lambda x: base64.b64encode(x).decode()
    return {"v": 1, "it": ITERACIONES, "sal": b(sal), "iv": b(iv), "datos": b(cif)}


def con_buzon(datos: dict) -> dict:
    """Añade el acceso del buzón de audios (app Grabar) a los datos que viajan CIFRADOS con la clave del panel."""
    from .config import secreto

    ruta = secreto("grabar_token.txt")
    return {**datos, "buzon": ruta.read_text(encoding="ascii").strip()} if ruta.exists() else datos
