# Hand-off to the Scene thread — 2026-08-07

Written from the Festival thread. Everything here is **Scene-repo work** that the
Festival Portal is blocked on or must not do itself. Ordered by whether it is
broken, blocking, or building.

Context for all of it: the Festival UX is frozen (`FESTIVAL_UX_v1.md` in the
Portal repo) and M1 is complete — production is now reproducible from Git via
`supabase/migrations/00000000000000_baseline.sql`.

---

## 1 · BROKEN IN PRODUCTION

### 1a. `accept_festival_applications` does not exist

`applicationRepository.decide()` routes **every acceptance** through
`supabase.rpc('accept_festival_applications', { p_ids })` — Portal commit
`e3b2668`. That function is **not among the 88 functions in production**,
verified against today's schema dump.

So accepting an application should be failing in the live beta right now.
Declining and shortlisting take a plain UPDATE and are unaffected.

Confirm:
```sql
select proname, prokind from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and proname like 'accept%';
```

The Portal's comment describes the intended contract: accepting is where an
application becomes **participation**, and both writes must be one transaction
or they drift. The category → participant_type mapping was deliberately placed
in the database rather than in the client. ⚠ Participation tables do not exist
yet, so this function currently has nothing to write participation *into* — the
honest fix is either to ship it alongside M2, or to have it do the status write
transactionally now and gain the participation half later.

### 1b. Scene production may not have the festival apply flow

`yespleez.pages.dev` deploys from `main`. The apply-in-Scene work is commit
`f06bc0b` on **`v2-react`**, which is not on main. The Portal now points its
application links at `https://yespleez.pages.dev` (`VITE_SCENE_URL`, added
2026-08-07 — it was missing entirely, so every link the beta handed out went to
`localhost:5174`). **Those links reach a build that cannot take a festival
application until `v2-react` ships to main.**

---

## 2 · BLOCKING THE FESTIVAL EVENT EDITOR

Both are the same root cause: **fields that other surfaces need are living
inside `events.config`, a blob only Scene may interpret.**

### 2a. Slots are not a table

`performances.slot_id` and `slot_offers.slot_id` are **`text`**. There is no
slots table — a slot's definition (label, time, day, stage) lives in
`config.days[].slots[]`. So the relational half knows *who is in a slot* and only
the blob knows *what the slot is*, joined by an unenforced string.
`slot_offers.event_id` is `text` rather than a uuid FK as well.

**Needed:** promote slots to a real table — `event_id uuid`, stage, day,
start/end, label, entry type. Backfill from `config.days`. Repoint
`performances.slot_id` to a uuid FK; fix `slot_offers.event_id` to uuid.

⭐ **Do this now: the data is nearly zero.** No festival has set times yet. Every
week it waits, the backfill grows and more unenforced `slot_id` strings appear.

This is also the prerequisite for Stage 6 of the frozen UX (the event Timeline
with stages, shifts and clash detection).

### 2b. Descriptive fields are in the blob

`events` has 17 real columns. `description`, poster, cover and gallery are not
among them — they are `config`. Any surface other than Scene's editor that wants
them has to parse the blob.

**Needed (lower urgency if §3 lands):** promote at least `description`,
`poster_url`, `cover_url` to columns, backfilled, with Scene reading the columns.

### 2c. Poster upload needs a bucket

The Portal deliberately ships **no** avatar/banner/poster upload because there is
no storage bucket or policy for it — half an upload control being worse than
none. Needed before the Event Editor's media section can exist anywhere but
Scene.

---

## 3 · THE SHARED EVENT EDITOR (ratified direction, 2026-08-07)

> **One canonical event editor for the whole platform.** Scene uses it for simple
> events; Festival Companion embeds it as the Event room and wraps organiser
> workflow around it. ⛔ Not two implementations of event details, media,
> requirements, set-times or publication controls.

⭐ This also **resolves** the `events.config` boundary rather than violating it:
one shared editor means exactly one writer of the blob.

### What is actually there

`v2/src/screens/CreateEventScreen.jsx` — **1,344 lines**, **45 `useState`**,
8 Supabase calls, 6 router calls, 84 inline styles alongside 85 CSS-module
classes. It fetches, transforms, renders, saves, navigates and deletes. **It is a
screen, not a component**, and nothing can embed it as-is.

### Step 1 — the only step that matters right now

**Split plumbing from form, inside Scene. No cross-repo work, no behaviour
change.**

