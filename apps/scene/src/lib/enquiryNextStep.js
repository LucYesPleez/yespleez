/**
 * ── ⭐⭐ WHOSE COURT IS THE BALL IN? ─────────────────────────────────────────
 *
 * RATIFIED 2026-08-31, refining the role-ownership rule after real feedback
 * from a venue: he accepted an enquiry and did not know why anything more was
 * required of him.
 *
 *   ⭐⭐ ACCEPTANCE DETERMINES PERMISSION TO PROCEED.
 *   ⭐⭐ EVENT OWNERSHIP DETERMINES WHO CREATES THE EVENT.
 *
 * ⛔⛔ **ACCEPTED DOES NOT MEAN AN EVENT EXISTS.** It means the two parties
 * agreed. The card previously said "add this act to an event", which assumes
 * the event is already there — and when it is not, the instruction is
 * impossible to follow. That was the whole confusion.
 *
 * The real lifecycle:
 *
 *     ENQUIRY → ACCEPT → AGREEMENT → EVENT CREATION → SLOT / LINEUP → BOOKED
 *
 * ── THE OWNERSHIP RULE ───────────────────────────────────────────────────
 *
 * ⭐ A HOST/PROMOTER owns event creation whenever one is a party; otherwise the
 * VENUE does. That single line reproduces the whole ratified table, so there is
 * nothing to keep in sync:
 *
 *     Artist   → Venue      venue accepts      VENUE creates
 *     Promoter → Venue      venue accepts      PROMOTER creates
 *     Artist   → Promoter   promoter accepts   PROMOTER creates
 *     Venue    → Artist     artist accepts     VENUE creates
 *     Promoter → Artist     artist accepts     PROMOTER creates
 *
 * ⛔ A PERFORMER NEVER OWNS EVENT CREATION — see
 * project_role_ownership_events. Accepting a booking must never turn a DJ into
 * a promoter, so `artist`, `band` and `standup` can only ever be the WAITING
 * party here.
 *
 * ⚠ `festival` is deliberately absent: a festival is administered in the
 * Portal, `PROFILE_TYPES.festival.dashPath` is null, and Scene has no surface
 * on which it could create anything. It waits, like a performer.
 */

/** The only two types that may create an event, in priority order. */
const EVENT_OWNER_PRIORITY = ['host', 'venue'];

/** What to call the other party in a sentence. */
const ROLE_WORD = { host: 'promoter', venue: 'venue' };

/**
 * Which SIDE owns event creation for this pair.
 *
 * @returns {'you'|'them'|null} null when neither party can own an event —
 *   an act asking an act, which is a real shape under universal enquiry and
 *   simply has no event step.
 */
export function eventOwnerSide(viewerType, otherType) {
  for (const type of EVENT_OWNER_PRIORITY) {
    if (viewerType === type) return 'you';
    if (otherType === type) return 'them';
  }
  return null;
}

/**
 * The accepted-enquiry action block.
 *
 * @param {object} args
 * @param {string} args.viewerType  the type of the profile READING the card
 * @param {string} args.otherType   the type of the other party
 * @param {boolean} args.hasEvent   does this enquiry already name an event?
 * @returns {{owner: 'you'|'them'|null, chip: string|null, copy: string, action: 'create-event'|'add-to-event'|null}}
 *
 * ⭐ THE CHIP DESCRIBES RESPONSIBILITY, ⛔ never the enquiry. "ACCEPTED" is
 * already on the card and in the tab; repeating it is the noise the 2026-08-15
 * no-footer rule was right about. What was missing is whether the reader has
 * something to do.
 */
export function acceptedNextStep({ viewerType, otherType, hasEvent = false } = {}) {
  const owner = eventOwnerSide(viewerType, otherType);

  if (owner === 'you') {
    return hasEvent
      ? {
        owner,
        chip:   'YOU NEED TO ACT',
        /* ⭐ The night already exists — accepting made it (a draft), and the
           act is already on its shortlist. What is left is the event itself:
           name it, set the door time, decide whether it goes public. ⛔ Not
           "add this act": that was done for them, and telling someone to do a
           thing already done is how a workflow loses trust. */
        copy:   'Next: finish setting up the event.',
        action: 'edit-event',
      }
      : {
        owner,
        chip:   'YOU NEED TO ACT',
        copy:   'Next: create the event and add this act.',
        action: 'create-event',
      };
  }

  if (owner === 'them') {
    const word = ROLE_WORD[otherType] || 'organiser';
    return {
      owner,
      chip:   'WAITING ON THEM',
      /* ⛔ NO WORKFLOW BUTTON for the waiting party — an action they do not
         have is worse than none, and offering event creation here is exactly
         how a performer would be turned into a promoter. Messaging is the
         escape hatch and the caller always renders it. */
      copy:   hasEvent
        ? `The ${word} will add you to the event.`
        : `The ${word} will create the event.`,
      action: null,
    };
  }

  /* ⚠ Neither side can own an event. ⛔ Not an error and ⛔ not a gap to fill
     with a guess: the two of them have agreed something the event model does
     not describe, and the honest surface is the agreement plus a way to talk. */
  return { owner: null, chip: null, copy: '', action: null };
}
