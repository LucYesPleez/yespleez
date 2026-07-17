# Live Supabase schema audit — 17 Jul 2026

**Type:** audit only. **No database changes. No migrations. No M6 work.** Every action was an HTTP `GET`.

**Purpose:** close the unknowns blocking the CI specification (Tier 2), the architecture archive (`booking_interest`), and the Active Profile UX review (S1/S28, the `follows` 400s).

**Project:** `doqzxvppibuzieajqkxm.supabase.co`

---

## 0. Method, and what it can and cannot prove

**Access available:** the **anon key only** (`v2/.env.local`) — the same public key already shipped in the client bundle. No service-role key, no database password. The Supabase CLI is installed (2.109.1) but **not linked** (no `supabase/config.toml`); there is no `psql` or `pg_dump`.

**Technique.** PostgREST's OpenAPI root now rejects anon keys (`401 — Secret API key required`), so the schema was probed endpoint-by-endpoint and **calibrated against known controls**:

| Probe | Result | Meaning |
|---|---|---|
| `GET /profiles?limit=0` | `200 []` | known-good table → table exists |
| `GET /zzz_definitely_not_a_table?limit=0` | `404 PGRST205` | known-bogus → signature of "does not exist" |
| `GET /<t>?select=<col>&limit=0` | `200` / `400 42703` | column exists / does not exist |

Every existence claim below rests on that calibration. **`200` vs `404 PGRST205` is a reliable table test; `200` vs `400 42703` is a reliable column test.** Neither is affected by RLS — RLS returns `200 []`, not an error.

**Hard limits — what the anon key CANNOT reach.** These are not oversights; they are why S1's checklist has sat unchecked since 11 Jul:

- `information_schema`, `pg_constraint`, `pg_indexes`, `pg_policies` — not exposed via PostgREST.
- **CHECK constraint definitions** — including `follows_entity_type_check`. Unreadable.
- Indexes, triggers, grants, RLS policy bodies.
- A `pg_dump --schema-only` baseline (needs the DB password).

**Therefore goals 2 and 3 are NOT closed by this audit.** Goals 1, 4 and 5 are substantially closed. §6 lists exactly what remains and the SQL that finishes it.

---

## 1. Confirmed facts

### 1.1 The live table census — 15 tables

Anon-probed, calibrated:

| Exists (14, readable) | Exists but **errors** (1) | Does not exist |
|---|---|---|
| `profiles`, `follows`, `events`, `applications`, `lineup_members`, `performances`, `notifications`, `venue_enquiries`, `venue_availability`, `artist_availability`, `band_availability`, `standup_availability`, `claims`, `placeholder_profiles` | `personal_events` (**500**) | `booking_interest`, `messages`, `conversations`, `profile_members`, `account_settings`, `sessions`, `billing` |

**Exact row counts** (via `Prefer: count=exact` — anon-visible, so RLS-gated tables read 0):

| Table | Count | Note |
|---|---:|---|
| `events` | **24** | **Resolves a conflict in the record** — `m0-audit:72` says **120**, `m3-design-review:17` and `m4-verification-evidence:117` say **24**. Live says 24; `public read events` is `USING (true)`, so anon sees all rows. **M0's 120 is wrong or was measuring something else.** |
| `profiles` | 26 | was 25 at M5 (`m5-verification-evidence:13`) — one added since |
| `performances` | 63 | |
| `lineup_members` | 30 | was 28 at M3 |
| `placeholder_profiles` | 1 | matches `m0-audit:73` exactly |
| `follows`, `applications`, `venue_enquiries` | 0 visible | RLS blocks anon — real counts unknown |

### 1.2 `booking_interest` **does not exist** — Goal 1, closed

```
GET /rest/v1/booking_interest?limit=0
→ 404 {"code":"PGRST205","message":"Could not find the table 'public.booking_interest' in the schema cache"}
```

**Byte-identical to the bogus-table control.** No `booking_interest` table. No `from_profile_id` or `from_user_id` column exists on any table in the database. It appears nowhere in `v2/` source either.

**This contradicts both frozen documents.** v1.0 §06 specifies the table in full (with `target_profile_id`, `from_profile_id`, `from_user_id`, `status`, `note`, …). v1.1 §A3 lists it as profile-actionable and marks it **"✓ already"** — asserting it already carries the pair. **It was specified and never built.**

