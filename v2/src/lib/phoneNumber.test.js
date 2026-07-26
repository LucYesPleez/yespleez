import test from 'node:test';
import assert from 'node:assert/strict';

import {
  E164_RE,
  COUNTRIES,
  toE164,
  isoForE164,
  isValidE164,
  formatNational,
  maskE164,
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

test('THE REGRESSION: formatting must never change what a number MEANS', () => {
  // This shipped and broke discovery for two real accounts. formatNational
  // stripped the '+', the composer wrote that back into the field, and toE164
  // then read an international number as national and prepended the country
  // code a second time: +61412345678 became +6161412345678. It saved without
  // error, showed the correct last three digits, and was undiscoverable.
  //
  // The pipeline is what must be tested — format THEN normalise — because
  // either function alone looks perfectly correct.
  const pipeline = (typed, iso = 'AU') => toE164(formatNational(typed, iso), iso).e164;

  for (const input of [
    '0412345678',
    '0412 345 678',
    '+61412345678',
    '+61 412 345 678',
    '0061412345678',
    '61412345678',       // country code typed without the '+'
  ]) {
    assert.equal(pipeline(input), '+61412345678', `pipeline changed the meaning of ${JSON.stringify(input)}`);
  }
});

test('formatting is a FIXED POINT — re-formatting cannot drift', () => {
  // onChange re-formats the already formatted value on every keystroke, so
  // formatNational is applied to its own output dozens of times per number.
  // Anything not idempotent corrupts the value as the user types.
  for (const input of ['0412345678', '+61412345678', '+64215550199']) {
    let field = '';
    for (const ch of input) field = formatNational(field + ch, 'AU');
    assert.equal(
      toE164(field, 'AU').e164,
      toE164(input, 'AU').e164,
      `typing ${JSON.stringify(input)} one character at a time produced a different number`,
    );
    assert.equal(formatNational(field, 'AU'), field, 'formatNational is not idempotent');
  }
});

test('a foreign number keeps its own country through formatting', () => {
  // The '+' surviving is what stops an NZ number becoming an Australian one.
  const field = formatNational('+64 21 555 0199', 'AU');
  assert.ok(field.startsWith('+'), 'the + was stripped');
  const r = toE164(field, 'AU');
  assert.equal(r.e164, '+64215550199');
  assert.equal(r.iso, 'NZ');
});

test('display helpers never alter what gets hashed', () => {
  assert.equal(formatNational('0412345678', 'AU'), '0412 345 678');
  assert.equal(formatNational('', 'AU'), '');
  assert.equal(maskE164('+61412345678'), '••• ••• 678');
  assert.equal(maskE164('rubbish'), '', 'never render a mask for a non-number');
  // The formatter is cosmetic: its output must still normalise to the original.
  const e164 = '+61412345678';
  assert.equal(toE164(formatNational('0412345678', 'AU'), 'AU').e164, e164);
});
