"""TikTok (API oficial v2): login por cuenta, métricas de perfil y videos, subida.

Requiere una app propia en https://developers.tiktok.com (gratis):
  - Productos: Login Kit (Desktop) + Content Posting API
  - Scopes: user.info.basic, user.info.profile, user.info.stats, video.list, video.upload, video.publish
  - Redirect URI: http://localhost:8723/callback/
Guarda client_key y client_secret con:  delga tiktok-app <client_key> <client_secret>

Límites de TikTok que no dependen de nosotros:
  - La API NO permite editar la descripción de un video ya publicado.
  - Mientras la app no pase la revisión de TikTok, lo que se publique por API queda en "Solo yo" (privado).
"""
from __future__ import annotations

import base64
import hashlib
import http.server
import secrets
import threading
import time
import urllib.parse
import webbrowser
from pathlib import Path

import requests

from .config import leer_json, escribir_json, secreto

API = "https://open.tiktokapis.com/v2"
PUERTO = 8723
REDIRECT = f"http://localhost:{PUERTO}/callback/"
SCOPES = "user.info.basic,user.info.profile,user.info.stats,video.list,video.upload,video.publish"


class FaltaAutorizacion(Exception):
    pass


def _app() -> dict:
    app = leer_json(secreto("tiktok_app.json"))
    if not app:
        raise FaltaAutorizacion("Falta la app de TikTok: crea una en developers.tiktok.com y ejecuta  delga tiktok-app <client_key> <client_secret>")
    return app


def guardar_app(client_key: str, client_secret: str) -> None:
    escribir_json(secreto("tiktok_app.json"), {"client_key": client_key, "client_secret": client_secret, "redirect_uri": REDIRECT})


def _token_ruta(c: dict) -> Path:
    return secreto(f"tt_{c['id']}.json")


def autorizar(c: dict) -> str:
    app = _app()
    verificador = secrets.token_urlsafe(64)[:64]
    # Login Kit para escritorio: code_challenge = SHA256(verificador) en hexadecimal
    reto = hashlib.sha256(verificador.encode()).hexdigest()
    estado = secrets.token_urlsafe(16)
    url = "https://www.tiktok.com/v2/auth/authorize/?" + urllib.parse.urlencode(
        {
            "client_key": app["client_key"],
            "scope": app.get("scopes") or SCOPES,  # se puede ajustar en tiktok_app.json
            "response_type": "code",
            "redirect_uri": app.get("redirect_uri", REDIRECT),
            "state": estado,
            "code_challenge": reto,
            "code_challenge_method": "S256",
            "disable_auto_auth": 1,
        }
    )
    recibido: dict = {}

    class Manejador(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            recibido.update({k: v[0] for k, v in q.items()})
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write("<h2>Listo, ya puedes cerrar esta pestaña.</h2>".encode())

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("localhost", PUERTO), Manejador)
    hilo = threading.Thread(target=srv.handle_request, daemon=True)
    hilo.start()
    print(f"\n>> Inicia sesión en TikTok con la cuenta de {c['nombre']} (cierra antes cualquier otra sesión).\n{url}\n")
    webbrowser.open(url)
    hilo.join(timeout=300)
    srv.server_close()
    if recibido.get("state") != estado or "code" not in recibido:
        raise SystemExit(f"No se completó el login de TikTok: {recibido.get('error_description') or recibido}")
    r = requests.post(
        f"{API}/oauth/token/",
        data={
            "client_key": app["client_key"],
            "client_secret": app["client_secret"],
            "code": recibido["code"],
            "grant_type": "authorization_code",
            "redirect_uri": app.get("redirect_uri", REDIRECT),
            "code_verifier": verificador,
        },
        timeout=30,
    ).json()
    if "access_token" not in r:
        raise SystemExit(f"TikTok rechazó el login: {r}")
    r["obtenido"] = time.time()
    escribir_json(_token_ruta(c), r)
    return perfil(c).get("username", "?")


def _access(c: dict) -> str:
    tok = leer_json(_token_ruta(c))
    if not tok:
        raise FaltaAutorizacion(f"Falta conectar TikTok de {c['nombre']} (en la PC: delga auth {c['id']}).")
    if time.time() > tok["obtenido"] + tok.get("expires_in", 86400) - 300:
        app = _app()
        r = requests.post(
            f"{API}/oauth/token/",
            data={"client_key": app["client_key"], "client_secret": app["client_secret"], "grant_type": "refresh_token", "refresh_token": tok["refresh_token"]},
            timeout=30,
        ).json()
        if "access_token" not in r:
            raise FaltaAutorizacion(f"El permiso de TikTok de {c['id']} caducó: ejecuta  delga auth {c['id']}")
        r["obtenido"] = time.time()
        escribir_json(_token_ruta(c), r)
        tok = r
    return tok["access_token"]


