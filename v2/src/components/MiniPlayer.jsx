import { useState, useEffect, useRef } from 'react';
import { claimAudio, releaseAudio, forgetAudio } from '../lib/mediaSession';
import { createResumableSource } from '../lib/mediaProviders';
import { providerFor } from '../lib/demoMixProviders';

/**
 * THE MINI PLAYER — orchestration and presentation. Nothing else.
 *
 * ── ⚠ IT MUST NEVER ASK WHICH PROVIDER THIS IS ───────────────────────
 *
 * No `isSoundCloud`, no `isMixcloud`, no `isSpotify`. This component resolves a
 * provider and attaches it; everything after that — widgets, third-party
 * scripts, event bindings, metadata endpoints, position tracking, readiness —
 * belongs to the provider implementation.
 *
 * That is the whole architectural guarantee: adding a Demo Mix provider is
 * implementing the interface and registering it. If a new provider requires
 * editing THIS FILE, the abstraction has sprung a leak and the leak is the
 * defect. A contract test enforces it.
 *
 * ── THE MEDIA SESSION SEAM ───────────────────────────────────────────
 *
 * This is the application's LONG source. It knows nothing about Voiceys, audio
 * messages or interruption policy — it exposes the ability to be paused and
 * resumed, and the Media Session Manager decides when.
 */

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

/** How long the progress bar takes to fill. Presentation only. */
const CLIP_MS = 90 * 1000;

export default function MiniPlayer({ url, artistName, hasNext, onClose, onFinish, onNext }) {
  const [trackTitle, setTrackTitle] = useState('');
  const [thumb,      setThumb]      = useState('');
  const [progress,   setProgress]   = useState(0);
  const [minimised,  setMinimised]  = useState(false);
  const [playing,    setPlaying]    = useState(true);
  // Set once the rendered element exists and, for an iframe, has loaded.
  // Attachment waits on this because a provider is given the element to bind to.
  const [surfaceReady, setSurfaceReady] = useState(false);

  const elRef      = useRef(null);
  const sessionRef = useRef(null);
  const startRef   = useRef(Date.now());

  // The single question this component asks about providers.
  const provider = providerFor(url);
  const embedUrl = provider ? provider.embedUrl(url) : null;

  /**
   * Attach the provider, register the source, and tear both down together.
   *
   * ⚠ RE-RUNS ON URL CHANGE, AND `forgetAudio` IS WHY. The outgoing provider's
   * element is about to be replaced, so a PARKED reference to it would later
   * resume a widget that no longer exists — see `mediaSession.forgetAudio`.
   * `releaseAudio` would be wrong here: it deliberately preserves the parked
   * source, which is right for a manual pause and wrong for a teardown.
   */
  useEffect(() => {
    if (!provider || !surfaceReady || !elRef.current) return;

    const attached = provider.attach({
      el: elRef.current,
      url,
      on: {
        // ⚠ CLAIMS ON THE PROVIDER'S OWN PLAY EVENT, not on our button. Every
        // embed has a play control inside its iframe; without this, audio
        // started there would never take the session and a Voicey would not
        // interrupt it.
        play: () => {
          setPlaying(true);
          if (sessionRef.current) claimAudio(sessionRef.current);
        },
        pause: () => setPlaying(false),
        finish: () => { setPlaying(false); onFinish?.(); },
        metadata: ({ title, thumbnail }) => {
          if (title)     setTrackTitle(title);
          if (thumbnail) setThumb(thumbnail);
        },
      },
    });

    sessionRef.current = createResumableSource(attached.adapter);
    claimAudio(sessionRef.current);

    return () => {
      attached.detach();
      if (sessionRef.current) forgetAudio(sessionRef.current);
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider?.id, url, surfaceReady]);

  // A new address means a new surface: the element must re-announce itself
  // before the next provider is attached to it.
  useEffect(() => {
    setSurfaceReady(provider?.surface === 'audio');
    setTrackTitle('');
    setThumb('');
  }, [url, provider?.surface]);

  // Progress bar. Presentation only — it is a clip timer, not a playhead.
  const playingRef = useRef(true);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  useEffect(() => {
    startRef.current = Date.now();
    const id = setInterval(() => {
      if (!playingRef.current) return;
      setProgress(Math.min((Date.now() - startRef.current) / CLIP_MS * 100, 100));
    }, 500);
    return () => clearInterval(id);
  }, [url]);

  function togglePlay() {
    const next = !playing;
    setPlaying(next);
    const source = sessionRef.current;
    if (!source) return;

    if (next) {
      claimAudio(source);
      source.resume();
    } else {
      // Release, never finish: a LONG source interrupts nothing, and pausing it
      // is a request for silence rather than a handover.
      source.pause();
      releaseAudio(source);
    }
  }

  if (!embedUrl) return null;

  const surfaceStyle = minimised
    ? { position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1 }
    : {};

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

      {/* ⚠ THE SURFACE IS CHOSEN BY A VALUE, NOT A BRANCH ON PROVIDER IDENTITY.
          A provider declares what it needs rendered; this renders it. A future
          provider wanting a third surface adds one case here and nothing
          anywhere else. */}
      {provider.surface === 'audio' ? (
        <audio
          ref={elRef}
          src={embedUrl}
          autoPlay
          controls={!minimised}
          onLoadedMetadata={() => setSurfaceReady(true)}
          style={{ display: 'block', width: '100%', ...surfaceStyle }}
        />
      ) : (
        <iframe
          ref={elRef}
          src={embedUrl}
          width="100%"
          height={120}
          frameBorder="0"
          allow="autoplay; encrypted-media"
          onLoad={() => setSurfaceReady(true)}
          style={{ display: 'block', ...surfaceStyle }}
          title="Mini Player"
        />
      )}
    </div>
  );
}
