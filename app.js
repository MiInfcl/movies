// Sitio de "Butaca". Todo pasa por el Worker (C.API): sesión, lista de los Drive, catálogo, videos y acciones de admin.
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
function show(v) { $('#vLogin').classList.toggle('hidden', v !== 'login'); $('#vReg').classList.toggle('hidden', v !== 'reg'); $('#vApp').classList.toggle('hidden', v !== 'app'); }
// Registro con nombre, correo y contraseña segura
const REGLAS = { largo: c => c.length >= 8, may: c => /[A-Z]/.test(c), min: c => /[a-z]/.test(c), num: c => /\d/.test(c), esp: c => /[^A-Za-z0-9]/.test(c) };
$('#aReg').onclick = e => { e.preventDefault(); $('#eReg').textContent = ''; show('reg'); $('#regN').focus(); };
$('#aEnt').onclick = e => { e.preventDefault(); show('login'); };
$('#regP').addEventListener('input', () => { const c = $('#regP').value; document.querySelectorAll('#reglas li').forEach(li => li.classList.toggle('ok', REGLAS[li.dataset.r](c))); });
$('#vReg').addEventListener('submit', async e => {
  e.preventDefault(); const err = $('#eReg'); err.textContent = '';
  const clave = $('#regP').value;
  if (!Object.values(REGLAS).every(f => f(clave))) return err.textContent = 'La contraseña no cumple todas las reglas.';
  if (clave !== $('#regP2').value) return err.textContent = 'Las contraseñas no coinciden.';
  $('#bReg').disabled = true;
  try {
    yo = (await api('/api/registro', { nombre: $('#regN').value.trim(), correo: $('#regC').value.trim(), clave, web: $('#rweb').value })).usuario;
    $('#regP').value = $('#regP2').value = ''; start();
  } catch (x) { err.textContent = x.message; }
  $('#bReg').disabled = false;
});
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
    client_id: C.CLIENT_ID, scope: 'openid email profile',
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
let datos = null, ruta = '', items = [], vids = [];

