// § 6 · Lineup — the section's render condition.
//
// Spec: docs/event-page-layout-spec.md § 6, and Part 0 of the redesign doc.
//
//   0 artists, absent    → hide the section entirely
//   0 artists, withheld  → "to be announced" (R1 · withheld ≠ absent)
//   1 artist             → a single card. No rail, no arrow, no sort.
//   2+                   → rail; sort appears only once it earns its place
//
// Kept out of the component for the same reason the Hero ladder is: a render
// condition that cannot be tested is one nobody trusts.

// Below this you can see the whole bill by scanning, and an A–Z control is a
// button that reorders something the reader has already taken in. It earns its
// place only when the list stops being scannable.
export const SORT_THRESHOLD = 8;

export const BILL = 'bill';
export const AZ = 'az';

/**
 * @returns null                                       — absent, hide
 *        | { mode: 'withheld' }                       — announced as pending
 *        | { mode: 'single', artists }                — one card
 *        | { mode: 'rail', artists, sortable }        — the rail
 */
export function resolveLineup({ artists = [], withheld = false } = {}) {
  const list = (artists || []).filter(a => a && a.name);

  if (!list.length) {
    // R1 · the whole point of the rule. An organiser who has not announced
    // their bill has made a decision, and hiding it would spend their reveal
    // for them. An organiser who has no bill yet has made no decision at all.
    return withheld ? { mode: 'withheld' } : null;
  }

  if (list.length === 1) {
    return { mode: 'single', artists: list };
  }

  return { mode: 'rail', artists: list, sortable: list.length >= SORT_THRESHOLD };
}

/**
 * BILL is the organiser's own order and is the default, because it carries
 * meaning A–Z destroys — who is headlining, who opens, how the night is shaped.
 * A–Z is a lookup aid, never the resting state.
 */
export function sortLineup(artists, order) {
  if (order !== AZ) return artists;
  return [...artists].sort((a, b) =>
    String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' })
  );
}
