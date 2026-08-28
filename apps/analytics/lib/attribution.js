/**
 * ATTRIBUTION — pure. Campaign context and how strongly it binds.
 * ---------------------------------------------------------------------------
 * Attribution is ADDITIVE: it never identifies a person, never rewrites
 * a raw row, and every funnel stage carries a label saying HOW it was
 * joined. A number without its strength label may not leave this module.
 *
 * ── THE VOCABULARY ──────────────────────────────────────────────────
 *   medium     closed set: qr · link · share · other
 *   source     conventioned: {placement}_{medium} — bar_qr, poster_qr, ig_bio
 *   campaign   optional grouping — rel-aug-launch
 *   placement  / creative — optional physical/AB refinement
 *
 * URL params (short, poster-friendly):
 *   ?src=bar_qr        source (required for a touch to exist)
 *   &m=qr              medium (optional; inferred from src suffix, else 'link')
 *   &c=rel-aug-launch  campaign
 *   &pl=front-window   placement
 *   &cr=v2-gold        creative
 */

export const MEDIUMS = Object.freeze(['qr', 'link', 'share', 'other']);

export const STRENGTHS = Object.freeze([
  'session-attributed',  // same session_id as the touch
  'device-attributed',   // same device_id, different/absent session
  'person-attributed',   // joined through identity_links — RESOLVED, labelled
  'unattributed',
]);

/**
 * Read campaign params from a query string or params object.
 * Returns null when no `src` — no source, no touch, by definition:
 * an unattributed arrival is the absence of a row, never a junk one.
 */
export function parseAttributionParams(search) {
  const p = typeof search === 'string' ? new URLSearchParams(search.replace(/^\?/, '')) : null;
  const get = (k) => (p ? p.get(k) : search?.[k]) || null;
  const source = sanitise(get('src'));
  if (!source) return null;
  let medium = sanitise(get('m'));
  if (!MEDIUMS.includes(medium)) {
    // Convention does the work: bar_qr / poster_qr say what they are.
    medium = source.endsWith('_qr') ? 'qr' : source.endsWith('_share') ? 'share' : 'link';
  }
  return {
    source,
    medium,
    campaign: sanitise(get('c')),
    placement: sanitise(get('pl')),
    creative: sanitise(get('cr')),
  };
}

/** Params are poster-typed and URL-carried: trim, cap, and keep them tokens. */
function sanitise(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, 64);
  return /^[\w-]+$/.test(t) ? t : null;
}

/**
 * Coalesce raw touch rows for reporting: one line per
 * campaign|source|placement|creative, with device reach and span.
 * The raw rows stay untouched underneath — this is a read shape.
 */
export function coalesceTouches(rows) {
  const by = new Map();
  for (const r of rows || []) {
    const k = [r.campaign, r.source, r.placement, r.creative].map((x) => x ?? '').join('|');
    let g = by.get(k);
    if (!g) {
      g = {
        campaign: r.campaign ?? null, source: r.source, medium: r.medium,
        placement: r.placement ?? null, creative: r.creative ?? null,
        touches: 0, devices: new Set(), sessions: new Set(),
        first_seen: r.created_at, last_seen: r.created_at,
        platforms: {},
      };
      by.set(k, g);
    }
    g.touches++;
    if (r.device_id) g.devices.add(r.device_id);
    if (r.session_id) g.sessions.add(r.session_id);
    if (r.created_at < g.first_seen) g.first_seen = r.created_at;
    if (r.created_at > g.last_seen) g.last_seen = r.created_at;
    if (r.platform) g.platforms[r.platform] = (g.platforms[r.platform] || 0) + 1;
  }
  return [...by.values()]
    .map((g) => ({ ...g, devices: g.devices.size, sessions: g.sessions.size }))
    .sort((a, b) => b.touches - a.touches);
}

/**
 * How strongly an event binds to a set of touches.
 *
 * ⚠ ORDER IS THE CONTRACT: strongest first, one label, never blended.
 * person-attributed exists ONLY through an identity link and only for
 * an ATTRIBUTED event whose account links to a touched device — it is
 * resolution, clearly labelled, never a claim about anonymous rows.
 */
export function attributionStrength(event, touches, links) {
  const touchSessions = new Set((touches || []).map((t) => t.session_id).filter(Boolean));
  const touchDevices = new Set((touches || []).map((t) => t.device_id).filter(Boolean));
  if (event.session_id && touchSessions.has(event.session_id)) return 'session-attributed';
  if (event.device_id && touchDevices.has(event.device_id)) return 'device-attributed';
  if (event.user_id) {
    // The person's OTHER devices, reached through explicit links.
    for (const l of links || []) {
      if (l.user_id === event.user_id && touchDevices.has(l.device_id)) return 'person-attributed';
    }
  }
  return 'unattributed';
}

/**
 * A funnel: for each stage, how many matching events bind to the
 * touches, split BY STRENGTH — the split is the deliverable, and a
 * total may only ever be printed as the sum of its named parts.
 *
 * Per-platform on every stage, because the iOS PWA storage sandbox
 * mints a new device_id on install: an iOS scan→install→apply chain
 * is STRUCTURALLY invisible at device strength, and the platform
 * split is what keeps that limitation in view instead of under a
 * confident cross-platform number.
 *
 * @param stages [{key, match(event)=>bool}] in funnel order
 */
export function funnel(touches, events, links, stages) {
  const touchDevices = new Set((touches || []).map((t) => t.device_id).filter(Boolean));
  return (stages || []).map((stage) => {
    const strengths = { 'session-attributed': 0, 'device-attributed': 0, 'person-attributed': 0 };
    const people = new Set(); const devices = new Set(); const platforms = {};
    for (const e of events || []) {
      if (!stage.match(e)) continue;
      const s = attributionStrength(e, touches, links);
      if (s === 'unattributed') continue;
      strengths[s]++;
      if (e.user_id) people.add(e.user_id);
      if (e.device_id) devices.add(e.device_id);
      const plat = e.platform || 'other';
      platforms[plat] = (platforms[plat] || 0) + 1;
    }
    return {
      stage: stage.key,
      attributed_events: strengths['session-attributed'] + strengths['device-attributed'] + strengths['person-attributed'],
      by_strength: strengths,
      people: people.size,
      devices: devices.size,
      by_platform: platforms,
      ios_caveat: touchDevices.size > 0 && (platforms.ios || 0) > 0
        ? 'iOS PWA installs mint a new device_id; device-attributed iOS figures are a lower bound'
        : undefined,
    };
  });
}
