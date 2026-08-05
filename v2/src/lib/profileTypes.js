// "rrggbb" -> "r,g,b", so a second RGB string is never hand-typed alongside a
// hex value (that's exactly how accent/accent2 drifted apart in ProfileScreen,
// PortraitCard, FollowingSection, EnquiryCard, ApplicationCard, MySceneScreen,
// CardTagPicker, and DashboardStats — see the 10D Cross-Profile QA audit).
export function hexToRgb(hex) {
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
// `muted` is the type's accent taken down to ~20–30% saturation — it should read almost like
// coloured black, not like the accent dimmed. Owner-specified hexes, 2026-08-02. It exists for
// surfaces that carry identity WITHOUT shouting it: the landscape ProfileCard uses it for the
// display-picture ring and glow only, and leaves the rest of the card neutral. Do NOT swap it in
// for `accent` anywhere text sits directly on a dark background — at these values the contrast
// is far below readable (see ProfileCard, where the genre line deliberately keeps `accent`).
const RAW_TYPES = {
  venue: {
    accent:      '#00E5A0',
    accent2:     '#00B4D8',
    muted:       '#13483A',   // dark emerald
    emoji:       '📍',
    label:       'VENUE',
    shortLabel:  'VENUE',
    pathPrefix:  'venue_avatars',
    dashPath:    '/industry/venue',
    gradient:    'linear-gradient(135deg, #00E5A0, #00B4D8)',
    defaultImage:'/defaultvenueblur.webp',
  },
  host: {
    accent:      '#FF2D78',
    accent2:     '#00E5FF',
    muted:       '#521638',   // dark magenta
    emoji:       '🎛️',
    label:       'HOST / PROMOTER',
    shortLabel:  'HOST',
    pathPrefix:  'host_avatars',
    dashPath:    '/industry/host',
    gradient:    'linear-gradient(90deg, #FF2D78, #00E5FF)',
    // ⚠ .webp AND THE BYTES REALLY ARE WEBP. This one has now been all three:
    // it arrived as a PNG named accordingly, was re-cut as a JPEG, and was
    // re-encoded to WebP in 2026-07. The rule that survives every time is that
    // the extension must match the contents — browsers sniff the bytes and
    // render a mislabelled file happily, so a filename that lies costs nothing
    // today and misleads whoever debugs it next. Whenever this artwork is
    // replaced, check the format, not the name.
    //
    // ⚠ THE FILE IS `defaultpromoter`, THE TYPE IS `host`. That mismatch is
    // older than this line; the artwork was never renamed when the role was.
    // Look it up by the key, not by guessing the filename from the type.
    defaultImage:'/defaultpromoter.webp',
  },
  artist: {
    accent:      '#00E5FF',
    accent2:     '#FF3399',
    muted:       '#0E4956',   // dark cyan
    emoji:       '🎧',
    label:       'DJ / PROD.',
    shortLabel:  'DJ / PROD.',
    pathPrefix:  'artist_avatars',
    dashPath:    '/industry/artist',
    gradient:    'linear-gradient(90deg, #00E5FF, #FF3399)',
    defaultImage:'/defaultdj.webp',
  },
  band: {
    accent:      '#FFB830',
    accent2:     '#FF8C42',
    muted:       '#4D3B14',   // dark amber
    emoji:       '🎸',
    label:       'BAND',
    shortLabel:  'BAND',
    pathPrefix:  'band_avatars',
    dashPath:    '/industry/band',
    gradient:    'linear-gradient(90deg, #FFB830, #FF8C42)',
    defaultImage:'/defaultband.webp',
  },
  standup: {
    accent:      '#FF88AA',
    accent2:     '#BF5FFF',
    muted:       '#3E2456',   // dark purple
    emoji:       '🎤',
    label:       'COMEDY / POETRY',
    shortLabel:  'COMEDY',
    pathPrefix:  'standup_avatars',
    dashPath:    '/industry/standup',
    gradient:    'linear-gradient(90deg, #FF88AA, #BF5FFF)',
    defaultImage:'/defaultmic.webp',
  },
};

export const PROFILE_TYPES = Object.fromEntries(
  Object.entries(RAW_TYPES).map(([type, t]) => [
    type,
    { ...t, rgb: hexToRgb(t.accent), accent2Rgb: hexToRgb(t.accent2), mutedRgb: hexToRgb(t.muted) },
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
  // Neutral by construction — a broken row must not borrow a real type's identity, and that
  // holds for the muted tone exactly as it holds for the accent.
  muted:        '#2A2C33',
  rgb:          '139,144,160',
  accent2Rgb:   '90,95,110',
  mutedRgb:     '42,44,51',
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
  // 20% darker than the app's usual brand purple (#BF5FFF / rgb(191,95,255))
  // per owner request — each channel × 0.8. Scoped to punter's OWN accent
  // only; #BF5FFF is reused ad-hoc across dozens of unrelated screens
  // (buttons, headings, other dashboards) and none of them read this
  // constant, so darkening it here cannot touch any of them.
  accent:       '#994CCC',
  accent2:      '#00E5FF',
  // Same treatment as the industry types: the punter purple taken to a coloured black.
  muted:        '#2E1A40',
  rgb:          '153,76,204',
  accent2Rgb:   '0,229,255',
  mutedRgb:     '46,26,64',
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
