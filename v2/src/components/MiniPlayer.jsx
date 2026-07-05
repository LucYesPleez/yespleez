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

export default function MiniPlayer({ url, artistName, onClose }) {
  const [trackTitle, setTrackTitle] = useState('');
  const [thumb,      setThumb]      = useState('');
  const [progress,   setProgress]   = useState(0);
  const frameRef   = useRef(null);
  const timerRef   = useRef(null);
  const startRef   = useRef(Date.now());
  const CLIP_MS    = 90 * 1000; // 90s preview

  const isSC = isSoundCloud(url);
  const isMC = isMixcloud(url);
  const embedUrl = isSC ? getSCEmbedUrl(url) : isMC ? getMCEmbedUrl(url) : null;

  // Load oEmbed metadata
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

  // Progress timer (visual only — estimates 90s clip)
  useEffect(() => {
    startRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      setProgress(Math.min(elapsed / CLIP_MS * 100, 100));
      if (elapsed >= CLIP_MS) {
        clearInterval(timerRef.current);
      }
    }, 500);
    return () => clearInterval(timerRef.current);
  }, [url]);

  if (!embedUrl) return null;

  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--neon2)',
      borderRadius: 14,
      overflow: 'hidden',
      marginBottom: 16,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
        {thumb
          ? <img src={thumb} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
          : <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(0,229,255,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--neon2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
              </svg>
            </div>
        }
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {artistName}
          </div>
          <div style={{ fontSize: 11, color: 'var(--neon2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
            {trackTitle || '▶ Loading…'}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>✕</button>
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, background: 'rgba(255,255,255,.08)' }}>
        <div style={{ height: '100%', width: `${progress}%`, background: 'var(--neon2)', transition: 'width .5s linear' }} />
      </div>

      {/* Embedded iframe */}
      <iframe
        ref={frameRef}
        src={embedUrl}
        width="100%"
        height={isSC ? 120 : 60}
        frameBorder="0"
        allow="autoplay"
        style={{ display: 'block' }}
        title="Mini Player"
      />
    </div>
  );
}
