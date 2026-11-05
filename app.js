'use strict';
// Delga Panel — descifra datos.enc.json con la clave y muestra las métricas de los 4 canales.

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmt = (n) => (n == null ? '—' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' M' : Math.abs(n) >= 1e4 ? (n / 1e3).toFixed(1).replace('.', ',') + ' K' : Number(n).toLocaleString('es'));
const delta = (n) => (n == null ? '<span class="delta igual">—</span>' : `<span class="delta ${n > 0 ? 'sube' : n < 0 ? 'baja' : 'igual'}">${n > 0 ? '▲' : n < 0 ? '▼' : '='} ${fmt(Math.abs(n))}</span>`);
const plat = (p) => `<span class="plat ${p}">${p === 'youtube' ? '▶' : '♪'}</span>`;
const fecha = (iso) => new Date(iso).toLocaleDateString('es', {day: 'numeric', month: 'short'});
const hace = (iso) => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  return m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`;
};
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const leer = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };

let D = null;
let tab = 'resumen';
let canalSel = null;
let ordenVideos = 'recientes';
let filtroVideos = 'todos';

// ------------------------------------------------------------- descifrado
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function descifrar(enc, clave) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveKey']);
  const k = await crypto.subtle.deriveKey({name: 'PBKDF2', salt: b64(enc.sal), iterations: enc.it, hash: 'SHA-256'}, base, {name: 'AES-GCM', length: 256}, false, ['decrypt']);
  const plano = await crypto.subtle.decrypt({name: 'AES-GCM', iv: b64(enc.iv)}, k, b64(enc.datos));
  return JSON.parse(new TextDecoder().decode(plano));
}

async function cargar(clave) {
  const r = await fetch('datos.enc.json?t=' + Date.now(), {cache: 'no-store'});
  if (!r.ok) throw new Error('No se pudieron descargar los datos');
  return descifrar(await r.json(), clave);
}

async function entrar(clave, silencioso) {
  try {
    D = await cargar(clave);
    guardar('delga-clave', clave);
    $('#bloqueo').classList.add('oculto');
    pintar();
  } catch (e) {
    console.error('delga', e && e.stack || e);
    if (!silencioso) $('#errorClave').textContent = e.name === 'OperationError' ? 'Clave incorrecta' : 'Sin conexión o sin datos todavía';
    $('#bloqueo').classList.remove('oculto');
  }
}

// ------------------------------------------------------------- gráficas SVG
function linea(series, {alto = 150, porcentaje = false} = {}) {
  const pts = series.flatMap((s) => s.datos);
  if (pts.length < 2) return '<div class="vacio">Aún no hay suficiente historial. Se llenará día a día.</div>';
  const W = 340, H = alto, P = 28;
  const xs = [...new Set(pts.map((p) => p.x))].sort();
  const ys = pts.map((p) => p.y);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (min === max) { min -= 1; max += 1; }
  const X = (x) => P + (xs.indexOf(x) / Math.max(1, xs.length - 1)) * (W - P - 6);
  const Y = (y) => 8 + (1 - (y - min) / (max - min)) * (H - 28);
  let svg = `<svg class="graf" viewBox="0 0 ${W} ${H}">`;
  for (let i = 0; i <= 2; i++) {
    const v = min + ((max - min) * i) / 2, y = Y(v);
    svg += `<line x1="${P}" x2="${W}" y1="${y}" y2="${y}" stroke="#22305a" stroke-width="1"/><text x="0" y="${y + 4}" fill="#93a3c8" font-size="10">${porcentaje ? v.toFixed(0) + '%' : fmt(Math.round(v))}</text>`;
  }
  [xs[0], xs[xs.length - 1]].forEach((x, i) => (svg += `<text x="${X(x)}" y="${H - 4}" fill="#93a3c8" font-size="10" text-anchor="${i ? 'end' : 'start'}">${fecha(x)}</text>`));
  for (const s of series) {
    if (!s.datos.length) continue;
    const d = s.datos.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
    svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" ${s.punteada ? 'stroke-dasharray="5 4"' : ''}/>`;
    const u = s.datos[s.datos.length - 1];
    svg += `<circle cx="${X(u.x)}" cy="${Y(u.y)}" r="3.5" fill="${s.color}"/>`;
  }
  return svg + '</svg>';
}

