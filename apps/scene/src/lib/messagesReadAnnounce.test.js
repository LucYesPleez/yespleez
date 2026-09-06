/**
 * READING A CONVERSATION TELLS THE NAV BADGE, FROM EVERY PATH.
 *
 * ⛔⛔ THE BUG. `ConversationView` advances the read watermark in FOUR places
 * and only ONE of them dispatched `yp:messages-read`. The three silent ones
 * were the everyday cases: a message arriving while you are at the bottom of
 * an open thread, jump-to-latest, and the scroll handler. So the inbox row
 * correctly dropped to zero while the nav badge kept its count.
 *
 * Owner, 2026-09-06: "it showed a 1 icon on the taskbar icon down the bottom of
 * my screen ... but it didnt show here. i clicked on the message i had a
 * feeling it came from and it did."
 *
 * ⭐⭐ THE FIX IS ONE WRITER, not a fourth copy of the dispatch — the same
 * lesson DEF-4 records, where the read-marking rule lived in two components and
 * every new exclusion had to be remembered in both.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const stripComments = src => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const MESSAGING = read('./messaging.js');
const VIEW      = read('../components/ConversationView.jsx');
const APP       = read('../App.jsx');

test('⭐⭐ the announcement lives in markConversationRead, the single writer', () => {
  const fn = MESSAGING.slice(MESSAGING.indexOf('export async function markConversationRead'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.match(body, /rpc\('mark_conversation_read'/, 'it is the function that writes');
  assert.match(body, /dispatchEvent\(new CustomEvent\('yp:messages-read'/, 'and the one that announces');
});

test('⛔ no call site announces it any more', () => {
  // ⚠ comments stripped: the pointer left behind names the event on purpose.
  assert.ok(!/yp:messages-read/.test(stripComments(VIEW)),
    'ConversationView must not dispatch it');
});

test('⛔⛔ every read-marking path is now covered, not just one', () => {
  const code = stripComments(VIEW);
  const calls = (code.match(/markConversationRead\(/g) || []).length;
  assert.ok(calls >= 4, `expected the four read paths, found ${calls}`);
  // Before the fix exactly one of those four sat beside a dispatch. Now none
  // do, because the writer handles it — so the count of dispatches is 0 and
  // the count of call sites is unchanged.
  assert.equal((code.match(/dispatchEvent\(new CustomEvent\('yp:messages-read'/g) || []).length, 0);
});

test('⚠ it announces ONLY on success', () => {
  const fn = MESSAGING.slice(MESSAGING.indexOf('export async function markConversationRead'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.match(body, /if \(!error && typeof window !== 'undefined'\)/,
    'a failed RPC moved no watermark and must not drop the badge');
});

test('⭐ and the shell still listens for it', () => {
  // The other half: if App stopped listening, the writer would announce to
  // nobody and this whole fix would be inert.
  assert.match(APP, /addEventListener\('yp:messages-read', onRead\)/);
  assert.match(APP, /const onRead = \(\) => fetchMessages\(\);/);
});

/* ⚠ A "guarded for a non-browser caller" test was written here and REMOVED: the
   assertion above already pins `!error && typeof window !== 'undefined'` as one
   string, so a second test proved nothing and only added a fixed-size slice that
   broke the moment the comment above the guard grew. */

/* ── ARRIVING IS NOT READING ──────────────────────────────────────────────
   Owner, 2026-09-06: "i hadnt read it yet. i couldnt tell by looking at this
   screen which message thread sent the message unless i looked at the tabs
   with the gradient. if i get multiple messages at once i want them to load on
   the main messages screen highlighted and with a number."

   A minimised thread stays MOUNTED — the dock's design, so that minimise does
   not mean discard — and it is still scrolled to its bottom. So `atBottomRef`
   alone was true for threads nobody was looking at, and every arriving message
   was marked read on arrival. */

const INBOX = read('../screens/InboxScreen.jsx');

test('⛔⛔ a message is read only when the reader is actually looking', () => {
  const code = stripComments(VIEW);
  assert.match(code, /const reallyLooking = atBottomRef\.current/, 'scrolled to the bottom');
  assert.match(code, /&& onScreenRef\.current/, 'AND this thread is the open one');
  assert.match(code, /document\.visibilityState === 'visible'/, 'AND the app is in front');
  assert.match(code, /if \(reallyLooking\) \{/);
  // ⛔ the old single-condition form must not come back
  assert.ok(!/if \(atBottomRef\.current\) \{\s*\n\s*\/\/ Reading at the bottom/.test(VIEW),
    'the bare atBottom test is gone');
});

test('⚠ on-screen is tracked by a REF, never a subscription dependency', () => {
  // The component's own header records why: an effect that depends on the
  // context value and also calls patch() restarts itself forever.
  const code = stripComments(VIEW);
  assert.match(code, /const onScreenRef = useRef\(false\);/);
  assert.match(code, /onScreenRef\.current = openId === conversationId;/);
});

test('⭐ the inbox row already had the highlight and the NUMBER', () => {
  // Nothing needed adding here — the row was blank only because `unread` was
  // zeroed by the arrival path above.
  assert.match(INBOX, /background: c\.unread > 0 \?/, 'highlighted background');
  assert.match(INBOX, /boxShadow: c\.unread > 0 \?/, 'glow');
  assert.match(INBOX, /fontWeight: c\.unread > 0 \? 700 : 500/, 'bold name');
  assert.match(INBOX, /\{c\.unread > 0 && \(/, 'the count badge is gated on it');
  assert.match(INBOX, /aria-label=\{`\$\{c\.unread\} unread`\}/, 'and announced');
});

test('⭐ a thread the reader IS looking at still clears, so nothing sticks', () => {
  // The control on the fix: if reading stopped clearing, every conversation
  // would accumulate a badge that could never be dismissed.
  const code = stripComments(VIEW);
  assert.match(code, /if \(reallyLooking\) \{[\s\S]{0,160}markConversationRead\(conversationId\);/);
  assert.match(stripComments(INBOX), /\{ \.\.\.c, unread: 0 \}/, 'and opening one clears its row');
});
