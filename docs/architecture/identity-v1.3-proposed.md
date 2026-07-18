> # ⚠ PROPOSAL — NOT RATIFIED · NOT CANONICAL · NOT BINDING
>
> A proposed amendment. Identity v1.1 and v1.2 remain canonical and unchanged until this is ratified
> as `identity-v1.3.html`. No code, no migrations, no schema, no Studio changes.
>
> Status: **PROPOSED** — 18 Jul 2026 · awaiting owner decision.

YesPleez v2 · Architecture Amendment (proposed)

# Identity Architecture v1.3 — Objects belong to profiles

**Status** PROPOSED **Amends** v1.1 (§A3 scope) **Change control** `architecture-v1.0` §17
**Supersedes** nothing yet — see §C6

---

## §C0 — The finding

`events` is the **last account-owned object in the system.**

Verified against live schema, 18 Jul 2026. `events` carries `host_id` — a *user* id — plus
`venue_profile_id`. There is no `host_profile_id`. Live RLS resolves ownership through the account:
the `applications` policies read `events.host_id = auth.uid()` directly.

Every other ownership edge is already profile-based, or became so at M6:

| Table | Owner | Human | Status |
|---|---|---|---|
| `applications` | `from_profile_id` | `artist_id` | ✅ M6 |
| `follows` | `from_profile_id` | `user_id` | ✅ M6 |
| `notifications` | `to_profile_id` / `about_profile_id` | `user_id` | ✅ M6b (columns) |
| `venue_enquiries` | `venue_profile_id` / `applicant_profile_id` | `*_user_id` | ✅ pre-existing |
| `lineup_members` | `artist_profile_id` | `artist_id` | ✅ pre-existing |
| **`events`** | **— none —** | `host_id` | ❌ **account-owned** |

> **⚠ v1.1 §A3 already claims otherwise.** Its table lists `events` as carrying the identity pair
> *"✓ via §03 split"*. The live schema shows that split produced `host_id` + `venue_profile_id` — a
> **host/place** split, not a **profile/user** pair. §A3 is frozen and describes a state that does
> not exist. This needs either an erratum or this amendment; it should not be left as a silent
> discrepancy that a future implementer resolves by guessing which is right.

---

## §C1 — The rule

> **◆ Promoted to a §01 principle**
>
> **Users authenticate. Profiles participate. Objects belong to profiles.**
>
> No object is owned by an account. Ownership is a profile reference; the account appears only as
> authorship, delivery, dedup, or authentication.

This is not a new idea — it is v1.1's attribution principle carried from *"who did this"* to
*"whose is this"*. v1.1 §A4 separated attribution from authorization. v1.3 states that **ownership
follows attribution, never authentication.**

### Why the owner must be the profile, not the account

An account is a login. It can be deleted, shared, recovered, or created after the fact. A profile is
the thing the industry recognises — a venue exists whether or not anyone has signed up for it. Tying
ownership to the login means an object cannot exist before its owner has an account, which is
precisely what blocks Studio.

---

## §C2 — Assessment

### 1 · Should `events.host_id` become `host_profile_id`?

**Add, do not rename.** The canonical shape is v1.1 §A3's pair:

- **`host_profile_id`** — the owner. Sole input to authorization.
- **`host_id`** — the human who created it. Record only; never consulted for permission.

Renaming would destroy the record of which human created an event. Adding a second *ownership*
column would recreate the §03 fault. The pair avoids both: one column owns, one column remembers.

`host_id` must become **nullable** if it is not already (**unverified — confirm before ratifying**).
An imported event owned by an unclaimed venue has no human host, and that is the whole point.

> This is the §A6 follows precedent, for the same reason: split, never move.

### 2 · Other fields to convert

**None.** Per §C0, `events` is the only remaining account-owned object. That is what makes this
amendment small — it closes the last gap rather than opening a programme.

Two adjacent things deliberately stay as accounts: `profiles.user_id` (the claim link — a profile's
*owner-human*, which is definitionally an account) and every `*_user_id` delivery/authorship column.

### 3 · Conflicts with RLS and workflow

**RLS — one conflict, and it is already scheduled.** Authorization resolves `host_id = auth.uid()`
in at least the two `applications` policies. Moving to `can_act_as(host_profile_id)` is *the same
operation* R3.2 performs on `applications` and `follows`: replace an inline `auth.uid()` check with
the seam.

> **Sequencing consequence.** Event ownership should land **with R3.2**, not before or after.
> Both rewrite the same policies. Doing them separately means rewriting event policies twice and
> paying the verification cost twice.