function barras(datos, {alto = 120, color = '#00e5ff'} = {}) {
  if (!datos.length) return '<div class="vacio">Sin datos</div>';
  const W = 340, H = alto, max = Math.max(1, ...datos.map((d) => d.y));
  const w = (W - 4) / datos.length;
  let svg = `<svg class="graf" viewBox="0 0 ${W} ${H}">`;
  datos.forEach((d, i) => {
    const h = (d.y / max) * (H - 22);
    svg += `<rect x="${2 + i * w + 1}" y="${H - 16 - h}" width="${Math.max(1, w - 2)}" height="${h}" rx="2" fill="${color}" opacity="${0.55 + 0.45 * (d.y / max)}"/>`;
  });
  svg += `<text x="2" y="${H - 3}" fill="#93a3c8" font-size="10">${fecha(datos[0].x)}</text><text x="${W - 2}" y="${H - 3}" fill="#93a3c8" font-size="10" text-anchor="end">${fecha(datos[datos.length - 1].x)}</text>`;
  svg += `<text x="${W - 2}" y="10" fill="#93a3c8" font-size="10" text-anchor="end">máx ${fmt(max)}</text>`;
  return svg + '</svg>';
}

const listaBarras = (items, color = '#00e5ff') => {
  const max = Math.max(1, ...items.map((i) => i.v));
  return `<div class="lista-barras">${items.map((i) => `<div class="fb"><span>${esc(i.k)}</span><div class="bar" style="width:${Math.max(3, (i.v / max) * 100)}%;background:${color}"></div><span class="num">${i.txt ?? fmt(i.v)}</span></div>`).join('')}</div>`;
};

// ------------------------------------------------------------- vistas
const nombreCanal = (c) => `${plat(c.plataforma)} ${esc(c.nombre)}`;
const TRAFICO = {SHORTS: 'Feed de Shorts', YT_SEARCH: 'Búsqueda', BROWSE: 'Inicio', SUBSCRIBER: 'Suscripciones', EXT_URL: 'Externo', YT_CHANNEL: 'Canal', RELATED_VIDEO: 'Sugeridos', NOTIFICATION: 'Notificaciones', PLAYLIST: 'Listas', YT_OTHER_PAGE: 'Otras', NO_LINK_OTHER: 'Directo', END_SCREEN: 'Pantalla final', HASHTAGS: 'Hashtags', SOUND_PAGE: 'Sonido'};

function vistaResumen() {
  const t = D.totales;
  const pend = D.canales.filter((c) => c.estado !== 'ok');
  let h = '';
  if (pend.length) h += `<div class="aviso">⚠️ ${pend.length} cuenta(s) sin conectar: ${pend.map((c) => esc(c.nombre) + ' ' + c.plataforma).join(', ')}. Mira la pestaña Consejos.</div>`;
  h += `<div class="tarjeta hero"><div class="etq">Seguidores totales</div><div class="grande num">${fmt(t.seguidores)}</div><div>${delta(t.seguidores_7d)} <span style="color:var(--suave);font-size:13px">en 7 días</span></div>
    <div class="fila" style="margin-top:14px"><div class="kpi"><span class="etq">Vistas</span><b class="num">${fmt(t.vistas)}</b>${delta(t.vistas_7d)}</div><div class="kpi"><span class="etq">Me gusta</span><b class="num">${fmt(t.likes)}</b></div><div class="kpi"><span class="etq">Videos</span><b class="num">${fmt(t.videos)}</b></div></div></div>`;
  h += '<div class="rejilla">' + D.canales.map((c) => `
    <button class="canal ${c.estado !== 'ok' ? 'apagado' : ''}" style="--c:${c.color};text-align:left" data-canal="${c.id}">
      <div class="cab">${nombreCanal(c)}</div>
      <div class="seg num">${c.estado === 'ok' ? fmt(c.seguidores) : '—'}</div>
      <div class="mini">${c.estado === 'ok' ? `seguidores ${delta((c.delta7 || {}).seguidores)}` : 'sin conectar'}</div>
      <div class="mini num">${c.estado === 'ok' ? `${fmt(c.vistas)} vistas · ${c.num_videos} videos` : ''}</div>
    </button>`).join('') + '</div>';
  const ok = D.canales.filter((c) => c.estado === 'ok');
  h += `<div class="tarjeta"><div class="etq">Seguidores en el tiempo</div>${linea(ok.map((c) => ({color: c.color, punteada: c.plataforma === 'tiktok', datos: (c.serie || []).map((s) => ({x: s.fecha, y: s.seguidores || 0}))})))}
    <div class="leyenda">${ok.map((c) => `<span><i style="background:${c.color}"></i>${esc(c.nombre)} ${c.plataforma === 'youtube' ? 'YT' : 'TT'}</span>`).join('')}</div></div>`;
  const enAlza = ok.flatMap((c) => c.videos.map((v) => ({...v, canal: c}))).filter((v) => v.delta24 > 0).sort((a, b) => b.delta24 - a.delta24).slice(0, 3);
  if (enAlza.length) h += `<div class="tarjeta"><div class="etq">🔥 En alza (últimas 24 h)</div>${enAlza.map(filaVideo).join('')}</div>`;
  const top = D.recomendaciones.slice(0, 2);
  if (top.length) h += `<div class="tarjeta"><div class="etq" style="margin-bottom:8px">Lo más importante ahora</div>${top.map(filaConsejo).join('')}</div>`;
  return h;
}

