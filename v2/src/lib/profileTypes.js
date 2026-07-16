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
    defaultImage:'/defaultpromoter.jpg',
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
