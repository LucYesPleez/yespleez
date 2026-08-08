/**
 * THE PRIORITY ENGINE — "what needs me right now?"
 *
 * A pure function over a snapshot of facts. No queries, no React, no clock of
 * its own: `now` is passed in. That is what makes it reasonable about and
 * testable, and it is why the whole of Companion Home is one call to it.
 *
 * ⭐ THE THREE LAWS, from the ratified attention-dashboard pattern. Every one
 * of them is enforced by the SHAPE of what this returns, not by convention:
 *
 *   1. Every item carries SIGNAL, REASON and ACTION. There is no way to build
 *      one without all three — a bare number is a reporting dashboard, and the
 *      action is what makes this an operational one.
 *   2. Exactly ONE destination per item, and it lands on the FILTERED view.
 *      An item that has already done the thinking must not drop the organiser
 *      on an unfiltered table to redo it.
 *   3. ⛔ NOT DISMISSIBLE. There is deliberately no `dismissed` field and no
 *      way to add one here. An item disappears when the underlying FACT
 *      changes, never because someone waved it away — dismissal is a second
 *      state that drifts, and then the dashboard lies.
 *
 * ⛔ The word "ladder" never reaches the UI. Internally this is a deterministic
 * rung order; to the organiser they are simply Priorities.
 *
 * ⭐ PHASE FILTERS WHICH RUNGS ARE ELIGIBLE. It never reorders them.
 */

/** Whole days from `now` until an ISO date (negative = already past). */
function daysUntil(dateStr, now) {
  if (!dateStr) return null;
  const then = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(then.getTime())) return null;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return Math.round((then - start) / 86400000);
}

/**
 * CALENDAR days since a timestamp — not elapsed 24-hour periods.
 *
 * ⚠ Deliberate, and it matters for the wording. Elapsed-time arithmetic tells
 * someone who applied at 11pm that they have been waiting "0 days" at 9am the
 * next morning: true, and the opposite of how anyone describes it. An organiser
 * reads "submitted yesterday" and expects to see one day. Both helpers in this
 * file now compare dates rather than instants, so they cannot disagree.
 */
function daysSince(iso, now) {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const a = new Date(then); a.setHours(0, 0, 0, 0);
  const b = new Date(now);  b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / 86400000);
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * ⭐ PHASE IS DERIVED, never stored — from the event's dates, its application
 * state and the clock. An organiser should not have to maintain a status field.
 *
 * `override` exists because the ratification allows a festival to force a
 * different dashboard; nothing sets it yet.
 */
export function derivePhase({ event, now = new Date(), override = null } = {}) {
  if (override) return override;
  if (!event) return 'no_event';

  const toStart = daysUntil(event.startsOn, now);
  const toEnd = daysUntil(event.endsOn ?? event.startsOn, now);

  if (toEnd !== null && toEnd < 0) return 'completed';
  if (toStart !== null && toStart <= 0 && toEnd !== null && toEnd >= 0) return 'event_live';
  if (event.applicationsOpen) return 'applications_open';
  if (event.isPublic || event.startsOn) return 'event_upcoming';
  return 'draft';
}

/**
 * Build the ordered priority list.
 *
 * @param {object}  facts
 * @param {object}  facts.event             { id, name, isPublic, applicationsOpen, startsOn, endsOn }
 * @param {Array}   facts.categories        [{ key, label, state, appliesAs, closesAt }]
 * @param {number}  facts.awaitingReview    undecided application count
 * @param {?string} facts.oldestSubmittedAt ISO timestamp of the oldest undecided
 * @param {number}  facts.pendingRelease    decided-but-unreleased count
 * @param {Date}    facts.now
 * @returns {Array} ordered items; EMPTY means nothing needs you, which is a
 *                  real and important answer rather than a failure to compute.
 */
