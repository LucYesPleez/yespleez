# Professional Assets & Requirements Engine — architecture design

**Date:** 2 Aug 2026 · **Status:** design for review. No implementation, no migrations, no code.
**Supersedes:** the first draft of this document (2 Aug 2026), which proposed an account ownership
layer, requirement-set tables, asset scope/expiry/enabled properties and a tier vocabulary. All of
that is **cut**. See §11 for why each is safe to defer.
**Predecessor:** `docs/booking-dossier-audit-2026-08.md`.
**Empirical anchor:** the Rabbits Eat Lettuce 2026 artist application form.

---

## §0 Invariants

**I1 — No taxonomy change.** `MAIN_GENRES`, `SUBGENRES`, `VIBES`, `BAND_*`, `HOST_GENRES`,
`HOST_CATEGORIES`, `PERFORMANCE_ROLES`, `ARTIST_ROLES`, `ROLE_TAGS`, `SHARED_PERFORMANCE_TAGS`,
`genre_string` — untouched. The engine never references a genre. Requirements are about readiness;
genres are about matching. They never meet.

**I2 — No new profile roles.** `venue`, `host`, `artist`, `band`, `standup` remain the only industry
types. Future applicant types are architectural considerations only.

**I3 — No parallel systems.** Extend what exists. No second profile store, no second validator, no
second identity model.

**I4 — No user loses anything.** Nothing removed, nothing re-entered, no profile migrated by its owner.

**I5 — V1 adds no profile columns.** Every requirement key references a field that already exists.
Any key that would need a new column is deferred. This is the line that keeps the project small.

**I6 — Assets are reusable professional documents.** Assets contain **files, not profile
information**. If information is reusable and structured, it belongs on the profile. If it is a
reusable document or media file, it belongs in Assets. This is the rule for deciding where anything
new goes, now and later.

---

## §1 What this project builds

**The goal is not to recreate application forms. The goal is to eliminate repeated application forms
by allowing opportunities to reference an applicant's existing professional profile and Assets.**

**Four things. Nothing else.**

| Object | Contents |
|---|---|
| `PROFILE_ASSET_TYPES` | canonical registry — `key`, `label`, `cardinality` |
| `profile_assets` | the files |
| opportunity `required_items` | `text[]` — the tick-list (see §5.1 on where it lives in v1) |
| the engine | one pure module comparing the two |

Plus one new UI section (**Assets**) and a ~20-line key→resolver lookup.

**Explicitly reused, not restructured:** `profiles` and all five editors · `applications` ·
`artist_availability` · `profileTypes.js` · `profileTaxonomy.js` · `writeNotification` · the
messaging file-storage *pattern* (buckets **not** merged) · the existing completion predicate.

**Explicitly not built:** an account layer · requirement-set tables · asset scope · asset expiry
logic · requirement tiers · new profile columns · new profile types.

---

## §2 The empirical baseline

The REL form is ~45 fields. ~25 already exist on `profiles`. **Five are file uploads.** The rest are
either new scalars (deferred under I5) or genuinely per-application.

**The decisive finding: the four documents carry no asterisk.** REL's required set is *Act Name, Bio,
Music Style, Format, Photo, Days Available, Technical Setup, First Name, Email* — every one a field,
not a file. **Press Kit, Stage Plot, Tech Rider and Public Liability are optional.**

This produces the blocking rule in §5.2, and it is the reason no tier vocabulary is needed.

---

## §3 `PROFILE_ASSET_TYPES`

Declarative registry, same shape as `ARTIST_ROLES` / `HOST_CATEGORIES`. `key` is stored and never
changes; `label` is display-only and freely editable.

| key | label | cardinality |
|---|---|---|
| `PRESS_KIT` | Press Kit | single |
| `STAGE_PLOT` | Stage Plot | single |
| `TECH_RIDER` | Tech Rider | single |
| `HOSPITALITY_RIDER` | Hospitality Rider | single |
| `PUBLIC_LIABILITY` | Public Liability | single |
| `PROMO_PHOTOS` | Promo Photos | **many** |
| `LOGO_PACK` | Logo Pack | **many** |
| `MEDIA_KIT` | Media Kit | single |
| `OTHER` | Other | **many** |

All nine ship in v1. A registry entry costs a line; there is no `enabled` flag and nothing is hidden.

