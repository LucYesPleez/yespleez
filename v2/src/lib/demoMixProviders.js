import { soundcloudAdapter, mixcloudAdapter } from './mediaProviders';

/**
 * THE DEMO MIX PROVIDER REGISTRY.
 *
 * ── A DEMO MIX IS A LOGICAL MEDIA TYPE, NOT A PLATFORM ───────────────
 *
 * An artist has a featured demo mix. Where it is hosted — SoundCloud,
 * Mixcloud, Spotify, or uploaded straight to YesPleez — is an implementation
 * detail that the profile, the player and the arbitration layer must never see.
 *
 * ⚠ DIRECT UPLOAD IS A PEER, NOT A FALLBACK. An artist who uses no third-party
 * platform is not a degraded case, and nothing here may treat them as one: the
 * upload provider implements the same interface as every other and is resolved
 * by the same registry.
 *
 * ── WHY A REGISTRY AND NOT A CHAIN OF ifs ────────────────────────────
 *
 * The Media Session Manager was already provider-agnostic and is tested to stay
 * that way. But provider identity had simply MOVED rather than disappeared —
 * `MiniPlayer` asked `isSoundCloud(url)`, built one of two embed urls, and ran
 * one of two effects. Adding Spotify would have meant editing the player, which
 * is exactly what the architecture promises you never have to do.
 *
 * So the knowledge lives in one list. Adding a provider is:
 *
 *   1. implement the interface below
 *   2. add it to PROVIDERS
 *
 * and nothing else in the application changes.
 *
 * ── THE INTERFACE ────────────────────────────────────────────────────
 *
 *   id            stable identifier, stored in captured session state
 *   label         what a human calls it
 *   matches(url)  → boolean; can this provider play that address?
 *   surface       'iframe' | 'audio' — what the player must render
 *   embedUrl(url) → the src for that surface
 *   createAdapter({ el, url, getPosition })  → the primitives
 *                 `mediaProviders.createResumableSource` needs
 *
 * `surface` is the only concession to how a provider is displayed, and it is
 * deliberately a value rather than a branch: the player renders what it is told
 * to render, and a future provider needing a third surface adds one value here
 * rather than a third code path everywhere.
 */

/** SoundCloud embeds keep the app's own accent colour. */
function soundcloudEmbed(url) {
  return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}`
    + '&color=%2300e5ff&auto_play=true&hide_related=true&show_comments=false'
    + '&show_user=false&show_reposts=false&show_teaser=false';
}

function mixcloudEmbed(url) {
  const feed = url.replace('https://www.mixcloud.com', '');
  return 'https://www.mixcloud.com/widget/iframe/?hide_cover=1&mini=1&autoplay=1'
    + `&feed=${encodeURIComponent(feed)}`;
}

/**
 * ⚠ ORDER MATTERS ONLY FOR OVERLAP. `matches` is asked in sequence, so a
 * provider with a broad test must sit last. `directUpload` is deliberately the
 * final entry: it accepts anything the named platforms did not claim.
 */
export const PROVIDERS = [
  {
    id: 'soundcloud',
    label: 'SoundCloud',
    matches: url => Boolean(url) && url.includes('soundcloud.com'),
    surface: 'iframe',
    embedUrl: soundcloudEmbed,
    createAdapter: ({ widget, url }) => soundcloudAdapter(widget, { media: url }),
  },
  {
    id: 'mixcloud',
    label: 'Mixcloud',
    matches: url => Boolean(url) && url.includes('mixcloud.com'),
    surface: 'iframe',
    embedUrl: mixcloudEmbed,
    createAdapter: ({ el, url, getPosition }) => mixcloudAdapter({
      media: url,
      post: msg => el?.contentWindow?.postMessage(JSON.stringify(msg), 'https://www.mixcloud.com'),
      getPosition,
    }),
  },
  {
    id: 'upload',
    label: 'YesPleez',
    /**
     * ⚠ THE CATCH-ALL, AND A FIRST-CLASS ONE. Anything not claimed above is a
     * file we are serving ourselves. This provider is the simplest of the three
     * precisely because a media element already does everything the interface
     * asks for — which is the clearest evidence the abstraction is at the right
     * altitude: the platform integrations are the complicated ones, not the
     * baseline.
     */
    matches: url => Boolean(url),
    surface: 'audio',
    embedUrl: url => url,
    createAdapter: ({ el, url }) => ({
      id: 'upload',
      media: () => url,
      pause: () => el?.pause(),
      play:  () => { void el?.play?.().catch(() => {}); },
      // Seconds here, milliseconds everywhere else — the conversion belongs in
      // the adapter, which is the only place that knows the unit differs.
      getPosition: () => (el ? Math.round(el.currentTime * 1000) : 0),
      seekTo: ms => { if (el) el.currentTime = ms / 1000; },
      /**
       * A media element cannot be driven before it has metadata: setting
       * `currentTime` on an unloaded element is silently discarded, which would
       * resume the mix from the beginning rather than not at all.
       */
      whenReady: () => (
        !el || el.readyState >= 1
          ? Promise.resolve()
          : new Promise(resolve => el.addEventListener('loadedmetadata', resolve, { once: true }))
      ),
    }),
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
