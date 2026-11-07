'use strict';
// Delga Panel v2 — panel de creador para 4 canales (YouTube + TikTok de Delgatronics y Delgafutbol).

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmt = (n) => (n == null || isNaN(n) ? '—' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' M' : Math.abs(n) >= 1e4 ? (n / 1e3).toFixed(1).replace('.', ',') + ' K' : Math.round(n).toLocaleString('es'));
const pct = (n, d = 1) => (n == null || isNaN(n) ? '—' : n.toFixed(d).replace('.', ',') + ' %');
const delta = (n, suf = '') => (n == null ? '<span class="delta igual">—</span>' : `<span class="delta ${n > 0 ? 'sube' : n < 0 ? 'baja' : 'igual'}">${n > 0 ? '▲' : n < 0 ? '▼' : '='} ${fmt(Math.abs(n))}${suf}</span>`);
const plat = (p) => `<span class="plat ${p}">${p === 'youtube' ? '▶' : '♪'}</span>`;
const fecha = (iso) => new Date(String(iso).length === 10 ? iso + 'T12:00' : iso).toLocaleDateString('es', {day: 'numeric', month: 'short'});
const hace = (iso) => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`;
};
const diasDesde = (iso) => Math.max(1, (Date.now() - new Date(iso)) / 864e5);
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const leer = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const corta = (s, n) => { const a = Array.from(String(s ?? '')); return a.length > n ? a.slice(0, n).join('') + '…' : a.join(''); };
const media = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const mediana = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

let D = null;
const E = {tab: (leer('dp-tab') || 'inicio').replace('consejos', 'plan'), filtro: leer('dp-filtro') || 'todos', periodo: leer('dp-periodo') || '28', orden: 'recientes', vfiltro: 'todos', q: '', canalA: null};

// ------------------------------------------------------------------ datos
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function descifrar(enc, clave) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveKey']);
  const k = await crypto.subtle.deriveKey({name: 'PBKDF2', salt: b64(enc.sal), iterations: enc.it, hash: 'SHA-256'}, base, {name: 'AES-GCM', length: 256}, false, ['decrypt']);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name: 'AES-GCM', iv: b64(enc.iv)}, k, b64(enc.datos))));
}
async function entrar(clave, silencioso) {
  try {
    const r = await fetch('datos.enc.json?t=' + Date.now(), {cache: 'no-store'});
    if (!r.ok) throw new Error('red');
    D = preparar(await descifrar(await r.json(), clave));
    guardar('dp-clave', clave);
    $('#bloqueo').classList.add('oculto');
    pintar();
  } catch (e) {
    console.error('delga', e);
    if (!silencioso) $('#errorClave').textContent = e.name === 'OperationError' ? 'Clave incorrecta' : 'Sin conexión o sin datos todavía';
    if (!D) $('#bloqueo').classList.remove('oculto');
  }
}

// Enriquecer: media por canal, etiquetas de rendimiento, vistas por día.
function preparar(d) {
  d.ok = d.canales.filter((c) => c.estado === 'ok');
  for (const c of d.ok) {
    const pub = c.videos.filter((v) => (v.privacidad || 'public') === 'public');
    c.mediana = mediana(pub.map((v) => v.vistas));
    c.mediaEng = media(pub.map((v) => v.engagement || 0));
    for (const v of c.videos) {
      v.canal = c;
      v.vpd = v.vistas / diasDesde(v.publicado);
      const r = c.mediana ? v.vistas / c.mediana : 1;
      v.ratio = r;
      v.etiqueta = diasDesde(v.publicado) < 2 ? 'nuevo' : r >= 2.5 ? 'viral' : r >= 1.2 ? 'arriba' : r <= 0.6 ? 'abajo' : null;
    }
  }
  return d;
}
const filtrar = (lista) => lista.filter((c) => E.filtro === 'todos' || c.plataforma === E.filtro || c.marca === E.filtro);
const deltaP = (c) => (E.periodo === '1' ? c.delta1 : E.periodo === '7' ? c.delta7 : E.periodo === '28' ? c.delta28 : null) || {};
const serieP = (s) => (E.periodo === 'todo' ? s : s.slice(-Number(E.periodo === '1' ? 2 : E.periodo)));
const NOMBRE_P = {'1': '24 h', '7': '7 días', '28': '28 días', todo: 'todo'};

// ------------------------------------------------------------------ gráficas
let graficas = {};
function linea(id, series, {alto = 150, fmtY = fmt} = {}) {
  const xs = [...new Set(series.flatMap((s) => s.datos.map((p) => p.x)))].sort();
  if (xs.length < 2) return `<div class="vacio">Aún hay un solo día de historial. La curva se dibuja sola a medida que pasan los días.</div>`;
  const W = 340, H = alto, P = 34;
  const ys = series.flatMap((s) => s.datos.map((p) => p.y));
  let min = Math.min(...ys), max = Math.max(...ys);
  if (min === max) { min -= 1; max += 1; }
  const X = (x) => P + (xs.indexOf(x) / (xs.length - 1)) * (W - P - 8);
  const Y = (y) => 8 + (1 - (y - min) / (max - min)) * (H - 30);
  graficas[id] = {xs, series, X, Y, fmtY};
  let g = `<svg class="graf" viewBox="0 0 ${W} ${H}" data-graf="${id}">`;
  for (let i = 0; i <= 2; i++) {
    const v = min + ((max - min) * i) / 2, y = Y(v);
    g += `<line x1="${P}" x2="${W}" y1="${y}" y2="${y}" stroke="#24315a" stroke-dasharray="3 4"/><text x="0" y="${y + 4}" fill="#8f9cc0" font-size="10">${fmtY(v)}</text>`;
  }
  g += `<text x="${P}" y="${H - 4}" fill="#8f9cc0" font-size="10">${fecha(xs[0])}</text><text x="${W - 2}" y="${H - 4}" fill="#8f9cc0" font-size="10" text-anchor="end">${fecha(xs[xs.length - 1])}</text>`;
  for (const s of series) {
    if (!s.datos.length) continue;
    const pts = s.datos.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`);
    if (series.length === 1) g += `<path d="M${pts[0]} L${pts.join(' L')} L${X(s.datos[s.datos.length - 1].x)},${H - 22} L${X(s.datos[0].x)},${H - 22}Z" fill="${s.color}" opacity=".12"/>`;
    g += `<path d="M${pts.join(' L')}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" ${s.punteada ? 'stroke-dasharray="6 4"' : ''}/>`;
    const u = s.datos[s.datos.length - 1];
    g += `<circle cx="${X(u.x)}" cy="${Y(u.y)}" r="3.5" fill="${s.color}"/>`;
  }
  g += `<line class="cursor" x1="0" x2="0" y1="6" y2="${H - 22}" stroke="#eef3ff" stroke-opacity=".5" visibility="hidden"/></svg><div class="tip" id="tip-${id}">Toca o arrastra sobre la gráfica para ver cada día.</div>`;
  return g;
}
function moverCursor(svg, clientX) {
  const g = graficas[svg.dataset.graf];
  if (!g) return;
  const r = svg.getBoundingClientRect();
  const x = ((clientX - r.left) / r.width) * 340;
  let i = 0, best = 1e9;
  g.xs.forEach((d, k) => { const dx = Math.abs(g.X(d) - x); if (dx < best) { best = dx; i = k; } });
  const dia = g.xs[i];
  const c = svg.querySelector('.cursor');
  c.setAttribute('x1', g.X(dia)); c.setAttribute('x2', g.X(dia)); c.setAttribute('visibility', 'visible');
  const vals = g.series.map((s) => { const p = s.datos.find((q) => q.x === dia); return p ? `<span style="color:${s.color}">●</span> ${esc(s.nombre || '')} <b>${g.fmtY(p.y)}</b>` : ''; }).filter(Boolean);
  $('#tip-' + svg.dataset.graf).innerHTML = `${fecha(dia)} · ${vals.join(' · ')}`;
}
['pointerdown', 'pointermove'].forEach((ev) => document.addEventListener(ev, (e) => {
  const svg = e.target.closest && e.target.closest('svg[data-graf]');
  if (svg && (ev === 'pointerdown' || e.buttons || e.pointerType === 'mouse')) moverCursor(svg, e.clientX);
}));