**`cardinality` is the only property beyond key and label**, because it is the only one that differs
between types *today*: promo photos and logo packs are many-of, a press kit is one. It cannot be
retrofitted cheaply. Everything else (`scope`, `expires`, `enabled`) is cut — a property whose value
is identical for every row is not a property.

**`PROMO_PHOTOS` is not the avatar.** `avatar`/`avatar_hero`/`avatar_thumb` are cropped display
renditions; a festival wants print-resolution originals. The existing avatar path is untouched.

---

## §4 `profile_assets`

### 4.1 Shape

| column | notes |
|---|---|
| `id` | uuid |
| `user_id` | the owning human — **the RLS anchor** |
| `profile_id` | the profile this asset belongs to |
| `asset_type` | key from §3 |
| `storage_path` | object path in the assets bucket |
| `file_name`, `mime_type`, `byte_size` | as uploaded |
| `label` | optional user note ("2026 rider") |
| `valid_until` | nullable, unused in v1 — see §11 |
| `is_current` | the live version for this `(profile_id, asset_type)` |
| `superseded_by` | previous versions retained, never destroyed |
| `created_at`, `updated_at` | |

**Assets belong to profiles.** No scope column, no account layer.

The evidence: the July live audit counted 19 industry profiles (artist 14, venue 2, band 1, standup
1, host 1); the M5.5b migration header records the account census at 18. **At most one person on the
platform holds two industry profiles.** The cross-profile duplication problem is real in principle
and affects approximately nobody in practice.

`user_id` is present because RLS requires it — and carrying it is precisely what makes account scope
a later *addition* (one column, nullable `profile_id`) rather than a migration of live compliance
data. Existing rows would stay profile-scoped and correct.

### 4.2 Versioning

Replace-in-place: a new upload supersedes, `is_current` moves, history is retained and never
destroyed. Renewing insurance is replacing the document — which is the behaviour the vision asks for.

### 4.3 Storage & RLS — written with the table, not after

A new dedicated bucket. **Not** merged with the four messaging buckets.

- **Private by default.** Supabase grants ALL to anon unless revoked; RLS is the only barrier.
- **Owner read/write** through the existing `can_act_as` predicate — one ownership predicate, per R3.
- **Scoped grant on submission** — an application grants read to the receiving profile for the assets
  that satisfied its requirements. Not a blanket profile-wide grant.
- **Signed, expiring URLs.** No public object paths.

This is the most sensitive data the platform will hold. It is the one place where "tighten it later"
does not work.

### 4.4 UI

A flat list. The user sees six items and an upload control on each. `cardinality`, resolution, and
every other registry property stay invisible.

---

## §5 Requirements

### 5.1 Storage — and why the domain word is "opportunity"

**Requirements belong to an opportunity, not to an event.**

Today an opportunity is effectively an event application. Tomorrow it could be a resident-DJ
application, a festival artist application, a vendor application, a volunteer role, a media pass or a
crew application. **In Version 1, opportunity requirements are stored on `events` because events are
currently the only opportunity type. The Requirements Engine treats this as an implementation
detail, not part of the domain model.**

Consequently: the engine, the key registry, the UI copy and every interface in this document say
*opportunity*. Only the v1 storage location says *event*. When a second opportunity type arrives it
brings its own storage and the engine is unchanged.

**One column: `required_items text[]`** — the keys the host ticked.

No requirement-set tables. Templates are client-side presets, not database rows. `text[]` is
queryable (GIN) if "which opportunities am I ready for?" is ever wanted. NULL or empty means no
declared requirements, which is every event that exists today — backward compatible by construction.

### 5.2 The blocking rule

**A ticked field is required. A ticked file is requested.**

One sentence, applied by the engine. It matches REL exactly — all nine required items are fields,
all four files are optional — and it means the venue never sees or thinks about a tier.

### 5.3 The venue's experience

A checklist. Tick what you need.

```
Requirements
  ☑ Bio
  ☑ Demo Mix
  ☑ Press Kit
  ☑ Stage Plot
  ☑ Public Liability
```

No builder, no predicates, no tiers, no engine terminology. **The UI word is "Requirements";
`required_items` is internal.**

### 5.4 Requirement keys

Requirements reference existing profile fields and existing asset types — nothing else. Per I5, a key
exists only if the field it resolves to already exists.

