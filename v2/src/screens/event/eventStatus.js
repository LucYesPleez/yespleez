// The status pill's condition.
//
// Spec: docs/event-page-layout-spec.md § 2
//
// ⚠ This deliberately does NOT read `events.status`.
//
// In this codebase `status: 'live'` means PUBLISHED, not happening now — it is
// the other half of the DRAFT/LIVE toggle in the host's manage panel. The
// existing event screen renders it as "LIVE NOW", which is a mislabel: an event
// published three months early reads as though it is on right now.
//
// A punter cannot see drafts at all, so publication state carries no
// information for them. What they need is TEMPORAL state, which comes from the
// dates. That is what this returns.
//
// Date granularity only. Times exist on well under half of events, so deriving
// an hour-accurate "on now" would be a guess dressed up as a fact for most of
// them — and R1 says unknown is not the same as absent.

const DAY = 'T00:00:00';

/**
 * @returns 'past' | 'on-now' | null   (null = upcoming; the date says it,
 *                                      so no pill — R3, no placeholders)
 */
export function deriveEventStatus({ date, endDate } = {}, now = new Date()) {
  if (!date) return null;

  const start = parseDay(date);
  if (!start) return null;

  const end = parseDay(endDate) || start;
  const today = startOfDay(now);

  if (end < today)   return 'past';
  if (start <= today) return 'on-now';
  return null;
}

export const STATUS_LABEL = {
  'past':   'PAST EVENT',
  'on-now': 'ON NOW',
};

function parseDay(v) {
  if (!v) return null;
  const d = new Date(String(v).slice(0, 10) + DAY);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
