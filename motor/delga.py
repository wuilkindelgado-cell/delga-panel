"""delga — maneja los 4 canales (YouTube y TikTok de Delgatronics y Delgafutbol).

Uso (desde _canales\\):  delga <comando> ...   (delga.cmd usa el Python del proyecto)

  delga estado                         Qué cuentas están conectadas
  delga auth <canal|todos>             Conectar/renovar permisos (abre el navegador)
  delga tiktok-app <key> <secret>      Guardar las claves de tu app de TikTok
  delga metricas [--publicar]          Recolectar métricas de los 4 canales (+ actualizar el panel)
  delga videos <canal> [-n 15]         Videos con vistas, likes, interacción y vistas en 24 h
  delga analizar                       Recomendaciones: qué nos conviene
  delga comentarios <canal>            Últimos comentarios (YouTube)
  delga editar <canal> <video_id> [--titulo T] [--descripcion D | --descripcion-archivo F]
                                  [--etiquetas "a,b,c"] [--privacidad public|unlisted|private] [--miniatura IMG]
  delga subir <canal> <video.mp4> --titulo T [--descripcion-archivo F] [--etiquetas "a,b"]
                                  [--privacidad public] [--miniatura IMG]
  delga panel publicar|clave|url       Panel del celular (PWA)
  delga programar [--horas 3]          Actualizar métricas y panel automáticamente (Windows)

Canales: yt-delgatronics, yt-delgafutbol, tt-delgatronics, tt-delgafutbol
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

from lib import analisis, publicar, tiktok, youtube  # noqa: E402
from lib.cifrado import clave_panel  # noqa: E402
from lib.config import DATOS, RAIZ, canal, cargar_canales, leer_json, secreto  # noqa: E402


def n(x) -> str:
    return f"{x:,}".replace(",", ".") if isinstance(x, (int, float)) else str(x)


def _mod(c):
    return youtube if c["plataforma"] == "youtube" else tiktok


def cmd_estado(a):
    for c in cargar_canales():
        tok = secreto(("yt_" if c["plataforma"] == "youtube" else "tt_") + c["id"] + ".json")
        print(f"  {c['id']:18} {'conectado' if tok.exists() else 'SIN CONECTAR'}")
    if not secreto("tiktok_app.json").exists():
        print("\n  TikTok: falta registrar tu app (delga tiktok-app <key> <secret>). Ver README.")


def cmd_auth(a):
    objetivos = cargar_canales() if a.canal == "todos" else [canal(a.canal)]
    for c in objetivos:
        try:
            print(f"✔ {c['id']}: conectado como {_mod(c).autorizar(c)}")
        except (tiktok.FaltaAutorizacion, SystemExit) as e:
            print(f"✖ {c['id']}: {e}")


def cmd_tiktok_app(a):
    tiktok.guardar_app(a.client_key, a.client_secret)
    print("Claves de la app de TikTok guardadas. Ahora: delga auth tt-delgatronics  y  delga auth tt-delgafutbol")


def cmd_metricas(a):
    from lib.metricas import recolectar

    r = recolectar()
    t = r["totales"]
    print(f"\nTOTAL · seguidores {n(t['seguidores'])} ({t['seguidores_7d']:+d} en 7 días) · vistas {n(t['vistas'])} · likes {n(t['likes'])}")
    for c in r["canales"]:
        if c["estado"] == "ok":
            d = c.get("delta7") or {}
            print(f"  {c['id']:18} seg {n(c['seguidores']):>8} ({d.get('seguidores', 0):+d})  vistas {n(c['vistas']):>9}  videos {c['num_videos']}")
        else:
            print(f"  {c['id']:18} {c['estado']}: {c.get('mensaje', '')[:90]}")
    if a.publicar:
        if secreto("clave_estado.txt").exists():
            print("\nLa nube (GitHub Actions) ya actualiza el panel; la PC no publica para no pisarlo.")
        else:
            print("\nPanel actualizado:", publicar.publicar())


def _datos():
    d = leer_json(DATOS / "metricas.json")
    if not d:
        raise SystemExit("Aún no hay datos: ejecuta  delga metricas")
    return d


def cmd_videos(a):
    c = canal(a.canal)
    vids = _mod(c).listar_videos(c)[: a.n]
    print(f"{'vistas':>8} {'likes':>6} {'com':>4}  {'publicado':10}  título")
    for v in vids:
        print(f"{n(v['vistas']):>8} {n(v['likes']):>6} {v['comentarios']:>4}  {v['publicado'][:10]}  {v['titulo'][:60]}  [{v['id']}]")


def cmd_analizar(a):
    d = _datos()
    print(f"Datos de {d['generado']}\n")
    for r in d["recomendaciones"]:
        print(f"{'🔴🟡🟢'[r['prioridad'] - 1]} [{r['nombre']}] {r['texto']}")


def cmd_comentarios(a):
    c = canal(a.canal)
    if c["plataforma"] != "youtube":
        raise SystemExit("La API de TikTok no da comentarios a apps personales.")
    for x in youtube.comentarios_recientes(c, a.n):
        print(f"[{x['fecha'][:10]}] {x['autor']}: {x['texto'][:120]}  (video {x['video']})")


def cmd_editar(a):
    c = canal(a.canal)
    if c["plataforma"] != "youtube":
        raise SystemExit("TikTok no permite editar videos publicados por API: hazlo desde la app.")
    desc = Path(a.descripcion_archivo).read_text(encoding="utf-8") if a.descripcion_archivo else a.descripcion
    etiquetas = [e.strip() for e in a.etiquetas.split(",") if e.strip()] if a.etiquetas else None
    if any(x is not None for x in (a.titulo, desc, etiquetas, a.privacidad)):
        youtube.editar(c, a.video_id, titulo=a.titulo, descripcion=desc, etiquetas=etiquetas, privacidad=a.privacidad)
        print("✔ Video actualizado")
    if a.miniatura:
        youtube.poner_miniatura(c, a.video_id, a.miniatura)
        print("✔ Miniatura cambiada")


def cmd_subir(a):
    c = canal(a.canal)
    desc = Path(a.descripcion_archivo).read_text(encoding="utf-8") if a.descripcion_archivo else (a.descripcion or "")
    if c["plataforma"] == "youtube":
        etiquetas = [e.strip() for e in (a.etiquetas or "").split(",") if e.strip()]
        vid = youtube.subir(c, a.video, a.titulo, desc, etiquetas, a.privacidad, a.miniatura)
        print(f"✔ Subido: https://youtube.com/shorts/{vid}")
    else:
        priv = {"public": "PUBLIC_TO_EVERYONE", "private": "SELF_ONLY"}.get(a.privacidad, a.privacidad)
        pid = tiktok.subir(c, a.video, f"{a.titulo}\n\n{desc}".strip(), priv)
        print(f"✔ Enviado a TikTok (publish_id {pid}). Estado: {tiktok.estado_publicacion(c, pid)}")


def cmd_panel(a):
    if a.accion == "clave":
        print(f"Clave del panel: {clave_panel()}")
    elif a.accion == "url":
        print(publicar.url_panel())
    else:
        print("Panel publicado:", publicar.publicar(), "\nClave:", clave_panel())


def cmd_programar_semana(a):
    """Domingo: programa los 7 videos de la semana. YouTube automático; TikTok → lista para TikTok Studio."""
    import datetime as dt
    import json

    from lib.calendario import DIAS_ES, fechas_semana

    ruta = Path(a.semana)
    sem = json.loads(ruta.read_text(encoding="utf-8"))
    items = sem["videos"]
    datos = leer_json(DATOS / "metricas.json") or {"canales": []}
    desde = dt.date.fromisoformat(a.desde) if a.desde else None
    fechas = fechas_semana(datos, desde)
    if len(items) > 7:
        raise SystemExit("Máximo 7 videos por semana (uno por día).")
    base = ruta.parent
    lineas = [f"# Programación de la semana del {fechas[0]:%d/%m} al {fechas[-1]:%d/%m}", "",
              "| Día | Hora | Canal | Título | YouTube |", "|---|---|---|---|---|"]
    tiktok = ["", "## TikTok Studio (programar a mano: tiktok.com/tiktokstudio → Subir → Programar)", ""]
    for i, it in enumerate(items):
        f = fechas[i]
        canal_yt = canal(f"yt-{it['canal']}")
        desc = (base / it["descripcion_archivo"]).read_text(encoding="utf-8") if it.get("descripcion_archivo") else it.get("descripcion", "")
        etiquetas = [e.strip() for e in it.get("etiquetas", "").split(",") if e.strip()]
        enlace = "(simulación)"
        if not a.simular:
            vid = youtube.subir(canal_yt, str(base / it["video"]), it["titulo"], desc, etiquetas, "private",
                                str(base / it["miniatura"]) if it.get("miniatura") else None, publicar_en=f.isoformat())
            enlace = f"https://youtube.com/shorts/{vid}"
            print(f"✔ {DIAS_ES[f.weekday()]} {f:%d/%m %H:%M} · YouTube {it['canal']}: {enlace}")
        lineas.append(f"| {DIAS_ES[f.weekday()]} {f:%d/%m} | {f:%H:%M} | {it['canal']} | {it['titulo']} | {enlace} |")
        tiktok += [f"### {DIAS_ES[f.weekday()].capitalize()} {f:%d/%m} a las {f:%H:%M} · TikTok {it['canal']}",
                   f"- Video: `{it['video']}`", "- Texto para copiar:", "```", it.get("tiktok_texto") or desc, "```", ""]
    salida = base / "programacion.md"
    salida.write_text("\n".join(lineas + tiktok), encoding="utf-8")
    print(f"\n{'Simulación' if a.simular else 'Semana programada'}: {salida}")


def cmd_nube(a):
    """Activa/actualiza la actualización automática en GitHub Actions."""
    from lib import nube

    publicar.publicar()  # asegura repo + app + datos actuales
    sitio = secreto("sitio")
    nube.preparar(sitio)
    repo = f"{publicar.usuario_github()}/{publicar.REPO}"
    nube.guardar_secreto_github(repo)
    publicar._git("add", "-A", cwd=sitio)
    if publicar._git("status", "--porcelain", cwd=sitio):
        publicar._git("-c", "user.name=delga-bot", "-c", "user.email=delga-bot@users.noreply.github.com", "commit", "-m", "Motor en la nube", cwd=sitio)
    publicar._git("pull", "--rebase", "-X", "theirs", "origin", "main", cwd=sitio, check=False)
    publicar._git("push", "origin", "main", cwd=sitio)
    subprocess.run(["gh", "workflow", "run", "actualizar.yml", "--repo", repo], capture_output=True)
    print(f"✔ Nube activa: GitHub actualizará el panel cada 3 h. Ejecuciones: https://github.com/{repo}/actions")


def cmd_nube_ciclo(a):
    from lib import nube

    nube.ciclo()


def cmd_programar(a):
    cmd = f'"{RAIZ / "delga.cmd"}" metricas --publicar'
    r = subprocess.run(
        ["schtasks", "/Create", "/F", "/TN", "DelgaMetricas", "/SC", "HOURLY", "/MO", str(a.horas), "/TR", cmd],
        capture_output=True,
        text=True,
    )
    print(r.stdout or r.stderr)


def main():
    p = argparse.ArgumentParser(prog="delga", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    s = p.add_subparsers(dest="cmd", required=True)
    s.add_parser("estado").set_defaults(f=cmd_estado)
    x = s.add_parser("auth"); x.add_argument("canal"); x.set_defaults(f=cmd_auth)
    x = s.add_parser("tiktok-app"); x.add_argument("client_key"); x.add_argument("client_secret"); x.set_defaults(f=cmd_tiktok_app)
    x = s.add_parser("metricas"); x.add_argument("--publicar", action="store_true"); x.set_defaults(f=cmd_metricas)
    x = s.add_parser("videos"); x.add_argument("canal"); x.add_argument("-n", type=int, default=15); x.set_defaults(f=cmd_videos)
    s.add_parser("analizar").set_defaults(f=cmd_analizar)
    x = s.add_parser("comentarios"); x.add_argument("canal"); x.add_argument("-n", type=int, default=20); x.set_defaults(f=cmd_comentarios)
    x = s.add_parser("editar")
    x.add_argument("canal"); x.add_argument("video_id"); x.add_argument("--titulo")
    g = x.add_mutually_exclusive_group(); g.add_argument("--descripcion"); g.add_argument("--descripcion-archivo")
    x.add_argument("--etiquetas"); x.add_argument("--privacidad", choices=["public", "unlisted", "private"]); x.add_argument("--miniatura")
    x.set_defaults(f=cmd_editar)
    x = s.add_parser("subir")
    x.add_argument("canal"); x.add_argument("video"); x.add_argument("--titulo", required=True)
    g = x.add_mutually_exclusive_group(); g.add_argument("--descripcion"); g.add_argument("--descripcion-archivo")
    x.add_argument("--etiquetas"); x.add_argument("--privacidad", default="private"); x.add_argument("--miniatura")
    x.set_defaults(f=cmd_subir)
    x = s.add_parser("panel"); x.add_argument("accion", choices=["publicar", "clave", "url"]); x.set_defaults(f=cmd_panel)
    x = s.add_parser("programar-semana"); x.add_argument("semana", help="semana.json con los 7 videos"); x.add_argument("--desde"); x.add_argument("--simular", action="store_true"); x.set_defaults(f=cmd_programar_semana)
    s.add_parser("nube").set_defaults(f=cmd_nube)
    s.add_parser("nube-ciclo").set_defaults(f=cmd_nube_ciclo)
    x = s.add_parser("programar"); x.add_argument("--horas", type=int, default=3); x.set_defaults(f=cmd_programar)
    a = p.parse_args()
    try:
        a.f(a)
    except (youtube.FaltaAutorizacion, tiktok.FaltaAutorizacion) as e:
        raise SystemExit(f"✖ {e}")


if __name__ == "__main__":
    main()
