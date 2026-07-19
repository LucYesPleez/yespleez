# M14c — owner backfill dry run

**18 Jul 2026 · read-only analysis.** No writes, no data modified, no migration SQL produced.
Identity v1.3, Phase 13, `O-R1`–`O-R6`, `T1` and erratum `E2` unchanged.

**Verdict up front: PAUSE. The migration cannot proceed, and the venue fallback must not be used.**

---

## 1 · Coverage

| | |
|---|---|
| Events visible to the analysis | **24** |
| — `is_public = false` | 0 |
| — `status = 'draft'` | **1** |

The draft row is visible, so the read is not restricted to public rows and **coverage is complete**.
An authoritative re-run is offered in §7 regardless.

---

## 2 · Summary

| Rule | Outcome | Count |
|---|---|---|
| **Rule 1** · directly resolved | Assign confidently | **0** |
| **Rule 2** · ambiguous | Multiple plausible owners — do not choose | **24** |
| **Rule 3** · unresolved | No owner determinable | **0** |
| **Rule 4** · candidate venue fallback | Recorded, **not applied** | **24** — but see §4 |

**Zero of twenty-four events resolve.** This is not a marginal result requiring judgement on a few
rows; the rule produces no answer for any row in the table.

---

## 3 · Why everything is ambiguous

**Every event shares one `host_id`, and that account owns five owner-eligible profiles** — venue,
artist, band, standup and host.

`U4`'s rule infers an owner where the account owns *exactly one* profile of the applicable type. One
account owning one of every type is the precise case the rule refuses to guess at, and it is the
only case present.

**This is not a data defect.** It is a development account that legitimately owns one of each
profile type, having created every event in the system so far. The rule is behaving correctly;
there is simply nothing for it to infer from.

**Data integrity is otherwise clean:**

| Probe | Result |
|---|---|
| `host_id IS NULL` (orphaned events) | **0** |
| `venue_profile_id` pointing at a missing profile | **0** |
| Distinct host accounts | **1** |
| Events with no `venue_profile_id` | 0 |

No deleted profiles, no orphans, no duplicate ownership, no dangling references.

---

## 4 · The venue fallback is not usable — and this is the important finding

Rule 4 asks whether venue ownership is a reasonable fallback. **It is available on all 24 events and
must not be used**, because the column does not mean what it appears to.

**All 24 events point `venue_profile_id` at the same profile — the venue "Elbows Rest".** Their own
`config.venue` text names entirely different places:

| Event | `config.venue` says | `venue_profile_id` says |
|---|---|---|
| Thelma Plum | Bellingen Memorial Hall | Elbows Rest |
| Hoot-E-Nanny | Bellingen Brewery | Elbows Rest |
| fds | Tabbouleh RSL | Elbows Rest |
| Jazz in the Old Supper Room | The Old Supper Room | Elbows Rest |
| …and 20 more | various | Elbows Rest |

**Cause, and it is a live bug rather than a historical artefact.** `CreateEventScreen` sets
`venue_profile_id: await resolveProfileId(session.user.id, 'venue')` — **the creator's own venue
profile**, not the venue the event happens at. Every event created by an account that owns a venue
profile is stamped with that venue regardless of where the gig actually is.

> Applying the venue fallback would assign 23 events to a venue that does not host them — asserting
> a commercial relationship that does not exist, on a column the platform would then treat as
> authoritative. **That is worse than leaving them unowned.**

### 4.1 · A correction to v1.3 §O4

v1.3's verified-facts table records:

> | Events with `venue_profile_id` populated | **24 of 24** | **No venue backfill required.** |

**The fact is correct; the consequence drawn from it is wrong.** The column is populated on every
row and is *semantically wrong on at least 23 of them*. I verified population and did not verify
meaning, and the conclusion "no venue backfill required" does not follow.

This does not affect any rule — `O-R1`–`O-R6` are untouched, and §O4 is a facts table rather than a
rule. **Proposed as erratum `E3`** for the owner's decision, on the `E1`/`E2` precedent.

---

## 5 · Migration risk assessment

| Class | Rows | Assessment |
|---|---|---|
| **Safe for automatic migration** | **0** | No row resolves under `U4`. |
| **Requires manual review** | 0 | Nothing is ambiguous *between plausible candidates* in the ordinary sense — the ambiguity is total and uniform, so per-row review would answer the same question 24 times. |
| **Requires a product decision** | **24** | All of them. One decision covers the whole table. |

**The risk of proceeding is `K1` from v1.3** — a null owner is a live event nobody can manage once
phase 3 policies land, and `O-R6` forbids one existing at all. Running the `U4` rule as written
would produce 24 such rows.

---

## 6 · Recommendation — pause, then one decision

**Do not run a `U4` backfill.** It resolves nothing and would leave the table in the state `O-R6`
forbids.

**Do not apply the venue fallback.** §4.

The 24 events are **pre-Studio seed data created by one account**, and their real-world owners —
Bellingen Brewery, Bellingen Memorial Hall, Tabbouleh RSL, The Old Supper Room — **do not exist as
profiles yet.** Creating them is exactly what Studio import does. Three options:

**(a) Assign all 24 to the account's `host` profile.** *Recommended.* It is true today: that account
created them and manages them. It asserts nothing false about any venue, satisfies `O-R6` in one
statement, and every row becomes correctable later by pre-claim Ops reattribution (`T2`) — the
mechanism designed for exactly this. **One decision, one statement, no guessing.**

**(b) Wait for Studio to create the real venue profiles, then attribute per event.** Most accurate
eventually, but it blocks M14d–M14i behind Studio, which is the thing this slice exists to unblock.

**(c) Assign per event by hand.** 24 rows is tractable, but it decides ownership from `config.venue`
free text — inference dressed as a decision, and against profiles that mostly do not exist.

> **(a) is not a compromise.** Under `O-R4` an event's owner is *whoever is accountable for it*, and
> today that is unambiguously the account that created and manages all 24. Reattributing to real
> venues as they gain profiles is the normal operation of the model, not a repair of a mistake.

**Separately and regardless of the above:** the `venue_profile_id` bug in `CreateEventScreen` should
be fixed before more events are created, or every new event repeats it. That is a defect fix, not
part of this migration.

---

## 7 · Authoritative re-run

Coverage looks complete (§1), but the numbers above come from an anon-key read. To confirm against
the full table:

```sql
SELECT count(*)                                                        AS total,
       count(*) FILTER (WHERE c.n = 1)                                 AS directly_resolved,
       count(*) FILTER (WHERE c.n > 1)                                 AS ambiguous,
       count(*) FILTER (WHERE c.n = 0 OR c.n IS NULL)                  AS unresolved,
       count(*) FILTER (WHERE c.n <> 1 AND e.venue_profile_id IS NOT NULL) AS candidate_venue_fallback
FROM public.events e
LEFT JOIN LATERAL (
  SELECT count(*) AS n
  FROM public.profiles p
  WHERE p.user_id = e.host_id AND p.type <> 'punter'
) c ON true;
```

And the finding in §4, which is the one that matters:

```sql
SELECT count(DISTINCT venue_profile_id) AS distinct_venues,
       count(*)                         AS events
FROM public.events WHERE venue_profile_id IS NOT NULL;
```

Expecting `0 / 24 / 0 / 24` and `1 / 24`.
