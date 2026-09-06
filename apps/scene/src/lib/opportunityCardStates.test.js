/**
 * AN OFFER THE ARTIST COULD SEE AND NOT ANSWER.
 *
 * ⛔⛔ THE BUG. `OpportunityCard` gated its whole action row on
 * `isUndecided || CONSIDERED.includes(status)`, where CONSIDERED was the raw
 * list `['shortlisted','interested','tentative']`. `normaliseStatus` maps
 * `offered` — the spelling the host's slot-offer flow writes — to the
 * `shortlisted` bucket, so an offered row was in NEITHER set. No DECLINE, no
 * VIEW OFFER, no way to act on a real offer from the card it appears on.
 *
 * ⚠ `'interested'` is in that list and is NOT a raw status: it is an OUTGOING
 * BUCKET name, present in enquiryUtils only as a map VALUE. These tests pin
 * that fact so the next reader does not take it for a spelling anything writes.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

mock.module('./supabase', { exports: { supabase: { from: () => ({}) } } });

const { normaliseStatus, rawStatusesFor, bucketsFor } = await import('./enquiryUtils.js');

const SRC = readFileSync(
  fileURLToPath(new URL('../components/OpportunityCard.jsx', import.meta.url)), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ⭐⭐ THE REAL PREDICATE, imported from the component — ⛔ not re-implemented
   here. A mirrored copy would keep passing while the card regressed, which is
   how the `offered` hole survived in the first place. */
const { isConsideredStatus: isConsidered } = await import('./opportunityCardStatus.js');

/* ⚠ UNDECIDED stays mirrored: it is inline JSX state this component does not
   export, and it is NOT what this fix changed. The source assertion at the
   bottom pins it against the component so the pair cannot drift. */
const UNREAD    = ['new', 'pending'];
const UNDECIDED = ['new', 'pending', 'seen', 'viewed'];
const isUndecided = status => UNDECIDED.includes(status);
/** The gate on the whole action row. */
const hasActions  = status => isUndecided(status) || isConsidered(status);

test('⛔⛔ OFFERED is considered, and its card keeps its actions', () => {
  // The defect, stated: the bucket says shortlisted, the old raw list did not.
  assert.equal(normaliseStatus({ status: 'offered', direction: 'incoming' }), 'shortlisted');
  assert.equal(isConsidered('offered'), true);
  assert.equal(hasActions('offered'), true, 'an offer must be answerable from the card');
  // ⚠ and the OLD predicate is what could not see it.
  assert.equal(['shortlisted', 'interested', 'tentative'].includes('offered'), false);
});

test('⭐ shortlisted behaves exactly as before', () => {
  assert.equal(isConsidered('shortlisted'), true);
  assert.equal(hasActions('shortlisted'), true);
  assert.equal(isUndecided('shortlisted'), false, 'considered is not undecided');
});

test('⭐ tentative behaves exactly as before', () => {
  // The older spelling of the same state — same bucket, same treatment.
  assert.equal(normaliseStatus({ status: 'tentative', direction: 'incoming' }), 'shortlisted');
  assert.equal(isConsidered('tentative'), true);
  assert.equal(hasActions('tentative'), true);
});

test('⛔⛔ `interested` IS A BUCKET, NOT A STORED STATUS', () => {
  /**
   * ⭐ THE RELATIONSHIP IT NAMES IS REAL AND PLATFORM-WIDE: one row read from
   * two sides, for ANY pairing of profiles that can enquire with each other.
   *
   *     database        recipient sees     initiator sees
   *     shortlisted  →  SHORTLISTED     ·  INTERESTED
   *
   * ⛔ But it is never STORED. It appears in `enquiryUtils` only as a map
   * VALUE, so no writer produces it, and there is no alias for it here: a row
   * somehow holding the literal is an unknown status, which the model files
   * under the catch-all exactly as it does any other.
   */
  for (const dir of ['incoming', 'outgoing']) {
    for (const b of bucketsFor(dir)) {
      assert.ok(!rawStatusesFor(b, dir).includes('interested'),
        `interested must not be a raw status of ${dir}/${b}`);
    }
  }
  assert.ok(bucketsFor('outgoing').includes('interested'),
    'it is the outgoing BUCKET that tentative/shortlisted/offered normalise into');
  assert.equal(normaliseStatus({ status: 'interested', direction: 'incoming' }), 'new',
    'the literal is an unknown status, so it falls to the catch-all');
  assert.equal(isConsidered('interested'), false, 'and is therefore NOT considered');
});

test('⭐⭐ the same three raw spellings ARE the relationship, from either side', () => {
  /* ⚠ The card is an INCOMING surface, so it reads the `shortlisted` bucket —
     but the initiator's `interested` bucket covers the identical set. Same
     relationship state, two viewer-relative names. */
  assert.deepEqual(rawStatusesFor('shortlisted', 'incoming').slice().sort(),
                   rawStatusesFor('interested',  'outgoing').slice().sort());
});

test('⭐ every raw spelling of the shortlisted bucket is considered', () => {
  /* ⭐ THE POINT OF USING THE BUCKET: this passes for spellings nobody has
     added yet, which is exactly what the hand-typed list could not do. */
  for (const s of rawStatusesFor('shortlisted', 'incoming')) {
    assert.equal(isConsidered(s), true, `${s} normalises to shortlisted`);
  }
});

test('⛔ unrelated states do NOT become considered', () => {
  for (const s of ['accepted', 'confirmed', 'booked', 'declined', 'rejected', 'cancelled']) {
    assert.equal(isConsidered(s), false, `${s} is decided, not under consideration`);
    assert.equal(hasActions(s), false, `${s} must keep no action row`);
  }
});

test('⚠ the undecided states are untouched by this change', () => {
  for (const s of UNDECIDED) {
    assert.equal(isUndecided(s), true);
    assert.equal(hasActions(s), true);
    // ⛔ and they must NOT become considered, or they would lose CONSIDER.
    assert.equal(isConsidered(s), false, `${s} still offers CONSIDER`);
  }
  for (const s of UNREAD) assert.equal(isUndecided(s), true);
});

test('⛔⛔ the component really uses the bucket, not the old raw list', () => {
  /* ⚠ ONE STRUCTURAL CLAIM, and it is the one the pure tests cannot make:
     that the card evaluates what is modelled above. */
  assert.match(CODE, /const isConsidered = isConsideredStatus\(status\);/,
    'the card must call the tested predicate, not re-derive one');
  assert.match(CODE, /\{\(isUndecided \|\| isConsidered\) &&/,
    'the action row must be gated on it');
  assert.ok(!/CONSIDERED\.includes\(status\)/.test(CODE), 'the raw-list test must not come back');
  assert.ok(!/const CONSIDERED\s*=\s*\[/.test(CODE), 'and neither must the raw list');
  // ⚠ UNDECIDED is still mirrored above, so pin it against the component.
  assert.match(CODE, /const UNDECIDED\s*=\s*\['new', 'pending', 'seen', 'viewed'\]/);
});
