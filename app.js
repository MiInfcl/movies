// Sitio de "Mis medios". Todo pasa por el Worker (C.API): sesión, lista de los Drive, catálogo, videos y acciones de admin.
(() => {
const C = window.MEDIOS, API = C.API;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tam = n => n >= 1e12 ? (n / 1e12).toFixed(2) + ' TB' : n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.ceil(n / 1e3) + ' KB';
const pct = (a, b) => b ? (a / b * 100) : 0;
const fpct = x => (x < 10 ? x.toFixed(1) : Math.round(x)).toString().replace('.', ',') + ' %';
const VIDEO = /\.(mp4|m4v|mkv|webm|mov|avi|ts|wmv)$/i;
const kindOf = f => VIDEO.test(f.nombre) || /^video\//.test(f.mime) ? 'video' : /^audio\//.test(f.mime) ? 'audio' : /^image\//.test(f.mime) ? 'image' : 'file';
const I = p => `<svg class="i" viewBox="0 0 24 24">${p}</svg>`;
const ICON = {
  folder: I('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.4l2 2h7.6A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>'),
  audio: I('<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2.5"/><circle cx="17" cy="16" r="2.5"/>'),
  image: I('<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 3-3 4 4"/>'),
  video: I('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10 9.5v5l4.5-2.5z"/>'),
  file: I('<path d="M7 3h6l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M13 3v5h5"/>'),
  play: '<svg class="i" viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/></svg>',
  dl: I('<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 19h14"/>'),
  more: '<svg class="i" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></svg>'
};
navigator.serviceWorker?.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});