def _h(c):
    return {"Authorization": f"Bearer {_access(c)}"}


def _ok(r: requests.Response) -> dict:
    j = r.json()
    err = j.get("error", {})
    if err and err.get("code") not in (None, "ok"):
        raise RuntimeError(f"TikTok: {err.get('code')} · {err.get('message')}")
    return j.get("data", {})


def permisos(c: dict) -> set[str]:
    tok = leer_json(_token_ruta(c)) or {}
    return set((tok.get("scope") or "").replace(" ", "").split(","))


def perfil(c: dict) -> dict:
    p = permisos(c)
    campos = ["open_id", "display_name", "avatar_url"]
    if "user.info.profile" in p:
        campos += ["username"]
    if "user.info.stats" in p:
        campos += ["follower_count", "following_count", "likes_count", "video_count"]
    u = _ok(requests.get(f"{API}/user/info/", params={"fields": ",".join(campos)}, headers=_h(c), timeout=30))["user"]
    faltan = {"user.info.profile", "user.info.stats", "video.list"} - p
    if faltan:
        u["_faltan_permisos"] = sorted(faltan)
    return u


def listar_videos(c: dict, maximo: int = 100) -> list[dict]:
    if "video.list" not in permisos(c):
        return []
    campos = "id,title,video_description,create_time,cover_image_url,share_url,duration,view_count,like_count,comment_count,share_count"
    out, cursor = [], None
    while len(out) < maximo:
        cuerpo = {"max_count": 20}
        if cursor:
            cuerpo["cursor"] = cursor
        d = _ok(requests.post(f"{API}/video/list/", params={"fields": campos}, json=cuerpo, headers=_h(c), timeout=30))
        for v in d.get("videos", []):
            out.append(
                {
                    "id": v["id"],
                    "titulo": v.get("title") or (v.get("video_description") or "")[:80],
                    "descripcion": v.get("video_description", ""),
                    "publicado": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(v.get("create_time", 0))),
                    "miniatura": v.get("cover_image_url"),
                    "duracion": v.get("duration", 0),
                    "short": True,
                    "vistas": v.get("view_count", 0),
                    "likes": v.get("like_count", 0),
                    "comentarios": v.get("comment_count", 0),
                    "compartidos": v.get("share_count", 0),
                    "url": v.get("share_url"),
                }
            )
        if not d.get("has_more"):
            break
        cursor = d.get("cursor")
    return out


