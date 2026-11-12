'use strict';
// Pestaña «Grabar» del Delga Panel: guiones pendientes → teleprompter → grabar → confirmar → buzón privado → la PC lo baja a su carpeta.
// El acceso al buzón viene dentro de los datos cifrados del panel (D.buzon); no hay que pegar nada.

const BUZON = 'https://api.github.com/repos/wuilkindelgado-cell/delga-buzon/contents';
const GR = {lista: JSON.parse(leer('dg-cache') || '[]'), cargado: 0, cargando: false, error: '', actual: null, rec: null, trozos: [], blob: null, ext: 'm4a', t0: 0, reloj: 0, scroll: 0, wake: null, enviados: JSON.parse(leer('dg-enviados') || '[]'), estado: JSON.parse(leer('dg-estado') || '{}'), marcas: [], aprobados: JSON.parse(leer('dg-aprobados') || '{}'), respondidos: JSON.parse(leer('dg-respondidos') || '[]')};
const VAPID = 'BMQ6X6qVurcA9SmwWvsxYfCHCaXZ6KTbkeVmF_jOo-741TbSlq6cY-ByzAiEN2LYG49K3D0hZ8DlIaVMaMx9ym4';
const tokenBuzon = () => (D && D.buzon) || leer('dg-token');
const hdr = (extra = {}) => ({Authorization: `Bearer ${tokenBuzon()}`, Accept: 'application/vnd.github+json', ...extra});

async function cargarGuiones(forzar) {
  if (GR.cargando || (!forzar && Date.now() - GR.cargado < 30000)) return;
  if (!tokenBuzon()) { GR.error = 'sin-acceso'; return; }
  GR.cargando = true;
  try {
    const r = await fetch(`${BUZON}/guiones.json?t=${Date.now()}`, {headers: hdr({Accept: 'application/vnd.github.raw'}), cache: 'no-store'});
    if (!r.ok) throw new Error(r.status);
    GR.lista = (await r.json()).guiones || [];
    guardar('dg-cache', JSON.stringify(GR.lista));
    const r2 = await fetch(`${BUZON}/estado.json?t=${Date.now()}`, {headers: hdr({Accept: 'application/vnd.github.raw'}), cache: 'no-store'});
    if (r2.ok) { GR.estado = await r2.json(); guardar('dg-estado', JSON.stringify(GR.estado)); }
    GR.error = ''; GR.cargado = Date.now();
  } catch (e) { GR.error = 'red'; }
  GR.cargando = false;
  marcarPendientes();
  if ((E.tab === 'grabar' || E.tab === 'inicio') && $('#prompter').classList.contains('oculto') && !$('#hoja').classList.contains('on')) pintar();
}
function marcarPendientes() {
  const b = $('nav .navrec .burbuja');
  const n = GR.lista.length + porRevisar().length;
  if (b) { b.textContent = n; b.style.display = n ? '' : 'none'; }
}

function vGrabar() {
  cargarGuiones();
  let h = '';
  if (GR.error === 'sin-acceso') h += `<div class="card"><h3>🔒 Falta el acceso al buzón</h3><div class="vacio">Toca ↻ arriba en unos minutos: la PC lo está agregando a tus datos.</div></div>`;
  h += bannerAvisos();
  h += tarjetaRevisar(true);
  if (!GR.lista.length) {
    h += `<div class="card gr-vacio"><div style="font-size:46px">🎉</div><b>No hay guiones por grabar</b><span>Cuando Claude escriba uno nuevo aparece aquí al instante.</span></div>`;
  } else {
    h += `<div class="etq" style="margin:2px 2px 10px">${GR.lista.length === 1 ? 'Tienes 1 guion por grabar' : `Tienes ${GR.lista.length} guiones por grabar`}</div>`;
    h += GR.lista.map((g, i) => {
      const fut = g.canal === 'Delgafutbol';
      const seg = Math.round(g.lineas.join(' ').split(/\s+/).length / 2.6);
      return `<button class="gr-tarjeta ${fut ? 'fut' : 'tec'}" data-guion="${i}">
        <span class="gr-chip">${fut ? '⚽' : '⚡'} ${esc(g.canal)}</span>
        <b>${esc(g.tema)}</b>
        <span class="gr-tit">${esc(g.titulo)}</span>
        <span class="gr-pie"><span>📝 ${g.lineas.length} partes · ≈${seg} s</span><span class="gr-ir">🎙️ Grabar</span></span>
      </button>`;
    }).join('');
  }
  h += `<button class="gr-libre" id="grLibre"><span class="gr-libre-rec"><i></i></span><span><b>Grabar sin guion</b><small>Va a la carpeta _entrada de la PC</small></span></button>`;
  h += `<button class="btn sec" id="grSuelto" style="width:100%;margin-bottom:14px">📎 Subir un audio de Notas de Voz</button>`;
  h += tableroProduccion();
  if (GR.enviados.length) h += `<div class="card"><h3>📤 Enviados</h3>${GR.enviados.slice(0, 5).map((x) => `<div class="hoy-fila"><span>${esc(x.tema)}</span><span class="hoy-sub">${hace(x.cuando)}</span></div>`).join('')}<div class="hoy-sub" style="margin-top:8px">La PC los baja a su carpeta en ≤ 3 min.</div></div>`;
  return h;
}

