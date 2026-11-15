"""Buzón privado (repo wuilkindelgado-cell/delga-buzon) entre el Delga Panel del celular y la PC/nube.

Celular → buzón: entrada/ (audios + marcas ✂), aprobaciones/, respuestas/ (comentarios), suscripciones/ (avisos push).
PC/nube → buzón: guiones.json (por grabar), estado.json (tablero de producción + videos para revisar), revisar/ (previas).

Funciona con el token del buzón (grabar_token.txt), así corre igual en la PC que en GitHub Actions.
"""
from __future__ import annotations

import base64
import json
import re
import subprocess
from datetime import datetime
from pathlib import Path

import requests

from .config import RAIZ, secreto

REPO = "wuilkindelgado-cell/delga-buzon"
API = f"https://api.github.com/repos/{REPO}/contents"
VIDEOS = RAIZ.parent
CATEGORIAS = {"Futbol": "Delgafutbol", "Electronica-Mecatronica": "Delgatronics", "Cultura general": "Cultura general"}
CANAL_YT = {"Delgafutbol": "yt-delgafutbol", "Delgatronics": "yt-delgatronics"}
EXT_AUDIO = {".m4a", ".mp4", ".mp3", ".wav", ".aac", ".webm", ".ogg", ".caf", ".mov"}
PANEL = "https://wuilkindelgado-cell.github.io/delga-panel/"


# ------------------------------------------------------------------ API del buzón
def _token() -> str:
    return secreto("grabar_token.txt").read_text(encoding="ascii").strip()


def _h(raw=False):
    return {"Authorization": f"Bearer {_token()}", "Accept": "application/vnd.github.raw" if raw else "application/vnd.github+json"}


def _listar(carpeta: str) -> list[dict]:
    r = requests.get(f"{API}/{carpeta}", headers=_h(), timeout=30)
    return r.json() if r.status_code == 200 and isinstance(r.json(), list) else []


def _leer(ruta: str, crudo=False):
    r = requests.get(f"{API}/{ruta}", headers=_h(raw=True), timeout=120)
    if r.status_code != 200:
        return None
    return r.content if crudo else r.json()


def _sha(ruta: str) -> str | None:
    r = requests.get(f"{API}/{ruta}", headers=_h(), timeout=30)
    return r.json().get("sha") if r.status_code == 200 and isinstance(r.json(), dict) else None


def _poner(ruta: str, contenido: bytes, mensaje: str) -> None:
    cuerpo = {"message": mensaje, "content": base64.b64encode(contenido).decode()}
    sha = _sha(ruta)
    if sha:
        cuerpo["sha"] = sha
    r = requests.put(f"{API}/{ruta}", headers=_h(), json=cuerpo, timeout=300)
    r.raise_for_status()


def _borrar(ruta: str, sha: str, mensaje: str) -> None:
    requests.delete(f"{API}/{ruta}", headers=_h(), json={"message": mensaje, "sha": sha}, timeout=30)


def _poner_json(ruta: str, datos, mensaje: str, anterior=None) -> bool:
    """Sube el JSON solo si cambió (para no llenar el repo de commits)."""
    if anterior is None:
        anterior = _leer(ruta)
    if anterior == datos:
        return False
    _poner(ruta, json.dumps(datos, ensure_ascii=False, indent=1).encode("utf-8"), mensaje)
    return True


# ------------------------------------------------------------------ estado local (qué ya se avisó)
def _estado_local() -> dict:
    p = secreto("buzon_estado.json")
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def _guardar_estado_local(e: dict) -> None:
    secreto("buzon_estado.json").write_text(json.dumps(e, ensure_ascii=False, indent=1), encoding="utf-8")


# ------------------------------------------------------------------ carpetas de videos
def _tiene_voz(carpeta: Path) -> bool:
    return any(p.name.lower().startswith("voz") and p.suffix.lower() in EXT_AUDIO for p in carpeta.iterdir())


def _video_final(carpeta: Path) -> Path | None:
    vs = [p for p in carpeta.glob("*.mp4") if not p.name.lower().startswith("voz") and not p.stem.endswith("-tiktok")]
    return max(vs, key=lambda p: p.stat().st_mtime) if vs else None


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
    partes = [p.strip() for p in titulo_md.split(" — ")]
    tema = partes[0]
    if tema.lower().startswith("guion"):
        tema = partes[1] if len(partes) > 1 else re.sub(r"^\d+-", "", md.parent.name).replace("-", " ").capitalize()
    return {"tema": tema, "titulo": m.group(1).strip() if m else "", "lineas": lineas}


