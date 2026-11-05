"""YouTube: autenticación por canal, métricas, analíticas, edición, subida y comentarios."""
from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

from .config import CLIENT_SECRET_YT, secreto

SCOPES = [
    "https://www.googleapis.com/auth/youtube",  # leer y editar videos, playlists
    "https://www.googleapis.com/auth/youtube.upload",  # subir
    "https://www.googleapis.com/auth/youtube.force-ssl",  # comentarios
    "https://www.googleapis.com/auth/yt-analytics.readonly",  # analíticas
]


class FaltaAutorizacion(Exception):
    pass


def _token(c: dict) -> Path:
    return secreto(f"yt_{c['id']}.json")


def autorizar(c: dict) -> str:
    """Abre el navegador para dar permiso. Hay que entrar con la cuenta de Google del canal."""
    if not CLIENT_SECRET_YT.exists():
        raise SystemExit(f"No encuentro el client_secret de Google en {CLIENT_SECRET_YT}")
    flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRET_YT), SCOPES)
    print(f"\n>> Se abrirá el navegador. Elige la cuenta/canal: {c['nombre']} ({c['handle']})\n")
    creds = flow.run_local_server(port=0, prompt="consent", open_browser=True)
    yt = build("youtube", "v3", credentials=creds, cache_discovery=False)
    items = yt.channels().list(part="snippet", mine=True).execute().get("items", [])
    if not items:
        raise SystemExit("Esa cuenta no tiene canal de YouTube.")
    obtenido = items[0]["id"]
    if c.get("channel_id") and obtenido != c["channel_id"]:
        raise SystemExit(
            f"Elegiste el canal equivocado ({items[0]['snippet']['title']}). Repite y elige {c['nombre']}."
        )
    _token(c).write_text(creds.to_json(), encoding="utf-8")
    return items[0]["snippet"]["title"]


def credenciales(c: dict) -> Credentials:
    ruta = _token(c)
    if not ruta.exists():
        raise FaltaAutorizacion(f"Falta conectar YouTube de {c['nombre']} (en la PC: delga auth {c['id']}).")
    creds = Credentials.from_authorized_user_file(str(ruta), SCOPES)
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except Exception as e:  # token caducado/revocado (app en modo Testing: ~7 días)
                raise FaltaAutorizacion(f"Hay que renovar el permiso de YouTube de {c['nombre']} (en la PC: delga auth {c['id']}).")
            ruta.write_text(creds.to_json(), encoding="utf-8")
        else:
            raise FaltaAutorizacion(f"Permiso inválido para {c['id']}: ejecuta  delga auth {c['id']}")
    return creds


def _yt(c):
    return build("youtube", "v3", credentials=credenciales(c), cache_discovery=False)


def _ya(c):
    return build("youtubeAnalytics", "v2", credentials=credenciales(c), cache_discovery=False)