| Section | Keys |
|---|---|
| Identity | `ACT_NAME`, `BIO`, `PROFILE_PHOTO`, `LOCATION`, `CONTACT_EMAIL` |
| Media | `DEMO_MIX`, `WEBSITE`, `SOCIALS` |
| Technical | `TECH_SETUP` |
| Commercial | `FEE_EXPECTATION`, `ABN`, `GST_STATUS` |
| Availability | `AVAILABLE_ON_DATE` |
| Assets | `PRESS_KIT`, `STAGE_PLOT`, `TECH_RIDER`, `HOSPITALITY_RIDER`, `PUBLIC_LIABILITY`, `PROMO_PHOTOS`, `LOGO_PACK`, `MEDIA_KIT` |

A small key→resolver lookup maps each to its column or asset type. It exists so requirements are data
about the **domain** rather than about the **schema**, and because it is where the existing
`mix_link` / `epk_link` / `video_link` and `fee_travel` / `fee_plus_travel` duplication is absorbed
rather than added to (I5). It is a lookup, not a subsystem.

**Note:** `TECH_SETUP` is currently written only by the artist editor, though the column is shared.
Until it is added to the band and comedy editors, those types cannot satisfy it. See §12 P3.

---

## §6 The engine

A pure function. No I/O, no Supabase, no React. Fully testable under the existing `node:test` setup.

```
evaluate(requiredItems, dossier, context) → Evaluation
```

`dossier` = `{ profile, assets[], availability }` · `context` = `{ opportunityDate }` ·
`Evaluation` = `{ items[], canSubmit, satisfiedCount, requiredCount }`

**`context` is present from day one even though v1 puts little in it.** The signature is the thing
that cannot be retrofitted cheaply; date-aware predicates later are a pure addition.

Each item resolves to one internal state:

| internal | shown to the applicant |
|---|---|
| `satisfied` | ✓ (ticked) |
| `absent` | **Not provided** |
| `withheld` (`'N/A'`) | **Declined** |

**Engine terminology never reaches a screen.** Nobody sees the word "withheld".

**`withheld` never blocks.** An applicant who marked something `'N/A'` has given a definitive answer,
not left a box unticked. The venue sees it as declined; the applicant is not nagged about it.

### 6.1 Predicates — extending what exists

The three dashboards already carry the right semantics, duplicated
(`ArtistDashboard.jsx:330`, `HostDashboard.jsx:327`, `VenueDashboard.jsx:193`):

```
filled(v) → has a real value (not 'N/A')
done(v)   → answered, even if withheld
```

The engine adopts both unchanged and adds one:

```
present(assetType) → a current asset of this type exists
```

**Those three closures are then deleted and call the engine** (I3). Band and Comedy dashboards gain
profile completion as a side effect — they have none today.

---

## §7 Application flow

Pressing **Apply** evaluates first; it does not submit.

- **`canSubmit` true** → Submit Application.
- **`canSubmit` false** → the checklist. Satisfied items ticked; missing items each linking directly
  to the field or upload that fixes them. Re-evaluates live as items complete.

**Rendering-contract exemption.** R3 (no placeholders) and R5 (no visual holes) govern *public*
rendering. The readiness checklist is the applicant's private view of their own profile and its job
is to show holes. Stated here so nobody later "fixes" it by hiding incomplete items. R1
(Absent ≠ Withheld) still applies and is honoured by §6's states.

**Per-application answers.** Four REL fields cannot be pre-answered — Special Requirements, Fee
Notes, visual-collab, this festival's date subset. `applications.note` already exists and is their
home. The honest goal is *"never ask you anything you have already told us"*, not *"never ask
anything."*

**Submission must write a notification.** Not a new concept — `writeNotification` exists and
`sendEnquiry` simply never calls it. Once an application carries documents and a readiness gate,
silence becomes the failure mode of the whole feature.

---

## §8 Readiness

Three numbers that never compete.

**Per section** — Identity 100% · Media 80% · Technical 100% · Commercial 90% · Assets 30%
**Overall** — Professional Profile 82%
**Per opportunity** — Festival Requirements 6 / 8

The existing dashboard bar stays. Two rules:

1. **The Assets denominator is the registry's declared types** (nine), not an open-ended list.
   Note the consequence: with nine types most performers will read low in this section — a DJ who
   never needs a hospitality rider or a logo pack sits around a third. That is acceptable because
   readiness is feedback, never a gate, but if it reads as discouraging in practice the section can
   show a count ("4 of 9") instead of a percentage. A UI call, not an architectural one.
