/**
 * THIRTY NOTIFICATION TYPES, FIVE SOUNDS.
 *
 * ⭐ The grouping is by what the sound ASKS OF YOU, so the ear can answer
 * before the eye reaches the screen. The tests that matter here are the two
 * boundaries: every type the app can write is accounted for, and nothing gets
 * a sound by accident.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NOTIFICATION_SOUND, soundForNotification } from './notificationSound.js';

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** The app's own catalogue of notification types. */
const CATALOGUE = [...read('./notifMeta.jsx').matchAll(/^\s{2}([a-z_]+):\s*\{/gm)].map(m => m[1]);

/* ⛔ Recorded here so the test can tell a decision from an omission. */
const AMBIENT = ['new_follower', 'venue_followed', 'profile_claimed', 'artist_updated', 'generic'];
const CLASSES = ['arrive', 'ask', 'yes', 'no', 'moved'];

test('⭐ the catalogue really is thirty types (the premise of the grouping)', () => {
  assert.ok(CATALOGUE.length >= 25, `found ${CATALOGUE.length} types in notifMeta`);
  assert.ok(CATALOGUE.includes('new_message') && CATALOGUE.includes('slot_offer'));
});

test('⛔⛔ EVERY type is either mapped or deliberately ambient', () => {
  // The whole point: a type nobody classified would be silently silent.
  const unaccounted = CATALOGUE.filter(t => !NOTIFICATION_SOUND[t] && !AMBIENT.includes(t));
  assert.deepEqual(unaccounted, [], 'these types have no sound and are not listed as ambient');
});

test('⛔ and nothing is mapped that the app cannot actually write', () => {
  // A typo maps a type that never arrives: silent in both directions.
  const ghosts = Object.keys(NOTIFICATION_SOUND).filter(t => !CATALOGUE.includes(t));
  assert.deepEqual(ghosts, [], 'these keys are not in notifMeta');
});

test('⭐ only the five classes are used', () => {
  const used = [...new Set(Object.values(NOTIFICATION_SOUND))].sort();
  assert.deepEqual(used, [...CLASSES].sort());
});

test('⛔⛔ ambient stays SILENT, which is the decision, not an oversight', () => {
  for (const t of AMBIENT) {
    assert.equal(soundForNotification(t), null, `${t} must make no sound`);
    assert.ok(!(t in NOTIFICATION_SOUND), `${t} must not be mapped`);
  }
});

test('⛔ an unknown type is silent — there is no default class', () => {
  // A default would give a brand new type the sound of whatever class it fell
  // into, which is worse than silence because it teaches the wrong thing.
  assert.equal(soundForNotification('something_invented_later'), null);
  assert.equal(soundForNotification(''), null);
  assert.equal(soundForNotification(null), null);
  assert.equal(soundForNotification(undefined), null);
});

test('⭐ the classes carry the types the grouping claims', () => {
  assert.equal(soundForNotification('new_message'), 'arrive');
  assert.equal(soundForNotification('slot_offer'), 'ask');
  assert.equal(soundForNotification('booking_confirmed'), 'yes');
  assert.equal(soundForNotification('application_declined'), 'no');
  assert.equal(soundForNotification('set_times_released'), 'moved');
});

/* ── the audio side ─────────────────────────────────────────────────────── */

test('⛔ every class exists in the sound registry', () => {
  const ui = read('./uiSound.js');
  for (const c of CLASSES) {
    assert.match(ui, new RegExp(`\\n  ${c}:\\s*\\{ src: '/sfx/`), `${c} has no file`);
  }
});

test('⚠⚠ the gains are RMS-matched, and the reasoning is recorded', () => {
  const ui = read('./uiSound.js');
  // Three of these files peak at exactly 1.00 and are nowhere near equally
  // loud, so a peak-matched set would be wrong in a way nobody could see.
  assert.match(ui, /RMS-MATCHED, ⛔ NOT PEAK-MATCHED/);
  assert.match(ui, /no:\s*\{ src: '\/sfx\/notif-no\.wav',\s*gain: 0\.98 \}/,
    'notif-no sits at the clamp');
  assert.match(ui, /there is no headroom left/);
});

test('⛔⛔ a message never plays twice', () => {
  // Conversation activity already sounds via yp:message-received. The shell
  // must only sound the OTHER types, or every message doubles.
  const app = read('../App.jsx');
  assert.match(app, /if \(isConversationActivity\(row, conversationTypes\)\) fetchMessages\(\);\s*\n\s*else \{/);
  assert.match(app, /playNotificationSound\(soundForNotification\(row\?\.type\)\);/);
  // and the play helper refuses `arrive` even if a caller asks for it
  assert.match(read('./uiSound.js'), /if \(!key \|\| key === 'arrive'\) return;/);
});

test('⛔⛔ the bell still counts, in the SAME branch as the sound', () => {
  /* ⚠⚠ THIS TEST EXISTS BECAUSE THE FIRST ATTEMPT BROKE THE FILE. There was
     already an `else setUnreadCount(c => c + 1);` on the line below the `if`,
     and adding a second `else` for the sound produced two else clauses — a
     syntax error. Every source-text test passed anyway, because only the
     LINTER parses the file. The sound and the count now share one branch. */
  const app = read('../App.jsx');
  assert.match(app, /playNotificationSound\(soundForNotification\(row\?\.type\)\);\s*\n\s*setUnreadCount\(c => c \+ 1\);/,
    'the bell count must live beside the sound, not in a second else');
  assert.equal((app.match(/else setUnreadCount/g) || []).length, 0, 'no orphaned else');
});
