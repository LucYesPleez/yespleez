import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * P8 — CONTRACT TESTS FOR THE PRE-SEND CHECK.
 *
 * The one invariant worth protecting here is the ORDER: the requirements gate
 * runs before the confirmation can open. Get it backwards and "don't ask me
 * again" quietly becomes "don't apply the venue's rules to me" — a dismissible
 * thing and an enforced thing must never be the same thing.
 */

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const PROFILE = read('../screens/ProfileScreen.jsx');
const SHEET   = read('../components/PreSendCheckSheet.jsx');
const PREFS   = read('./promptPreferences.js');
const APPLY   = read('../screens/event/ApplyButton.jsx');
const INVITE  = read('../components/InviteSheet.jsx');

// ── The order: gate, THEN confirmation ──────────────────────────────────

test('the send button opens the check rather than writing directly', () => {
  assert.match(PROFILE, /onClick=\{requestSendEnquiry\}/);
});

test('the requirements gate runs BEFORE the dialog can open', () => {
  const fn = PROFILE.slice(PROFILE.indexOf('async function requestSendEnquiry'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  const gateAt   = body.indexOf('canSendEnquiry');
  const promptAt = body.indexOf('shouldShowPrompt');
  assert.ok(gateAt >= 0, 'the gate is not checked before sending at all');
  assert.ok(promptAt >= 0, 'the prompt is never consulted');
  assert.ok(gateAt < promptAt,
    'the confirmation is consulted before the requirements gate — dismissing a prompt would dismiss a rule');
});

test('the write path keeps its own independent gate', () => {
  const fn = PROFILE.slice(PROFILE.indexOf('async function sendEnquiry'));
  assert.match(fn.slice(0, 1200), /if \(!canSendEnquiry\(/,
    'sendEnquiry trusts its caller — a disabled button is a suggestion, not a rule');
});

// ── The preference is UI only ───────────────────────────────────────────

test('the preference never appears near the requirements gate or the snapshot', () => {
  const gate = read('./enquiryRequirements.js');
  assert.doesNotMatch(gate, /shouldShowPrompt|suppressPrompt|user_prompt_preferences/,
    'the gate has learned about a dismissible preference');
});

test('reads fail toward SHOWING the prompt', () => {
  // A dropped connection must not silently skip a confirmation.
  assert.match(PREFS, /if \(error\) return true;/);
  assert.match(PREFS, /catch \{\s*return true;\s*\}/);
});

test('the preference write cannot cost someone their enquiry', () => {
  const fn = PROFILE.slice(PROFILE.indexOf('async function sendEnquiryAndSuppress'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /await suppressPrompt\([^)]*\);\s*\n\s*sendEnquiry\(\);/,
    'the send is conditional on the preference write succeeding');
});

// ── The dialog itself ───────────────────────────────────────────────────

test('all three ways out exist', () => {
  assert.match(SHEET, /IT'S OK, SEND/);
  assert.match(SHEET, /DON'T ASK ME THIS AGAIN/);
  assert.match(SHEET, /onCancel/);
});

test('both send actions are distinct handlers, so one cannot silently do both', () => {
  assert.match(SHEET, /onSend\b/);
  assert.match(SHEET, /onSendAndSuppress\b/);
  assert.match(PROFILE, /onSend=\{sendEnquiry\}/);
  assert.match(PROFILE, /onSendAndSuppress=\{sendEnquiryAndSuppress\}/);
});

/**
 * Same consumer-identity rule as the requirements components: the dialog must
 * not branch on "am I confirming an enquiry or an application".
 *
 * ⚠ Asserted against CODE ONLY. The docblock necessarily says the words
 * "enquiry" and "application" to explain the rule, and an earlier version of
 * this test failed on its own documentation — so comments are stripped first.
 */
test('the dialog does not know who it is confirming for', () => {
  const code = SHEET
    .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments, incl. the JSX ones
    .replace(/^\s*\/\/.*$/gm, '');         // line comments
  assert.doesNotMatch(code, /\bvenue\b|\benquir/i,
    'the confirmation names a specific consumer in its code');
  assert.doesNotMatch(code, /\bmode\b|isEnquiry|isApplication|context\s*===/,
    'the confirmation branches on who is calling it');
});

test('cancelling keeps the note and the chosen act', () => {
  // "Let me fix something" has to leave the something intact.
  assert.match(PROFILE, /onCancel=\{\(\) => setPreSendOpen\(false\)\}/);
});

// ── Nothing else changed ────────────────────────────────────────────────

test('the apply flow and the invitation flow are untouched by P8', () => {
  for (const [name, src] of [['ApplyButton', APPLY], ['InviteSheet', INVITE]]) {
    assert.doesNotMatch(src, /PreSendCheckSheet|shouldShowPrompt|suppressPrompt/,
      `${name} has adopted the pre-send check; that was explicitly out of scope`);
  }
});