def _leer_descripcion(carpeta: Path) -> dict:
    f = carpeta / "descripcion-youtube.txt"
    if not f.exists():
        return {}
    l = f.read_text(encoding="utf-8").splitlines()

    def bloque(nombre, hasta):
        try:
            i = l.index(nombre)
        except ValueError:
            return ""
        j = next((k for k in range(i + 1, len(l)) if l[k] in hasta), len(l))
        return "\n".join(l[i + 1:j]).strip()

    cab = ["TÍTULO:", "DESCRIPCIÓN:", "ETIQUETAS:", "TIKTOK:"]
    return {"titulo": bloque("TÍTULO:", cab), "descripcion": bloque("DESCRIPCIÓN:", cab), "etiquetas": bloque("ETIQUETAS:", cab), "tiktok": bloque("TIKTOK:", cab)}


def _carpetas():
    for cat, canal in CATEGORIAS.items():
        base = VIDEOS / cat
        if base.exists():
            for d in sorted(base.iterdir()):
                if d.is_dir() and not d.name.startswith("_") and (d / "guion-grabacion.md").exists() and not (d / "NO-GRABAR").exists():
                    yield cat, canal, d


def pendientes() -> list[dict]:
    out = []
    for cat, canal, d in _carpetas():
        if _tiene_voz(d):
            continue
        md = d / "guion-grabacion.md"
        g = _leer_guion(md)
        if g["lineas"]:
            out.append({"id": f"{cat}/{d.name}", "canal": canal, **g, "fecha": datetime.fromtimestamp(md.stat().st_mtime).isoformat(timespec="minutes")})
    out.sort(key=lambda g: g["fecha"], reverse=True)
    return out


def produccion() -> list[dict]:
    """Tablero: guion → grabado → editando → revisar → publicado (según lo que hay en cada carpeta)."""
    out = []
    for cat, canal, d in _carpetas():
        pub = d / "publicado.json"
        final = _video_final(d)
        info = json.loads(pub.read_text(encoding="utf-8")) if pub.exists() else {}
        if pub.exists():
            etapa = "publicado"
        elif final:
            etapa = "revisar"
        elif _tiene_voz(d):
            etapa = "editando"
        else:
            etapa = "guion"
        g = _leer_guion(d / "guion-grabacion.md")
        item = {"id": f"{cat}/{d.name}", "canal": canal, "tema": g["tema"], "etapa": etapa,
                "fecha": datetime.fromtimestamp(max(p.stat().st_mtime for p in d.iterdir())).isoformat(timespec="minutes")}
        if etapa == "publicado":
            item["enlaces"] = {k: v for k, v in info.items() if k in ("youtube", "tiktok")}
            item["tiktok_pendiente"] = bool(info.get("tiktok_pendiente"))
        if etapa == "revisar":
            desc = _leer_descripcion(d)
            item.update({"titulo": desc.get("titulo", ""), "tiktok": desc.get("tiktok", ""), "descripcion": desc.get("descripcion", "")[:600],
                         "previa": f"revisar/{d.name}.mp4", "miniatura": f"revisar/{d.name}.jpg",
                         "duracion": _duracion(final)})
            if (d / "cambios-pedidos.md").exists():
                item["cambios"] = (d / "cambios-pedidos.md").read_text(encoding="utf-8")[-400:]
        out.append(item)
    orden = {"revisar": 0, "editando": 1, "grabado": 2, "guion": 3, "publicado": 4}
    out.sort(key=lambda x: (orden[x["etapa"]], x["fecha"]), reverse=False)
    pubs = [x for x in out if x["etapa"] == "publicado"]
    pubs.sort(key=lambda x: x["fecha"], reverse=True)
    return [x for x in out if x["etapa"] != "publicado"] + pubs[:8]


def _duracion(video: Path) -> float:
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(video)], capture_output=True, text=True, timeout=30)
        return round(float(r.stdout.strip()), 1)
    except Exception:
        return 0.0


def _subir_previas(items: list[dict], est: dict) -> None:
    """Para cada video en «revisar», sube una previa liviana (540p) y la miniatura, una sola vez por versión."""
    hechas = est.setdefault("previas", {})
    for it in items:
        if it["etapa"] != "revisar":
            continue
        d = VIDEOS / it["id"]
        final = _video_final(d)
        firma = f"{final.name}:{int(final.stat().st_mtime)}"
        if hechas.get(it["id"]) == firma:
            continue
        tmp = secreto("previa_tmp.mp4")
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(final), "-vf", "scale=540:-2", "-c:v", "libx264", "-crf", "30", "-preset", "veryfast",
                        "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", str(tmp)], check=True)
        _poner(it["previa"], tmp.read_bytes(), f"Previa: {it['tema']}")
        tmp.unlink(missing_ok=True)
        mini = d / "miniatura-short.jpg"
        if mini.exists():
            _poner(it["miniatura"], mini.read_bytes(), f"Miniatura: {it['tema']}")
        hechas[it["id"]] = firma
        avisar("👀 Video listo para revisar", it["tema"], "#grabar", est)