export function buildPriorities({
  event = null,
  categories = [],
  awaitingReview = 0,
  oldestSubmittedAt = null,
  pendingRelease = 0,
  now = new Date(),
} = {}) {
  const items = [];
  const phase = derivePhase({ event, now });

  // A festival with no event has exactly one thing that needs it, and every
  // rung below is meaningless until that is true.
  if (!event) {
    return [{
      id: 'no-event',
      tone: 'danger',
      icon: 'calendar',
      signal: 'No event yet',
      reason: 'A festival needs an event before it can take applications.',
      actionLabel: 'Create an event',
      to: '/festival',
    }];
  }

  const open = categories.filter(c => c.state === 'open');

  // ── RUNG 1 · BROKEN ────────────────────────────────────────────────────
  // Highest because these fail SILENTLY. Nothing arrives, and the organiser
  // reads that as a quiet week rather than a misconfiguration.

  if (event.applicationsOpen && open.length === 0) {
    items.push({
      id: 'broken-no-open-category',
      tone: 'danger',
      icon: 'cross',
      signal: 'Applications are open, but nothing is accepting',
      reason: 'The event switch is on and every category is closed, so nobody can apply.',
      actionLabel: 'Open a category',
      to: `/festival/event/${event.id}`,
    });
  }

  // A category that is open but has no eligible profile type is a door with no
  // handle: it renders, it invites, and no account on the platform can use it.
  const uneligible = open.filter(c => !c.appliesAs?.length);
  if (uneligible.length) {
    items.push({
      id: 'broken-no-eligible-profile',
      tone: 'danger',
      icon: 'cross',
      signal: uneligible.length === 1
        ? `${uneligible[0].label} is open, but nobody can apply to it`
        : `${uneligible.length} open categories nobody can apply to`,
      reason: uneligible.length === 1
        ? 'No profile type on the platform is eligible for this category yet.'
        : `${uneligible.map(c => c.label).join(', ')} have no eligible profile type yet.`,
      actionLabel: 'Review categories',
      to: `/festival/event/${event.id}`,
    });
  }

  if (event.isPublic && !event.startsOn) {
    items.push({
      id: 'broken-public-no-dates',
      tone: 'danger',
      icon: 'calendar',
      signal: 'This event is public but has no dates',
      reason: 'Anyone can find it, and it cannot say when it happens.',
      actionLabel: 'Add dates',
      to: `/festival/event/${event.id}`,
    });
  }

  // ── RUNG 2 · DECIDED BUT NOT RELEASED ──────────────────────────────────
  // Outranks volume: these people are reading "in review" about a decision
  // that has already been made. A promise already broken.

  if (pendingRelease > 0) {
    items.push({
      id: 'pending-release',
      tone: 'warn',
      icon: 'check',
      signal: `${plural(pendingRelease, 'decision', 'decisions')} not sent`,
      reason: 'These applicants still read "In review". They are not told until you release.',
      actionLabel: 'Release outcomes',
      to: '/applications?filter=pending-release',
    });
  }

  // ── RUNG 3 · DEADLINE-BOUND ────────────────────────────────────────────
  // Time makes these urgent regardless of size.

  if (phase === 'applications_open') {
    const closing = open
      .map(c => ({ ...c, days: daysUntil(c.closesAt, now) }))
      .filter(c => c.days !== null && c.days >= 0 && c.days <= 7)
      .sort((a, b) => a.days - b.days);

    if (closing.length) {
      const soonest = closing[0];
      items.push({
        id: 'closing-soon',
        tone: 'warn',
        icon: 'clock',
        signal: soonest.days === 0
          ? `${soonest.label} closes today`
          : `${soonest.label} closes in ${plural(soonest.days, 'day', 'days')}`,
        reason: closing.length > 1
          ? `${closing.length} categories close within the week.`
          : 'After this, nobody new can apply to it.',
        actionLabel: `Review ${soonest.label}`,
        to: `/applications/${soonest.key}`,
      });
    }
  }

  const toStart = daysUntil(event.startsOn, now);
  if (phase === 'event_upcoming' && toStart !== null && toStart >= 0 && toStart <= 14) {
    items.push({
      id: 'event-soon',
      tone: 'warn',
      icon: 'calendar',
      signal: toStart === 0
        ? `${event.name} starts today`
        : `${event.name} starts in ${plural(toStart, 'day', 'days')}`,
      reason: 'Check everyone accepted knows where and when to be.',
      actionLabel: 'Open event',
      to: `/festival/event/${event.id}`,
    });
  }

  // ── RUNG 4 · WAITING ON YOU ────────────────────────────────────────────
  // Ordered by the AGE of the oldest, not by count. Volume alone is not
  // urgency; a nineteen-day-old application is.

  if (awaitingReview > 0) {
    const age = daysSince(oldestSubmittedAt, now);
    items.push({
      id: 'awaiting-review',
      tone: age !== null && age >= 14 ? 'warn' : 'info',
      icon: 'inbox',
      signal: `${plural(awaitingReview, 'application', 'applications')} waiting`,
      reason: age === null
        ? 'Nobody has looked at these yet.'
        : age === 0
          ? 'The oldest arrived today.'
          : `The oldest has been waiting ${plural(age, 'day', 'days')}.`,
      actionLabel: 'Review applications',
      to: '/applications?filter=undecided',
    });
  }

  // ── RUNG 5 · WAITING ON THEM ───────────────────────────────────────────
  // ⚠ DELIBERATELY ABSENT. "Accepted but unconfirmed" is a participation
  // fact, and participation is not built. ⛔ Do NOT approximate it from
  // application status — an accepted application is not a confirmed person,
  // and faking the distinction is precisely what the participation model
  // exists to prevent. This rung appears when participation ships.

  // ── PHASE NOTE · the weekend is not this app's job ─────────────────────
  if (phase === 'event_live') {
    items.push({
      id: 'event-live',
      tone: 'info',
      icon: 'star',
      signal: `${event.name} is running`,
      reason: 'Live operations — check-in, incidents, who is on shift — are not in this app yet.',
      actionLabel: 'See applications',
      to: '/applications',
    });
  }

  return items;
}