function vistaCanal() {
  if (!canalSel) canalSel = (D.canales.find((c) => c.estado === 'ok') || D.canales[0]).id;
  const c = D.canales.find((x) => x.id === canalSel);
  let h = `<div class="chips">${D.canales.map((x) => `<button class="chip ${x.id === canalSel ? 'on' : ''}" data-sel="${x.id}">${plat(x.plataforma)} ${esc(x.nombre)}</button>`).join('')}</div>`;
  if (c.estado !== 'ok') return h + `<div class="aviso">${esc(c.mensaje || 'Cuenta sin conectar')}</div>`;
  const d7 = c.delta7 || {};
  h += `<div class="tarjeta" style="border-color:${c.color}55">
    <div style="display:flex;align-items:center;gap:12px">${c.avatar ? `<img src="${esc(c.avatar)}" style="width:48px;height:48px;border-radius:50%">` : ''}<div><h2 style="font-size:19px">${esc(c.titulo || c.nombre)}</h2><a href="${esc(c.url)}" target="_blank" style="color:var(--suave);font-size:13px">${esc(c.handle || '')} ↗</a></div></div>
    <div class="fila" style="margin-top:14px"><div class="kpi"><span class="etq">Seguidores</span><b class="num">${fmt(c.seguidores)}</b>${delta(d7.seguidores)}</div><div class="kpi"><span class="etq">Vistas</span><b class="num">${fmt(c.vistas)}</b>${delta(d7.vistas)}</div></div>
    <div class="fila" style="margin-top:10px"><div class="kpi"><span class="etq">Me gusta</span><b class="num">${fmt(c.likes)}</b></div><div class="kpi"><span class="etq">Videos</span><b class="num">${fmt(c.num_videos)}</b></div><div class="kpi"><span class="etq">Interacción</span><b class="num">${(c.resumen || {}).engagement_medio ?? '—'}%</b></div></div></div>`;
  h += `<div class="tarjeta"><div class="etq">Seguidores y vistas (historial)</div>${linea([{color: c.color, datos: (c.serie || []).map((s) => ({x: s.fecha, y: s.seguidores || 0}))}])}${linea([{color: '#ffc400', datos: (c.serie || []).map((s) => ({x: s.fecha, y: s.vistas || 0}))}], {alto: 110})}<div class="leyenda"><span><i style="background:${c.color}"></i>seguidores</span><span><i style="background:#ffc400"></i>vistas acumuladas</span></div></div>`;
  const a = c.analiticas;
  if (a && a.error) h += `<div class="aviso">Analíticas de YouTube: ${esc(a.error)}</div>`;
  if (a && a.por_dia) {
    const pd = a.por_dia;
    const suma = (k) => pd.reduce((s, r) => s + (r[k] || 0), 0);
    const vistas28 = suma('views'), min28 = suma('estimatedMinutesWatched'), gan = suma('subscribersGained'), per = suma('subscribersLost');
    const durMedia = pd.length ? Math.round(pd.reduce((s, r) => s + (r.averageViewDuration || 0) * (r.views || 0), 0) / Math.max(1, vistas28)) : 0;
    h += `<div class="tarjeta"><div class="etq">Últimos 28 días</div>
      <div class="fila" style="margin:10px 0"><div class="kpi"><span class="etq">Vistas</span><b class="num">${fmt(vistas28)}</b></div><div class="kpi"><span class="etq">Min. vistos</span><b class="num">${fmt(min28)}</b></div><div class="kpi"><span class="etq">Ver medio</span><b class="num">${durMedia}s</b></div></div>
      <div class="fila" style="margin-bottom:10px"><div class="kpi"><span class="etq">Subs ganados</span><b class="num sube">+${fmt(gan)}</b></div><div class="kpi"><span class="etq">Subs perdidos</span><b class="num baja">−${fmt(per)}</b></div><div class="kpi"><span class="etq">Compartidos</span><b class="num">${fmt(suma('shares'))}</b></div></div>
      ${barras(pd.map((r) => ({x: r.day, y: r.views || 0})), {color: c.color})}</div>`;
    if (a.trafico && a.trafico.length) h += `<div class="tarjeta"><div class="etq">¿De dónde vienen las vistas?</div>${listaBarras(a.trafico.slice(0, 6).map((r) => ({k: TRAFICO[r.insightTrafficSourceType] || r.insightTrafficSourceType, v: r.views})), c.color)}</div>`;
    if (a.paises && a.paises.length) {
      const nomPais = (cc) => { try { return new Intl.DisplayNames(['es'], {type: 'region'}).of(cc); } catch (e) { return cc; } };
      h += `<div class="tarjeta"><div class="etq">Países</div>${listaBarras(a.paises.map((r) => ({k: nomPais(r.country), v: r.views})), '#ffc400')}</div>`;
    }
    if (a.demografia && a.demografia.length) {
      const edades = {};
      a.demografia.forEach((r) => (edades[r.ageGroup] = (edades[r.ageGroup] || 0) + r.viewerPercentage));
      h += `<div class="tarjeta"><div class="etq">Edad del público</div>${listaBarras(Object.entries(edades).map(([k, v]) => ({k: k.replace('age', '').replace('-', '–'), v, txt: v.toFixed(0) + '%'})), '#ff4fa3')}</div>`;
    }
  }
  const mo = c.momento || {};
  const dias = Object.entries(mo.dia || {}).map(([k, v]) => ({k, v: v.vistas_media, txt: `${fmt(v.vistas_media)} (${v.n})`}));
  if (dias.length) h += `<div class="tarjeta"><div class="etq">Vistas medias según día de publicación</div>${listaBarras(dias, '#2ee66b')}<div class="leyenda">(entre paréntesis: nº de videos)</div></div>`;
  if (c.comentarios && c.comentarios.length) h += `<div class="tarjeta"><div class="etq">Últimos comentarios</div>${c.comentarios.slice(0, 8).map((x) => `<div class="coment"><b>${esc(x.autor)} · ${hace(x.fecha)}</b><br>${esc(x.texto)}</div>`).join('')}</div>`;
  h += `<div class="tarjeta"><div class="etq">Videos</div>${c.videos.slice(0, 12).map((v) => filaVideo({...v, canal: c})).join('')}</div>`;
  return h;
}

