/**
 * ⭐ TURNING TYPED TEXT INTO LINKS — the tokeniser, with no JSX in it.
 *
 * A URL typed into a message must be clickable ON SIGHT: no menu, no long
 * press, no preview card. This file decides WHAT is a link; `renderText` in
 * messageKinds.jsx decides how one looks.
 *
 * ⛔ IT RETURNS DATA, NEVER MARKUP. Auto-linking arbitrary text that other
 * people wrote is a script-injection surface, and the one safe way through it
 * is to never build an HTML string at all — the caller maps these tokens onto
 * React elements, so nothing here can ever become executable.
 *
 * ⭐ PEOPLE DO NOT TYPE THE PROTOCOL (owner, 2026-08-11). "Check yespleez.com"
 * is how a human writes a web address, so a bare domain links. The cost is that
 * bare domains are also what filenames look like, which is what most of the
 * care below is about.
 */

/**
 * ⛔⛔ THE FILE-EXTENSION COLLISION — the reason this list is an ALLOWLIST.
 *
 * `README.md`, `script.sh`, `main.rs` and `photo.zip` all end in real
 * top-level domains: Moldova, St Helena, Serbia, and `.zip` really was sold as
 * a TLD. A "does it end in a dot plus letters" rule turns every filename
 * anybody mentions into a link.
 *
 * So a BARE domain must end in something from this list, and the list
 * deliberately omits every TLD that is a common file extension: ⛔ md, sh, rs,
 * pl, cc, ai, zip, mov, ps, so, im, cs, bat, com is fine but exe/dll are not
 * TLDs at all. ⚠ Anything added here should be checked against "would I ever
 * type this as a filename in a message".
 *
 * ⭐ A scheme (`https://`) or a `www.` prefix SKIPS this check entirely —
 * typing either is unambiguous intent, so `https://foo.md` links happily.
 */
const BARE_TLDS = new Set([
  // Generic
  'com', 'net', 'org', 'edu', 'gov', 'int', 'info', 'biz', 'name', 'pro',
  // The ones this scene actually uses
  'app', 'dev', 'io', 'co', 'live', 'fm', 'tv', 'music', 'band', 'studio',
  'events', 'tickets', 'agency', 'media', 'art', 'design', 'gallery',
  'page', 'site', 'online', 'store', 'shop', 'blog', 'news', 'xyz', 'club',
  // Countries — Australia first, then the ones a Bellingen act plausibly links
  'au', 'nz', 'uk', 'us', 'ca', 'de', 'fr', 'es', 'nl', 'se', 'no', 'dk',
  'fi', 'ie', 'jp', 'kr', 'br', 'mx', 'za', 'eu',
]);

/** Second-level suffixes that sit in front of a country code. */
const SECOND_LEVEL = new Set(['com', 'net', 'org', 'edu', 'gov', 'co', 'ac', 'id']);

/**
 * ⛔ ONLY THESE TWO EVER BECOME AN `href`. `javascript:`, `data:` and
 * `vbscript:` are the classic ways a "link" becomes code, and `mailto:`/`tel:`
 * are simply out of scope for this slice.
 */
const SAFE_SCHEMES = ['http://', 'https://'];

/**
 * Characters that commonly hug a URL in ordinary writing and are not part of
 * it. Stripped from the end, one at a time.
 *
 * ⚠ `)` is handled separately — a closing bracket can be part of the address
 * (Wikipedia does it constantly) or the end of a parenthetical containing one.
 */
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', '"', "'", '>', ']', '}', '…', '—', '–', '-']);
const LEADING  = new Set(['(', '[', '{', '"', "'", '<', '«']);

