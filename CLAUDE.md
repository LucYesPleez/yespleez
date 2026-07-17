# YesPleez — engineering rules

Read this before touching anything. It is short on purpose.

## Orientation — edit the right files

| Path | What it is |
|---|---|
| `v2/` | **The live app.** React + Vite + Supabase. All work happens here. |
| `app.js`, `follows.js`, `events.js`, `auth.js`, … *(repo root)* | **Retired v1 (vanilla JS). Do not edit.** Root has files with the same names as live v2 modules — check your path before editing. |
| `docs/` | Design reviews, migration plans, verification evidence |
| `supabase/migrations/` | Applied migrations. Never edit a migration that has shipped. |

## Governance — the architecture is frozen

Two documents are canonical **together**, and both are frozen. They live in **`docs/architecture/`** — read them there, not from memory:

- **Architecture Specification v1.0** (10 Jul 2026) — `docs/architecture/architecture-v1.0.html`
- **Identity Architecture v1.1** (ratified + frozen 17 Jul 2026) — `docs/architecture/identity-v1.1.html`

The `.html` files are authoritative. The `.md` files beside them are mechanically-converted reading copies — never cite one. Known errors in the frozen text are recorded in `docs/architecture/errata.md` and are **not** corrected in place.

Work against them is **implementation only**. Do not propose alternatives, redesigns, or "cleaner" identity models. They change *only* via a versioned amendment (v1.2+), and *only* if implementation uncovers a **genuine contradiction or an unrepresentable state** — preference, taste and optimisation do not reopen them.

If you believe you have found a contradiction: **stop and surface it.** Do not route around it.

## The migration is PAUSED at M5.1

M0–M5.1 are complete. **M6, M7 and M8 are paused.** Do not begin write-cutover work, contract work, or any proactive migration work without the owner explicitly resuming it. Several rules below describe what M6 *will* do — that is not permission to start it.

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
- **Personal (`type='punter'`) is system-generated and inalienable** — never claimed, never transferred, **never publicly discoverable**. Its discovery filter belongs in **one resolver** (`v2/src/lib/profileResolution.js`). Do not copy-paste `.neq('type','punter')` into a new query.
- **V1 is single-owner.** The word "manage" is not part of this architecture. Do not build multi-manager, delegation or roles.
- **Never key identity on `user_id`-as-identity.** `profile.id` is the permanent public identity; `user_id` routing is legacy and being retired.

## Known live faults — do not replicate the pattern

- `applications.artist_id` holds a **user id with no profile column**. A multi-profile artist's application cannot record which profile applied. Historical rows are **unrecoverable**. This is the exact fault the contract exists to prevent — do not add another table like it.
- `follows` is account-scoped, so a venue owner's personal follows pollute the venue's roster. Fixed at M6 by *adding* a profile column, **not** by moving the user column (which would break notification dedup).
- `supabase/migrations/20260711000005_m4_rls_migration.sql` shipped with **7 inline `auth.uid()` checks and no `can_act_as`** (`fix2` adds 2 more; 9 across all migrations). It is additive-permissive, so the debt is bounded and provisional — the seam retrofits at M6 and becomes sole authority at M8. **Do not add to that debt.** *(v1.1 §A10 says 13 — it counted comments. Frozen, so it stands; see `docs/architecture/errata.md` E1.)*

## Conventions

- Existing tables carry the pair under **table-specific names** (`venue_enquiries.applicant_profile_id`, `lineup_members.artist_profile_id`, `events.venue_profile_id`). These are correct and are not renamed. **New tables use the canonical `from_profile_id` / `from_user_id`.**
- Tables for **account-level** actions (claims, signup, sessions, settings, billing) take a user column **only** — no profile. You claim a profile *as a person*, not as a profile.