*(Pending: the `events` policies themselves have not been read. The conflict is established by the
`applications` policies, but the full blast radius needs `pg_policies` for `events`.)*

**Workflow — one genuine consequence, not a conflict.** An event owned by an unclaimed profile
**has no human behind it**:

- **Notifications** (§A7) carry a delivery identity that is a *user*. An unclaimed owner has none, so
  a notification to that event's host has nowhere to go.
- **Messaging** — the communication draft's `C17` gives no route to an unclaimed profile, correctly.
- **Applications** to such an event would arrive for nobody to read.

These are not defects of this model; they are the true shape of "an event exists before its owner
does". They need a stated rule — **hold or suppress** — which §C5 lists as the open question.

### 4 · Consistency with v1.2

**Consistent, and largely already implied.** v1.2 §A14 is untouched. v1.1 §A4's `can_act_as` is the
sole authorization predicate and stays so. §A9's Personal exception (an account with no entity) is
the mirror of what this permits (an entity with no account) — the model already has both directions;
only one was implemented.

**The one honest wrinkle:** §A3 already asserts events carry the pair (§C0). If that assertion is
read as intent, this amendment *implements* v1.1 rather than amending it, and could be an erratum
plus an implementation milestone. If read as a claim of fact, it is wrong and needs superseding.
**That reading is the owner's to make** — it decides whether this is v1.3 or `errata.md` E2.

### 5 · Does it simplify what comes next?

| Area | Effect |
|---|---|
| **Studio import** | Decisive. Imports against a profile id that is stable from creation. No placeholder accounts, no "system user", no post-claim fixup. |
| **Claiming** | Becomes a no-op for ownership. Setting `user_id` on the profile flips `can_act_as` to true and every object already attributed to that profile becomes manageable **in the same instant**. This is the stated goal, and it falls out rather than being engineered. |
| **Messaging** | Neutral-to-positive: conversations belong to profiles (§A5) and would now match event ownership. Gains the unclaimed-recipient question above. |
| **Notifications** | Same. The three identities (§A7) already separate subject/recipient/delivery, so an unclaimed owner is representable — it simply has no delivery leg. |
| **Workflow ownership** | One axis everywhere. A venue hosting its own night and a promoter hosting at that venue become the same shape: `host_profile_id` owns, `venue_profile_id` locates. |

---

## §C3 — A refinement to the proposed rule

The rule as given is sound. One clause should be added, because omitting it loses something v1.1
fought for:

> Objects belong to profiles. **Every object also records the human who acted**, and that record is
> never consulted for permission.

Without the second sentence, "objects belong to profiles" reads as licence to drop user columns, and
accountability for *who actually did this* goes with them. v1.1 §A3's pair exists precisely so both
survive. The amendment is stronger stated as **ownership moves; authorship stays**.

**No better model was found.** One alternative was considered and rejected: a generic
`owner_profile_id` on every object instead of domain names like `host_profile_id`. It would unify
Festival and Studio objects under one column name, but it erases the domain role — an event's owner
*is* its host, and flattening that costs more in readability than it saves in symmetry.

---

## §C4 — Documents affected

| Document | Change |
|---|---|
| **`identity-v1.3.html`** (new) | This amendment, on ratification |
| **`identity-v1.1`** §A3 | Its events row is inaccurate — superseded here, or corrected via `errata.md` (§C2.4) |
| **`README.md`** | Canonical table, three-document reading rule becomes four |
| **`CLAUDE.md`** | Operative statement: the ownership rule, and that events are in scope for R3.2 |
| **`publication-v1.0-draft`** | §P8 — an imported event starts `PRIVATE`; "imported" must never imply "listed". Consistent, but should be said. |
| **`communication-v1.0-draft`** | §4.5 — an unclaimed owner has no delivery identity. Add to `D17`-adjacent open questions. |
| **`docs/unclaimed-host-assessment-2026-07.md`** | Absorbed; delete on ratification |

---

## §C5 — Open questions

| # | Question | Blocks |
|---|---|---|
| **E1** | Is `events.host_id` nullable today? | Ratification — an imported event has no human host |
| **E2** | v1.3 or erratum? (§C2.4) — is §A3's events row intent or error? | Ratification; decides the instrument |
| **E3** | What happens to notifications, applications and messages addressed to an event whose owner is unclaimed — held until claim, or suppressed? | Studio import |
| **E4** | Backfill ambiguity: an account owning two host profiles. Unlike `U4`, a NULL here leaves a **live event unmanageable**. | Migration (§C6) |

---

## §C6 — Migration strategy · conceptual only

Four phases, each independently verifiable, none reversible-by-accident:

