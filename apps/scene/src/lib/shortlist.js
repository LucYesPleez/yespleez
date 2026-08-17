/**
 * ── ⭐⭐ P5.2 · WHO IS IN THE SHORTLIST ──────────────────────────────────────
 *
 * ONE derivation, TWO surfaces. `EventHostView` and `HostDashboard` each built
 * this list inline, and the copies had already drifted once (see the note on
 * `excludeApps` below). ⛔ A tab that means two things on two screens is the
 * defect §11 exists to prevent, so the rule lives here and the screens hold
 * only an adapter for their own data shape.
 *
 * ── ⭐⭐ THE RULE, RATIFIED 2026-08-17 (P5.3 REVISES P5.2) ───────────────────
 *
 *   SHORTLIST = booked + unscheduled + set times ENABLED   → top, BOOKED
 *             + shortlisted members
 *             + shortlisted applications not already represented
 *
 * ⭐⭐ THE GATE IS REACHABILITY, ⛔ NOT THE CONTRACT. P5.2 branched on
 * `requiresConfirmation`, which was the wrong axis: it asked whose booking model
 * applied, when the real question is WHETHER THE ARTIST HAS ANYWHERE ELSE TO BE
 * SEEN.
 *
 *   set times ON    P5.1 replaces the LINEUP tab with SET TIMES. A booked act
 *                   holding no slot appears in NO slot grid, so without this
 *                   they are invisible on both host surfaces. ⭐ They belong
 *                   here, at the top, on EVERY contract — grandfathering means
 *                   "do not migrate their booking", ⛔ it does not mean "let
 *                   them fall off the screen".
 *
 *   set times OFF   The LINEUP tab still exists and already lists them with
 *                   NEEDS SET TIME and an ASSIGN SET TIME action. ⛔ INJECTING
 *                   THEM HERE WOULD DUPLICATE A WORKING SURFACE.
 *
 * ⚠⚠ MEASURED BEFORE IT WAS WRITTEN (production, 2026-08-17). 121 of 145
 * `on_bill` members hold no slot. Ungated, this rule would put 121 artists into
 * 37 shortlists — and only ONE event has any shortlist content today. Gated on
 * set times it adds exactly ONE row in the whole database: `luc` on Bass Heavy,
 * the case that exposed the hole. ⛔ Do not remove the gate.
 *
 * ⛔ BOOKED **AND SCHEDULED** NEVER APPEARS HERE. They are in SET TIMES, which
 * is a better answer to "when are they playing" than a chip could be.
 *
 * ⭐ LINEUP is the AUTHORITATIVE BILL. SHORTLIST is the WORKSPACE.
 *
 * ⛔⛔ AN `on_bill` ROW IS NEVER RE-READ AS "SHORTLISTED". Booked members enter
 * this list as their own kind, carrying `booked: true`, so a screen can label
 * them honestly. Relabelling the bill would make the status column mean
 * whichever tab was looking at it.
 */
import { isBooked, isScheduled } from './hostLineup';
import { findExistingMember } from './lineupFromApplication';

/**
 * ⭐ THE SAME IDENTITY RULE AS `findExistingMember`, FOR TWO MEMBER ROWS.
 *
 * ⚠ It cannot simply call that function: `findExistingMember` reads an
 * APPLICATION (`from_profile_id`, `artist_id`, `artist_name`) and a member row
 * spells the first of those `artist_profile_id`. ⛔ Passing a member in where an
 * application is expected matches on `undefined` and quietly pairs unrelated
 * rows.
 *
 * ⛔ Priority order is identical, and deliberately so:
 *   1. artist_profile_id   2. artist_id   3. name, ONLY when neither side has
 *      an id — the 21 hand-typed members have nothing else, and two blank names
 *      must never match.
 */
export function sameArtist(a, b) {
  if (!a || !b) return false;
  if (a.artist_profile_id && b.artist_profile_id) return a.artist_profile_id === b.artist_profile_id;
  if (a.artist_id && b.artist_id) return a.artist_id === b.artist_id;
  if (a.artist_profile_id || b.artist_profile_id || a.artist_id || b.artist_id) return false;
  const an = String(a.artist_name || '').trim().toLowerCase();
  const bn = String(b.artist_name || '').trim().toLowerCase();
  return !!an && an === bn;
}

