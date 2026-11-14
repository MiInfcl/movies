// Clon en la nube de "Mis medios": lista una carpeta de Google Drive, reproduce y descarga sus archivos,
// y deja pedidos de descarga por enlace que procesa GitHub Actions. Sin servidor propio.
(() => {
const C = window.MEDIOS, API = 'https://www.googleapis.com/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER = 'application/vnd.google-apps.folder';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const size = n => n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.ceil(n / 1e3) + ' KB';
const MEDIA_EXT = /\.(mp4|m4v|webm|mkv|mov|avi|ts|wmv|mp3|m4a|aac|flac|wav|ogg|opus|jpe?g|png|gif|webp)$/i;
const kindOf = f => f.mimeType === FOLDER ? 'folder'
  : /^video\//.test(f.mimeType) || /\.(mkv|avi|ts|wmv)$/i.test(f.name) ? 'video'
  : /^audio\//.test(f.mimeType) ? 'audio' : /^image\//.test(f.mimeType) ? 'image' : 'file';
const ICON = {
  folder: '<svg viewBox="0 0 24 24"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h3.9l2 2.2h7.1A2.5 2.5 0 0 1 21 8.7v8.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>',
  video: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z"/></svg>',
  audio: '<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2.5"/><circle cx="17" cy="16" r="2.5"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 3-3 4 4"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M7 3h6l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M13 3v5h5"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m6 14 6-6 6 6"/></svg>',
  dl: '<svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 19h14"/></svg>'
};

// ---------- Sesión (Google Identity Services) ----------
const store = { get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
                set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
                del: k => { try { localStorage.removeItem(k); } catch {} } };
let auth = store.get('medios.auth');           // { token, exp, email }
let tokenClient = null, pendingAuth = null;
const valid = () => auth && auth.token && auth.exp > Date.now() + 60e3;

function initGis() {
  if (tokenClient || !window.google?.accounts?.oauth2) return !!tokenClient;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: C.CLIENT_ID, scope: SCOPE,
    callback: r => {
      const p = pendingAuth; pendingAuth = null;
      if (r.error) return p?.reject(new Error(r.error_description || r.error));
      auth = { token: r.access_token, exp: Date.now() + (r.expires_in - 30) * 1000, email: auth?.email || '' };
      store.set('medios.auth', auth); sendTokenToSW(); p?.resolve();
    },
    error_callback: e => { const p = pendingAuth; pendingAuth = null; p?.reject(new Error(e.message || e.type || 'No se pudo iniciar sesión')); }
  });
  return true;
}
function requestToken(interactive) {
  if (!initGis()) return Promise.reject(new Error('Google todavía no carga. Intenta de nuevo.'));
  return new Promise((resolve, reject) => {
    pendingAuth = { resolve, reject };
    tokenClient.requestAccessToken({ prompt: interactive ? 'select_account' : '', login_hint: auth?.email || undefined });
  });
}
async function ensureToken() { if (!valid()) await requestToken(false); return auth.token; }
async function drive(url, opt = {}) {
  const go = async () => fetch(url, { ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + await ensureToken() } });
  let r = await go();
  if (r.status === 401) { auth.exp = 0; r = await go(); }
  if (!r.ok) { let m = r.status + ''; try { m = (await r.json()).error.message; } catch {} throw new Error(m); }
  return r;
}

// ---------- Service worker: agrega el token a las peticiones de video/descarga ----------
async function sendTokenToSW() {
  if (!('serviceWorker' in navigator) || !auth?.token) return;
  const reg = await navigator.serviceWorker.ready;
  reg.active?.postMessage({ token: auth.token, exp: auth.exp });
}
navigator.serviceWorker?.addEventListener('message', async e => {
  if (e.data === 'token?') { try { await ensureToken(); sendTokenToSW(); } catch {} }
});

