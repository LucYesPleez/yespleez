/**
 * ── ⭐⭐ THE BOOKING AGREEMENT — WHAT WAS ASKED, WHAT WAS OFFERED, WHAT WAS AGREED ──
 *
 * RATIFIED 2026-08-31. The lifecycle:
 *
 *     ENQUIRY → ACCEPTED → BOOKING AGREEMENT → AGREED → EVENT → SLOT → PAID
 *
 * ⛔⛔ THREE FEES, THREE FACTS, NEVER ONE FIELD.
 *
 *     REQUESTED  what the applicant asked for. `venue_enquiries.proposed_fee`.
 *                ⛔ Never overwritten — "what did they originally want" must
 *                stay answerable after any amount of negotiation.
 *     AGREED     what both parties settled on. The accepted version's `fee`.
 *     PAID       money that moved. ⛔ NOT MODELLED YET, and deliberately not
 *                faked: nothing records a payment, so nothing here may claim
 *                one. `paymentState` returns 'pending' and says why.
 *
 * ⛔⛔ AND THE PROFILE'S OWN `fee` IS A FOURTH THING ENTIRELY — an act's rate
 * card ("I charge $450, paid work only"). It belongs to the PROFILE, not to
 * this booking, and `fee_type: 'paid'` means "I want paying", ⛔ NOT "this has
 * been paid". Rendering it as "$450 — Paid" on an enquiry is the defect this
 * module exists to make impossible to repeat.
 *
 * ── ⭐⭐ EVERY STATE HERE IS DERIVED ────────────────────────────────────
 *
 * The table stores proposals and two settlement stamps; nothing else. Current,
 * superseded, agreed and whose-turn are all computed from the version list, so
 * they cannot drift from it (project_derived_state_philosophy).
 *
 * ⛔ NOBODY MARKS AN AGREEMENT SUPERSEDED. A higher version existing IS
 * superseded, exactly as nobody marks a person Ready.
 */

/**
 * Versions newest-first, and never trusting the caller's order.
 *
 * ⚠ SORTED ON `version`, ⛔ not on created_at. Two proposals in the same second
 * tie on a timestamp, and the version number is the reader's own vocabulary
 * ("v3 — Revised") — sorting by anything else could renumber the trail.
 */
export function sortVersions(versions = []) {
  return [...(versions || [])].sort((a, b) => (b?.version ?? 0) - (a?.version ?? 0));
}

/** The proposal currently on the table: the highest version, settled or not. */
export function currentVersion(versions = []) {
  return sortVersions(versions)[0] || null;
}

/** The version both parties settled on, if any. ⛔ At most one can exist. */
export function agreedVersion(versions = []) {
  return sortVersions(versions).find(v => !!v?.accepted_at) || null;
}

/**
 * What state is a single version in?
 *
 * @returns {'agreed'|'rejected'|'superseded'|'proposed'}
 *
 * ⚠ ORDER MATTERS. A settled version keeps its own outcome even once later
 * versions exist — an accepted v5 followed by a v6 (a party reopening terms)
 * must still read as the thing that was agreed, not as "superseded", or the
 * trail loses the moment it was agreed.
 */
export function versionState(version, versions = []) {
  if (!version) return 'proposed';
  if (version.accepted_at) return 'agreed';
  if (version.rejected_at) return 'rejected';
  const highest = currentVersion(versions);
  if (highest && (highest.version ?? 0) > (version.version ?? 0)) return 'superseded';
  return 'proposed';
}

/**
 * The agreement's own state, for the card.
 *
 * @returns {'none'|'proposed'|'rejected'|'agreed'}
 *
 * ⚠ 'none' IS A REAL ANSWER, ⛔ not an error: an enquiry accepted before this
 * feature existed has no versions at all, and the honest reading is "terms not
 * started", which is what puts the first proposal in someone's court.
 */
export function agreementState(versions = []) {
  if (!versions?.length) return 'none';
  if (agreedVersion(versions)) return 'agreed';
  const current = currentVersion(versions);
  if (current?.rejected_at) return 'rejected';
  return 'proposed';
}

/**
 * ⭐⭐ WHOSE COURT IS THE BALL IN, INSIDE THE NEGOTIATION?
 *
 * ⛔ NOT ROLE-BASED. Who owns the next move here is decided by who moved last,
 * which is a fact on the row — a venue can be the waiting party and often is.
 * The role rule governs EVENT CREATION (see enquiryNextStep); it has no
 * business deciding whose turn it is to answer a fee.
 *
 * @param {object[]} versions
 * @param {string} viewerProfileId
 * @returns {'you'|'them'|null} null when the agreement is settled or there is
 *   nothing to answer — the caller then reads the event step instead.
 */
export function agreementTurn(versions = [], viewerProfileId = null) {
  const state = agreementState(versions);
  if (state === 'agreed') return null;

  /* ⛔ NOBODY'S TURN WITHOUT AN IDENTITY. A missing viewer profile must not
     default to "you need to act" — telling the wrong party to act is worse
     than telling neither, and it is how a workflow gets distrusted. */
  if (!viewerProfileId) return null;

  const current = currentVersion(versions);
  if (!current) return null;                       // caller decides who opens
  if (current.rejected_at) return null;            // walked away; no move left

  /* ⭐ THE PROPOSER IS ALREADY AGREED. Proposing IS your yes, so the answer is
     always owed by the other side. */
  return current.proposed_by_profile_id === viewerProfileId ? 'them' : 'you';
}

