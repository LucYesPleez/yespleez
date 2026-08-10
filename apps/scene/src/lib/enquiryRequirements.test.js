import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '@yespleez/requirements';
import { canSendEnquiry, enquirySnapshot } from './enquiryRequirements.js';

/**
 * P6/P7 — the venue enquiry gate.
 *
 * Exercises the REAL engine rather than a stubbed verdict: the point of the
 * feature is that one evaluator answers for applications and enquiries alike,
 * and a test that fakes `canSubmit` would pass even if the two drifted apart.
 */

const ASKS = ['BIO', 'PROFILE_PHOTO'];

/** A profile that satisfies ASKS. Columns are what the registry maps those keys to. */
const COMPLETE = { id: 'p1', bio: 'Nine years of loud rooms.', avatar: 'https://x/y.jpg' };
/** Same act, missing the photo. */
const INCOMPLETE = { id: 'p1', bio: 'Nine years of loud rooms.', avatar: null };

const verdictFor = profile => evaluate(ASKS, { profile, assets: [] });

// ── No requirements: the normal case ────────────────────────────────────

test('a venue that asks for nothing is enquirable', () => {
  assert.equal(canSendEnquiry({ required: [], evaluation: null, evaluating: false }), true);
});

/**
 * ⚠⚠ REGRESSION — THIS TEST USED TO ASSERT THE OPPOSITE, AND WAS WRONG.
 *
 * It read "NULL required_items behaves exactly like an empty list", reasoning
 * from the DATABASE, where NULL and '{}' both mean "asks for nothing". True
 * there — but in memory the state started as `[]` before the fetch returned,
 * so UNKNOWN wore the costume of NONE and the gate opened for anyone quick
 * enough to send during the round trip. Their enquiry was stored with a null
 * snapshot, permanently indistinguishable from a venue that asked for nothing.
 *
 * The database's NULL is collapsed to `[]` at the fetch boundary, so by the
 * time a value reaches the gate, null can only mean "not read yet".
 */
test('null requirements are UNKNOWN and block — they are not an empty list', () => {
  assert.equal(canSendEnquiry({ required: null, evaluation: null, evaluating: false }), false);
  assert.equal(canSendEnquiry({ required: undefined, evaluation: null, evaluating: false }), false);
  assert.equal(canSendEnquiry({}), false, 'no arguments at all must not read as permission');
});

test('a satisfied act STILL cannot send while the venue requirements are unread', () => {
  // The worst version of the bug: everything else looks fine, so nothing on
  // screen suggests the answer is unknown.
  const evaluation = verdictFor(COMPLETE);
  assert.equal(canSendEnquiry({ required: null, evaluation, evaluating: false }), false);
});

test('no enquiry can be created while requirements are unread — the snapshot would be null', () => {
  const evaluation = verdictFor(COMPLETE);
  const sendable = canSendEnquiry({ required: null, evaluation, evaluating: false });
  const snap = enquirySnapshot({ required: null, evaluation });
  assert.equal(snap, null, 'an unread state must not manufacture a verdict');
  assert.equal(sendable, false,
    'a sendable enquiry with a null snapshot is indistinguishable from "asked nothing" forever');
});

// ── Blocked ─────────────────────────────────────────────────────────────

test('an unmet requirement blocks the enquiry', () => {
  const evaluation = verdictFor(INCOMPLETE);
  assert.equal(evaluation.canSubmit, false, 'engine should not clear an incomplete profile');
  assert.equal(canSendEnquiry({ required: ASKS, evaluation, evaluating: false }), false);
});

test('FAILS CLOSED while the verdict is still being computed', () => {
  // Sending here would write a row whose snapshot is null against a venue that
  // DOES have requirements — indistinguishable ever after from "asked nothing".
  const evaluation = verdictFor(COMPLETE);
  assert.equal(canSendEnquiry({ required: ASKS, evaluation, evaluating: true }), false);
});

test('FAILS CLOSED when the venue asks for something and there is no verdict', () => {
  assert.equal(canSendEnquiry({ required: ASKS, evaluation: null, evaluating: false }), false);
});

// ── Allowed ─────────────────────────────────────────────────────────────

test('a satisfied profile may enquire', () => {
  const evaluation = verdictFor(COMPLETE);
  assert.equal(evaluation.canSubmit, true);
  assert.equal(canSendEnquiry({ required: ASKS, evaluation, evaluating: false }), true);
});

/**
 * An unrecognised key is surfaced as NON-blocking by the engine, deliberately,
 * so a stale requirement cannot trap an enquirer behind something they have no
 * way to fix. The gate must inherit that rather than re-deciding it.
 */
test('a stale key the registry no longer knows does not trap the enquirer', () => {
  const evaluation = evaluate(['NO_SUCH_KEY'], { profile: COMPLETE, assets: [] });
  assert.equal(canSendEnquiry({ required: ['NO_SUCH_KEY'], evaluation, evaluating: false }), true);
});

// ── The snapshot (P7) ───────────────────────────────────────────────────

test('a satisfied enquiry stores the full verdict', () => {
  const evaluation = verdictFor(COMPLETE);
  const snap = enquirySnapshot({ required: ASKS, evaluation });
  assert.equal(snap.v, 1);
  assert.deepEqual(snap.required_items, ASKS);
  assert.equal(snap.satisfied, 2);
  assert.equal(snap.total, 2);
  assert.deepEqual(snap.items.map(i => i.key), ASKS);
  assert.ok(Date.parse(snap.evaluated_at), 'evaluated_at is not a timestamp');
});

test('the snapshot copies what was asked, so later edits cannot rewrite history', () => {
  const evaluation = verdictFor(COMPLETE);
  const asked = [...ASKS];
  const snap = enquirySnapshot({ required: asked, evaluation });
  asked.push('PRESS_KIT');                       // the venue tightens its policy
  assert.deepEqual(snap.required_items, ASKS, 'snapshot followed the live list');
});