def duracion_seg(iso: str) -> int:
    m = re.match(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso or "")
    if not m:
        return 0
    d, h, mi, s = (int(x or 0) for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + s


# ------------------------------------------------------------------ lectura
def info_canal(c: dict) -> dict:
    r = _yt(c).channels().list(part="snippet,statistics,contentDetails", mine=True).execute()
    it = r["items"][0]
    st = it["statistics"]
    return {
        "titulo": it["snippet"]["title"],
        "avatar": it["snippet"]["thumbnails"].get("medium", it["snippet"]["thumbnails"]["default"])["url"],
        "seguidores": int(st.get("subscriberCount", 0)),
        "vistas": int(st.get("viewCount", 0)),
        "videos": int(st.get("videoCount", 0)),
        "uploads": it["contentDetails"]["relatedPlaylists"]["uploads"],
    }


def listar_videos(c: dict, uploads: str | None = None, maximo: int = 200) -> list[dict]:
    yt = _yt(c)
    uploads = uploads or info_canal(c)["uploads"]
    ids, token = [], None
    while len(ids) < maximo:
        r = yt.playlistItems().list(part="contentDetails", playlistId=uploads, maxResults=50, pageToken=token).execute()
        ids += [i["contentDetails"]["videoId"] for i in r.get("items", [])]
        token = r.get("nextPageToken")
        if not token:
            break
    videos = []
    for i in range(0, len(ids), 50):
        r = yt.videos().list(part="snippet,statistics,contentDetails,status", id=",".join(ids[i : i + 50])).execute()
        for v in r.get("items", []):
            s, st = v["snippet"], v.get("statistics", {})
            dur = duracion_seg(v["contentDetails"].get("duration"))
            videos.append(
                {
                    "id": v["id"],
                    "titulo": s["title"],
                    "publicado": s["publishedAt"],
                    "miniatura": s["thumbnails"].get("medium", s["thumbnails"]["default"])["url"],
                    "duracion": dur,
                    "short": dur <= 180,
                    "privacidad": v["status"]["privacyStatus"],
                    "vistas": int(st.get("viewCount", 0)),
                    "likes": int(st.get("likeCount", 0)),
                    "comentarios": int(st.get("commentCount", 0)),
                    "etiquetas": s.get("tags", []),
                    "url": f"https://youtube.com/shorts/{v['id']}" if dur <= 180 else f"https://youtu.be/{v['id']}",
                }
            )
    videos.sort(key=lambda v: v["publicado"], reverse=True)
    return videos


def _consulta(c, **kw) -> dict:
    hoy = dt.date.today()
    kw.setdefault("endDate", hoy.isoformat())
    kw.setdefault("startDate", (hoy - dt.timedelta(days=28)).isoformat())
    return _ya(c).reports().query(ids="channel==MINE", **kw).execute()


def _filas(r: dict) -> list[dict]:
    cols = [h["name"] for h in r.get("columnHeaders", [])]
    return [dict(zip(cols, fila)) for fila in r.get("rows", []) or []]


def analiticas(c: dict, dias: int = 28) -> dict:
    """Analíticas privadas (YouTube Analytics API). Si la API no está habilitada devuelve {'error': ...}."""
    hoy = dt.date.today()
    ini = (hoy - dt.timedelta(days=dias)).isoformat()
    try:
        por_dia = _filas(
            _consulta(
                c,
                startDate=ini,
                metrics="views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost,likes,comments,shares",
                dimensions="day",
                sort="day",
            )
        )
        por_video = _filas(
            _consulta(
                c,
                startDate="2020-01-01",
                metrics="views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes,shares",
                dimensions="video",
                sort="-views",
                maxResults=50,
            )
        )
        trafico = _filas(_consulta(c, startDate=ini, metrics="views", dimensions="insightTrafficSourceType", sort="-views"))
        paises = _filas(_consulta(c, startDate=ini, metrics="views", dimensions="country", sort="-views", maxResults=8))
        demografia = _filas(_consulta(c, startDate=ini, metrics="viewerPercentage", dimensions="ageGroup,gender"))
    except HttpError as e:
        txt = str(e)
        if "accessNotConfigured" in txt or "has not been used" in txt or "disabled" in txt:
            return {"error": "Habilita 'YouTube Analytics API' en Google Cloud (mismo proyecto del client_secret)."}
        if "insufficient" in txt.lower() or "403" in txt:
            return {"error": f"Sin permiso de analíticas: ejecuta  delga auth {c['id']}"}
        return {"error": txt[:300]}
    return {"por_dia": por_dia, "por_video": por_video, "trafico": trafico, "paises": paises, "demografia": demografia}


def comentarios_recientes(c: dict, maximo: int = 20) -> list[dict]:
    r = (
        _yt(c)
        .commentThreads()
        .list(part="snippet", allThreadsRelatedToChannelId=c["channel_id"], maxResults=min(maximo, 100), order="time")
        .execute()
    )
    out = []
    for it in r.get("items", []):
        s = it["snippet"]["topLevelComment"]["snippet"]
        out.append(
            {
                "video": it["snippet"].get("videoId"),
                "autor": s.get("authorDisplayName"),
                "texto": s.get("textOriginal", "")[:300],
                "likes": s.get("likeCount", 0),
                "fecha": s.get("publishedAt"),
                "respuestas": it["snippet"].get("totalReplyCount", 0),
            }
        )
    return out


# ------------------------------------------------------------------ escritura
def editar(c: dict, video_id: str, titulo=None, descripcion=None, etiquetas=None, categoria=None, privacidad=None) -> dict:
    yt = _yt(c)
    v = yt.videos().list(part="snippet,status", id=video_id).execute()["items"]
    if not v:
        raise SystemExit(f"No encuentro el video {video_id} en {c['id']}")
    v = v[0]
    sn, st = v["snippet"], v["status"]
    cuerpo = {
        "id": video_id,
        "snippet": {
            "title": titulo if titulo is not None else sn["title"],
            "description": descripcion if descripcion is not None else sn.get("description", ""),
            "tags": etiquetas if etiquetas is not None else sn.get("tags", []),
            "categoryId": categoria or sn["categoryId"],
            "defaultLanguage": sn.get("defaultLanguage", "es"),
        },
    }
    partes = ["snippet"]
    if privacidad:
        cuerpo["status"] = {"privacyStatus": privacidad, "selfDeclaredMadeForKids": st.get("selfDeclaredMadeForKids", False)}
        partes.append("status")
    return yt.videos().update(part=",".join(partes), body=cuerpo).execute()


def poner_miniatura(c: dict, video_id: str, imagen: str) -> None:
    _yt(c).thumbnails().set(videoId=video_id, media_body=MediaFileUpload(imagen)).execute()


def subir(c: dict, video: str, titulo: str, descripcion: str = "", etiquetas=None, privacidad="private", miniatura=None, categoria=None, publicar_en: str | None = None) -> str:
    """publicar_en: fecha ISO 8601 (con zona). Si se da, el video queda privado y YouTube lo publica solo a esa hora."""
    yt = _yt(c)
    cuerpo = {
        "snippet": {
            "title": titulo[:100],
            "description": descripcion,
            "tags": etiquetas or [],
            "categoryId": categoria or c.get("categoria_defecto", "22"),
            "defaultLanguage": "es",
            "defaultAudioLanguage": "es",
        },
        "status": {"privacyStatus": privacidad, "selfDeclaredMadeForKids": False},
    }
    if publicar_en:
        cuerpo["status"].update(privacyStatus="private", publishAt=publicar_en)
    req = yt.videos().insert(part="snippet,status", body=cuerpo, media_body=MediaFileUpload(video, chunksize=8 * 1024 * 1024, resumable=True))
    resp = None
    while resp is None:
        estado, resp = req.next_chunk()
        if estado:
            print(f"   subiendo… {int(estado.progress() * 100)}%")
    vid = resp["id"]
    if miniatura:
        poner_miniatura(c, vid, miniatura)
    return vid
