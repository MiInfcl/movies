// Sitio en la nube de "Mis medios". Todo pasa por el Worker (C.API): sesión, lista de Drive, videos, pistas y acciones de admin.
(() => {
const C = window.MEDIOS, API = C.API;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const size = n => n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.ceil(n / 1e3) + ' KB';
const kindOf = f => f.carpeta ? 'folder'
  : /^video\//.test(f.mime) || /\.(mkv|avi|ts|wmv|mp4|m4v|webm|mov)$/i.test(f.nombre) ? 'video'
  : /^audio\//.test(f.mime) ? 'audio' : /^image\//.test(f.mime) ? 'image' : 'file';
const ICON = {
  folder: '<svg viewBox="0 0 24 24"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h3.9l2 2.2h7.1A2.5 2.5 0 0 1 21 8.7v8.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>',
  video: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z"/></svg>',
  audio: '<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2.5"/><circle cx="17" cy="16" r="2.5"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 3-3 4 4"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M7 3h6l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M13 3v5h5"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m6 14 6-6 6 6"/></svg>',
  dl: '<svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 19h14"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>'
};

// El service worker de la versión anterior ya no se usa
navigator.serviceWorker?.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});

async function api(path, body) {
  const r = await fetch(API + path, body === undefined ? { credentials: 'include' }
    : { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok) { const e = new Error((j && j.mensaje) || 'Error ' + r.status); e.status = r.status; throw e; }
  return j;
}
const msg = (t, cls) => { const m = $('#msg'); m.className = cls || ''; m.textContent = t; };

// ---------- Sesión ----------
let yo = null;
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

// ---------- Lista ----------
let current = null, ROOT = null, items = [];
async function render() {
  const id = location.hash.replace(/^#/, '').replace(/^drive-conectado$/, '') || ROOT || '';
  $('#list').innerHTML = '<li class="empty">Cargando…</li>';
  try {
    const d = await api('/api/lista' + (id ? '?carpeta=' + encodeURIComponent(id) : ''));
    ROOT = d.raiz; current = d.carpeta; items = d.items; $('#aviso').classList.add('hidden');
    $('#crumbs').innerHTML = '<a href="#">Inicio</a>' + d.ruta.map(f => ' / <a href="#' + f.id + '">' + esc(f.nombre) + '</a>').join('');
    const padre = d.ruta.length > 1 ? d.ruta[d.ruta.length - 2].id : '';
    const up = current === ROOT ? '' : `<li><a class="item" href="#${padre}"><span class="ic">${ICON.up}</span><span class="nm">Subir</span></a></li>`;
    const admin = yo.rol === 'admin';
    $('#list').innerHTML = up + (items.map((f, i) => {
      const k = kindOf(f), isD = k === 'folder', src = API + '/api/stream/' + f.id + '/' + encodeURIComponent(f.nombre);
      return `<li data-n="${esc(f.nombre.toLowerCase())}"><a class="item" href="${isD ? '#' + f.id : src}" data-k="${k}" data-i="${i}"><span class="ic">${ICON[k]}</span><span class="nm">${esc(f.nombre)}</span><span class="sz">${f.size ? size(f.size) : ''}</span></a>`
        + (isD ? '' : `<a class="dl" href="${src}?dl=1" title="Descargar a este dispositivo">${ICON.dl}<span>Descargar</span></a>`)
        + (admin ? `<button class="more" type="button" data-i="${i}" title="Acciones" aria-label="Acciones de ${esc(f.nombre)}">${ICON.more}</button>` : '') + '</li>';
    }).join('') || '<li class="empty">Carpeta vacía</li>');
    $('#q').value = '';
  } catch (e) {
    $('#list').innerHTML = '';
    if (e.status === 401) return salir();
    if (e.status === 503 && yo.rol === 'admin') {
      $('#aviso').innerHTML = '<span>' + esc(e.message) + '</span><button type="button" id="conectar">Conectar Google Drive</button>';
      $('#aviso').classList.remove('hidden'); $('#conectar').onclick = () => { location.href = API + '/api/drive/conectar'; };
    } else { $('#aviso').innerHTML = '<span>' + esc(e.message) + '</span>'; $('#aviso').classList.remove('hidden'); }
  }
  refreshQueue();
}
addEventListener('hashchange', render);
$('#q').oninput = e => { const v = e.target.value.toLowerCase(); document.querySelectorAll('#list li[data-n]').forEach(li => li.style.display = li.dataset.n.includes(v) ? '' : 'none'); };

// Reproductor (compartido con el servidor del PC)
$('#list').addEventListener('click', e => {
  const a = e.target.closest('a[data-k]'); if (!a || !['video', 'audio', 'image'].includes(a.dataset.k)) return;
  e.preventDefault(); const f = items[+a.dataset.i], src = a.getAttribute('href');
  Reproductor.abrir({ titulo: f.nombre, kind: a.dataset.k, src, dl: src + '?dl=1', cred: true,
    pistas: async () => api('/api/pistas?nombre=' + encodeURIComponent(f.nombre)) });
});

// ---------- Pedidos de descarga por enlace ----------
async function sendLink() {
  const url = $('#lk').value.trim(); if (!url) return;
  $('#go').disabled = true; msg('Enviando…');
  try { msg((await api('/api/pedido', { url, carpeta: current })).mensaje, 'ok'); $('#lk').value = ''; refreshQueue(); }
  catch (e) { msg(e.message, 'err'); }
  $('#go').disabled = false;
}
$('#go').onclick = sendLink;
$('#lk').addEventListener('keydown', e => { if (e.key === 'Enter') sendLink(); });
async function refreshQueue() {
  const box = $('#queue');
  try {
    const { pedidos } = await api('/api/pedidos');
    if (!pedidos.length) return box.classList.add('hidden');
    box.innerHTML = '<b>Descargas en la nube</b>' + pedidos.map(p => `<div class="${p.estado === 'error' ? 'e' : ''}">${p.estado === 'error' ? 'Falló: ' : p.estado === 'descargando' ? 'Descargando: ' : 'En cola: '}${esc(p.url)}${p.error ? ' (' + esc(p.error) + ')' : ''}</div>`).join('');
    box.classList.remove('hidden');
  } catch { box.classList.add('hidden'); }
}
setInterval(() => { if (!document.hidden && yo && !$('#vApp').classList.contains('hidden')) refreshQueue(); }, 30000);

// ---------- Admin: ventanas propias, menú y acciones ----------
const dlg = $('#dlg'), box = dlg.querySelector('.box');
const cerrarDlg = () => { dlg.classList.remove('on'); box.innerHTML = ''; };
dlg.addEventListener('click', e => { if (e.target === dlg) cerrarDlg(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && dlg.classList.contains('on')) cerrarDlg(); });
function ventana(html, onOk, okText = 'Aceptar', danger = false) {
  box.innerHTML = html + `<div class="err" id="dlgErr"></div><div class="acts"><button class="ghost" type="button" id="dlgNo">Cancelar</button><button type="button" id="dlgOk" class="${danger ? 'danger' : ''}">${esc(okText)}</button></div>`;
  dlg.classList.add('on');
  const ok = box.querySelector('#dlgOk'), err = box.querySelector('#dlgErr');
  box.querySelector('#dlgNo').onclick = cerrarDlg;
  const run = async () => { ok.disabled = true; err.textContent = ''; try { await onOk(); } catch (e) { err.textContent = e.message; ok.disabled = false; } };
  ok.onclick = run;
  box.querySelectorAll('input.t').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') run(); }));
  const first = box.querySelector('input.t'); if (first) { first.focus(); first.select(); }
}
const listo = t => { cerrarDlg(); msg(t, 'ok'); render(); };

const menu = $('#menu');
const cerrarMenu = () => menu.classList.remove('on');
addEventListener('click', e => { if (!e.target.closest('#menu') && !e.target.closest('button.more')) cerrarMenu(); });
addEventListener('scroll', cerrarMenu, { passive: true });
$('#list').addEventListener('click', e => {
  const b = e.target.closest('button.more'); if (!b) return;
  e.stopPropagation();
  const f = items[+b.dataset.i];
  menu.innerHTML = '<button data-a="renombrar">Renombrar</button><button data-a="mover">Mover a…</button><button data-a="duplicar">Duplicar</button><button data-a="eliminar" class="bad">Eliminar</button>';
  const r = b.getBoundingClientRect(); menu.classList.add('on');
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
  menu.style.top = (r.bottom + h + 8 < innerHeight ? r.bottom + 6 : r.top - h - 6) + 'px';
  menu.onclick = ev => { const a = ev.target.closest('button')?.dataset.a; if (!a) return; cerrarMenu(); acciones[a](f); };
});
const acciones = {
  renombrar(f) {
    ventana(`<h3>Renombrar</h3><input class="t" id="nn" value="${esc(f.nombre)}" autocomplete="off">`, async () => {
      const nombre = $('#nn').value.trim(); if (!nombre || nombre === f.nombre) return cerrarDlg();
      listo((await api('/api/admin', { op: 'renombrar', id: f.id, nombre })).mensaje);
    }, 'Renombrar');
    const i = $('#nn'), dot = f.nombre.lastIndexOf('.'); if (dot > 0 && !f.carpeta) i.setSelectionRange(0, dot);
  },
  async mover(f) {
    ventana('<h3>Mover «' + esc(f.nombre) + '»</h3><p>Elige la carpeta de destino</p><div class="pick">Cargando…</div>', async () => {
      const sel = box.querySelector('.pick button.on'); if (!sel) throw new Error('Elige una carpeta.');
      listo((await api('/api/admin', { op: 'mover', id: f.id, destino: sel.dataset.id })).mensaje);
    }, 'Mover');
    const pick = box.querySelector('.pick');
    try {
      const { carpetas } = await api('/api/carpetas');
      pick.innerHTML = carpetas.filter(c => c.id !== f.id).map(c => `<button type="button" data-id="${esc(c.id)}">${c.ruta === '/' ? 'Inicio' : esc(c.ruta.slice(1, -1))}</button>`).join('');
      pick.onclick = e => { const b = e.target.closest('button'); if (!b) return; pick.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
    } catch (e) { pick.textContent = e.message; }
  },
  duplicar(f) {
    ventana('<h3>Duplicar</h3><p>Se creará una copia de «' + esc(f.nombre) + '» en esta misma carpeta de Drive.</p>', async () => {
      $('#dlgOk').textContent = 'Duplicando…';
      listo((await api('/api/admin', { op: 'duplicar', id: f.id })).mensaje);
    }, 'Duplicar');
  },
  eliminar(f) {
    ventana('<h3>Eliminar</h3><p>«' + esc(f.nombre) + '»' + (f.carpeta ? ' y todo su contenido' : '') + ' irá a la papelera de Google Drive, donde se puede recuperar durante 30 días.</p>', async () => {
      listo((await api('/api/admin', { op: 'eliminar', id: f.id })).mensaje);
    }, 'Eliminar', true);
  }
};
$('#nueva').onclick = () => ventana('<h3>Nueva carpeta</h3><input class="t" id="nn" placeholder="Nombre de la carpeta" autocomplete="off">', async () => {
  const nombre = $('#nn').value.trim(); if (!nombre) throw new Error('Escribe un nombre.');
  listo((await api('/api/admin', { op: 'carpeta', dir: current, nombre })).mensaje);
}, 'Crear');

$('#usuarios').onclick = async () => {
  box.innerHTML = '<h3>Usuarios</h3><table id="ut"><tr><td>Cargando…</td></tr></table>'
    + '<h3 style="margin-top:6px">Crear o cambiar</h3><input class="t" id="un" placeholder="Usuario, o correo de Google" autocomplete="off" autocapitalize="none">'
    + '<input class="t" id="uc" type="password" placeholder="Contraseña (mínimo 8; vacía si es un correo de Google)" autocomplete="new-password">'
    + '<select id="ur"><option value="usuario">Usuario: ve y reproduce</option><option value="admin">Admin: además administra archivos y usuarios</option></select>'
    + '<div class="err" id="uerr"></div><div class="acts"><button class="ghost" type="button" id="uno">Cerrar</button><button type="button" id="uok">Guardar</button></div>';
  dlg.classList.add('on'); box.querySelector('#uno').onclick = cerrarDlg;
  const err = box.querySelector('#uerr');
  const cargar = async () => {
    const { usuarios } = await api('/api/usuarios');
    box.querySelector('#ut').innerHTML = usuarios.map(u => `<tr><td>${esc(u.nombre)}${u.google ? ' <small>(Google)</small>' : ''}</td><td>${u.rol}</td><td>${u.nombre === yo.nombre ? '' : `<button class="danger" type="button" data-b="${esc(u.nombre)}">Borrar</button>`}</td></tr>`).join('');
  };
  box.querySelector('#ut').onclick = async e => {
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

// ---------- Arranque ----------
function start() {
  show('app');
  $('#who').innerHTML = `<b>${esc(yo.nombre)}</b>${yo.rol === 'admin' ? '<span class="rol">admin</span>' : ''}<a class="out" href="#" id="bOut">Cerrar sesión</a>`;
  $('#bOut').onclick = e => { e.preventDefault(); salir(); };
  $('#adminBtns').classList.toggle('hidden', yo.rol !== 'admin');
  if (location.hash === '#drive-conectado') { msg('Google Drive quedó conectado.', 'ok'); history.replaceState(null, '', location.pathname); }
  render();
}
api('/api/yo').then(d => { yo = d.usuario; yo ? start() : show('login'); }).catch(() => { show('login'); $('#eLogin').textContent = 'No se pudo contactar al servidor.'; });
})();