function chispa(datos, color) {
  if (datos.length < 2) return `<svg viewBox="0 0 100 34"><line x1="0" x2="100" y1="26" y2="26" stroke="${color}" stroke-opacity=".35" stroke-dasharray="3 3"/></svg>`;
  const min = Math.min(...datos), max = Math.max(...datos) || 1, r = max - min || 1;
  const pts = datos.map((y, i) => `${((i / (datos.length - 1)) * 100).toFixed(1)},${(30 - ((y - min) / r) * 26).toFixed(1)}`);
  return `<svg viewBox="0 0 100 34" preserveAspectRatio="none"><path d="M0,34 L${pts.join(' L')} L100,34Z" fill="${color}" opacity=".15"/><path d="M${pts.join(' L')}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}
function barrasV(datos, color, alto = 120) {
  if (!datos.length) return '<div class="vacio">Sin datos</div>';
  const W = 340, H = alto, max = Math.max(1, ...datos.map((d) => d.y)), w = (W - 4) / datos.length;
  let g = `<svg class="graf" viewBox="0 0 ${W} ${H}">`;
  datos.forEach((d, i) => { const h = (d.y / max) * (H - 24); g += `<rect x="${2 + i * w + 1}" y="${H - 16 - h}" width="${Math.max(1, w - 2)}" height="${Math.max(h, 1)}" rx="2" fill="${color}" opacity="${0.45 + 0.55 * (d.y / max)}"><title>${fecha(d.x)}: ${fmt(d.y)}</title></rect>`; });
  return g + `<text x="2" y="${H - 3}" fill="#8f9cc0" font-size="10">${fecha(datos[0].x)}</text><text x="${W - 2}" y="${H - 3}" fill="#8f9cc0" font-size="10" text-anchor="end">${fecha(datos[datos.length - 1].x)}</text><text x="${W - 2}" y="10" fill="#8f9cc0" font-size="10" text-anchor="end">máx ${fmt(max)}</text></svg>`;
}
const barrasH = (items, color = 'var(--cian)') => {
  const max = Math.max(1, ...items.map((i) => i.v));
  return `<div class="barras">${items.map((i) => `<div class="fb"><span>${esc(i.k)}</span><div class="pista"><i style="width:${Math.max(3, (i.v / max) * 100)}%;background:${i.color || color}"></i></div><span class="num">${i.txt ?? fmt(i.v)}</span></div>`).join('')}</div>`;
};

// ------------------------------------------------------------------ piezas
const chipsFiltro = () => `<div class="chips">${[['todos', 'Todo'], ['youtube', '▶ YouTube'], ['tiktok', '♪ TikTok'], ['delgatronics', 'Delgatronics'], ['delgafutbol', 'Delgafutbol']].map(([k, t]) => `<button class="chip ${E.filtro === k ? 'on' : ''}" data-filtro="${k}">${t}</button>`).join('')}</div>`;
const segPeriodo = () => `<div class="seg">${[['1', '24 h'], ['7', '7 días'], ['28', '28 días'], ['todo', 'Todo']].map(([k, t]) => `<button class="${E.periodo === k ? 'on' : ''}" data-periodo="${k}">${t}</button>`).join('')}</div>`;
const TAGS = {viral: '🔥 viral', arriba: '↑ sobre tu media', abajo: '↓ bajo tu media', nuevo: '✨ nuevo'};
function filaVideo(v, i) {
  return `<button class="fila-video" data-video="${esc(v.canal.id)}|${esc(v.id)}">
    ${i != null ? `<div class="rank">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</div>` : ''}
    <img class="mini" loading="lazy" src="${esc(v.miniatura || '')}" alt="">
    <div style="min-width:0;flex:1"><div class="t">${esc(v.titulo)}</div>
      <div class="meta">${plat(v.canal.plataforma)}<span>${esc(v.canal.nombre)} · ${fecha(v.publicado)}</span>${v.etiqueta ? `<span class="tag ${v.etiqueta}">${TAGS[v.etiqueta]}</span>` : ''}${v.delta24 > 0 ? `<span class="tag alza">+${fmt(v.delta24)} hoy</span>` : ''}</div>
      <div class="meta"><span>👁 <b class="num">${fmt(v.vistas)}</b></span><span>❤ <b class="num">${fmt(v.likes)}</b></span><span>💬 <b class="num">${fmt(v.comentarios)}</b></span><span>⚡ <b>${pct(v.engagement)}</b></span>${v.retencion != null ? `<span>⏱ <b>${pct(v.retencion, 0)}</b></span>` : ''}</div>
    </div></button>`;
}
const filaConsejo = (r) => `<div class="consejo"><div class="p p${r.prioridad}"></div><div><small>${esc(r.nombre)}</small><div>${esc(r.texto)}</div></div></div>`;
const todosVideos = () => filtrar(D.ok).flatMap((c) => c.videos);

// ------------------------------------------------------------------ tarjetas nuevas de Inicio
const MARCAS = [['delgatronics', '⚙️ Delgatronics'], ['delgafutbol', '⚽ Delgafutbol']];
/** "Hoy": a qué hora toca publicar y hace cuánto salió el último video de cada marca. */
function tarjetaHoy() {
  const ahora = new Date(), dia = (ahora.getDay() + 6) % 7;
  const plan = D.plan || {}, hora = plan.horarios ? plan.horarios[String(dia)] : plan.hora;
  const marcas = MARCAS.filter(([m]) => E.filtro === 'todos' || E.filtro === m || ['youtube', 'tiktok'].includes(E.filtro));
  const filas = marcas.map(([m, nombre]) => {
    const vs = D.ok.filter((c) => c.marca === m && (E.filtro !== 'youtube' && E.filtro !== 'tiktok' || c.plataforma === E.filtro)).flatMap((c) => c.videos);
    const ult = vs.sort((a, b) => b.publicado.localeCompare(a.publicado))[0];
    if (!ult) return '';
    const horas = (Date.now() - new Date(ult.publicado)) / 36e5;
    const estado = horas < 24 ? ['ok', '✔ al día'] : horas < 48 ? ['medio', '⏳ toca hoy'] : ['mal', `⚠️ ${Math.floor(horas / 24)} días sin subir`];
    return `<div class="hoy-fila"><div><b>${nombre}</b><div class="hoy-sub">último: ${hace(ult.publicado)} · ${esc(corta(ult.titulo, 38))}</div></div><span class="hoy-est ${estado[0]}">${estado[1]}</span></div>`;
  }).join('');
  const horaTxt = hora != null ? `${String(hora).padStart(2, '0')}:00` : '—';
  const yaPaso = hora != null && ahora.getHours() >= hora;
  return `<div class="card hoy"><h3>🎬 Hoy <small>${ahora.toLocaleDateString('es', {weekday: 'long', day: 'numeric', month: 'short'})}</small></h3>
    <div class="hoy-hora"><span>Hora de publicar</span><b class="num">${horaTxt}</b><span class="hoy-sub">${yaPaso ? 'ya pasó la hora de hoy' : 'mejor hora según tus datos'}</span></div>${filas}</div>`;
}
/** Barras finas por día con su número encima (no se estiran aunque haya pocos días). */
function barrasDias(datos) {
  const W = 340, H = 150, max = Math.max(1, ...datos.map((d) => d.y));
  const paso = Math.min(46, (W - 8) / datos.length), ancho = Math.max(4, Math.min(26, paso * 0.62));
  const x0 = W - 4 - paso * datos.length; // alineadas a la derecha: lo más reciente al final
  const verNum = datos.length <= 14;
  let g = `<svg class="graf" viewBox="0 0 ${W} ${H}"><line x1="0" x2="${W}" y1="${H - 28}" y2="${H - 28}" stroke="#24315a"/>`;
  datos.forEach((d, i) => {
    const h = Math.max(2, (d.y / max) * (H - 58)), cx = x0 + paso * i + paso / 2, y = H - 28 - h;
    const op = 0.55 + 0.45 * (d.y / max);
    g += `<rect x="${cx - ancho / 2}" y="${y}" width="${ancho}" height="${h}" rx="5" fill="url(#gradCrec)" opacity="${op.toFixed(2)}"><title>${fecha(d.x)}: ${fmt(d.y)} vistas</title></rect>`;
    if (verNum) g += `<text x="${cx}" y="${y - 6}" fill="#eef3ff" font-size="11" font-weight="700" text-anchor="middle">${fmt(d.y)}</text>`;
    if (verNum || i === 0 || i === datos.length - 1) g += `<text x="${cx}" y="${H - 12}" fill="#8f9cc0" font-size="10" text-anchor="middle">${new Date(d.x + 'T12:00').toLocaleDateString('es', {day: 'numeric', month: 'numeric'})}</text>`;
    if (verNum && d.s) g += `<text x="${cx}" y="${H - 1}" fill="${d.s > 0 ? '#2ee66b' : '#ff6b81'}" font-size="9" text-anchor="middle">${d.s > 0 ? '+' : ''}${d.s} seg</text>`;
  });
  return g + `<defs><linearGradient id="gradCrec" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#00e5ff"/><stop offset="100%" stop-color="#7a5cff"/></linearGradient></defs></svg>`;
}
/** Crecimiento real día a día (diferencias entre fotos diarias), en vez de totales planos. */
function tarjetaCrecimiento(cs) {
  const porDia = {};
  for (const c of cs) {
    const s = c.serie || [];
    for (let i = 1; i < s.length; i++) {
      const f = s[i].fecha, p = (porDia[f] = porDia[f] || {seg: 0, vis: 0});
      p.seg += (s[i].seguidores || 0) - (s[i - 1].seguidores || 0);
      p.vis += Math.max(0, (s[i].vistas || 0) - (s[i - 1].vistas || 0));
    }
  }
  let dias = Object.keys(porDia).sort();
  if (E.periodo !== 'todo') dias = dias.slice(-Number(E.periodo === '1' ? 1 : E.periodo));
  if (!dias.length) return `<div class="card"><h3>📈 Crecimiento diario</h3><div class="vacio">Hace falta al menos 2 días de historial.</div></div>`;
  const tv = dias.reduce((t, d) => t + porDia[d].vis, 0), ts = dias.reduce((t, d) => t + porDia[d].seg, 0);
  const mejor = dias.reduce((a, d) => (porDia[d].vis > porDia[a].vis ? d : a), dias[0]);
  return `<div class="card"><h3>📈 Crecimiento diario <small>${NOMBRE_P[E.periodo]}</small></h3>
    <div class="kpis"><div class="kpi"><span class="etq">Vistas nuevas</span><b class="num">${fmt(tv)}</b><span class="delta igual">${fmt(tv / dias.length)}/día</span></div>
    <div class="kpi"><span class="etq">Seguidores nuevos</span><b class="num ${ts > 0 ? 'sube' : ts < 0 ? 'baja' : ''}">${ts > 0 ? '+' : ''}${fmt(ts)}</b><span class="delta igual">${(ts / dias.length).toFixed(1).replace('.', ',')}/día</span></div>
    <div class="kpi"><span class="etq">Mejor día</span><b class="num">${fecha(mejor)}</b><span class="delta igual">${fmt(porDia[mejor].vis)} vistas</span></div></div>
    <div class="etq" style="margin-top:12px">Vistas nuevas por día</div>${barrasDias(dias.map((d) => ({x: d, y: porDia[d].vis, s: porDia[d].seg})))}
    ${ts === 0 && dias.length >= 3 ? '<div class="aviso" style="margin:10px 0 0">Las vistas suben pero los seguidores no: pide que te sigan a mitad del video y usa series con número.</div>' : ''}</div>`;
}