v1.1 §A3's own audit note — *"Three of seven profile-actionable tables already carry the pair"* — is therefore counting a table that does not exist. The other two ✓ claims are correct (§1.3).

### 1.3 v1.1 §A3's other claims are **correct**

| Table | v1.1 §A3 says | Live | Verdict |
|---|---|---|---|
| `venue_enquiries` | ✓ already | `applicant_profile_id` ✓ `applicant_user_id` ✓ `venue_profile_id` ✓ | **correct** |
| `lineup_members` | ✓ already | `artist_profile_id` ✓ `artist_id` ✓ | **correct** |
| `events` | ✓ via §03 split | `venue_profile_id` ✓ `host_id` ✓ | **correct** |
| `applications` | ✗ missing | no `from_profile_id`, no `artist_profile_id` — only `artist_id` | **correct** |
| `follows` | ✗ missing | no `from_profile_id`; `target_profile_id` ✓ (M2) | **correct** |
| `messages` | (M8) | table does not exist | **correct** |
| `booking_interest` | ✓ already | **table does not exist** | **WRONG** |

### 1.4 `profiles.owner_user_id` **does not exist**

```
GET /rest/v1/profiles?select=owner_user_id&limit=0  → 400 42703 (column does not exist)
GET /rest/v1/profiles?select=user_id&limit=0        → 200
```

The live ownership column is **`user_id`**. This matches the code (`.eq('user_id', …)` throughout) and M4's shipped policies (`p.user_id = auth.uid()`), and the M1 migration comment says so explicitly (*"RLS already checks `auth.uid() = user_id`"*).

But **`owner_user_id` is the column both frozen documents name**:

- v1.0 §03 schema card: *"`owner_user_id` — **NULL = unclaimed.** Set once, on claim. The single source of truth for ownership."*
- v1.1 **R2**: *"`owner_user_id`, evaluated server-side, determines authorization. Always."*
- v1.1 **R3**: *"v1 body: `owner_user_id = auth.uid()`."*
- CI spec **C1** rule text: *"`owner_user_id = auth.uid()` must never appear inline in a policy."*

**`can_act_as()` as specified in R3 would not compile against `profiles`.** The architecture is sound — one ownership column, tested through one predicate — but it names a column that is not on the table it means. This is a naming erratum, not a design fault.

**Where the name came from.** `owner_user_id` **does exist** — on **`placeholder_profiles`**:

```
GET /rest/v1/placeholder_profiles?select=owner_user_id&limit=0  → 200
```

`placeholder_profiles` is the v1 legacy table M3 promoted the single unclaimed profile out of (`20260711000004_m3_backfill_and_promotion.sql`). It carries `owner_user_id`, `claim_status`, `merged_to`, `is_duplicate`, `blocklisted`, `removed_at`, `source` — i.e. **most of the vocabulary v1.0 §03 attributes to `profiles`**. The likely explanation is that §03's schema card was drafted against `placeholder_profiles`' column names and the two were never reconciled. That also explains D10: v1.0 §03's tombstone column `duplicate_of` is absent from `profiles`, while `placeholder_profiles` has `merged_to` and `is_duplicate` — the merge mechanism exists, under other names, on the other table.

### 1.5 Migration `20260714000000_studio_sql_export_columns.sql` has **never been applied**

All five columns absent: `profiles.phone`, `.accessibility`, `.country`, `.links`, `.external_ref`, and `events.external_ref`.

**This is by design, and the migration says so** (line 14): *"NOT applied automatically. Review and run manually in the Supabase SQL Editor when ready."*

By contrast, the identity migrations **are** applied — `events.venue_profile_id` ✓, `lineup_members.artist_profile_id` ✓, `follows.target_profile_id` ✓, `notifications.data` ✓.

**Consequence for the CI spec (Tier 2).** The prerequisite as written assumes *baseline dump + replay migrations = production*. **It does not.** Replaying `supabase/migrations/` over a dump adds five columns production doesn't have. The migration directory is **not** a linear applied history — it mixes applied and deliberately-unapplied files, with no manifest saying which is which.

### 1.6 `notifications` schema drift is **resolved** — the known-issues doc is stale

