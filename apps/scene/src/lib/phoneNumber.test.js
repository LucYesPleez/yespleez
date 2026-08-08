import test from 'node:test';
import assert from 'node:assert/strict';

import {
  E164_RE,
  COUNTRIES,
  toE164,
  isoForE164,
  isValidE164,
  formatDisplay,
  maskE164,
  looksLikeNumber,
} from './phoneNumber.js';

/**
 * The contract these tests defend is "the same human normalises to the same
 * string on every device". A failure here does not look like a crash — it looks
 * like two friends who both have each other's number never matching, with
 * nothing in any log to say why. That is why the odd cases (invisible spaces,
 * Italian zeros, +1 vs +353) get as much attention as the happy path.
 */

test('AU mobile: the ordinary case, however it is typed', () => {
  const expected = '+61412345678';
  for (const input of [
    '0412 345 678',
    '0412345678',
    '(04) 1234 5678',
    '04-12-34-56-78',
    '+61 412 345 678',
    '+61412345678',
    '0061412345678',
  ]) {
    assert.equal(toE164(input, 'AU').e164, expected, `failed on ${JSON.stringify(input)}`);
  }
});

test('invisible characters from contact cards do not break matching', () => {
  // NBSP and narrow NBSP arrive from iOS contact cards; the Unicode minus from
  // some Android dialers. All three are invisible on screen, so a number that
  // looks identical would otherwise hash differently and never match.
  assert.equal(toE164('0412 345 678', 'AU').e164, '+61412345678');
  assert.equal(toE164('0412 345 678', 'AU').e164, '+61412345678');
  assert.equal(toE164('0412−345−678', 'AU').e164, '+61412345678');
});

test('a number carrying its own country ignores the picker', () => {
  // Pasting a friend's NZ number while the chip says Australia must not produce
  // an Australian number. The reported iso is what moves the chip (§4).
  const r = toE164('+64 21 555 0199', 'AU');
  assert.equal(r.e164, '+64215550199');
  assert.equal(r.iso, 'NZ');
});

test('00 is treated as +, before trunk-stripping can eat it', () => {
  const r = toE164('0064 21 555 0199', 'AU');
  assert.equal(r.e164, '+64215550199');
  assert.equal(r.iso, 'NZ');
});

test('Italy keeps its leading zero — stripping it makes the number unreachable', () => {
  // The single most likely normalisation bug, and it is silent: +3902… is a
  // real Milan landline, +392… is not a number at all.
  assert.equal(toE164('02 1234 5678', 'IT').e164, '+390212345678');
});

test('trunk prefix is dropped where it exists', () => {
  assert.equal(toE164('020 7946 0958', 'GB').e164, '+442079460958');
  assert.equal(toE164('021 555 0199', 'NZ').e164, '+64215550199');
});

test('isoForE164 resolves the real list correctly', () => {
  assert.equal(isoForE164('+353871234567'), 'IE');
  assert.equal(isoForE164('+14155550123'), 'US');
  assert.equal(isoForE164('+61412345678'), 'AU');
});

test('isoForE164 prefers the LONGEST dial code when codes collide', () => {
  // Deliberately tested against an injected list, not COUNTRIES. No two real
  // entries collide today, so this assertion over the live list passes with the
  // sort deleted — mutation-testing caught exactly that. A NANP addition such
  // as +1242 makes the sort load-bearing, and this is the test that will fail
  // if someone "simplifies" it away first.
  const colliding = [
    { iso: 'US', name: 'United States', dial: '1',    trunk: '1' },
    { iso: 'BS', name: 'Bahamas',       dial: '1242', trunk: '1' },
  ];
  assert.equal(isoForE164('+12425550123', colliding), 'BS');
  assert.equal(isoForE164('+14155550123', colliding), 'US');

  // Order-independent: reversing the input must not change the answer.
  const reversed = [...colliding].reverse();
  assert.equal(isoForE164('+12425550123', reversed), 'BS');
  assert.equal(isoForE164('+14155550123', reversed), 'US');
});