// ---------- teleprompter ----------
// Pausas: «/» corta → punto suave; «//» larga → respiro. **palabra** → resaltada.
const fmtLinea = (l) => esc(l)
  .replace(/\*\*(.+?)\*\*/g, '<em>$1</em>')
  .replace(/\s*\/\/\s*/g, '<span class="pzL" aria-hidden="true"></span>')
  .replace(/\s+\/\s+/g, ' <span class="pzC" aria-hidden="true"></span> ')
  .replace(/\s*\/\s*$/g, ' <span class="pzC" aria-hidden="true"></span>');
const VEL = () => Math.max(1, Math.min(10, +(leer('dg-vel') || 3)));
const pintarVel = () => { $('#velTxt').textContent = VEL(); };

function abrirPrompter(g) {
  GR.actual = g;
  const fut = g && g.canal === 'Delgafutbol';
  $('#pCanal').textContent = g ? (fut ? '⚽ Delgafutbol' : '⚡ Delgatronics') : '🎙️ Libre';
  $('#pCanal').className = 'pchip ' + (g ? (fut ? 'fut' : 'tec') : 'lib');
  $('#pTitulo').textContent = g ? g.tema : 'Grabación sin guion';
  $('#texto').innerHTML = g ? g.lineas.map((l) => `<p>${fmtLinea(l)}</p>`).join('')
    : '<p>Grabación libre, sin guion.</p><p>Toca el botón rojo para empezar y otra vez para parar.</p>';
  $('#texto').style.setProperty('--tam', (leer('dg-tam') || 32) + 'px');
  $('#texto').scrollTop = 0;
  $('#reloj').textContent = '0:00';
  pintarAislar(); pintarVel();
  modoPrompter('grabar');
  $('#prompter').classList.remove('oculto', 'grabando');
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => { ajustarZona(); enfocar(); });
}
function cerrarPrompter() {
  if (GR.rec && GR.rec.state === 'recording') { if (!confirm('¿Descartar la grabación en curso?')) return; pararGrab(true); }
  GR.cancelarCuenta = true;
  $('#prompter').classList.add('oculto');
  document.body.style.overflow = '';
  soltarPant();
}
function modoPrompter(m) { $('#modoGrabar').classList.toggle('oculto', m !== 'grabar'); $('#modoRevisar').classList.toggle('oculto', m !== 'revisar'); }
// La línea de lectura está al 30 % de la zona de texto; el relleno superior hace que el primer párrafo arranque ahí.
function ajustarZona() { const z = $('#texto'); z.style.setProperty('--pre', Math.round(z.clientHeight * 0.3) + 'px'); }
function enfocar() {
  const z = $('#texto'); const caja = z.getBoundingClientRect(); const y = caja.top + caja.height * 0.3 + 10;
  let activo = null;
  for (const p of z.children) {
    const r = p.getBoundingClientRect();
    let est = r.bottom < y - 4 ? 'leido' : r.top <= y + 6 ? 'activo' : '';
    if (est === 'activo') { if (activo) est = 'leido'; else activo = p; }
    p.className = est;
  }
  if (!activo) { const sig = [...z.children].find((p) => !p.className); if (sig) sig.className = 'activo'; }
  const max = z.scrollHeight - z.clientHeight;
  $('#pProg').style.width = (max > 0 ? Math.min(100, (z.scrollTop / max) * 100) : 0) + '%';
}
function avanzarTexto() {
  cancelAnimationFrame(GR.scroll);
  let ult = performance.now();
  const paso = (ahora) => { $('#texto').scrollTop += VEL() * 9 * ((ahora - ult) / 1000); ult = ahora; enfocar(); GR.scroll = requestAnimationFrame(paso); };
  GR.scroll = requestAnimationFrame(paso);
}
const pintarAislar = () => { const on = leer('dg-aislar') !== '0'; const b = $('#aislar'); b.innerHTML = on ? '🎧 <span>Sin ruido</span>' : '🎙️ <span>Natural</span>'; b.classList.toggle('on', on); };

