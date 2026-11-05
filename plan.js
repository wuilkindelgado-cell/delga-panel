'use strict';
// Delga Panel v3 — pestaña Plan, gestos de app nativa, confeti y animaciones (se carga después de app.js).

const DIAS_L = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIAS_N = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const lunesDe = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const claveSemana = (d = new Date()) => { const l = lunesDe(d); return `${l.getFullYear()}-${l.getMonth() + 1}-${l.getDate()}`; };
const leerJSON = (k, def) => { try { return JSON.parse(leer(k) || 'null') ?? def; } catch (e) { return def; } };

const horaDe = (p, d) => (p.horarios && p.horarios[d] != null ? p.horarios[d] : p.hora || 15);
function tareasSemana() {
  const p = D.plan || {};
  const hoy = (new Date().getDay() + 6) % 7, hh = (d) => `${String(horaDe(p, d)).padStart(2, '0')}:00`;
  const t = [];
  for (let d = hoy; d < 7; d++) {
    const prueba = p.origen && p.origen[d] === 'prueba';
    t.push({id: 'sale' + d, dia: d, h: hh(d), txt: `🚀 Sale el video · responde comentarios 1 h${prueba ? ' · 🧪 hora de prueba' : ''}`});
  }
  t.push({id: 'sab-temas', dia: 5, h: '18:00', txt: '📝 Elegir los 7 temas y pedir los guiones'});
  t.push({id: 'dom-grabar', dia: 6, h: '10:00', txt: '🎙️ Grabar los 7 audios'});
  t.push({id: 'dom-aprobar', dia: 6, h: '16:00', txt: '✅ Revisar y aprobar los 7 videos'});
  t.push({id: 'dom-tiktok', dia: 6, h: '18:00', txt: '📅 Programar los 7 TikToks (YouTube lo programa Claude)'});
  return t.filter((x) => x.dia >= hoy).sort((x, y) => x.dia - y.dia || x.h.localeCompare(y.h));
}