async function api(path, body) {
  const r = await fetch(API + path, body === undefined ? { credentials: 'include' }
    : { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok) { const e = new Error((j && j.mensaje) || 'Error ' + r.status); e.status = r.status; throw e; }
  return j;
}
let msgT = 0;
function msg(t, err) { const m = $('#msg'); m.textContent = t; m.className = 'msg on' + (err ? ' err' : ''); clearTimeout(msgT); msgT = setTimeout(() => m.className = 'msg', err ? 7000 : 4000); }

// ---------- Sesión ----------
let yo = null;
const esAdmin = () => yo && yo.rol === 'admin';
function show(v) { $('#vLogin').classList.toggle('hidden', v !== 'login'); $('#vApp').classList.toggle('hidden', v !== 'app'); }
$('#vLogin').addEventListener('submit', async e => {
  e.preventDefault(); $('#eLogin').textContent = ''; $('#bEntrar').disabled = true;
  try { yo = (await api('/api/entrar', { usuario: $('#u').value.trim(), clave: $('#p').value })).usuario; $('#p').value = ''; start(); }
  catch (x) { $('#eLogin').textContent = x.message; }
  $('#bEntrar').disabled = false;
});
let tokenClient = null;
$('#bLogin').onclick = () => {
  $('#eLogin').textContent = '';
  if (!window.google?.accounts?.oauth2) return $('#eLogin').textContent = 'Google todavía no carga. Intenta de nuevo.';
  tokenClient = tokenClient || google.accounts.oauth2.initTokenClient({
    client_id: C.CLIENT_ID, scope: 'openid email',
    callback: async r => {
      if (r.error) return $('#eLogin').textContent = r.error_description || r.error;
      try { yo = (await api('/api/google', { token: r.access_token })).usuario; start(); } catch (x) { $('#eLogin').textContent = x.message; }
    },
    error_callback: e => { $('#eLogin').textContent = e.message || 'No se pudo iniciar sesión con Google.'; }
  });
  tokenClient.requestAccessToken({ prompt: 'select_account' });
};
async function salir() { try { await api('/api/salir'); } catch {} yo = null; show('login'); }

// ---------- Navegación: #/Carpeta/Subcarpeta ----------
const rutaActual = () => { const h = location.hash; if (!h.startsWith('#/')) return ''; try { return decodeURIComponent(h.slice(2)).replace(/\/+$/, ''); } catch { return ''; } };
const enlace = r => '#/' + r.split('/').map(encodeURIComponent).join('/');
let datos = null, ruta = '', items = [];

function durTxt(seg) { if (!seg) return ''; const m = Math.round(seg / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`; }
// Bandera de un idioma (por su nombre o código): «Español latino» -> México, «Inglés» -> Estados Unidos...
const bandera = l => Reproductor.bandera(l);
const lab = x => typeof x === 'string' ? x : x.l;
const listaIdiomas = ls => { const vis = new Set(); return ls.filter(x => !vis.has(lab(x)) && vis.add(lab(x))).map(x => (bandera(x) ? bandera(x) + ' ' : '') + lab(x)).join(', '); };
function metaTxt(f) {
  const p = f.peli || {}, dur = p.duracion ? p.duracion * 60 : f.video && f.video.duracion;
  const ban = p.idiomas ? [...new Set(p.idiomas.audio.map(bandera).filter(Boolean))].join('') : '';
  return [p.año, durTxt(dur), ban].filter(Boolean).join(' · ');
}
const tituloDe = f => (f.peli && f.peli.titulo) || f.nombre.replace(/\.[^.]+$/, '');

async function render(sinCargando) {
  ruta = rutaActual();
  if (!sinCargando) { $('#grid').innerHTML = ''; $('#vacio').textContent = 'Cargando…'; $('#vacio').classList.remove('hidden'); }
  try {
    datos = await api('/api/lista?ruta=' + encodeURIComponent(ruta));
  } catch (e) {
    $('#vacio').classList.add('hidden'); $('#grid').innerHTML = ''; $('#carpetas').innerHTML = ''; $('#otros').classList.add('hidden');
    if (e.status === 401) return salir();
    return aviso(e.message, e.status === 503 && esAdmin());
  }
  $('#aviso').classList.add('hidden');
  if (datos.avisos && datos.avisos.length) aviso(datos.avisos.map(a => `Drive de ${a.admin}: ${a.mensaje}`).join(' · '), true);
  items = datos.items;
  // Migas
  const segs = ruta ? ruta.split('/') : [];
  $('#crumbs').innerHTML = '<a href="#/">Inicio</a>' + segs.map((s, i) => `<span>/</span><a href="${enlace(segs.slice(0, i + 1).join('/'))}">${esc(s)}</a>`).join('');
  // Carpetas
  $('#carpetas').innerHTML = datos.carpetas.map((c, i) => `<a class="carpeta${c.oculto ? ' oc' : ''}" href="${enlace(c.ruta)}" data-n="${esc(c.nombre.toLowerCase())}">${ICON.folder}<span>${esc(c.nombre)}</span>${esAdmin() ? `<button class="ico x" type="button" data-c="${i}" title="Acciones">${ICON.more}</button>` : '<span></span>'}</a>`).join('');
  // Películas y videos: carátulas
  const vids = items.map((f, i) => ({ f, i })).filter(x => kindOf(x.f) === 'video');
  $('#grid').innerHTML = vids.map(({ f, i }) => {
    const p = f.peli || {}, t = tituloDe(f), mt = metaTxt(f), src = srcDe(f);
    return `<div class="card${f.oculto ? ' oc' : ''}" tabindex="0" data-i="${i}" data-n="${esc((t + ' ' + f.nombre).toLowerCase())}">
      <div class="poster">${p.caratula ? `<img loading="lazy" alt="" src="${esc(p.caratula)}">` : `<div class="ph">${esc(t)}</div>`}
        ${f.oculto ? '<span class="tag">Oculto</span>' : ''}
        <div class="info"><h3>${esc(t)}</h3><p>${esc(p.sinopsis || 'Sin sinopsis todavía.')}</p>${p.idiomas ? `<div class="idi"><span><b>Audio</b> ${esc(listaIdiomas(p.idiomas.audio))}</span>${p.idiomas.subs.length ? `<span><b>Subtítulos</b> ${esc(listaIdiomas(p.idiomas.subs))}</span>` : ''}</div>` : ''}${p.generos && p.generos.length ? `<div class="gen">${esc(p.generos.slice(0, 3).join(' · '))}${p.nota ? ' · ★ ' + String(p.nota).replace('.', ',') : ''}</div>` : ''}</div>
        <div class="bot"><button type="button" data-play="${i}" title="Reproducir">${ICON.play}</button><a href="${src}&dl=1" title="Descargar" data-stop="1">${ICON.dl}</a>${esAdmin() ? `<button type="button" data-more="${i}" title="Acciones">${ICON.more}</button>` : ''}</div>
        ${mt ? `<span class="meta">${esc(mt)}</span>` : ''}
      </div><div class="nom" title="${esc(f.nombre)}">${esc(t)}</div></div>`;
  }).join('');
  // Otros archivos
  const otros = items.map((f, i) => ({ f, i })).filter(x => kindOf(x.f) !== 'video');
  $('#filas').innerHTML = otros.map(({ f, i }) => `<div class="fila${f.oculto ? ' oc' : ''}" data-i="${i}" data-n="${esc(f.nombre.toLowerCase())}"><span class="ic">${ICON[kindOf(f)]}</span><span class="n">${esc(f.nombre)}${f.oculto ? ' <small>(oculto)</small>' : ''}</span><span class="s">${f.size ? tam(f.size) : ''}</span><a class="btn sec" href="${srcDe(f)}&dl=1" data-stop="1" title="Descargar">${ICON.dl}</a>${esAdmin() ? `<button class="ico" type="button" data-more="${i}">${ICON.more}</button>` : ''}</div>`).join('');
  $('#otros').classList.toggle('hidden', !otros.length);
  const vacio = !vids.length && !otros.length && !datos.carpetas.length;
  $('#vacio').textContent = vacio ? 'Esta carpeta está vacía.' : ''; $('#vacio').classList.toggle('hidden', !vacio);
  filtrar();
  if (datos.faltan > 0 && !completando) completarCatalogo();
}
function aviso(t, conectar) {
  $('#aviso').innerHTML = '<span>' + esc(t) + '</span>' + (conectar ? '<button type="button" id="conectar">Conectar mi Google Drive</button>' : '');
  $('#aviso').classList.remove('hidden');
  if (conectar) $('#conectar').onclick = () => { location.href = API + '/api/drive/conectar'; };
}
const srcDe = f => API + '/api/stream/' + f.id + '/' + encodeURIComponent(f.nombre) + '?f=' + encodeURIComponent(f.f);
// Carátulas que faltan: el Worker las busca de a poco en TMDB
let completando = false;
async function completarCatalogo() {
  completando = true; const r0 = ruta;
  try { for (let n = 0; n < 12; n++) { const { faltan } = await api('/api/completar', { ruta: r0 }); if (r0 !== rutaActual()) break; if (!faltan) break; } if (r0 === rutaActual()) await render(true); }
  catch {} completando = false;
}
addEventListener('hashchange', () => { if (location.hash.startsWith('#/') || !location.hash) render(); });
function filtrar() {
  const v = $('#q').value.trim().toLowerCase();
  document.querySelectorAll('[data-n]').forEach(el => el.style.display = !v || el.dataset.n.includes(v) ? '' : 'none');
}
$('#q').oninput = filtrar;

// ---------- Abrir ----------
function abrir(f) {
  const k = kindOf(f), src = srcDe(f);
  if (k === 'file') { location.href = src + '&dl=1'; return; }
  const p = f.peli || {};
  Reproductor.abrir({ titulo: tituloDe(f), sub: metaTxt(f), sinopsis: p.sinopsis, fondo: p.fondo, kind: k, src, dl: src + '&dl=1', cred: false,
    insertar: k === 'video' ? location.origin + '/ver.html#v=' + encodeURIComponent(f.id) + '&f=' + encodeURIComponent(f.f) + '&t=' + encodeURIComponent(tituloDe(f)) : null,
    pistas: k === 'video' ? () => api('/api/pistas?id=' + encodeURIComponent(f.id)) : null });
}
$('#grid').addEventListener('click', e => {
  if (e.target.closest('[data-stop]')) return;
  const m = e.target.closest('[data-more]'); if (m) { e.stopPropagation(); return menuItem(items[+m.dataset.more], m); }
  const c = e.target.closest('.card'); if (c) abrir(items[+c.dataset.i]);
});
$('#grid').addEventListener('keydown', e => { const c = e.target.closest('.card'); if (c && e.key === 'Enter') abrir(items[+c.dataset.i]); });
$('#filas').addEventListener('click', e => {
  if (e.target.closest('[data-stop]')) return;
  const m = e.target.closest('[data-more]'); if (m) { e.stopPropagation(); return menuItem(items[+m.dataset.more], m); }
  const r = e.target.closest('.fila'); if (r) abrir(items[+r.dataset.i]);
});
$('#carpetas').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; e.preventDefault(); e.stopPropagation(); menuCarpeta(datos.carpetas[+b.dataset.c], b); });

// ---------- Menú contextual ----------
const menu = $('#menu');
const cerrarMenu = () => menu.classList.remove('on');
addEventListener('click', e => { if (!e.target.closest('#menu')) cerrarMenu(); });
addEventListener('scroll', cerrarMenu, { passive: true });
function abrirMenu(anchor, html, acts) {
  menu.innerHTML = html; menu.classList.add('on');
  const r = anchor.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
  menu.style.top = (r.bottom + h + 8 < innerHeight ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + 'px';
  menu.onclick = ev => { const a = ev.target.closest('button')?.dataset.a; if (!a) return; cerrarMenu(); acts[a](); };
}
function menuItem(f, anchor) {
  const v = kindOf(f) === 'video';
  abrirMenu(anchor, '<button data-a="ren">Renombrar</button><button data-a="mov">Mover a…</button><button data-a="dup">Duplicar</button>'
    + (v ? '<button data-a="pis">Agregar audio o subtítulos</button>' : '')
    + `<button data-a="ocu">${f.oculto ? 'Mostrar a todos' : 'Ocultar'}</button><hr><button data-a="del" class="bad">Eliminar</button>`, {
    ren: () => renombrar({ id: f.id }, f.nombre, true),
    mov: () => mover({ id: f.id }, f.nombre),
    dup: () => ventana('<h3>Duplicar</h3><p>Se creará una copia de «' + esc(f.nombre) + '» en la misma carpeta de su Drive, con sus pistas.</p>', async () => listo(await api('/api/admin', { op: 'duplicar', id: f.id })), 'Duplicar'),
    pis: () => subirPista(f),
    ocu: () => ocultar({ id: f.id }, !f.oculto),
    del: () => eliminar({ id: f.id }, f.nombre, false)
  });
}
function menuCarpeta(c, anchor) {
  abrirMenu(anchor, `<button data-a="ren">Renombrar</button><button data-a="mov">Mover a…</button><button data-a="ocu">${c.oculto ? 'Mostrar a todos' : 'Ocultar'}</button><hr><button data-a="del" class="bad">Eliminar</button>`, {
    ren: () => renombrar({ ruta: c.ruta }, c.nombre, false),
    mov: () => mover({ ruta: c.ruta }, c.nombre),
    ocu: () => ocultar({ ruta: c.ruta }, !c.oculto),
    del: () => eliminar({ ruta: c.ruta }, c.nombre, true)
  });
}

// ---------- Ventanas ----------
const dlg = $('#dlg'), box = dlg.querySelector('.box');
const cerrarDlg = () => { dlg.classList.remove('on'); box.innerHTML = ''; };
dlg.addEventListener('mousedown', e => { if (e.target === dlg) cerrarDlg(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && dlg.classList.contains('on')) cerrarDlg(); });
function ventana(html, onOk, okText = 'Aceptar', danger = false, cancel = 'Cancelar') {
  box.innerHTML = html + `<div class="err" id="dlgErr"></div><div class="acts"><button class="sec" type="button" id="dlgNo">${cancel}</button>${onOk ? `<button type="button" id="dlgOk" class="${danger ? 'danger' : ''}">${esc(okText)}</button>` : ''}</div>`;
  dlg.classList.add('on');
  box.querySelector('#dlgNo').onclick = cerrarDlg;
  if (!onOk) return;
  const ok = box.querySelector('#dlgOk'), err = box.querySelector('#dlgErr');
  const run = async () => { ok.disabled = true; err.textContent = ''; try { await onOk(); } catch (e) { err.textContent = e.message; ok.disabled = false; } };
  ok.onclick = run;
  box.querySelectorAll('input.t').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') run(); }));
  const first = box.querySelector('input.t'); if (first) { first.focus(); first.select(); }
}
const listo = r => { cerrarDlg(); msg(r.mensaje); render(true); };

function renombrar(sel, nombre, esArchivo) {
  ventana(`<h3>Renombrar</h3><input class="t" id="nn" value="${esc(nombre)}" autocomplete="off">`, async () => {
    const n = $('#nn').value.trim(); if (!n || n === nombre) return cerrarDlg();
    listo(await api('/api/admin', { op: 'renombrar', ...sel, nombre: n }));
  }, 'Renombrar');
  const i = $('#nn'), dot = nombre.lastIndexOf('.'); if (esArchivo && dot > 0) i.setSelectionRange(0, dot);
}
async function mover(sel, nombre) {
  ventana('<h3>Mover «' + esc(nombre) + '»</h3><p>Elige la carpeta de destino.</p><div class="pick">Cargando…</div>', async () => {
    const b = box.querySelector('.pick button.on'); if (!b) throw new Error('Elige una carpeta.');
    listo(await api('/api/admin', { op: 'mover', ...sel, destino: b.dataset.r }));
  }, 'Mover');
  const pick = box.querySelector('.pick');
  try {
    const { carpetas } = await api('/api/carpetas');
    pick.innerHTML = carpetas.filter(r => !(sel.ruta && (r === sel.ruta || r.startsWith(sel.ruta + '/')))).map(r => `<button type="button" data-r="${esc(r)}">${r ? esc(r.replace(/\//g, ' / ')) : 'Inicio'}</button>`).join('');
    pick.onclick = e => { const b = e.target.closest('button'); if (!b) return; pick.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
  } catch (e) { pick.textContent = e.message; }
}
async function ocultar(sel, oculto) { try { const r = await api('/api/admin', { op: 'ocultar', ...sel, oculto }); msg(r.mensaje); render(true); } catch (e) { msg(e.message, true); } }
function eliminar(sel, nombre, carpeta) {
  ventana('<h3>Eliminar</h3><p>«' + esc(nombre) + '»' + (carpeta ? ' y todo su contenido' : ' y su carpeta de pistas') + ' irán a la papelera de Google Drive, donde se pueden recuperar durante 30 días.</p><p>Si solo quieres que no se vea, usa «Ocultar».</p>',
    async () => listo(await api('/api/admin', { op: 'eliminar', ...sel })), 'Eliminar', true);
}
$('#bCarpeta').onclick = () => ventana('<h3>Nueva carpeta</h3><input class="t" id="nn" placeholder="Nombre de la carpeta" autocomplete="off">', async () => {
  const nombre = $('#nn').value.trim(); if (!nombre) throw new Error('Escribe un nombre.');
  listo(await api('/api/admin', { op: 'carpeta', ruta, nombre }));
}, 'Crear');

// Subir audio o subtítulos a la carpeta de la película (directo del navegador a Drive)
function subirPista(f) {
  let tipo = 'sub';
  ventana(`<h3>Agregar audio o subtítulos</h3><p>Para «${esc(tituloDe(f))}». Se guarda en la carpeta «${esc(f.nombre.replace(/\.[^.]+$/, ''))}» de su Drive, que no se ve en el sitio.</p>
    <div class="seg" id="tp"><button type="button" class="on" data-t="sub">Subtítulos</button><button type="button" data-t="audio">Audio</button></div>
    <div><label class="l" for="pe">Nombre de la pista</label><input class="t" id="pe" placeholder="Ej.: Español latino" autocomplete="off"></div>
    <div><label class="l" for="pf">Archivo</label><input class="t" id="pf" type="file" accept=".srt,.vtt,.ass,.ssa"></div>
    <div class="progreso hidden" id="pp"><i></i></div>`, async () => {
    const file = $('#pf').files[0], etiqueta = $('#pe').value.trim();
    if (!etiqueta) throw new Error('Escribe un nombre para la pista.'); if (!file) throw new Error('Elige un archivo.');
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const r = await api('/api/subir', { id: f.id, tipo, etiqueta, ext, size: file.size });
    $('#pp').classList.remove('hidden');
    await new Promise((ok, no) => {
      const x = new XMLHttpRequest(); x.open('PUT', r.url);
      x.upload.onprogress = e => { if (e.lengthComputable) $('#pp i').style.width = (e.loaded / e.total * 100) + '%'; };
      x.onload = () => x.status < 300 ? ok() : no(new Error('Drive rechazó la subida (' + x.status + ').'));
      x.onerror = () => no(new Error('Se cortó la subida.')); x.send(file);
    });
    cerrarDlg(); msg(r.mensaje);
  }, 'Subir');
  $('#tp').onclick = e => { const b = e.target.closest('button'); if (!b) return; tipo = b.dataset.t; $('#tp').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    $('#pf').accept = tipo === 'sub' ? '.srt,.vtt,.ass,.ssa' : '.m4a,.mp3,.aac,.ac3,.eac3,.dts,.mka,.ogg,.opus,.flac,.wav'; };
}

// Agregar por enlace (solo admins)
$('#bEnlace').onclick = () => {
  ventana(`<h3>Agregar por enlace</h3><p>Pega el enlace directo de un video, audio o imagen. Se descarga en la nube al Drive con más espacio, en la carpeta «${esc(ruta || 'Inicio')}».</p>
    <input class="t" id="lk" placeholder="https://…" inputmode="url" autocomplete="off"><div class="cola" id="cola"></div>`, async () => {
    const url = $('#lk').value.trim(); if (!url) throw new Error('Pega un enlace.');
    const r = await api('/api/pedido', { url, ruta }); $('#lk').value = ''; msg(r.mensaje); cola();
    $('#dlgOk').disabled = false;
  }, 'Descargar', false, 'Cerrar');
  cola();
};
async function cola() {
  const el = $('#cola'); if (!el) return;
  try { const { pedidos } = await api('/api/pedidos'); el.innerHTML = pedidos.length ? '<p>Descargas en curso</p>' + pedidos.map(p => `<div class="${p.estado === 'error' ? 'e' : ''}">${p.estado === 'error' ? 'Falló: ' : p.estado === 'descargando' ? 'Descargando: ' : 'En cola: '}${esc(p.url)}${p.error ? ' (' + esc(p.error) + ')' : ''}</div>`).join('') : ''; }
  catch { el.innerHTML = ''; }
}

// Espacio de los Drive (admins)
async function espacioPill() {
  try {
    const { drives } = await api('/api/espacio'); const ok = drives.filter(d => d.limite);
    const t = pct(ok.reduce((a, d) => a + d.usado, 0), ok.reduce((a, d) => a + d.limite, 0));
    $('#pctTotal').textContent = fpct(t); $('#bEspacio .barra i').style.width = Math.min(100, Math.max(2, t)) + '%';
    return drives;
  } catch { $('#pctTotal').textContent = 'Espacio'; return null; }
}
$('#bEspacio').onclick = async () => {
  ventana('<h3>Espacio</h3><div id="esp">Cargando…</div>', null, '', false, 'Cerrar');
  try {
    const d = await api('/api/espacio'), ok = d.drives.filter(x => x.limite);
    const uso = ok.reduce((a, x) => a + x.usado, 0), lim = ok.reduce((a, x) => a + x.limite, 0), mio = d.drives.find(x => x.mio);
    $('#esp').innerHTML = `<div class="total"><b>${fpct(pct(uso, lim))}</b> del espacio total usado</div><p>${tam(uso)} de ${tam(lim)} entre ${d.drives.length} Drive${d.drives.length === 1 ? '' : 's'}.</p>`
      + (mio && mio.limite ? `<p style="margin-top:8px">Tu Drive: <b style="color:var(--tx)">${fpct(pct(mio.usado, mio.limite))}</b> usado (${tam(mio.usado)} de ${tam(mio.limite)}).</p>` : '')
      + '<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">' + d.drives.map(x => x.error
        ? `<div class="disco"><div class="t"><span>${esc(x.admin)}${x.mio ? ' (tú)' : ''}</span><small>${esc(x.email || '')}</small></div><p class="err" style="color:var(--bad)">${esc(x.error)}</p></div>`
        : `<div class="disco"><div class="t"><span>${esc(x.admin)}${x.mio ? ' (tú)' : ''}${x.principal ? ' · principal' : ''}</span><small>${esc(x.email || '')}</small></div><div class="medidor"><i style="width:${Math.min(100, pct(x.usado, x.limite))}%"></i></div><div class="t"><small>${tam(x.usado)} de ${tam(x.limite)} · ${fpct(pct(x.usado, x.limite))}</small><small>Mis medios y otros: ${tam(x.usadoDrive)} en Drive</small></div></div>`).join('') + '</div>'
      + `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">${d.tengoDrive ? '<button type="button" class="sec" id="recon">Reconectar mi Drive</button>' + (mio && !mio.principal ? '<button type="button" class="sec" id="descon">Quitar mi Drive</button>' : '') : '<button type="button" id="recon">Conectar mi Google Drive</button>'}</div>`
      + (d.tengoDrive ? '' : '<p style="margin-top:4px">Cada admin puede sumar su propio Drive. Se crea en él una carpeta «Mis medios» y lo que haya ahí se ve junto con lo demás.</p>');
    $('#recon').onclick = () => { location.href = API + '/api/drive/conectar'; };
    if ($('#descon')) $('#descon').onclick = () => ventana('<h3>Quitar mi Drive</h3><p>Lo que está en tu Drive dejará de verse en el sitio, pero no se borra: queda en tu carpeta «Mis medios».</p>', async () => listo(await api('/api/drive/desconectar', {})), 'Quitar', true);
  } catch (e) { $('#esp').textContent = e.message; }
};

// Usuarios (admins)
$('#bUsuarios').onclick = async () => {
  box.innerHTML = '<h3>Usuarios</h3><p>Cualquiera con una cuenta de Google puede entrar y ver la biblioteca. Aquí puedes hacer admin a alguien o crear usuarios con contraseña.</p><table id="ut"><tr><td>Cargando…</td></tr></table>'
    + '<h3 style="margin-top:4px">Crear o cambiar</h3><input class="t" id="un" placeholder="Usuario, o correo de Google" autocomplete="off" autocapitalize="none">'
    + '<input class="t" id="uc" type="password" placeholder="Contraseña (mínimo 8; vacía si es un correo de Google)" autocomplete="new-password">'
    + '<select class="t" id="ur"><option value="usuario">Usuario: ve, reproduce y descarga</option><option value="admin">Admin: además agrega, organiza y conecta su Drive</option></select>'
    + '<div class="err" id="uerr"></div><div class="acts"><button class="sec" type="button" id="uno">Cerrar</button><button type="button" id="uok">Guardar</button></div>';
  dlg.classList.add('on'); box.querySelector('#uno').onclick = cerrarDlg;
  const err = box.querySelector('#uerr');
  const cargar = async () => {
    const { usuarios } = await api('/api/usuarios');
    usuarios.sort((a, b) => (a.rol === b.rol ? a.nombre.localeCompare(b.nombre) : a.rol === 'admin' ? -1 : 1));
    box.querySelector('#ut').innerHTML = usuarios.map(u => `<tr><td>${esc(u.nombre)}${u.google ? ' <small>Google</small>' : ''}</td><td>${u.rol}</td><td>${u.nombre === yo.nombre ? '' : `<button class="sec" type="button" data-e="${esc(u.nombre)}" data-r="${u.rol}">Editar</button> <button class="danger" type="button" data-b="${esc(u.nombre)}">Borrar</button>`}</td></tr>`).join('');
  };
  box.querySelector('#ut').onclick = async e => {
    const ed = e.target.closest('button[data-e]'); if (ed) { box.querySelector('#un').value = ed.dataset.e; box.querySelector('#ur').value = ed.dataset.r; box.querySelector('#uc').focus(); return; }
    const b = e.target.closest('button[data-b]'); if (!b) return;
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = '¿Seguro?'; return; }
    try { await api('/api/usuarios', { op: 'borrar', nombre: b.dataset.b }); await cargar(); } catch (x) { err.textContent = x.message; }
  };
  box.querySelector('#uok').onclick = async () => {
    err.className = 'err'; err.textContent = '';
    try {
      await api('/api/usuarios', { op: 'guardar', nombre: box.querySelector('#un').value.trim(), clave: box.querySelector('#uc').value, rol: box.querySelector('#ur').value });
      box.querySelector('#uc').value = ''; err.className = 'ok'; err.textContent = 'Guardado.'; await cargar();
    } catch (x) { err.textContent = x.message; }
  };
  try { await cargar(); } catch (x) { err.textContent = x.message; }
};

// Solicitar películas: búsqueda en IMDb (o un enlace de IMDb)
$('#bPedir').onclick = () => {
  let elegido = null, t = 0;
  ventana(`<h3>Solicitar una película</h3><p>Busca por nombre o pega el enlace de IMDb.</p>
    <input class="t" id="sq" placeholder="Ej.: Interestelar, o https://www.imdb.com/title/tt0816692/" autocomplete="off">
    <div class="sug" id="sug"></div><h3 style="margin-top:6px;font-size:.95rem">${esAdmin() ? 'Solicitudes de todos' : 'Tus solicitudes'}</h3><div id="sols">Cargando…</div>`, async () => {
    if (!elegido) throw new Error('Elige una película de la lista.');
    const r = await api('/api/solicitudes', { op: 'pedir', id: elegido.id }); msg(r.mensaje); elegido = null;
    $('#sq').value = ''; $('#sug').innerHTML = ''; $('#dlgOk').disabled = false; cargarSols();
  }, 'Solicitar', false, 'Cerrar');
  const sug = $('#sug'); let res = [];
  const pintar = () => { sug.innerHTML = res.map((r, i) => `<button type="button" data-i="${i}" class="${elegido && elegido.id === r.id ? 'on' : ''}">${r.poster ? `<img src="${esc(r.poster)}" alt="" loading="lazy">` : '<span class="np"></span>'}<span>${esc(r.titulo)}${r.año ? ' (' + r.año + ')' : ''}<small>${esc(r.tipo)}${r.actores ? ' · ' + esc(r.actores) : ''}</small></span></button>`).join('') || (($('#sq').value.trim().length > 1) ? '<p>Sin resultados.</p>' : ''); };
  $('#sq').addEventListener('input', () => {
    clearTimeout(t); elegido = null; const q = $('#sq').value.trim();
    t = setTimeout(async () => { try { res = (await api('/api/imdb?q=' + encodeURIComponent(q))).resultados; if (/tt\d{5,}/.test(q) && res.length) elegido = res[0]; pintar(); } catch (e) { sug.textContent = e.message; } }, 280);
  });
  sug.onclick = e => { const b = e.target.closest('button[data-i]'); if (!b) return; elegido = res[+b.dataset.i]; pintar(); };
  cargarSols();
};
async function cargarSols() {
  const el = $('#sols'); if (!el) return;
  try {
    const { solicitudes } = await api('/api/solicitudes');
    el.innerHTML = solicitudes.length ? solicitudes.map(s => `<div class="sol">${s.poster ? `<img src="${esc(s.poster)}" alt="" loading="lazy">` : '<span class="np"></span>'}<div class="tx"><a href="https://www.imdb.com/title/${esc(s.id)}/" target="_blank" rel="noopener">${esc(s.titulo)}${s.año ? ' (' + s.año + ')' : ''}</a>${esAdmin() ? `<small>Pedida por ${esc(s.por.join(', '))}</small>` : ''}</div><span class="est ${s.estado === 'agregada' ? 'ok' : ''}">${s.estado === 'agregada' ? 'Agregada' : 'Pendiente'}</span>${esAdmin() ? `<button type="button" class="sec" data-e="${esc(s.id)}" data-v="${s.estado === 'agregada' ? 'pendiente' : 'agregada'}">${s.estado === 'agregada' ? 'Reabrir' : 'Lista'}</button>` : ''}<button type="button" class="sec" data-q="${esc(s.id)}">Quitar</button></div>`).join('') : '<p>Ninguna todavía.</p>';
    el.onclick = async e => {
      const b = e.target.closest('button[data-e],button[data-q]'); if (!b) return;
      try { const r = b.dataset.e ? await api('/api/solicitudes', { op: 'estado', id: b.dataset.e, estado: b.dataset.v }) : await api('/api/solicitudes', { op: 'quitar', id: b.dataset.q }); msg(r.mensaje); cargarSols(); contarSols(); } catch (x) { msg(x.message, true); }
    };
  } catch (x) { el.textContent = x.message; }
}
async function contarSols() {
  if (!esAdmin()) return;
  try { const { pendientes } = await api('/api/solicitudes'); $('#nPedir').textContent = pendientes; $('#nPedir').classList.toggle('hidden', !pendientes); } catch {}
}

// Menú de la cuenta
$('#bYo').onclick = e => {
  e.stopPropagation();
  abrirMenu($('#bYo'), `<div class="who"><b>${esc(yo.nombre)}</b>${yo.rol === 'admin' ? 'Administrador' : 'Usuario'}</div><hr><button data-a="out">Cerrar sesión</button>`, { out: salir });
};

// ---------- Arranque ----------
function start() {
  show('app');
  $('#yoNom').textContent = yo.nombre; $('#yoAv').textContent = (yo.nombre[0] || '?').toUpperCase();
  $('#adminBtns').classList.toggle('hidden', !esAdmin());
  const h = location.hash;
  if (/^#drive-(ok|error)=/.test(h)) { const ok = h.startsWith('#drive-ok='); msg(decodeURIComponent(h.split('=').slice(1).join('=')), !ok); history.replaceState(null, '', location.pathname + '#/'); }
  if (esAdmin()) { espacioPill(); contarSols(); }
  render();
}
api('/api/yo').then(d => { yo = d.usuario; yo ? start() : show('login'); }).catch(() => { show('login'); $('#eLogin').textContent = 'No se pudo contactar al servidor.'; });
})();
