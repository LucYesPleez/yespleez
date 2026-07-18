> # ⚠ PROPOSAL — NOT RATIFIED · NOT CANONICAL · NOT BINDING
>
> A proposed amendment. Identity v1.0, v1.1 and v1.2 remain canonical and unchanged until this is
> ratified as `identity-v1.3.html`. No code, no migrations, no schema, no RLS, no Studio changes.
>
> Section numbers use the prefix **`O`** (ownership), unused by any other document in this
> directory. Rule numbers elsewhere are untouched.
>
> Status: **PROPOSED** — 18 Jul 2026 · complete rewrite, superseding the 18 Jul draft.

YesPleez v2 · Architecture Amendment (proposed)

# Identity Architecture v1.3 — Ownership that survives claiming

**Status** PROPOSED **Amends** `architecture-v1.0` §03 (event authorization basis)
**Change control** v1.0 §17 **Bar** v1.0 §00 — unrepresentable state

---

## §O0 — What this amendment claims, and what it does not

**It does not claim that any existing architecture is mistaken.** Specifically:

- **v1.0 §03 is correct.** It deliberately chose account-based authorization for events —
  *"authorisation (who may manage the event) remains account-based; public attribution … is
  profile-based via `venue_profile_id`."* That was a decision, not an oversight.
- **v1.1 §A3 is correct.** Its audit records that `events` carries the pair *"in a differently-named
  form (`host_id` + `venue_profile_id`) as a result of §03's split."* That is an accurate
  description of the live schema, then and now.
- **v1.1 §A4 is correct**, including its rejection of *"the active profile determines ownership of
  everything."* §O3 shows this proposal is not that formulation.

This amendment exists because **a capability the platform now requires cannot be expressed** under
the current model — not because the current model was built wrong. §O1 states that capability
precisely and §O2 explains why it was not visible when §03 was written.

---

## §O1 — The bar

v1.0 §00 permits architectural change *"solely if implementation uncovers a genuine blocker"*, which
v1.1 §A1 sharpened to a **contradiction or an unrepresentable state**. This amendment rests on the
second, and on nothing else.

> **◆ The unrepresentable state**
>
> **The architecture cannot express ownership that survives claiming.**
>
> It cannot record, of an event, that *whoever later claims this profile will hold authority over
> it* — because authority is bound to an account identifier, and at the moment of creation there is
> no account to name.

### What the blocker is not

Two adjacent statements are **not** the blocker, and stating them would overclaim:

- **Not** "an event cannot exist without an account." It can. `events.host_id` is nullable
  (verified — §O4), so a row with no host inserts today.
- **Not** "an unclaimed profile cannot be referenced." It can. `venue_profile_id` already points at
  profiles regardless of claim status, and all 24 live events populate it.

The gap is narrower and sits entirely in **authority**. An event created with `host_id = NULL` is
representable and permanently **inert**: every policy resolves `host_id = auth.uid()`, `NULL` matches
nobody, and claiming the venue changes nothing because no policy consults `venue_profile_id`. The row
exists; the *relation that would later grant authority* has nowhere to live.

### Why this is a blocker rather than an inconvenience

The only way to deliver the capability under the current model is to write `host_id` **after** the
claim — which is ownership migration, performed at the moment the system learns who the owner is.

That is precisely the operation that must not be required, and the project has just measured its
cost. `U4` had to decide how to re-derive senders for twelve historical applications; for two of
them **the answer was not recoverable at any price**, because the row never contained it. Ownership
assigned retroactively has the same failure mode, on a catalog rather than a dozen rows, and with a
worse consequence: an application with a null sender is an imperfect record, while an event with a
null owner is **a live object nobody can manage**.

---

## §O2 — Why §03's decision was right, and what changed

§03 addressed a real fault: `events.host_id` was serving two roles at once. Its fix — split the
column, keep authorization account-based, make public attribution profile-based via
`venue_profile_id` — was correct for the system it governed.

**In that system, every event had a human at creation.** Events were created in the app by a
signed-in host. There was no path by which an event could exist before its owner did, so binding
authority to the creating account lost nothing and gained a check that was simple, obvious and
cheap.

