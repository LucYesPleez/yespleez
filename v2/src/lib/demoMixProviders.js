import { soundcloudAdapter, mixcloudAdapter } from './mediaProviders';

/**
 * THE DEMO MIX PROVIDER ARCHITECTURE.
 *
 * ── A DEMO MIX IS A LOGICAL MEDIA TYPE, NOT A PLATFORM ───────────────
 *
 * An artist has a featured demo mix. Where it is hosted — SoundCloud, Mixcloud,
 * Spotify, or uploaded straight to YesPleez — is an implementation detail that
 * the profile, the player and the arbitration layer must never see.
 *
 * ⚠ DIRECT UPLOAD IS A PEER, NOT A FALLBACK. An artist who uses no third-party
 * platform is not a degraded case, and nothing here may treat them as one.
 *
 * ── THE GUARANTEE ────────────────────────────────────────────────────
 *
 * Adding a provider is TWO steps and nothing else:
 *
 *   1. implement the interface below
 *   2. add it to PROVIDERS
 *
 * No change to `MiniPlayer`, to `mediaSession`, to arbitration, or to any
 * existing provider. If a new provider requires editing the player, the
 * abstraction is incomplete and the leak is a defect, not a special case.
 *
 * ── THE INTERFACE ────────────────────────────────────────────────────
 *
 *   id            stable identifier, stored in captured session state
 *   label         what a human calls it
 *   matches(url)  → boolean; can this provider play that address?
 *   surface       'iframe' | 'audio' — what the player must render
 *   embedUrl(url) → the src for that surface
 *
 *   attach({ el, url, on }) → { adapter, detach }
 *
 * `attach` is where a provider does ALL of its work: create widgets, load
 * third-party scripts, bind events, fetch metadata, observe position. It
 * receives the rendered element, the media address, and a bag of callbacks; it
 * returns the playback primitives plus a teardown.
 *
 * `on` is deliberately small, and is the complete list of things the player
 * needs to know:
 *
 *   on.play()                    playback started, wherever it was started from
 *   on.pause()                   playback stopped
 *   on.finish()                  the media ended on its own
 *   on.metadata({title, thumbnail})   something displayable arrived
 *
 * ⚠ A PROVIDER MUST REPORT `on.play` FOR PLAYBACK IT DID NOT INITIATE. Every
 * platform embed has its own play button inside the iframe. If a provider only
 * reports plays that came through its own `play()`, the session manager never
 * learns audio started and a Voicey will not interrupt it.
 *
 * `surface` is the only concession to presentation, and it is a VALUE rather
 * than a branch: the player renders what it is told to. A future provider
 * needing a third surface adds one value here, not a third code path
 * everywhere.
 */

/** Load the SoundCloud widget API once, whoever asks first. */
function loadSCApi() {
  return new Promise(resolve => {
    if (window.SC) { resolve(window.SC); return; }
    const existing = document.querySelector('script[src*="soundcloud.com/player/api"]');
    if (existing) { existing.addEventListener('load', () => resolve(window.SC)); return; }
    const s = document.createElement('script');
    s.src = 'https://w.soundcloud.com/player/api.js';
    s.onload = () => resolve(window.SC);
    document.head.appendChild(s);
  });
}

/**
 * oEmbed title and artwork.
 *
 * Provider-specific by nature — each platform has its own endpoint — which is
 * exactly why it belongs in the provider rather than in a branch inside the
 * player. Failure is silent: a missing title is a cosmetic loss, never a reason
 * to stop playing.
 */
function fetchOEmbed(endpoint, on) {
  fetch(endpoint)
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      if (d?.title || d?.thumbnail_url) {
        on.metadata({ title: d.title ?? '', thumbnail: d.thumbnail_url ?? '' });
      }
    })
    .catch(() => {});
}