// ------------------------------------------------------------------ vistas
function vInicio() {
  const cs = filtrar(D.ok);
  const sum = (f) => cs.reduce((s, c) => s + (f(c) || 0), 0);
  const dP = (k) => (cs.some((c) => deltaP(c)[k] != null) ? sum((c) => deltaP(c)[k]) : null);
  const pend = D.canales.filter((c) => c.estado !== 'ok');
  let h = chipsFiltro() + segPeriodo();
  if (pend.length) h += `<div class="aviso">⚠️ ${pend.map((c) => esc(c.mensaje)).join('<br>')}</div>`;
  h += `<div class="card hero"><div class="etq">Seguidores · ${E.filtro === 'todos' ? 'los 4 canales' : esc(E.filtro)}</div>
    <div class="grande num">${fmt(sum((c) => c.seguidores))}</div><div>${delta(dP('seguidores'))} <span style="color:var(--suave);font-size:13px">en ${NOMBRE_P[E.periodo]}</span></div>
    <div class="kpis"><div class="kpi"><span class="etq">Vistas</span><b class="num">${fmt(sum((c) => c.vistas))}</b>${delta(dP('vistas'))}</div><div class="kpi"><span class="etq">Me gusta</span><b class="num">${fmt(sum((c) => c.likes))}</b>${delta(dP('likes'))}</div><div class="kpi"><span class="etq">Videos</span><b class="num">${fmt(sum((c) => c.num_videos))}</b><span class="delta igual">${cs.length} canales</span></div></div></div>`;
  h += `<div class="canales">${filtrar(D.canales).map((c) => `
    <button class="canal ${c.estado !== 'ok' ? 'apagado' : ''}" style="--c:${c.color}" data-canal="${c.id}">
      <div class="cab">${plat(c.plataforma)} ${esc(c.nombre)}</div>
      <div class="v num">${c.estado === 'ok' ? fmt(c.seguidores) : '—'}</div>
      <div class="s">${c.estado === 'ok' ? `seguidores ${delta(deltaP(c).seguidores)}` : 'sin conectar'}</div>
      ${c.estado === 'ok' ? chispa(serieP(c.serie || []).map((s) => s.vistas || 0), c.color) : ''}
      <div class="s num">${c.estado === 'ok' ? `${fmt(c.vistas)} vistas · ${c.num_videos} videos` : ''}</div>
    </button>`).join('')}</div>`;
  h += tarjetaHoy();
  h += tarjetaCrecimiento(cs);
  const vids = todosVideos();
  const alza = vids.filter((v) => v.delta24 > 0).sort((a, b) => b.delta24 - a.delta24).slice(0, 3);
  if (alza.length) h += `<div class="card"><h3>🚀 Despegando <small>últimas 24 h</small></h3>${alza.map((v) => filaVideo(v)).join('')}</div>`;
  const recs = D.recomendaciones.filter((r) => E.filtro === 'todos' || r.canal === 'general' || filtrar(D.canales).some((c) => c.id === r.canal)).slice(0, 2);
  if (recs.length) h += `<div class="card"><h3>💡 Lo más importante ahora <button class="chip" data-tab="plan">ver plan</button></h3>${recs.map(filaConsejo).join('')}</div>`;
  return h;
}

