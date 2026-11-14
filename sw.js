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

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  const m = /\/stream\/([\w-]+)\/([^/]*)$/.exec(u.pathname);
  if (u.origin !== location.origin || !m) return;
  e.respondWith((async () => {
    const token = await getToken();
    if (!token) return new Response('Inicia sesión otra vez', { status: 401 });
    const h = { Authorization: 'Bearer ' + token }, range = e.request.headers.get('Range');
    if (range) h.Range = range;
    const r = await fetch('https://www.googleapis.com/drive/v3/files/' + m[1] + '?alt=media&supportsAllDrives=true', { headers: h });
    const out = new Headers();
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) { const v = r.headers.get(k); if (v) out.set(k, v); }
    if (!out.has('accept-ranges') && r.ok) out.set('accept-ranges', 'bytes');
    if (u.searchParams.get('dl') === '1') {
      const name = decodeURIComponent(m[2]);
      out.set('content-disposition', `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    }
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: out });
  })());
});
