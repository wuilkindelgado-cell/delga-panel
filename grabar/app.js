// Delga Grabar: teleprompter + grabadora que envía el audio al buzón privado (GitHub) → la PC lo baja a la carpeta del video.
const REPO = 'wuilkindelgado-cell/delga-buzon';
const API = `https://api.github.com/repos/${REPO}/contents`;
const $ = (s) => document.querySelector(s);
const leer = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const guardar = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

let G = [];          // guiones
let actual = null;   // guion abierto (null = audio suelto)
let grabadora = null, trozos = [], blob = null, ext = 'm4a', t0 = 0, relojId = 0, scrollId = 0, wake = null;

const toast = (txt, ms = 2600) => { const t = $('#toast'); t.innerHTML = txt; t.classList.remove('oculto'); clearTimeout(toast.id); toast.id = setTimeout(() => t.classList.add('oculto'), ms); };
const h = () => ({Authorization: `Bearer ${leer('dg-token')}`, Accept: 'application/vnd.github+json'});

async function cargar() {
  if (!leer('dg-token')) { $('#config').classList.remove('oculto'); $('#lista').innerHTML = ''; $('#extra').classList.add('oculto'); return; }
  $('#config').classList.add('oculto');
  $('#sub').textContent = 'Cargando…';
  try {
    const r = await fetch(`${API}/guiones.json?t=${Date.now()}`, {headers: {...h(), Accept: 'application/vnd.github.raw'}, cache: 'no-store'});
    if (r.status === 401 || r.status === 403 || r.status === 404) throw new Error('token');
    const d = await r.json();
    G = d.guiones || [];
    guardar('dg-cache', JSON.stringify(G));
    $('#sub').textContent = `${G.length} guion${G.length === 1 ? '' : 'es'} por grabar`;
  } catch (e) {
    if (e.message === 'token') { guardar('dg-token', null); $('#errToken').textContent = 'El token no funciona. Pega uno nuevo.'; return cargar(); }
    G = JSON.parse(leer('dg-cache') || '[]');
    $('#sub').textContent = 'Sin conexión · guiones guardados';
  }
  pintar();
}

function pintar() {
  $('#extra').classList.remove('oculto');
  if (!G.length) { $('#lista').innerHTML = `<div class="vacio">🎉 No hay guiones pendientes.<br>Cuando Claude escriba uno nuevo aparece aquí.</div>`; return; }
  $('#lista').innerHTML = G.map((g, i) => `<button class="card guion" data-i="${i}"><span class="chip ${esc(g.canal)}">${g.canal === 'Delgafutbol' ? '⚽' : '⚡'} ${esc(g.canal)}</span><b>${esc(g.tema)}</b><span class="t">${esc(g.titulo)}</span><span class="t">🎙️ ${g.lineas.length} partes · toca para leer y grabar</span></button>`).join('');
}

// ---------- teleprompter ----------
const formato = (l) => esc(l)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\s*\/\/\s*/g, ' <span class="p1">⏸</span><span class="p2"></span>')
  .replace(/\s+\/\s+/g, ' <span class="p1">·</span> ')
  .replace(/\s*\/\s*$/g, ' <span class="p1">·</span>');

function abrir(g) {
  actual = g;
  $('#pTitulo').textContent = g ? g.tema : 'Audio suelto';
  $('#texto').innerHTML = g ? g.lineas.map((l) => `<p>${formato(l)}</p>`).join('') : '<p style="color:#8f9cc0">Graba o sube tu audio. Se guardará en la carpeta _entrada de la PC.</p>';
  $('#texto').style.setProperty('--tam', (leer('dg-tam') || 30) + 'px');
  $('#vel').value = leer('dg-vel') || 3;
  $('#texto').scrollTop = 0;
  modo('grabar');
  $('#prompter').classList.remove('oculto');
}
function cerrar() { if (grabadora && grabadora.state === 'recording') { if (!confirm('¿Descartar la grabación en curso?')) return; parar(true); } $('#prompter').classList.add('oculto'); soltarPantalla(); }
function modo(m) { $('#modoGrabar').classList.toggle('oculto', m !== 'grabar'); $('#modoRevisar').classList.toggle('oculto', m !== 'revisar'); }

function avanzar() {
  cancelAnimationFrame(scrollId);
  let ult = performance.now();
  const paso = (ahora) => {
    const v = +$('#vel').value;
    $('#texto').scrollTop += v * 9 * ((ahora - ult) / 1000);
    ult = ahora;
    scrollId = requestAnimationFrame(paso);
  };
  scrollId = requestAnimationFrame(paso);
}

// ---------- grabación ----------
async function empezar() {
  try {
    const flujo = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1}});
    const tipo = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '');
    ext = tipo.startsWith('audio/mp4') ? 'm4a' : 'webm';
    grabadora = new MediaRecorder(flujo, tipo ? {mimeType: tipo, audioBitsPerSecond: 192000} : undefined);
    trozos = [];
    grabadora.ondataavailable = (e) => e.data.size && trozos.push(e.data);
    grabadora.onstop = () => {
      flujo.getTracks().forEach((t) => t.stop());
      if (grabadora._descartar) return;
      blob = new Blob(trozos, {type: grabadora.mimeType || 'audio/mp4'});
      $('#escucha').src = URL.createObjectURL(blob);
      modo('revisar');
    };
    grabadora.start(1000);
    t0 = Date.now();
    $('#rec').classList.add('on'); $('#reloj').classList.add('on');
    relojId = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); $('#reloj').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 250);
    $('#texto').scrollTop = 0;
    avanzar();
    mantenerPantalla();
  } catch (e) {
    toast('No pude usar el micrófono. Revisa Ajustes → Safari → Micrófono.', 5000);
  }
}
function parar(descartar = false) {
  clearInterval(relojId); cancelAnimationFrame(scrollId);
  $('#rec').classList.remove('on'); $('#reloj').classList.remove('on');
  if (grabadora && grabadora.state !== 'inactive') { grabadora._descartar = descartar; grabadora.stop(); }
  soltarPantalla();
}
async function mantenerPantalla() { try { wake = await navigator.wakeLock?.request('screen'); } catch (e) {} }
function soltarPantalla() { try { wake?.release(); } catch (e) {} wake = null; }