- `CreateEventScreen` keeps routing, session, load, save, delete
- `EventEditorForm` becomes pure and controlled: `value`, `onChange`,
  `sections` — no fetching, no navigation, no auth
- The 45 `useState` become **one explicit event value object**

That single split is what makes every later option possible, and it is worth
doing even if the editor is never shared.

### Module inventory — it is nine modules, not one file

Anyone scoping this as "move a component" is wrong by an order of magnitude.
Travelling with the form: `lib/eventBadges`, `lib/requirements`,
`lib/profileTypes`, `lib/actingProfile`, `lib/uploadImage`,
`screens/event/heroMedia`, `components/ImageUploadButton`,
`components/CoHostPicker`, plus `@dnd-kit`.

### Section slots

Scene's editor is built for a gig. A festival event needs build/pack-down dates,
twelve categories and departments. The shared form must accept **injected
sections** so Festival extends it rather than forking it.

⛔ **Keep Scene's proven section ordering.** Festival adds around it; do not
reorder mature UI to match the frozen spec's wording.

### Reuse ranking (highest value, lowest coupling first)

1. Set-time generator + manual day/slot builder — pure, no Scene imports
2. Requirements checklist — writes `required_items`, a real column
3. Host controls toggles
4. Event details fields (category chips need `eventBadges`)
5. Co-host picker — writes `event_hosts`
6. Media / cover / poster / gallery — heaviest: cropping, upload, `@dnd-kit`

### ⛔ What must NOT be merged

**Festival's Timeline is not the set-time generator.** The generator makes a
running order of slots for a bill. The Stage 6 Timeline is the whole-event
schedule — performances *and* volunteer shifts, sound checks, gate opening —
with clash detection across categories. Different grain, different object.
Merging them is the one genuinely wrong move available, and it is tempting
because both say "times".

The set-time generator stays in the Event room. Timeline remains its own room.

### Delivery

Package is the destination; a **monorepo** is the honest route for a solo
developer (no publishing dance). ⛔ Not an iframe — different origins, per-origin
Supabase sessions, `postMessage` for everything, two style systems meeting at a
visible seam. Interim while step 1 happens: deep-link with a return URL.

---

## 4 · THE DISCOVERY FLOW (ratified 2026-08-07)

```
Scene → user indicates this is a Festival → Festival Companion opens
      → Festival Profile created → Event created → LAND ON EVENT
```

⭐ **Festival events are born owned by a Festival Profile.** ⛔ No re-parenting,
no conversion RPC, ever. The recommendation fires **before the first save**,
while the event is still a draft in memory.

**Scene's side of this:**

- ⛔ **Do not add a "what are you creating?" question.**
  `CATEGORY_BADGES.FESTIVAL` already exists in `CATEGORY_CHOICES`, is already
  offered in the editor, and is already exclusive. A second classification could
  disagree with the chip.
- **React to the chip.** A recommendation card in the ratified attention shape:
  signal, reason, exactly one action, ⛔ not dismissible, disappearing when the
  fact changes.
- **Pass the draft across** — name, dates, FESTIVAL chip, venue — so nothing is
  retyped. The event does not exist yet, so this is a payload, not a migration.
- Later the trigger can also derive from multi-day, applications enabled and
  multiple organisers — all real facts today. ⛔ Never a second taxonomy.
- ⚠ **Say only what exists.** Of nine capabilities first drafted for that copy,
  three are built. Advertising the rest is asserting *withheld* where the truth
  is *absent*, at the exact moment someone chooses a tool.

⚠ Gated by `VITE_ORGANISER_ALLOWLIST` and the RLS policy
`festival_profile_creation_is_invite_only`. Release concern, not architectural —
design now, ship when the gate opens.

---

## Summary

| | What | Why it matters |
|---|---|---|
| 1a | `accept_festival_applications` missing | Accepting is broken in the live beta |
| 1b | `v2-react` not on `main` | Application links reach a build that cannot accept them |
| 2a | Slots → real table | Blocks Festival's Timeline; cheapest to fix now, at zero data |
| 2b | `description`/poster/cover → columns | Blocks the Event room owning its own fields |
| 2c | Storage bucket + policy | Blocks poster upload anywhere but Scene |
| 3 | Split `CreateEventScreen` | Unlocks the shared editor; valuable on its own |
| 4 | Recommendation card + draft payload | The discovery flow, once the gate opens |