async function cuentaAtras() {
  GR.cancelarCuenta = false;
  const c = $('#cuenta'); c.classList.remove('oculto');
  for (const n of [3, 2, 1]) {
    if (GR.cancelarCuenta) break;
    c.innerHTML = `<b>${n}</b><span>Prepárate…</span>`;
    await new Promise((r) => setTimeout(r, 800));
  }
  c.classList.add('oculto');
  return !GR.cancelarCuenta;
}

async function empezarGrab() {
  if (GR.contando) return;
  try {
    const aislar = leer('dg-aislar') !== '0';
    const flujo = await navigator.mediaDevices.getUserMedia({audio: aislar
      ? {noiseSuppression: true, echoCancellation: true, autoGainControl: true, voiceIsolation: true, channelCount: 1}
      : {noiseSuppression: false, echoCancellation: false, autoGainControl: false, channelCount: 1}});
    $('#texto').scrollTop = 0; enfocar();
    GR.contando = true;
    const seguir = await cuentaAtras();
    GR.contando = false;
    if (!seguir) { flujo.getTracks().forEach((t) => t.stop()); return; }
    const tipo = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '');
    GR.ext = tipo.startsWith('audio/mp4') ? 'm4a' : 'webm';
    GR.rec = new MediaRecorder(flujo, tipo ? {mimeType: tipo, audioBitsPerSecond: 192000} : undefined);
    GR.trozos = [];
    GR.rec.ondataavailable = (e) => e.data.size && GR.trozos.push(e.data);
    GR.rec.onstop = () => {
      flujo.getTracks().forEach((t) => t.stop());
      $('#prompter').classList.remove('grabando');
      if (GR.rec._descartar) return;
      GR.blob = new Blob(GR.trozos, {type: GR.rec.mimeType || 'audio/mp4'});
      $('#escucha').src = URL.createObjectURL(GR.blob);
      modoPrompter('revisar');
    };
    GR.marcas = []; $('#corteN').textContent = '0';
    GR.rec.start(1000);
    GR.t0 = Date.now();
    $('#prompter').classList.add('grabando');
    $('#rec').classList.add('on'); $('#reloj').classList.add('on');
    GR.reloj = setInterval(() => { const s = Math.floor((Date.now() - GR.t0) / 1000); $('#reloj').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 250);
    avanzarTexto();
    try { GR.wake = await navigator.wakeLock?.request('screen'); } catch (e) {}
  } catch (e) {
    GR.contando = false; $('#cuenta').classList.add('oculto');
    const n = e && e.name;
    aviso(n === 'NotAllowedError' ? '🎙️ Permiso de micrófono negado. iPhone: Ajustes → Safari → Micrófono → Permitir.'
      : !navigator.mediaDevices ? '🎙️ Este navegador no deja grabar aquí. Abre el panel en Safari.'
      : `🎙️ No pude grabar (${n || 'error'}: ${(e && e.message) || ''})`, 7000);
  }
}
function pararGrab(descartar = false) {
  clearInterval(GR.reloj); cancelAnimationFrame(GR.scroll);
  $('#rec').classList.remove('on'); $('#reloj').classList.remove('on');
  if (GR.rec && GR.rec.state !== 'inactive') { GR.rec._descartar = descartar; GR.rec.stop(); }
  soltarPant();
}
function soltarPant() { try { GR.wake?.release(); } catch (e) {} GR.wake = null; }
function aviso(txt, ms = 3000) { const t = document.createElement('div'); t.className = 'toast'; t.style.zIndex = 70; t.innerHTML = txt; document.body.appendChild(t); setTimeout(() => t.remove(), ms); }

