/**
 * RESTRICTED ROLE CARDS — visibility contract.
 *
 * The failure that matters is not "the filter is wrong". It is "one of the two
 * surfaces forgot to apply it": ROLES is a module-level array exported from
 * RoleSelectorScreen and read by IndustryPanel as well, so a restricted card
 * added for one screen appears on the other for free unless both filter. The
 * last test asserts that neither consumer iterates the raw array.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { visibleRoles } from './roleVisibility.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

const OPEN       = { id: 'venue' };
const RESTRICTED = { id: 'festival', restrictedToEmail: 'lucious.aus@gmail.com' };
const ROLES      = [OPEN, RESTRICTED];

const sessionFor = email => ({ user: { email } });

test('an unrestricted role is visible to everyone, signed in or not', () => {
  assert.deepEqual(visibleRoles(ROLES, null), [OPEN]);
  assert.deepEqual(visibleRoles(ROLES, sessionFor('someone@else.com')), [OPEN]);
});

test('a restricted role is hidden from a guest', () => {
  // The interesting case: BOTH sides empty. An implementation that only
  // compared strings would match '' against a missing restrictedToEmail and
  // show the card to every signed-out visitor.
  assert.deepEqual(visibleRoles(ROLES, null), [OPEN]);
  assert.deepEqual(visibleRoles(ROLES, {}), [OPEN]);
  assert.deepEqual(visibleRoles(ROLES, sessionFor(undefined)), [OPEN]);
  assert.deepEqual(visibleRoles(ROLES, sessionFor('')), [OPEN]);
});

test('a restricted role is hidden from a different account', () => {
  assert.deepEqual(visibleRoles(ROLES, sessionFor('lucious.aus@gmail.com.evil.com')), [OPEN]);
  assert.deepEqual(visibleRoles(ROLES, sessionFor('lucious.aus@gmail.co')), [OPEN]);
  assert.deepEqual(visibleRoles(ROLES, sessionFor('aus@gmail.com')), [OPEN]);
});

test('a restricted role is visible to the named account', () => {
  assert.deepEqual(visibleRoles(ROLES, sessionFor('lucious.aus@gmail.com')), ROLES);
});

test('the match tolerates the casing and padding a provider may return', () => {
  // Supabase preserves whatever case the user typed at sign-up, so a literal
  // === would hide the card from the very account it exists for.
  assert.deepEqual(visibleRoles(ROLES, sessionFor('Lucious.Aus@Gmail.com')), ROLES);
  assert.deepEqual(visibleRoles(ROLES, sessionFor('  lucious.aus@gmail.com  ')), ROLES);
});

test('order is preserved — this list is the canonical role ordering', () => {
  const many = [{ id: 'a' }, RESTRICTED, { id: 'b' }];
  assert.deepEqual(
    visibleRoles(many, sessionFor('lucious.aus@gmail.com')).map(r => r.id),
    ['a', 'festival', 'b']);
  assert.deepEqual(visibleRoles(many, null).map(r => r.id), ['a', 'b']);
});

test('both surfaces filter — neither renders the raw ROLES array', () => {
  const consumers = [
    join('screens', 'RoleSelectorScreen.jsx'),
    join('components', 'IndustryPanel.jsx'),
  ];
  for (const rel of consumers) {
    const source = readFileSync(join(SRC, rel), 'utf8');
    assert.match(source, /visibleRoles\(\s*ROLES\s*,/,
      `${rel} reads ROLES without passing it through visibleRoles(), so every ` +
      'restricted card is visible to every account on that surface.');
    assert.doesNotMatch(source, /\bROLES\.(map|filter)\(/,
      `${rel} iterates ROLES directly. Filter with visibleRoles(ROLES, session) ` +
      'first, or a restricted role leaks on this surface only — which is exactly ' +
      'the kind of gap that survives, because the other surface still looks right.');
  }
});