test('a valid number outside our picker is still valid, just unlabelled', () => {
  // Iceland is not in COUNTRIES. It must hash fine and simply have no chip —
  // treating null iso as "invalid" would lock out most of the world.
  const e164 = '+3545811234';
  assert.equal(isValidE164(e164), true);
  assert.equal(isoForE164(e164), null);
  assert.equal(toE164(e164, 'AU').e164, e164);
});

test('rejects what cannot be a number, with a reason', () => {
  assert.equal(toE164('', 'AU').reason, 'empty');
  assert.equal(toE164('   ', 'AU').reason, 'empty');
  assert.equal(toE164(null, 'AU').reason, 'empty');
  assert.equal(toE164('not a number', 'AU').reason, 'not-a-number');
  assert.equal(toE164('+61 41A 345 678', 'AU').reason, 'not-a-number');
  assert.equal(toE164('+123456', 'AU').reason, 'too-short');
  assert.equal(toE164('+1234567890123456', 'AU').reason, 'too-long');
  assert.equal(toE164('0412345678', 'ZZ').reason, 'unknown-country');
  for (const bad of ['', '   ', null, 'not a number', '+123456']) {
    assert.equal(toE164(bad, 'AU').e164, null);
  }
});

test('E164_RE matches the server regex exactly', () => {
  // If this drifts, the client hashes numbers Postgres refuses and the failure
  // surfaces as a generic invalid_parameter_value far from the cause.
  assert.equal(E164_RE.source, '^\\+[1-9][0-9]{6,14}$');
  assert.equal(isValidE164('+0123456789'), false, 'country code cannot start with 0');
  assert.equal(isValidE164('+1234567'), true, '7 digits is the documented minimum');
  assert.equal(isValidE164('+123456789012345'), true, '15 digits is the documented maximum');
  assert.equal(isValidE164('+1234567890123456'), false, '16 digits is over E.164');
});

test('normalisation is idempotent', () => {
  // Re-normalising a stored value must not change it, or a number would drift
  // every time it passed through a form.
  const once = toE164('0412 345 678', 'AU').e164;
  assert.equal(toE164(once, 'AU').e164, once);
  assert.equal(toE164(toE164(once, 'AU').e164, 'AU').e164, once);
});

test('every country in the picker round-trips its own dial code', () => {
  // Guards against a typo in COUNTRIES — a wrong dial code would silently
  // produce valid-looking numbers that match nobody.
  for (const c of COUNTRIES) {
    const iso = isoForE164(`+${c.dial}412345678`);
    assert.ok(iso, `no iso resolved for dial +${c.dial} (${c.name})`);
    const resolved = COUNTRIES.find((x) => x.iso === iso);
    assert.equal(resolved.dial, c.dial, `${c.name} resolved to a different dial code`);
  }
});

test('ENTRY IS FORGIVING: every way of writing one number converges', () => {
  // The owner's list, verbatim. All of these are the same human, and if any
  // one of them hashes differently that person is undiscoverable to whoever
  // typed it the other way — silently, with no error anywhere.
  for (const input of [
    '0474755829',
    '474755829',
    '+61474755829',
    '61 474 755 829',
    '+61 474 755 829',
    '04 7475 5829',
    '0474-755-829',
    '(0474) 755 829',
    '0061474755829',
  ]) {
    assert.equal(
      toE164(input, 'AU').e164,
      '+61474755829',
      `${JSON.stringify(input)} did not converge`,
    );
  }
});

test('THE REGRESSION: display and normalisation cannot disagree', () => {
  // What shipped: a display helper took RAW INPUT, stripped the '+', and the
  // composer wrote its output back into the field — so the tidied string was
  // what got hashed. +61412345678 became +6161412345678: a number that cannot
  // exist, saved without error, showed the correct last three digits, and was
  // undiscoverable forever.
  //
  // formatDisplay now takes E.164 ONLY, so round-tripping is the property to
  // hold: normalise → display → normalise must be a fixed point for every
  // input style, or the field can drift away from what was stored.
  for (const input of [
    '0474755829', '474755829', '+61474755829', '61 474 755 829',
    '04 7475 5829', '0474-755-829', '(0474) 755 829',
  ]) {
    const first = toE164(input, 'AU').e164;
    const shown = formatDisplay(first);
    const again = toE164(shown, 'AU').e164;
    assert.equal(again, first, `round trip drifted for ${JSON.stringify(input)}: ${shown}`);
  }
});

