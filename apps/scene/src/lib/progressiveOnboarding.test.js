import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Both modules under test reach Supabase for their P8 row. There is no
// `import.meta.env` under node:test, so the client is stubbed exactly as
// contactSync.test.js and the rest of the suite do — the policy functions
// exercised below are pure and never touch it.
mock.module('./supabase', { exports: { supabase: {} } });

const { shouldOfferPush, PUSH_PROMPT_KEY } = await import('./pushPrompt.js');
const { TEACH } = await import('./firstUseTeach.js');

/**
 * O4 · PROGRESSIVE ONBOARDING — the three rules that make it progressive
 * rather than a wizard wearing a different hat:
 *
 *   ⭐ a permission is asked at the moment it answers something, once
 *   ⭐ a lesson is taught the first time its concept becomes true, once
 *   ⛔ neither invents a second place to remember "already asked"
 */

const src = p => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const code = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\s)\/\/[^\n]*/g, '$1');

const PROMPT   = code(src('./pushPrompt.js'));
const TEACHSRC = code(src('./firstUseTeach.js'));
const APPLY    = code(src('../screens/event/ApplyButton.jsx'));
const HEART    = code(src('../components/HeartBtn.jsx'));
const PUSHUI   = code(src('../components/PushValuePrompt.jsx'));
const CARD     = code(src('../components/DashboardProfileCard.jsx'));

// ── the permission is spent once, at a moment that earns it ─────────────────

test('⭐ offered only when it can actually be granted', () => {
  const base = { signedIn: true, supported: true, permission: 'default', suppressed: false };
  assert.equal(shouldOfferPush(base), true);
});

test('⛔ never re-offered once granted or denied — both are terminal', () => {
  const base = { signedIn: true, supported: true, suppressed: false };
  assert.equal(shouldOfferPush({ ...base, permission: 'granted' }), false,
    'already on — there is nothing to ask for');
  assert.equal(shouldOfferPush({ ...base, permission: 'denied' }), false,
    'denied cannot be undone from JS; the button would provably do nothing');
});

test('⛔ never offered to a guest, an unsupported browser, or someone already asked', () => {
  const base = { signedIn: true, supported: true, permission: 'default', suppressed: false };
  assert.equal(shouldOfferPush({ ...base, signedIn: false }), false);
  assert.equal(shouldOfferPush({ ...base, supported: false }), false);
  assert.equal(shouldOfferPush({ ...base, suppressed: true }), false);
  assert.equal(shouldOfferPush(), false, 'called with nothing, it offers nothing');
});

test('⛔ NOT asked merely because an account exists — the trigger is an ACTION', () => {
  // The only dispatcher is the application submit. If a mount effect or a
  // signup path ever announces it, this fails.
  assert.match(APPLY, /announcePushWorthIt\('application'\)/);
  assert.doesNotMatch(code(src('../screens/AuthScreen.jsx')), /announcePushWorthIt/);
  assert.doesNotMatch(code(src('../screens/StartScreen.jsx')), /announcePushWorthIt/);
});

test('⭐ the ask happens after the write landed, not on the tap', () => {
  // ⚠ Anchored on the CALL, not the bare identifier — the import sits at the
  // top of the file and matched first, reporting an ordering violation that
  // was not there.
  const trackIdx = APPLY.indexOf('track(EVENTS.APPLIED');
  const askIdx   = APPLY.indexOf("announcePushWorthIt('application')");
  assert.ok(trackIdx > 0 && askIdx > trackIdx,
    'the moment is a SUBMITTED application, so it must follow the insert and the notification');
});

test('⭐⭐ requestPermission stays inside the user gesture', () => {
  // subscribeToPush must be called directly by the button, never behind an
  // await — a broken gesture chain means the browser ignores the request and
  // the one-shot permission is spent for nothing.
  assert.match(PUSHUI, /function enable\(\)\s*\{[\s\S]{0,120}subscribeToPush\(/,
    'enable() must not be async, and subscribeToPush must be its first act');
  assert.doesNotMatch(PUSHUI, /async function enable/);
});

// ── the lesson ──────────────────────────────────────────────────────────────

test('⛔ exactly one teaching moment — the bar for adding another is high', () => {
  assert.deepEqual(Object.keys(TEACH), ['saved_event']);
  assert.match(TEACH.saved_event.text, /MY SCENE/,
    'the heart is self-evident; where the save GOES is the part that is not');
});

test('the lesson follows a landed save, never a tap or a failed write', () => {
  const saveIdx  = HEART.indexOf('await saveEvent(');
  const errIdx   = HEART.indexOf("report('save', error)");
  const teachIdx = HEART.indexOf("announceTeach('saved_event')");
  assert.ok(saveIdx > 0 && errIdx > saveIdx && teachIdx > errIdx,
    'announce must sit after the write AND after the error return');
});

test('⛔ it is not a tour — no steps, no sequence, nothing to complete', () => {
  assert.doesNotMatch(TEACHSRC, /\bstep\b|carousel|\bnext\b|progress/i);
  assert.doesNotMatch(code(src('../components/FirstUseTeach.jsx')), /\bstep\b|carousel|progress/i);
});

// ── one memory, not three ───────────────────────────────────────────────────

test('⛔ NO SECOND PREFERENCES SYSTEM — both remember in P8', () => {
  for (const [name, s] of [['pushPrompt', PROMPT], ['firstUseTeach', TEACHSRC]]) {
    assert.match(s, /user_prompt_preferences/, `${name} must use P8`);
    assert.doesNotMatch(s, /localStorage|sessionStorage/,
      `${name} must not keep its own copy — P8 is keyed by USER so it follows the person across devices`);
  }
  assert.equal(PUSH_PROMPT_KEY, 'push_value_prompt');
  assert.equal(TEACH.saved_event.key, 'teach_saved_event');
  assert.notEqual(PUSH_PROMPT_KEY, TEACH.saved_event.key, 'two prompts, two keys');
});

test('⚠ a failed read errs toward asking, per P8\'s own rule', () => {
  for (const s of [PROMPT, TEACHSRC]) {
    assert.match(s, /if \(error\) return false;/,
      'an unreadable preference must SHOW the prompt — the recoverable direction');
  }
});

// ── the completion nudge ────────────────────────────────────────────────────

test('⭐ the nudge names ONE item and never becomes a checklist', () => {
  assert.match(CARD, /nextStep/);
  assert.match(CARD, /Add your \{nextStep\.label\}/);
  // A map over items would be a checklist — the profile form is one tap away
  // and dumping it here is what this replaces.
  assert.doesNotMatch(CARD, /nextStep\.map|items\.map/);
});

test('⛔ the nudge is not dismissible — it disappears by being DONE', () => {
  const from = CARD.indexOf('nextStep && setupRoute');
  const block = CARD.slice(from, from + 900);
  assert.ok(from > 0);
  assert.doesNotMatch(block, /dismiss|Not now|hide|✕/i,
    'the attention-dashboard rule: an item you can dismiss is one you can lose');
});