**Studio introduces the first events that exist before their owner.** An imported listing is
attributed to a venue that has never signed up and may never do so. This is new information about
the world the architecture must model, not a defect discovered in how it modelled the old one.

> §00's bar asks whether implementation *uncovered* something. It did — but the finding is a **new
> requirement**, not a latent error. That distinction matters for how this document should be read:
> nothing below corrects anything above it.

---

## §O3 — Reconciliation with §A4

v1.1 §A4 rejects *"any formulation resembling 'the active profile determines ownership of
everything'"*, on the grounds that it re-conflates what §03 separated. **That rejection is correct
and this amendment does not contradict it.** The distinction is not a technicality, and an
implementer must be able to see it immediately.

| | §A4 rejects | §O5 proposes |
|---|---|---|
| **What decides authority** | The **active profile** — R6 UX state | A **stored column** — `host_profile_id` |
| **Where it lives** | Client-held, per-session, changes on a switcher | Persisted on the row, written once at creation |
| **Trust** | Untrusted by definition (v1.1 R6) | A database fact, subject to R3.2 at write time |
| **Read at check time** | Yes — the check would consult a client selection | **No.** The check consults the row and `can_act_as` |

> **◆ `O-R1` The active profile determines nothing**
>
> `can_act_as(profile_id)` remains the **sole** authorization mechanism (v1.1 §A4, R3). The active
> profile is not an input to it, is never consulted by a policy, and cannot influence who may manage
> an event.
>
> **The distinguishing test:** switching the active profile changes *nothing* about who can manage
> any event. If a proposed implementation fails that test, it is the formulation §A4 rejects and it
> must be refused.

> **◆ `O-R2` §03's principle is preserved, not reversed**
>
> §03's rule is *"one column never again does both jobs."* This amendment keeps three columns doing
> three distinct jobs:
>
> | Column | Job |
> |---|---|
> | `host_profile_id` | **Owns** — the sole authorization anchor |
> | `host_id` | **Records the human** who created it — never consulted for permission |
> | `venue_profile_id` | **Locates** — where the event happens |
>
> What changes is *which kind of identity the authorization column holds*, not how many jobs a
> column does. §03 separated authorization from attribution; this keeps them separated and moves
> only the former onto a stable identifier.

---

## §O4 — Verified facts

Established against the live database, 18 Jul 2026. Stated here because the amendment's shape
depends on them.

| Fact | Value | Consequence |
|---|---|---|
| `events.host_id` nullable | **YES**, no default | No column alteration needed. An ownerless row is already insertable. |
| `events.venue_profile_id` nullable | **YES**, no default | The venue link is optional at the schema level. |
| Events with `venue_profile_id` populated | **24 of 24** | **No venue backfill required.** |
| `host_profile_id` exists | **No** | The single column this amendment adds. |
| Authority resolved via | `host_id = auth.uid()` — confirmed in the `applications` policies | The policy surface this eventually moves to `can_act_as`. |

*(The `events` policies themselves have not been read — the authority basis is established from the
`applications` policies that join to `events`. Enumerating them is a prerequisite of implementation,
not of ratification.)*

---

## §O5 — The amendment

> **◆ `O-R3` Objects belong to profiles**
>
> **Users authenticate. Profiles participate. Objects belong to profiles.**
>
> An object's owner is a **profile reference**, held on the object and stable across claiming. The
> account appears as authorship, delivery, dedup and authentication — never as ownership.
>
> **Every object also records the human who acted, and that record is never consulted for
> permission.** Ownership moves to the profile; authorship stays with the human. Dropping the
> second clause would trade one loss for another: accountability for *who actually did this*.

> **◆ `O-R4` Applied to events**
>
> `events` gains **`host_profile_id`** — the owning profile, and the sole input to authorization.
> `host_id` is retained unchanged as the human record.
>
> An imported event sets `host_profile_id` to the venue's profile whether or not that profile is
> claimed. `can_act_as()` returns false for an unclaimed profile (v1.1 §A9; implemented at M6a),
> so nobody can act on it — correctly — until it is claimed.

