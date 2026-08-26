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

/**
 * ⭐⭐ A DEMO MIX IS A PREVIEW: TWENTY MINUTES, THEN IT STOPS.
 *
 * Owner's rule, 2026-08-26, and it is ONE rule for every surface — profile,
 * Set Times, dashboard. ⛔ Not per-context: there is a single global player
 * (App.jsx mounts one and every surface calls `setPlayer`), so a cap that
 * applied "only in Set Times" would have to be threaded through the launch
 * site and would be silently absent anywhere that forgot.
 *
 * ⚠⚠ THIS WAS `CLIP_MS = 90 * 1000` AND IT CAPPED NOTHING. Its own comment
 * said "Presentation only": it filled the progress bar in ninety seconds and
 * then sat at 100% while an hour-long set played on. The bar announced a
 * limit the player did not enforce, which is the worst of both — a promise
 * on screen and no rule behind it.
 */
const PREVIEW_MS = 20 * 60 * 1000;

export default function MiniPlayer({ url, artistName, hasNext, onClose, onFinish, onNext }) {
  const [trackTitle, setTrackTitle] = useState('');
  const [thumb,      setThumb]      = useState('');
  const [progress,   setProgress]   = useState(0);
  const [minimised,  setMinimised]  = useState(false);
  /**
   * ⚠ STARTS FALSE — TRUTH, NOT ASSUMPTION.
   *
   * This was `true`, on the assumption the embed's `autoplay=1` would start
   * playback. Browsers block autoplay without a prior user gesture, so the
   * widget sat SILENT while the bars animated and the icon showed pause: the
   * player claimed to be playing when it was not, until you pressed
   * SoundCloud's own button. `false` here, driven to `true` only by the
   * provider's real PLAY event, makes the UI report what is actually happening.
   */
  const [playing,    setPlaying]    = useState(false);
  // Set once the rendered element exists and, for an iframe, has loaded.
  // Attachment waits on this because a provider is given the element to bind to.
  const [surfaceReady, setSurfaceReady] = useState(false);

  const elRef      = useRef(null);
  const sessionRef = useRef(null);
  // The raw provider primitives. The play/pause BUTTON drives these directly;
  // the resumable `source` is only for the manager's park/resume. They are
  // different verbs — "play this" vs "un-park what was interrupted".
  const adapterRef = useRef(null);

  // The single question this component asks about providers.
  const provider = providerFor(url);

  /**
   * ⭐ SOME ADDRESSES NEED ASKING ABOUT BEFORE THEY CAN BE PLAYED.
   *
   * A provider may declare `resolveEmbed` when the address a person pastes is
   * not always the address its player accepts — SoundCloud's share links are
   * the case that forced this. ⛔ THIS COMPONENT STILL DOES NOT KNOW WHICH
   * PROVIDER THAT IS: it calls an optional hook and uses whatever comes back.
   * Adding `isSoundcloud` here instead was the obvious fix and would have been
   * the first crack in the rule at the top of this file.
   *
   * ⚠ PLAYABLE FIRST, RESOLVED SECOND. The raw URL renders immediately, so the
   * common case — an address that already works — never waits on a network
   * call. The state only moves if the provider returns something different.
   */
  const [playable, setPlayable] = useState(url);

  useEffect(() => {
    setPlayable(url);
    const resolve = provider?.resolveEmbed;
    if (!resolve) return undefined;
    let dead = false;
    Promise.resolve(resolve(url))
      .then(next => { if (!dead && next && next !== url) setPlayable(next); })
      .catch(() => { /* the raw url stays — never worse than before */ });
    return () => { dead = true; };
  }, [url, provider]);

  // ⚠ The provider is chosen from the ORIGINAL url — what it is does not change
  // when the address is canonicalised — but the EMBED is built from `playable`.
  const embedUrl = provider ? provider.embedUrl(playable) : null;

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

    adapterRef.current = attached.adapter;
    sessionRef.current = createResumableSource(attached.adapter);

    // ⚠ NO EAGER claimAudio. Claiming here asserted this source held audio
    // before anything had played — the session-level twin of the `playing:true`
    // lie. The claim now happens in `on.play`, when the provider REPORTS it has
    // started, whether that came from autoplay succeeding or the user pressing
    // play. A source that never actually plays never takes the session.

    return () => {
      attached.detach();
      if (sessionRef.current) forgetAudio(sessionRef.current);
      sessionRef.current = null;
      adapterRef.current = null;
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

  /**
   * Show the full player briefly, then tuck it away.
   *
   * A demo mix should announce itself — you see what is playing and who it is —
   * and then get out of the conversation's way. It stays expanded ~4.5s and
   * self-minimises, UNLESS you have already touched the minimise control, in
   * which case your choice stands and the timer does not fight it.
   */
  const touchedRef = useRef(false);
  useEffect(() => {
    touchedRef.current = false;
    setMinimised(false);
    const t = setTimeout(() => { if (!touchedRef.current) setMinimised(true); }, 5000);
    return () => clearTimeout(t);
  }, [url]);

  const playingRef = useRef(false);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  /**
   * THE PREVIEW ALLOWANCE — and the bar that reports it.
   *
   * ⚠⚠ PLAYED TIME, NOT WALL-CLOCK TIME. The old bar measured
   * `Date.now() - start`, which was harmless while nothing depended on it and
   * is wrong the moment it stops playback: pause for half an hour, press play,
   * and a wall-clock cap would cut the track off instantly. Only the ticks
   * that elapse WHILE PLAYING are counted, so twenty minutes means twenty
   * minutes of listening.
   *
   * ⚠ `tickRef` advances on EVERY tick including paused ones — that is what
   * discards paused time rather than banking it.
   */
  const playedRef  = useRef(0);
  const tickRef    = useRef(Date.now());
  const cappedRef  = useRef(false);
  // The prop is a fresh closure on every render of App; a ref keeps this
  // interval from firing a stale one when the playlist has moved on.
  const finishRef  = useRef(onFinish);
  useEffect(() => { finishRef.current = onFinish; });

  useEffect(() => {
    playedRef.current = 0;
    tickRef.current   = Date.now();
    cappedRef.current = false;
    setProgress(0);

    const id = setInterval(() => {
      const now   = Date.now();
      const delta = now - tickRef.current;
      tickRef.current = now;
      if (!playingRef.current || cappedRef.current) return;

      playedRef.current += delta;
      setProgress(Math.min(playedRef.current / PREVIEW_MS * 100, 100));
      if (playedRef.current < PREVIEW_MS) return;

      /* ⭐ Reaching the allowance is treated exactly as the media ending on its
         own — same `onFinish`, so a playlist advances and a single mix closes
         the player, rather than the cap inventing a third outcome.
         ⛔ `cappedRef` because the interval keeps ticking until this effect is
         torn down, and firing finish twice would skip a track. */
      cappedRef.current = true;
      adapterRef.current?.pause();
      if (sessionRef.current) releaseAudio(sessionRef.current);
      setPlaying(false);
      finishRef.current?.();
    }, 500);

    return () => clearInterval(id);
  }, [url]);

  function togglePlay() {
    const source  = sessionRef.current;
    const adapter = adapterRef.current;
    if (!source || !adapter) return;

    // ⚠ DRIVES THE PROVIDER DIRECTLY, and does NOT set `playing` optimistically.
    // The provider's own PLAY/PAUSE event sets it — so the icon and the bars
    // can only ever show what is truly happening. `adapter.play()`, not
    // `source.resume()`: resume un-parks an interruption and does nothing when
    // nothing was parked, which is why the old play button appeared dead until
    // SoundCloud's internal control was used.
    if (playing) {
      adapter.pause();
      // Release without resuming: a LONG source interrupts nothing, and a
      // manual pause is a request for silence, not a handover.
      releaseAudio(source);
    } else {
      claimAudio(source);   // silence anything else first
      adapter.play();
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
        <button onClick={() => { touchedRef.current = true; setMinimised(v => !v); }} title={minimised ? 'Expand' : 'Minimise'} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '0 4px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
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