// ---------- envío (con confirmación) ----------
const aB64 = (b) => new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = mal; r.readAsDataURL(b); });
const durAudio = (b) => new Promise((ok) => { const a = new Audio(); a.preload = 'metadata'; a.onloadedmetadata = () => ok(isFinite(a.duration) ? a.duration : 0); a.onerror = () => ok(0); a.src = URL.createObjectURL(b); });
const selloT = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

function confirmar(seg) {
  const g = GR.actual;
  const largo = seg ? `${Math.floor(seg / 60)}:${String(Math.round(seg % 60)).padStart(2, '0')}` : '';
  $('#confCont').innerHTML = `<div style="font-size:40px">📤</div><b style="font-size:19px">¿Enviar a la PC?</b>
    <div class="gr-conf-dato">${g ? (g.canal === 'Delgafutbol' ? '⚽ ' : '⚡ ') + esc(g.tema) : '📁 Audio suelto → _entrada'}</div>
    ${largo ? `<div class="gr-conf-dato">⏱️ ${largo}</div>` : ''}
    ${seg && seg < 3 ? '<div class="gr-conf-alerta">⚠️ Dura menos de 3 s. ¿Fue un toque por error?</div>' : ''}`;
  $('#confirmar').classList.remove('oculto');
  return new Promise((ok) => { $('#confSi').onclick = () => { $('#confirmar').classList.add('oculto'); ok(true); }; $('#confNo').onclick = () => { $('#confirmar').classList.add('oculto'); ok(false); }; });
}

async function enviarAudio() {
  if (!GR.blob) return;
  if (!(await confirmar(await durAudio(GR.blob)))) return;
  const g = GR.actual;
  const nombre = `${g ? g.id.replace(/\//g, '__') : '_entrada'}@@${selloT()}.${GR.ext}`;
  const b = $('#enviar'); b.disabled = true; b.textContent = 'Enviando…';
  try {
    const r = await fetch(`${BUZON}/entrada/${encodeURIComponent(nombre)}`, {method: 'PUT', headers: hdr({'Content-Type': 'application/json'}), body: JSON.stringify({message: `Audio: ${g ? g.tema : 'suelto'}`, content: await aB64(GR.blob)})});
    if (!r.ok) throw new Error(r.status);
    if (GR.marcas.length && !(GR.blob instanceof File)) {
      try { await ponerBuzon(`entrada/${nombre.replace(/\.[^.]+$/, '')}.marcas.json`, JSON.stringify({marcas: GR.marcas, nota: 'segundos desde que empezó a grabar: ahí dijo «me equivoqué»'}), 'Marcas de corte'); } catch (e) {}
    }
    GR.enviados.unshift({tema: g ? g.tema : 'Audio suelto', cuando: new Date().toISOString()});
    GR.enviados = GR.enviados.slice(0, 10); guardar('dg-enviados', JSON.stringify(GR.enviados));
    GR.blob = null;
    $('#prompter').classList.add('oculto'); document.body.style.overflow = '';
    if (typeof confeti === 'function') try { confeti(); } catch (e) {}
    aviso('✔ Enviado · en ≤ 3 min estará en su carpeta', 4000);
    pintar();
  } catch (e) { aviso('✖ No se pudo enviar (' + e.message + '). Revisa la conexión.', 4500); }
  b.disabled = false; b.textContent = 'Enviar a la PC ➜';
}

