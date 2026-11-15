// Robot de "Mis medios" (corre en GitHub Actions, con rclone y ffmpeg).
//   node scripts/robot.mjs pedidos     baja los enlaces que pidieron los admins (cola _pedidos del Drive principal)
//   node scripts/robot.mjs calidades   a cada video le saca pistas y le hace las calidades (1080p, 720p... 144p)
// Las llaves de los Drive las entrega el Worker (/robot/drives) con la clave ROBOT_KEY.
// Junto a cada video queda una carpeta con su mismo nombre (sin extensión) con: pistas.json, audio-N.m4a, sub-N.vtt,
// <alto>p.mp4 (calidades) y lo que suban los admins ("Audio - X.ext", "Subtítulos - X.ext").
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const API = process.env.API || 'https://movies-api.emailrouting.xyz';
const MODO = process.argv[2] || 'pedidos';
const INICIO = Date.now(), PRESUPUESTO = (+process.env.MINUTOS || 300) * 60e3;
const TRABAJO = process.env.TRABAJO || fs.mkdtempSync(path.join(os.tmpdir(), 'mm-'));
const VIDEO = /\.(mp4|m4v|mkv|webm|mov|avi|ts|wmv)$/i;
const MEDIA = /\.(mp4|m4v|webm|mkv|mov|avi|ts|wmv|mp3|m4a|aac|flac|wav|ogg|opus|jpe?g|png|gif|webp)$/i;
const AUDIO_WEB = /\.(m4a|mp3|aac|ogg|opus|flac|wav|webm)$/i;
const ALTOS = [2160, 1080, 720, 480, 360, 240, 144];
const ANCHO = { 2160: 3840, 1440: 2560, 1080: 1920, 720: 1280, 480: 854, 360: 640, 240: 426, 144: 256 };
const MAXRATE = { 2160: '16M', 1080: '5M', 720: '2800k', 480: '1200k', 360: '800k', 240: '450k', 144: '220k' };
const VERSION = 2;
const LANG = { spa: 'Español', es: 'Español', eng: 'Inglés', en: 'Inglés', por: 'Portugués', fra: 'Francés', fre: 'Francés', ita: 'Italiano', deu: 'Alemán', ger: 'Alemán', jpn: 'Japonés', kor: 'Coreano' };
const TEXT_SUBS = /^(subrip|mov_text|ass|ssa|webvtt|text)$/;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
function run(cmd, args, opt = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: opt.inherit ? 'inherit' : 'pipe', ...opt });
  if (r.status !== 0 && !opt.ok) throw new Error(`${cmd} ${args[0]} falló: ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ')}`);
  return r;
}
const rc = (...a) => run('rclone', a, { inherit: false });
const rcv = (...a) => run('rclone', [...a, '--stats', '60s', '--stats-one-line', '-v'], { inherit: true });
const quedan = () => PRESUPUESTO - (Date.now() - INICIO);

// ---------- Llaves de los Drive -> rclone.conf ----------
async function configurar() {
  const r = await fetch(API + '/robot/drives', { headers: { Authorization: 'Bearer ' + process.env.ROBOT_KEY } });
  if (!r.ok) throw new Error('El Worker no entregó las llaves: ' + r.status);
  const j = await r.json();
  const conf = j.drives.filter(d => d.refresh).map(d => `[d_${d.k}]\ntype = drive\nclient_id = ${j.client_id}\nclient_secret = ${j.client_secret}\nscope = drive\nroot_folder_id = ${d.root}\ntoken = ${JSON.stringify({ access_token: 'x', token_type: 'Bearer', refresh_token: d.refresh, expiry: '2000-01-01T00:00:00Z' })}\n`).join('\n');
  const dir = path.join(os.homedir(), '.config', 'rclone'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'rclone.conf'), conf, { mode: 0o600 });
  return j;
}
function libre(k) { try { const a = JSON.parse(rc('about', `d_${k}:`, '--json').stdout); return a.free ?? (a.total - a.used); } catch { return -1; } }

// ---------- Procesar un video local: pistas + calidades ----------
function probe(file) { return JSON.parse(run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]).stdout); }
const clase = (w, h) => w >= 3200 || h >= 1800 ? 2160 : w >= 2200 || h >= 1300 ? 1440 : w >= 1700 || h >= 950 ? 1080 : w >= 1150 || h >= 650 ? 720 : w >= 760 || h >= 420 ? 480 : w >= 560 || h >= 320 ? 360 : w >= 380 || h >= 220 ? 240 : 144;
const etiqueta = (s, n, tipo) => (s.tags && s.tags.title) || LANG[s.tags && s.tags.language] || (s.tags && s.tags.language && s.tags.language !== 'und' ? s.tags.language : (tipo === 'a' ? 'Audio ' : 'Subtítulos ') + n);