> **◆ `O-R5` Claiming grants authority without ownership migration**
>
> Claiming sets `user_id` on the profile (v1.0 §07 — attach is three fields, atomic).
> `can_act_as(host_profile_id)` becomes true in the same instant, and every object already
> attributed to that profile becomes manageable.
>
> **No row is rewritten.** This is not an optimisation of migration; it is the absence of migration,
> and it is the whole point of the amendment.

### Scope

**`events` only.** Per v1.1 §A3's audit and M6's work, every other profile-actionable table already
carries a profile reference. `events` is the last object whose *authority* is account-based, which
is what keeps this amendment to one column.

Unchanged and deliberately so: `profiles.user_id` (the claim link — definitionally an account), and
every `*_user_id` delivery, dedup or authorship column.

---

## §O6 — Assessment

**1 · Should `host_id` become `host_profile_id`?** No — **add alongside**. Renaming would destroy
the record of which human created an event, and `O-R2` requires one column per job. Since `host_id`
is nullable already (§O4), adding is purely additive.

**2 · Should other ownership fields convert?** No. §O5's scope paragraph — `events` is the last one.

**3 · Does this conflict with existing RLS or workflow?**

*RLS:* no conflict, a **scheduled change**. Moving authority to `can_act_as(host_profile_id)` is the
same operation R3.2 performs on `applications` and `follows`. Landing them together avoids rewriting
and re-verifying event policies twice.

*Workflow:* one real consequence, not a conflict. An event owned by an unclaimed profile **has no
human behind it** — no notification delivery identity (§A7 delivery is a user), no messaging route
(communication draft `C17`), and applications arriving for nobody to read. These are the true shape
of "an event exists before its owner does" and need a stated rule (§O9 `Q1`).

**4 · Consistent with v1.2?** Yes. §A14 untouched; `can_act_as` remains sole authority; §A9's
Personal exception (an account with no entity) is the mirror of what this permits (an entity with no
account) — both directions were always in the model.

**5 · Does it simplify what follows?**

| Area | Effect |
|---|---|
| **Studio import** | Decisive — imports reference an identifier that is stable from creation. No placeholder accounts, no system user, no post-claim fixup. |
| **Claiming** | Becomes a no-op for ownership (`O-R5`). |
| **Messaging / notifications** | Neutral. Conversations already belong to profiles (§A5) and the three notification identities (§A7) already separate subject, recipient and delivery — an unclaimed owner is representable, it simply has no delivery leg. |
| **Workflow ownership** | One axis. A venue hosting its own night and a promoter hosting at that venue become the same shape. |

---

## §O7 — Documents affected

| Document | Change |
|---|---|
| **`identity-v1.3.html`** (new) | This amendment, on ratification |
| **`architecture-v1.0`** §03 | The **authorization basis** clause for events is superseded. §03's separation principle is preserved (`O-R2`); only the identity kind of the authority column changes. |
| **`identity-v1.1`** §A3 | **No change.** Its audit remains accurate; the events row describes what was true and stays true until implementation. |
| **`identity-v1.1`** §A4 | **No change.** §O3 reconciles rather than amends. |
| **`README.md`** | Canonical table; the reading rule becomes four documents |
| **`CLAUDE.md`** | Operative statement of `O-R3`; events in scope for R3.2 |
| **`publication-v1.0-draft`** §P8 | An imported event starts `PRIVATE`. "Imported" must never imply "listed". Consistent; worth stating when Studio import is specified. |
| **`communication-v1.0-draft`** | An unclaimed owner has no delivery identity — relates to §O9 `Q1` |
| **`docs/unclaimed-host-assessment-2026-07.md`** | Absorbed; delete on ratification |

---

## §O7b — Governance impact

