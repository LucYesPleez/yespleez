import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * NOTHING MAY WRITE A RETIRED APPLICATION STATUS.
 *
 * ⚠⚠ ANCHORED ON CODE, NOT ON WORDS. Every retired spelling now appears in
 * PROSE all over this codebase — the comments explaining why they were retired
 * mention `tentative`, `offered` and `confirmed` by name. A substring search
 * would match its own explanation, which has tripped source-level tests in this
 * project three times before. So comments are stripped first, and the patterns
 * match assignment syntax rather than the bare word.
 *
 * ⛔ AND IT MUST NOT MATCH `performances`. `offered` and `confirmed` are LIVE,
 * CORRECT values for the slot lifecycle (`performances.status`, and the claim
 * shape derived from it in lib/eventSlots). Only `applications` is constrained.
 */

const RETIRED = ['tentative', 'offered', 'confirmed', 'rejected'];

/** Remove block and line comments so prose cannot match. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p, out); continue; }
    if (/\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);

test('the scan actually reads a meaningful number of files', () => {
  // ⚠ A source-text test that silently scans nothing passes forever.
  assert.ok(files.length > 100, `only ${files.length} files scanned`);
});

/**
 * Every `from('<table>')` and the statement that follows it.
 *
 * ⚠⚠ SCOPED TO THE STATEMENT, NOT THE FILE. The first version of this test
 * asked "does this file mention applications?" and then scanned the whole file
 * — so `EventHostView`, which legitimately writes BOTH tables, failed on its
 * `performances` insert of `status: 'offered'`. A test that cannot tell the two
 * tables apart would have forced a correct line to be changed.
 */
function statements(code) {
  const out = [];
  const re = /from\('(\w+)'\)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    out.push({ table: m[1], body: code.slice(m.index, m.index + 400) });
  }
  return out;
}

test('⛔ no source writes a retired status into applications', () => {
  const offenders = [];
  for (const file of files) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const { table, body } of statements(code)) {
      if (table !== 'applications') continue;
      for (const bad of RETIRED) {
        if (new RegExp(`status:\\s*['"]${bad}['"]`).test(body)) {
          offenders.push(`${file.replace(SRC, '')} writes status: '${bad}'`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], 'these must use the canonical vocabulary');
});

/**
 * ⭐ THE BOOKING ENGINE MUST STILL BE ABLE TO OFFER A SLOT.
 *
 * ⚠⚠ REWRITTEN 2026-08-18 (P6.3d-1), AND THE ALARM WAS CORRECT. This asserted a
 * `performances` write of `status: 'offered'` INSIDE `EventHostView`, which was
 * `publishSetTimes`. Deleting that function made it fail, exactly as its own
 * message warned — so the capability was checked rather than the assertion
 * silenced.
 *
 * ⭐ IT MOVED, it did not vanish: `doAssign` still asks for an offer, and the one
 * writer (`lib/lineupActions.assignMemberToSlot`) performs it. ⛔ The screen no
 * longer composes a `performances` write of its own, which is the improvement.
 */
test('⭐ the booking engine can still offer a slot, through the one writer', () => {
  const screen = stripComments(readFileSync(join(SRC, 'screens/event/EventHostView.jsx'), 'utf8'));
  assert.ok(/status:\s*'offered'/.test(screen),
    'doAssign must still request an OFFER - if this fails the booking engine is gone, not fixed');

  /* ⛔ And the screen must not have grown its own performance write to do it. */
  const perfWrites = statements(screen).filter(s => s.table === 'performances');
  assert.deepEqual(perfWrites.filter(s => /status:\s*'offered'/.test(s.body)), [],
    'the screen is composing its own offered write again instead of using assignMemberToSlot');

  const writer = stripComments(readFileSync(join(SRC, 'lib/lineupActions.js'), 'utf8'));
  assert.ok(/from\('performances'\)[\s\S]{0,200}insert/.test(writer),
    'assignMemberToSlot no longer inserts the performance');
});

test('⛔ no decision handler passes a retired status to respond()', () => {
  const offenders = [];
  for (const file of files) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const bad of RETIRED) {
      // respond('tentative') / respond(app.id, 'rejected', …)
      const re = new RegExp(`respond\\((?:[^)]*,\\s*)?['"]${bad}['"]`);
      if (re.test(code)) offenders.push(`${file.replace(SRC, '')} calls respond('${bad}')`);
    }
  }
  assert.deepEqual(offenders, [], 'decision buttons must send the canonical vocabulary');
});

/**
 * ⭐ THE OTHER HALF: the slot lifecycle MUST still use them. A test that only
 * forbids words would "pass" beautifully if someone deleted the booking engine.
 */
