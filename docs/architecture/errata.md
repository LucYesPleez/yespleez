# Errata — canonical architecture documents

Known factual errors in the **frozen** documents in this directory.

**Nothing here has been corrected in the source.** The documents are frozen; they are amended
only via a versioned amendment (v1.2+), never edited in place. This file records what is known
to be wrong so that a reader is not misled, and so that a future amendment — *if one is judged
worthwhile* — has the findings already assembled.

**An erratum is not an amendment.** Recording an error here changes nothing and authorises
nothing. It does not license editing the frozen text, and it does not oblige anyone to raise
a v1.2. It is a note.

---

## E1 — v1.1 overstates the M4 inline `auth.uid()` count (13 → 7)

| | |
|---|---|
| **Document** | Identity Architecture v1.1 |
| **Location** | §A10 (Migration implications) and §A13 (Amendment record) |
| **Status** | **Open — not corrected.** v1.1 remains as ratified. |
| **Severity** | Cosmetic. No architectural consequence. |
| **Found** | 17 Jul 2026, verifying the CI spec against the repository |

### What v1.1 says

> "`20260711000005_m4_rls_migration.sql` contains 13 inline `auth.uid()` checks and no `can_act_as`."
> — §A10

§A13 logs the same figure as a *correction made at ratification*:

> "M4 recorded as shipped without the seam (13 inline `auth.uid()`); R3 reclassified install →
> retrofit at M6, sole authority at M8. An earlier draft asserted 'RLS is still ahead of us' —
> verified false against the repo before freezing."

### What the repository says

`m4_rls_migration.sql` contains **13 textual occurrences** of `auth.uid()`. **Six are inside SQL
comments.** **Seven are policy predicates** — all of the form `p.user_id = auth.uid()`, at lines
108, 115, 154, 194, 199, 216, 223.

The count was verified against the repo before freezing, as §A13 states. The verification counted
comment matches.

Across the whole migration directory, stripping `--` comments:

| Migration | Textual | In comments | **Executable** |
|---|---:|---:|---:|
| `20260711000000_fix2_applications_update_rls.sql` | 6 | 4 | **2** |
| `20260711000001_fix3_applications_insert_rls.sql` | 3 | 3 | **0** |
| `20260711000003_m1_schema_expansion.sql` | 2 | 2 | **0** |
| `20260711000005_m4_rls_migration.sql` | 13 | 6 | **7** |
| **Total** | **24** | **15** | **9** |

`fix3` is a pure `DROP POLICY`; `m1_schema_expansion` only describes existing RLS in prose. Neither
contains a violation.

### Why it does not matter architecturally

Every substantive claim v1.1 makes on this point is **correct and unaffected**:

- M4 did ship without the seam.
- `can_act_as` genuinely does not exist anywhere in the repository.
- R3 genuinely is a retrofit rather than an install.
- The debt genuinely is bounded, because M4 is additive-permissive.

The reasoning is identical whether the number is 13 or 7. Nothing derives from the magnitude.

### Consequences for enforcement

`docs/identity-ci-spec.md` uses the **executable** counts (7 in M4, 9 across all migrations),
because a CI check scans code and must not fail on prose. Its debt ledger therefore lists two
files, not three — `fix3` carries no debt to grandfather. This is a deliberate divergence from
v1.1's number, recorded here rather than hidden.

### If a v1.2 is ever raised

Correcting a miscount introduces no architecture, so it clears no bar in v1.0 §00 — that bar is
*"a genuine contradiction or an unrepresentable state"*, and this is neither. It is an error of
fact in a frozen document. Fixing it is a judgment call about whether accuracy in the canonical
record is worth an amendment, and that call belongs to the owner. **Do not raise a v1.2 for E1
alone without being asked.** If a v1.2 is raised for other reasons, folding E1 into it costs
nothing.

---

## E2 — v1.3 §O3's "written once at creation" reads as immutability

| | |
|---|---|
| **Document** | Identity Architecture v1.3 |
| **Location** | §O3, the §A4 reconciliation table, row *"Where it lives"* |
| **Status** | **Open — not corrected.** v1.3 remains as ratified. |
| **Severity** | Wording. No architectural consequence, but capable of misleading an implementer. |
| **Found** | 18 Jul 2026, during Phase 13 `Q6` (event reattribution) |

### What v1.3 says

> | **Where it lives** | Client-held, per-session, changes on a switcher | Persisted on the row, **written once at creation** |

### What was meant

The row's purpose is to contrast a **stored column** with §A4's rejected **client-held active
profile**. *"Written once at creation"* describes **persistence and provenance** — the value is not
re-evaluated per session — not **immutability**.

### Why it matters

Phase 13 `Q6` establishes that `owner_profile_id` must be correctable: an event imported against
the wrong profile has to be reattributable, and pre-claim that is routine data correction rather
than any kind of transfer. An implementer reading only this line would reasonably refuse to build
it.

### The correct reading

`owner_profile_id` is **stable in normal operation and correctable by exception.** Correction is
audited, atomic, never leaves the event ownerless (`O-R6`), and post-claim requires consent or
adjudication — see `docs/phase-13-q6-reattribution-2026-07.md` `T1`–`T7`.

**Nothing in v1.3's rules — `O-R1` through `O-R6` — asserts immutability.** The phrase appears only
in an explanatory comparison, not in a rule.

### Disposition

**Recorded, not corrected.** A versioned amendment to clarify one parenthetical phrase would be
disproportionate; `E1` set the precedent that frozen text stands and operative documents cite the
erratum. `CLAUDE.md` should cite `E2` where it states the ownership rule.