/**
 * The terms as they currently stand, for display.
 *
 * ⚠ `agreed` IS THE WHOLE POINT of the return shape. The same fee renders as
 * "PROPOSED FEE" or "AGREED FEE" and the two must never be confused, so the
 * caller is handed the fact rather than left to infer it from a state string
 * it might not check.
 */
export function currentTerms(versions = []) {
  const agreed  = agreedVersion(versions);
  const version = agreed || currentVersion(versions);
  if (!version) return null;
  return {
    agreed:   !!agreed,
    version:  version.version ?? null,
    fee:      version.fee ?? null,
    currency: version.currency || 'AUD',
    terms:    version.terms || {},
    note:     version.note || null,
    proposedByProfileId: version.proposed_by_profile_id || null,
  };
}

/**
 * ⛔⛔ PAYMENT IS NOT MODELLED. Nothing writes a payment, so this can only ever
 * answer 'pending', and it exists so that no surface has to invent its own
 * answer — or worse, reach for the act's `fee_type: 'paid'`, which means "I
 * want paid work" and would print PAID over every unpaid booking.
 *
 * ⚠ When payment IS built, this is the one place that changes.
 */
export function paymentState() {
  return 'pending';
}

/**
 * The fee an agreement should OPEN at.
 *
 * ⭐ The applicant's requested amount, so the first proposal starts from what
 * was actually asked rather than from an empty field. ⚠ It stays labelled
 * requested/proposed until the other party accepts — inheriting a number is
 * not agreeing it.
 *
 * ⚠ `venue_enquiries.proposed_fee` is free TEXT — "$450", "450 + door", "".
 * A number is extracted where one plainly is one and null otherwise; ⛔ never
 * 0, which would open the negotiation at "you agreed to nothing".
 */