export const PROVIDERS = [
  {
    id: 'soundcloud',
    label: 'SoundCloud',
    matches: url => Boolean(url) && url.includes('soundcloud.com'),
    surface: 'iframe',
    embedUrl: url =>
      `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}`
      + '&color=%2300e5ff&auto_play=true&hide_related=true&show_comments=false'
      + '&show_user=false&show_reposts=false&show_teaser=false',

    attach({ el, url, on }) {
      let widget = null;
      let dead = false;

      fetchOEmbed(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`, on);

      // The API script may still be loading, so the widget arrives later than
      // this function returns. The adapter closes over `widget` rather than
      // capturing it, so calls made before it exists are dropped rather than
      // throwing.
      const ready = loadSCApi().then(SC => {
        if (dead) return;
        widget = SC.Widget(el);
        widget.bind(SC.Widget.Events.PLAY,   () => on.play());
        widget.bind(SC.Widget.Events.PAUSE,  () => on.pause());
        widget.bind(SC.Widget.Events.FINISH, () => { on.pause(); on.finish(); });
      });

      const base = soundcloudAdapter({
        pause:  () => widget?.pause(),
        play:   () => widget?.play(),
        seekTo: ms => widget?.seekTo(ms),
        // ⚠ THE CALLBACK MUST ALWAYS FIRE. `soundcloudAdapter` wraps this in a
        // promise, so a widget that does not exist yet would leave that promise
        // pending forever and the parked state would never settle.
        getPosition: cb => (widget ? widget.getPosition(cb) : cb(0)),
      }, { media: url });

      return {
        // ⚠ readiness is the WIDGET's, not the iframe's. Seeking before the
        // widget exists is silently discarded and would resume from zero.
        adapter: { ...base, whenReady: () => ready },
        detach() { dead = true; widget = null; },
      };
    },
  },

  {
    id: 'mixcloud',
    label: 'Mixcloud',
    matches: url => Boolean(url) && url.includes('mixcloud.com'),
    surface: 'iframe',
    embedUrl: url => {
      const feed = url.replace('https://www.mixcloud.com', '');
      return 'https://www.mixcloud.com/widget/iframe/?hide_cover=1&mini=1&autoplay=1'
        + `&feed=${encodeURIComponent(feed)}`;
    },

    attach({ el, url, on }) {
      // ⚠ MIXCLOUD ANSWERS NO QUERIES. It only emits progress, so the position
      // must be OBSERVED and remembered. Without this the provider could only
      // ever resume from the beginning.
      let positionMs = 0;

      fetchOEmbed(`https://www.mixcloud.com/oembed/?format=json&url=${encodeURIComponent(url)}`, on);

      function onMessage(e) {
        if (!e.data) return;
        try {
          const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
          if (typeof data.position === 'number') positionMs = data.position * 1000;
          if (data.method === 'play')  on.play();
          if (data.method === 'pause') on.pause();
          if (data.method === 'ended') { on.pause(); on.finish(); }
        } catch { /* not a message meant for us */ }
      }
      window.addEventListener('message', onMessage);

      return {
        adapter: mixcloudAdapter({
          media: url,
          post: msg => el?.contentWindow?.postMessage(JSON.stringify(msg), 'https://www.mixcloud.com'),
          getPosition: () => positionMs,
        }),
        detach() { window.removeEventListener('message', onMessage); },
      };
    },
  },

  {
    id: 'upload',
    label: 'YesPleez',
    /**
     * ⚠ THE CATCH-ALL, AND A FIRST-CLASS ONE. Anything not claimed above is a
     * file we serve ourselves. This provider is the simplest of the three,
     * which is the clearest evidence the abstraction sits at the right
     * altitude: a media element already satisfies the interface, so the
     * platform integrations are the complicated ones rather than the baseline.
     *
     * ⚠ ORDER MATTERS. `matches` accepts anything, so this must stay LAST.
     */
    matches: url => Boolean(url),
    surface: 'audio',
    embedUrl: url => url,

    attach({ el, url, on }) {
      const play   = () => on.play();
      const pause  = () => on.pause();
      const ended  = () => { on.pause(); on.finish(); };
      el?.addEventListener('play', play);
      el?.addEventListener('pause', pause);
      el?.addEventListener('ended', ended);

      return {
        adapter: {
          id: 'upload',
          media: () => url,
          pause: () => el?.pause(),
          play:  () => { void el?.play?.().catch(() => {}); },
          // Seconds here, milliseconds everywhere else. The conversion belongs
          // in the adapter — the only place that knows the unit differs.
          getPosition: () => (el ? Math.round(el.currentTime * 1000) : 0),
          seekTo: ms => { if (el) el.currentTime = ms / 1000; },
          // Setting currentTime on an element without metadata is silently
          // discarded, which would resume from the beginning rather than not at
          // all.
          whenReady: () => (
            !el || el.readyState >= 1
              ? Promise.resolve()
              : new Promise(resolve => el.addEventListener('loadedmetadata', resolve, { once: true }))
          ),
        },
        detach() {
          el?.removeEventListener('play', play);
          el?.removeEventListener('pause', pause);
          el?.removeEventListener('ended', ended);
        },
      };
    },
  },
];

/** The provider that can play this address, or null when there is none. */
export function providerFor(url) {
  if (!url) return null;
  return PROVIDERS.find(p => p.matches(url)) ?? null;
}

/** Lookup by stored id — for restoring a captured session. */
export function providerById(id) {
  return PROVIDERS.find(p => p.id === id) ?? null;
}