/**
 * ⚠ AN EMAIL IS NOT A WEB ADDRESS, and the naive matcher gets this actively
 * wrong: without this check `lucious@gmail.com` yields a link on `gmail.com`
 * pulled out of the middle of somebody's address. The whole run is left as
 * plain text.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** A scheme, any scheme — used to reject the unsafe ones outright. */
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** host(/path)? with no scheme. The host must have at least one dot. */
const BARE = /^((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})(?:[/?#][^\s]*)?$/i;

function tldOf(host) {
  const parts = host.toLowerCase().split('.');
  const last = parts[parts.length - 1];
  const prev = parts[parts.length - 2];
  // `yespleez.com.au` — the country code is the TLD, and the `com` in front of
  // it is expected rather than suspicious.
  if (parts.length >= 3 && SECOND_LEVEL.has(prev) && BARE_TLDS.has(last)) return last;
  return last;
}

/**
 * Trim the punctuation a sentence wraps around an address.
 *
 * ⭐ Balanced parentheses survive: a trailing `)` is removed only when the
 * candidate does not contain a matching `(`, so `(see example.com)` loses its
 * bracket and `example.com/a_(b)` keeps it.
 */
function trim(raw) {
  let s = raw;
  while (s.length && LEADING.has(s[0])) s = s.slice(1);
  let changed = true;
  while (changed && s.length) {
    changed = false;
    const last = s[s.length - 1];
    if (TRAILING.has(last)) { s = s.slice(0, -1); changed = true; continue; }
    if (last === ')') {
      const opens = (s.match(/\(/g) || []).length;
      const closes = (s.match(/\)/g) || []).length;
      if (closes > opens) { s = s.slice(0, -1); changed = true; }
    }
  }
  return s;
}

/**
 * Classify one whitespace-delimited run.
 * @returns {string|null} the href, or null when this is not a link.
 */
export function hrefFor(candidate) {
  if (!candidate) return null;
  const s = candidate;

  // ⛔ Unsafe scheme, or any scheme that is not http(s) — never a link.
  if (ANY_SCHEME.test(s)) {
    const lower = s.toLowerCase();
    return SAFE_SCHEMES.some(p => lower.startsWith(p)) ? s : null;
  }

  // ⚠ Before the bare-domain rule, or an address donates its domain to a link.
  if (EMAIL.test(s)) return null;

  const m = BARE.exec(s);
  if (!m) return null;
  const host = m[1];
  // A host label may not be all digits — stops "3.5" and version numbers.
  if (/^[\d.]+$/.test(host)) return null;

  // ⭐ `www.` is unambiguous intent: link it whatever the TLD.
  if (/^www\./i.test(host)) return `https://${s}`;

  // ⛔ Otherwise the TLD must be one we accept bare — see BARE_TLDS.
  return BARE_TLDS.has(tldOf(host)) ? `https://${s}` : null;
}

/**
 * Split `text` into render tokens.
 *
 * ⭐ THE ORIGINAL TEXT IS ALWAYS RECOVERABLE: concatenating every token's
 * `value` returns the input exactly, whitespace included. Nothing is
 * normalised, nothing is dropped — `message.body` stays the single source for
 * copy, notification previews and screen readers.
 *
 * @param {string} text
 * @returns {Array<{type:'text'|'url', value:string, href?:string}>}
 */
export function linkify(text) {
  if (typeof text !== 'string' || text === '') return [];
  const tokens = [];
  let buffer = '';
  const pushText = s => { if (s) buffer += s; };
  const flush = () => { if (buffer) { tokens.push({ type: 'text', value: buffer }); buffer = ''; } };

  // Runs of non-whitespace, with the whitespace between them preserved.
  const re = /\S+/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    pushText(text.slice(last, m.index));
    const run = m[0];
    const candidate = trim(run);
    const href = candidate ? hrefFor(candidate) : null;
    if (href) {
      // The punctuation trimmed off the ends is still text and still shown.
      const at = run.indexOf(candidate);
      pushText(run.slice(0, at));
      flush();
      tokens.push({ type: 'url', value: candidate, href });
      buffer = run.slice(at + candidate.length);
    } else {
      pushText(run);
    }
    last = m.index + run.length;
  }
  pushText(text.slice(last));
  flush();
  return tokens;
}
