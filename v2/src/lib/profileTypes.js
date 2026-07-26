// "rrggbb" -> "r,g,b", so a second RGB string is never hand-typed alongside a
// hex value (that's exactly how accent/accent2 drifted apart in ProfileScreen,
// PortraitCard, FollowingSection, EnquiryCard, ApplicationCard, MySceneScreen,
// CardTagPicker, and DashboardStats — see the 10D Cross-Profile QA audit).
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

// Key order is the shared canonical role ordering for V2 (Venue first —
// reflects the platform's primary discovery flow). Object.keys/entries/values
// preserve insertion order, so anything that iterates PROFILE_TYPES directly
// (e.g. ProfileCard.jsx's TYPE_STYLES) inherits this order for free.
//
// This object is the SOLE source of truth for profile identity (10E.1,
// 2026-07). No component should define its own profile colours, gradients,
// labels, RGB values, or default images — every one of those was previously
// duplicated (and had drifted) across a dozen+ files; see the 10D audit.
// `label` is the full display label; `shortLabel` is the compact form for
// badges/pills where space is tight. Dashboard heading line-break text is
// deliberately NOT here — that's UI content each dashboard owns locally, not
// identity.
const RAW_TYPES = {
  venue: {
    accent:      '#00E5A0',
    accent2:     '#00B4D8',
    emoji:       '📍',
    label:       'VENUE',
    shortLabel:  'VENUE',
    pathPrefix:  'venue_avatars',
    dashPath:    '/industry/venue',
    gradient:    'linear-gradient(135deg, #00E5A0, #00B4D8)',
    defaultImage:'/defaultvenueblur.png',
  },
  host: {
    accent:      '#FF2D78',
    accent2:     '#00E5FF',
    emoji:       '🎛️',
    label:       'HOST / PROMOTER',
    shortLabel:  'HOST',
    pathPrefix:  'host_avatars',
    dashPath:    '/industry/host',
    gradient:    'linear-gradient(90deg, #FF2D78, #00E5FF)',
    // .png, not .jpg — the refreshed artwork arrived as a PNG at the same
    // 1654x951 the old .jpg was. Serving PNG bytes under a .jpg name works
    // (browsers sniff) but leaves a filename that lies about its contents.
    defaultImage:'/defaultpromoter.png',
  },
  artist: {
    accent:      '#00E5FF',
    accent2:     '#FF3399',
    emoji:       '🎧',
    label:       'DJ / PROD.',
    shortLabel:  'DJ / PROD.',
    pathPrefix:  'artist_avatars',
    dashPath:    '/industry/artist',
    gradient:    'linear-gradient(90deg, #00E5FF, #FF3399)',
    defaultImage:'/defaultdj.png',
  },
  band: {
    accent:      '#FFB830',
    accent2:     '#FF8C42',
    emoji:       '🎸',
    label:       'BAND',
    shortLabel:  'BAND',
    pathPrefix:  'band_avatars',
    dashPath:    '/industry/band',
    gradient:    'linear-gradient(90deg, #FFB830, #FF8C42)',
    defaultImage:'/defaultband.png',
  },
  standup: {
    accent:      '#FF88AA',
    accent2:     '#BF5FFF',
    emoji:       '🎤',
    label:       'COMEDY / POETRY',
    shortLabel:  'COMEDY',
    pathPrefix:  'standup_avatars',
    dashPath:    '/industry/standup',
    gradient:    'linear-gradient(90deg, #FF88AA, #BF5FFF)',
    defaultImage:'/defaultmic.png',
  },
};

export const PROFILE_TYPES = Object.fromEntries(
  Object.entries(RAW_TYPES).map(([type, t]) => [
    type,
    { ...t, rgb: hexToRgb(t.accent), accent2Rgb: hexToRgb(t.accent2) },
  ])
);

// Canonical ordered list of type keys — reuse this instead of writing another
// hardcoded venue/host/artist/band/standup array (see FollowingSection.jsx).
export const PROFILE_TYPE_ORDER = Object.keys(PROFILE_TYPES);

// ── The unknown type (10F) ───────────────────────────────────────────────
// A shared component handed a missing or unrecognised type must NOT inherit
// another profile's identity. Before 10F the fallback was `|| PROFILE_TYPES
// .artist` in ~12 places, so a band row with no `type` rendered as cyan
// "DJ / PROD." with a DJ's placeholder photo — confidently, and wrongly.
// Deliberately neutral and deliberately not pretty: if this ever renders,
// something upstream is broken and it should look like it, not like a DJ.
//
// `defaultImage` is null on purpose. There is no neutral placeholder asset,
// and picking any type's photo would reintroduce exactly the bug this exists
// to remove. Callers that render an <img> must handle null (see ProfileCard).
export const UNKNOWN_PROFILE = Object.freeze({
  accent:       '#8B90A0',
  accent2:      '#5A5F6E',
  rgb:          '139,144,160',
  accent2Rgb:   '90,95,110',
  emoji:        '',
  label:        'PROFILE',
  shortLabel:   'PROFILE',
  pathPrefix:   null,
  dashPath:     null,
  gradient:     'linear-gradient(90deg, #8B90A0, #5A5F6E)',
  defaultImage: null,
});

/**
 * The one way to turn a profile type into its identity tokens.
 *
 * Replaces the hand-written `PROFILE_TYPES[t] || PROFILE_TYPES.artist` pattern
 * that was copy-pasted across cards, screens and editors — each copy free to
 * pick a different (and differently wrong) fallback. Two of those copies
 * defaulted to venue, the rest to artist, which is how an empty Band dashboard
 * came to render a VENUE pill (fixed in 10E.3).
 *
 * Never returns undefined, never guesses a type. Unknown -> UNKNOWN_PROFILE.
 *
 * @param {string|null|undefined} type
 * @returns {typeof UNKNOWN_PROFILE} the type's tokens, or the neutral fallback
 */
/**
 * The Personal / Messenger identity.
 *
 * ⚠ DELIBERATELY NOT `UNKNOWN_PROFILE`, and deliberately not in PROFILE_TYPES.
 *
 * Punter used to fall through to UNKNOWN_PROFILE, which is the "something
 * upstream is broken" state — it is meant to look wrong. A punter profile is
 * not broken; it is a real, complete identity that simply has no industry
 * role. Folding the two together would either make every Personal profile
 * look like an error, or make genuine errors look normal. Both are worse than
 * one small extra constant.
 *
 * It stays out of PROFILE_TYPES because that map drives role pickers,
 * dashboards, application filters and PROFILE_TYPE_ORDER — punter belongs to
 * none of them (§A9: a Personal profile does not perform).
 *
 * `shortLabel: null` is what suppresses the type chip. A Personal profile is
 * just a person, and labelling them "PROFILE" told the reader nothing.
 */
export const PUNTER_PROFILE = Object.freeze({
  accent:       '#BF5FFF',
  accent2:      '#00E5FF',
  rgb:          '191,95,255',
  accent2Rgb:   '0,229,255',
  emoji:        '',
  label:        null,
  shortLabel:   null,
  pathPrefix:   null,
  dashPath:     null,
  gradient:     'linear-gradient(135deg, #00E5FF, #BF5FFF)',
  defaultImage: '/defaultpunter.webp',
});

export function profileIdentity(type) {
  if (!type) return UNKNOWN_PROFILE;
  const t = String(type).toLowerCase();
  if (t === 'punter') return PUNTER_PROFILE;
  return PROFILE_TYPES[t] || UNKNOWN_PROFILE;
}