function durTxt(seg) { if (!seg) return ''; const m = Math.round(seg / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`; }
// Bandera de un idioma (por su nombre o código): «Español latino» -> México, «Inglés» -> Estados Unidos...
const bandera = l => Reproductor.bandera(l);
const lab = x => typeof x === 'string' ? x : x.l;
const listaIdiomas = ls => [...new Set(ls.map(x => idiomaDe(x) || lab(x)))].map(conBand).join(', ');
const edadTxt = e => e == null ? '' : e === 0 ? 'TP' : '+' + e;
function metaTxt(f) {
  const p = f.peli || {}, dur = p.duracion ? p.duracion * 60 : f.video && f.video.duracion;
  const ban = p.idiomas ? [...new Set(p.idiomas.audio.map(bandera).filter(Boolean))].join('') : '';
  return [p.año, durTxt(dur), edadTxt(p.edad), ban].filter(Boolean).join(' · ');
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
  vids = items.map((f, i) => ({ f, i })).filter(x => kindOf(x.f) === 'video');
  pintarFiltros(); pintarCarrusel(); pintarGrid();
  // Otros archivos
  const otros = items.map((f, i) => ({ f, i })).filter(x => kindOf(x.f) !== 'video');
  $('#filas').innerHTML = otros.map(({ f, i }) => `<div class="fila${f.oculto ? ' oc' : ''}" data-i="${i}" data-n="${esc(f.nombre.toLowerCase())}"><span class="ic">${ICON[kindOf(f)]}</span><span class="n">${esc(f.nombre)}${f.oculto ? ' <small>(oculto)</small>' : ''}</span><span class="s">${f.size ? tam(f.size) : ''}</span><a class="btn sec" href="${srcDe(f)}&dl=1" data-stop="1" title="Descargar">${ICON.dl}</a>${esAdmin() ? `<button class="ico" type="button" data-more="${i}">${ICON.more}</button>` : ''}</div>`).join('');
  $('#otros').classList.toggle('hidden', !otros.length);
  const vacio = !vids.length && !otros.length && !datos.carpetas.length;
  $('#vacio').textContent = vacio ? 'Esta carpeta está vacía.' : ''; $('#vacio').classList.toggle('hidden', !vacio);
  filtrar();
  if (datos.faltan > 0 && !completando) completarCatalogo();
}
// ---------- Ordenar y filtrar (se recuerda en este navegador) ----------
const LENGUAS = { spa: 'Español', es: 'Español', eng: 'Inglés', en: 'Inglés', por: 'Portugués', pt: 'Portugués', fra: 'Francés', fre: 'Francés', fr: 'Francés', ita: 'Italiano', it: 'Italiano', deu: 'Alemán', ger: 'Alemán', de: 'Alemán', jpn: 'Japonés', ja: 'Japonés', kor: 'Coreano', ko: 'Coreano', zho: 'Chino', chi: 'Chino', zh: 'Chino', rus: 'Ruso', ru: 'Ruso' };
function idiomaDe(x) {
  const l = typeof x === 'string' ? x : x.l || x.label || '', c = typeof x === 'string' ? '' : x.c || x.lang || '';
  if (/latin|lat\b|419|mex|castellano|españa/i.test(l)) return 'Español';   // latino, México y España: un solo español
  if (LENGUAS[c]) return LENGUAS[c];
  const m = Object.entries({ 'Español': /espa[ñn]ol|spanish/i, 'Inglés': /ingl[eéè]s|english/i, 'Portugués': /portugu/i, 'Francés': /franc[eé]s|french/i, 'Italiano': /italian/i, 'Alemán': /alem[aá]n|german/i, 'Japonés': /japon|japanese/i, 'Coreano': /corean|korean/i }).find(([, re]) => re.test(l));
  return m ? m[0] : null;
}
const conBand = n => (bandera(n) ? bandera(n) + ' ' : '') + n;
const ORDENES = { nombre: 'Nombre', año: 'Año', nota: 'Puntuación', duracion: 'Duración', reciente: 'Recién agregadas', edad: 'Clasificación' };
let vista = (() => { try { return JSON.parse(localStorage.getItem('butaca-vista')) || {}; } catch { return {}; } })();
vista = { orden: 'nombre', dir: 1, genero: '', audio: '', subs: '', edad: '', ...vista };
['audio', 'subs'].forEach(k => { if (/^Español/.test(vista[k])) vista[k] = 'Español'; });
const guardarVista = () => { try { localStorage.setItem('butaca-vista', JSON.stringify(vista)); } catch {} };
const durDe = f => (f.peli && f.peli.duracion ? f.peli.duracion * 60 : f.video && f.video.duracion) || 0;
function pintarFiltros() {
  const el = $('#filtros'); if (!vids.length) { el.innerHTML = ''; return; }
  const set = fn => [...new Set(vids.flatMap(({ f }) => fn(f.peli || {})).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const generos = set(p => p.generos || []);
  const audios = set(p => p.idiomas ? p.idiomas.audio.map(idiomaDe) : []);
  const subs = set(p => p.idiomas ? p.idiomas.subs.map(idiomaDe) : []);
  const sel = (id, titulo, ops, val, fmt = x => x) => `<select id="${id}" class="fchip${val !== '' ? ' on' : ''}" title="${titulo}" aria-label="${titulo}"><option value="">${titulo}</option>${ops.map(o => `<option value="${esc(o)}"${String(o) === String(val) ? ' selected' : ''}>${esc(fmt(o))}</option>`).join('')}</select>`;
  const hay = vista.genero || vista.audio || vista.subs || vista.edad !== '';
  el.innerHTML = `<div class="fizq">${sel('fGen', 'Género', generos, vista.genero)}${sel('fAud', 'Audio', audios, vista.audio, conBand)}${sel('fSub', 'Subtítulos', subs, vista.subs, conBand)}${sel('fEdad', 'Edad', ['0', '7', '13', '16'], vista.edad, v => v === '0' ? 'Todo público' : 'Hasta +' + v)}
    <button type="button" class="limpiar${hay ? '' : ' hidden'}" id="fLimpiar">Quitar filtros</button></div>
    <button type="button" class="ico orden" id="fOrden" title="Ordenar: ${ORDENES[vista.orden] || 'Nombre'}, ${vista.dir > 0 ? 'ascendente' : 'descendente'}" aria-label="Ordenar">${I(vista.dir > 0 ? '<path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M13 6h4M13 11h6M13 16h8"/>' : '<path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M13 6h8M13 11h6M13 16h4"/>')}<span>${ORDENES[vista.orden] || 'Nombre'}</span></button>`;
  const cambio = () => { vista.genero = $('#fGen').value; vista.audio = $('#fAud').value; vista.subs = $('#fSub').value; vista.edad = $('#fEdad').value; guardarVista(); pintarFiltros(); pintarGrid(); };
  el.querySelectorAll('select').forEach(x => x.onchange = cambio);
  const ok = '<svg class="i chk" viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>';
  $('#fOrden').onclick = e => {
    e.stopPropagation();
    const acts = {};
    Object.keys(ORDENES).forEach(k => acts['o-' + k] = () => { vista.orden = k; guardarVista(); pintarFiltros(); pintarGrid(); });
    acts.asc = () => { vista.dir = 1; guardarVista(); pintarFiltros(); pintarGrid(); }; acts.desc = () => { vista.dir = -1; guardarVista(); pintarFiltros(); pintarGrid(); };
    abrirMenu($('#fOrden'), '<div class="mtit">Ordenar por</div>' + Object.entries(ORDENES).map(([k, t]) => `<button data-a="o-${k}" class="${k === vista.orden ? 'on' : ''}">${t}${k === vista.orden ? ok : ''}</button>`).join('')
      + `<hr><button data-a="asc" class="${vista.dir > 0 ? 'on' : ''}">Ascendente${vista.dir > 0 ? ok : ''}</button><button data-a="desc" class="${vista.dir < 0 ? 'on' : ''}">Descendente${vista.dir < 0 ? ok : ''}</button>`, acts);
  };
  $('#fLimpiar').onclick = () => { Object.assign(vista, { genero: '', audio: '', subs: '', edad: '' }); guardarVista(); pintarFiltros(); pintarGrid(); };
}
function visibles() {
  const q = $('#q').value.trim().toLowerCase();
  let ls = vids.filter(({ f }) => {
    const p = f.peli || {};
    if (q && !(tituloDe(f) + ' ' + f.nombre + ' ' + (p.generos || []).join(' ')).toLowerCase().includes(q)) return false;
    if (vista.genero && !(p.generos || []).includes(vista.genero)) return false;
    if (vista.audio && !(p.idiomas && p.idiomas.audio.some(x => idiomaDe(x) === vista.audio))) return false;
    if (vista.subs && !(p.idiomas && p.idiomas.subs.some(x => idiomaDe(x) === vista.subs))) return false;
    if (vista.edad !== '' && !(p.edad != null && p.edad <= +vista.edad)) return false;
    return true;
  });
  const val = { nombre: f => tituloDe(f).toLowerCase(), año: f => (f.peli && f.peli.año) || 0, nota: f => (f.peli && f.peli.nota) || 0, duracion: durDe, reciente: f => f.fecha || '', edad: f => (f.peli && f.peli.edad) ?? 99 }[vista.orden] || (f => tituloDe(f).toLowerCase());
  ls.sort((a, b) => { const x = val(a.f), y = val(b.f); return (typeof x === 'string' ? x.localeCompare(y, 'es', { numeric: true }) : x - y) * vista.dir; });
  return ls;
}
function tarjeta({ f, i }) {
  const p = f.peli || {}, t = tituloDe(f), mt = metaTxt(f), src = srcDe(f);
  return `<div class="card${f.oculto ? ' oc' : ''}" tabindex="0" data-i="${i}">
      <div class="poster">${p.caratula ? `<img loading="lazy" alt="" src="${esc(p.caratula)}">` : `<div class="ph">${esc(t)}</div>`}
        ${f.oculto ? '<span class="tag">Oculto</span>' : ''}
        <div class="info"><h3>${esc(t)}</h3><p>${esc(p.sinopsis || 'Sin sinopsis todavía.')}</p>${p.idiomas ? `<div class="idi"><span><b>Audio</b> ${esc(listaIdiomas(p.idiomas.audio))}</span>${p.idiomas.subs.length ? `<span><b>Subtítulos</b> ${esc(listaIdiomas(p.idiomas.subs))}</span>` : ''}</div>` : ''}${p.generos && p.generos.length ? `<div class="gen">${esc(p.generos.slice(0, 3).join(' · '))}${p.nota ? ' · ★ ' + String(p.nota).replace('.', ',') : ''}</div>` : ''}</div>
        <div class="bot"><button type="button" data-play="${i}" title="Reproducir">${ICON.play}</button><a href="${src}&dl=1" title="Descargar" data-stop="1">${ICON.dl}</a>${esAdmin() || (f.prog && f.prog.t > 0) ? `<button type="button" data-more="${i}" title="Más opciones">${ICON.more}</button>` : ''}</div>
        ${mt ? `<span class="meta">${esc(mt)}</span>` : ''}${f.prog && f.prog.d ? `<span class="prog" title="Visto ${Math.min(100, Math.round(f.prog.t / f.prog.d * 100))} %"><i style="width:${Math.min(100, f.prog.t / f.prog.d * 100)}%"></i></span>` : ''}
      </div><div class="nom" title="${esc(f.nombre)}">${esc(t)}</div></div>`;
}
function pintarGrid() {
  const ls = visibles();
  $('#grid').innerHTML = ls.map(tarjeta).join('');
  const sinRes = vids.length && !ls.length;
  $('#sinres').classList.toggle('hidden', !sinRes);
}

// ---------- Carrusel de destacadas ----------
let carT = 0, carI = 0;
function pintarCarrusel() {
  const el = $('#hero'); clearInterval(carT);
  const q = $('#q').value.trim();
  let ds = vids.filter(({ f }) => f.peli && f.peli.destacada && !f.oculto);
  if (!ds.length) ds = vids.filter(({ f }) => f.peli && (f.peli.fondo || f.peli.caratula) && !f.oculto).sort((a, b) => String(b.f.fecha).localeCompare(String(a.f.fecha))).slice(0, 5);
  if (ruta || q || ds.length < 1) { el.innerHTML = ''; el.classList.add('hidden'); return; }
  ds = ds.slice(0, 5); carI = Math.min(carI, ds.length - 1);
  el.classList.remove('hidden');
  el.innerHTML = '<div class="slides">' + ds.map(({ f, i }, n) => {
    const p = f.peli, fondo = p.fondo || p.caratula;
    const meta = [p.año, durTxt(durDe(f)), edadTxt(p.edad), p.nota ? '★ ' + String(p.nota).replace('.', ',') : ''].filter(Boolean).join(' · ');
    const aud = p.idiomas ? [...new Set(p.idiomas.audio.map(idiomaDe).filter(Boolean))] : [];
    return `<div class="slide${n === carI ? ' on' : ''}" data-n="${n}"><div class="fondo${p.fondo ? '' : ' borroso'}" style="background-image:url('${esc(fondo)}')"></div><div class="velo"></div>
      <div class="cont">${p.caratula ? `<img class="mini" src="${esc(p.caratula)}" alt="">` : ''}<div class="txt"><span class="eti">${p.destacada ? 'Destacada' : 'Recién agregada'}</span><h2>${esc(tituloDe(f))}</h2>
      <div class="m">${esc(meta)}${aud.length ? ' · ' + esc(aud.map(conBand).join(', ')) : ''}</div>${p.generos && p.generos.length ? `<div class="g">${esc(p.generos.join(' · '))}</div>` : ''}
      <p>${esc(p.sinopsis || '')}</p><div class="b"><button type="button" data-play="${i}">${ICON.play}Reproducir</button>${f.prog && f.prog.t > 60 && f.prog.t < f.prog.d - 90 ? `<span class="seguir">Vas en ${esc(durTxt(f.prog.t))}</span>` : ''}</div></div></div></div>`;
  }).join('') + '</div>' + (ds.length > 1 ? `<button type="button" class="flecha izq" aria-label="Anterior">${I('<path d="m15 6-6 6 6 6"/>')}</button><button type="button" class="flecha der" aria-label="Siguiente">${I('<path d="m9 6 6 6-6 6"/>')}</button><div class="puntos">${ds.map((_, n) => `<button type="button" data-p="${n}" class="${n === carI ? 'on' : ''}" aria-label="Destacada ${n + 1}"></button>`).join('')}</div>` : '');
  const ir = n => { carI = (n + ds.length) % ds.length; el.querySelectorAll('.slide').forEach(s => s.classList.toggle('on', +s.dataset.n === carI)); el.querySelectorAll('.puntos button').forEach(b => b.classList.toggle('on', +b.dataset.p === carI)); };
  const auto = () => { clearInterval(carT); if (ds.length > 1) carT = setInterval(() => { if (!document.hidden && !el.matches(':hover')) ir(carI + 1); }, 8000); };
  el.onclick = e => {
    const pl = e.target.closest('[data-play]'); if (pl) return abrir(items[+pl.dataset.play]);
    if (e.target.closest('.izq')) { ir(carI - 1); auto(); } else if (e.target.closest('.der')) { ir(carI + 1); auto(); }
    const pt = e.target.closest('[data-p]'); if (pt) { ir(+pt.dataset.p); auto(); }
  };
  auto();
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
  document.querySelectorAll('.carpeta[data-n],.fila[data-n]').forEach(el => el.style.display = !v || el.dataset.n.includes(v) ? '' : 'none');
}
$('#q').oninput = () => { filtrar(); pintarCarrusel(); pintarGrid(); };

// ---------- Abrir ----------
function abrir(f) {
  const k = kindOf(f), src = srcDe(f);
  if (k === 'file') { location.href = src + '&dl=1'; return; }
  const p = f.peli || {};
  Reproductor.abrir({ titulo: tituloDe(f), sub: metaTxt(f), sinopsis: p.sinopsis, fondo: p.fondo, kind: k, src, dl: src + '&dl=1', cred: false,
    insertar: k === 'video' ? location.origin + '/ver.html#v=' + encodeURIComponent(f.id) + '&f=' + encodeURIComponent(f.f) + '&t=' + encodeURIComponent(tituloDe(f)) : null,
    pistas: k === 'video' ? () => api('/api/pistas?id=' + encodeURIComponent(f.id)) : null,
    inicio: k === 'video' && f.prog && f.prog.t < f.prog.d - 90 ? f.prog.t : 0,
    progreso: k === 'video' ? (t, d) => { f.prog = { t, d }; api('/api/progreso', { id: f.id, t, d, nombre: f.nombre }).catch(() => {}); } : null });
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
  const v = kindOf(f) === 'video', visto = v && f.prog && f.prog.t > 0;
  const reiniciar = async () => { try { msg((await api('/api/progreso/borrar', { id: f.id })).mensaje); f.prog = null; render(true); } catch (e) { msg(e.message, true); } };
  if (!esAdmin()) return visto && abrirMenu(anchor, '<button data-a="rei">Restablecer progreso</button>', { rei: reiniciar });
  abrirMenu(anchor, '<button data-a="ren">Renombrar</button><button data-a="mov">Mover a…</button><button data-a="dup">Duplicar</button>'
    + (v ? '<button data-a="ide">Elegir qué película es</button><button data-a="edp">Audio, subtítulos y calidades</button>' : '')
    + (visto ? '<button data-a="rei">Restablecer progreso</button>' : '')
    + (v && f.peli ? `<button data-a="des">${f.peli.destacada ? 'Quitar de destacadas' : 'Destacar en el carrusel'}</button>` : '')
    + `<button data-a="ocu">${f.oculto ? 'Mostrar a todos' : 'Ocultar'}</button><hr><button data-a="del" class="bad">Eliminar</button>`, {
    ren: () => renombrar({ id: f.id }, f.nombre, true),
    mov: () => mover({ id: f.id }, f.nombre),
    dup: () => ventana('<h3>Duplicar</h3><p>Se creará una copia de «' + esc(f.nombre) + '» en la misma carpeta de su Drive, con sus pistas.</p>', async () => listo(await api('/api/admin', { op: 'duplicar', id: f.id })), 'Duplicar'),
    edp: () => editarPistas(f),
    rei: reiniciar,
    ide: () => ventana(`<h3>¿Qué película es?</h3><p>${f.peli && f.peli.titulo ? `Hoy aparece como «${esc(f.peli.titulo)}»${f.peli.año ? ' (' + f.peli.año + ')' : ''}. ` : 'No se reconoció sola. '}Pega el enlace de su página en IMDb, TMDB, Letterboxd, Wikipedia, FilmAffinity u otro sitio, o escribe su título y año.</p>
      <input class="t" id="ide" placeholder="https://www.imdb.com/title/tt…" autocomplete="off" inputmode="url"><p class="nota">Archivo: ${esc(f.nombre)}</p>`,
      async () => { const enlace = $('#ide').value.trim(); if (!enlace) throw new Error('Pega un enlace o escribe el título.'); listo(await api('/api/admin', { op: 'identificar', id: f.id, enlace })); }, 'Buscar'),
    des: async () => { try { msg((await api('/api/admin', { op: 'destacar', nombre: f.nombre, valor: !f.peli.destacada })).mensaje); render(true); } catch (e) { msg(e.message, true); } },
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
const cerrarDlg = () => { dlg.classList.remove('on'); box.innerHTML = ''; box.classList.remove('ancho'); };
dlg.addEventListener('mousedown', e => { if (e.target === dlg) cerrarDlg(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && dlg.classList.contains('on')) cerrarDlg(); });
function ventana(html, onOk, okText = 'Aceptar', danger = false, cancel = 'Cancelar') {
  box.classList.remove('ancho');
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
// ---------- Audio, subtítulos y calidades (admins): qué es cada archivo de la carpeta del video ----------
const IDIOMAS = [['spa', 'Español'], ['eng', 'Inglés'], ['por', 'Portugués'], ['fra', 'Francés'], ['ita', 'Italiano'], ['deu', 'Alemán'], ['jpn', 'Japonés'], ['kor', 'Coreano'], ['zho', 'Chino'], ['rus', 'Ruso'], ['', 'Otro idioma']];
const ALTURAS = [2160, 1440, 1080, 720, 480, 360, 240, 144];
const nomIdioma = c => (IDIOMAS.find(([k]) => k === c) || [, 'Otro idioma'])[1];
// Idioma por el nombre o el código («eng.srt», «Audio - Español latino.m4a», «sub.es.vtt»)
const CODIGOS = { spa: /\b(spa|es|esp|lat|latino|castellano|español|espanol|spanish)\b/i, eng: /\b(eng|en|ingl[eé]s|english)\b/i, por: /\b(por|pt|br|portugu[eé]s|portuguese)\b/i, fra: /\b(fra|fre|fr|franc[eé]s|french)\b/i,
  ita: /\b(ita|it|italian[oa]?)\b/i, deu: /\b(deu|ger|de|alem[aá]n|german)\b/i, jpn: /\b(jpn|ja|jap|japon[eé]s|japanese)\b/i, kor: /\b(kor|ko|coreano|korean)\b/i, zho: /\b(zho|chi|zh|chino|chinese)\b/i, rus: /\b(rus|ru|ruso|russian)\b/i };
const codigoDe = x => { const t = (typeof x === 'string' ? x : [x.c || x.lang, x.l || x.label].join(' ')).replace(/[._-]+/g, ' '); const h = Object.entries(CODIGOS).find(([, re]) => re.test(t)); return h ? h[0] : ''; };
async function editarPistas(f) {
  ventana('<h3>Audio, subtítulos y calidades</h3><p>Cargando…</p>', null, '', false, 'Cerrar');
  let r; try { r = await api('/api/admin', { op: 'pistas-ver', id: f.id }); } catch (e) { $('#dlgErr').textContent = e.message; return; }
  const m = r.man || {}, elegido = {};
  // Lo que ya dice el pistas.json
  (m.audios || []).slice(1).forEach(a => a.file && (elegido[a.file] = 'a:' + (a.lang && a.lang !== 'und' ? codigoDe({ c: a.lang }) || a.lang : codigoDe(a.label || ''))));
  (m.subs || []).forEach(t => elegido[t.file] = 's:' + (t.lang && t.lang !== 'und' ? codigoDe({ c: t.lang }) || t.lang : codigoDe(t.label || '')));
  (m.calidades || []).forEach(q => elegido[q.file] = 'q:' + q.alto);
  (m.ignorar || []).forEach(n => elegido[n] = 'no');
  // Lo que se adivina por el nombre de un archivo nuevo
  const adivinar = n => {
    let q = /^(\d{3,4})p\.mp4$/i.exec(n); if (q) return 'q:' + q[1];
    if (/\.(srt|vtt|ass|ssa)$/i.test(n)) return 's:' + codigoDe(n);
    if (/\.(m4a|mp3|aac|ogg|opus|flac|wav|ac3|eac3|dts|mka|mp2|wma)$/i.test(n)) return 'a:' + codigoDe(n);
    if (/\.(mp4|m4v|webm|mov|mkv)$/i.test(n)) { q = /(2160|1440|1080|720|480|360|240|144)/.exec(n); return 'q:' + (q ? q[1] : 720); }
    return 'no';
  };
  const opciones = val => `<optgroup label="Audio">${IDIOMAS.map(([c, t]) => `<option value="a:${c}"${val === 'a:' + c ? ' selected' : ''}>Audio en ${t.toLowerCase()}</option>`).join('')}</optgroup>
    <optgroup label="Subtítulos">${IDIOMAS.map(([c, t]) => `<option value="s:${c}"${val === 's:' + c ? ' selected' : ''}>Subtítulos en ${t.toLowerCase()}</option>`).join('')}</optgroup>
    <optgroup label="Calidad de video">${ALTURAS.map(a => `<option value="q:${a}"${val === 'q:' + a ? ' selected' : ''}>Video en ${a === 2160 ? '4K' : a + 'p'}</option>`).join('')}</optgroup>
    <option value="no"${val === 'no' ? ' selected' : ''}>No usar</option>`;
  const a0 = (m.audios || [])[0] || {}, a0c = a0.lang && a0.lang !== 'und' ? codigoDe({ c: a0.lang }) : codigoDe(a0.label || '');
  const ultimo = { n: null };
  const pintar = () => {
    box.classList.add('ancho');
    box.innerHTML = `<h3>Audio, subtítulos y calidades</h3><p>«${esc(tituloDe(f))}». Elige qué es cada archivo de su carpeta «${esc(r.carpeta)}» en Drive.</p>
      <div class="plista">
        <div class="pfila fija"><div class="pn">Audio original <small>(dentro del video)</small></div><select class="t" id="a0">${IDIOMAS.map(([c, t]) => `<option value="${c}"${c === a0c ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
        ${r.archivos.map(x => `<div class="pfila${x.nombre === ultimo.n ? ' nuevo' : ''}" data-f="${esc(x.nombre)}"><div class="pn" title="${esc(x.nombre)}">${esc(x.nombre)}${x.size ? `<small>${tam(x.size)}</small>` : ''}</div><select class="t">${opciones(elegido[x.nombre] || adivinar(x.nombre))}</select></div>`).join('')}
        ${r.archivos.length ? '' : '<p>La carpeta todavía no tiene archivos: sube audios, subtítulos o tus propias calidades.</p>'}
      </div>
      <div class="progreso hidden" id="pp"><i></i></div>
      <p class="nota">Puedes subir aquí o directo en Drive. Tus calidades no se vuelven a hacer: el robot solo saca audios y subtítulos. Un audio que el navegador no lee (AC3, DTS…) lo convierte el robot en unos minutos.</p>
      <div class="err" id="dlgErr"></div><div class="acts"><input type="file" id="pf" multiple hidden accept=".srt,.vtt,.ass,.ssa,.m4a,.mp3,.aac,.ac3,.eac3,.dts,.mka,.ogg,.opus,.flac,.wav,.mp4,.m4v,.webm,.mov,.mkv"><button class="sec" type="button" id="dlgSub">Subir archivos</button><span style="flex:1"></span><button class="sec" type="button" id="dlgNo">Cancelar</button><button type="button" id="dlgOk">Guardar</button></div>`;
    box.querySelectorAll('.plista .pfila[data-f] select').forEach(sel => sel.onchange = () => elegido[sel.closest('.pfila').dataset.f] = sel.value);
    box.querySelector('#dlgNo').onclick = cerrarDlg;
    box.querySelector('#dlgSub').onclick = () => $('#pf').click();
    box.querySelector('#pf').onchange = subir;
    box.querySelector('#dlgOk').onclick = guardar;
  };
  async function subir() {
    const files = [...$('#pf').files]; if (!files.length) return;
    const err = $('#dlgErr'), bar = $('#pp'); err.textContent = ''; $('#dlgSub').disabled = $('#dlgOk').disabled = true; bar.classList.remove('hidden');
    try {
      for (const [k, file] of files.entries()) {
        const u = await api('/api/subir', { id: f.id, tipo: 'archivo', nombre: file.name, size: file.size });
        await new Promise((ok, no) => {
          const x = new XMLHttpRequest(); x.open('PUT', u.url);
          x.upload.onprogress = e => { if (e.lengthComputable) bar.querySelector('i').style.width = ((k + e.loaded / e.total) / files.length * 100) + '%'; };
          x.onload = () => x.status < 300 ? ok() : no(new Error('Drive rechazó la subida (' + x.status + ').'));
          x.onerror = () => no(new Error('Se cortó la subida.')); x.send(file);
        });
        if (!r.archivos.some(a => a.nombre === u.nombre)) r.archivos.push({ nombre: u.nombre, size: file.size });
        ultimo.n = u.nombre; delete elegido[u.nombre];
      }
      pintar(); msg(files.length > 1 ? files.length + ' archivos subidos: elige qué es cada uno y guarda.' : 'Subido: elige qué es y guarda.');
    } catch (e) { err.textContent = e.message; $('#dlgSub').disabled = $('#dlgOk').disabled = false; bar.classList.add('hidden'); }
  }
  async function guardar() {
    const ok = $('#dlgOk'), err = $('#dlgErr'); ok.disabled = true; err.textContent = '';
    const p = { audio0: { lang: $('#a0').value, label: nomIdioma($('#a0').value) }, audios: [], subs: [], calidades: [], ignorar: [] }, altos = new Set();
    for (const row of box.querySelectorAll('.plista .pfila[data-f]')) {
      const file = row.dataset.f, [t, v] = row.querySelector('select').value.split(':');
      if (t === 'a') p.audios.push({ file, lang: v, label: nomIdioma(v) });
      else if (t === 's') p.subs.push({ file, lang: v, label: nomIdioma(v) });
      else if (t === 'q') { if (altos.has(+v)) { err.textContent = 'Hay dos archivos marcados como video en ' + v + 'p.'; ok.disabled = false; return; } altos.add(+v); p.calidades.push({ file, alto: +v }); }
      else p.ignorar.push(file);
    }
    try { listo(await api('/api/admin', { op: 'pistas-guardar', id: f.id, pistas: p })); } catch (e) { err.textContent = e.message; ok.disabled = false; }
  }
  pintar();
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
// ---------- Panel de administración (pestañas) ----------
const PESTANAS = [['sol', 'Solicitudes'], ['bib', 'Biblioteca'], ['esp', 'Espacio y Drive'], ['usu', 'Usuarios'], ['cor', 'Correo']];
function panel(tab = 'sol') {
  box.classList.add('ancho');
  box.innerHTML = '<div class="phead"><h3>Panel de administración</h3><button class="ico" type="button" id="pX" title="Cerrar">' + I('<path d="M6 6l12 12M18 6 6 18"/>') + '</button></div>'
    + '<div class="tabs" id="ptabs">' + PESTANAS.map(([k, t]) => `<button type="button" data-t="${k}" class="${k === tab ? 'on' : ''}">${t}</button>`).join('') + '</div><div id="pc"></div>';
  dlg.classList.add('on');
  box.querySelector('#pX').onclick = cerrarDlg;
  box.querySelector('#ptabs').onclick = e => { const b = e.target.closest('button[data-t]'); if (b) panel(b.dataset.t); };
  ({ sol: panelSolicitudes, bib: panelBiblioteca, esp: panelEspacio, usu: panelUsuarios, cor: panelCorreo })[tab]($('#pc'));
}
$('#bPanel').onclick = () => panel();
$('#bEspacio').onclick = () => panel('esp');

// Solicitudes: tabla ordenable
let solOrden = { campo: 'fecha', dir: -1 }, solFiltro = 'pendiente';
async function panelSolicitudes(el) {
  el.innerHTML = 'Cargando…';
  let ls;
  try { ls = (await api('/api/solicitudes')).solicitudes; } catch (e) { el.textContent = e.message; return; }
  const CAMPOS = { fecha: ['Antigüedad', s => s.fecha], pop: ['Popularidad', s => s.por.length], alfa: ['Nombre', s => s.titulo.toLowerCase()], año: ['Año', s => s.año || 0], estado: ['Estado', s => s.estado] };
  const pintar = () => {
    const vis = ls.filter(s => solFiltro === 'todas' || s.estado === solFiltro);
    const [, val] = CAMPOS[solOrden.campo];
    vis.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * solOrden.dir; });
    const th = k => `<th><button type="button" data-o="${k}" class="${solOrden.campo === k ? 'on' : ''}">${CAMPOS[k][0]}${solOrden.campo === k ? (solOrden.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
    el.innerHTML = `<div class="barra-sol"><div class="seg" id="sf">${['pendiente', 'agregada', 'todas'].map(f => `<button type="button" data-f="${f}" class="${solFiltro === f ? 'on' : ''}">${f === 'pendiente' ? 'Pendientes' : f === 'agregada' ? 'Agregadas' : 'Todas'}</button>`).join('')}</div><span class="cuantas">${vis.length} de ${ls.length}</span></div>`
      + (vis.length ? `<div class="tabla"><table class="sols"><thead><tr><th></th>${th('alfa')}${th('año')}${th('pop')}${th('fecha')}${th('estado')}<th></th></tr></thead><tbody>`
      + vis.map(s => `<tr><td>${s.poster ? `<img src="${esc(s.poster)}" alt="" loading="lazy">` : ''}</td><td><a href="https://www.imdb.com/title/${esc(s.id)}/" target="_blank" rel="noopener">${esc(s.titulo)}</a><small>${esc(s.por.join(', '))}</small></td><td>${s.año || ''}</td><td>${s.por.length}</td><td title="${esc(new Date(s.fecha).toLocaleString('es'))}">${hace(s.fecha)}</td><td><span class="est ${s.estado === 'agregada' ? 'ok' : ''}">${s.estado === 'agregada' ? 'Agregada' : 'Pendiente'}</span></td>`
        + `<td class="acc"><button type="button" class="sec" data-e="${esc(s.id)}" data-v="${s.estado === 'agregada' ? 'pendiente' : 'agregada'}">${s.estado === 'agregada' ? 'Reabrir' : 'Lista'}</button><button type="button" class="sec" data-q="${esc(s.id)}">Borrar</button></td></tr>`).join('') + '</tbody></table></div>'
      : '<p>No hay solicitudes aquí.</p>');
  };
  el.onclick = async e => {
    const o = e.target.closest('button[data-o]'); if (o) { solOrden = { campo: o.dataset.o, dir: solOrden.campo === o.dataset.o ? -solOrden.dir : (o.dataset.o === 'alfa' ? 1 : -1) }; return pintar(); }
    const f = e.target.closest('button[data-f]'); if (f) { solFiltro = f.dataset.f; return pintar(); }
    const b = e.target.closest('button[data-e],button[data-q]'); if (!b) return;
    try { const r = b.dataset.e ? await api('/api/solicitudes', { op: 'estado', id: b.dataset.e, estado: b.dataset.v }) : await api('/api/solicitudes', { op: 'quitar', id: b.dataset.q }); msg(r.mensaje); ls = (await api('/api/solicitudes')).solicitudes; pintar(); contarSols(); } catch (x) { msg(x.message, true); }
  };
  pintar();
}
function hace(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  return s < 3600 ? Math.max(1, Math.round(s / 60)) + ' min' : s < 86400 ? Math.round(s / 3600) + ' h' : Math.round(s / 86400) + ' d';
}

// Biblioteca: escanear
function panelBiblioteca(el) {
  el.innerHTML = `<p>«Escanear» vuelve a leer todos los Drive: agrega las películas nuevas, busca sus carátulas y sinopsis, actualiza idiomas de audio y subtítulos, y marca como lista cada solicitud que ya llegó (avisando por correo a quien la pidió).</p>
    <p>Las pistas de audio, subtítulos y calidades de una película nueva las prepara el robot en la nube; revisa cada 15 minutos.</p>
    <div><button type="button" id="pEsc">Escanear ahora</button></div><div id="escLog" class="log"></div>
    <p style="margin-top:6px">El catálogo (títulos, carátulas y sinopsis) está en <b>catalogo.json</b>, en la carpeta «Mis medios» del Drive principal: si una película salió mal, cambia su "titulo" ahí y escanea.</p>`;
  $('#pEsc').onclick = () => escanear($('#escLog'), $('#pEsc'));
}
async function escanear(log, btn) {
  const linea = t => { if (log) { const d = document.createElement('div'); d.textContent = t; log.append(d); log.scrollTop = log.scrollHeight; } };
  const bt = [btn, $('#bEscanear')].filter(Boolean); bt.forEach(b => { b.disabled = true; b.classList.add('girando'); });
  try {
    linea('Leyendo los Drive…');
    const { rutas } = await api('/api/escanear', {});
    for (const r of rutas) {
      linea('Carpeta ' + (r || 'Inicio') + '…');
      for (let n = 0; n < 30; n++) { const { faltan } = await api('/api/completar', { ruta: r }); if (!faltan) break; }
    }
    linea('Revisando solicitudes…');
    const fin = await api('/api/escanear', { fin: true });
    const t = 'Escaneo listo.' + (fin.llegaron.length ? ` Llegaron: ${fin.llegaron.join(', ')}.` + (fin.correos ? ` Se enviaron ${fin.correos} aviso${fin.correos > 1 ? 's' : ''} por correo.` : '') + (fin.sinCorreo ? ` ${fin.sinCorreo} persona(s) sin correo para avisar.` : '') : ' No había solicitudes por cerrar.');
    linea(t); msg(t); contarSols(); render(true);
  } catch (e) { linea('Error: ' + e.message); msg(e.message, true); }
  bt.forEach(b => { b.disabled = false; b.classList.remove('girando'); });
}
$('#bEscanear').onclick = () => escanear(null, null);

// Espacio y Drive
async function panelEspacio(el) {
  el.innerHTML = 'Cargando…';
  try {
    const d = await api('/api/espacio'), ok = d.drives.filter(x => x.limite);
    const uso = ok.reduce((a, x) => a + x.usado, 0), lim = ok.reduce((a, x) => a + x.limite, 0), mio = d.drives.find(x => x.mio);
    el.innerHTML = `<div class="total"><b>${fpct(pct(uso, lim))}</b> del espacio total usado</div><p>${tam(uso)} de ${tam(lim)} entre ${d.drives.length} Drive${d.drives.length === 1 ? '' : 's'}.</p>`
      + (mio && mio.limite ? `<p style="margin-top:8px">Tu Drive: <b style="color:var(--tx)">${fpct(pct(mio.usado, mio.limite))}</b> usado (${tam(mio.usado)} de ${tam(mio.limite)}).</p>` : '')
      + '<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">' + d.drives.map(x => x.error
        ? `<div class="disco"><div class="t"><span>${esc(x.admin)}${x.mio ? ' (tú)' : ''}</span><small>${esc(x.email || '')}</small></div><p class="err" style="color:var(--bad)">${esc(x.error)}</p></div>`
        : `<div class="disco"><div class="t"><span>${esc(x.admin)}${x.mio ? ' (tú)' : ''}${x.principal ? ' · principal' : ''}</span><small>${esc(x.email || '')}</small></div><div class="medidor"><i style="width:${Math.min(100, pct(x.usado, x.limite))}%"></i></div><div class="t"><small>${tam(x.usado)} de ${tam(x.limite)} · ${fpct(pct(x.usado, x.limite))}</small><small>Solo Drive: ${tam(x.usadoDrive)}</small></div></div>`).join('') + '</div>'
      + `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${d.tengoDrive ? '<button type="button" class="sec" id="recon">Reconectar mi Drive</button>' + (mio && !mio.principal ? '<button type="button" class="sec" id="descon">Quitar mi Drive</button>' : '') : '<button type="button" id="recon">Conectar mi Google Drive</button>'}</div>`
      + (d.tengoDrive ? '' : '<p style="margin-top:6px">Cada admin puede sumar su propio Drive. Se crea en él una carpeta «Mis medios» y lo que haya ahí se ve junto con lo demás.</p>');
    $('#recon').onclick = () => { location.href = API + '/api/drive/conectar'; };
    if ($('#descon')) $('#descon').onclick = async () => { if (!confirm('Lo que está en tu Drive dejará de verse en el sitio (no se borra). ¿Quitarlo?')) return; try { msg((await api('/api/drive/desconectar', {})).mensaje); panel('esp'); } catch (x) { msg(x.message, true); } };
  } catch (e) { el.textContent = e.message; }
}

// Usuarios
async function panelUsuarios(el) {
  el.innerHTML = '<p>Cualquiera con una cuenta de Google puede entrar y ver la biblioteca. Aquí puedes hacer admin a alguien o crear usuarios con contraseña.</p><div class="tabla"><table id="ut"><tr><td>Cargando…</td></tr></table></div>'
    + '<h3 style="margin-top:4px">Crear o cambiar</h3><input class="t" id="un" placeholder="Usuario, o correo de Google" autocomplete="off" autocapitalize="none">'
    + '<input class="t" id="uc" type="password" placeholder="Contraseña (mínimo 8; vacía si es un correo de Google)" autocomplete="new-password">'
    + '<select class="t" id="ur"><option value="usuario">Usuario: ve, reproduce, descarga y solicita</option><option value="admin">Admin: además agrega, organiza y conecta su Drive</option></select>'
    + '<div class="err" id="uerr"></div><div class="acts"><button type="button" id="uok">Guardar</button></div>';
  const err = el.querySelector('#uerr');
  const cargar = async () => {
    const { usuarios } = await api('/api/usuarios');
    usuarios.sort((a, b) => (a.rol === b.rol ? a.nombre.localeCompare(b.nombre) : a.rol === 'admin' ? -1 : 1));
    el.querySelector('#ut').innerHTML = usuarios.map(u => `<tr><td>${u.visible ? esc(u.visible) + ' <small>' + esc(u.nombre) + '</small>' : esc(u.nombre)}${u.google ? ' <small>Google</small>' : ''}</td><td>${u.rol}</td><td>${u.nombre === yo.nombre ? '' : `<button class="sec" type="button" data-e="${esc(u.nombre)}" data-r="${u.rol}">Editar</button> <button class="danger" type="button" data-b="${esc(u.nombre)}">Borrar</button>`}</td></tr>`).join('');
  };
  el.querySelector('#ut').onclick = async e => {
    const ed = e.target.closest('button[data-e]'); if (ed) { el.querySelector('#un').value = ed.dataset.e; el.querySelector('#ur').value = ed.dataset.r; el.querySelector('#uc').focus(); return; }
    const b = e.target.closest('button[data-b]'); if (!b) return;
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = '¿Seguro?'; return; }
    try { await api('/api/usuarios', { op: 'borrar', nombre: b.dataset.b }); await cargar(); } catch (x) { err.textContent = x.message; }
  };
  el.querySelector('#uok').onclick = async () => {
    err.className = 'err'; err.textContent = '';
    try {
      await api('/api/usuarios', { op: 'guardar', nombre: el.querySelector('#un').value.trim(), clave: el.querySelector('#uc').value, rol: el.querySelector('#ur').value });
      el.querySelector('#uc').value = ''; err.className = 'ok'; err.textContent = 'Guardado.'; await cargar();
    } catch (x) { err.textContent = x.message; }
  };
  try { await cargar(); } catch (x) { err.textContent = x.message; }
}

// Correo: los avisos salen desde un Gmail conectado; las respuestas van a movies@emailrouting.xyz
async function panelCorreo(el) {
  el.innerHTML = 'Cargando…';
  try {
    const { gmail } = await api('/api/config');
    el.innerHTML = `<p>Cuando llega una película que alguien solicitó, Butaca le avisa por correo. Los correos salen desde un Gmail que conectas aquí, y las respuestas llegan a <b>movies@emailrouting.xyz</b>.</p>
      <div class="disco"><div class="t"><span>Gmail para los avisos</span><small>${gmail ? esc(gmail) : 'sin conectar'}</small></div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" id="gcon">${gmail ? 'Cambiar o reconectar' : 'Conectar Gmail'}</button>${gmail ? '<button type="button" class="sec" id="gprueba">Enviarme un correo de prueba</button>' : ''}</div>
      <p>Solo reciben aviso quienes entraron con Google (los usuarios con contraseña no tienen correo).</p>`;
    $('#gcon').onclick = () => { location.href = API + '/api/gmail/conectar'; };
    if ($('#gprueba')) $('#gprueba').onclick = async () => { try { msg((await api('/api/gmail/prueba', {})).mensaje); } catch (x) { msg(x.message, true); } };
  } catch (e) { el.textContent = e.message; }
}

// ---------- Solicitar películas: búsqueda en IMDb (o un enlace de IMDb) ----------
function proximoSabado() {
  const n = new Date(), d = new Date(n); d.setHours(13, 0, 0, 0);
  d.setDate(n.getDate() + ((6 - n.getDay() + 7) % 7)); if (d <= n) d.setDate(d.getDate() + 7);
  return d;
}
function cuentaRegresiva(el) {
  const meta = proximoSabado();
  const tic = () => {
    if (!el.isConnected) return clearInterval(iv);
    let s = Math.max(0, Math.floor((meta - Date.now()) / 1000));
    const d = Math.floor(s / 86400); s %= 86400; const h = Math.floor(s / 3600); s %= 3600; const m = Math.floor(s / 60); s %= 60;
    el.innerHTML = [[d, 'días'], [h, 'horas'], [m, 'min'], [s, 'seg']].map(([v, l]) => `<span><b>${String(v).padStart(2, '0')}</b>${l}</span>`).join('');
  };
  const iv = setInterval(tic, 1000); tic();
}
const AVISO_PLAZO = () => `<div class="plazo"><p>Lo más probable es que esté lista <b>para el próximo fin de semana</b>: el sábado ${proximoSabado().toLocaleDateString('es', { day: 'numeric', month: 'long' })} a las 13:00.</p><div class="cuenta-reg"></div><p>¿La necesitas antes? Escríbeme a <a href="mailto:movies@emailrouting.xyz">movies@emailrouting.xyz</a>. Cuando llegue te aviso por correo.</p></div>`;
$('#bPedir').onclick = () => {
  let elegido = null, t = 0;
  ventana(`<h3>Solicitar una película</h3><p>Busca por nombre o pega el enlace de IMDb.</p>
    <input class="t" id="sq" placeholder="Ej.: Interestelar, o https://www.imdb.com/title/tt0816692/" autocomplete="off">
    <div class="sug" id="sug"></div><div id="hecho"></div><h3 style="margin-top:6px;font-size:.95rem">Tus solicitudes</h3><div id="sols">Cargando…</div>`, async () => {
    if (!elegido) throw new Error('Elige una película de la lista.');
    const r = await api('/api/solicitudes', { op: 'pedir', id: elegido.id }); msg(r.mensaje);
    $('#hecho').innerHTML = `<p class="ok" style="margin-bottom:6px">${esc(r.mensaje)}</p>` + (/ya está/.test(r.mensaje) ? '' : AVISO_PLAZO());
    if ($('#hecho .cuenta-reg')) cuentaRegresiva($('#hecho .cuenta-reg'));
    elegido = null; $('#sq').value = ''; $('#sug').innerHTML = ''; $('#dlgOk').disabled = false; cargarSols(); contarSols();
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
    let { solicitudes } = await api('/api/solicitudes');
    solicitudes = solicitudes.filter(s => s.por.includes(yo.nombre));
    el.innerHTML = solicitudes.length ? solicitudes.map(s => `<div class="sol">${s.poster ? `<img src="${esc(s.poster)}" alt="" loading="lazy">` : '<span class="np"></span>'}<div class="tx"><a href="https://www.imdb.com/title/${esc(s.id)}/" target="_blank" rel="noopener">${esc(s.titulo)}${s.año ? ' (' + s.año + ')' : ''}</a><small>${s.estado === 'agregada' ? 'Ya está en Butaca' : 'Probablemente para el sábado ' + proximoSabado().toLocaleDateString('es', { day: 'numeric', month: 'long' }) + ', 13:00'}</small></div><span class="est ${s.estado === 'agregada' ? 'ok' : ''}">${s.estado === 'agregada' ? 'Llegó' : 'Pendiente'}</span><button type="button" class="sec" data-q="${esc(s.id)}">Quitar</button></div>`).join('') : '<p>Ninguna todavía.</p>';
    el.onclick = async e => {
      const b = e.target.closest('button[data-q]'); if (!b) return;
      try { msg((await api('/api/solicitudes', { op: 'quitar', id: b.dataset.q })).mensaje); cargarSols(); contarSols(); } catch (x) { msg(x.message, true); }
    };
  } catch (x) { el.textContent = x.message; }
}
async function contarSols() {
  if (!esAdmin()) return;
  try { const { pendientes } = await api('/api/solicitudes'); $('#nPanel').textContent = pendientes; $('#nPanel').classList.toggle('hidden', !pendientes); } catch {}
}

// Menú de la cuenta
$('#bYo').onclick = e => {
  e.stopPropagation();
  abrirMenu($('#bYo'), `<div class="who"><b>${esc(yo.visible || yo.nombre)}</b>${yo.visible ? esc(yo.nombre) + '<br>' : ''}${yo.rol === 'admin' ? 'Administrador' : 'Usuario'}</div><hr><button data-a="out">Cerrar sesión</button>`, { out: salir });
};

// ---------- Arranque ----------
function start() {
  show('app');
  const visible = yo.visible || yo.nombre; $('#yoNom').textContent = visible;
  $('#yoAv').innerHTML = yo.foto ? `<img src="${esc(yo.foto)}" alt="" referrerpolicy="no-referrer">` : esc((visible[0] || '?').toUpperCase());
  $('#adminBtns').classList.toggle('hidden', !esAdmin());
  const h = location.hash;
  if (/^#drive-(ok|error)=/.test(h)) { const ok = h.startsWith('#drive-ok='); msg(decodeURIComponent(h.split('=').slice(1).join('=')), !ok); history.replaceState(null, '', location.pathname + '#/'); }
  if (esAdmin()) { espacioPill(); contarSols(); }
  render();
}
api('/api/yo').then(d => { yo = d.usuario; yo ? start() : show('login'); }).catch(() => { show('login'); $('#eLogin').textContent = 'No se pudo contactar al servidor.'; });
})();
