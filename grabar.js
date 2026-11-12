'use strict';
// Pestaña «Grabar» del Delga Panel: guiones pendientes → teleprompter → grabar → confirmar → buzón privado → la PC lo baja a su carpeta.
// El acceso al buzón viene dentro de los datos cifrados del panel (D.buzon); no hay que pegar nada.

const BUZON = 'https://api.github.com/repos/wuilkindelgado-cell/delga-buzon/contents';
const GR = {lista: JSON.parse(leer('dg-cache') || '[]'), cargado: 0, cargando: false, error: '', actual: null, rec: null, trozos: [], blob: null, ext: 'm4a', t0: 0, reloj: 0, scroll: 0, wake: null, enviados: JSON.parse(leer('dg-enviados') || '[]')};
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
    GR.error = ''; GR.cargado = Date.now();
  } catch (e) { GR.error = 'red'; }
  GR.cargando = false;
  marcarPendientes();
  if (E.tab === 'grabar' && $('#prompter').classList.contains('oculto')) pintar();
}
function marcarPendientes() {
  const b = $('nav .navrec .burbuja');
  if (b) { b.textContent = GR.lista.length; b.style.display = GR.lista.length ? '' : 'none'; }
}

function vGrabar() {
  cargarGuiones();
  let h = '';
  if (GR.error === 'sin-acceso') h += `<div class="card"><h3>🔒 Falta el acceso al buzón</h3><div class="vacio">Toca ↻ arriba en unos minutos: la PC lo está agregando a tus datos.</div></div>`;
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
  if (GR.enviados.length) h += `<div class="card"><h3>📤 Enviados</h3>${GR.enviados.slice(0, 5).map((x) => `<div class="hoy-fila"><span>${esc(x.tema)}</span><span class="hoy-sub">${hace(x.cuando)}</span></div>`).join('')}<div class="hoy-sub" style="margin-top:8px">La PC los baja a su carpeta en ≤ 3 min.</div></div>`;
  return h;
}

// ---------- teleprompter ----------
const fmtLinea = (l) => esc(l)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\s*\/\/\s*/g, ' <span class="pz1">⏸</span><span class="pz2"></span>')
  .replace(/\s+\/\s+/g, ' <span class="pz1">·</span> ')
  .replace(/\s*\/\s*$/g, ' <span class="pz1">·</span>');

function abrirPrompter(g) {
  GR.actual = g;
  $('#pTitulo').textContent = g ? g.tema : 'Audio suelto';
  $('#texto').innerHTML = g ? g.lineas.map((l) => `<p>${fmtLinea(l)}</p>`).join('') : '<p style="color:var(--suave)">Grabación libre, sin guion.<br><br>Toca el botón rojo ⏺ de abajo para empezar y otra vez para parar. Irá a la carpeta _entrada de la PC.</p>';
  $('#texto').style.setProperty('--tam', (leer('dg-tam') || 30) + 'px');
  $('#vel').value = leer('dg-vel') || 3;
  $('#texto').scrollTop = 0;
  $('#reloj').textContent = '0:00';
  pintarAislar();
  modoPrompter('grabar');
  $('#prompter').classList.remove('oculto');
  document.body.style.overflow = 'hidden';
}
function cerrarPrompter() {
  if (GR.rec && GR.rec.state === 'recording') { if (!confirm('¿Descartar la grabación en curso?')) return; pararGrab(true); }
  $('#prompter').classList.add('oculto');
  document.body.style.overflow = '';
  soltarPant();
}
function modoPrompter(m) { $('#modoGrabar').classList.toggle('oculto', m !== 'grabar'); $('#modoRevisar').classList.toggle('oculto', m !== 'revisar'); }
function avanzarTexto() {
  cancelAnimationFrame(GR.scroll);
  let ult = performance.now();
  const paso = (ahora) => { $('#texto').scrollTop += +$('#vel').value * 9 * ((ahora - ult) / 1000); ult = ahora; GR.scroll = requestAnimationFrame(paso); };
  GR.scroll = requestAnimationFrame(paso);
}
const pintarAislar = () => { const on = leer('dg-aislar') !== '0'; const b = $('#aislar'); b.textContent = on ? '🎧 Aislar ruido: SÍ' : '🎙️ Aislar ruido: NO'; b.classList.toggle('on', on); };

async function empezarGrab() {
  try {
    const aislar = leer('dg-aislar') !== '0';
    const flujo = await navigator.mediaDevices.getUserMedia({audio: aislar
      ? {noiseSuppression: true, echoCancellation: true, autoGainControl: true, voiceIsolation: true, channelCount: 1}
      : {noiseSuppression: false, echoCancellation: false, autoGainControl: false, channelCount: 1}});
    const tipo = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '');
    GR.ext = tipo.startsWith('audio/mp4') ? 'm4a' : 'webm';
    GR.rec = new MediaRecorder(flujo, tipo ? {mimeType: tipo, audioBitsPerSecond: 192000} : undefined);
    GR.trozos = [];
    GR.rec.ondataavailable = (e) => e.data.size && GR.trozos.push(e.data);
    GR.rec.onstop = () => {
      flujo.getTracks().forEach((t) => t.stop());
      if (GR.rec._descartar) return;
      GR.blob = new Blob(GR.trozos, {type: GR.rec.mimeType || 'audio/mp4'});
      $('#escucha').src = URL.createObjectURL(GR.blob);
      modoPrompter('revisar');
    };
    GR.rec.start(1000);
    GR.t0 = Date.now();
    $('#rec').classList.add('on'); $('#reloj').classList.add('on');
    GR.reloj = setInterval(() => { const s = Math.floor((Date.now() - GR.t0) / 1000); $('#reloj').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 250);
    $('#texto').scrollTop = 0;
    avanzarTexto();
    try { GR.wake = await navigator.wakeLock?.request('screen'); } catch (e) {}
  } catch (e) {
    const n = e && e.name;
    aviso(n === 'NotAllowedError' ? '🎙️ Permiso de micrófono negado. iPhone: Ajustes → Safari → Micrófono → Permitir (o borra y vuelve a agregar el panel).'
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
$('#repetir').addEventListener('click', () => { GR.blob = null; $('#reloj').textContent = '0:00'; $('#texto').scrollTop = 0; modoPrompter('grabar'); });
$('#enviar').addEventListener('click', enviarAudio);
$('#arriba').addEventListener('click', () => ($('#texto').scrollTop = 0));
$('#vel').addEventListener('input', (e) => guardar('dg-vel', e.target.value));
$('#aislar').addEventListener('click', () => { if (GR.rec && GR.rec.state === 'recording') return aviso('Cámbialo antes de grabar'); guardar('dg-aislar', leer('dg-aislar') === '0' ? '1' : '0'); pintarAislar(); });
const tamTexto = (d) => { const n = Math.max(20, Math.min(48, (+leer('dg-tam') || 30) + d)); guardar('dg-tam', n); $('#texto').style.setProperty('--tam', n + 'px'); };
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
marcarPendientes();