function filaVideo(v) {
  return `<a class="video" href="${esc(v.url)}" target="_blank" rel="noopener">
    <img loading="lazy" src="${esc(v.miniatura || '')}" alt="">
    <div style="min-width:0;flex:1"><div class="t">${esc(v.titulo)}</div>
      <div class="m">${v.canal ? `<span>${plat(v.canal.plataforma)} ${esc(v.canal.nombre)}</span>` : ''}<span>${fecha(v.publicado)}</span></div>
      <div class="m"><span>👁 <b class="num">${fmt(v.vistas)}</b></span><span>❤️ <b class="num">${fmt(v.likes)}</b></span><span>💬 <b class="num">${fmt(v.comentarios)}</b></span><span>⚡ <b>${v.engagement ?? 0}%</b></span>${v.delta24 > 0 ? `<span class="badge">+${fmt(v.delta24)} hoy</span>` : ''}</div>
    </div></a>`;
}

function vistaVideos() {
  const ok = D.canales.filter((c) => c.estado === 'ok');
  let lista = ok.flatMap((c) => (c.videos || []).map((v) => ({...v, canal: c})));
  if (filtroVideos !== 'todos') lista = lista.filter((v) => v.canal.id === filtroVideos);
  const ord = {recientes: (a, b) => b.publicado.localeCompare(a.publicado), vistas: (a, b) => b.vistas - a.vistas, alza: (a, b) => (b.delta24 || 0) - (a.delta24 || 0), interaccion: (a, b) => (b.engagement || 0) - (a.engagement || 0)};
  lista.sort(ord[ordenVideos]);
  let h = `<div class="chips">${[['recientes', 'Recientes'], ['vistas', 'Más vistos'], ['alza', 'En alza'], ['interaccion', 'Interacción']].map(([k, t]) => `<button class="chip ${ordenVideos === k ? 'on' : ''}" data-orden="${k}">${t}</button>`).join('')}</div>`;
  h += `<div class="chips"><button class="chip ${filtroVideos === 'todos' ? 'on' : ''}" data-filtro="todos">Todos</button>${ok.map((c) => `<button class="chip ${filtroVideos === c.id ? 'on' : ''}" data-filtro="${c.id}">${plat(c.plataforma)} ${esc(c.nombre)}</button>`).join('')}</div>`;
  h += lista.length ? `<div class="tarjeta">${lista.slice(0, 60).map(filaVideo).join('')}</div>` : '<div class="vacio">No hay videos todavía.</div>';
  return h;
}