function vVideos() {
  let lista = filtrar(D.ok).flatMap((c) => c.videos).filter((v) => (v.privacidad || 'public') === 'public');
  if (E.vfiltro !== 'todos') lista = lista.filter((v) => v.etiqueta === E.vfiltro);
  if (E.q) { const q = E.q.toLowerCase(); lista = lista.filter((v) => v.titulo.toLowerCase().includes(q)); }
  const ord = {recientes: (a, b) => b.publicado.localeCompare(a.publicado), vistas: (a, b) => b.vistas - a.vistas, ritmo: (a, b) => b.vpd - a.vpd, alza: (a, b) => (b.delta24 || 0) - (a.delta24 || 0), interaccion: (a, b) => (b.engagement || 0) - (a.engagement || 0), retencion: (a, b) => (b.retencion ?? -1) - (a.retencion ?? -1)};
  lista.sort(ord[E.orden]);
  const ranking = E.orden !== 'recientes';
  let h = `<input class="buscar" id="q" type="search" placeholder="Buscar por título…" value="${esc(E.q)}">` + chipsFiltro();
  h += `<div class="chips">${[['recientes', '🕒 Recientes'], ['vistas', '👁 Más vistos'], ['ritmo', '📈 Vistas/día'], ['alza', '🚀 En alza'], ['interaccion', '⚡ Interacción'], ['retencion', '⏱ Retención']].map(([k, t]) => `<button class="chip ${E.orden === k ? 'on' : ''}" data-orden="${k}">${t}</button>`).join('')}</div>`;
  h += `<div class="chips">${[['todos', 'Todos'], ['viral', '🔥 Virales'], ['arriba', '↑ Sobre la media'], ['abajo', '↓ Bajo la media'], ['nuevo', '✨ Nuevos']].map(([k, t]) => `<button class="chip ${E.vfiltro === k ? 'on' : ''}" data-vfiltro="${k}">${t}</button>`).join('')}</div>`;
  h += `<div style="color:var(--suave);font-size:12px;margin:-2px 0 8px">${lista.length} videos · toca uno para ver su análisis</div>`;
  h += lista.length ? `<div class="card" style="padding-top:4px;padding-bottom:4px">${lista.slice(0, 80).map((v, i) => filaVideo(v, ranking ? i : null)).join('')}</div>` : '<div class="vacio">No hay videos con ese filtro.</div>';
  return h;
}