// ---------- eventos ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-guion],#grSuelto,#grLibre');
  if (!t) return;
  if (t.id === 'grLibre') { abrirPrompter(null); return; }
  if (t.id === 'grSuelto') { GR.actual = null; $('#archivo').click(); return; }
  abrirPrompter(GR.lista[+t.dataset.guion]);
});
$('#cerrarP').addEventListener('click', cerrarPrompter);
$('#rec').addEventListener('click', () => (GR.rec && GR.rec.state === 'recording' ? pararGrab() : empezarGrab()));
$('#repetir').addEventListener('click', () => { GR.blob = null; $('#reloj').textContent = '0:00'; $('#texto').scrollTop = 0; modoPrompter('grabar'); requestAnimationFrame(() => { ajustarZona(); enfocar(); }); });
$('#enviar').addEventListener('click', enviarAudio);
$('#arriba').addEventListener('click', () => { $('#texto').scrollTop = 0; enfocar(); });
const cambiarVel = (d) => { guardar('dg-vel', Math.max(1, Math.min(10, VEL() + d))); pintarVel(); };
$('#velMenos').addEventListener('click', () => cambiarVel(-1));
$('#velMas').addEventListener('click', () => cambiarVel(1));
$('#texto').addEventListener('scroll', () => requestAnimationFrame(enfocar), {passive: true});
addEventListener('resize', () => { if (!$('#prompter').classList.contains('oculto')) { ajustarZona(); enfocar(); } });
$('#aislar').addEventListener('click', () => { if (GR.rec && GR.rec.state === 'recording') return aviso('Cámbialo antes de grabar'); guardar('dg-aislar', leer('dg-aislar') === '0' ? '1' : '0'); pintarAislar(); });
const tamTexto = (d) => { const n = Math.max(20, Math.min(48, (+leer('dg-tam') || 32) + d)); guardar('dg-tam', n); $('#texto').style.setProperty('--tam', n + 'px'); requestAnimationFrame(enfocar); };
$('#menos').addEventListener('click', () => tamTexto(-2));
$('#mas').addEventListener('click', () => tamTexto(2));
$('#subirArchivo').addEventListener('click', () => $('#archivo').click());
$('#archivo').addEventListener('change', (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  GR.blob = f; const m = /\.([a-z0-9]+)$/i.exec(f.name); GR.ext = m ? m[1].toLowerCase() : 'm4a';
  if ($('#prompter').classList.contains('oculto')) abrirPrompter(GR.actual);
  $('#escucha').src = URL.createObjectURL(f);
  modoPrompter('revisar');
});


// ================================================================== PRODUCCIÓN, REVISIÓN Y APROBACIÓN
const ETAPAS = {guion: ['📝', 'Guion', 'por grabar'], editando: ['🎬', 'Editando', 'Claude lo está haciendo'], revisar: ['👀', 'Revisar', 'listo para que lo apruebes'], publicado: ['✅', 'Publicado', '']};
const porRevisar = () => ((GR.estado && GR.estado.produccion) || []).filter((p) => p.etapa === 'revisar');

function tarjetaRevisar(enGrabar) {
  const lista = porRevisar();
  if (!lista.length) return '';
  return `<div class="card gr-revisar"><h3>👀 Para revisar <small>${lista.length} video${lista.length > 1 ? 's' : ''} listo${lista.length > 1 ? 's' : ''}</small></h3>
    ${lista.map((p) => { const ap = GR.aprobados[p.id]; return `<button class="gr-rev" data-revisar="${esc(p.id)}">
      <span class="gr-rev-ico">${p.canal === 'Delgafutbol' ? '⚽' : '⚡'}</span>
      <span class="gr-rev-t"><b>${esc(p.tema)}</b><small>${ap ? (ap === 'publicar' ? '✔ Aprobado · publicándose…' : '✏️ Cambios pedidos') : `${p.duracion ? Math.round(p.duracion) + ' s · ' : ''}toca para ver y aprobar`}</small></span>
      <span class="gr-ir">${ap ? '⏳' : 'Ver'}</span></button>`; }).join('')}
    ${enGrabar ? '' : ''}</div>`;
}

