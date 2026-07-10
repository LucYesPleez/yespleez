# Security sprint — 2026-07 — summary

**Status: COMPLETE.**

Triggered by an RLS policy audit run at the start of the identity migration's M0 preflight (2026-07-10/11), which surfaced live, exploitable data-access vulnerabilities unrelated to the identity architecture work. The identity migration was paused so these could be treated as their own isolated workstream, following the same discipline throughout: read-only pre-flight verification against the live database before every change, minimal fix only, verification query, behavioural verification, isolated commit, review before proceeding to the next fix.

## Fix-by-fix outcome

### Fix 1 — `applications` SELECT — retracted, no vulnerability existed
Initially reported as an always-true `USING` clause (`Users see own apps`) sitting beside the correctly-scoped `artists see own applications`. Fresh verification against the live database found no such policy. The original "empirical confirmation" was a false positive: the test account holds five profile types (including a host profile owning 24 real events) under one `auth.uid()`, and the "leaked" rows were fully explained by legitimate host-ownership visibility via the separate, correctly-scoped `hosts see applications for their events` policy. **No database change made. No commit.**

### Fix 2 — `applications` UPDATE — fixed
**Vulnerability:** `Hosts update apps` had `USING (true)` — any request could update any application row regardless of ownership.
**Complication found:** a plain drop would have broken a live feature — artists accepting/declining slot offers (`notifActions.js`) update `applications.status` as the artist, which only the broad policy was silently enabling; no artist-scoped UPDATE policy existed otherwise.
**Fix:** added an interim policy (`artists can update own application (interim)`, `auth.uid() = artist_id`, mirroring the existing DELETE policy's scoping) before dropping the broad one. Documented via `COMMENT ON POLICY` as interim, deferred to the future Booking architecture review (should `performances` become the sole writable booking state, with `applications.status` becoming derived/read-only?).
**Verified:** host shortlist action confirmed live through the real Applications screen (`PENDING 1→0`, `TENTATIVE 0→1`); artist accept/decline confirmed by replicating the exact `acceptSlotOffer`/`declineSlotOffer` code path on real rows.
**Commit:** `4496747`

### Fix 3 — `applications` INSERT — fixed
**Vulnerability:** `Anyone can apply` had `WITH CHECK (true)` — any request could insert an application naming any `artist_id`, any event, any status (including bypassing the workflow straight to `confirmed`).
**Fix:** pure drop. All three real INSERT call sites (`EventScreen.jsx`, `notifActions.js`, `ArtistDashboard.jsx`) already scope to the inserting session's own `auth.uid()` — no interim policy needed. The correctly-scoped `artists can apply` policy already covers every legitimate path.
**Verified:** a minimal schema-valid payload succeeded cleanly post-fix (201, correct `artist_id`). Live UI verification (punter view → APPLY TO PLAY → SEND APPLICATION) additionally surfaced two **unrelated, pre-existing schema mismatches** — see below — which were deliberately excluded from this fix and tracked separately.
**Known, accepted residual:** an artist can still self-insert an application with a non-standard status (e.g. `confirmed`), bypassing host review of their own application. Narrower than the original bug (self-only, not cross-user forgery); deferred to the same Booking architecture review as Fix 2.
**Commit:** `6586fe3`

### Fix 4 — `notifications` INSERT — verified, no database changes required
Originally reported as an unconditional `Anyone can insert notifs` policy sitting beside the correctly-scoped `authenticated users can insert notifications`. Fresh, authoritative verification against the live database found **only one** INSERT policy exists — the correctly-scoped one. The unconditional policy does not exist in the live database. **No SQL migration, no policy change, no commit.**

The process gap that let this go unnoticed for two fixes: when the Fix 1 discrepancy first surfaced, a combined fresh dump was requested covering both `applications` and `notifications`, but only `applications` results were ever actually reviewed in the following turns before "Fixes 2, 3 and 4 remain supported" was accepted as covering all three. `notifications` was never independently re-confirmed until Fix 4 was reached directly.

**Accepted interim limitation, recorded in project documentation (not the database catalog, since nothing was modified):** the sole surviving INSERT policy checks only `auth.role() = 'authenticated'` — any authenticated user can currently insert a notification into any other user's inbox. Tracing every legitimate notification writer in the codebase found at least four distinct authorization shapes (host-owns-event, venue-owns-enquiry, artist-responds-to-counterparty, open-follow) — real relationship-scoped authorization design, not a security-patch-sized change. Deferred to a future Notifications architecture redesign. Documented in [`docs/known-issues/notifications-schema-drift.md`](./known-issues/notifications-schema-drift.md).

## Commits produced during this sprint

| Commit | Message | Corresponds to |
|---|---|---|
| `4496747` | Security: fix unconditional UPDATE policy on applications (Fix 2/4) | Fix 2 |
| `6586fe3` | Security: fix unconditional INSERT policy on applications (Fix 3/4) | Fix 3 |
| `0f9b10b` | Track schema drift bugs found during Fix 3 verification | Known-issues docs (applications + notifications schema drift), not a fix itself |

Fix 1 and Fix 4 produced no commits — both were retracted/verified with no database changes required, per the above.

## Issues opened, not yet resolved (out of scope for this sprint)

- [`docs/known-issues/applications-schema-drift.md`](./known-issues/applications-schema-drift.md) — live "Apply to Event" flow (and likely `acceptInvite`/`handleOfferRespond`) fails: code writes `artist_name`/`genre`/`mix_link`/`avatar_url`, none of which exist on the live table.
- [`docs/known-issues/notifications-schema-drift.md`](./known-issues/notifications-schema-drift.md) — live table has no `data` column and a legacy flat-column/type shape; current code's writes likely fail across the board. Also now includes the Fix 4 interim-authorization-limitation note.
- Both filed as tracking docs rather than GitHub Issues — `gh` CLI is not authenticated in this environment. Convert to real Issues once authenticated.

## Statement

**The database security sprint is complete.** All four originally-flagged vulnerabilities have been resolved to the correct end state: two fixed and verified (Fix 2, Fix 3), two retracted after fresh verification found no live vulnerability (Fix 1, Fix 4). No further RLS/security work is pending from this audit.

## Recommended next milestone

Per the sequencing already agreed before this sprint began: **do not resume the identity migration (M0) yet.** Two schema-drift issues were discovered mid-sprint that make `applications` and `notifications` untrustworthy subsystems right now — continuing straight into M0's data census and later phases would mean debugging schema failures and migration-logic failures simultaneously, exactly the entangled-debugging problem the pause was meant to avoid.

Recommended order:
1. **Applications schema reconciliation** — arguably the more urgent of the two: it blocks a core, visible user flow (Apply to Event) outright, and the fix is more contained (reconcile a handful of field names/columns).
2. **Notifications schema reconciliation** — broader in scope (different data model entirely, not just missing fields), and worth resolving before any future Notifications authorization redesign builds on a schema that's still drifting.
3. **Resume identity migration at M0** — once both subsystems are back on a trustworthy footing.

This is a recommendation only — no implementation started.
