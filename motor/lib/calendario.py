"""Calendario de recordatorios (.ics) para suscribirse desde el iPhone (Calendario → notificaciones nativas).

El plan semanal sale de los datos: los 2 mejores días para publicar y la mejor franja horaria.
Se regenera en cada actualización de la nube, así que el calendario del celular se ajusta solo.
"""
from __future__ import annotations

import datetime as dt
import statistics as stx
from collections import defaultdict

DIAS_ICS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
DIAS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
HORA_FRANJA = {"mañana": 10, "tarde": 15, "noche": 19, "madrugada": 10}


def plan(datos: dict) -> dict:
    """Mejores días (2) y hora para publicar según las vistas medias de todos los canales."""
    por_dia, por_franja = defaultdict(list), defaultdict(list)
    for c in datos.get("canales", []):
        if c.get("estado") != "ok":
            continue
        for v in c.get("videos", []):
            if v.get("privacidad", "public") != "public":
                continue
            t = dt.datetime.fromisoformat(v["publicado"].replace("Z", "+00:00")).astimezone()
            por_dia[t.weekday()].append(v["vistas"])
            f = "mañana" if 6 <= t.hour < 12 else "tarde" if 12 <= t.hour < 18 else "noche" if t.hour >= 18 else "madrugada"
            por_franja[f].append(v["vistas"])
    dias = sorted(por_dia, key=lambda d: stx.mean(por_dia[d]), reverse=True)
    mejores = sorted(dias[:2]) if len(dias) >= 2 else [1, 3]  # por defecto martes y jueves
    if len(mejores) == 2 and abs(mejores[0] - mejores[1]) < 2:  # que no queden pegados
        mejores = sorted({mejores[0], (mejores[0] + 3) % 7})
    validas = {f: x for f, x in por_franja.items() if f != "madrugada" and len(x) >= 2}
    franja = max(validas, key=lambda f: stx.mean(validas[f])) if validas else "tarde"
    # Frecuencia acordada con el usuario (2026-11-04): 1 video diario. "destacados" = mejores días.
    return {"dias": list(range(7)), "destacados": mejores, "hora": HORA_FRANJA[franja], "franja": franja, "frecuencia": "diaria"}


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
    dest = ", ".join(DIAS_ES[d] for d in p.get("destacados", []))
    ev = [
        _evento("grabar-diario", 0, 19, 0, 45, "🎙️ Grabar el audio del video de mañana",
                "1 video diario. Graba con el guion en Notas de voz y pásalo a la carpeta del video.", 0, "DAILY"),
        _evento("publicar-diario", 0, p["hora"], 0, 30, "🚀 Publicar el video del día (YouTube + TikTok)",
                f"Tu mejor franja: {p['franja']}. Días que mejor rinden: {dest}. Revisa el video y dile a Claude 'sí, publica'.", 15, "DAILY"),
        _evento("tema", 6, 17, 0, 45, "📝 Planificar la semana: 7 temas y guiones",
                "Abre Delga Panel → Plan → Banco de ideas. Elige 7 temas y pide los guiones a Claude.", 0),
        _evento("revisar", 0, 9, 0, 15, "📊 Revisar Delga Panel",
                "Mira qué video despegó, tu racha y los consejos de la semana.", 0),
    ]
    cab = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Delga Panel//Recordatorios//ES",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Delga · Grabar y publicar",
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