test('performances still uses offered / accepted, which are correct there', () => {
  const notif = readFileSync(join(SRC, 'lib/notifActions.js'), 'utf8');
  const code = stripComments(notif);
  assert.match(code, /from\('performances'\)[\s\S]*?status:\s*'accepted'/, 'accepting a slot must still write the performance');
  assert.match(code, /from\('performances'\)[\s\S]*?status:\s*'declined'/, 'declining a slot must still write the performance');
  assert.match(code, /accepted_at:/, 'the acceptance stamp is the record of the artist agreeing');
});

/**
 * ⛔ THE CROSS-WRITES ARE GONE. `acceptSlotOffer` / `declineSlotOffer` must not
 * touch `applications` at all — an artist's answer is not a host decision.
 */
test('the slot accept/decline handlers do not touch applications', () => {
  const code = stripComments(readFileSync(join(SRC, 'lib/notifActions.js'), 'utf8'));
  const accept = code.slice(code.indexOf('export async function acceptSlotOffer'), code.indexOf('export async function declineSlotOffer'));
  const decline = code.slice(code.indexOf('export async function declineSlotOffer'), code.indexOf('export async function acceptInvite'));
  assert.ok(accept.length > 50 && decline.length > 50, 'failed to slice the two functions');
  assert.equal(accept.includes("from('applications')"), false, 'acceptSlotOffer must not write applications');
  assert.equal(decline.includes("from('applications')"), false, 'declineSlotOffer must not write applications');
});

/**
 * ⚠ `acceptInvite` DOES still create an application — that is its whole job.
 * It must create it in the canonical vocabulary.
 */
test('accepting an invite creates a shortlisted application', () => {
  const code = stripComments(readFileSync(join(SRC, 'lib/notifActions.js'), 'utf8'));
  const invite = code.slice(code.indexOf('export async function acceptInvite'));
  assert.match(invite, /from\('applications'\)\s*\.insert\(/, 'it still creates the application');
  assert.match(invite, /status:\s*'shortlisted'/);
});

/**
 * ── ⛔⛔ AN OFFER WHOSE SET TIME IS GONE MUST NOT ANSWER SILENTLY ─────────────
 *
 * ⚠⚠ FOUND IN A REAL INBOX. The update was issued and its result DISCARDED, so
 * once the performance had been deleted — which deleting its SLOT does, via ON
 * DELETE CASCADE — the artist tapped ACCEPT and three things lied at once: the
 * offer showed as answered, the HOST was told the artist accepted, and nothing
 * was recorded.
 *
 * ⚠ SOURCE-TEXT CHECKS, so they prove the WIRING and not the behaviour. That is
 * still the shape of the defect: the check simply was not there.
 */
test('⛔⛔ the slot answer verifies the write landed before telling the host', () => {
  const code = stripComments(readFileSync(join(SRC, 'lib/notifActions.js'), 'utf8'));
  for (const name of ['acceptSlotOffer', 'declineSlotOffer']) {
    const start = code.indexOf(`export async function ${name}`);
    const body  = code.slice(start, code.indexOf('export async function', start + 10));

    /* ⭐ The update must ask what it changed. */
    assert.match(body, /\.select\('id'\)/, `${name} discards its result again`);
    /* ⛔ An empty result is a FAILURE, not a success. RLS filters an UPDATE
       rather than erroring it, so this is the only signal. */
    assert.match(body, /!rows\?\.length/, `${name} does not treat an empty result as a failure`);
    assert.match(body, /code:\s*'gone'/, `${name} must name the gone case`);

    /* ⛔⛔ AND THE HOST IS NOT TOLD. The `gone` return must come BEFORE the host
       notification, or an acceptance that was never recorded is announced. */
    assert.ok(body.indexOf("code: 'gone'") < body.indexOf('data.host_id'),
      `${name} notifies the host before checking the write landed`);
  }
});

/**
 * ⛔ AND NEITHER SURFACE MAY MARK A FAILED ANSWER AS ANSWERED. Both used to call
 * `markResponded` unconditionally. ⛔ Change one, change both.
 */
test('⛔⛔ neither notification surface marks a failed answer as responded', () => {
  for (const file of ['components/NotifPanel.jsx', 'screens/NotificationsScreen.jsx']) {
    const src = stripComments(readFileSync(join(SRC, file), 'utf8'));
    assert.equal(/await acceptSlotOffer\([^)]*\);\s*await markResponded/.test(src), false,
      `${file} marks responded without checking the result`);
    assert.equal(/await declineSlotOffer\([^)]*\);\s*await markResponded/.test(src), false,
      `${file} marks responded without checking the result`);
    /* ⭐ The guard, and the reason it stays actionable: the artist may need to
       chase the host. */
    assert.match(src, /if \(!res\?\.ok\)/, `${file} does not inspect the answer's result`);
    assert.match(src, /answerError/, `${file} does not tell the artist why it failed`);
  }
});