test('⚠ a localised display is only safe when read against ITS OWN country', () => {
  // Documenting a trap rather than a capability, because getting this wrong
  // silently searches for a DIFFERENT PERSON.
  //
  // formatDisplay writes the LOCAL form: +64215550199 becomes "021 555 0199".
  // Read back against Australia that is +61215550199 — a real, valid,
  // completely unrelated number. No error, no warning, just the wrong human.
  const e164 = toE164('+64 21 555 0199', 'AU').e164;
  assert.equal(e164, '+64215550199');
  assert.equal(toE164('+64 21 555 0199', 'AU').iso, 'NZ', 'the country must be reported');

  const shown = formatDisplay(e164);

  // The trap, asserted so it cannot be "fixed" into silence:
  assert.equal(toE164(shown, 'AU').e164, '+61215550199',
    'if this ever stops being true, re-check the component blur handler');

  // And the contract the app actually relies on: the picker follows the
  // number, so the display is always re-read against its own country.
  assert.equal(toE164(shown, 'NZ').e164, '+64215550199');
});

test('display is localised per region', () => {
  assert.equal(formatDisplay('+61474755829'),  '0474 755 829',   'AU mobile');
  assert.equal(formatDisplay('+61298765432'),  '(02) 9876 5432', 'AU landline');
  assert.equal(formatDisplay('+14155551234'),  '(415) 555-1234', 'US');
  assert.equal(formatDisplay('+447911123456'), '07911 123456',   'UK mobile');
  assert.equal(formatDisplay('+442079460958'), '020 7946 0958',  'UK landline');
  assert.equal(formatDisplay('+64215550199'),  '021 555 0199',   'NZ');
});

test('display refuses anything that is not canonical E.164', () => {
  // The guard that keeps this one-directional. If it ever accepts raw input
  // again, the shipped defect becomes possible again.
  for (const bad of ['0474755829', '0474 755 829', '', null, 'rubbish', '+61']) {
    assert.equal(formatDisplay(bad), '', `formatDisplay accepted ${JSON.stringify(bad)}`);
  }
});

test('a valid number outside the picker displays canonically, never guessed', () => {
  // Iceland is not in COUNTRIES. Showing it as "+3545811234" is honest;
  // inventing a local grouping for a country we know nothing about is not.
  assert.equal(formatDisplay('+3545811234'), '+3545811234');
});

test('the mask never renders a number it was not given', () => {
  assert.equal(maskE164('+61412345678'), '••• ••• 678');
  assert.equal(maskE164('rubbish'), '', 'never render a mask for a non-number');
  assert.equal(maskE164(''), '');
});

// ── ROUTING ONE SEARCH BOX TO TWO SEARCHES ───────────────────────────────
// looksLikeNumber decides whether "search people" filters your contacts by
// name or runs an exact number lookup. It tests INTENT, not validity — see
// the function's own comment for why that distinction is load-bearing.

test('a partial number still routes to number search', () => {
  // The case that makes validity the wrong test: someone typing a number
  // passes through every prefix of it. If these filtered the contact list
  // instead, the user would watch it sit empty and assume it was broken.
  for (const partial of ['0412', '0412 345', '+61', '+614127']) {
    assert.equal(looksLikeNumber(partial), true, partial);
  }
});

test('numbers written the way people actually write them are recognised', () => {
  for (const n of ['0412 345 678', '(02) 9999 0000', '+61 412-345-678', '02.9999.0000']) {
    assert.equal(looksLikeNumber(n), true, n);
  }
});

test('⚠ a name never routes to number search, whatever digits it holds', () => {
  // The asymmetry that matters: guessing "name" wrongly only filters a list,
  // but guessing "number" wrongly HIDES the contact being searched for.
  for (const name of ['Sarah', 'Blink 182', 'DJ 500', 'Federal Hotel', 'a']) {
    assert.equal(looksLikeNumber(name), false, name);
  }
});

test('too few digits is not yet an attempt at a number', () => {
  for (const q of ['1', '12', '', '   ', '()']) {
    assert.equal(looksLikeNumber(q), false, JSON.stringify(q));
  }
});
