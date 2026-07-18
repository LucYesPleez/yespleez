# Event ownership — design review

**18 Jul 2026 · design review, not a specification.** Prompted by a flaw found in the v1.3 proposal
before ratification. No code, no SQL, no amendment made. The v1.3 proposal is untouched pending the
outcome of this review.

**The flaw.** `identity-v1.3-proposed.md` names the ownership column `host_profile_id`. An event may
legitimately have a venue and no host, a host and no venue, both, or — during import — neither yet
established. A column named for one of those relationships encodes an assumption the product does
not make.

---

## 1 · The three concepts are genuinely distinct

The review's first question is whether ownership, venue and host are three concepts or two competing
ownership models. **They are three**, and they answer different questions:

| Concept | Question | Cardinality | Nullable |
|---|---|---|---|
| **Ownership** | *Who is accountable for this event and may manage it?* | Exactly one | **Never** |
| **Venue relationship** | *Where does it happen?* | At most one | Yes — a warehouse, a park, a house |
| **Human record** | *Which person created this row?* | At most one | Yes — imports have none |

They coincide often and are still not the same. A venue running its own night has the same profile
answering the first two questions; that is a coincidence of values, not of meaning, and it must not
be modelled as one column.

> **The error in the current proposal is a category error, not a naming error.** `host_profile_id`
> takes a *relationship* (who presents) and makes it carry *authority* (who may manage). Renaming it
> would fix the label while leaving the concept confused; the fix is to give authority its own
> concept.

---

## 2 · Recommendation

> ### `owner_profile_id` — a neutral owning profile
>
> **`owner_profile_id`** — the profile with authority. Never null. Any profile type.
> **`venue_profile_id`** — where it happens. Nullable. Already exists, unchanged.
> **`host_id`** — the human who created the row. Nullable. Already exists, unchanged, never
> consulted for permission.

**And `host_profile_id` is not introduced at all.** That is the substantive recommendation, not just
a rename: the "host" of an event *is* its owner, expressed as a profile of whatever type. A
venue-type profile owning an event is the venue hosting its own night. A host-type profile owning
one is a promoter presenting it. **The owner's `type` tells you how to present it** — no fourth
column is needed to say what the third already implies.

### Why not `host_profile_id` (option 1)

It asserts every event has a host, which is false for venue-run nights, false for imports where the
promoter is unknown, and will be false for Festival. Any of those cases would be forced to put a
non-host profile in a column called `host`, and the next reader would reasonably treat that value as
a host. **A column whose name lies about a third of its rows is a defect that compounds** — every
query, policy and screen written against it inherits the wrong mental model.

### Why not a join table (option 3, considered)

An `event_participants` table — one row per (event, profile, role) — is the fully general model, and
it is what Festival will eventually want for crews and stages. It was rejected **for now**:

- Authority must be resolvable in a single predicate for RLS. A join table means every policy
  performs a subquery to find the owner — more expensive, and easier to get wrong.
- Exactly-one-owner is a schema-level guarantee with a column. In a join table it becomes a
  constraint somebody must remember.
- It solves a problem the product does not yet have. `venue_profile_id` covers today's only
  non-owner relationship.

**Not rejected forever.** If a third relationship appears — a co-promoter, a production company, a
stage partner — the join table is the right answer and `owner_profile_id` survives it unchanged:
authority stays on the event, relationships move to the table. **The recommended model is a strict
subset of the general one**, which is why it is safe to adopt now.

---

## 3 · Example shapes

Illustrative only — no SQL, no schema change proposed here.

| Scenario | `owner_profile_id` | `venue_profile_id` | `host_id` |
|---|---|---|---|
| Venue runs its own night | venue profile | **same** venue profile | the venue owner's account |
| Promoter books a venue | host profile | venue profile | the promoter's account |
| Promoter, unlisted location (warehouse, park) | host profile | `NULL` | the promoter's account |
| Studio imports a venue listing, promoter unknown | venue profile *(unclaimed)* | same venue profile *(unclaimed)* | `NULL` |
| Studio imports a promoter's event at a known venue | host profile *(unclaimed)* | venue profile *(unclaimed)* | `NULL` |
| Festival programme (future) | festival profile | per-stage or `NULL` | `NULL` |

**Owner equal to venue is normal, not degenerate.** Row 1 and row 4 carry the same value twice
because the same profile answers both questions. Nothing needs to detect or special-case it.

> **"Neither established" resolves itself.** The review's fourth case — an import with neither party
> settled — does not survive contact with the model: Studio creates an unclaimed profile for
> whatever it can identify, and that profile becomes the owner. If it can identify **neither** a
> venue nor a promoter, there is no one the event could belong to and **it must not be imported**.
> That is a useful constraint rather than a gap: an ownerless event is exactly the unmanageable row
> §O1 exists to prevent.

