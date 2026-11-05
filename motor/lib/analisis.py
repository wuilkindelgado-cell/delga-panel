"""Análisis de rendimiento y recomendaciones ("qué nos conviene")."""
from __future__ import annotations

import datetime as dt
import statistics as stx
from collections import defaultdict

def _n(x) -> str:
    return f"{x:,.0f}".replace(",", ".")


DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


def _local(iso: str) -> dt.datetime:
    return dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone()


def _engagement(v: dict) -> float:
    if not v.get("vistas"):
        return 0.0
    return (v.get("likes", 0) + v.get("comentarios", 0) + v.get("compartidos", 0)) / v["vistas"]


def resumen_videos(videos: list[dict]) -> dict:
    pub = [v for v in videos if v.get("privacidad", "public") == "public"]
    if not pub:
        return {"n": 0}
    vistas = [v["vistas"] for v in pub]
    ultimo = max(_local(v["publicado"]) for v in pub)
    return {
        "n": len(pub),
        "vistas_media": round(stx.mean(vistas)),
        "vistas_mediana": round(stx.median(vistas)),
        "engagement_medio": round(stx.mean(_engagement(v) for v in pub) * 100, 2),
        "dias_sin_publicar": (dt.datetime.now().astimezone() - ultimo).days,
        "mejor": max(pub, key=lambda v: v["vistas"]),
    }


def mejor_momento(videos: list[dict]) -> dict:
    """Vistas medias según día y franja horaria de publicación (hora local)."""
    por_dia, por_franja = defaultdict(list), defaultdict(list)
    for v in videos:
        if v.get("privacidad", "public") != "public":
            continue
        t = _local(v["publicado"])
        por_dia[DIAS[t.weekday()]].append(v["vistas"])
        franja = "mañana (6–12)" if 6 <= t.hour < 12 else "tarde (12–18)" if 12 <= t.hour < 18 else "noche (18–24)" if t.hour >= 18 else "madrugada (0–6)"
        por_franja[franja].append(v["vistas"])
    med = lambda d: {k: {"n": len(x), "vistas_media": round(stx.mean(x))} for k, x in d.items()}
    return {"dia": med(por_dia), "franja": med(por_franja)}