function tableroProduccion() {
  const prod = (GR.estado && GR.estado.produccion) || [];
  if (!prod.length) return '';
  const filas = prod.slice(0, 10).map((p) => {
    const [ico, nom, sub] = ETAPAS[p.etapa] || ['•', p.etapa, ''];
    const tt = p.etapa === 'publicado' && p.tiktok_pendiente ? ' · TikTok en cola' : '';
    return `<div class="gr-prod ${p.etapa}"><span class="gr-prod-ico">${ico}</span><span class="gr-prod-t"><b>${esc(p.tema)}</b><small>${p.canal === 'Delgafutbol' ? '⚽' : '⚡'} ${nom}${sub ? ' · ' + sub : ''}${tt}</small></span></div>`;
  }).join('');
  const hoy = prod.filter((p) => p.etapa !== 'publicado').length;
  return `<div class="card"><h3>📋 Producción <small>${hoy} en curso</small></h3>
    <div class="gr-etapas">${['guion', 'editando', 'revisar', 'publicado'].map((e) => `<span class="${e}">${ETAPAS[e][0]} ${prod.filter((p) => p.etapa === e).length}</span>`).join('')}</div>${filas}</div>`;
}

const blobBuzon = async (ruta) => { const r = await fetch(`${BUZON}/${ruta}?t=${Date.now()}`, {headers: hdr({Accept: 'application/vnd.github.raw'}), cache: 'no-store'}); if (!r.ok) throw new Error(r.status); return URL.createObjectURL(await r.blob()); };

function abrirRevision(id) {
  const p = porRevisar().find((x) => x.id === id);
  if (!p) return;
  $('#hojaCont').innerHTML = `<div class="rev">
    <div class="etq">${p.canal === 'Delgafutbol' ? '⚽ Delgafutbol' : '⚡ Delgatronics'} · para revisar</div>
    <h2 style="margin:6px 0 12px;font-size:20px">${esc(p.tema)}</h2>
    <div class="rev-medios"><div class="rev-video"><div class="rev-cargando">⏳ Cargando video…</div><video id="revVideo" controls playsinline preload="metadata" class="oculto"></video></div>
      <div class="rev-mini"><div class="etq">Miniatura</div><img id="revMini" alt=""></div></div>
    <div class="rev-campo"><div class="etq">Título (YouTube)</div><div>${esc(p.titulo)}</div></div>
    <div class="rev-campo"><div class="etq">Texto para TikTok</div><div>${esc(p.tiktok)}</div></div>
    ${p.descripcion ? `<details class="rev-campo"><summary class="etq">Descripción de YouTube</summary><div style="white-space:pre-wrap;font-size:13px;color:var(--suave)">${esc(p.descripcion)}</div></details>` : ''}
    ${p.cambios ? `<div class="aviso">✏️ Ya pediste: ${esc(p.cambios)}</div>` : ''}
    <div id="revAcciones">
      <button class="btn" id="revPublicar" style="width:100%;background:var(--verde);margin-top:6px">✔ Publicar en YouTube y TikTok</button>
      <button class="btn sec" id="revCambios" style="width:100%;margin-top:10px">✏️ Pedir cambios</button>
    </div>
    <div id="revNota" class="oculto"><textarea id="revTexto" rows="4" placeholder="Ej.: el título más corto, la miniatura con otra foto, quitar la parte del…"></textarea>
      <button class="btn" id="revEnviarCambios" style="width:100%;margin-top:10px">Enviar cambios</button></div>
  </div>`;
  $('#hoja').scrollTop = 0;
  $('#velo').classList.add('on'); $('#hoja').classList.add('on');
  blobBuzon(p.previa).then((u) => { const v = $('#revVideo'); if (!v) return; v.src = u; v.classList.remove('oculto'); $('.rev-cargando')?.remove(); }).catch(() => { const c = $('.rev-cargando'); if (c) c.textContent = 'No pude cargar la previa (aún se está subiendo). Prueba en un minuto.'; });
  blobBuzon(p.miniatura).then((u) => { const i = $('#revMini'); if (i) i.src = u; }).catch(() => {});
  $('#revPublicar').onclick = async () => {
    const ok = await confirmarSimple('¿Publicar ahora?', `«${p.tema}» saldrá en YouTube y TikTok.`, 'Sí, publicar');
    if (ok) enviarAprobacion(p, 'publicar', '');
  };
  $('#revCambios').onclick = () => { $('#revAcciones').classList.add('oculto'); $('#revNota').classList.remove('oculto'); $('#revTexto').focus(); };
  $('#revEnviarCambios').onclick = () => { const n = $('#revTexto').value.trim(); if (!n) return $('#revTexto').focus(); enviarAprobacion(p, 'cambios', n); };
}