const filaConsejo = (r) => `<div class="consejo"><div class="p p${r.prioridad}"></div><div><small>${esc(r.nombre)}</small><div>${esc(r.texto)}</div></div></div>`;

function vistaConsejos() {
  return `<div style="color:var(--suave);font-size:13px;margin-bottom:10px">🔴 urgente · 🟡 importante · 🟢 para mejorar. Se recalculan con cada actualización.</div>` + (D.recomendaciones.map(filaConsejo).join('') || '<div class="vacio">Sin recomendaciones por ahora.</div>');
}

const TITULOS = {resumen: 'Resumen', canal: 'Canales', videos: 'Videos', consejos: 'Consejos'};
function pintar() {
  if (!D) return;
  $('#titulo').textContent = TITULOS[tab];
  $('#actualizado').textContent = 'Actualizado ' + hace(D.generado) + ' · ' + new Date(D.generado).toLocaleString('es', {weekday: 'short', hour: '2-digit', minute: '2-digit'});
  $('#vista').innerHTML = {resumen: vistaResumen, canal: vistaCanal, videos: vistaVideos, consejos: vistaConsejos}[tab]();
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
}

// ------------------------------------------------------------- eventos
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab],[data-canal],[data-sel],[data-orden],[data-filtro]');
  if (!t) return;
  if (t.dataset.tab) { tab = t.dataset.tab; guardar('delga-tab', tab); }
  if (t.dataset.canal) { canalSel = t.dataset.canal; tab = 'canal'; }
  if (t.dataset.sel) canalSel = t.dataset.sel;
  if (t.dataset.orden) ordenVideos = t.dataset.orden;
  if (t.dataset.filtro) filtroVideos = t.dataset.filtro;
  pintar();
  if (t.dataset.tab || t.dataset.canal) window.scrollTo({top: 0});
});
$('#entrar').addEventListener('click', () => entrar($('#clave').value.trim()));
$('#clave').addEventListener('keydown', (e) => e.key === 'Enter' && entrar($('#clave').value.trim()));
$('#refrescar').addEventListener('click', async () => {
  const b = $('#refrescar');
  b.classList.add('girando');
  await entrar(leer('delga-clave') || '', true);
  b.classList.remove('girando');
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && D) entrar(leer('delga-clave') || '', true); });

tab = leer('delga-tab') || 'resumen';
const claveGuardada = leer('delga-clave');
if (claveGuardada) entrar(claveGuardada, true);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