---

## 4 · Assessment against the platform

**Identity v1.3.** `O-R3` — *objects belong to profiles* — is unaffected and is in fact stated more
faithfully: a neutral owner column says "a profile owns this" without asserting which kind. `O-R4`
and `O-R5` need rewording. §O0–§O3 (the rationale, the §00 bar, the §A4 reconciliation) are
untouched — **the justification did not depend on the column's name.**

**`can_act_as()`.** Improved. Authority is `can_act_as(owner_profile_id)` — one predicate, no
branching on profile type. Under `host_profile_id`, a venue-run event would have needed either a
venue profile in a host column or a second check.

**Studio import.** Improved, and this is where the flaw would have bitten first. The importer sets
the owner to whichever profile it identified, without deciding whether that profile is "really" a
host. No type coercion at import time.

**Claiming.** Unchanged and now honest. Claiming any profile grants authority over everything it
owns, whether it is a venue or a promoter. Under `host_profile_id`, that worked only because venues
were being written into a host column.

**Publication.** Unchanged mechanically; the owner authorises stage advancement. The unresolved
question — **who may publish an event whose owner is unclaimed** (v1.3 `Q5`) — is untouched by this
review and remains the first thing to answer before import ships.

**RLS.** Simpler. One predicate against one column, for every event regardless of who runs it.

**Notifications.** Improved. *"Notify the event's owner"* becomes one lookup, type-independent —
which matters because v1.3's `Q1` (an unclaimed owner has no delivery identity) then has exactly one
place to be handled rather than one per owner type.

**Messaging.** Improved for the same reason. A conversation about an event has one counterparty:
its owner. §A5's conversations-belong-to-profiles composes directly.

**Analytics.** Materially better, and this is an argument `host_profile_id` cannot answer.
`owner_profile_id` plus the owner's `type` makes *venue-run versus promoter-run* a first-class
dimension. Forcing venues into a host column would have made that question unanswerable without
heuristics.

**Long-term extensibility.** The decisive one. A Festival profile owning a programme needs no new
concept — it is simply another owner type. Under `host_profile_id`, Festival would have required
either an amendment or a lie. **A neutral owner column is the only one of the three options that
does not need revisiting when a new participant type appears.**

---

## 5 · Migration implications

Materially **unchanged** from v1.3 §O8, and slightly simpler.

- **Phase 1 remains additive only.** One nullable column added; nothing altered. `host_id` is
  already nullable and stays as the human record.
- **Backfill** derives `owner_profile_id` from `host_id` under `U4`'s rule, exactly as before. The
  ambiguity risk (`K2`/`Q2`) is unchanged: an account owning two host profiles still has no recorded
  answer, and an event with a null owner is still a live object nobody can manage.
- **One simplification.** For events whose creator cannot be resolved but whose venue is known,
  `venue_profile_id` is a defensible fallback owner — the venue demonstrably hosted it. That option
  does not exist under `host_profile_id` without writing a venue into a host column. It should be
  offered as a decision, not applied silently.
- **No new phase, no new milestone.** Phase 3 still rides with R3.2; phase 4 still contracts at M8.
- **All 24 events already carry `venue_profile_id`**, so the fallback above is available for every
  existing row if chosen.

---

## 6 · Should v1.3 be amended before ratification?

**Yes — amend before ratification, not after.**

The change is confined to the amendment's **prescriptive** half. §O0 (what it does not claim), §O1
(the bar), §O2 (why §03 was right), §O3 (the §A4 reconciliation) and §O7b (governance) are all
independent of the column's name and survive verbatim. What changes:

| Section | Change |
|---|---|
| `O-R4` | `owner_profile_id`, neutral, never null; `host_profile_id` not introduced |
| `O-R5` | Reworded — claiming any owner profile grants authority |
| `O-R2` | The three-jobs table becomes owner / place / human record |
| §O4, §O6, §O8 | Column name; migration gains the venue-fallback option |
| §O10 `Q4` | **Closed by this review** — "which profile owns" is answered: whichever one the importer identified, with no type assumption |

**Ratifying first would be the worse path.** `O-R1`–`O-R5` become a frozen citation interface on
ratification, so amending afterwards means v1.4 renaming a rule that v1.3 had just introduced —
noise in the canonical record for a flaw found before it was ever binding. The proposal has not been
ratified, is not cited by anything, and can be corrected at zero cost.

> **This does not weaken the v1.3 rationale — it strengthens it.** The argument was always that
> ownership must be a stable profile reference that survives claiming. `owner_profile_id` is that
> argument stated without an incidental assumption about who does the owning.
