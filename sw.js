// Service worker: convierte /stream/<id>/<nombre> en una petición a Google Drive con el token de la sesión,
// pasando el Range (para adelantar videos y retomar descargas) y, con ?dl=1, el nombre original del archivo.
const TOKEN_CACHE = 'medios-auth', TOKEN_KEY = '/__token__';
let mem = null;   // { token, exp }

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('message', e => {
  if (e.data && e.data.token) {
    mem = { token: e.data.token, exp: e.data.exp };
    e.waitUntil(caches.open(TOKEN_CACHE).then(c => c.put(TOKEN_KEY, new Response(JSON.stringify(mem)))));
  }
});

async function getToken() {
  if (!mem) { try { mem = await (await (await caches.open(TOKEN_CACHE)).match(TOKEN_KEY)).json(); } catch {} }
  if (mem && mem.exp > Date.now() + 30e3) return mem.token;
  // Token vencido: pedirle a una pestaña abierta que lo renueve y esperar hasta 15 s
  const cs = await self.clients.matchAll({ type: 'window' });
  cs.forEach(c => c.postMessage('token?'));
  const old = mem && mem.token;
  for (let i = 0; i < 30; i++) { await new Promise(r => setTimeout(r, 500)); if (mem && mem.token !== old && mem.exp > Date.now()) return mem.token; }
  return mem ? mem.token : null;
}

// Google no expone Content-Range ni Content-Type a otros dominios (CORS), así que se arman aquí
// con el tamaño y el tipo del archivo, que se piden una vez por archivo.
const META = new Map();
const EXT_TYPE = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/webm', mov: 'video/mp4',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
async function meta(id, token) {
  if (META.has(id)) return META.get(id);
  const r = await fetch('https://www.googleapis.com/drive/v3/files/' + id + '?fields=size,mimeType,name&supportsAllDrives=true', { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) return null;
  const j = await r.json(); META.set(id, j); return j;
}

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  const m = /\/stream\/([\w-]+)\/([^/]*)$/.exec(u.pathname);
  if (u.origin !== location.origin || !m) return;
  e.respondWith((async () => {
    const token = await getToken();
    if (!token) return new Response('Inicia sesión otra vez', { status: 401 });
    const info = await meta(m[1], token);
    if (!info) return new Response('No se pudo leer el archivo en Drive', { status: 502 });
    const total = +info.size, name = decodeURIComponent(m[2]);
    const ext = (name.split('.').pop() || '').toLowerCase();
    // Rango pedido por el reproductor (o el archivo completo)
    let start = 0, end = total - 1, partial = false;
    const rq = /^bytes=(\d*)-(\d*)$/.exec(e.request.headers.get('Range') || '');
    if (rq && (rq[1] || rq[2])) {
      partial = true;
      if (rq[1]) { start = +rq[1]; if (rq[2]) end = Math.min(+rq[2], total - 1); } else start = Math.max(0, total - +rq[2]);
      if (start >= total) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
    }
    const h = { Authorization: 'Bearer ' + token };
    if (partial) h.Range = `bytes=${start}-${end}`;
    const r = await fetch('https://www.googleapis.com/drive/v3/files/' + m[1] + '?alt=media&supportsAllDrives=true', { headers: h });
    if (!r.ok) return new Response('Drive respondió ' + r.status, { status: r.status });
    const out = new Headers({ 'Accept-Ranges': 'bytes', 'Content-Type': EXT_TYPE[ext] || info.mimeType || 'application/octet-stream' });
    const len = +(r.headers.get('content-length') || 0);
    if (r.status === 206) { const last = len ? start + len - 1 : end; out.set('Content-Range', `bytes ${start}-${last}/${total}`); out.set('Content-Length', String(last - start + 1)); }
    else out.set('Content-Length', String(total));
    if (u.searchParams.get('dl') === '1') {
      const name = decodeURIComponent(m[2]);
      out.set('content-disposition', `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    }
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: out });
  })());
});