async function enviarAprobacion(p, accion, nota) {
  try {
    await ponerBuzon(`aprobaciones/${p.id.replace(/\//g, '__')}@@${selloT()}.json`, JSON.stringify({id: p.id, accion, nota, cuando: new Date().toISOString()}), `Aprobación: ${accion}`);
    GR.aprobados[p.id] = accion; guardar('dg-aprobados', JSON.stringify(GR.aprobados));
    $('#velo').classList.remove('on'); $('#hoja').classList.remove('on');
    aviso(accion === 'publicar' ? '✔ Aprobado · la PC lo publica en YouTube en ≤ 3 min' : '✏️ Cambios enviados · los aplico al abrir Claude', 4500);
    if (accion === 'publicar' && typeof confeti === 'function') try { confeti(); } catch (e) {}
    pintar();
  } catch (e) { aviso('✖ No se pudo enviar (' + e.message + ')', 4000); }
}

const utf8B64 = (s) => btoa(unescape(encodeURIComponent(s)));
async function ponerBuzon(ruta, texto, mensaje) {
  const r = await fetch(`${BUZON}/${ruta.split('/').map(encodeURIComponent).join('/')}`, {method: 'PUT', headers: hdr({'Content-Type': 'application/json'}), body: JSON.stringify({message: mensaje, content: utf8B64(texto)})});
  if (!r.ok) throw new Error(r.status);
}

function confirmarSimple(titulo, texto, si) {
  $('#confCont').innerHTML = `<div style="font-size:40px">❓</div><b style="font-size:19px">${esc(titulo)}</b><div class="gr-conf-dato">${esc(texto)}</div>`;
  $('#confSi').textContent = si; $('#confirmar').classList.remove('oculto');
  return new Promise((ok) => { $('#confSi').onclick = () => { $('#confirmar').classList.add('oculto'); $('#confSi').textContent = 'Sí, enviar'; ok(true); }; $('#confNo').onclick = () => { $('#confirmar').classList.add('oculto'); $('#confSi').textContent = 'Sí, enviar'; ok(false); }; });
}

// ================================================================== AVISOS (push)
const pushPosible = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function bannerAvisos() {
  if (!pushPosible()) return (navigator.standalone === false || /iPhone|iPad/.test(navigator.userAgent)) && !matchMedia('(display-mode: standalone)').matches
    ? `<div class="card gr-avisos"><b>🔔 Avisos</b><span>Para recibir avisos abre el panel desde el icono de tu pantalla de inicio.</span></div>` : '';
  if (Notification.permission === 'granted' && leer('dg-push') === '1') return '';
  if (Notification.permission === 'denied') return `<div class="card gr-avisos"><b>🔕 Avisos bloqueados</b><span>Actívalos en Ajustes → Notificaciones → Delga Panel.</span></div>`;
  return `<button class="card gr-avisos" id="activarAvisos"><b>🔔 Activar avisos</b><span>Te aviso cuando haya un guion nuevo, un video listo para revisar o si hoy aún no grabas.</span></button>`;
}
const b64aBytes = (b) => { const p = '='.repeat((4 - (b.length % 4)) % 4); const s = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
async function activarAvisos() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { aviso('Sin permiso no puedo avisarte 🔕'); pintar(); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: b64aBytes(VAPID)}));
    const j = sub.toJSON();
    const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(j.endpoint)))).slice(0, 8).map((x) => x.toString(16).padStart(2, '0')).join('');
    await ponerBuzon(`suscripciones/${h}.json`, JSON.stringify(j), 'Suscripción a avisos');
    guardar('dg-push', '1');
    aviso('🔔 Avisos activados', 3500);
    pintar();
  } catch (e) { aviso('No pude activar los avisos: ' + (e.message || e), 5000); }
}