def subir(c: dict, video: str, descripcion: str, privacidad: str = "SELF_ONLY") -> str:
    """Sube un video. Si la app no está auditada, TikTok solo permite SELF_ONLY."""
    h = _h(c)
    info = _ok(requests.post(f"{API}/post/publish/creator_info/query/", headers=h, timeout=30))
    permitidas = info.get("privacy_level_options", [])
    if privacidad not in permitidas:
        print(f"   Aviso: TikTok no permite '{privacidad}' para esta app/cuenta. Opciones: {permitidas}. Uso {permitidas[-1]}.")
        privacidad = permitidas[-1]
    tam = Path(video).stat().st_size
    trozo = min(tam, 10 * 1024 * 1024)
    n = max(1, tam // trozo)
    d = _ok(
        requests.post(
            f"{API}/post/publish/video/init/",
            headers={**h, "Content-Type": "application/json; charset=UTF-8"},
            json={
                "post_info": {"title": descripcion[:2200], "privacy_level": privacidad, "disable_comment": False, "disable_duet": False, "disable_stitch": False},
                "source_info": {"source": "FILE_UPLOAD", "video_size": tam, "chunk_size": trozo, "total_chunk_count": n},
            },
            timeout=30,
        )
    )
    with open(video, "rb") as f:
        for i in range(n):
            ini = i * trozo
            fin = tam - 1 if i == n - 1 else ini + trozo - 1
            f.seek(ini)
            datos = f.read(fin - ini + 1)
            r = requests.put(
                d["upload_url"],
                data=datos,
                headers={"Content-Type": "video/mp4", "Content-Range": f"bytes {ini}-{fin}/{tam}", "Content-Length": str(len(datos))},
                timeout=300,
            )
            r.raise_for_status()
            print(f"   subiendo… {int((i + 1) / n * 100)}%")
    return d["publish_id"]


def borrador(c: dict, video: str) -> str:
    """Envía el video a la bandeja de TikTok del creador (scope video.upload).
    Le llega una notificación en la app para revisarlo, poner el texto y publicarlo."""
    h = _h(c)
    tam = Path(video).stat().st_size
    trozo = min(tam, 10 * 1024 * 1024)
    n = max(1, tam // trozo)
    d = _ok(
        requests.post(
            f"{API}/post/publish/inbox/video/init/",
            headers={**h, "Content-Type": "application/json; charset=UTF-8"},
            json={"source_info": {"source": "FILE_UPLOAD", "video_size": tam, "chunk_size": trozo, "total_chunk_count": n}},
            timeout=30,
        )
    )
    with open(video, "rb") as f:
        for i in range(n):
            ini = i * trozo
            fin = tam - 1 if i == n - 1 else ini + trozo - 1
            f.seek(ini)
            datos = f.read(fin - ini + 1)
            r = requests.put(d["upload_url"], data=datos, headers={"Content-Type": "video/mp4", "Content-Range": f"bytes {ini}-{fin}/{tam}", "Content-Length": str(len(datos))}, timeout=300)
            r.raise_for_status()
            print(f"   subiendo… {int((i + 1) / n * 100)}%")
    return d["publish_id"]


def estado_publicacion(c: dict, publish_id: str) -> dict:
    return _ok(requests.post(f"{API}/post/publish/status/fetch/", headers=_h(c), json={"publish_id": publish_id}, timeout=30))




# ---------------------------------------------------------------------------
# Para el Publicador (pantalla web local): login en dos pasos y publicación directa.
# ---------------------------------------------------------------------------
def url_autorizacion() -> tuple[str, str, str]:
    """Devuelve (url, state, code_verifier) para iniciar el login de TikTok."""
    app = _app()
    verificador = secrets.token_urlsafe(64)[:64]
    reto = hashlib.sha256(verificador.encode()).hexdigest()
    estado = secrets.token_urlsafe(16)
    url = "https://www.tiktok.com/v2/auth/authorize/?" + urllib.parse.urlencode(
        {
            "client_key": app["client_key"],
            "scope": app.get("scopes") or SCOPES,
            "response_type": "code",
            "redirect_uri": app.get("redirect_uri", REDIRECT),
            "state": estado,
            "code_challenge": reto,
            "code_challenge_method": "S256",
            "disable_auto_auth": 1,
        }
    )
    return url, estado, verificador


def canjear_codigo(code: str, verificador: str) -> dict:
    """Canjea el código del login y devuelve el token (con open_id)."""
    app = _app()
    r = requests.post(
        f"{API}/oauth/token/",
        data={"client_key": app["client_key"], "client_secret": app["client_secret"], "code": code,
              "grant_type": "authorization_code", "redirect_uri": app.get("redirect_uri", REDIRECT), "code_verifier": verificador},
        timeout=30,
    ).json()
    if "access_token" not in r:
        raise RuntimeError(f"TikTok rechazó el login: {r}")
    r["obtenido"] = time.time()
    return r


def guardar_token(c: dict, tok: dict) -> None:
    escribir_json(_token_ruta(c), tok)


def creator_info(c: dict) -> dict:
    """Datos del creador para la pantalla de publicación (avatar, apodo, privacidades permitidas, límites)."""
    return _ok(requests.post(f"{API}/post/publish/creator_info/query/", headers={**_h(c), "Content-Type": "application/json; charset=UTF-8"}, timeout=30))


def publicar_directo(c: dict, video: str, post_info: dict) -> str:
    """Publicación directa (Direct Post) con las opciones elegidas por el creador en la pantalla."""
    h = _h(c)
    tam = Path(video).stat().st_size
    trozo = min(tam, 10 * 1024 * 1024)
    n = max(1, tam // trozo)
    d = _ok(
        requests.post(
            f"{API}/post/publish/video/init/",
            headers={**h, "Content-Type": "application/json; charset=UTF-8"},
            json={"post_info": post_info, "source_info": {"source": "FILE_UPLOAD", "video_size": tam, "chunk_size": trozo, "total_chunk_count": n}},
            timeout=30,
        )
    )
    with open(video, "rb") as f:
        for i in range(n):
            ini = i * trozo
            fin = tam - 1 if i == n - 1 else ini + trozo - 1
            f.seek(ini)
            datos = f.read(fin - ini + 1)
            requests.put(d["upload_url"], data=datos, headers={"Content-Type": "video/mp4", "Content-Range": f"bytes {ini}-{fin}/{tam}", "Content-Length": str(len(datos))}, timeout=600).raise_for_status()
    return d["publish_id"]