const FRANJAS = [['Mañ', 6, 12], ['Tar', 12, 18], ['Noc', 18, 24], ['Mad', 0, 6]];
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
function mapaCalor(vids) {
  const celdas = {};
  for (const v of vids) {
    const t = new Date(v.publicado), d = (t.getDay() + 6) % 7, f = FRANJAS.findIndex(([, a, b]) => t.getHours() >= a && t.getHours() < b);
    (celdas[d + '-' + f] = celdas[d + '-' + f] || []).push(v.vistas);
  }
  const vals = Object.values(celdas).map(media), max = Math.max(1, ...vals);
  let h = `<div class="calor"><span></span>${FRANJAS.map(([n]) => `<span class="h">${n}</span>`).join('')}`;
  DIAS.forEach((dn, d) => {
    h += `<span class="d">${dn}</span>`;
    FRANJAS.forEach((_, f) => {
      const c = celdas[d + '-' + f];
      const m = c ? media(c) : 0, a = c ? 0.18 + 0.82 * (m / max) : 0;
      h += `<div class="c" style="${c ? `background:rgba(0,229,255,${a.toFixed(2)});color:${a > 0.55 ? '#00131a' : 'var(--texto)'}` : ''}" title="${c ? c.length + ' videos' : ''}">${c ? fmt(m) : ''}</div>`;
    });
  });
  const mejor = Object.entries(celdas).filter(([, x]) => x.length >= 1).sort((a, b) => media(b[1]) - media(a[1]))[0];
  h += `</div><div class="leyenda">Vistas medias según cuándo publicaste. Mañ 6–12 · Tar 12–18 · Noc 18–24 · Mad 0–6.</div>`;
  if (mejor) { const [d, f] = mejor[0].split('-').map(Number); h += `<div class="aviso" style="margin:10px 0 0;background:#00e5ff12;border-color:#00e5ff44;color:#bff6ff">🎯 Tu mejor momento hasta ahora: <b>${DIAS[d]} por la ${['mañana', 'tarde', 'noche', 'madrugada'][f]}</b> (${fmt(media(mejor[1]))} vistas de media, ${mejor[1].length} video${mejor[1].length > 1 ? 's' : ''}).</div>`; }
  return h;
}

const TRAFICO = {SHORTS: 'Feed de Shorts', YT_SEARCH: 'Búsqueda', BROWSE: 'Inicio', SUBSCRIBER: 'Suscripciones', EXT_URL: 'Webs externas', YT_CHANNEL: 'Tu canal', RELATED_VIDEO: 'Sugeridos', NOTIFICATION: 'Notificaciones', PLAYLIST: 'Listas', YT_OTHER_PAGE: 'Otras páginas', NO_LINK_OTHER: 'Directo', END_SCREEN: 'Pantalla final', HASHTAGS: 'Hashtags', SOUND_PAGE: 'Sonido'};
function vAnalizar() {
  const cs = filtrar(D.ok);
  let h = chipsFiltro();
  // Comparativa entre canales
  const comp = (k, f, txt) => barrasH(cs.map((c) => ({k: `${c.nombre} ${c.plataforma === 'youtube' ? 'YT' : 'TT'}`, v: f(c) || 0, txt: txt ? txt(f(c)) : undefined, color: c.color})));
  h += `<div class="card"><h3>⚖️ Comparar canales</h3>
    <div class="etq">Vistas medias por video (mediana)</div>${comp('m', (c) => c.mediana)}
    <div class="etq" style="margin-top:10px">Interacción media</div>${comp('e', (c) => c.mediaEng, (x) => pct(x))}
    <div class="etq" style="margin-top:10px">Seguidores</div>${comp('s', (c) => c.seguidores)}</div>`;
  // Mejor momento
  h += `<div class="card"><h3>🗓 ¿Cuándo publicar?</h3>${mapaCalor(cs.flatMap((c) => c.videos.filter((v) => (v.privacidad || 'public') === 'public')))}</div>`;
  // Duración
  const tramos = [['< 30 s', 0, 30], ['30–60 s', 30, 60], ['1–2 min', 60, 120], ['> 2 min', 120, 1e9]];
  const vids = cs.flatMap((c) => c.videos).filter((v) => v.duracion);
  const dur = tramos.map(([k, a, b]) => { const x = vids.filter((v) => v.duracion >= a && v.duracion < b); return {k, v: Math.round(mediana(x.map((v) => v.vistas))), txt: x.length ? `${fmt(mediana(x.map((v) => v.vistas)))} (${x.length})` : '—'}; });
  h += `<div class="card"><h3>⏱ ¿Qué duración funciona?</h3>${barrasH(dur, 'var(--violeta)')}<div class="leyenda">Vistas medianas por duración (entre paréntesis, nº de videos).</div></div>`;
  // Retención: qué videos se ven hasta el final (solo YouTube da este dato)
  const conRet = cs.flatMap((c) => c.videos).filter((v) => v.retencion != null && v.vistas >= 30).sort((a, b) => b.retencion - a.retencion);
  if (conRet.length >= 3) {
    const filaR = (v) => `<button class="fila-ret" data-video="${esc(v.canal.id)}|${esc(v.id)}"><span class="ret ${v.retencion >= 70 ? 'ok' : v.retencion >= 50 ? 'medio' : 'mal'}">${pct(v.retencion, 0)}</span><span class="t">${esc(corta(v.titulo, 52))}</span><span class="d">${v.duracion}s</span></button>`;
    const mR = mediana(conRet.map((v) => v.retencion));
    h += `<div class="card"><h3>👀 ¿Lo ven hasta el final? <small>retención · YouTube</small></h3>
      <div class="etq">Los que más enganchan</div>${conRet.slice(0, 4).map(filaR).join('')}
      <div class="etq" style="margin-top:10px">Donde más se van</div>${conRet.slice(-3).reverse().map(filaR).join('')}
      <div class="leyenda">Tu mediana: ${pct(mR, 0)}. En Shorts conviene pasar del 70 %: gancho en el primer segundo y menos de 50 s.</div></div>`;
  }
  // Analíticas de YouTube
  for (const c of cs.filter((c) => c.plataforma === 'youtube')) {
    const a = c.analiticas || {};
    if (a.error) { h += `<div class="aviso">${esc(c.nombre)}: ${esc(a.error)}</div>`; continue; }
    if (!a.por_dia) continue;
    const pd = a.por_dia, s = (k) => pd.reduce((t, r) => t + (r[k] || 0), 0), vistas = s('views');
    const verMedio = Math.round(pd.reduce((t, r) => t + (r.averageViewDuration || 0) * (r.views || 0), 0) / Math.max(1, vistas));
    h += `<div class="card" style="border-color:${c.color}55"><h3>${plat('youtube')} ${esc(c.nombre)} <small>últimos 28 días</small></h3>
      <div class="kpis k4"><div class="kpi"><span class="etq">Vistas</span><b class="num">${fmt(vistas)}</b></div><div class="kpi"><span class="etq">Tiempo visto</span><b class="num">${s('estimatedMinutesWatched') >= 120 ? fmt(s('estimatedMinutesWatched') / 60) + ' h' : fmt(s('estimatedMinutesWatched')) + ' min'}</b></div><div class="kpi"><span class="etq">Ver medio</span><b class="num">${verMedio} s</b></div><div class="kpi"><span class="etq">Suscriptores</span><b class="num"><span class="sube">+${fmt(s('subscribersGained'))}</span> <span class="baja" style="font-size:14px">−${fmt(s('subscribersLost'))}</span></b></div></div>
      <div style="margin-top:12px">${barrasV(pd.map((r) => ({x: r.day, y: r.views || 0})), c.color)}</div>
      ${a.trafico && a.trafico.length ? `<div class="etq" style="margin-top:12px">¿De dónde llegan?</div>${barrasH(a.trafico.slice(0, 6).map((r) => ({k: TRAFICO[r.insightTrafficSourceType] || r.insightTrafficSourceType, v: r.views})), c.color)}` : ''}
      ${a.paises && a.paises.length ? `<div class="etq" style="margin-top:12px">Países</div>${barrasH(a.paises.slice(0, 6).map((r) => { let n = r.country; try { n = new Intl.DisplayNames(['es'], {type: 'region'}).of(r.country); } catch (e) {} return {k: n, v: r.views}; }), 'var(--oro)')}` : ''}
    </div>`;
  }
  // Comentarios
  const coms = cs.flatMap((c) => (c.comentarios || []).map((x) => ({...x, c}))).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 8);
  if (coms.length) h += `<div class="card"><h3>💬 Últimos comentarios</h3>${coms.map((x) => `<div class="coment"><b>${plat(x.c.plataforma)} ${esc(x.autor)} · ${hace(x.fecha)}</b><br>${esc(x.texto)}</div>`).join('')}</div>`;
  return h;
}

