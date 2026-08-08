# YesPleez — engineering rules

Read this before touching anything. It is short on purpose.

## Orientation — edit the right files

| Path | What it is |
|---|---|
| `apps/scene/` | **The live Scene app.** React + Vite + Supabase. Was `v2/` until the monorepo move. |
| `app.js`, `follows.js`, `events.js`, `auth.js`, … *(repo root)* | **Retired v1 (vanilla JS). Do not edit.** Root has files with the same names as live Scene modules — check your path before editing. |
| `docs/` | Design reviews, migration plans, verification evidence |
| `supabase/migrations/` | Applied migrations. Never edit a migration that has shipped. |

## Governance — the architecture is frozen

Two documents are canonical **together**, and both are frozen. They live in **`docs/architecture/`** — read them there, not from memory:

- **Architecture Specification v1.0** (10 Jul 2026) — `docs/architecture/architecture-v1.0.html`
- **Identity Architecture v1.1** (ratified + frozen 17 Jul 2026) — `docs/architecture/identity-v1.1.html`
- **Identity Architecture v1.2** (ratified + frozen 18 Jul 2026) — `docs/architecture/identity-v1.2.html` — minimal amendment: narrows §A12 `U2` to block launch rather than M8, adds §A14. v1.1 stands in full otherwise.
- **Identity Architecture v1.3** (ratified + frozen 18 Jul 2026) — `docs/architecture/identity-v1.3.html` — **objects belong to profiles.** Supersedes v1.0 §03's event *authorization basis* only; §03's separation principle is preserved. Adds `O-R1`–`O-R6`. Changes nothing in v1.1 or v1.2.

> **`O-R3` · the operative statement.** Users authenticate. Profiles participate. **Objects belong to profiles.** An object's owner is a profile reference, stable across claiming; the account appears as authorship, delivery, dedup and authentication — never as ownership. Every object also records the human who acted, and **that record is never consulted for permission**.
>
> **`O-R4`** — `events` gains `owner_profile_id`: authority, exactly one, never null, **any profile type**. `venue_profile_id` is *location*. `host_id` is *authorship*. Three concepts, three columns. **There is no `host_profile_id`** — naming authority for one participant role would assert every event has a host, which is false for venue-run nights, imports with an unknown promoter, and Festival.
>
> **`O-R6`** — **every event has exactly one accountable owner.** No ownerless event exists. Studio resolves an owner before import, creating an unclaimed profile where necessary, and **holds a listing for review rather than importing it ownerless**. Subsystems ask *who owns this event*, never *does this event have an owner*.
>
> **`owner_profile_id` is stable in normal operation and correctable by exception** — §O3's *"written once at creation"* describes persistence, not immutability. See `docs/architecture/errata.md` **E2** and Phase 13 `Q6`. Correction is audited, atomic, and post-claim requires consent or adjudication.
>
> **`O-R1`** — the active profile determines **nothing**. `can_act_as()` remains the sole authorization mechanism. Test: switching the active profile changes nothing about who can manage any event.

The `.html` files are authoritative. The `.md` files beside them are mechanically-converted reading copies — never cite one. Known errors in the frozen text are recorded in `docs/architecture/errata.md` and are **not** corrected in place.

Work against them is **implementation only**. Do not propose alternatives, redesigns, or "cleaner" identity models. They change *only* via a versioned amendment (v1.2+), and *only* if implementation uncovers a **genuine contradiction or an unrepresentable state** — preference, taste and optimisation do not reopen them.

If you believe you have found a contradiction: **stop and surface it.** Do not route around it.

## Migration status — verified against the repository, 4 Aug 2026

**Resumed 18 Jul 2026 by the owner.** The soak period has ended.

⚠ **This section previously said "M6 is the active milestone; M7 and M8 remain not
started." That was written on 18 Jul and the repository has long since overtaken it.**
Every claim below was checked against migrations, code and evidence documents rather
than carried forward.

**M0–M5.1 complete.** M5.5's three migrations are authored (`m5_5a/b/c`, 18 Jul) but
carry **no verification-evidence document** — treat the Personal census as unconfirmed
rather than done.

**M6's seam is installed and in use.** `20260718000003_m6a_can_act_as.sql` creates
`public.can_act_as(uuid)`, and **14 migrations depend on it**. The seam is no longer a
thing being retrofitted; it is the thing newer policies are written against.

**M7 has not started.** No migration, no evidence document — the one milestone in the
sequence with nothing behind it. Work has proceeded *around* it, not through it.

**M8's messaging body shipped.** `m8a`–`m8h` (20 Jul) build conversations, RLS,
conversation creation, read state, the notification bridge and direct messages, all
routing authorization through `can_act_as`. M9–M13 go further still: message kinds,
voice, image, file, HD originals, the Hand, participant state, seen watermark, delivery
ack. **What has NOT happened is M8's contraction** — M4's **9 executable** inline
`auth.uid()` policies are still in place, so `can_act_as` is not yet sole authority.
That, and not the messaging build, is what M8 still owes.

