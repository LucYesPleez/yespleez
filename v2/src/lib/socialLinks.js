// Single shared implementation for every social/platform link field across all
// profile editors (Artist/Band/Host/Standup/Venue) and every place a social
// link gets rendered as a clickable URL (public profile, applicant cards,
// enquiry cards, event "claim" cards). Consolidates what used to be 4+
// separately copy-pasted normalization snippets, each handling a different
// subset of platforms inconsistently (see ProfileScreen.jsx/EventScreen.jsx/
// EnquiryCard.jsx/ApplicationCard.jsx history).
//
// The user can type a bare handle ("example"), a handle with "@", a
// domain-only URL ("instagram.com/example"), or a full URL
// ("https://instagram.com/example") — all four normalize to the same
// canonical stored value and the same destination URL.

// domain: the platform's canonical URL host.
// pathPrefix: a fixed path segment before the handle (e.g. LinkedIn's "in/").
const PLATFORMS = {
  instagram:  { domain: 'instagram.com' },
  facebook:   { domain: 'facebook.com' },
  tiktok:     { domain: 'tiktok.com', pathPrefix: '@' },
  soundcloud: { domain: 'soundcloud.com' },
  spotify:    { domain: 'open.spotify.com' },
  mixcloud:   { domain: 'mixcloud.com' },
  youtube:    { domain: 'youtube.com' },
  beatport:   { domain: 'beatport.com' },
  bandcamp:   { domain: 'bandcamp.com' },
  linkedin:   { domain: 'linkedin.com', pathPrefix: 'in/' },
};

function isEmpty(raw) {
  return raw === null || raw === undefined || !String(raw).trim();
}

function isNA(raw) {
  return !isEmpty(raw) && String(raw).trim().toUpperCase() === 'N/A';
}

// Strip protocol/www/platform-domain/@ /trailing slash down to the bare
// handle, regardless of which of the 4 accepted input shapes was typed.
function extractHandle(platformKey, raw) {
  const platform = PLATFORMS[platformKey];
  let v = String(raw).trim();
  v = v.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  if (platform) {
    const domainRe = new RegExp('^' + platform.domain.replace(/\./g, '\\.') + '\\/?', 'i');
    v = v.replace(domainRe, '');
    if (platform.pathPrefix) {
      const prefixRe = new RegExp('^' + platform.pathPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      v = v.replace(prefixRe, '');
    }
  }
  v = v.replace(/^@/, '');
  v = v.split('?')[0].split('#')[0].replace(/\/+$/, '');
  return v.trim();
}

// Ensure a generic (non-platform) URL — website, demo/mix links — has a
// protocol, without otherwise touching it. Bare domains ("mysite.com") and
// bare paths get "https://" prepended; already-full URLs pass through as-is.
export function ensureHttps(raw) {
  if (isEmpty(raw) || isNA(raw)) return isNA(raw) ? 'N/A' : '';
  const v = String(raw).trim();
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

// The bare handle for a known platform field, for display text like
// "@handle" — works on legacy/un-normalized values the same way
// socialProfileUrl does. Returns '' for unknown platforms (e.g. 'website'),
// since a generic URL has no "handle" to display.
export function socialHandle(platformKey, raw) {
  if (isEmpty(raw) || isNA(raw) || !PLATFORMS[platformKey]) return '';
  return extractHandle(platformKey, raw);
}

// The value to STORE for a known platform field — the bare handle, so what's
// in the database is always the same canonical shape no matter which of the
// 4 input formats the user typed. Unknown platform keys fall back to
// ensureHttps (used for `website`, which has no fixed handle/domain).
export function normalizeSocialValue(platformKey, raw) {
  if (isEmpty(raw)) return '';
  if (isNA(raw)) return 'N/A';
  const platform = PLATFORMS[platformKey];
  if (!platform) return ensureHttps(raw);
  return extractHandle(platformKey, raw);
}

// The full destination URL to OPEN for a known platform field — works
// whether the stored value is already-normalized (a bare handle) or legacy/
// un-normalized (a full URL, "@handle", etc.), so existing stored links keep
// working without needing to be re-saved.
export function socialProfileUrl(platformKey, raw) {
  if (isEmpty(raw) || isNA(raw)) return '';
  const platform = PLATFORMS[platformKey];
  if (!platform) return ensureHttps(raw);
  const handle = extractHandle(platformKey, raw);
  if (!handle) return '';
  return `https://${platform.domain}/${platform.pathPrefix || ''}${handle}`;
}
