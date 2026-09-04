/**
 * MAY THIS ACCOUNT MANAGE THIS EVENT?
 *
 * ⚠⚠ THE DEFECT THIS EXISTS FOR. `EventScreen` gated the entire management UI
 * on `session?.user?.id === event.host_id`. Measured 2026-08-15: **82 of 92
 * events have a NULL `host_id`**, including 35 that carry a bill and a real
 * `owner_profile_id`, 22 of them owned by CLAIMED profiles across 3 accounts.
 *
 * So the owner of `Creatures of the Swamp` opened their own event and got the
 * punter's page. Not a permission error, not an empty state — the management
 * surface simply was not rendered, with nothing to say why.
 *
 * ⭐ This is the SAME defect L1 fixed in RLS, one layer up. Fixing only the
 * database would have left the writes legal and the buttons unreachable.
 *
 * ── ⛔ THIS IS A GATE ON RENDERING, NOT A PERMISSION ────────────────────────
 *
 * `can_act_as()` in the database is the only authority (identity v1.1 §A4), and
 * every policy re-checks it. A wrong answer here shows or hides a button; it
 * cannot grant anything, because the write behind the button is checked again
 * by RLS. ⛔ Do not let this become the basis of a security claim.
 *
 * ⚠ Kept apart from `lib/actingProfile` deliberately. That module is explicit
 * that it answers ATTRIBUTION and "never permission" — a different question
 * about a different subject, which by the consumer-identity rule is a sibling
 * module rather than another export bolted onto it.
 */

/**
 * @param event               an `events` row: { host_id, owner_profile_id }
 * @param userId              the signed-in account, or null
 * @param ownedProfileIds     profile ids this account owns (getOwnerProfiles)
 */
export function isEventManager(event, { userId, ownedProfileIds = [] } = {}) {
  if (!event || !userId) return false;

  /**
   * ⚠ `event.host_id &&` IS LOAD BEARING, not defensive noise. Without it, a
   * NULL `host_id` compared against a NULL `userId` is a match, and every
   * signed-out visitor becomes the manager of 82 events. The shipped
   * expression happened to escape this only because a signed-out `userId` is
   * `undefined` rather than `null` — ⛔ an accident, not a guard.
   */
  if (event.host_id && event.host_id === userId) return true;

  return !!event.owner_profile_id && ownedProfileIds.includes(event.owner_profile_id);
}

/**
 * Which events out of a list this account manages.
 *
 * ⭐ THE HOST DASHBOARD'S QUESTION, and it must be answered the SAME WAY as the
 * event page's or the two disagree about what you own — an event that offers no
 * management UI while still appearing in your LINEUP, or the reverse.
 */
export function manageableEvents(events = [], opts = {}) {
  return (events || []).filter(e => isEventManager(e, opts));
}

/**
 * ⭐⭐ THE POSTGREST FORM OF THE SAME QUESTION — "events this host is
 * responsible for", as an `.or()` filter.
 *
 * ⚠⚠ MOVED HERE FROM `HostDashboard` (2026-08-16), where its own header called
 * it "the ONE definition" while being private to that file. The Discover
 * shortlist sheet has to ask the identical question, and a second copy is how
 * two surfaces come to disagree about which events you own.
 *
 * Responsibility follows OWNERSHIP (identity v1.3 O-R4). `owner_profile_id` is
 * authority and works for claimed and unclaimed profiles alike; `host_id` is
 * authorship — the account that created the row — and survives only as a
 * backward-compatibility arm.
 *
 * ⛔⛔ BOTH ARMS OR NEITHER. `host_id` is NULL on 82 of 92 events, so an
 * owner-only filter is not "stricter", it is wrong for the ten it does match;
 * and a host_id-only filter misses almost everything. Dropping either arm is
 * the same class of mistake that once locked owners out of their own events in
 * RLS and in the client at the same time.
 */
export function ownedByFilter(userId, hostProfileId) {
  const arms = [];
  if (hostProfileId) arms.push(`owner_profile_id.eq.${hostProfileId}`);
  if (userId) arms.push(`host_id.eq.${userId}`);
  return arms.join(',');
}

/**
 * ── ⭐⭐ THE EVENTS ON ONE VENUE'S DASHBOARD ────────────────────────────────
 *
 * ⛔⛔ AN ACCOUNT IS NOT A VENUE (owner, 2026-09-04). `VenueDashboard` asked
 * `.eq('host_id', userId)` — its own comment admitted it, "approximated with
 * host_id for now" — and `host_id` is the ACCOUNT. On an account holding seven
 * profiles that listed 5 events on the Elbows Rest dashboard of which 2 were
 * Elbows Rest's: a YesPleez night at the Bellingen Brewing Co, a Solstice
 * Soirée with no venue at all, and an Echo Valley FESTIVAL event.
 *
 * ⚠ The tell that it was a defect and not a convenience: on that same header
 * ENQUIRIES and AVAIL. DATES are filtered by `venue_profile_id` and EVENTS was
 * filtered by the account, so one strip of numbers meant two different things.
 * Identity v1.3 O-R3 states it outright — the account is authorship, delivery,
 * dedup and authentication, ⛔ NEVER ownership.
 *
 * ── ⛔ WHY THREE ARMS, AND WHY NONE OF THEM MAY GO ──────────────────────────
 *
 * ⭐⭐ `venue_profile_id` IS NOT OPTIONAL. A venue's own bookings are usually
 * owned by SOMEBODY ELSE — `Bass Heavy` is owned by the YesPleez host profile
 * and held at Elbows Rest, and it belongs on this dashboard. An owner-only
 * filter is the obvious fix and it silently deletes the venue's actual diary.
 *
 * ⚠ The legacy arm is CONJOINED, ⛔ not a bare `host_id.eq`. `host_id` is NULL
 * on 82 of 92 events so the arm has to exist, but qualified by
 * `owner_profile_id.is.null` it can only ever ANSWER FOR A ROW THAT NAMES NO
 * OWNER — it can no longer override a row that does. That is the whole
 * difference between this and `ownedByFilter` above, whose bare arm is what
 * lets a festival event turn up on a venue's page.
 *
 * ⛔ SCENE HAS NO FESTIVAL DASHBOARD (`PROFILE_TYPES.festival.dashPath` is
 * null), so a festival-owned event is reachable in Scene only through
 * `ownedByFilter`'s bare account arm. ⚠ That arm is deliberately LEFT ALONE:
 * tightening it in the same pass would make `Echo Valley 2026` unreachable.
 *
 * @param venueProfileId the venue profile whose dashboard this is
 */
export function venueEventsFilter(userId, venueProfileId) {
  const arms = [];
  if (venueProfileId) {
    arms.push(`owner_profile_id.eq.${venueProfileId}`);   // nights this venue runs
    arms.push(`venue_profile_id.eq.${venueProfileId}`);   // nights held here by others
  }
  /* ⛔ Only for rows that name no owner at all. */
  if (userId) arms.push(`and(host_id.eq.${userId},owner_profile_id.is.null)`);
  return arms.join(',');
}
