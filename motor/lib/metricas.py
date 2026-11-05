"""Recolecta las métricas de los 4 canales y genera datos/metricas.json (+ historial diario)."""
from __future__ import annotations

import datetime as dt
import traceback

from . import analisis, tiktok, youtube
from .config import DATOS, HISTORIAL, cargar_canales, escribir_json, leer_json


def _youtube(c: dict) -> dict:
    info = youtube.info_canal(c)
    videos = youtube.listar_videos(c, info["uploads"])
    a = youtube.analiticas(c)
    try:
        coments = youtube.comentarios_recientes(c, 15)
    except Exception as e:  # noqa: BLE001
        coments = []
        print(f"   (comentarios de {c['id']} no disponibles: {str(e)[:120]})")
    return {
        "titulo": info["titulo"],
        "avatar": info["avatar"],
        "seguidores": info["seguidores"],
        "vistas": info["vistas"],
        "num_videos": info["videos"],
        "likes": sum(v["likes"] for v in videos),
        "videos": videos,
        "analiticas": a,
        "comentarios": coments,
    }


def _tiktok(c: dict) -> dict:
    u = tiktok.perfil(c)
    videos = tiktok.listar_videos(c)
    return {
        "titulo": u.get("display_name"),
        "handle": "@" + u["username"] if u.get("username") else c.get("handle"),
        "url": f"https://www.tiktok.com/@{u['username']}" if u.get("username") else c.get("url"),
        "avatar": u.get("avatar_url"),
        "seguidores": u.get("follower_count", 0),
        "siguiendo": u.get("following_count", 0),
        "likes": u.get("likes_count", 0),
        "num_videos": u.get("video_count", 0),
        "vistas": sum(v["vistas"] for v in videos),
        "videos": videos,
        "analiticas": None,
        "comentarios": [],
    }


def _historial() -> list[dict]:
    if not HISTORIAL.exists():
        return []
    return [leer_json(p) for p in sorted(HISTORIAL.glob("*.json")) if leer_json(p)]


def _hace(hist: list[dict], dias: int) -> dict | None:
    objetivo = (dt.date.today() - dt.timedelta(days=dias)).isoformat()
    previos = [h for h in hist if h["fecha"] <= objetivo]
    return previos[-1] if previos else (hist[0] if hist and hist[0]["fecha"] < dt.date.today().isoformat() else None)


def recolectar() -> dict:
    canales = []
    for cfg in cargar_canales():
        c = {k: cfg.get(k) for k in ("id", "nombre", "plataforma", "marca", "handle", "url", "color")}
        print(f"· {cfg['id']}…")
        try:
            datos = _youtube(cfg) if cfg["plataforma"] == "youtube" else _tiktok(cfg)
            c.update({k: v for k, v in datos.items() if v is not None or k not in c})
            c["estado"] = "ok"
        except (youtube.FaltaAutorizacion, tiktok.FaltaAutorizacion) as e:
            c.update(estado="sin_autorizar", mensaje=str(e))
        except Exception as e:  # noqa: BLE001
            c.update(estado="error", mensaje=f"Error leyendo {cfg['id']}: {str(e)[:200]}")
            traceback.print_exc()
        canales.append(c)

    hoy = dt.date.today().isoformat()
    foto = {
        "fecha": hoy,
        "canales": {c["id"]: {k: c.get(k) for k in ("seguidores", "vistas", "num_videos", "likes")} for c in canales if c["estado"] == "ok"},
        "videos": {v["id"]: v["vistas"] for c in canales if c["estado"] == "ok" for v in c["videos"]},
    }
    hist = [h for h in _historial() if h["fecha"] != hoy]
    previo = leer_json(HISTORIAL / f"{hoy}.json")
    if previo:  # conservar canales que hoy fallaron
        for k, v in previo.get("canales", {}).items():
            foto["canales"].setdefault(k, v)
    escribir_json(HISTORIAL / f"{hoy}.json", foto)
    hist.append(foto)
    ayer, semana = _hace(hist, 1), _hace(hist, 7)

    for c in canales:
        serie = [{"fecha": h["fecha"], **h["canales"][c["id"]]} for h in hist[-120:] if c["id"] in h.get("canales", {})]
        c["serie"] = serie
        if c["estado"] != "ok":
            continue
        def _delta(foto):
            base = (foto or {}).get("canales", {}).get(c["id"])
            return {k: c[k] - (base.get(k) or 0) for k in ("seguidores", "vistas", "likes")} if base else None

        c["delta1"], c["delta7"], c["delta28"] = _delta(ayer), _delta(semana), _delta(_hace(hist, 28))
        prev_v = (ayer or {}).get("videos", {})
        # retención y demás analíticas de YouTube por video
        av = {x.get("video"): x for x in ((c.get("analiticas") or {}).get("por_video") or [])}
        for v in c["videos"]:
            v["engagement"] = round(analisis._engagement(v) * 100, 2)
            v["delta24"] = v["vistas"] - prev_v[v["id"]] if v["id"] in prev_v else None
            v["hist"] = [{"f": h["fecha"], "v": h["videos"][v["id"]]} for h in hist[-60:] if v["id"] in h.get("videos", {})]
            x = av.get(v["id"])
            if x:
                v["retencion"] = x.get("averageViewPercentage")
                v["ver_medio"] = x.get("averageViewDuration")
                v["subs"] = x.get("subscribersGained")
                v["compartidos"] = x.get("shares", v.get("compartidos"))
                v["minutos"] = x.get("estimatedMinutesWatched")
        c["resumen"] = analisis.resumen_videos(c["videos"])
        c["momento"] = analisis.mejor_momento(c["videos"])

    ok = [c for c in canales if c["estado"] == "ok"]
    resultado = {
        "generado": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "totales": {
            "seguidores": sum(c.get("seguidores", 0) for c in ok),
            "vistas": sum(c.get("vistas", 0) for c in ok),
            "likes": sum(c.get("likes", 0) for c in ok),
            "videos": sum(c.get("num_videos", 0) for c in ok),
            "seguidores_7d": sum((c.get("delta7") or {}).get("seguidores", 0) for c in ok),
            "vistas_7d": sum((c.get("delta7") or {}).get("vistas", 0) for c in ok),
        },
        "canales": canales,
        "recomendaciones": analisis.recomendaciones(canales),
    }
    from .calendario import plan

    resultado["plan"] = plan(resultado)
    escribir_json(DATOS / "metricas.json", resultado)
    return resultado