Also shipped, and absent from any earlier milestone framing: notifications
(N1/N3/N4/NP1), push (MP1/MP4b/MP5b), analytics (A1/A2), claims (C1), reactions (MR1),
follows (F1), and the August requirements-engine track (PA1/P4/P5/PA3).

⚠ **`supabase/migrations/` is not an applied-state record.** Headers self-declare, and
several read `NOT APPLIED` while their features demonstrably work live. There is no
checked-in schema baseline, and no CI enforcement exists — `.github/workflows/` and
`identity-debt.json` are both absent despite `docs/identity-ci-spec.md` describing them.
Verify against the database before trusting any file's header.

**`U4` is decided (18 Jul 2026), and this is the operative statement of it.** For ambiguous historical applications: **infer the sender profile only where the user owns exactly one profile of the applicable type; leave every other row `NULL`.** M7 exempts pre-cutover rows from the not-null assertion.

This is derivation with a single candidate, not inference from context — v1.1 §A10 forbids a backfill that *guesses*, and a single-candidate derivation does not guess. **Where more than one candidate exists the row stays `NULL` and no heuristic is applied**: not most-recent-profile, not most-active, not best-match. v1.1 is explicit that this history is unrecoverable, and a plausible reconstruction is worse than an honest null.

**R3.2 is deferred on an observation gap, not a design gap.** The restrictive policy binding attribution to `can_act_as()` is written nowhere and must not be applied until a **real client write carrying `from_profile_id` has been observed end to end**. The resolver is proven for every account and all seven write sites are cut over. Applying the policy first would reject exactly the writes it is meant to validate. This does not block Phase 13.

**The gap is now partly closed, and the halves are not interchangeable.** A real client
follow of an unclaimed profile was observed in production on 20 Jul stamping
`from_profile_id` correctly and producing a held `new_follower` row
(`docs/verification-held-notification-production-2026-07-20.md`) — that is the
end-to-end observation the deferral was waiting for, **for the follows path only**. The
`applications` path has still never been observed: no application has been created since
the 18 Jul cutover. **Do not apply the restrictive policy to `applications` on the
strength of the follows observation** — one path proving out says nothing about the
other, which is the whole reason the gate is an observation rather than an argument.

Still blocking, and unchanged by the resumption:

- **M5.5** — the Personal profile census. Every account must own exactly one before `from_profile_id` can be `NOT NULL` (v1.1 §A10). Migrations authored; **coverage never verified.** Confirm before sizing it.
- **`U2`** — now blocks public launch rather than M8 (v1.2 §B2). Legal input still required.
- **`U3`, `U5`, `U6`** — unchanged.

---

## Notification dismissal — implemented, statically verified, not yet live-verified

Recorded at three distinct levels of confidence, because they are not the same claim and
collapsing them is how "built" comes to mean "shipped and working".

**Implemented in code** (`3a9c1b8`, `c58bdd4`). `notifications.dismissed_at` plus a
partial index; all four readers exclude dismissed rows; a dismiss control on every row
not awaiting a decision; `responded_at` now persisted. UPDATE is narrowed by column
grant to `read`, `dismissed_at`, `responded_at` — RLS cannot restrict which columns an
UPDATE touches, and a record its recipient can rewrite is not evidence.

**Statically verified.** Full suite 628 tests / 615 pass (the 13 failures are the
pre-existing `--experimental-test-module-mocks` loader faults, not product logic); build
clean; `no-undef` clean. The reader contract is enforced by a drift guard in
`apps/scene/src/lib/notificationReaders.test.js` alongside `to_user_id` and `suppressed_at`, and
was **mutation-checked** — reverting any single filter fails the guard and names the file.

**NOT yet verified against the production database.** Nobody has dismissed a real row and
confirmed it vanishes from bell and screen while surviving in the table, nor answered an
offer and confirmed the buttons stay gone after a reload. **Until that is done this
feature is not complete**, whatever the tests say — see the standing lesson that a
renderer with nothing feeding it is not a built feature.

⚠ **Ordering: apply the migration BEFORE this client code ships.** The readers filter on
`dismissed_at`; until the column exists every notification query 400s and both surfaces
go empty.

**Dismissal is not deletion, and there is deliberately no DELETE policy.** The row is
hidden, never destroyed — the same choice `N1` makes for held rows and `NP1` for muted
ones. This matters more since SEC-1: a forged notification is the only evidence of the
attempt, and deletion would spend that evidence to clear the annoyance. **This supersedes
backlog `S39`'s premise** — the requirement is removal from view, not destruction of the
record.

## Security status — verified against live policies, 4 Aug 2026

**SEC-1 is confirmed and MEDIUM, not HIGH.** `notifications` INSERT is
`with_check (auth.role() = 'authenticated')` with nothing tying the row to its writer, so
any authenticated user can address a notification to anyone with arbitrary `type`,
`message` and `data`. Forgery is real. **But the confused-deputy escalation is refuted:**
both sinks are ownership-scoped — `performances` UPDATE by `lineup_members.artist_id` or
`events.host_id`, `applications` UPDATE by `auth.uid() = artist_id` — so a victim's tap
cannot reach rows they do not already control. Residual harm is spoofing, attacker-chosen
state flips inside the victim's own authority, and push amplification. **Blocks public
deployment; does not block development.**