2. **"Declined" counts as complete** within a section — consistent with §6 and with the existing
   `done()` behaviour for socials.

Readiness is feedback, never a gate. Only `required_items` gate a submission.

---

## §9 The six sections

**Identity · Media · Technical · Commercial · Availability · Assets.**

One vocabulary, three uses: how requirement keys are grouped, how readiness reads, and how the
profile is described.

**Files always belong to Assets.** A stage plot is an Asset, not Technical. Promo photos are an
Asset, not Media. That keeps the sections disjoint with no overlap.

**These sections are a grouping, not an editor restructure.** They must not trigger reorganising five
profile editors — that would breach "preserve every existing editor where practical." **Assets is the
only genuinely new section in the UI.**

---

## §10 Three things to get right at zero cost

Not additions — decisions that are free now and expensive later.

1. **`profile_assets` carries `user_id` as well as `profile_id`** (§4.1).
2. **The engine signature takes a `context` object** (§6).
3. **RLS is written with the table** (§4.3).

---

## §11 Deferred — and why each is safe

| Deferred | Why deferring costs nothing |
|---|---|
| Account ownership layer | one column + nullable `profile_id`; existing rows stay correct |
| Asset expiry logic | `valid_until` already on the table; the predicate is additive |
| Registry `scope` / `enabled` | one line each, in a data registry |
| Requirement tiers | §5.2's rule covers v1; a tier column is additive |
| Requirement-set tables | client-side presets promote to rows with no data loss |
| Pinned submission evidence | one nullable jsonb column on `applications`, addable any time |
| New profile columns (setup/packdown/headcount) | additive; excluded by I5 |
| Document verification | orthogonal to storage entirely |
| Merging `venue_enquiries` and `applications` | unaffected either way |
| New applicant types | registry entry + editor, per §14 |

**Two limits to state plainly rather than discover later:**

- **The engine guarantees completeness, not authenticity.** Nobody checks a PLI certificate is
  genuine. Venue-facing copy must not say "verified".
- **`abn` / `gst_registered` / `emergency_*` remain duplicated** across the profiles a human holds.
  Documented, not solved. (ABN in particular is entity-level, not per-human — a venue's ABN is the
  business's, not the owner's — so its current placement is arguably correct.)

---

## §12 Rollout

| Phase | Contents | Independently valuable? |
|---|---|---|
| **P1 ✅ DONE 2 Aug 2026** | `lib/requirements.js` + `requirements.test.js`; the three `completionPct` closures deleted | yes — fixed a live ceiling: band capped at 88%, comedy at 76% |
| **P2 ⚠ BUILT 2 Aug 2026 — MIGRATION NOT APPLIED** | registry, `profile_assets`, bucket, RLS, Assets UI section | yes — the Assets library stands alone |
| **P3** *(optional)* | add `tech_setup` to the band and comedy editors (column already exists) | small; makes `TECH_SETUP` satisfiable for all performers |
| **P4** | `required_items` (stored on events in v1 — §5.1), the tick-list UI | needs P1 |
| **P5** | Apply → evaluate → checklist → submit → notification | needs P1, P2, P4 |

P1 and P2 depend on nothing and ship value on their own.

**P1 as built.** `v2/src/lib/requirements.js` exports `SECTIONS`, `REQUIREMENT_KEYS`,
`COMPLETION_KEYS`, `evaluate()` and `completionFor()`. The three closures in `ArtistDashboard`,
`HostDashboard` and `VenueDashboard` are gone; each now calls `completionFor(profile, type)`.

Two things worth recording:

1. **P1 fixed a live defect, not just duplication.** `PerformerDashboard` renders `ArtistDashboard`
   with a config, so band and comedy profiles were scored against the *artist* field list — which
   counts `sound`, `mixcloud`, `soundcloud` and `youtube`, columns those editors never write. Band
   was capped at 15/17 (88%) and comedy at 13/17 (76%). **A comedian could fill in every field their
   editor offers and still be told they were 76% complete.** Per-type key lists remove the ceiling.
2. **I4 is enforced, not asserted.** `requirements.test.js` reproduces all three original closures
   verbatim as oracles and asserts the engine agrees to the decimal for artist, host and venue across
   full/partial/empty fixtures. Changing a key list or predicate for those types fails the suite.