export function requestedFeeAmount(enquiry) {
  const raw = enquiry?.proposed_fee;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const cleaned = String(raw).replace(/[$,\s]/g, '');
  /* ⛔ ANCHORED. A bare `parseFloat` reads "450 + 10% bar" as 450 and silently
     drops the half of the deal that is not money. If the text is not simply an
     amount, this says so and the proposer types what they mean. */
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Money for display. ⛔ Never a bare number — a fee without its currency is a rumour. */
export function formatFee(amount, currency = 'AUD') {
  if (amount === null || amount === undefined || amount === '') return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  const body = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return currency === 'AUD' ? `$${body}` : `${body} ${currency}`;
}

/**
 * The optional terms, in a fixed reading order, ready to render.
 *
 * ⭐ ORDER IS EDITORIAL, not alphabetical: money first (it is what the
 * negotiation is about), then the night's shape, then what is provided.
 *
 * ⛔ ABSENT KEYS ARE OMITTED, ⛔ never rendered as a blank row — the rendering
 * contract's Absent ≠ Unknown. A term nobody agreed simply is not there.
 */
export const TERM_LABELS = [
  ['bar_split',     'BAR SPLIT'],
  ['door_split',    'DOOR SPLIT'],
  ['min_spend',     'MINIMUM SPEND'],
  ['set_time',      'SET TIME'],
  ['set_duration',  'SET DURATION'],
  ['load_in',       'LOAD-IN'],
  ['soundcheck',    'SOUNDCHECK'],
  ['equipment',     'EQUIPMENT'],
  ['hospitality',   'HOSPITALITY'],
  ['other',         'OTHER TERMS'],
];

export function listTerms(terms = {}) {
  const out = [];
  for (const [key, label] of TERM_LABELS) {
    const value = terms?.[key];
    if (value === null || value === undefined || value === '') continue;
    out.push({ key, label, value: String(value) });
  }
  return out;
}

/**
 * ⭐ WHAT CHANGED BETWEEN TWO VERSIONS — the audit trail's readable half.
 *
 * ⛔ Nothing is destroyed to produce this: both versions are still whole rows,
 * and this only reads them. Returns [{ field, label, from, to }].
 *
 * ⚠ A term REMOVED is a change, and one of the easy ones to lose — dropping
 * the bar split is a material concession and must not read as "no change".
 */
export function diffVersions(previous, next) {
  if (!next) return [];
  const out = [];
  const prevFee = previous ? (previous.fee ?? null) : null;
  const nextFee = next.fee ?? null;
  if (!previous || String(prevFee) !== String(nextFee)) {
    out.push({
      field: 'fee',
      label: 'FEE',
      from: previous ? formatFee(prevFee, previous.currency || 'AUD') : null,
      to:   formatFee(nextFee, next.currency || 'AUD'),
    });
  }
  const prevTerms = previous?.terms || {};
  const nextTerms = next.terms || {};
  for (const [key, label] of TERM_LABELS) {
    const from = prevTerms[key] ?? null;
    const to   = nextTerms[key] ?? null;
    if (String(from ?? '') === String(to ?? '')) continue;
    out.push({
      field: key,
      label,
      from: from === null || from === '' ? null : String(from),
      to:   to   === null || to   === '' ? null : String(to),
    });
  }
  return out;
}

/**
 * The whole trail, oldest-first, each entry carrying its state and its diff.
 *
 * ⭐ OLDEST-FIRST here although `sortVersions` is newest-first: this is read as
 * a story ("v1 proposed, v2 revised, v5 agreed"), and a story runs forwards.
 */
export function agreementHistory(versions = []) {
  const ordered = [...(versions || [])].sort((a, b) => (a?.version ?? 0) - (b?.version ?? 0));
  return ordered.map((v, i) => ({
    version: v.version ?? i + 1,
    state:   versionState(v, versions),
    at:      v.created_at || null,
    settledAt: v.accepted_at || v.rejected_at || null,
    proposedByProfileId: v.proposed_by_profile_id || null,
    settledByProfileId:  v.accepted_by_profile_id || v.rejected_by_profile_id || null,
    fee:      v.fee ?? null,
    currency: v.currency || 'AUD',
    terms:    v.terms || {},
    note:     v.note || null,
    changes:  diffVersions(ordered[i - 1] || null, v),
  }));
}

/**
 * ⭐⭐ THE ONE ANSWER THE CARD ASKS FOR: what happens next, and whose move?
 *
 * ⛔ ALL OF IT DERIVED, in ONE place. The point of this function is that no UI
 * component works any of this out for itself — the card renders what it is
 * handed. A second copy of this reasoning inside a component is the drift that
 * NEXT_STEPS was consolidated to remove.
 *
 * The order is the lifecycle's own: terms before event, event before slot.
 * ⛔ An event step must never be offered while the money is unsettled — that
 * is how a venue ends up building a night around a fee the act never agreed.
 *
 * @param {object} args
 * @param {object[]} args.versions
 * @param {string}  args.viewerProfileId
 * @param {object}  args.eventStep   the result of acceptedNextStep() — the
 *   ROLE-owned half. ⛔ Not recomputed here: one rule, one home.
 * @param {boolean} args.hasSlot     is the act actually on a slot yet?
 * @returns {{stage, chip, copy, action, owner}}
 */
export function bookingNextStep({ versions = [], viewerProfileId = null, eventStep = null, hasSlot = false } = {}) {
  const state = agreementState(versions);

  if (state !== 'agreed') {
    const turn = agreementTurn(versions, viewerProfileId);

    if (state === 'none') {
      /* ⭐ NOBODY HAS PROPOSED YET. ⚠ The opener is whoever is reading: either
         party may put the first terms up, and waiting for "the right" one to
         start is how an accepted enquiry sits still for a week. */
      return {
        stage: 'agreement',
        owner: viewerProfileId ? 'you' : null,
        chip:  viewerProfileId ? 'YOU NEED TO ACT' : null,
        copy:  'Booking details need to be agreed.',
        action: viewerProfileId ? 'review-agreement' : null,
      };
    }

    if (state === 'rejected') {
      return {
        stage: 'agreement',
        owner: null,
        chip:  null,
        /* ⛔ Not "declined" — the ENQUIRY was accepted and still is. What was
           turned down is a set of terms, and either party may propose again. */
        copy:  'These terms were turned down. Propose new ones or talk it through.',
        action: 'review-agreement',
      };
    }

    return turn === 'you'
      ? {
        stage: 'agreement',
        owner: 'you',
        chip:  'YOU NEED TO ACT',
        copy:  'Booking details need to be agreed.',
        action: 'review-agreement',
      }
      : {
        stage: 'agreement',
        owner: 'them',
        chip:  'WAITING ON THEM',
        copy:  'Waiting for them to confirm the booking details.',
        /* ⭐ VIEW, not review — the waiting party may always read the terms.
           ⛔ What they must not get is a button implying a move they lack. */
        action: 'view-agreement',
      };
  }

  /* ── AGREED. The money is settled; the night is not. ─────────────────
     ⭐ From here the ROLE rule takes over, and it is `eventStep`'s answer
     verbatim — ⛔ a performer must never be handed CREATE EVENT, and the one
     place that decision lives is enquiryNextStep. */
  if (hasSlot) {
    return {
      stage: 'slot',
      owner: null,
      chip:  null,
      copy:  '',            // ⛔ A settled booking needs no instruction.
      action: 'view-agreement',
    };
  }

  if (!eventStep || eventStep.owner === null) {
    /* ⚠ Neither party owns event creation (an act booking an act). ⛔ Not a
       gap to fill with a guess: the agreement stands and is the honest surface. */
    return { stage: 'agreed', owner: null, chip: null, copy: '', action: 'view-agreement' };
  }

  return {
    stage:  'event',
    owner:  eventStep.owner,
    chip:   eventStep.chip,
    copy:   eventStep.copy,
    action: eventStep.action || (eventStep.owner === 'them' ? 'view-agreement' : null),
  };
}