Constraining the INSERT requires **auditing all 11 `writeNotification` call sites first**:
most ignore the return value, so a tightened policy would fail *silently* at the point of
write.

**Separately — and probably more important — `performances` RLS keys entirely on
`events.host_id`, which is always NULL for imported events.** Neither policy references
`owner_profile_id`. Imported events therefore have structurally unmanageable lineups, and
claiming does not fix it: claiming sets `profiles.user_id`, not `events.host_id`. This is
the "`owner_profile_id` is write-only" problem surfacing in the authorization layer.
**Track it as its own architecture task — it is not a notifications fix**, and folding the
two together would make both harder to reason about and test.

## Milestone checkpoints regenerate this file from the repository

Before any milestone is called complete, **regenerate a project-state report from the
repository** — commits, migrations, code, tests, evidence documents — and reconcile it
against this file and `docs/`.

The section above was wrong for roughly two weeks because it was a hand-maintained claim
with nothing checking it, while the migrations moved on without it. A report re-derived
from source cannot drift, because it is re-derived. Treat each such report as a
checkpoint, and **prefer the repository over any handover** wherever the two disagree.

---

## Identity — the one sentence

> **Attribution** determines who an action *appears to come from*.
> **Authorization** determines who is *allowed to perform it*.

Different concepts. **Never the same column, the same check, or the same source of truth.**

## The identity contract

Any feature that lets a user create, send, modify or publish something **on behalf of a profile** must satisfy all three. Answer them against the diff, not against intent:

1. **Does the row name its actor?** — a profile column, non-null, **stamped at the moment of the write**
2. **Does the row name the human?** — a user column, for auth, audit and notification delivery
3. **Does authorization go through the seam — and only the seam?** — `can_act_as()`, never inline, **never the active profile**

A row with only a user *cannot name its sender*. A row with only a profile *cannot be authorized or audited*. Both, always.

## Hard rules

- **Never write `owner_user_id = auth.uid()` (or equivalent) inline in a policy.** Ownership is tested through exactly one predicate: `can_act_as(profile_id)`.
- **`can_act_as(profile_id)` is a frozen interface.** Name and signature never change; the body evolves. It is the only thing in this architecture declared permanent.
- **Attribution must itself be authorized.** A profile column is writable *only* where `can_act_as(<that profile>)` is true. Otherwise a client can claim to act as a venue it does not own — **forgeable attribution is worse than none.**
- **The active profile is UX state.** Client-stored, untrusted, a hint. It sets attribution and nothing else. A tampered value must change **only a label**.
- **Attribution is stamped at write time** — never earlier, never later. A draft has no attribution because it has not been sent. A written row is never re-attributed by a later switch.
- **Conversations belong to profiles**; every message records its human author. One model for every thread — there is no separate "commercial messaging".
- **Personal (`type='punter'`) is system-generated and inalienable** — never claimed, never transferred, **never publicly discoverable**. Its discovery filter belongs in **one resolver** (`apps/scene/src/lib/profileResolution.js`). Do not copy-paste `.neq('type','punter')` into a new query.
- **V1 is single-owner.** The word "manage" is not part of this architecture. Do not build multi-manager, delegation or roles.
- **Never key identity on `user_id`-as-identity.** `profile.id` is the permanent public identity; `user_id` routing is legacy and being retired.

## Known live faults — do not replicate the pattern

- `applications.artist_id` holds a **user id with no profile column**. A multi-profile artist's application cannot record which profile applied. Historical rows are **unrecoverable**. This is the exact fault the contract exists to prevent — do not add another table like it.
- `follows` is account-scoped, so a venue owner's personal follows pollute the venue's roster. Fixed at M6 by *adding* a profile column, **not** by moving the user column (which would break notification dedup).
- `supabase/migrations/20260711000005_m4_rls_migration.sql` shipped with **7 inline `auth.uid()` checks and no `can_act_as`** (`fix2` adds 2 more; 9 across all migrations). It is additive-permissive, so the debt is bounded and provisional — the seam retrofits at M6 and becomes sole authority at M8. **Do not add to that debt.** *(v1.1 §A10 says 13 — it counted comments. Frozen, so it stands; see `docs/architecture/errata.md` E1.)*

## Conventions

- Existing tables carry the pair under **table-specific names** (`venue_enquiries.applicant_profile_id`, `lineup_members.artist_profile_id`, `events.venue_profile_id`). These are correct and are not renamed. **New tables use the canonical `from_profile_id` / `from_user_id`.**
- Tables for **account-level** actions (claims, signup, sessions, settings, billing) take a user column **only** — no profile. You claim a profile *as a person*, not as a profile.

## Design principles

Cross-cutting UX standards live in `docs/design-principles.md`. Currently:
- **Date/time selection is picker-only** — all dates, times and date-ranges are chosen through a standardised picker (or one-tap presets); no free-text date/time entry. A bare native `<input type="date">` does not satisfy this on its own (it still allows typing). Native date/time controls also carry `color-scheme: dark`.