// Metas (se guardan en este celular)
function metas() { try { return (JSON.parse(leer('dp-metas') || 'null') || []).filter((m) => m.canal); } catch (e) { return []; } }
function metasPorDefecto() {
  return D.ok.map((c) => {
    const s = c.seguidores, obj = s < 100 ? 100 : s < 1000 ? 1000 : s < 10000 ? 10000 : Math.ceil((s * 2) / 1e4) * 1e4;
    return {canal: c.id, metrica: 'seguidores', objetivo: obj};
  });
}
function vMetas() {
  let lista = metas();
  if (!lista.length && !leer('dp-metas-init')) { lista = metasPorDefecto(); guardar('dp-metas', JSON.stringify(lista)); guardar('dp-metas-init', '1'); }
  lista = lista.filter((m) => m.canal);
  let h = `<div class="card"><h3>🎯 Tus metas <small>se guardan en este celular</small></h3>`;
  lista.forEach((m, i) => {
    const c = D.ok.find((x) => x.id === m.canal);
    if (!c) return;
    const actual = c[m.metrica] || 0, p = Math.min(100, (actual / m.objetivo) * 100);
    const ritmo = ((c.delta28 || {})[m.metrica] ?? null) != null ? c.delta28[m.metrica] / 28 : (c.delta7 || {})[m.metrica] != null ? c.delta7[m.metrica] / 7 : null;
    const falta = m.objetivo - actual;
    let eta = 'Calculando ritmo: hace falta al menos un día de historial.';
    if (falta <= 0) { eta = '🎉 ¡Meta cumplida!'; const k = `dp-fiesta-${m.canal}-${m.metrica}-${m.objetivo}`; if (!leer(k)) { guardar(k, '1'); setTimeout(confeti, 300); } }
    else if (ritmo != null && ritmo > 0) {
      const dias = Math.ceil(falta / ritmo); const f = new Date(Date.now() + dias * 864e5);
      const r = ritmo >= 10 ? fmt(ritmo) + '/día' : ritmo >= 1 ? ritmo.toFixed(1).replace('.', ',') + '/día' : `1 cada ${Math.round(1 / ritmo)} días`;
      eta = dias > 365 ? `Al ritmo actual (${r}) tardarías más de un año. Con 1 video diario y series se acelera mucho.` : `Al ritmo actual (${r}) llegas en ~${fmt(dias)} días · ${f.toLocaleDateString('es', {day: 'numeric', month: 'short', year: 'numeric'})}`;
    }
    else if (ritmo != null) eta = 'Sin crecimiento reciente: publica para reactivar el ritmo.';
    h += `<div class="meta-item"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><div>${plat(c.plataforma)} <b>${esc(c.nombre)}</b> · ${m.metrica}</div><button class="chip" data-borrar-meta="${i}">✕</button></div>
      <div class="progreso"><i style="width:${p.toFixed(1)}%"></i></div>
      <div style="display:flex;justify-content:space-between;font-size:13px"><b class="num">${fmt(actual)} / ${fmt(m.objetivo)}</b><span style="color:var(--suave)">${p.toFixed(0)} %</span></div>
      <div style="color:var(--suave);font-size:12px;margin-top:4px">${eta}</div></div>`;
  });
  h += `</div><div class="card"><h3>➕ Nueva meta</h3><div class="form">
    <select id="mCanal">${D.ok.map((c) => `<option value="${c.id}">${c.nombre} ${c.plataforma === 'youtube' ? 'YT' : 'TT'}</option>`).join('')}</select>
    <select id="mMetrica"><option value="seguidores">Seguidores</option><option value="vistas">Vistas totales</option><option value="likes">Me gusta</option></select>
    <input id="mObjetivo" type="number" inputmode="numeric" min="1" placeholder="Objetivo (ej. 500)" style="grid-column:1/-1">
    <button class="btn" id="mAgregar">Añadir meta</button></div></div>`;
  return h;
}