/**
 * @param event           the event row — ⭐ decides which contract applies
 * @param shortlistMembers  `lineup_members` with status 'shortlisted'
 * @param billMembers       `lineup_members` with status 'on_bill'
 * @param perfsByMember     { [member.id]: performances[] } — ⭐ only consulted
 *                          on a managed event, where booking is the artist's
 *                          `accepted` performance rather than the bill row
 * @param shortlistedApps   applications ALREADY bucketed to 'shortlisted' by
 *                          the caller. ⛔ This module does not know the two
 *                          status vocabularies; `normaliseStatus` owns that and
 *                          duplicating the knowledge here is how they diverge.
 * @param appProfiles      { [app.id]: profile } for the name-key comparison
 * @param usesSetTimes     ⭐⭐ THE GATE, from `lib/eventSetTimes.setTimesEnabled`
 *                         — ⛔ passed IN, never re-derived here. That module is
 *                         the one reader of `config.set_times_enabled` and it
 *                         has a fallback for events that never answered; a
 *                         second opinion in this file is how the SET TIMES tab
 *                         and this list would come to disagree about whether an
 *                         event even has a running order.
 *
 * @returns {{id, row, kind:'member'|'application', booked:boolean, needsSetTime:boolean}[]}
 *          ⭐ ONE entry per artist, booked first, ⛔ never the same artist twice.
 */
export function shortlistEntries({
  event = null, shortlistMembers = [], billMembers = [],
  perfsByMember = {}, shortlistedApps = [], appProfiles = {}, usesSetTimes = false,
} = {}) {
  const shortMembers = (shortlistMembers || []).filter(Boolean);
  const bill         = (billMembers || []).filter(Boolean);
  const perfsOf      = m => (perfsByMember || {})[m?.id] || [];

  /**
   * ⭐⭐ THE ONE BRANCH, AND IT IS THE GATE — see the header. Everything below
   * is shared.
   *
   * ⚠ `isBooked` carries the contract (on_bill for legacy/imported, an accepted
   * performance for managed), so ⛔ no contract test belongs here.
   */
  const bookedRows = usesSetTimes
    ? bill
      .filter(m => isBooked(m, perfsOf(m), event) && !isScheduled(perfsOf(m)))
      /**
       * ⚠ A shortlisted row WINS over a booked one for the same artist. Both
       * shapes render, but an artist listed twice reads as a data fault, and
       * `lineup_members` has no uniqueness constraint to make this impossible.
       */
      .filter(m => !shortMembers.some(sm => sameArtist(sm, m)))
    : [];

  /**
   * ⚠⚠ THE DRIFT THIS CLOSES. `EventHostView` excluded applications matching
   * the shortlist OR the bill; `HostDashboard` had both checks too, but each
   * screen assembled its own pair from its own variables — so the guarantee
   * held by coincidence rather than by construction. An application whose
   * artist is already represented ANYWHERE on the event is excluded here, once.
   *
   * ⛔ Checked against the WHOLE bill, ⛔ not only the booked part of it. An
   * applicant already on the bill awaiting their answer is still represented.
   */
  const known = [...shortMembers, ...bill];
  const apps  = (shortlistedApps || []).filter(a =>
    !findExistingMember(a, known, (appProfiles || {})[a?.id] || null));

  return [
    /* ⭐ `needsSetTime` is true for exactly these rows, by construction: they
       are here BECAUSE they are booked with nowhere to play. The surfaces read
       it rather than re-testing the performances. */
    ...bookedRows.map(row => ({ id: row.id, row, kind: 'member', booked: true,  needsSetTime: true  })),
    ...shortMembers.map(row => ({ id: row.id, row, kind: 'member', booked: false, needsSetTime: false })),
    ...apps.map(row => ({ id: row.id, row, kind: 'application', booked: false, needsSetTime: false })),
  ];
}

/**
 * ⭐ THE ADAPTER FOR `HostDashboard`, which holds the `{ member, perfs }` groups
 * `buildHostLineup` returns rather than a flat array plus a map — the same split
 * `bookedMembers` / `bookedMemberRows` already straddles in `hostLineup`.
 *
 * ⛔ It adapts the SHAPE and nothing else: the rule stays in one function.
 */
export function shortlistEntriesFromGroups({
  event = null, shortlistMembers = [], billGroups = [],
  shortlistedApps = [], appProfiles = {}, usesSetTimes = false,
} = {}) {
  const groups      = (billGroups || []).filter(g => g?.member);
  const billMembers = groups.map(g => g.member);
  const perfsByMember = {};
  groups.forEach(g => { perfsByMember[g.member.id] = g.perfs || []; });
  return shortlistEntries({
    event, shortlistMembers, billMembers, perfsByMember, shortlistedApps, appProfiles, usesSetTimes,
  });
}
