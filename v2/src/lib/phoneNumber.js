/**
 * E.164 normalisation — the pure half of phone discovery.
 *
 * Split from `phoneKey.js` (which talks to the database) for the same reason
 * `voiceMachine.js` is split from `voiceNotes.js`: everything here is a pure
 * function of its input, so it is testable without mocking Supabase, and the
 * cases that actually break — a pasted +61, an Italian leading zero, a
 * non-breaking space from a contact card — get covered properly.
 *
 * ⚠ THE SERVER VALIDATES THE SAME SHAPE AND WILL REJECT ANYTHING ELSE.
 * `phone_key_hash()` in Postgres enforces `^\+[1-9][0-9]{6,14}$`. E164_RE below
 * is that regex, character for character. If one changes the other must, or the
 * client will happily hash something the database refuses — which surfaces as a
 * generic "invalid_parameter_value" a long way from the cause.
 *
 * ⚠ NORMALISATION IS A PRIVACY BOUNDARY, NOT A CONVENIENCE. The number that
 * gets hashed must be byte-identical for the same human on every device, or
 * two people who do have each other's number will never match. "0412 345 678"
 * saved on one phone and "+61 412 345 678" on another are the same person, and
 * the hash only agrees if this module says so first.
 */

/** Exactly the server's regex. See the header warning before touching it. */
export const E164_RE = /^\+[1-9][0-9]{6,14}$/;

/**
 * Dial codes we offer in the picker.
 *
 * Deliberately short and AU-first rather than all ~250: this is a scene app in
 * northern NSW, and a picker that opens on Afghanistan serves nobody. Ordered
 * by likelihood for this audience, and `COUNTRIES` order IS the picker order.
 *
 * `trunk` — the national prefix dropped when converting to E.164. Almost
 * everywhere that is '0'. Italy is the famous exception: Italian landlines keep
 * their leading zero, so stripping it produces an unreachable number.
 */
export const COUNTRIES = [
  { iso: 'AU', name: 'Australia',      dial: '61',  trunk: '0' },
  { iso: 'NZ', name: 'New Zealand',    dial: '64',  trunk: '0' },
  { iso: 'GB', name: 'United Kingdom', dial: '44',  trunk: '0' },
  { iso: 'US', name: 'United States',  dial: '1',   trunk: '1' },
  { iso: 'CA', name: 'Canada',         dial: '1',   trunk: '1' },
  { iso: 'IE', name: 'Ireland',        dial: '353', trunk: '0' },
  { iso: 'DE', name: 'Germany',        dial: '49',  trunk: '0' },
  { iso: 'FR', name: 'France',         dial: '33',  trunk: '0' },
  { iso: 'ES', name: 'Spain',          dial: '34',  trunk: null },
  { iso: 'NL', name: 'Netherlands',    dial: '31',  trunk: '0' },
  { iso: 'IT', name: 'Italy',          dial: '39',  trunk: null },
  { iso: 'JP', name: 'Japan',          dial: '81',  trunk: '0' },
  { iso: 'ID', name: 'Indonesia',      dial: '62',  trunk: '0' },
  { iso: 'TH', name: 'Thailand',       dial: '66',  trunk: '0' },
  { iso: 'BR', name: 'Brazil',         dial: '55',  trunk: '0' },
  { iso: 'ZA', name: 'South Africa',   dial: '27',  trunk: '0' },
];

export const DEFAULT_COUNTRY = 'AU';

/** @returns {{iso:string,name:string,dial:string,trunk:string|null}|null} */
export function country(iso) {
  return COUNTRIES.find((c) => c.iso === iso) ?? null;
}

/**
 * Strip everything a human or a contact card might put in a number.
 *
 * Covers the ordinary separators plus the ones that are invisible and
 * therefore never guessed: NBSP (U+00A0) and narrow NBSP (U+202F) both arrive
 * from iOS contact cards, and a bare Unicode minus (U+2212) from some Android
 * dialers. A stray one of these makes an otherwise perfect number fail to
 * match, with nothing visible on screen to explain why.
 */
function strip(raw) {
  return String(raw ?? '').replace(/[\s  ()\-.‐-―−/]/g, '');
}

/**
 * Turn whatever the user typed into E.164, or explain why it can't be.
 *
 * The `iso` argument is only a fallback: a number that already carries its own
 * country (a leading `+`, or an international `00` prefix) keeps it and IGNORES
 * `iso`. That is what makes pasting a friend's `+64…` work while the picker
 * still says Australia — and it is why `toE164` also reports which country it
 * landed on, so the UI can move the chip to match (§4 of the spec).
 *
 * @param {string} raw    what the user typed or pasted
 * @param {string} iso    country to assume when the number carries none
 * @returns {{e164: string|null, iso: string|null, reason: string|null}}
 */