function vConsejos() {
  const cs = filtrar(D.canales);
  const recs = D.recomendaciones.filter((r) => E.filtro === 'todos' || r.canal === 'general' || cs.some((c) => c.id === r.canal));
  let h = chipsFiltro();
  // Plan de la semana a partir del mejor momento
  const vids = filtrar(D.ok).flatMap((c) => c.videos);
  const top = [...vids].sort((a, b) => b.vistas - a.vistas)[0];
  h += `<div class="card hero"><h3>🧭 Tu plan para esta semana</h3>
    <div style="display:grid;gap:8px;font-size:14px">
      <div>1️⃣ Publica <b>1 video al día</b> en YouTube y TikTok (7 por semana). La constancia es lo que más premia el algoritmo.</div>
      ${top ? `<div>2️⃣ Repite la fórmula de <b>«${esc(top.titulo.slice(0, 50))}»</b> (${fmt(top.vistas)} vistas): mismo tipo de gancho y tema.</div>` : ''}
      <div>3️⃣ Gancho en el <b>primer segundo</b> y cierre con una pregunta para comentarios.</div>
      <div>4️⃣ Sube a <b>YouTube y TikTok</b> el mismo día y compara aquí cuál rinde más.</div>
    </div></div>`;
  h += `<div style="color:var(--suave);font-size:12px;margin-bottom:8px">🔴 urgente · 🟡 importante · 🟢 para mejorar · se recalculan en cada actualización</div>`;
  return h + (recs.map(filaConsejo).join('') || '<div class="vacio">Sin recomendaciones por ahora.</div>');
}

// ------------------------------------------------------------------ hoja de detalle de video
function abrirVideo(cid, vid) {
  const c = D.ok.find((x) => x.id === cid), v = c && c.videos.find((x) => x.id === vid);
  if (!v) return;
  const comp = (nombre, val, ref, f = fmt) => {
    const max = Math.max(val || 0, ref || 0, 1);
    return `<span>${nombre}</span><div class="pista"><i style="width:${((val || 0) / max) * 100}%;background:${(val || 0) >= (ref || 0) ? 'var(--verde)' : 'var(--rojo)'}"></i><u style="left:${((ref || 0) / max) * 100}%"></u></div><b class="num">${f(val)}</b>`;
  };
  const pub = c.videos.filter((x) => (x.privacidad || 'public') === 'public');
  const posicion = [...pub].sort((a, b) => b.vistas - a.vistas).findIndex((x) => x.id === v.id) + 1;
  let h = `<div class="portada"><img src="${esc(v.miniatura || '')}" alt=""><div style="min-width:0"><div class="meta" style="margin:0 0 6px">${plat(c.plataforma)} ${esc(c.nombre)} · ${fecha(v.publicado)}</div>
    <h3 style="font-size:16px;line-height:1.3">${esc(v.titulo.slice(0, 140))}</h3>
    <div class="meta">${v.etiqueta ? `<span class="tag ${v.etiqueta}">${TAGS[v.etiqueta]}</span>` : ''}<span>#${posicion} de ${pub.length} en el canal</span></div></div></div>
    <div class="kpis k4">
      <div class="kpi"><span class="etq">Vistas</span><b class="num">${fmt(v.vistas)}</b>${v.delta24 != null ? delta(v.delta24, ' hoy') : ''}</div>
      <div class="kpi"><span class="etq">Vistas por día</span><b class="num">${fmt(v.vpd)}</b><span class="delta igual">${fmt(diasDesde(v.publicado))} días publicado</span></div>
      <div class="kpi"><span class="etq">Me gusta</span><b class="num">${fmt(v.likes)}</b></div>
      <div class="kpi"><span class="etq">Comentarios</span><b class="num">${fmt(v.comentarios)}</b></div>
      ${v.compartidos != null ? `<div class="kpi"><span class="etq">Compartidos</span><b class="num">${fmt(v.compartidos)}</b></div>` : ''}
      <div class="kpi"><span class="etq">Interacción</span><b class="num">${pct(v.engagement)}</b></div>
      ${v.retencion != null ? `<div class="kpi"><span class="etq">Retención</span><b class="num">${pct(v.retencion, 0)}</b><span class="delta igual">ve ${v.ver_medio ?? '—'} s de ${v.duracion} s</span></div>` : ''}
      ${v.subs != null ? `<div class="kpi"><span class="etq">Suscriptores ganados</span><b class="num">+${fmt(v.subs)}</b></div>` : ''}
    </div>
    <div class="card" style="margin-top:12px"><h3>Frente a la media del canal <small>la raya = media</small></h3><div class="versus">
      ${comp('Vistas', v.vistas, c.mediana)}${comp('Interacción', v.engagement, c.mediaEng, (x) => pct(x))}
      ${v.retencion != null ? comp('Retención', v.retencion, media(pub.filter((x) => x.retencion != null).map((x) => x.retencion)), (x) => pct(x, 0)) : ''}
    </div></div>`;
  // El mismo video en la otra plataforma (misma marca, publicado con ≤ 2 días de diferencia).
  const otra = D.ok.filter((x) => x.marca === c.marca && x.plataforma !== c.plataforma).flatMap((x) => x.videos)
    .map((x) => ({x, d: Math.abs(new Date(x.publicado) - new Date(v.publicado)) / 864e5})).filter((o) => o.d <= 2).sort((a, b) => a.d - b.d)[0];
  if (otra) {
    const g = otra.x, yt = c.plataforma === 'youtube' ? v : g, tt = c.plataforma === 'youtube' ? g : v;
    const fila = (n, a, b, f = fmt) => `<div class="dual"><span>${n}</span><b class="${(a || 0) >= (b || 0) ? 'gana' : ''}">${f(a)}</b><b class="${(b || 0) > (a || 0) ? 'gana' : ''}">${f(b)}</b></div>`;
    h += `<div class="card"><h3>▶ YouTube vs ♪ TikTok <small>mismo video</small></h3>
      <div class="dual cab"><span></span><b>${plat('youtube')} YouTube</b><b>${plat('tiktok')} TikTok</b></div>
      ${fila('Vistas', yt.vistas, tt.vistas)}${fila('Me gusta', yt.likes, tt.likes)}${fila('Comentarios', yt.comentarios, tt.comentarios)}${fila('Interacción', yt.engagement, tt.engagement, (x) => pct(x))}
      <div class="leyenda">${yt.vistas >= tt.vistas ? `En YouTube tuvo ${fmt(yt.vistas / Math.max(1, tt.vistas))}× más vistas.` : `En TikTok tuvo ${fmt(tt.vistas / Math.max(1, yt.vistas))}× más vistas.`}</div>
      <button class="chip" style="margin-top:8px" data-video="${esc(g.canal.id)}|${esc(g.id)}">Ver la versión de ${g.canal.plataforma === 'youtube' ? 'YouTube' : 'TikTok'} →</button></div>`;
  }
  if ((v.hist || []).length) h += `<div class="card"><h3>Vistas en el tiempo</h3>${linea('vid', [{nombre: 'vistas', color: c.color, datos: v.hist.map((p) => ({x: p.f, y: p.v}))}], {alto: 130})}</div>`;
  h += `<a class="btn" style="width:100%" href="${esc(v.url)}" target="_blank" rel="noopener">Abrir en ${c.plataforma === 'youtube' ? 'YouTube' : 'TikTok'} ↗</a>`;
  $('#hojaCont').innerHTML = h;
  $('#hoja').scrollTop = 0;
  $('#velo').classList.add('on'); $('#hoja').classList.add('on');
}
function cerrarHoja() { $('#velo').classList.remove('on'); $('#hoja').classList.remove('on'); }
$('#velo').addEventListener('click', cerrarHoja);
let toqueY = null;
$('#hoja').addEventListener('touchstart', (e) => { if ($('#hoja').scrollTop <= 0) toqueY = e.touches[0].clientY; }, {passive: true});
$('#hoja').addEventListener('touchmove', (e) => { if (toqueY != null && e.touches[0].clientY - toqueY > 90) { toqueY = null; cerrarHoja(); } }, {passive: true});

