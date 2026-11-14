// Saca de cada video sus pistas de audio extra (.m4a) y sus subtítulos de texto (.vtt) a <raíz>/.pistas/<nombre del video>/,
// con un pistas.json que el reproductor usa para ofrecer el cambio de idioma. No recomprime el audio AAC (se copia).
// Uso: node pistas.js [raíz]   (por defecto D:\). Se salta los videos que ya tienen sus pistas al día.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.resolve(process.argv[2] || 'D:\\');
const OUT = path.join(ROOT, '.pistas');
const FFMPEG = [process.env.FFMPEG_EXE, path.join(__dirname, 'ffmpeg.exe'),
  'C:\\Program Files\\Softdeluxe\\Free Download Manager\\ffmpeg.exe', 'ffmpeg'].find(p => p && (p === 'ffmpeg' || fs.existsSync(p)));
const VIDEO = /\.(mp4|m4v|mkv|webm|mov|avi|ts)$/i;
const TEXT_SUBS = /^(subrip|mov_text|ass|ssa|webvtt|text)$/;
const LANG = { spa: 'Español', es: 'Español', eng: 'Inglés', en: 'Inglés', por: 'Portugués', fra: 'Francés', fre: 'Francés', ita: 'Italiano', deu: 'Alemán', ger: 'Alemán', jpn: 'Japonés', kor: 'Coreano' };

function videos(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (/^[.$]/.test(d.name) || d.name === 'System Volume Information') continue;
    const f = path.join(dir, d.name);
    if (d.isDirectory()) videos(f, out); else if (VIDEO.test(d.name)) out.push(f);
  }
  return out;
}

// Lee las pistas con "ffmpeg -i" (no hace falta ffprobe)
function probe(file) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const lines = (r.stderr || '').split(/\r?\n/), streams = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /Stream #0:(\d+)(?:\[\w+\])?(?:\((\w+)\))?: (Audio|Subtitle): (\w+)/.exec(lines[i]);
    if (!m) continue;
    const s = { idx: +m[1], lang: m[2] || '', type: m[3], codec: m[4], title: '' };
    for (let j = i + 1; j < lines.length && !/Stream #/.test(lines[j]); j++) {
      const t = /^\s+title\s*:\s*(.+)$/.exec(lines[j]); if (t) { s.title = t[1].trim(); break; }
    }
    streams.push(s);
  }
  return streams;
}
const label = (s, n) => s.title || LANG[s.lang] || (s.lang && s.lang !== 'und' ? s.lang : (s.type === 'Audio' ? 'Audio ' : 'Subtítulos ') + n);

function procesar(file) {
  const st = fs.statSync(file), name = path.basename(file), dir = path.join(OUT, name);
  const manPath = path.join(dir, 'pistas.json');
  try { const m = JSON.parse(fs.readFileSync(manPath, 'utf8')); if (m.size === st.size && m.mtime === st.mtimeMs) return 'al día'; } catch {}
  const streams = probe(file), aud = streams.filter(s => s.type === 'Audio'), subs = streams.filter(s => s.type === 'Subtitle');
  const man = { size: st.size, mtime: st.mtimeMs, audios: [], subs: [] };
  fs.mkdirSync(dir, { recursive: true });
  aud.forEach((s, k) => {
    if (k === 0) return man.audios.push({ label: label(s, 1), file: null });
    const f = `audio-${k}.m4a`, codec = s.codec === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '160k'];
    const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-map', `0:a:${k}`, '-vn', ...codec, '-movflags', '+faststart', path.join(dir, f)]);
    if (r.status === 0) man.audios.push({ label: label(s, k + 1), lang: s.lang, file: f });
  });
  let n = 0;
  subs.forEach((s, k) => {
    if (!TEXT_SUBS.test(s.codec)) return;   // los subtítulos de imagen (PGS, DVD) no se pueden pasar a texto
    const f = `sub-${k}.vtt`;
    const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-map', `0:s:${k}`, '-f', 'webvtt', path.join(dir, f)]);
    if (r.status === 0) man.subs.push({ label: label(s, ++n), lang: s.lang, file: f });
  });
  if (man.audios.length < 2) man.audios = man.audios.slice(0, 1);
  fs.writeFileSync(manPath, JSON.stringify(man, null, 1));
  return `${man.audios.length} audio(s), ${man.subs.length} subtítulo(s)`;
}

if (require.main === module) {
  if (!FFMPEG) { console.error('No encuentro ffmpeg'); process.exit(1); }
  for (const f of videos(ROOT)) {
    try { console.log(path.relative(ROOT, f) + ': ' + procesar(f)); } catch (e) { console.log(path.relative(ROOT, f) + ': error ' + e.message); }
  }
}
module.exports = { procesar, videos, OUT };