// ================================================================== COMENTARIOS (responder desde el panel)
function tarjetaComentarios(cs) {
  const resp = new Set([...(GR.estado.respondidos || []), ...GR.respondidos]);
  const coms = cs.filter((c) => c.plataforma === 'youtube').flatMap((c) => (c.comentarios || []).map((x) => ({...x, c})))
    .filter((x) => x.id && !resp.has(x.id) && !(x.respuestas > 0)).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 5);
  if (!coms.length) return '';
  const tit = (x) => { const v = x.c.videos.find((v) => v.id === x.video); return v ? corta(v.titulo, 40) : ''; };
  return `<div class="card"><h3>💬 Por responder <small>${coms.length} comentario${coms.length > 1 ? 's' : ''} · YouTube</small></h3>
    ${coms.map((x) => `<div class="gr-com"><div class="gr-com-cab"><b>${esc(x.autor)}</b><span>${esc(x.c.nombre)} · ${hace(x.fecha)}</span></div>
      <div class="gr-com-t">${esc(x.texto)}</div><div class="gr-com-v">🎬 ${esc(tit(x))}</div>
      <div class="gr-com-r"><input type="text" placeholder="Responder como ${esc(x.c.nombre)}…" data-resp="${esc(x.c.id)}|${esc(x.id)}"><button class="pbtn" data-enviar-resp="${esc(x.c.id)}|${esc(x.id)}">➤</button></div></div>`).join('')}
    <div class="hoy-sub" style="margin-top:8px">Responder rápido hace que vuelvan y te sigan. La PC lo publica en ≤ 3 min.</div></div>`;
}
async function enviarRespuesta(clave) {
  const [canal, id] = clave.split('|');
  const inp = document.querySelector(`[data-resp="${CSS.escape(clave)}"]`);
  const texto = inp && inp.value.trim();
  if (!texto) return inp && inp.focus();
  try {
    await ponerBuzon(`respuestas/${id}.json`, JSON.stringify({canal, comentario: id, texto}), 'Respuesta a comentario');
    GR.respondidos.push(id); guardar('dg-respondidos', JSON.stringify(GR.respondidos.slice(-300)));
    aviso('✔ Respuesta enviada · se publica en ≤ 3 min', 3500);
    pintar();
  } catch (e) { aviso('✖ No se pudo enviar (' + e.message + ')', 4000); }
}

// ================================================================== ¿QUÉ VIDEO ME TRAJO SEGUIDORES?
function tarjetaSeguidoresVideo(cs) {
  const vids = cs.filter((c) => c.plataforma === 'youtube').flatMap((c) => c.videos).filter((v) => (v.subs || 0) > 0).sort((a, b) => b.subs - a.subs).slice(0, 6);
  if (!vids.length) return '';
  const max = vids[0].subs;
  const total = vids.reduce((s, v) => s + v.subs, 0);
  return `<div class="card"><h3>🧲 ¿Qué video me trajo seguidores? <small>YouTube · 28 días</small></h3>
    ${vids.map((v) => `<button class="fila-ret" data-video="${esc(v.canal.id)}|${esc(v.id)}"><span class="ret ok" style="min-width:58px">+${v.subs}</span>
      <span class="t">${esc(corta(v.titulo, 46))}<span class="gr-barra"><i style="width:${Math.round((v.subs / max) * 100)}%;background:${v.canal.color}"></i></span></span></button>`).join('')}
    <div class="leyenda">Estos ${vids.length} videos trajeron ${total} seguidores. Repite su tipo de gancho y de tema.</div></div>`;
}

// ---------- eventos extra ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-revisar],#activarAvisos,[data-enviar-resp],#corte');
  if (!t) return;
  if (t.dataset.revisar) return abrirRevision(t.dataset.revisar);
  if (t.id === 'activarAvisos') return activarAvisos();
  if (t.dataset.enviarResp) return enviarRespuesta(t.dataset.enviarResp);
  if (t.id === 'corte') {
    if (!(GR.rec && GR.rec.state === 'recording')) return;
    const s = Math.round((Date.now() - GR.t0) / 100) / 10;
    GR.marcas.push(s);
    $('#corteN').textContent = GR.marcas.length;
    t.classList.remove('pum'); void t.offsetWidth; t.classList.add('pum');
    if (navigator.vibrate) navigator.vibrate(40);
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset && e.target.dataset.resp) enviarRespuesta(e.target.dataset.resp); });

marcarPendientes();