function vPlan() {
  const p = D.plan || {dias: [0, 1, 2, 3, 4, 5, 6], destacados: [3, 6], hora: 15, franja: 'tarde'};
  const vids = D.ok.flatMap((c) => c.videos).filter((v) => (v.privacidad || 'public') === 'public');
  const lunes = lunesDe(new Date()), hoyIdx = (new Date().getDay() + 6) % 7;
  const deEstaSemana = vids.filter((v) => new Date(v.publicado) >= lunes);
  const metaSem = Number(leer('dp-meta-semana2') || 7);
  const pubYT = deEstaSemana.filter((v) => v.canal.plataforma === 'youtube').length, pubTT = deEstaSemana.length - pubYT;
  const diasPub = new Set(deEstaSemana.map((v) => new Date(v.publicado).toDateString())).size;
  // racha de semanas seguidas publicando
  const semanas = new Set(vids.map((v) => claveSemana(new Date(v.publicado))));
  let racha = 0;
  const cur = new Date(lunes);
  if (!semanas.has(claveSemana(cur))) cur.setDate(cur.getDate() - 7);
  while (semanas.has(claveSemana(cur))) { racha++; cur.setDate(cur.getDate() - 7); }
  let sem = '';
  for (let i = 0; i < 7; i++) {
    const dia = new Date(lunes); dia.setDate(dia.getDate() + i);
    const pub = deEstaSemana.some((v) => new Date(v.publicado).toDateString() === dia.toDateString());
    sem += `<div class="${i === hoyIdx ? 'hoy ' : ''}${pub ? 'pub' : i >= hoyIdx ? 'plan' : ''}">${DIAS_L[i]}<b>${dia.getDate()}</b>${pub ? '✓' : i < hoyIdx ? '✗' : horaDe(p, i) + 'h'}</div>`;
  }
  let h = `<div class="card hero"><h3>🗓 Esta semana <small>${pubYT} en YouTube · ${pubTT} en TikTok</small></h3>
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px">
      <div><div class="etq">Días con publicación</div><div class="grande num">${diasPub}<span style="font-size:22px;color:var(--suave)"> / ${metaSem}</span></div></div>
      <div style="text-align:right"><div class="etq">Racha</div><div class="racha">${racha ? '🔥' + racha : '—'}</div><div style="color:var(--suave);font-size:12px">${racha === 1 ? 'semana seguida' : racha ? 'semanas seguidas' : 'publica para empezar'}</div></div>
    </div>
    <div class="progreso"><i style="width:${Math.min(100, (diasPub / metaSem) * 100)}%"></i></div>
    <div class="semana">${sem}</div>
    <div class="chips" style="margin:10px 0 0">${[3, 5, 7, 10, 14].map((n) => `<button class="chip ${metaSem === n ? 'on' : ''}" data-meta-semana="${n}">Meta ${n}/sem</button>`).join('')}</div>
  </div>`;
  h += `<div class="card"><h3>⏰ Horarios de publicación <small>se ajustan con tus datos</small></h3>${DIAS_N.map((n, d) => `<div class="tarea" style="padding:8px 0"><span style="flex:1;text-transform:capitalize">${n}</span><b class="num">${String(horaDe(p, d)).padStart(2, '0')}:00</b><span class="tag ${p.origen && p.origen[d] === 'datos' ? 'arriba' : 'nuevo'}" style="margin-left:8px">${p.origen && p.origen[d] === 'datos' ? '📊 por datos' : '🧪 probando'}</span></div>`).join('')}<div class="leyenda">🧪 = aún pocos datos ese día: cada semana se prueba otra hora para descubrir la mejor.</div></div>`;
  const hechas = leerJSON('dp-tareas-' + claveSemana(), {});
  h += `<div class="card"><h3>✅ Tareas de la semana <small>sábado temas · domingo producción · 1 video al día</small></h3>${tareasSemana().map((t) => `<button class="tarea ${hechas[t.id] ? 'hecha' : ''}" data-tarea="${t.id}"><span class="check">${hechas[t.id] ? '✓' : ''}</span><span style="flex:1"><span class="tt">${t.txt}</span><div style="color:var(--suave);font-size:12px;margin-top:2px">${DIAS_N[t.dia]} · ${t.h}${t.dia === hoyIdx ? ' · <b style="color:var(--cian)">hoy</b>' : ''}</div></span></button>`).join('')}</div>`;
  const base = location.host + location.pathname.replace(/[^/]*$/, '');
  h += `<div class="card"><h3>⏰ Recordatorios en tu iPhone</h3>
    <div style="color:var(--suave);font-size:13px;margin-bottom:12px">Se suscribe al Calendario del iPhone y te avisa con notificación aunque la app esté cerrada. Producción en bloque: sábado temas, domingo grabas y programamos los 7, y cada día te avisa cuando sale el video para responder comentarios.</div>
    <a class="btn" style="width:100%" href="webcal://${esc(base)}recordatorios.ics">📅 Añadir a mi Calendario</a>
    <div style="color:var(--tenue);font-size:12px;margin-top:10px">Si no se abre: Ajustes → Calendario → Cuentas → Añadir cuenta → Otra → Añadir calendario suscrito → pega <span style="-webkit-user-select:text;user-select:text;color:var(--suave)">https://${esc(base)}recordatorios.ics</span></div></div>`;
  const ideas = leerJSON('dp-ideas', []);
  h += `<div class="card"><h3>💡 Banco de ideas <small>${ideas.length}</small></h3>
    <div style="display:flex;gap:8px;margin-bottom:6px"><input id="nuevaIdea" class="buscar" style="margin:0" placeholder="Ej: historia del transistor…"><button class="btn" id="addIdea" style="padding:0 16px">＋</button></div>
    ${ideas.map((x, i) => `<div class="idea"><span>${esc(x.t)}<div style="color:var(--tenue);font-size:11px">${x.m === 'futbol' ? '⚽ Delgafutbol' : '⚙️ Delgatronics'} · ${fecha(x.f)}</div></span><button class="chip" data-idea-marca="${i}">${x.m === 'futbol' ? '⚽' : '⚙️'}</button><button class="chip" data-idea-borrar="${i}">✓</button></div>`).join('') || '<div class="vacio">Anota aquí cada idea que se te ocurra. Toca ⚙️/⚽ para cambiar de canal y ✓ cuando la grabes.</div>'}</div>`;
  h += `<div class="etq" style="margin:16px 2px 8px">Consejos según tus datos</div>` + vConsejos().replace(chipsFiltro(), '');
  return h;
}

// ------------------------------------------------------------------ utilidades
function toast(txt) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = txt; document.body.appendChild(t); setTimeout(() => t.remove(), 1800); }
function confeti() {
  const cv = $('#confeti'), ctx = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  const ps = Array.from({length: 140}, () => ({x: innerWidth / 2, y: innerHeight / 3, vx: (Math.random() - 0.5) * 14, vy: Math.random() * -12 - 4, c: ['#00e5ff', '#2ee66b', '#ffc400', '#ff4fa3', '#9b7bff'][Math.floor(Math.random() * 5)], r: Math.random() * 6 + 3}));
  let n = 0;
  (function paso() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    ps.forEach((p) => { p.vy += 0.35; p.x += p.vx; p.y += p.vy; ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, p.r, p.r * 0.6); });
    if (++n < 140) requestAnimationFrame(paso); else ctx.clearRect(0, 0, cv.width, cv.height);
  })();
  toast('🎉 ¡Meta cumplida!');
}
function contar() {
  document.querySelectorAll('.hero .grande').forEach((el) => {
    const nodo = el.firstChild;
    if (!nodo || nodo.nodeType !== 3) return;
    const fin = Number(nodo.textContent.trim().replace(/\./g, ''));
    if (!fin || isNaN(fin) || fin > 5e6) return;
    const t0 = performance.now();
    (function f(t) { const k = Math.min(1, (t - t0) / 650), e = 1 - Math.pow(1 - k, 3); nodo.textContent = fmt(Math.round(fin * e)); if (k < 1) requestAnimationFrame(f); })(t0);
  });
}
function irA(tab, dir) {
  if (!TABS.includes(tab)) return;
  E.tab = tab; guardar('dp-tab', tab); window.scrollTo({top: 0}); pintar();
  const v = $('#vista'); v.classList.remove('izq', 'der'); void v.offsetWidth; if (dir) v.classList.add(dir);
  contar();
}