function procesarVideo(file, out, { calidades = true } = {}) {
  fs.mkdirSync(out, { recursive: true });
  const p = probe(file), v = p.streams.find(s => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const aud = p.streams.filter(s => s.codec_type === 'audio'), subs = p.streams.filter(s => s.codec_type === 'subtitle');
  const man = { version: calidades ? VERSION : 1, audios: [], subs: [], calidades: [] };
  // Pistas de audio extra (la primera suena desde el propio video)
  aud.forEach((s, k) => {
    if (k === 0) return man.audios.push({ label: etiqueta(s, 1, 'a'), lang: s.tags?.language || '', file: null });
    const f = `audio-${k}.m4a`, codec = s.codec_name === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k', '-ac', '2'];
    const r = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-map', `0:a:${k}`, '-vn', ...codec, '-movflags', '+faststart', path.join(out, f)], { ok: true });
    if (r.status === 0) man.audios.push({ label: etiqueta(s, k + 1, 'a'), lang: s.tags?.language || '', file: f });
  });
  if (man.audios.length < 2) man.audios = man.audios.slice(0, 1);
  // Subtítulos de texto -> WebVTT (los de imagen, PGS/DVD, no se pueden pasar a texto)
  let n = 0;
  subs.forEach((s, k) => {
    if (!TEXT_SUBS.test(s.codec_name)) return;
    const f = `sub-${k}.vtt`;
    const r = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-map', `0:s:${k}`, '-f', 'webvtt', path.join(out, f)], { ok: true });
    if (r.status === 0) man.subs.push({ label: etiqueta(s, ++n, 's'), lang: s.tags?.language || '', file: f });
  });
  if (calidades && v) {
    const alto = clase(v.width, v.height), mp4 = /\.(mp4|m4v)$/i.test(file);
    const compatible = /^(h264)$/.test(v.codec_name) && (!aud[0] || /^(aac|mp3)$/.test(aud[0].codec_name));
    man.fuente = { ancho: v.width, alto: v.height, clase: alto, codec: v.codec_name, audio: aud[0]?.codec_name || null };
    const outs = [];
    // Misma calidad que el original, si el navegador no lo puede abrir tal cual (mkv, HEVC, AC3...)
    if (!(mp4 && compatible)) {
      if (compatible) {   // solo cambiar de envase, sin recomprimir
        // El MP4 reemplaza al original (misma calidad: no tiene sentido guardar las dos copias)
        log('  remux', alto + 'p (reemplaza al original)');
        const rem = path.join(path.dirname(out), '_remux', path.basename(file)); fs.mkdirSync(path.dirname(rem), { recursive: true });
        run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-map', '0:v:0', ...(aud[0] ? ['-map', '0:a:0'] : []), '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', rem]);
        man.reemplazo = rem;
      } else outs.push(alto);
    }
    for (const a of ALTOS) if (a < alto) outs.push(a);
    if (outs.length) {
      log('  calidades', outs.map(a => a + 'p').join(' '));
      const fc = `[0:v:0]split=${outs.length}` + outs.map((_, i) => `[s${i}]`).join('') + ';' + outs.map((a, i) => `[s${i}]scale=w='min(${ANCHO[a]},iw)':h=-2:flags=bicubic,format=yuv420p[o${i}]`).join(';');
      const args = ['-hide_banner', '-loglevel', 'error', '-stats_period', '60', '-stats', '-y', '-i', file, '-filter_complex', fc];
      outs.forEach((a, i) => args.push('-map', `[o${i}]`, ...(aud[0] ? ['-map', '0:a:0'] : []), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-maxrate', MAXRATE[a] || '5M', '-bufsize', '2M',
        '-profile:v', 'high', '-g', '96', '-c:a', 'aac', '-b:a', a <= 240 ? '64k' : '128k', '-ac', '2', '-movflags', '+faststart', path.join(out, a + 'p.mp4')));
      run('ffmpeg', args, { inherit: true });
      outs.forEach(a => man.calidades.push({ alto: a, file: a + 'p.mp4' }));
    }
    man.calidades.sort((a, b) => b.alto - a.alto);
  }
  const { reemplazo, ...guardar } = man;
  fs.writeFileSync(path.join(out, 'pistas.json'), JSON.stringify(guardar, null, 1));
  return man;
}
// Cambia el contenido del video por el MP4 y luego le cambia la extensión. Primero el contenido (en el mismo archivo,
// así conserva su id en Drive y el progreso de cada persona) y después el nombre: si algo se corta a medias, queda un
// .mkv con MP4 adentro, que la próxima vuelta vuelve a procesar sin daño.
function reemplazarOriginal(R, v, local, byPath) {
  const nuevo = v.Path.replace(/\.[^.]+$/, '.mp4');
  if (byPath.has(nuevo)) { log('  ya existe', nuevo, '- se deja el original'); return false; }
  rcv('copyto', local, R + v.Path, '--ignore-times');
  rc('moveto', R + v.Path, R + nuevo);
  log('  original reemplazado ->', nuevo);
  return true;
}

// ---------- Pedidos por enlace ----------
async function pedidos(cfg) {
  const p = cfg.drives.find(d => d.principal) || cfg.drives[0], Q = `d_${p.k}:${cfg.cola}`;
  const lista = rc('lsf', Q, '--files-only', '--filter', '- *.error.json', '--filter', '+ pedido-*.json', '--filter', '- *').stdout.split('\n').filter(Boolean);
  log('Pedidos en cola:', lista.length);
  const falla = (P, J, motivo) => {
    const base = P.replace(/\.json$/, '');
    run('rclone', ['rcat', `${Q}/${base}.error.json`], { input: JSON.stringify({ ...J, error: motivo }) });
    rc('deletefile', `${Q}/${P}`); log('  FALLÓ:', motivo);
  };
  for (const P of lista) {
    if (quedan() < 20 * 60e3) { log('Se acaba el tiempo; el resto en la próxima vuelta.'); break; }
    log('==', P);
    let J; try { J = JSON.parse(rc('cat', `${Q}/${P}`).stdout); } catch { continue; }
    const url = String(J.url || ''), ruta = String(J.ruta || '').replace(/^\/+|\/+$/g, '');
    if (!/^https?:\/\//.test(url) || ruta.split('/').some(s => s === '..')) { falla(P, J, 'Enlace inválido'); continue; }
    run('rclone', ['rcat', `${Q}/${P}`], { input: JSON.stringify({ ...J, estado: 'descargando' }) });
    // ¿Es multimedia? Por la extensión o por el tipo que declara el servidor
    const h = run('curl', ['-sIL', '--max-time', '20', '-A', 'Mozilla/5.0', url], { ok: true }).stdout.replace(/\r/g, '');
    const ct = ((h.match(/^content-type:\s*([^;\n]+)/gim) || []).pop() || '').replace(/^content-type:\s*/i, '').trim().toLowerCase();
    if (!MEDIA.test(url.split('?')[0]) && !/^(video|audio|image)\//.test(ct)) { falla(P, J, `No parece un archivo multimedia (tipo: ${ct || 'desconocido'})`); continue; }
    const dl = fs.mkdtempSync(path.join(TRABAJO, 'dl-'));
    try {
      const nameOpt = /^content-disposition:.*filename/im.test(h) ? ['--auto-filename', '--header-filename'] : ['--auto-filename'];
      rcv('copyurl', url, dl, ...nameOpt, '--user-agent', 'Mozilla/5.0', '--retries', '3', '--low-level-retries', '10');
      const archivo = fs.readdirSync(dl).find(f => !f.startsWith('.')); if (!archivo) throw new Error('vacío');
      const size = fs.statSync(path.join(dl, archivo)).size;
      // El Drive con más espacio libre
      const d = cfg.drives.map(x => ({ x, libre: libre(x.k) })).filter(o => o.libre > size * 1.1).sort((a, b) => b.libre - a.libre)[0];
      if (!d) throw new Error('No queda espacio en ningún Drive');
      const dest = `d_${d.x.k}:${ruta}`;
      if (VIDEO.test(archivo)) {   // primero sus pistas (así el robot de calidades nunca ve el video sin su carpeta)
        const aux = path.join(dl, '_aux'); procesarVideo(path.join(dl, archivo), aux, { calidades: false });
        rcv('copy', aux, `${dest}${ruta ? '/' : ''}${archivo.replace(/\.[^.]+$/, '')}`);
      }
      rcv('copyto', path.join(dl, archivo), `${dest}${ruta ? '/' : ''}${archivo}`);
      rc('deletefile', `${Q}/${P}`); log('  OK ->', d.x.admin, ruta || '(inicio)');
    } catch (e) {
      falla(P, J, /espacio/.test(e.message) ? e.message : 'La descarga falló (el enlace puede haber vencido o pedir inicio de sesión)');
    } finally { fs.rmSync(dl, { recursive: true, force: true }); }
  }
}

// ---------- Calidades y pistas de toda la biblioteca ----------
async function calidades(cfg) {
  for (const d of cfg.drives) {
    const R = `d_${d.k}:`;
    let todo; try { todo = JSON.parse(rc('lsjson', R, '-R', '--no-modtime', '--no-mimetype', '--filter', '- _*/**', '--filter', '- .*/**').stdout); } catch (e) { log('Drive', d.k, 'no responde:', e.message); continue; }
    const files = todo.filter(f => !f.IsDir), byPath = new Map(files.map(f => [f.Path, f]));
    const cand = files.filter(f => VIDEO.test(f.Name));
    const auxDe = f => f.Path.replace(/\.[^.]+$/, '');
    const auxSet = new Set(cand.map(auxDe));
    const videos = cand.filter(f => ![...auxSet].some(a => f.Path.startsWith(a + '/')));
    log(`Drive ${d.k} (${d.admin}): ${videos.length} videos`);
    // Primero los videos nuevos (sin pistas): se les sacan audio y subtítulos, que es rápido; las calidades van después
    const nuevos = videos.filter(v => !byPath.has(auxDe(v) + '/pistas.json'));
    for (const v of nuevos) {
      if (quedan() < 30 * 60e3) return;
      log('== nuevo:', v.Path);
      const w = fs.mkdtempSync(path.join(TRABAJO, 'n-'));
      try {
        const local = path.join(w, v.Name); rcv('copyto', R + v.Path, local);
        const out = path.join(w, '_aux'); procesarVideo(local, out, { calidades: false });
        rcv('copy', out, R + auxDe(v)); byPath.set(auxDe(v) + '/pistas.json', {});
      } catch (e) { log('  ERROR:', e.message); }
      finally { fs.rmSync(w, { recursive: true, force: true }); }
    }
    for (const v of videos) {
      const aux = auxDe(v);
      // ¿Le falta algo? (pistas.json v2, o audios subidos que el navegador no puede reproducir)
      let man = null; if (byPath.has(aux + '/pistas.json')) { try { man = JSON.parse(rc('cat', R + aux + '/pistas.json').stdout); } catch {} }
      const subidos = files.filter(f => f.Path.startsWith(aux + '/') && /^Audio - .+\.[a-z0-9]+$/i.test(f.Name) && !AUDIO_WEB.test(f.Name));
      const sinConvertir = subidos.filter(f => !byPath.has(f.Path.replace(/\.[^.]+$/, '.m4a')));
      const necesita = !man || (man.version || 1) < VERSION;
      const f0 = man && man.fuente, dup = !necesita && quedan() > 40 * 60e3 && f0 && !/\.(mp4|m4v)$/i.test(v.Name) && f0.codec === 'h264' && (!f0.audio || /^(aac|mp3)$/.test(f0.audio)) && byPath.has(`${aux}/${f0.clase}p.mp4`);
      if (dup) {
        log('== copia duplicada:', v.Path);
        const w = fs.mkdtempSync(path.join(TRABAJO, 'd-'));
        try {
          const local = path.join(w, v.Name); rcv('copyto', `${R}${aux}/${f0.clase}p.mp4`, local);
          if (reemplazarOriginal(R, v, local, byPath)) {
            man.calidades = man.calidades.filter(c => c.alto !== f0.clase);
            run('rclone', ['rcat', R + aux + '/pistas.json'], { input: JSON.stringify(man, null, 1) });
            rc('deletefile', `${R}${aux}/${f0.clase}p.mp4`);
          }
        } catch (e) { log('  ERROR:', e.message); }
        finally { fs.rmSync(w, { recursive: true, force: true }); }
      }
      if (!necesita && !sinConvertir.length) continue;
      if (quedan() < 75 * 60e3) { log('Se acaba el tiempo; sigo en la próxima vuelta.'); return; }
      log('==', v.Path, necesita ? '(calidades)' : '(audios subidos)');
      const w = fs.mkdtempSync(path.join(TRABAJO, 'v-'));
      try {
        if (necesita) {
          const local = path.join(w, v.Name); rcv('copyto', R + v.Path, local);
          const out = path.join(w, '_aux'), man = procesarVideo(local, out);
          fs.rmSync(local, { force: true });
          if (man.reemplazo) reemplazarOriginal(R, v, man.reemplazo, byPath);
          rcv('copy', out, R + aux);
        }
        for (const s of sinConvertir) {
          const local = path.join(w, s.Name); rcv('copyto', R + s.Path, local);
          const m4a = local.replace(/\.[^.]+$/, '.m4a');
          run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', local, '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-movflags', '+faststart', m4a]);
          rcv('copyto', m4a, R + s.Path.replace(/\.[^.]+$/, '.m4a'));
        }
        log('  OK');
      } catch (e) { log('  ERROR:', e.message); }
      finally { fs.rmSync(w, { recursive: true, force: true }); }
    }
  }
}

const cfg = await configurar();
log('Drive conectados:', cfg.drives.map(d => `${d.k}(${d.admin})`).join(', '));
if (MODO === 'pedidos') await pedidos(cfg); else await calidades(cfg);
