import { useState, useEffect, useRef } from 'react';

function getSCEmbedUrl(url) {
  return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%2300e5ff&auto_play=true&hide_related=true&show_comments=false&show_user=false&show_reposts=false&show_teaser=false`;
}

function getMCEmbedUrl(url) {
  const feed = url.replace('https://www.mixcloud.com', '');
  return `https://www.mixcloud.com/widget/iframe/?hide_cover=1&mini=1&autoplay=1&feed=${encodeURIComponent(feed)}`;
}

function isSoundCloud(url) { return url && url.includes('soundcloud.com'); }
function isMixcloud(url)   { return url && url.includes('mixcloud.com'); }

const WAVE_BARS = [
  { anim: 'yp-bar1', dur: '0.7s',  delay: '0s'    },
  { anim: 'yp-bar2', dur: '0.5s',  delay: '0.1s'  },
  { anim: 'yp-bar3', dur: '0.6s',  delay: '0.2s'  },
  { anim: 'yp-bar4', dur: '0.8s',  delay: '0.05s' },
];

const WAVE_CSS = `
  @keyframes yp-bar1 { 0%,100%{height:3px}  50%{height:12px} }
  @keyframes yp-bar2 { 0%,100%{height:8px}  50%{height:3px}  }
  @keyframes yp-bar3 { 0%,100%{height:5px}  33%{height:12px} 66%{height:3px} }
  @keyframes yp-bar4 { 0%,100%{height:10px} 50%{height:4px}  }
`;

export default function MiniPlayer({ url, artistName, onClose }) {
  const [trackTitle, setTrackTitle] = useState('');
  const [thumb,      setThumb]      = useState('');
  const [progress,   setProgress]   = useState(0);
  const [minimised,  setMinimised]  = useState(false);
  const [playing,    setPlaying]    = useState(true);
  const frameRef = useRef(null);
  const timerRef = useRef(null);
  const startRef = useRef(Date.now());
  const CLIP_MS  = 90 * 1000;

  const isSC     = isSoundCloud(url);
  const isMC     = isMixcloud(url);
  const embedUrl = isSC ? getSCEmbedUrl(url) : isMC ? getMCEmbedUrl(url) : null;

  // oEmbed metadata
  useEffect(() => {
    if (!url) return;
    const oembedUrl = isSC
      ? `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`
      : `https://www.mixcloud.com/oembed/?format=json&url=${encodeURIComponent(url)}`;
    fetch(oembedUrl)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.title)         setTrackTitle(d.title);
        if (d?.thumbnail_url) setThumb(d.thumbnail_url);
      })
      .catch(() => {});
  }, [url]);

  // Progress timer — only ticks while playing
  useEffect(() => {
    if (!playing) {
      clearInterval(timerRef.current);
      return;
    }
    startRef.current = Date.now() - (progress / 100 * CLIP_MS);
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      setProgress(Math.min(elapsed / CLIP_MS * 100, 100));
      if (elapsed >= CLIP_MS) { clearInterval(timerRef.current); setPlaying(false); }
    }, 500);
    return () => clearInterval(timerRef.current);
  }, [playing, url]);

  function togglePlay() {
    const next = !playing;
    setPlaying(next);
    // Tell the iframe to play or pause
    const iframe = frameRef.current;
    if (!iframe) return;
    if (isSC) {
      iframe.contentWindow.postMessage(JSON.stringify({ method: next ? 'play' : 'pause' }), '*');
    } else if (isMC) {
      iframe.contentWindow.postMessage(JSON.stringify({ method: next ? 'play' : 'pause' }), '*');
    }
  }

  if (!embedUrl) return null;

  return (
    <div style={{ background: 'var(--card)', borderTop: '1px solid var(--neon2)' }}>
      <style>{WAVE_CSS}</style>

      {/* Progress bar */}
      <div style={{ height: 2, background: 'rgba(255,255,255,.08)' }}>
        <div style={{ height: '100%', width: `${progress}%`, background: 'var(--neon2)', transition: 'width .5s linear' }} />
      </div>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px' }}>
        {thumb
          ? <img src={thumb} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
          : <div style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(0,229,255,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--neon2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
              </svg>
            </div>
        }

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
            {artistName}
          </div>
          <div style={{ fontSize: 10, color: 'var(--neon2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
            {trackTitle || '▶ Loading…'}
          </div>
        </div>

        {/* Sound wave — animates only when playing */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 14, flexShrink: 0 }}>
          {WAVE_BARS.map((b, i) => (
            <div key={i} style={{
              width: 3,
              height: 4,
              borderRadius: 2,
              background: 'var(--neon2)',
              opacity: playing ? 1 : 0.35,
              transition: 'opacity .3s',
              animation: playing ? (b.anim + ' ' + b.dur + ' ' + b.delay + ' ease-in-out infinite') : 'none',
            }} />
          ))}
        </div>

        {/* Play / pause */}
        <button
          onClick={togglePlay}
          style={{ background: 'none', border: 'none', color: 'var(--neon2)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}
        >{playing ? '⏸' : '▶'}</button>

        {/* Minimise toggle */}
        <button
          onClick={() => setMinimised(v => !v)}
          title={minimised ? 'Expand' : 'Minimise'}
          style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}
        >{minimised ? '▲' : '▼'}</button>

        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>✕</button>
      </div>

      {/* Full iframe — hidden when minimised, audio still plays */}
      <iframe
        ref={frameRef}
        src={embedUrl}
        width="100%"
        height={isSC ? 120 : 60}
        frameBorder="0"
        allow="autoplay"
        style={{ display: 'block', ...(minimised ? { position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1 } : {}) }}
        title="Mini Player"
      />
    </div>
  );
}