// ---------- Vistas ----------
function show(v) { $('#vLogin').classList.toggle('hidden', v !== 'login'); $('#vApp').classList.toggle('hidden', v !== 'app'); }
$('#bLogin').onclick = async () => {
  $('#eLogin').textContent = '';
  try {
    await requestToken(true);
    const u = await (await drive(API + '/about?fields=user(emailAddress)')).json();
    auth.email = u.user.emailAddress; store.set('medios.auth', auth);
    start();
  } catch (e) { $('#eLogin').textContent = e.message; }
};
$('#bOut').onclick = () => {
  if (auth?.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(auth.token, () => {});
  auth = null; store.del('medios.auth'); caches.delete('medios-auth'); show('login');
};

let ROOT = null, QUEUE = null;
async function findFolder(name, parent) {
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='${FOLDER}' and trashed=false` + (parent ? ` and '${parent}' in parents` : '');
  const r = await (await drive(API + '/files?pageSize=10&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true&q=' + encodeURIComponent(q))).json();
  return r.files[0]?.id || null;
}
async function listFolder(id) {
  let out = [], page = '';
  do {
    const q = `'${id}' in parents and trashed=false`;
    const r = await (await drive(API + '/files?pageSize=1000&orderBy=folder,name_natural&supportsAllDrives=true&includeItemsFromAllDrives=true'
      + '&fields=nextPageToken,files(id,name,mimeType,size)&q=' + encodeURIComponent(q) + (page ? '&pageToken=' + page : ''))).json();
    out = out.concat(r.files); page = r.nextPageToken;
  } while (page);
  return out;
}

async function crumbs(id) {
  const chain = [];
  for (let cur = id, i = 0; cur && cur !== ROOT && i < 20; i++) {
    const f = await (await drive(API + '/files/' + cur + '?fields=id,name,parents&supportsAllDrives=true')).json();
    chain.unshift(f); cur = f.parents?.[0];
  }
  return '<a href="#">Inicio</a>' + chain.map(f => ' / <a href="#' + f.id + '">' + esc(f.name) + '</a>').join('');
}

let current = null;
async function render() {
  const id = location.hash.slice(1) || ROOT; current = id;
  $('#list').innerHTML = '<li class="empty">Cargando…</li>';
  try {
    const [items, cr] = await Promise.all([listFolder(id), crumbs(id)]);
    if (current !== id) return;
    $('#crumbs').innerHTML = cr;
    const visible = items.filter(f => !/^[._$]/.test(f.name));
    const up = id === ROOT ? '' : `<li><a class="item" href="javascript:history.back()"><span class="ic">${ICON.up}</span><span class="nm">Subir</span></a></li>`;
    $('#list').innerHTML = up + (visible.map(f => {
      const k = kindOf(f), isD = k === 'folder';
      const src = 'stream/' + f.id + '/' + encodeURIComponent(f.name);
      return `<li data-n="${esc(f.name.toLowerCase())}"><a class="item" href="${isD ? '#' + f.id : src}" data-k="${k}" data-n="${esc(f.name)}"><span class="ic">${ICON[k]}</span><span class="nm">${esc(f.name)}</span><span class="sz">${f.size ? size(+f.size) : ''}</span></a>`
        + (isD ? '' : `<a class="dl" href="${src}?dl=1" download="${esc(f.name)}" title="Descargar a este dispositivo">${ICON.dl}<span>Descargar</span></a>`) + '</li>';
    }).join('') || '<li class="empty">Carpeta vacía</li>');
    $('#q').value = '';
  } catch (e) { $('#list').innerHTML = '<li class="empty">No se pudo abrir la carpeta: ' + esc(e.message) + '</li>'; }
  refreshQueue();
}
addEventListener('hashchange', render);

// Reproductor (mismo comportamiento que el servidor local)
const pl = $('#pl'), body = $('#pb');
const closePl = () => { pl.classList.remove('on'); body.innerHTML = ''; };
$('#x').onclick = closePl; pl.onclick = e => { if (e.target === pl) closePl(); };
addEventListener('keydown', e => { if (e.key === 'Escape') closePl(); });
$('#list').addEventListener('click', e => {
  const a = e.target.closest('a[data-k]'); if (!a || !['video', 'audio', 'image'].includes(a.dataset.k)) return;
  e.preventDefault(); const k = a.dataset.k, u = a.getAttribute('href');
  $('#pt').textContent = a.dataset.n;
  body.innerHTML = k === 'image' ? '<img src="' + u + '">' : '<' + k + ' src="' + u + '" controls autoplay playsinline></' + k + '>';
  body.firstChild.onerror = () => body.insertAdjacentHTML('beforeend', '<p class="note">Tu navegador no puede reproducir este formato aquí. <a href="' + u + '?dl=1" download>Descargar el archivo</a></p>');
  pl.classList.add('on');
});
$('#q').oninput = e => { const v = e.target.value.toLowerCase(); document.querySelectorAll('#list li[data-n]').forEach(li => li.style.display = li.dataset.n.includes(v) ? '' : 'none'); };

// ---------- Pedidos de descarga por enlace ----------
async function queueFolder() { return QUEUE || (QUEUE = await findFolder(C.QUEUE_NAME, ROOT)); }
async function sendLink() {
  const msg = $('#msg'), url = $('#lk').value.trim(); if (!url) return;
  msg.className = ''; msg.textContent = 'Revisando enlace…';
  let u; try { u = new URL(url); } catch { msg.className = 'err'; return msg.textContent = 'Eso no parece un enlace.'; }
  if (!/^https?:$/.test(u.protocol)) { msg.className = 'err'; return msg.textContent = 'Solo enlaces http o https.'; }
  if (!MEDIA_EXT.test(u.pathname)) msg.textContent = 'El enlace no termina en un formato conocido; se revisará al descargar.';
  $('#go').disabled = true;
  try {
    const qid = await queueFolder(); if (!qid) throw new Error('Falta la carpeta ' + C.QUEUE_NAME + ' en Drive.');
    const meta = { name: 'pedido-' + Date.now() + '.json', parents: [qid], mimeType: 'application/json' };
    const data = JSON.stringify({ url, carpeta: current || ROOT, por: auth.email, fecha: new Date().toISOString() });
    const fd = new FormData();
    fd.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    fd.append('file', new Blob([data], { type: 'application/json' }));
    await drive('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', { method: 'POST', body: fd });
    msg.className = 'ok'; msg.textContent = 'Pedido enviado. Se descarga en la nube en unos minutos y aparecerá en esta carpeta.';
    $('#lk').value = ''; refreshQueue();
  } catch (e) { msg.className = 'err'; msg.textContent = 'No se pudo enviar: ' + e.message; }
  $('#go').disabled = false;
}
$('#go').onclick = sendLink;
$('#lk').addEventListener('keydown', e => { if (e.key === 'Enter') sendLink(); });

async function refreshQueue() {
  const box = $('#queue');
  try {
    const qid = await queueFolder(); if (!qid) return box.classList.add('hidden');
    const files = (await listFolder(qid)).filter(f => /\.json$/.test(f.name));
    if (!files.length) return box.classList.add('hidden');
    const rows = await Promise.all(files.slice(0, 10).map(async f => {
      let d = {}; try { d = await (await drive(API + '/files/' + f.id + '?alt=media')).json(); } catch {}
      const err = /\.error\.json$/.test(f.name);
      return `<div class="${err ? 'e' : ''}">${err ? 'Falló: ' : d.estado === 'descargando' ? 'Descargando: ' : 'En cola: '}${esc(d.url || f.name)}${err && d.error ? ' (' + esc(d.error) + ')' : ''}</div>`;
    }));
    box.innerHTML = '<b>Descargas en la nube</b>' + rows.join(''); box.classList.remove('hidden');
  } catch { box.classList.add('hidden'); }
}
setInterval(() => { if (!document.hidden && valid() && !$('#vApp').classList.contains('hidden')) refreshQueue(); }, 30000);

// ---------- Arranque ----------
async function start() {
  try {
    ROOT = C.ROOT_ID || await findFolder(C.ROOT_NAME);
    if (!ROOT) throw new Error('No encuentro la carpeta "' + C.ROOT_NAME + '" en tu Drive, o no tienes acceso.');
    show('app'); sendTokenToSW(); render();
  } catch (e) { show('login'); $('#eLogin').textContent = e.message; }
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
if (valid()) start(); else show('login');
})();