`notifications.data` **exists** (added by `20260711000002_notifications_data_column.sql`, applied). `event_id`, `slot_id`, `from_uid` also still exist.

[`known-issues/notifications-schema-drift.md`](known-issues/notifications-schema-drift.md) states the live table *"has no `data` JSONB column"*. **That is no longer true.** The doc predates the migration.

### 1.7 `applications` schema drift is **confirmed, still live**

| Column | Live |
|---|---|
| `artist_name` | **does not exist** |
| `applicant_name` | exists |
| `guest_genre` | exists |
| `artist_id` | exists |
| `from_profile_id` / `artist_profile_id` | **do not exist** |

Confirms [`known-issues/applications-schema-drift.md`](known-issues/applications-schema-drift.md) and backlog **S6**. Code writing `artist_name` on insert still breaks.

### 1.7b `venue_enquiries` has gained five columns via the dashboard — **undocumented drift since M4** ⚠️

[`known-issues/venue-enquiries-schema-drift.md:11`](known-issues/venue-enquiries-schema-drift.md) records the live column list, *"confirmed via `information_schema.columns`, 2026-07-11"*: `id`, `created_at`, `venue_user_id`, `applicant_user_id`, `applicant_type`, `date_requested`, `note`, `status` — plus M1's two profile columns. `InviteSheet.jsx:86` comments that `headliner`/`slot_role`/`set_duration`/`extras`/`respond_by` **"require a migration"**.

**All five now exist:**

| Column | Live | 11 Jul record | Migration adding it |
|---|---|---|---|
| `headliner` | **YES** | absent | **none** |
| `slot_role` | **YES** | absent | **none** |
| `set_duration` | **YES** | absent | **none** |
| `extras` | **YES** | absent | **none** |
| `respond_by` | **YES** | absent | **none** |

Still absent, confirming the open drift: `applicant_name`, `event_id`, `event_name`, `proposed_date`, `proposed_fee`, `notes` (the real column is `note`), `direction`, `message`, `proposed_time`.

**No migration in `supabase/migrations/` adds these five.** They were applied directly through the dashboard, after 11 Jul. `m4-design-review:32` named this exact risk — *"the M0 §3.1 table is the current live policy state, **unless something was changed via the dashboard without a migration file**"* — and M4's §7 pre-flight verified no drift **as of 11 Jul**. That guarantee has since lapsed.

**This is the most consequential process finding in the audit.** Combined with D5 (a repo migration deliberately never applied), the relationship between `supabase/migrations/` and production is **bidirectionally lossy**: the repo holds DDL production doesn't have, and production holds DDL the repo doesn't. A schema baseline is not a nice-to-have for CI — it is the only way to know what the database actually is.

### 1.7c Two claims checked and **cleared**