**What kind of change this is.** The first amendment to supersede a clause of `architecture-v1.0`
on grounds other than an internal contradiction. v1.1 superseded §01, §03 and §05 because v1.0
contradicted itself (§A1's `B1`, `B2`). This supersedes §03's *authorization basis* because a new
requirement cannot be expressed — §00's other limb. **The precedent it sets is narrow and should
stay narrow:** a new product capability justifies amendment only when the capability is
unrepresentable, never when it is merely awkward.

**Canonical set becomes four.** v1.0 + v1.1 + v1.2 + v1.3, each binding except where a later one
names a clause. The README's reading rule extends accordingly:

- v1.0 binding except clauses **v1.1 §A2** lists **and** the event-authorization basis **v1.3
  `O-R4`** supersedes.
- v1.1 binding in full except the §A12 `U2` cell **v1.2 §B2** supersedes. **v1.3 changes nothing in
  v1.1** — §A3 and §A4 are reconciled, not amended.

**Citation interface.** v1.3 introduces prefix **`O`** (`O-R1`–`O-R5`, §O0–§O11), unused elsewhere
in this directory, so no existing citation is ambiguated. Nothing is renumbered anywhere.

**Ratification requires:**

1. Author `identity-v1.3.html` — canonical form is the frozen HTML artifact.
2. Record supersession in `README.md`; canonical table and reading rule to four documents.
3. Regenerate reading copies via `render-markdown.js`; verify existing `.md` files come back
   byte-identical.
4. Update `CLAUDE.md` — `O-R3` as operative statement, events in scope for R3.2.
5. Delete this proposal **and** `docs/unclaimed-host-assessment-2026-07.md`, which this absorbs.
6. Freeze `O-R1`–`O-R5` and §O0–§O11 as a citation interface. Never renumber.

**What ratification does not do.** It does not begin implementation, does not alter M6, and does not
unblock R3.2 — which remains deferred on its own terms until real client writes carrying
`from_profile_id` have been observed.

---

## §O8 — Migration · conceptual only

**Phase 1 · Additive.** `host_profile_id` added, nullable. Nothing reads it. **No column is
altered** — `host_id` is already nullable (§O4), so this phase touches no existing definition and is
safe against a running application, as M6b was.

**Phase 1 also cuts over writes.** Event creation stamps `host_profile_id` from the acting profile
via the existing M6 seam (`actingProfile.js`), so **no event created after phase 1 needs
backfilling**.

**Phase 2 · Backfill.** Derive from `host_id` under `U4`'s rule — infer where the account owns
exactly one host-type profile.

> `U4` cannot be reused wholesale. For an application, a null sender is an inert historical record.
> **For an event, a null owner is a live object nobody can manage.** Ambiguous events must therefore
> be *resolved* — by prompting the owner on next edit, or a one-time reconciliation — never left
> null. State the rule before the backfill runs.

**Phase 3 · Dual authority.** Policies accept `can_act_as(host_profile_id)` **or**
`host_id = auth.uid()`. This is M4's additive-permissive pattern, which v1.1 §A10 endorses precisely
because it makes cutover reversible. Existing flows keep working; imported events become manageable
on claim. **Rides with R3.2.**

**Phase 4 · Contract.** The legacy arm is dropped at M8, leaving `can_act_as` as sole authority —
the consolidation §A10 already schedules. **No new milestone and no new debt**: the transitional arm
is removed by a milestone that already exists.

---

## §O9 — Risks

| # | Risk | Mitigation |
|---|---|---|
| **K1** | **A live event becomes unmanageable** — phase 4 drops the legacy arm before every event has an owner, and a host loses access to their own event. Worse than a failed import: it hits existing users doing nothing wrong. | Phase 4 gates on a census — zero events with a null owner — exactly as M5.5 did. Never the other order. |
| **K2** | **Ambiguous backfill.** An account owning two host profiles has no recorded answer. Unlike `U4`, a null here *is* K1. | Resolve rather than null (§O8 phase 2). Census the scale before writing the backfill. |
| **K3** | **Notifications and applications with no recipient.** An unclaimed owner has no delivery identity, so anything addressed to it goes nowhere. The bad failure is silent: an artist applies, sees success, nobody ever reads it. | Decide hold-vs-suppress before Studio import (§O9 `Q1`); make the artist-facing state honest either way. |
| **K4** | **Orphaned imports** accumulate against profiles nobody claims — owned by no human, accountable to no one. | Product/Ops question. Answer before import runs at scale; may imply a review queue or expiry. |
| **K5** | **Two authority paths during transition** (phases 3–4). Deliberate and bounded, but it is the state §03 warns about. | Removed at M8, a milestone that already exists. The debt has a named end from the outset — unlike M4's inline policies, which acquired one only in retrospect. |
| **K6** | **This is read as reopening §A4.** A reader who sees "objects belong to profiles" without §O3 may reject it as the formulation §A4 refused. | §O3 is placed before the amendment, not after it, and states the distinguishing test explicitly. |

**The risk of not amending** is larger than any row above: Studio imports events whose authority
cannot attach to anyone, and every one of them requires ownership assigned retroactively — the
operation §O1 identifies as unrepresentable-by-design and `U4` has already priced.

---

## §O10 — Open questions

Raised by adversarial self-review, 18 Jul 2026. `Q4`–`Q7` were not in the previous draft and are
not answered by this one.

| # | Question | Blocks |
|---|---|---|
| **`Q1`** | Notifications, applications and messages addressed to an event whose owner is unclaimed — **held until claim, or suppressed?** | Studio import |
| **`Q2`** | Backfill ambiguity: an account owning two host profiles (§O8 phase 2, K2) | Migration phase 2 |
| **`Q3`** | Enumerate the `events` RLS policies — the full authority surface (§O4) | Implementation, not ratification |
| **`Q4`** | **Which profile owns an imported event when a venue *and* a promoter are both identifiable?** `O-R4` says "the venue's profile", but the requirement names *Host and Venue* profiles. If ownership goes to the venue and the promoter later claims their Host profile, the promoter gets nothing — and vice versa. One owner, two plausible claimants. | **Studio import** — it decides what the importer writes |
| **`Q5`** | **Who may publish an unclaimed event?** The publication model starts imported content `PRIVATE` (§P8), and `can_act_as` returns false for an unclaimed owner — so **nobody can advance it**. But a catalog nobody can see defeats the purpose of importing one. Either imports publish without an owner authorising it, or the catalog is invisible until claimed. | **Studio import** — it decides whether the product works |
| **`Q6`** | **Is `host_profile_id` reassignable?** An event imported against the wrong profile needs correction, which is ownership transfer — and v1.1 §A12 `U3` defers transfer as "not a v1 operation". Import makes mis-attribution likely enough that this stops being theoretical. | Studio import at scale |
| **`Q7`** | **Claiming now grants authority over a catalog, not an empty profile.** A wrongful claim yields immediate control of every imported event attributed to that profile. §07 makes claims reversible, but the exposure between claim and reversal is materially larger than it was. Does claim verification need strengthening under this model? | Before import runs at scale |

*(The two questions the previous draft carried are closed: `events.host_id` nullability is verified
in §O4, and the v1.1 §A3 question is void — §A3 is accurate, so no erratum arises.)*

> **`Q5` is the one to answer first.** `Q1`, `Q4`, `Q6` and `Q7` change how Studio is built. `Q5`
> asks whether the imported catalog is visible at all, and a "no" would mean the import pipeline
> produces nothing a user can see — which is worth discovering before it is built, not after.

---

## §O11 — Recommendation

**Ratify before Studio implementation.**

Not as housekeeping, and not because the current architecture is deficient — §O0 and §O2 are
explicit that it is neither. Ratify because **Studio's founding premise is import now, claim
later**, and that premise is only expressible under `O-R5`. Building the importer first means
importing a catalog whose authority cannot attach to anyone, then assigning ownership afterwards —
the exact operation this amendment removes the need for, and the one whose cost `U4` has already
demonstrated on data that no longer contained the answer.

The amendment is small by construction: **one column, one principle, one policy pattern already
scheduled.** It adds no milestone — phase 3 rides with R3.2, phase 4 with M8.

**Answer `Q1` before Studio import ships.** It is the only open question that changes what users
experience, and it is cheaper to decide than to discover.
