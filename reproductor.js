// Reproductor compartido (servidor del PC y sitio en la nube).
// Muestra video, audio o imagen en una ventana de vidrio azul, con selector de pista de audio y de subtítulos.
// Las pistas extra vienen en archivos aparte (los navegadores, salvo Safari, no dejan cambiar las internas):
//   audio:  la pista 1 suena desde el propio video; las demás desde un <audio> sincronizado con el video.
//   subtítulos: archivos .vtt que se cargan como <track>.
// Uso: Reproductor.abrir({ titulo, kind: 'video'|'audio'|'image', src, dl, cred, pistas: async () => ({ audios: [{label, src}], subs: [{label, src}] }) })
//      audios[0] es la pista interna (src: null).
(() => {
const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const css = `
#rp{position:fixed;inset:0;z-index:50;display:none;place-items:center;background:rgba(2,8,24,.74);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);padding:14px}
#rp.on{display:grid}
#rp .rp-box{width:min(1100px,100%);max-height:100%;overflow:auto;padding:16px;border-radius:22px;background:rgba(255,255,255,.08);border:1px solid rgba(160,205,255,.22);backdrop-filter:blur(18px) saturate(140%);-webkit-backdrop-filter:blur(18px) saturate(140%);box-shadow:0 10px 40px rgba(0,10,40,.35)}
#rp .rp-bar{display:flex;align-items:center;gap:12px;margin:0 0 16px}
#rp h2{flex:1;min-width:0;margin:0 0 0 4px;font-size:.98rem;font-weight:600;word-break:break-word;color:#eaf3ff}
#rp .rp-x{flex:none;width:40px;height:40px;padding:0;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.12);border:1px solid rgba(160,205,255,.3);box-shadow:none;cursor:pointer}
#rp .rp-x:hover{background:rgba(78,161,255,.35)}
#rp .rp-x svg{width:20px;height:20px;fill:none;stroke:#eaf3ff;stroke-width:2.2;stroke-linecap:round}
#rp video,#rp audio.rp-main{width:100%;max-height:72vh;border-radius:16px;background:#000;display:block}
#rp img{max-width:100%;max-height:78vh;border-radius:16px;display:block;margin:auto}
#rp .rp-opts{display:flex;flex-wrap:wrap;gap:10px 22px;margin:14px 2px 0}
#rp .rp-grp{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
#rp .rp-grp b{font-size:.8rem;font-weight:600;color:#9db8dd;margin-right:2px}
#rp .rp-chip{padding:7px 13px;border-radius:999px;font:inherit;font-size:.84rem;font-weight:500;color:#eaf3ff;background:rgba(255,255,255,.08);border:1px solid rgba(160,205,255,.25);box-shadow:none;cursor:pointer}
#rp .rp-chip.on{background:linear-gradient(135deg,#4ea1ff,#2563eb);border-color:transparent;font-weight:600}
#rp .rp-note{color:#9db8dd;font-size:.82rem;margin:10px 4px 0}#rp .rp-note a{color:#7cc4ff}
#rp ::cue{background:rgba(0,0,0,.6);font-size:1.05em}`;
const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

const el = document.createElement('div'); el.id = 'rp';
el.innerHTML = '<div class="rp-box"><div class="rp-bar"><h2></h2><button class="rp-x" type="button" aria-label="Cerrar" title="Cerrar">' + ICON_X + '</button></div><div class="rp-body"></div><div class="rp-opts"></div><div class="rp-note"></div></div>';
document.body.appendChild(el);
const $ = s => el.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let cleanup = [];
function cerrar() {
  cleanup.forEach(f => { try { f(); } catch {} }); cleanup = [];
  el.querySelectorAll('video,audio').forEach(m => { m.pause(); m.removeAttribute('src'); m.load(); });
  $('.rp-body').innerHTML = ''; $('.rp-opts').innerHTML = ''; $('.rp-note').innerHTML = '';
  el.classList.remove('on');
}
$('.rp-x').onclick = cerrar;
el.addEventListener('click', e => { if (e.target === el) cerrar(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && el.classList.contains('on')) cerrar(); });

function grupo(titulo, opciones, elegido, onPick) {
  const g = document.createElement('div'); g.className = 'rp-grp';
  g.innerHTML = '<b>' + esc(titulo) + '</b>' + opciones.map((o, i) => '<button type="button" class="rp-chip' + (i === elegido ? ' on' : '') + '" data-i="' + i + '">' + esc(o) + '</button>').join('');
  g.addEventListener('click', e => {
    const b = e.target.closest('.rp-chip'); if (!b) return;
    g.querySelectorAll('.rp-chip').forEach(c => c.classList.toggle('on', c === b)); onPick(+b.dataset.i);
  });
  $('.rp-opts').appendChild(g);
}

function abrir({ titulo, kind, src, dl, pistas, cred }) {
  const co = cred ? 'use-credentials' : 'anonymous';   // cred: los archivos vienen de otro dominio con sesión (sitio en la nube)
  cerrar();
  $('h2').textContent = titulo;
  const body = $('.rp-body');
  if (kind === 'image') { body.innerHTML = '<img alt="">'; body.firstChild.src = src; el.classList.add('on'); return; }
  const v = document.createElement(kind === 'audio' ? 'audio' : 'video');
  v.controls = true; v.autoplay = true; v.playsInline = true; v.className = 'rp-main'; v.crossOrigin = co; v.src = src;
  v.onerror = () => { $('.rp-note').innerHTML = 'Tu navegador no puede reproducir este formato aquí. <a href="' + esc(dl || src) + '" download>Descargar el archivo</a>'; };
  body.appendChild(v); el.classList.add('on');
  if (kind !== 'video' || !pistas) return;

  pistas().then(p => {
    if (!p || !el.classList.contains('on') || body.firstChild !== v) return;
    const audios = p.audios || [], subs = p.subs || [];

    // ---- Audio: pista interna o externa sincronizada ----
    if (audios.length > 1) {
      const ext = document.createElement('audio'); ext.preload = 'auto'; ext.crossOrigin = co; body.appendChild(ext);
      let usandoExt = false, actx = null, gain = null;
      // El audio interno se apaga con Web Audio (no con "muted"): así el botón de volumen del video sigue mandando
      const silenciarInterno = on => {
        try {
          if (!actx) { actx = new (window.AudioContext || window.webkitAudioContext)(); const s = actx.createMediaElementSource(v); gain = actx.createGain(); s.connect(gain).connect(actx.destination); cleanup.push(() => actx.close()); }
          gain.gain.value = on ? 0 : 1; actx.resume();
        } catch { v.muted = on; }   // navegador sin Web Audio: silenciar a la antigua
      };
      const sync = (forzar) => {
        if (!usandoExt) return;
        if (forzar || Math.abs(ext.currentTime - v.currentTime) > 0.35) ext.currentTime = v.currentTime;
        ext.playbackRate = v.playbackRate; ext.volume = v.volume; ext.muted = !!(gain && v.muted);
        if (v.paused || v.seeking || v.readyState < 3) ext.pause(); else if (ext.paused) ext.play().catch(() => {});
      };
      const evs = ['play', 'pause', 'seeking', 'seeked', 'waiting', 'playing', 'ratechange', 'volumechange'];
      const h = () => sync(false), hs = () => sync(true);
      evs.forEach(n => v.addEventListener(n, n === 'seeked' ? hs : h));
      const t = setInterval(() => sync(false), 1000);
      cleanup.push(() => { clearInterval(t); ext.pause(); ext.removeAttribute('src'); ext.load(); });
      grupo('Audio', audios.map(a => a.label), 0, i => {
        const a = audios[i];
        if (!a.src) { usandoExt = false; ext.pause(); silenciarInterno(false); return; }
        usandoExt = true; silenciarInterno(true);
        if (ext.getAttribute('src') !== a.src) { ext.src = a.src; ext.addEventListener('loadedmetadata', () => sync(true), { once: true }); }
        else sync(true);
      });
    }

    // ---- Subtítulos ----
    if (subs.length) {
      const tracks = subs.map((s, i) => {
        const tr = document.createElement('track'); tr.kind = 'subtitles'; tr.label = s.label; tr.src = s.src; tr.srclang = s.lang || 'es';
        v.appendChild(tr); return tr;
      });
      const mostrar = i => { [...v.textTracks].forEach((tt, j) => { tt.mode = j === i ? 'showing' : 'disabled'; }); };
      v.addEventListener('loadedmetadata', () => mostrar(-1), { once: true }); mostrar(-1);
      grupo('Subtítulos', ['No'].concat(subs.map(s => s.label)), 0, i => mostrar(i - 1));
      void tracks;
    }
  }).catch(() => {});
}
window.Reproductor = { abrir, cerrar };
})();