// ------------------------------------------------------------------ gestos de app nativa
['gesturestart', 'gesturechange', 'gestureend'].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault(), {passive: false}));
document.addEventListener('dblclick', (e) => e.preventDefault(), {passive: false});
let ultimoToque = 0;
document.addEventListener('touchend', (e) => {
  const ahora = Date.now();
  if (ahora - ultimoToque < 300 && !e.target.closest('input,textarea,button,a')) e.preventDefault();
  ultimoToque = ahora;
}, {passive: false});
document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, {passive: false});
addEventListener('scroll', () => $('header').classList.toggle('borde', scrollY > 4), {passive: true});

let gesto = null;
document.addEventListener('touchstart', (e) => {
  if ($('#hoja').classList.contains('on') || !D) return;
  const t = e.touches[0];
  gesto = {x: t.clientX, y: t.clientY, top: scrollY <= 0, bloqueo: !!e.target.closest('.chips,svg[data-graf],input,select,.seg,.semana')};
}, {passive: true});
document.addEventListener('touchmove', (e) => {
  if (!gesto) return;
  const dy = e.touches[0].clientY - gesto.y, dx = e.touches[0].clientX - gesto.x;
  if (gesto.top && dy > 0 && Math.abs(dy) > Math.abs(dx)) {
    const k = Math.min(1, dy / 110), ind = $('#tirar');
    ind.style.opacity = k;
    ind.style.transform = `translateY(${k * 30 - 30}px) rotate(${k * 270}deg) scale(${0.6 + k * 0.4})`;
    ind.classList.toggle('listo', k >= 1);
    gesto.tirar = k >= 1;
  }
}, {passive: true});
document.addEventListener('touchend', async (e) => {
  if (!gesto) return;
  const g = gesto; gesto = null;
  const t = e.changedTouches[0], dx = t.clientX - g.x, dy = t.clientY - g.y, ind = $('#tirar');
  if (g.tirar) { ind.style.opacity = 1; ind.classList.add('girando'); await entrar(leer('dp-clave') || '', true); ind.classList.remove('girando'); toast('Datos actualizados ✓'); }
  ind.style.opacity = 0; ind.style.transform = 'translateY(-30px) scale(.6)';
  if (!g.bloqueo && Math.abs(dx) > 75 && Math.abs(dx) > Math.abs(dy) * 1.6) {
    const i = TABS.indexOf(E.tab) + (dx < 0 ? 1 : -1);
    if (i >= 0 && i < TABS.length) irA(TABS[i], dx < 0 ? 'izq' : 'der');
  }
}, {passive: true});

// clics de la pestaña Plan
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tarea],[data-meta-semana],#addIdea,[data-idea-borrar],[data-idea-marca]');
  if (!t) return;
  if (t.dataset.tarea) {
    const k = 'dp-tareas-' + claveSemana(), o = leerJSON(k, {});
    o[t.dataset.tarea] = !o[t.dataset.tarea]; guardar(k, JSON.stringify(o));
    if (o[t.dataset.tarea]) toast('✓ ¡Bien hecho!');
  }
  if (t.dataset.metaSemana) guardar('dp-meta-semana2', t.dataset.metaSemana);
  const ideas = leerJSON('dp-ideas', []);
  if (t.id === 'addIdea') {
    const v = $('#nuevaIdea').value.trim();
    if (!v) { $('#nuevaIdea').focus(); return; }
    ideas.unshift({t: v, f: new Date().toISOString(), m: E.filtro === 'delgafutbol' ? 'futbol' : 'tronics'}); toast('Idea guardada 💡');
  }
  if (t.dataset.ideaBorrar != null) { ideas.splice(Number(t.dataset.ideaBorrar), 1); toast('¡A grabarla! 🎬'); }
  if (t.dataset.ideaMarca != null) { const x = ideas[Number(t.dataset.ideaMarca)]; x.m = x.m === 'futbol' ? 'tronics' : 'futbol'; }
  guardar('dp-ideas', JSON.stringify(ideas));
  pintar();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'nuevaIdea') $('#addIdea').click(); });
