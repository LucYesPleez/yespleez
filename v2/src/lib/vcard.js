/**
 * vCard (.vcf) parsing — the contact import path for every platform the
 * Contact Picker abandons.
 *
 * ⚠ WHY THIS EXISTS. `navigator.contacts` is Chrome-on-Android and nothing
 * else: not Safari, not any iOS browser (all WebKit underneath), not desktop
 * Chrome. That left bulk contact matching impossible for the owner's own
 * iPhone and for every desktop user — while the feature's whole value is
 * finding people you already know.
 *
 * A .vcf file is the one route that works everywhere, because it is what every
 * address book already exports: iOS Contacts (Share Contact → Save to Files),
 * Google Contacts, Outlook, macOS Contacts. The user picks a file; the browser
 * hands us text.
 *
 * ⚠ THE PRIVACY MODEL IS UNCHANGED, AND THAT IS NOT AN ACCIDENT. Parsing
 * happens here, on the device, and the output feeds the SAME syncContacts()
 * pipeline the picker feeds — numbers become scrambled codes locally, names
 * never leave. The file is read into memory and dropped; it is never uploaded.
 * If that ever stops being true, every promise in ContactSyncSettings breaks
 * at once.
 *
 * Emits the exact shape pickContacts() returns — `{ number, name }`, one entry
 * per number — so neither syncContacts nor any caller can tell the two apart.
 */

/**
 * ⚠ UNFOLD BEFORE ANYTHING ELSE.
 *
 * RFC 6350 lets a long value continue on the next line, marked by a leading
 * space or tab. Real exports use it constantly — a long name or a TEL with
 * formatting routinely wraps at 75 octets. Parse line-by-line without
 * unfolding first and those values silently truncate at the fold, which for a
 * phone number means a WRONG number that still looks plausible.
 */
function unfold(text) {
  // \r\n first so a CRLF fold does not leave a stray \r at the join.
  return text.replace(/\r\n[ \t]/g, '').replace(/[\r\n][ \t]/g, '');
}

/**
 * vCard 2.1 — which is what a great many Android and Outlook exports still
 * are — may quoted-printable-encode any value, and does so whenever a name
 * contains a non-ASCII character. Left undecoded, "Zoë" arrives as "Zo=C3=AB".
 * Numbers are ASCII and unaffected; names are not, and a mangled name is what
 * the user sees in "saved as …".
 */
function decodeQuotedPrintable(value) {
  // A trailing '=' is QP's own soft line break; the unfolder above does not
  // see these because they are not RFC 6350 folds.
  const soft = value.replace(/=\r?\n/g, '');

  // ⚠ QP ENCODES BYTES, NOT CHARACTERS — DECODE THE SEQUENCE, NOT EACH ESCAPE.
  // Turning each `=XX` straight into String.fromCharCode gives one character
  // per BYTE, so the two-byte UTF-8 for "ë" (=C3=AB) came out as "Ã«". Every
  // accented name was quietly mangled, and only in the "saved as …" line where
  // it is least likely to be noticed and most likely to matter. The bytes must
  // be gathered first and decoded as UTF-8 together.
  const bytes = [];
  for (let i = 0; i < soft.length; i++) {
    const hex = soft[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(soft.slice(i + 1, i + 3))
      ? soft.slice(i + 1, i + 3)
      : null;
    if (hex) { bytes.push(parseInt(hex, 16)); i += 2; continue; }
    // Unencoded positions are ASCII by definition of the encoding; anything
    // else already arrived decoded and is passed through as its own bytes.
    const code = soft.charCodeAt(i);
    if (code < 128) bytes.push(code);
    else for (const b of new TextEncoder().encode(soft[i])) bytes.push(b);
  }

  try {
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  } catch {
    return soft;
  }
}

/**
 * Split "TEL;TYPE=CELL;ENCODING=QUOTED-PRINTABLE" into its property name and
 * parameters. Handles the `item1.TEL` grouping prefix Apple emits.
 */
function parseName(rawName) {
  const parts = rawName.split(';');
  // A group prefix ("item1.TEL") is meaningful to the vCard grammar and
  // meaningless to us — the property after the dot is what matters.
  const name = parts[0].includes('.')
    ? parts[0].slice(parts[0].indexOf('.') + 1)
    : parts[0];
  return { name: name.toUpperCase(), params: parts.slice(1).join(';').toUpperCase() };
}

/**
 * The display name for a card. FN is the preformatted one and is preferred;
 * N is the structured fallback (Family;Given;Middle;Prefix;Suffix), reassembled
 * as "Given Family" because that is how a person is addressed.
 */
function displayName(fn, n) {
  if (fn) return fn;
  if (!n) return null;
  const [family = '', given = ''] = n.split(';');
  const joined = `${given} ${family}`.trim();
  return joined || null;
}

/**
 * Parse vCard text into contacts.
 *
 * Deliberately lenient. These files come from a dozen different exporters at
 * three different spec versions, and the cost of rejecting a malformed card is
 * a contact the user silently never matches with. Anything unparseable is
 * skipped; anything with at least one number is kept.
 *
 * @param {string} text raw .vcf contents
 * @returns {Array<{number: string, name: string|null}>} one entry per number
 */
export function parseVCard(text) {
  if (typeof text !== 'string' || !text) return [];

  const out = [];
  let fn = null;
  let n = null;
  let tels = [];

  const flush = () => {
    const name = displayName(fn, n);
    // One person can have several numbers and any of them might be the one a
    // friend saved — upload all, same as the picker path does.
    for (const tel of tels) out.push({ number: tel, name });
    fn = null; n = null; tels = [];
  };

  for (const line of unfold(text).split(/\r\n|\r|\n/)) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;

    const { name: prop, params } = parseName(line.slice(0, colon));
    let value = line.slice(colon + 1);
    if (params.includes('QUOTED-PRINTABLE')) value = decodeQuotedPrintable(value);
    value = value.trim();

    if (prop === 'BEGIN' && value.toUpperCase() === 'VCARD') {
      // Reset rather than flush: a BEGIN inside an unterminated card means the
      // previous one was malformed, and its fields must not bleed into this.
      fn = null; n = null; tels = [];
    } else if (prop === 'END' && value.toUpperCase() === 'VCARD') {
      flush();
    } else if (prop === 'FN') {
      fn = value || null;
    } else if (prop === 'N') {
      n = value || null;
    } else if (prop === 'TEL' && value) {
      tels.push(value);
    }
  }

  // A file whose last card is missing its END is still worth keeping.
  flush();

  return out;
}

/**
 * Read a File/Blob and parse it.
 *
 * @param {File|Blob} file
 * @returns {Promise<Array<{number: string, name: string|null}>>}
 */
export async function parseVCardFile(file) {
  if (!file) return [];
  try {
    return parseVCard(await file.text());
  } catch {
    // An unreadable file is a user-facing "that didn't work", not a crash.
    return [];
  }
}