# ------------------------------------------------------------------ audios entrantes (+ marcas ✂)
def recoger(est: dict) -> list[Path]:
    bajados = []
    items = _listar("entrada")
    marcas = {it["name"].rsplit(".marcas.json", 1)[0]: it for it in items if it["name"].endswith(".marcas.json")}
    for it in items:
        nombre = it["name"]
        if it["type"] != "file" or nombre.startswith(".") or nombre.endswith(".json"):
            continue
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
        destino.write_bytes(_leer(it["path"], crudo=True))
        _borrar(it["path"], it["sha"], f"Recogido {nombre}")
        base = Path(nombre).stem
        if base in marcas:
            m = marcas.pop(base)
            destino.with_suffix(".marcas.json").write_bytes(_leer(m["path"], crudo=True))
            _borrar(m["path"], m["sha"], f"Recogido {m['name']}")
        bajados.append(destino)
        with (VIDEOS / "_entrada-registro.txt").open("a", encoding="utf-8") as f:
            f.write(f"{datetime.now():%Y-%m-%d %H:%M} {destino.relative_to(VIDEOS)}\n")
        avisar("✔ Audio recibido en la PC", tema.replace("-", " "), "#grabar", est)
    est["ultimo_audio"] = datetime.now().isoformat(timespec="minutes") if bajados else est.get("ultimo_audio")
    return bajados


# ------------------------------------------------------------------ aprobaciones (publicar / pedir cambios)
def aprobaciones(est: dict) -> list[str]:
    hechas = []
    for it in _listar("aprobaciones"):
        if not it["name"].endswith(".json"):
            continue
        a = _leer(it["path"]) or {}
        _borrar(it["path"], it["sha"], "Aprobación procesada")
        d = VIDEOS / a.get("id", "")
        if not a.get("id") or not d.is_dir():
            continue
        if a.get("accion") == "cambios":
            with (d / "cambios-pedidos.md").open("a", encoding="utf-8") as f:
                f.write(f"\n## {datetime.now():%Y-%m-%d %H:%M}\n{a.get('nota', '').strip()}\n")
            avisar("✏️ Cambios anotados", "Los aplico cuando abras Claude.", "#grabar", est)
            hechas.append(f"cambios: {a['id']}")
            continue
        if a.get("accion") == "publicar" and not (d / "publicado.json").exists():
            hechas.append(f"publicar: {a['id']}")
            _publicar_youtube(d, est)
    return hechas


def _publicar_youtube(d: Path, est: dict) -> None:
    from . import youtube
    from .config import canal as canal_cfg

    cat = d.parent.name
    marca = CATEGORIAS.get(cat)
    final = _video_final(d)
    desc = _leer_descripcion(d)
    info = {"aprobado": datetime.now().isoformat(timespec="minutes"), "tiktok_pendiente": True}
    try:
        if not (final and desc.get("titulo") and marca in CANAL_YT):
            raise RuntimeError("falta el video o la descripción")
        c = canal_cfg(CANAL_YT[marca])
        etiquetas = [e.strip() for e in desc.get("etiquetas", "").split(",") if e.strip()]
        mini = d / "miniatura-short.jpg"
        vid = youtube.subir(c, str(final), desc["titulo"], desc.get("descripcion", ""), etiquetas, privacidad="public", miniatura=str(mini) if mini.exists() else None)
        vid = vid.get("id") if isinstance(vid, dict) else vid
        info["youtube"] = f"https://youtube.com/shorts/{vid}"
        avisar("✅ Publicado en YouTube", f"{desc['titulo'][:60]} · TikTok lo subo yo en cuanto abras Claude.", info["youtube"], est)
    except Exception as e:
        info["error_youtube"] = str(e)[:300]
        avisar("⚠️ No pude publicar en YouTube", f"{d.name}: {str(e)[:80]}", "#grabar", est)
    (d / "publicado.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")


# ------------------------------------------------------------------ respuestas a comentarios de YouTube
def respuestas(est: dict) -> int:
    from . import youtube
    from .config import canal as canal_cfg

    n = 0
    hechas = est.setdefault("respondidos", [])
    for it in _listar("respuestas"):
        if not it["name"].endswith(".json"):
            continue
        r = _leer(it["path"]) or {}
        try:
            youtube.responder(canal_cfg(r["canal"]), r["comentario"], r["texto"])
            hechas.append(r["comentario"])
            n += 1
        except Exception as e:
            print(f"   respuesta no enviada: {str(e)[:120]}")
        _borrar(it["path"], it["sha"], "Respuesta procesada")
    est["respondidos"] = hechas[-300:]
    return n


