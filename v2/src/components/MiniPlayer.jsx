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

// Load SC Widget API script once
function loadSCApi() {
  return new Promise((resolve) => {
    if (window.SC) { resolve(window.SC); return; }
    const existing = document.querySelector('script[src*="soundcloud.com/player/api"]');
    if (existing) { existing.addEventListener('load', () => resolve(window.SC)); return; }
    const s = document.createElement('script');
    s.src = 'https://w.soundcloud.com/player/api.js';
    s.onload = () => resolve(window.SC);
    document.head.appendChild(s);
  });
}

export default function MiniPlayer({ url, artistName, hasNext, onClose, onFinish, onNext }) {
  const [trackTitle, setTrackTitle] = useState('');
  const [thumb,      setThumb]      = useState('');
  const [progress,   setProgress]   = useState(0);
  const [minimised,  setMinimised]  = useState(false);
  const [playing,    setPlaying]    = useState(true);
  const frameRef  = useRef(null);
  const widgetRef = useRef(null); // SC Widget instance
  const timerRef  = useRef(null);
  const startRef  = useRef(Date.now());
  const CLIP_MS   = 90 * 1000;

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

  // Init SC Widget API after iframe loads
  function onIframeLoad() {
    if (!isSC || !frameRef.current) return;
    loadSCApi().then(SC => {
      const widget = SC.Widget(frameRef.current);
      widgetRef.current = widget;
      widget.bind(SC.Widget.Events.PLAY,   () => setPlaying(p => p   ? p : true));
      widget.bind(SC.Widget.Events.PAUSE,  () => setPlaying(p => !p  ? p : false));
      widget.bind(SC.Widget.Events.FINISH, () => { setPlaying(p => !p ? p : false); onFinish?.(); });
    });
  }

  // Mixcloud: postMessage listener
  useEffect(() => {
    if (!isMC) return;
    function onMessage(e) {
      if (!e.data) return;
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (data.method === 'play')  setPlaying(true);
        if (data.method === 'pause') setPlaying(false);
      } catch {}
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [isMC]);

  // Progress timer — driven by SC widget position, not local state
  const playingRef = useRef(true);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  useEffect(() => {
    startRef.current = Date.now();
    timerRef.current = setInterval(() => {
      if (!playingRef.current) return;
      const elapsed = Date.now() - startRef.current;
      setProgress(Math.min(elapsed / CLIP_MS * 100, 100));
    }, 500);
    return () => clearInterval(timerRef.current);
  }, [url]);

  function togglePlay() {
    const next = !playing;
    setPlaying(next);
    if (isSC && widgetRef.current) {
      next ? widgetRef.current.play() : widgetRef.current.pause();
    } else if (isMC && frameRef.current) {
      frameRef.current.contentWindow.postMessage(
        JSON.stringify({ method: next ? 'play' : 'pause' }),
        'https://www.mixcloud.com'
      );
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
        <button onClick={togglePlay} style={{ background: 'none', border: 'none', color: 'var(--neon2)', cursor: 'pointer', padding: '0 4px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {playing
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
          }
        </button>

        {/* Skip */}
        <button onClick={hasNext ? onNext : undefined} title="Skip to next" style={{ background: 'none', border: 'none', color: hasNext ? 'var(--muted)' : 'rgba(255,255,255,.2)', cursor: hasNext ? 'pointer' : 'default', padding: '0 4px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 15,12 5,21"/><rect x="17" y="3" width="3" height="18"/></svg>
        </button>

        {/* Minimise toggle */}
        <button onClick={() => setMinimised(v => !v)} title={minimised ? 'Expand' : 'Minimise'} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '0 4px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {minimised
            ? <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="12,5 22,19 2,19"/></svg>
            : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="12,19 2,5 22,5"/></svg>
          }
        </button>

        {/* Close */}
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '0 4px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      {/* Full iframe — hidden when minimised, audio still plays */}
      <iframe
        ref={frameRef}
        src={embedUrl}
        width="100%"
        height={isSC ? 120 : 60}
        frameBorder="0"
        allow="autoplay; encrypted-media"
        onLoad={onIframeLoad}
        style={{ display: 'block', ...(minimised ? { position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1 } : {}) }}
        title="Mini Player"
      />
    </div>
  );
}