// ---------- envío ----------
const b64 = (b) => new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = mal; r.readAsDataURL(b); });
function sello() { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }

async function enviar(archivo, extension) {
  const destino = actual ? actual.id.replace(/\//g, '__') : '_entrada';
  const nombre = `${destino}@@${sello()}.${extension}`;
  const btn = $('#enviar'); const txt = btn.textContent;
  btn.disabled = true; btn.textContent = 'Enviando…';
  toast('⏫ Enviando a la PC…', 60000);
  try {
    const r = await fetch(`${API}/entrada/${encodeURIComponent(nombre)}`, {
      method: 'PUT', headers: {...h(), 'Content-Type': 'application/json'},
      body: JSON.stringify({message: `Audio: ${actual ? actual.tema : 'suelto'}`, content: await b64(archivo)}),
    });
    if (!r.ok) throw new Error(r.status);
    toast('<span class="ok">✔ Enviado.</span> En unos minutos estará en su carpeta de la PC.', 4500);
    blob = null; $('#prompter').classList.add('oculto');
  } catch (e) {
    toast('✖ No se pudo enviar (' + e.message + '). Revisa tu conexión y vuelve a intentar.', 5000);
  } finally { btn.disabled = false; btn.textContent = txt; }
}

// ---------- eventos ----------
$('#lista').addEventListener('click', (e) => { const c = e.target.closest('.guion'); if (c) abrir(G[+c.dataset.i]); });
$('#recargar').addEventListener('click', cargar);
$('#cerrar').addEventListener('click', cerrar);
$('#rec').addEventListener('click', () => (grabadora && grabadora.state === 'recording' ? parar() : empezar()));
$('#repetir').addEventListener('click', () => { blob = null; $('#reloj').textContent = '0:00'; $('#texto').scrollTop = 0; modo('grabar'); });
$('#enviar').addEventListener('click', () => blob && enviar(blob, ext));
$('#arriba').addEventListener('click', () => ($('#texto').scrollTop = 0));
$('#vel').addEventListener('input', (e) => guardar('dg-vel', e.target.value));
const tam = (d) => { const n = Math.max(20, Math.min(48, (+leer('dg-tam') || 30) + d)); guardar('dg-tam', n); $('#texto').style.setProperty('--tam', n + 'px'); };
$('#menos').addEventListener('click', () => tam(-2));
$('#mas').addEventListener('click', () => tam(2));
$('#subirArchivo').addEventListener('click', () => $('#archivo').click());
$('#subirSuelto').addEventListener('click', () => { abrir(null); $('#archivo').click(); });
$('#archivo').addEventListener('change', (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  blob = f;
  const m = /\.([a-z0-9]+)$/i.exec(f.name); ext = m ? m[1].toLowerCase() : 'm4a';
  $('#escucha').src = URL.createObjectURL(f);
  modo('revisar');
  toast(`📎 ${esc(f.name)} · escúchalo y toca «Enviar»`);
});
$('#guardarToken').addEventListener('click', () => { const v = $('#token').value.trim(); if (!v) return; guardar('dg-token', v); $('#errToken').textContent = ''; $('#token').value = ''; cargar(); });
$('#desconectar').addEventListener('click', () => { if (confirm('¿Quitar el acceso de este celular?')) { guardar('dg-token', null); cargar(); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && $('#prompter').classList.contains('oculto')) cargar(); });

// Conexión por QR: la PC muestra un QR con …/grabar/#t=<token>. En iOS la app de inicio no comparte datos con Safari,
// así que además se ofrece copiar el token para pegarlo una vez dentro de la app instalada.
const enInicio = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
if (location.hash.startsWith('#t=')) {
  const tk = decodeURIComponent(location.hash.slice(3));
  history.replaceState(null, '', location.pathname);
  guardar('dg-token', tk);
  if (!enInicio) {
    document.body.insertAdjacentHTML('afterbegin', `<div class="card" id="pasoQR" style="border-color:var(--verde)">
      <b class="ok">✔ Conectado</b>
      <p style="font-size:14px;line-height:1.5;color:var(--suave)">Para usarla como app: <b>1.</b> toca «Copiar acceso». <b>2.</b> Compartir <span style="font-size:18px">⎋</span> → <b>Agregar a inicio</b>. <b>3.</b> Ábrela desde el icono 🎙️ y pega el acceso (solo esta vez).</p>
      <button class="btn verde" id="copiarTk">Copiar acceso</button></div>`);
    $('#copiarTk').addEventListener('click', async () => { try { await navigator.clipboard.writeText(tk); toast('✔ Copiado. Ahora: Compartir → Agregar a inicio'); } catch (e) { prompt('Copia este acceso:', tk); } });
  }
} else if (!enInicio && !leer('dg-aviso-inicio')) {
  document.body.insertAdjacentHTML('afterbegin', `<div class="card" style="font-size:14px;color:var(--suave)">💡 Agrégala a la pantalla de inicio: Compartir → <b>Agregar a inicio</b>.</div>`);
  guardar('dg-aviso-inicio', '1');
}
$('#token').addEventListener('paste', () => setTimeout(() => $('#guardarToken').click(), 50));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
cargar();