Verification: 799/799 tests pass · oxlint 0 errors, 123 warnings (net zero added) · `vite build`
passes · mutation-checked (inverting the asset-blocking rule and adding a wrong key to the comedy
list each failed exactly the intended tests, and only those).

**P2 as built — client complete, migration NOT applied.**

| File | Role |
|---|---|
| `v2/src/lib/profileAssets.js` | the registry — `key`, `label`, `cardinality`, plus bucket/limit/path constants. Pure, no Supabase import, so `requirements.js` and its tests can read the asset vocabulary without a client |
| `v2/src/lib/profileAssetStore.js` | the I/O half — list, upload (+supersede), delete, signed URL |
| `v2/src/components/ProfileAssetsSection.jsx` | the UI section, rendered inside **all five profile editors** |
| `supabase/migrations/20260802000000_pa1_profile_assets.sql` | table + RLS + bucket + storage RLS. **Manual apply.** |

**⚠ PLACEMENT: THE EDITOR, NOT THE DASHBOARD** (owner, 2 Aug 2026). Assets first went in beside
`AvailabilitySection` on the three dashboards and were moved. They are reusable *profile content* —
they belong next to bio and socials, in the thing you edit to say who you are. The dashboard shows
what is happening; the editor is where the profile is authored. Now in all five editors: artist,
band, comedy (page 2, after Socials), host, venue.

Two consequences that shaped the component:

- It resolves its own profile id from `userId` + `profileType` when not given one. None of the five
  editors keep the loaded row's id, and threading new state through all five stable screens is a
  bigger change than one small query. Pass `profileId` directly and it skips the lookup.
- A profile that has never been saved has no id, so it cannot hold files. The section says so in one
  line rather than rendering nine upload buttons that would each fail.
- Every button inside it is `type="button"`. The editors wrap their fields in a `<form>`; a bare
  button would submit the profile on every upload click.

Three things settled while building:

1. **`requirements.js` no longer declares asset keys.** They are derived from
   `ASSET_REQUIREMENT_KEYS`, so adding a tenth asset type needs one edit, not two. Two hand-kept
   lists of the same nine strings is the exact duplication this codebase already pays for elsewhere.
2. **No CHECK constraint on `asset_type`, deliberately.** `follows_entity_type_check` omitted
   `'event'` and broke every event heart from launch until 2026-07-31, misattributed to an outage
   for weeks. A value list in a constraint makes a tenth type a migration and makes forgetting it a
   23514 that reads like a client bug. The registry is the source of truth; an unknown key renders
   as itself. Cardinality is unenforced in the DB for the same reason.
3. **The storage path IS the authorization input.** Objects live at
   `<profile_id>/<ASSET_TYPE>/<stamp>.<ext>` and the storage policies read
   `can_act_as(safe_uuid(foldername(name)[1]))`. `assetPath()`'s test pins that shape, because
   changing it would silently change who can read every file with nothing throwing.

Until the migration is applied the section renders every type as "Not provided" and uploads fail —
there is no table and no bucket. Nothing else in the app is affected.

---

## §13 Decisions — closed

**D1 — Which pipeline the engine attaches to. RATIFIED 2 Aug 2026: `applications`.**

`applications` is event-first ("I want to be on this bill") and is the REL case. `venue_enquiries`
stays what it is — the date-first availability approach ("are you free on 14 March?"). They are
different acts, not duplicates, and **they are not merged by this project.** Merging two live tables
with different shapes and documented drift is larger and riskier than everything else in this
document combined.

*(D2–D5 from the earlier draft are closed: the account layer is cut, medical conditions are excluded
under I5, host authoring is the tick-list of §5.3, and §5.2 settles what blocks.)*

---

## §14 Why this stays extensible without building the future

The audit's test was: **can an opportunity accept an applicant without producing a lineup slot?**

Answered yes, structurally, while building nothing extra:

- requirements belong to an **opportunity**; events are only where v1 happens to store them (§5.1)
- `required_items` is a list of keys, not questions or fields baked into the event model
- requirement keys are a namespace, not a column list
- `profile_assets` carries `user_id` and `profile_id`, so account scope is additive
- the engine takes a dossier and a list — neither parameter knows what a performance is

A vendor type, when it eventually exists, needs a registry entry, an editor, and asset types. **It
does not need a new application system, a new requirements model, or a new identity model.**

Total new surface: one registry, one table, one column, one module.