// ------------------------------------------------------------------ pintar y eventos
const TABS = ['inicio', 'videos', 'plan', 'analizar', 'metas'];
const TITULOS = {inicio: 'Inicio', videos: 'Videos', plan: 'Plan', analizar: 'Analizar', metas: 'Metas'};
function pintar() {
  if (!D) return;
  graficas = {};
  $('#titulo').textContent = TITULOS[E.tab];
  $('#actualizado').textContent = `Actualizado ${hace(D.generado)} · ${new Date(D.generado).toLocaleString('es', {weekday: 'short', hour: '2-digit', minute: '2-digit'})}`;
  $('#vista').innerHTML = {inicio: vInicio, videos: vVideos, plan: vPlan, analizar: vAnalizar, metas: vMetas}[E.tab]();
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === E.tab));
  const q = $('#q');
  if (q) q.addEventListener('input', () => { E.q = q.value; const pos = q.selectionStart; pintar(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); });
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab],[data-canal],[data-filtro],[data-periodo],[data-orden],[data-vfiltro],[data-video],[data-borrar-meta],#mAgregar');
  if (!t) return;
  if (t.dataset.video) { const [c, v] = t.dataset.video.split('|'); abrirVideo(c, v); return; }
  if (t.id === 'mAgregar') {
    const obj = Number($('#mObjetivo').value);
    if (!obj) { $('#mObjetivo').focus(); return; }
    const l = metas(); l.push({canal: $('#mCanal').value, metrica: $('#mMetrica').value, objetivo: obj}); guardar('dp-metas', JSON.stringify(l));
  }
  if (t.dataset.borrarMeta != null) { const l = metas(); l.splice(Number(t.dataset.borrarMeta), 1); guardar('dp-metas', JSON.stringify(l)); guardar('dp-metas-init', '1'); }
  if (t.dataset.tab) { const a = TABS.indexOf(E.tab), b = TABS.indexOf(t.dataset.tab); irA(t.dataset.tab, b > a ? 'izq' : b < a ? 'der' : null); return; }
  if (t.dataset.canal) { const c = D.canales.find((x) => x.id === t.dataset.canal); E.filtro = c.plataforma === 'youtube' && E.filtro === 'youtube' ? c.marca : c.marca; E.tab = 'analizar'; window.scrollTo({top: 0}); }
  if (t.dataset.filtro) { E.filtro = t.dataset.filtro; guardar('dp-filtro', E.filtro); }
  if (t.dataset.periodo) { E.periodo = t.dataset.periodo; guardar('dp-periodo', E.periodo); }
  if (t.dataset.orden) E.orden = t.dataset.orden;
  if (t.dataset.vfiltro) E.vfiltro = t.dataset.vfiltro;
  pintar();
});
$('#entrar').addEventListener('click', () => entrar($('#clave').value.trim()));
$('#clave').addEventListener('keydown', (e) => e.key === 'Enter' && entrar($('#clave').value.trim()));
$('#refrescar').addEventListener('click', async () => { const b = $('#refrescar'); b.classList.add('girando'); await entrar(leer('dp-clave') || '', true); b.classList.remove('girando'); });
$('#compartir').addEventListener('click', async () => {
  if (!D) return;
  const t = D.totales;
  const txt = `📊 Delga Panel · ${new Date(D.generado).toLocaleDateString('es')}\n` + D.ok.map((c) => `${c.plataforma === 'youtube' ? '▶' : '♪'} ${c.nombre}: ${fmt(c.seguidores)} seguidores · ${fmt(c.vistas)} vistas`).join('\n') + `\nTotal: ${fmt(t.seguidores)} seguidores · ${fmt(t.vistas)} vistas`;
  try { if (navigator.share) await navigator.share({text: txt}); else { await navigator.clipboard.writeText(txt); $('#actualizado').textContent = 'Resumen copiado ✔'; } } catch (e) {}
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && D) entrar(leer('dp-clave') || '', true); });

addEventListener('load', () => { const cl = leer('dp-clave') || leer('delga-clave'); if (cl) entrar(cl, true).then(() => typeof contar === 'function' && contar()); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