export function toE164(raw, iso = DEFAULT_COUNTRY) {
  const s = strip(raw);
  if (!s) return { e164: null, iso: null, reason: 'empty' };

  // `00` is the international access prefix across most of the world; treat it
  // as a written-out `+` before anything else looks at the leading zero, or the
  // trunk-stripping below would eat half of it.
  const withPlus = s.startsWith('00') ? `+${s.slice(2)}` : s;

  if (withPlus.startsWith('+')) {
    const digits = withPlus.slice(1);
    if (!/^[0-9]+$/.test(digits)) return { e164: null, iso: null, reason: 'not-a-number' };
    const e164 = `+${digits}`;
    if (!E164_RE.test(e164)) {
      return { e164: null, iso: null, reason: digits.length < 7 ? 'too-short' : 'too-long' };
    }
    return { e164, iso: isoForE164(e164), reason: null };
  }

  const c = country(iso);
  if (!c) return { e164: null, iso: null, reason: 'unknown-country' };
  if (!/^[0-9]+$/.test(withPlus)) return { e164: null, iso: null, reason: 'not-a-number' };

  // ⚠ A BARE COUNTRY CODE, TYPED WITHOUT THE '+'. "61412345678" with Australia
  // selected is the same number as "+61412345678", but the rule below would
  // read it as national and produce +6161412345678 — a number that cannot
  // exist, hashes cleanly, and is undiscoverable forever.
  //
  // Only applied to countries that HAVE a trunk prefix, where it is provably
  // safe: a national number there always begins with the trunk digit, so one
  // that instead begins with the country's own dial code cannot be national.
  // Italy and Spain are excluded precisely because that reasoning fails there.
  if (c.trunk && !withPlus.startsWith(c.trunk) && withPlus.startsWith(c.dial)) {
    const e164 = `+${withPlus}`;
    if (E164_RE.test(e164)) return { e164, iso: isoForE164(e164), reason: null };
  }

  // Drop the national trunk prefix. `trunk: null` (Italy, Spain) means the
  // leading digit is part of the number and must survive.
  let national = withPlus;
  if (c.trunk && national.startsWith(c.trunk)) national = national.slice(c.trunk.length);

  const e164 = `+${c.dial}${national}`;
  if (!E164_RE.test(e164)) {
    const n = e164.length - 1;
    return { e164: null, iso: null, reason: n < 7 ? 'too-short' : 'too-long' };
  }
  return { e164, iso: c.iso, reason: null };
}

/**
 * Which of our countries an E.164 number belongs to.
 *
 * ⚠ LONGEST DIAL CODE FIRST, and that is not currently provable against
 * COUNTRIES. No two entries collide today — only US and CA share `1`, and no
 * three-digit code in the list begins with `1` — so removing the sort changes
 * nothing and no test over the real list can fail. It becomes load-bearing the
 * moment anyone adds a NANP country (`+1242` Bahamas, `+1876` Jamaica) or any
 * code that extends another, at which point `+1` would claim it first and every
 * such number would resolve to the United States.
 *
 * `list` is injectable ONLY so that guarantee can be tested with a colliding
 * set. Production callers pass nothing. Found by mutation-testing: the original
 * test asserted the precedence and passed with the sort deleted.
 */
export function isoForE164(e164, list = COUNTRIES) {
  if (!E164_RE.test(String(e164 ?? ''))) return null;
  const digits = e164.slice(1);
  const byLength = [...list].sort((a, b) => b.dial.length - a.dial.length);
  return byLength.find((c) => digits.startsWith(c.dial))?.iso ?? null;
}

/** Cheap predicate for enabling a Search / Save button. */
export function isValidE164(value) {
  return E164_RE.test(String(value ?? ''));
}

/**
 * Group digits for display while typing. Cosmetic only — never hashed.
 *
 * AU mobiles are the case worth getting right because they are the vast
 * majority here: 04XX XXX XXX. Everything else falls back to 3-digit groups,
 * which is wrong in detail for some countries but readable everywhere, and
 * being subtly wrong about French grouping costs nothing.
 */
export function formatNational(raw, iso = DEFAULT_COUNTRY) {
  const s = strip(raw);
  if (!s) return '';

  // ⚠⚠ THE '+' MUST SURVIVE. This function is not merely cosmetic in practice:
  // the composer writes its OUTPUT back into the field, so whatever it returns
  // is what `toE164` later hashes. Discarding the '+' turned "+61412345678"
  // into "61412345678", which normalised to +6161412345678 — a number that
  // cannot exist, hashes perfectly happily, saves without error, and shows the
  // correct last three digits while being undiscoverable forever.
  //
  // That shipped, and it is why two real accounts could not find each other
  // while every diagnostic reported them healthy. A formatter that silently
  // changes the MEANING of its input is the trap; keep this lossless.
  if (s.startsWith('+')) {
    const d = s.slice(1);
    return `+${d.match(/.{1,3}/g)?.join(' ') ?? ''}`;
  }

  if (iso === 'AU' && s.startsWith('04')) {
    return [s.slice(0, 4), s.slice(4, 7), s.slice(7, 10)].filter(Boolean).join(' ');
  }
  return s.match(/.{1,3}/g).join(' ');
}

/**
 * Mask a number for display on the owner's own settings screen.
 *
 * The ONLY place in the entire product a phone number is ever rendered, and
 * even here it is masked by default (§7). Keeps the last three digits, which is
 * enough for someone to recognise their own number and useless to a
 * shoulder-surfer.
 */
export function maskE164(e164) {
  if (!isValidE164(e164)) return '';
  const tail = e164.slice(-3);
  return `••• ••• ${tail}`;
}