def recomendaciones(canales: list[dict]) -> list[dict]:
    """canales: lista de dicts de metricas.json (con 'videos', 'resumen', 'momento', 'analiticas', 'delta7')."""
    recs = []

    def add(c, prioridad, texto):
        recs.append({"canal": c["id"] if c else "general", "nombre": f"{c['nombre']} · {c['plataforma'].capitalize()}" if c else "General", "prioridad": prioridad, "texto": texto})

    activos = [c for c in canales if c.get("estado") == "ok"]
    for c in activos:
        r = c.get("resumen", {})
        if not r.get("n"):
            add(c, 1, "Aún no hay videos públicos: publica el primero para empezar a medir.")
            continue
        if r["dias_sin_publicar"] >= 2:
            add(c, 1, f"Llevas {r['dias_sin_publicar']} días sin publicar. El algoritmo premia la constancia: tu meta es 1 video diario.")
        m = r["mejor"]
        add(c, 2, f"Tu mejor video es «{m['titulo'][:60]}» con {_n(m['vistas'])} vistas. Haz otro con el mismo tipo de gancho/tema.")
        mo = c.get("momento", {})
        dias = {k: v for k, v in mo.get("dia", {}).items() if v["n"] >= 2}
        if len(dias) >= 2:
            d = max(dias, key=lambda k: dias[k]["vistas_media"])
            add(c, 2, f"Los videos publicados en {d} promedian {_n(dias[d]['vistas_media'])} vistas, tu mejor día hasta ahora.")
        elif r["n"] < 6:
            add(c, 3, "Todavía hay pocos videos para saber el mejor día y hora. Publica en días y horas distintos y el panel te dirá cuál funciona mejor.")
        franjas = {k: v for k, v in mo.get("franja", {}).items() if v["n"] >= 2}
        if len(franjas) >= 2:
            f = max(franjas, key=lambda k: franjas[k]["vistas_media"])
            add(c, 3, f"Mejor franja para publicar: {f} ({_n(franjas[f]['vistas_media'])} vistas de media).")
        if r["engagement_medio"] < 3 and r["n"] >= 3:
            add(c, 2, f"Interacción baja ({r['engagement_medio']} %). Cierra cada video con una pregunta concreta y fija un comentario con otra pregunta.")
        a = c.get("analiticas") or {}
        pv = [x for x in a.get("por_video", []) if x.get("averageViewPercentage") is not None]
        if pv:
            ret = stx.mean(x["averageViewPercentage"] for x in pv)
            if ret < 70:
                add(c, 1, f"La gente ve en promedio el {ret:.0f} % de tus videos. Para Shorts conviene >80 %: gancho en el primer segundo y menos de 60 s si el tema lo permite.")
            peor = min(pv, key=lambda x: x["averageViewPercentage"])
            titulo = next((v["titulo"] for v in c.get("videos", []) if v["id"] == peor.get("video")), peor.get("video"))
            if peor["averageViewPercentage"] < ret - 10:
                add(c, 3, f"«{str(titulo)[:50]}» es el que más abandonan ({peor['averageViewPercentage']:.0f} % visto). Revisa en qué segundo cae la retención en YouTube Studio.")
        traf = {x["insightTrafficSourceType"]: x["views"] for x in a.get("trafico", [])}
        if traf:
            tot = sum(traf.values()) or 1
            shorts = traf.get("SHORTS", 0) / tot
            busq = traf.get("YT_SEARCH", 0) / tot
            if shorts > 0.7:
                add(c, 3, f"El {shorts:.0%} de tus vistas viene del feed de Shorts: el primer fotograma y el gancho deciden todo.")
            if busq > 0.15:
                add(c, 2, f"Un {busq:.0%} llega por búsqueda: usa en título y descripción las palabras exactas que la gente busca.")
        d7 = c.get("delta7") or {}
        if d7.get("seguidores") is not None and d7["seguidores"] <= 0 and r["n"] >= 3:
            add(c, 2, "No ganaste seguidores en 7 días: añade un llamado claro a seguir el canal en los últimos 2 segundos.")
        largos = [v for v in c.get("videos", []) if v.get("duracion", 0) > 60]
        cortos = [v for v in c.get("videos", []) if 0 < v.get("duracion", 0) <= 60]
        if len(largos) >= 2 and len(cortos) >= 2:
            ml, mc = stx.mean(v["vistas"] for v in largos), stx.mean(v["vistas"] for v in cortos)
            mejor = "de menos de 60 s" if mc > ml else "de más de 60 s"
            add(c, 3, f"Tus videos {mejor} rinden mejor ({_n(max(ml, mc))} vs {_n(min(ml, mc))} vistas de media).")

    # comparación entre plataformas de una misma marca
    por_marca = defaultdict(dict)
    for c in activos:
        if c.get("resumen", {}).get("n"):
            por_marca[c["marca"]][c["plataforma"]] = c
    for marca, plats in por_marca.items():
        if "youtube" in plats and "tiktok" in plats:
            yt, tt = plats["youtube"]["resumen"]["vistas_media"], plats["tiktok"]["resumen"]["vistas_media"]
            gana = "TikTok" if tt > yt else "YouTube"
            add(None, 2, f"{plats['youtube']['nombre']}: el mismo contenido rinde más en {gana} ({_n(max(yt, tt))} vs {_n(min(yt, tt))} vistas de media). Prioriza publicar ahí primero.")
    pendientes = [c for c in canales if c.get("estado") != "ok"]
    for c in pendientes:
        add(c, 1, c.get("mensaje", "Falta conectar esta cuenta."))
    recs.sort(key=lambda r: r["prioridad"])
    return recs