- **`performances → lineup_members` FK exists.** The embedded select at [`EventScreen.jsx:286`](../v2/src/screens/EventScreen.jsx#L286) (`select('id, slot_id, lineup_members(artist_id, artist_name)')`) requires a FK PostgREST can introspect. Probed live: **`200`, with correctly nested data.** Flagged as a high-risk diff item; it is fine.
- **`placeholder_profiles` public-read policy behaves as documented** — 1 row, anon-readable, matching `m0-audit:51,73`.

### 1.8 `personal_events` — **infinite recursion in an RLS policy. Not an outage.**

```
GET /rest/v1/personal_events?limit=0
→ 500 {"code":"42P17","message":"infinite recursion detected in policy for relation \"personal_events\""}
```

**Reproduced twice, consistently, today.** `42P17` is a deterministic policy-definition fault — a policy that references its own table in a way that re-triggers itself. It is not a transient platform condition and it will not self-resolve.

The `supabase-pending` note attributes these 500s to *"a documented technical outage"* and suggests they *"may self-resolve"*. **That hypothesis is refuted.** The table has a broken RLS policy, today, and every query to it fails.

### 1.9 §A9 is **violated in production** ⚠️

v1.1 §A9: *"Personal is system-generated, inalienable, **never publicly discoverable**."* v1.1 adds that it *"Already ships; v1.1 only documents it."*

**It does not ship. As an unauthenticated caller, holding only the public anon key:**

```
GET /rest/v1/profiles?type=eq.punter&select=id,type,claim_status&limit=10
→ 200 — 7 rows
GET /rest/v1/profiles?type=eq.punter&select=name&limit=1
→ 200 — display name returned
GET /rest/v1/profiles?id=eq.<punter id>&select=id,type
→ 200 — 1 row
```

Personal profiles are **enumerable by type filter**, **readable by id**, and their **display names are exposed**, to anyone with the key that ships in the web bundle.

**The `.neq('type','punter')` filter is client-side decoration.** It shapes what the app renders; it does nothing at the API. Filtering happens in the client — the rows are already on the wire.

**This changes the CI spec's C6.** C6 says centralising the filter into `profileResolution.js` makes the invariant safe, and calls it *"a security-adjacent invariant currently held together by five copy-pastes."* That understates it. **Centralising all five copies would not close this by one inch.** §A9 is a database-authorization property and only RLS can enforce it. C6 remains worth doing for consistency, but it must not be recorded as satisfying §A9.

Scope, stated plainly: this exposes profile **display names** and ids, not credentials, contact details or messages. No secret is leaked. But the invariant is stated, frozen, believed-shipped — and is absent.

### 1.10 Other public-read observations (anon, unauthenticated)

| Query | Result | Note |
|---|---|---|
| `profiles` | 26 rows readable | `artist=14, punter=7, venue=2, band=1, standup=1, host=1` |
| `profiles.claim_status` | `claimed=25, unclaimed=1` | the Unclaimed Profile system has 1 live subject |
| `profiles.created_via` | **all 26 NULL** | v1.0 §03's provenance column exists but is unused |
| `events.status` | `live=23, draft=1` | **a draft event is anon-readable**; v1.0 §04 hides drafts *client-side* |
| `performances.status` | 63 rows: `offered=59, declined=2, draft=1, accepted=1` | **draft slots anon-readable**; `EventScreen.jsx:1280` hides them client-side |
| `follows`, `applications`, `venue_enquiries` | `200 []` | RLS correctly blocks anon reads. §05's C2 (enumeration impossible) **holds for `follows`** |

The `events`/`performances` draft exposure is the same class as §1.9 — a v1.0 §04 "public behaviour" rule enforced only in the client. Lower stakes (a draft event name), same root cause.

---

## 2. Discrepancies

| # | Discrepancy | Live | Document | Severity |
|---|---|---|---|---|
| **D1** | `booking_interest` absent | no table | v1.0 §06 specifies it; v1.1 §A3 marks it "✓ already" | **High** — a frozen doc asserts a compliant table that does not exist |
| **D2** | Ownership column named `user_id` | `profiles.user_id` | v1.0 §03, v1.1 R2/R3, CI spec C1 all say `owner_user_id` | **High** — R3's `can_act_as` body would not compile |
| **D2b** | `owner_user_id` exists — on the **wrong table** | `placeholder_profiles.owner_user_id` ✓, `profiles.owner_user_id` ✗ | v1.0 §03 attributes it to `profiles` | **Medium** — explains D2 and D10; §03 appears drafted against the legacy table |
| **D3** | §A9 not enforced | punter rows anon-readable | v1.1 §A9 "never publicly discoverable… already ships" | **High** — stated invariant absent; C6 cannot fix it |
| **D4** | `personal_events` RLS recursion | `500 42P17` on every query | `supabase-pending`: "outage… may self-resolve" | **Medium** — live broken table, wrong root cause on file |
| **D5** | Studio migration unapplied | 5 columns absent | migration self-documents as manual | **Medium** — breaks CI spec's Tier 2 replay model |
| **D5b** | `venue_enquiries` gained 5 columns via dashboard after 11 Jul | `headliner`, `slot_role`, `set_duration`, `extras`, `respond_by` present | no migration adds them; known-issues doc says absent | **High (process)** — production holds DDL the repo has never seen; M4's no-drift guarantee has lapsed |
| **D6** | `notifications.data` exists | present | `known-issues/notifications-schema-drift.md` says absent | **Low** — doc stale; drift resolved |
| **D7** | Registry lists phantom tables | `sessions`, `account_settings`, `billing` absent; only `claims` exists | CI spec `account_actionable` | **Low** — registry aspirational |
| **D8** | 8 live tables unclassified | `profiles`, `performances`, `notifications`, `venue_availability`, `artist/band/standup_availability`, `personal_events` | in neither CI registry list | **Low** — exactly what C5 exists to catch |
| **D9** | `created_via` unused | all NULL | v1.0 §03 provenance | **Low** |
| **D10** | `duplicate_of` absent | column missing | v1.0 §03 merge tombstone mechanism | **Low** — merge not built |
| **D11** | `events` row count | **24** | `m0-audit:72` says 120 | **Low** — M0's census is wrong; M3/M4's 24 confirmed |
| **D12** | `applications.status` vocabulary leak | **unverifiable — RLS blocks anon** | `HostDashboard.jsx:263-267` adapts `applications` into `EnquiryCard`, whose contract writes `'seen'`/`'booked'`/`'interested'`/`'shortlisted'` — values no `applications` reader understands | **Unknown — potentially High.** If the column is `text`, rows may be silently corrupted; if constrained, the writes fail. **Needs an authenticated query.** |

---

## 3. Goal 4 — were the `follows` 400s schema or outage?

**Split verdict. One half settled, one half not.**

**`personal_events` 500s — SETTLED, and it was never an outage** (§1.8). Deterministic `42P17` RLS recursion, reproduced today.

**`follows` 400 on the event heart — NOT settled, but one hypothesis is now dead.** The note offers two candidates: platform outage, or *"schema mismatch on `entity_name` column."*

- **`entity_name` EXISTS** (probed `200`). **That hypothesis is refuted.**
- The remaining candidate is `follows_entity_type_check`. **Unverifiable with the anon key** — and it cannot be tested by attempting an insert, because that would write to the database.

**What is established** (from S1 / `profile-follow-entity-type-drift.md`, verified 11 Jul by authenticated REST insert): `entity_type: 'profile'` raises `23514 … violates check constraint "follows_entity_type_check"`, and a census found **only `'artist'` and `'venue'`** across the table's entire history.

**The hypothesis** (assumption, *not* confirmed): the event heart writes `entity_type: 'event'` ([`EventScreen.jsx:233`](../v2/src/screens/EventScreen.jsx#L233), [`WhatsOnScreen.jsx:106`](../v2/src/screens/WhatsOnScreen.jsx#L106)). If the constraint permits only `'artist'` and `'venue'`, **every event heart has always failed** and the outage attribution was wrong — the same way it was wrong for `personal_events`. Given the outage explanation has now been falsified once today, it deserves scepticism the second time.

**Counter-evidence worth weighing:** `MySceneScreen.jsx:137` filters follows by `entity_type !== 'event'`, which implies the author expected `'event'` rows to exist. Whether any do is unknown — anon cannot read `follows`.

**One query settles it.** §6.

---

## 4. Recommendations

Ordered by value. **None are actioned here; this is an audit.**

1. **Treat §A9 (D3) as a decision, not a backlog line.** It is a stated, frozen, security-adjacent invariant that is absent from the database. Under the soak rules, whether "anon can enumerate Personal profiles and read display names" counts as a data-integrity item eligible for immediate remediation is **the owner's call, not mine**. If yes, the fix is an RLS policy on `profiles` (its own isolated migration) — *not* the C6 resolver work, which cannot close it.
2. **Fix `personal_events` (D4).** A live table that 500s on every query. Correct the recursive policy; retire the outage hypothesis in `supabase-pending`.
3. **Get the baseline dump (Goal 2) — now the highest-value item, and re-scoped by D5b.** Still blocked on credentials. **The Tier 2 model needs amending first**: `supabase/migrations/` and production have drifted **in both directions** — the repo holds DDL production never got (D5), and production holds DDL the repo has never seen (D5b). Dump-plus-replay therefore reproduces neither. The spec needs an applied-migrations manifest, the unapplied files moved out, and the dashboard-only columns captured in a migration retrospectively.
   **The deeper point:** three of the four "known issues" this audit touched were *stale in a way that mattered* — one resolved (D6), one wrong (D11), one overtaken by silent drift (D5b). Point-in-time hand-verification does not hold. That is the argument for the baseline, more than any individual check.
4. **Errata for the frozen documents.** D1 and D2 are factual errors in v1.0/v1.1 of the same class as E1. **Record, do not correct** — the documents are frozen; `errata.md` is the mechanism. D2 in particular should be recorded before anyone writes `can_act_as()` at M6 against a column that does not exist.
5. **Correct the CI spec** (unfrozen, so directly editable): drop `booking_interest` from the registry with D1 cited; fix `account_actionable` to `["claims"]` (D7); add the 8 unclassified tables (D8); soften C6's §A9 claim (D3); state C1's rule against `user_id`, not `owner_user_id` (D2).
6. **Refresh `known-issues/notifications-schema-drift.md`** (D6) — it asserts a drift that no longer exists.

---

## 5. Confirmed vs assumed

**CONFIRMED — observed directly today, against calibrated controls:**

- The 15-table census and exact row counts (§1.1); `booking_interest` absent (§1.2)
- Every column presence/absence in §1.3–§1.7c
- `profiles.owner_user_id` absent; `profiles.user_id` present; `placeholder_profiles.owner_user_id` present (§1.4)
- Studio migration unapplied; identity migrations applied (§1.5)
- `venue_enquiries` carries 5 columns no migration adds and the 11 Jul record says are absent (§1.7b)
- `performances → lineup_members` FK works (§1.7c)
- `personal_events` → `500 42P17`, twice (§1.8)
- Anon can enumerate Personal profiles and read display names (§1.9)
- `events` = 24, refuting `m0-audit`'s 120 (§1.1)
- Row counts and value distributions in §1.10 — **for rows anon can read**

**ASSUMED / UNVERIFIED:**

- **`follows_entity_type_check`'s allowed values.** Never read. The `'artist'`/`'venue'`-only claim is a **census inference** from 11 Jul, not a constraint reading.
- **That the event heart fails because of that constraint.** Plausible, consistent, unproven (§3).
- **That no other schema exists.** PostgREST serves `public`; a table in another schema would read as absent. `PGRST205` names `public` explicitly, so this is a narrow caveat.
- **Row counts are anon-visible subsets, not totals.** `profiles` = 26 *readable*; RLS-hidden rows would not appear. For `follows`/`applications`/`venue_enquiries` the visible count is 0 and the real count is unknown.
- **Indexes, triggers, grants, policy bodies** — entirely unexamined.
- **`profiles` public-read is intentional** (v1.0 §04) — inferred from the spec, policy not read.

---

## 6. What finishes this — one SQL session

Run in the Supabase SQL Editor (read-only; nothing here writes):

```sql
-- 1. The question S1 has been waiting on since 11 Jul: what does the constraint allow?
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.follows'::regclass;

-- 2. Does 'event' exist in follows, or has the heart always failed? (settles §3)
SELECT entity_type, count(*) FROM public.follows GROUP BY entity_type ORDER BY 2 DESC;

-- 3. The personal_events recursive policy (D4)
SELECT policyname, cmd, qual, with_check FROM pg_policies
WHERE schemaname='public' AND tablename='personal_events';

-- 4. Is Personal readable by anon at the policy level? (D3)
SELECT policyname, roles, cmd, qual FROM pg_policies
WHERE schemaname='public' AND tablename='profiles';

-- 5. Complete table list — confirms the §1.1 census and settles C5 (D8)
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1;

-- 6. Indexes + constraints on follows (Goal 3)
SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='follows';

-- 7. D12 — has the EnquiryCard vocabulary corrupted applications.status?
--    Anon cannot read this table; only an authenticated/SQL session can.
SELECT status, count(*) FROM public.applications GROUP BY 1 ORDER BY 2 DESC;
--    Expected vocabulary: pending / tentative / offered / accepted / confirmed / declined / rejected
--    Red flags:           seen / booked / interested / shortlisted / new

-- 8. D5b — when did venue_enquiries gain its 5 undocumented columns, and what else has drifted?
SELECT table_name, column_name, data_type FROM information_schema.columns
WHERE table_schema='public' ORDER BY table_name, ordinal_position;
```

**And the Tier 2 baseline (Goal 2)** — this needs the DB password, which **should not be pasted into this chat**. Do it yourself, either way:

```bash
supabase login                      # interactive, browser
supabase link --project-ref doqzxvppibuzieajqkxm   # prompts for DB password
supabase db dump --schema public -f docs/architecture/baseline-schema.sql
```

Once `baseline-schema.sql` exists, it answers §1.1, D7, D8 and every constraint/policy question above in one file — and it *is* the Tier 2 prerequisite C3 is gated on.
