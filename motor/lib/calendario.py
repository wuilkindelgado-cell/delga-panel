"""Calendario de producción en bloque (.ics) para el iPhone + horarios de publicación de la semana.

Flujo acordado con el usuario (2026-11-04):
  sábado  → elegir los 7 temas y pedir los guiones a Claude
  domingo → grabar los 7 audios, Claude hace los 7 videos, aprobarlos y programarlos
  lun–dom → sale 1 video al día a la hora que mejor rinde (responder comentarios la 1.ª hora)

Horarios: por cada día de la semana se usa la franja que mejor ha rendido ese día (si hay ≥2 videos);
si no hay datos suficientes se EXPLORA rotando franjas semana a semana, para aprender qué hora funciona.
"""
from __future__ import annotations

import datetime as dt
import statistics as stx
from collections import defaultdict

DIAS_ICS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
DIAS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
FRANJAS = {"mediodía": (11, 14, 12), "tarde": (14, 18, 15), "noche": (18, 21, 19), "noche tarde": (21, 24, 21)}
EXPLORAR = [12, 15, 19, 21, 18, 13, 20]  # horas candidatas (picos típicos en Latinoamérica)


def _franja(h: int) -> str | None:
    for n, (a, b, _) in FRANJAS.items():
        if a <= h < b:
            return n
    return None


def plan(datos: dict) -> dict:
    por_dia, por_dia_franja = defaultdict(list), defaultdict(list)
    for c in datos.get("canales", []):
        if c.get("estado") != "ok":
            continue
        for v in c.get("videos", []):
            if v.get("privacidad", "public") != "public":
                continue
            t = dt.datetime.fromisoformat(v["publicado"].replace("Z", "+00:00")).astimezone()
            por_dia[t.weekday()].append(v["vistas"])
            f = _franja(t.hour)
            if f:
                por_dia_franja[(t.weekday(), f)].append(v["vistas"])
    dias = sorted(por_dia, key=lambda d: stx.mean(por_dia[d]), reverse=True)
    destacados = sorted(dias[:2]) if len(dias) >= 2 else [3, 6]
    semana = dt.date.today().isocalendar()[1]
    horarios, origen = {}, {}
    for d in range(7):
        opciones = {f: x for (dd, f), x in por_dia_franja.items() if dd == d and len(x) >= 2}
        if opciones:
            f = max(opciones, key=lambda k: stx.mean(opciones[k]))
            horarios[d], origen[d] = FRANJAS[f][2], "datos"
        else:
            horarios[d], origen[d] = EXPLORAR[(d + semana) % len(EXPLORAR)], "prueba"
    return {
        "frecuencia": "diaria",
        "modo": "domingo",
        "dias": list(range(7)),
        "destacados": destacados,
        "horarios": {str(d): h for d, h in horarios.items()},
        "origen": {str(d): o for d, o in origen.items()},
        "hora": horarios[dt.date.today().weekday()],
    }


def _evento(uid, dia, hora, minuto, dur, titulo, desc, aviso_min, freq="WEEKLY"):
    hoy = dt.date.today()
    primero = hoy + dt.timedelta(days=(dia - hoy.weekday()) % 7) if freq == "WEEKLY" else hoy
    ini = dt.datetime.combine(primero, dt.time(hora, minuto))
    fin = ini + dt.timedelta(minutes=dur)
    f = lambda x: x.strftime("%Y%m%dT%H%M%S")
    return "\r\n".join(
        [
            "BEGIN:VEVENT",
            f"UID:{uid}@delga-panel",
            f"DTSTAMP:{dt.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}",
            f"DTSTART;TZID=America/Lima:{f(ini)}",
            f"DTEND;TZID=America/Lima:{f(fin)}",
            f"RRULE:FREQ=WEEKLY;BYDAY={DIAS_ICS[dia]}" if freq == "WEEKLY" else "RRULE:FREQ=DAILY",
            f"SUMMARY:{titulo}",
            f"DESCRIPTION:{desc}",
            "BEGIN:VALARM",
            "ACTION:DISPLAY",
            f"DESCRIPTION:{titulo}",
            f"TRIGGER:-PT{aviso_min}M",
            "END:VALARM",
            "END:VEVENT",
        ]
    )


def generar_ics(datos: dict) -> str:
    p = plan(datos)
    hs = {int(k): v for k, v in p["horarios"].items()}
    ev = [
        _evento("sab-temas", 5, 18, 0, 60, "📝 Elegir los 7 temas y pedir los guiones a Claude",
                "Abre Delga Panel → Plan → Banco de ideas. Elige 7 temas (Delgatronics / Delgafutbol) y pide los 7 guiones.", 0),
        _evento("dom-grabar", 6, 10, 0, 120, "🎙️ Domingo de producción: grabar los 7 audios",
                "Graba los 7 guiones en Notas de voz (uno por archivo) y pásalos a sus carpetas. Claude hace los 7 videos.", 15),
        _evento("dom-aprobar", 6, 16, 0, 60, "✅ Revisar y aprobar los 7 videos",
                "Mira los 7 videos y miniaturas. Dile a Claude 'sí, programa la semana'.", 0),
        _evento("dom-tiktok", 6, 18, 0, 30, "📅 Programar los 7 TikToks en TikTok Studio",
                "YouTube ya queda programado por Claude. Abre tiktok.com/tiktokstudio y programa los 7 con las horas y textos de la lista.", 0),
        _evento("lun-panel", 0, 9, 0, 15, "📊 Revisar Delga Panel: ¿qué funcionó la semana pasada?",
                "Mira qué video despegó y qué hora rindió más. El plan de horarios se ajusta solo.", 0),
    ]
    for d in range(7):
        ev.append(_evento(f"sale-{d}", d, hs[d], 0, 60, "🚀 Sale el video de hoy: responde comentarios 1 hora",
                          "Responder en la primera hora empuja el video en el algoritmo de YouTube y TikTok.", 0))
    cab = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Delga Panel//Recordatorios//ES",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Delga · Producción semanal",
        "X-WR-TIMEZONE:America/Lima",
        "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
        "X-PUBLISHED-TTL:PT12H",
        "BEGIN:VTIMEZONE",
        "TZID:America/Lima",
        "BEGIN:STANDARD",
        "DTSTART:19700101T000000",
        "TZOFFSETFROM:-0500",
        "TZOFFSETTO:-0500",
        "TZNAME:-05",
        "END:STANDARD",
        "END:VTIMEZONE",
    ]
    return "\r\n".join(cab + ev + ["END:VCALENDAR"]) + "\r\n"


def fechas_semana(datos: dict, desde: dt.date | None = None) -> list[dt.datetime]:
    """Las 7 fechas/horas de publicación (lunes a domingo) de la semana siguiente a `desde`."""
    p = plan(datos)
    hs = {int(k): v for k, v in p["horarios"].items()}
    hoy = desde or dt.date.today()
    lunes = hoy + dt.timedelta(days=(7 - hoy.weekday()) % 7 or 7)
    tz = dt.timezone(dt.timedelta(hours=-5))
    return [dt.datetime.combine(lunes + dt.timedelta(days=i), dt.time(hs[i], 0), tzinfo=tz) for i in range(7)]