test('the snapshot stores states, never profile values', () => {
  const snap = enquirySnapshot({ required: ASKS, evaluation: verdictFor(COMPLETE) });
  const serialised = JSON.stringify(snap);
  assert.ok(!serialised.includes('Nine years'), 'bio text leaked into the snapshot');
  assert.ok(!serialised.includes('https://x/y.jpg'), 'avatar url leaked into the snapshot');
  for (const item of snap.items) {
    assert.deepEqual(Object.keys(item).sort(), ['key', 'state'], 'snapshot item carries more than key+state');
  }
});

// ── The acting-profile switch ───────────────────────────────────────────

/**
 * A verdict is a property of the PAIR. Switching acting profile re-runs the
 * evaluation, but for the render between the switch and the effect the old
 * answer is still in state — and their band may hold a press kit their solo
 * act does not, so a stale pass is a real bypass.
 */
test('a verdict for a DIFFERENT act does not let this one through', () => {
  const evaluation = verdictFor(COMPLETE);
  assert.equal(canSendEnquiry({
    required: ASKS, evaluation, evaluating: false,
    actingProfileId: 'the-solo-act', evaluatedProfileId: 'the-band',
  }), false);
});

test('a verdict for the SAME act is accepted', () => {
  const evaluation = verdictFor(COMPLETE);
  assert.equal(canSendEnquiry({
    required: ASKS, evaluation, evaluating: false,
    actingProfileId: 'the-band', evaluatedProfileId: 'the-band',
  }), true);
});

test('callers that do not track the pair keep working', () => {
  // Only enforced when BOTH ids are known — otherwise a caller that never
  // supplies them would be blocked forever.
  const evaluation = verdictFor(COMPLETE);
  assert.equal(canSendEnquiry({ required: ASKS, evaluation, evaluating: false }), true);
  assert.equal(canSendEnquiry({
    required: ASKS, evaluation, evaluating: false, actingProfileId: 'x', evaluatedProfileId: null,
  }), true);
});

// ── Populated requirements evaluate normally ────────────────────────────

test('populated requirements evaluate normally in both directions', () => {
  const pass = verdictFor(COMPLETE);
  const fail = verdictFor(INCOMPLETE);
  assert.equal(canSendEnquiry({ required: ASKS, evaluation: pass, evaluating: false }), true);
  assert.equal(canSendEnquiry({ required: ASKS, evaluation: fail, evaluating: false }), false);
});

test('an empty list is a settled answer and lets a satisfied act through', () => {
  assert.equal(canSendEnquiry({ required: [], evaluation: null, evaluating: false }), true);
  assert.equal(canSendEnquiry({ required: [], evaluation: verdictFor(COMPLETE), evaluating: false }), true);
  // Even mid-evaluation: there is nothing to evaluate against.
  assert.equal(canSendEnquiry({ required: [], evaluation: null, evaluating: true }), true);
});

test('NULL snapshot when the venue asked for nothing — not an empty 0/0 verdict', () => {
  assert.equal(enquirySnapshot({ required: [], evaluation: verdictFor(COMPLETE) }), null);
  assert.equal(enquirySnapshot({ required: null, evaluation: null }), null);
  assert.equal(enquirySnapshot({}), null);
});

/**
 * THE INVARIANT THAT TIES THE TWO FUNCTIONS TOGETHER, over every state the
 * screen can actually be in. If any sendable state produced no snapshot while
 * the venue had requirements, that enquiry would land with a null verdict —
 * the exact permanent-ambiguity failure this whole gate exists to prevent.
 */
test('across every state: sendable + venue has requirements ⇒ a snapshot exists', () => {
  const pass = verdictFor(COMPLETE);
  const fail = verdictFor(INCOMPLETE);
  const states = [
    { required: null,  evaluation: null, evaluating: false },
    { required: null,  evaluation: pass, evaluating: false },
    { required: null,  evaluation: pass, evaluating: true  },
    { required: [],    evaluation: null, evaluating: false },
    { required: ASKS,  evaluation: null, evaluating: true  },
    { required: ASKS,  evaluation: null, evaluating: false },
    { required: ASKS,  evaluation: fail, evaluating: false },
    { required: ASKS,  evaluation: pass, evaluating: true  },
    { required: ASKS,  evaluation: pass, evaluating: false },
    { required: ASKS,  evaluation: pass, evaluating: false, actingProfileId: 'a', evaluatedProfileId: 'b' },
    { required: ASKS,  evaluation: pass, evaluating: false, actingProfileId: 'a', evaluatedProfileId: 'a' },
  ];
  for (const state of states) {
    if (!canSendEnquiry(state)) continue;
    const hasRequirements = Array.isArray(state.required) && state.required.length > 0;
    if (!hasRequirements) continue;
    assert.notEqual(
      enquirySnapshot(state), null,
      `sendable with requirements but no snapshot: ${JSON.stringify({ ...state, evaluation: !!state.evaluation })}`,
    );
  }
});

/**
 * The gate and the snapshot must agree. Any state where an enquiry may be sent
 * against a venue that asks for something MUST produce a stored verdict —
 * otherwise a sent enquiry has no record of what it was judged against.
 */
test('every sendable enquiry against a demanding venue carries a snapshot', () => {
  const evaluation = verdictFor(COMPLETE);
  const sendable = canSendEnquiry({ required: ASKS, evaluation, evaluating: false });
  const snap = enquirySnapshot({ required: ASKS, evaluation });
  assert.equal(sendable, true);
  assert.notEqual(snap, null, 'sendable enquiry would have been stored with no verdict');
});