# ------------------------------------------------------------------ avisos push
def _suscripciones() -> list[tuple[dict, dict]]:
    out = []
    for it in _listar("suscripciones"):
        if it["name"].endswith(".json"):
            s = _leer(it["path"])
            if s:
                out.append((s, it))
    return out


def avisar(titulo: str, cuerpo: str, url: str = "", est: dict | None = None) -> int:
    """Notificación push a todos los celulares suscritos. Devuelve cuántas se enviaron."""
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        return 0
    clave = secreto("vapid_privada.pem")
    if not clave.exists():
        return 0
    enviados = 0
    datos = json.dumps({"titulo": titulo, "cuerpo": cuerpo, "url": url or "#grabar"}, ensure_ascii=False)
    for s, it in _suscripciones():
        try:
            webpush(subscription_info=s, data=datos, vapid_private_key=str(clave), vapid_claims={"sub": "mailto:avisos@delga-panel.local"}, ttl=3600)
            enviados += 1
        except WebPushException as e:
            if e.response is not None and e.response.status_code in (404, 410):
                _borrar(it["path"], it["sha"], "Suscripción caducada")
        except Exception:
            pass
    return enviados


def _recordatorio_diario(est: dict, gs: list[dict]) -> None:
    ahora = datetime.now()
    hoy = ahora.strftime("%Y-%m-%d")
    if ahora.hour < 19 or est.get("recordatorio") == hoy or not gs:
        return
    if (est.get("ultimo_audio") or "").startswith(hoy):
        return
    est["recordatorio"] = hoy
    avisar("🎙️ Hoy aún no grabas", f"Tienes {len(gs)} guion{'es' if len(gs) != 1 else ''} esperando: {gs[0]['tema']}", "#grabar", est)


def avisar_despegando(datos: dict) -> None:
    """Desde la nube: avisa una vez cuando un video lleva muchas vistas en 24 h."""
    est = _estado_local()
    vistos = set(est.get("despegando", []))
    for c in datos.get("canales", []):
        for v in c.get("videos", [])[:15]:
            d24 = v.get("delta24") or 0
            if d24 >= 500 and v["id"] not in vistos:
                vistos.add(v["id"])
                avisar("🚀 Un video está despegando", f"{(v.get('titulo') or '')[:60]} · +{d24} vistas en 24 h ({c.get('nombre')})", "#videos")
    est["despegando"] = list(vistos)[-200:]
    _guardar_estado_local(est)


# ------------------------------------------------------------------ ciclo (tarea cada 3 min en la PC)
def publicar_guiones(gs: list[dict] | None = None) -> int:
    gs = pendientes() if gs is None else gs
    anterior = _leer("guiones.json") or {}
    if anterior.get("guiones") != gs:
        _poner_json("guiones.json", {"generado": datetime.now().isoformat(timespec="seconds"), "guiones": gs}, "Guiones pendientes")
    return len(gs)


def ciclo() -> None:
    est = _estado_local()
    bajados = recoger(est)
    for b in bajados:
        print(f"✔ audio nuevo: {b.relative_to(VIDEOS)}")
    for x in aprobaciones(est):
        print(f"✔ {x}")
    n = respuestas(est)
    if n:
        print(f"✔ {n} respuesta(s) publicadas en YouTube")
    gs = pendientes()
    conocidos = set(est.get("guiones_vistos", []))
    for g in gs:
        if g["id"] not in conocidos:
            avisar("📝 Guion nuevo para grabar", g["tema"], "#grabar", est)
    est["guiones_vistos"] = sorted(conocidos | {g["id"] for g in gs})
    publicar_guiones(gs)
    prod = produccion()
    _subir_previas(prod, est)
    anterior = _leer("estado.json") or {}
    nuevo = {"produccion": prod, "respondidos": est.get("respondidos", [])}
    if {k: anterior.get(k) for k in nuevo} != nuevo:
        _poner_json("estado.json", {**nuevo, "generado": datetime.now().isoformat(timespec="seconds")}, "Estado de producción", anterior=False)
    _recordatorio_diario(est, gs)
    _guardar_estado_local(est)
    if not bajados:
        print(f"Sin audios nuevos · {len(gs)} guiones por grabar · {sum(1 for p in prod if p['etapa'] == 'revisar')} para revisar")