**1 · Additive.** `host_profile_id` added, nullable, no behaviour change. Nothing reads it. Safe
against a running app, exactly as M6b was.

**2 · Backfill.** Derive from `host_id`, using the `U4` rule — infer where the account owns exactly
one host-type profile.

> **`U4` cannot be reused wholesale, and this is the sharp edge.** For applications, a NULL is an
> unattributed *historical record* — regrettable but inert. For an event, a NULL is a **live object
> nobody can manage**. Ambiguous events must therefore be *resolved*, not left null: by prompting
> the owner to assign one on next edit, or by a one-time owner-facing reconciliation. The scale is
> almost certainly trivial (2 of 18 accounts own multiple performer profiles; host profiles are
> rarer) but the rule must be stated before the backfill runs, not discovered by it.

**3 · Dual-authority policies.** Policies accept `can_act_as(host_profile_id)` **OR**
`host_id = auth.uid()`. This is M4's additive-permissive pattern, which v1.1 §A10 endorses precisely
because it makes cutover reversible. Every existing flow keeps working; new imported events become
manageable on claim.

**4 · Contract.** The legacy arm is dropped at M8, leaving `can_act_as` as sole authority — the
consolidation v1.1 §A10 already schedules for M8. **No new debt is created**: this arm is removed by
a milestone that already exists, rather than adding one.

**Writes cut over with phase 1** — `CreateEventScreen` stamps `host_profile_id` from the acting
profile (`actingProfile.js`, the M6 seam), so no event created after phase 1 needs backfilling.

---

## §C6b — Risks

Ordered by what they would actually cost, not by likelihood.

| # | Risk | Mitigation |
|---|---|---|
| **R1** | **A live event becomes unmanageable.** If phase 3's dual-authority policy is mis-written, or phase 4 drops the legacy arm before every event has a `host_profile_id`, a host loses access to their own event. This is the worst outcome here — worse than a failed import, because it hits existing users doing nothing wrong. | Phase 4 gates on a census, exactly as M5.5 did: zero events with a NULL owner before the legacy arm is dropped. Never the other order. |
| **R2** | **Ambiguous backfill (`E4`).** An account owning two host profiles has no recorded answer for which one owns a given event. Unlike `U4`, a NULL is not inert — it is R1. | Resolve rather than null: prompt the owner on next edit, or a one-time reconciliation. Scale is expected to be tiny; verify with a census before writing the backfill, not after. |
| **R3** | **Orphaned imports.** Studio imports events against a venue profile nobody ever claims. They accumulate, owned by a profile with no human, invisible to moderation because nobody is accountable for them. | A product/Ops question, not architectural — but it should be answered before import runs at scale, because the answer may imply an expiry or review queue. Related to publication `§P8`. |
| **R4** | **Notifications and applications with no recipient (`E3`).** An unclaimed owner has no delivery identity, so anything addressed to it goes nowhere. Silently dropping them is the bad failure mode: an artist applies, sees success, and nobody ever reads it. | Decide hold-vs-suppress before Studio import, and make the artist-facing state honest either way. |
| **R5** | **Two ownership axes during transition.** Between phases 1 and 4, `host_id` and `host_profile_id` both exist and both grant authority. That is deliberate and bounded, but it is exactly the state §03 warns about. | The dual arm is removed at M8, a milestone that already exists. No new milestone, and the debt has a named end — unlike M4's inline policies, which acquired one only in retrospect. |
| **R6** | **§A3 discrepancy is resolved by guesswork.** If `E2` is left undecided, a future implementer reading §A3 will reasonably assume `host_profile_id` already exists and write code against a column that is not there. | Answer `E2` at ratification. Whichever way it goes, record it — v1.3 or `errata.md` E2. |

**The risk of *not* doing this** belongs in the same table and is larger than any row in it: Studio
imports events against accounts that do not exist, and every one of them needs its ownership
re-derived after the fact. `U4` has just shown what re-derived ownership costs when the data no
longer contains the answer — and that was twelve rows, not a catalog.

---

## §C7 — Recommendation

**Ratify before Studio implementation.** Not because Studio is blocked on paperwork, but because
Studio's core premise — import now, claim later — is *only* true under this rule. Building the
importer first means importing events that reference accounts which do not exist, then reassigning
ownership afterwards. That reassignment is the exact operation the amendment exists to make
unnecessary, and `U4` has just demonstrated what re-derived ownership costs when the data no longer
contains the answer.

The amendment is small: **one column, one principle, one policy pattern already scheduled.** It adds
no milestone — phase 3 rides with R3.2, phase 4 with M8.

**Answer E1 and E2 first.** Both are cheap, and E2 decides whether this is an amendment at all.
