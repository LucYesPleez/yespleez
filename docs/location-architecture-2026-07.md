# Location Architecture — review, gap analysis and recommendation

**Status: RECOMMENDATION, awaiting ratification.** Written 2026-07-25 for Discovery 2.1.
Sections 1–3 are findings verified against code and live data. Section 4 is the architectural
recommendation and is the part that needs a decision.

---

## 1 · Architecture review — what already exists

The location stack is **already complete as a data pipeline**. Nothing here needs inventing.

```
Town / Suburb  →  SUBURB_MAP        (lib/auLocations.js, 738 suburbs)
      ↓
Postcode       →  AU_POSTCODES      (lib/postcodes.js, 3,174 postcodes)
      ↓
Latitude / Longitude
      ↓
Haversine distance                  (MySceneScreen.jsx:104, inline)
```

| Piece | Where | State |
|---|---|---|
| `AU_POSTCODES` postcode → `[lat,lng]` | `lib/postcodes.js` | ✅ 3,174 entries. **Imported by exactly one file.** |
| `SUBURB_MAP` name → postcodes | `lib/auLocations.js:3` | ✅ 738 suburbs + `resolveLocationToPostcodes`, `suggestLocations` |
| `formatLocation()` | `lib/formatLocation.js` | ✅ canonical display formatter; already handles the venue `suburb` vs artist `location` schema split |
| `normaliseRegion()` | `lib/analytics.js:292` | ✅ exact-match text → postcode, privacy-constrained (A3) |
| `haversineKm()` | `MySceneScreen.jsx:104` | ⚠ **inline in a component**, re-created every render, one call site |
| `profileCoords()` | `MySceneScreen.jsx:111` | ⚠ inline. The fallback chain: `p.lat/p.lng` → postcode centroid → `null` |
| `postcodeCoords()` | `MySceneScreen.jsx:120` | ⚠ inline |
| Working radius filter | `MySceneScreen.jsx:1103-1111` | ✅ **proven in production.** `radius 0` = same-postcode equality, `>0` = haversine |
| `navigator.geolocation` | — | ✅ **never called anywhere.** Confirmed by full sweep. |

**`events.venue_profile_id` already exists** and is populated on 24 of 39 events. The venue-owns-
location model is already the schema; it is simply not yet *read* by any filter.

**Nothing occupies `src/lib/geo.js`.** That is the natural home for the extracted helpers.

---

## 2 · Gap analysis — what is genuinely missing

### 2.1 Controls that do not filter

| Screen | Control | Status |
|---|---|---|
| Discover | Search, Category (type) | ✅ real |
| Discover | Genre | ⚠ **partial** — client-side substring on `genre_string`, and **events are exempted**, so picking a genre never removes an event |
| Discover | State, Location text | ⚠ **partial** — profiles only; events are never location- or state-filtered |
| Discover | **Radius slider** | ❌ decorative — `radiusKm` appears only in its own label |
| Discover | **`radius` state** | ❌ **dead** — declared, never rendered, only reset |
| Discover | **Near me** | ❌ decorative — only clears postcode + disables the input |
| Discover | **Date pills** | ❌ decorative |
| What's On | Category chips | ⚠ **partial** — applied to the three sections but **not** to the selected-date view |
| What's On | **Postcode, Radius** | ❌ decorative |
| What's On | Date tabs | ⚠ not a filter at all — they scroll to a section; all sections always render |
| My Scene | Postcode + radius pills | ✅ **fully functional** — the reference implementation |

### 2.2 Defects found while tracing (pre-existing, not caused by this work)

1. **`MySceneScreen.jsx:1022` calls `setFollowLocFilter(null)`, which is never declared.** Clicking
   "View all" on FOLLOWING/UPDATES when `hasMore` is true throws a `ReferenceError`. This is a live
   crash on the reference implementation.
2. **NZ postcodes collide with Australian ones.** `auLocations.js:279-293` maps NZ towns to NZ
   4-digit codes; **21 collide** with real `AU_POSTCODES` keys. Typing "Wellington" (`6011`) resolves
   to **Perth**; "Christchurch" (`8011`) to **Melbourne**; "Hamilton" (`3204`) to Bentleigh VIC.
   This corrupts both the My Scene radius filter and Discover's `postcode.eq` clause. `STATE_OPTIONS`
   includes `NZ` and `International`, so this is reachable by design, not by accident.
3. **What's On chip highlight**: `category === 'ALL'` makes *every* chip render active, so the screen
   opens looking like all five categories are selected at once.
4. **`MySceneScreen.jsx:1149`** — `followRadius && !postcodeValid` — `followRadius === 0` is falsy, so
   the "enter a valid postcode" hint can never show in exact-postcode mode.
5. **Event edit never re-derives `venue_profile_id`** (`CreateEventScreen.jsx:398`). Renaming a
   venue on an existing event leaves a stale link.
6. **A venue's dashboard lists events by `host_id`; its public profile lists by `venue_profile_id`**
   (`VenueDashboard.jsx:60` vs `ProfileScreen.jsx:97`). The two can legitimately disagree.

---

## 3 · Data quality report

Live counts, 2026-07-25.

**Profiles** — 53 total; 21 with a postcode; 6 with `lat`/`lng`.
**Venues** — 4 total; 2 with postcode **and** coords; 2 with neither.
**Events** — 39 total (30 live); 24 with `venue_profile_id` (15 live);
**0 events carry their own postcode or coordinates.**

### Live-event location resolvability: **9 / 30**

| Blocker | Live events blocked | Fix |
|---|---|---|
| No `venue_profile_id` | **15** | link to a venue profile (10 of them name one that exists) |
| `Bellingen Memorial Hall` has no postcode | **5** | set `postcode = 2454` |
| `Bellingen Memorial Hall (The Basement / Old Supper Room)` has no postcode | **1** | set `postcode = 2454` |

### ⚠ One venue unblocks sixteen events

**"Bellingen Memorial Hall" accounts for 16 of the 21 unresolvable live events** — 6 through the two
profiles that lack a postcode, and 10 more that name it as free text with no link at all. Both
profiles have `suburb = "Bellingen"`, `state = "NSW"`, and **Bellingen is already in `SUBURB_MAP` as
2454**, so the postcode is derivable with no research.

**There are also two profiles for the same physical hall** ("Bellingen Memorial Hall" and
"…(The Basement / Old Supper Room)"). That is a room-vs-venue modelling question, not a data typo —
flagging rather than merging.

### ⚠ Free-text venue names that are NOT permanent venues

Of the 15 unlinked live events, the names include **"Multiple Venues"**, **"Dorrigo Showgrounds"**
and **"Vabooshna"**. These are *live evidence* that venue-independent events already exist in the
real data — a showground, a multi-venue festival, and an informal location. They cannot be fixed by
linking to a venue profile, because no appropriate permanent venue profile exists or should exist.

**This is the empirical case for Section 4.**

---

## 4 · RECOMMENDATION — the long-term event location architecture

### 4.1 Recommendation: **RETAIN `events.postcode` / `lat` / `lng`.**

An earlier suggestion in this session was to drop them as dead duplication. **That was wrong for this
product**, and the live data proves it: "Multiple Venues", "Dorrigo Showgrounds" and "Vabooshna" are
already in the database today with nowhere to put a location.

YesPleez is built for a scene whose events are frequently **not at permanent venues**: bush doofs,
festivals, pop-ups, warehouse parties, beach parties, parks, private property, markets. Requiring a
venue *profile* for every event would force one of two bad outcomes:

- **junk venue profiles** — a "profile" for a paddock, permanently unclaimable, polluting Discover,
  the claims queue and Unclaimed Value; or
- **locationless events** — doofs invisible to every location filter, i.e. the underground scene
  excluded from the discovery features built for it.

Retaining event-owned location is therefore **not duplication — it is a distinct case**. Duplication
would be storing the *venue's* location on the event. Storing a *doof's own* location on the event is
the only place that fact can live.

### 4.2 Resolution order (single source of truth preserved)

```
if (event.venue_profile_id)      → venue profile's location    ← venue owns it, always wins
else if (event.postcode|lat/lng) → the event's own location     ← venue-independent events
else                             → no location; excluded from distance filters
```

The single-source-of-truth guarantee holds because the two are **mutually exclusive by precedence**,
not by hope: when a venue link exists, the event's own columns are *never read*. A venue changing its
postcode still corrects every one of its events at once.

### 4.3 When event location should be populated

**Only when `venue_profile_id` is NULL.** Populate it when the event is at:
a one-off or temporary site; a bush/outdoor location; a pop-up or warehouse; a multi-venue festival
(use the hub/box-office point); any place that should not become a permanent claimable profile.

**Never** populate it to "cache" or "denormalise" a linked venue's location. That is the failure mode
this precedence rule exists to prevent.

### 4.4 How conflicts are avoided

1. **Precedence, not merging.** A linked event's own columns are dead data; readers never consult
   them, so they cannot disagree with the venue.
2. **A single reader.** All location resolution goes through one `eventCoords()` in `lib/geo.js`.
   No screen implements its own order.
3. **Clear at link time.** When an event gains a `venue_profile_id`, null its own location columns —
   the venue now owns that fact. This keeps "populated" and "authoritative" the same thing.
4. **Warn on both.** An event with a venue link *and* its own location is a data smell; surface it
   rather than silently preferring one.

### 4.5 Validation — Studio

- Flag any event with **neither** a venue link nor its own location (today: 21 of 30 live).
- Flag any event with **both** — offer "clear event location, keep venue" as the one-click fix.
- Flag venue profiles with **no postcode** — ranked by how many events each blocks, so the operator
  sees "Bellingen Memorial Hall — 6 events" and fixes the highest-leverage row first.
- On import, attempt `config.venue` → existing venue profile by name, and **propose** the link rather
  than applying it. (`CreateEventScreen.jsx:432` already learned this lesson the hard way: an earlier
  auto-link stamped all 24 events with the creator's own venue and had to be repaired in M14c.)
- Validate a typed postcode against `AU_POSTCODES` **before** save, not at read time.

### 4.6 Validation — app

- `CreateEventScreen` should offer venue-link **or** a location field, never both at once, chosen by
  a simple "is this at a registered venue?" control.
- A postcode must exist in `AU_POSTCODES` to be saved; reuse the same guard as the profile editors'
  `PostcodePrompt`.
- **Fix the NZ collision before any of this ships** (§2.2.2) — a country-aware guard belongs in
  `lib/geo.js`, because a filter that silently relocates Wellington to Perth is worse than no filter.
- Events with no resolvable location must be **excluded explicitly and visibly** from radius results,
  never silently dropped — see §4.7.

### 4.7 ⚠ The coverage problem this exposes

With 21 of 30 live events unresolvable, **switching on a radius filter today would hide 70% of
What's On.** The same applies to Discover: only 21 of 53 profiles have a postcode.

A distance filter that silently removes most of the catalogue is worse than no distance filter. So
the recommendation is: **fix the data first, ship the filter second**, and when it ships, show
unlocated results in a labelled "location unknown" group rather than dropping them.

---

## 5 · Proposed sequence

1. **`lib/geo.js`** — extract `haversineKm`, `postcodeCoords`, `profileCoords`; add `eventCoords()`
   implementing §4.2 and a country-aware postcode guard (§2.2.2). Refactor My Scene to use it;
   behaviour unchanged. *(No schema or data dependency — safe to do first.)*
2. **Data fix** — set `postcode = 2454` on the two Bellingen Memorial Hall profiles; link the 10
   free-text events. Unblocks 16 events on its own.
3. **Discover** — make Radius, Near Me and Date genuinely filter, reusing `lib/geo.js`. Remove the
   dead `radius` state.
4. **What's On** — venue resolution via `eventCoords()`; enable postcode + radius.
5. **Analytics** — per filter, as it becomes functional: start writing the applied key, stop writing
   its `*_intent`. Never redefine an existing prop (A3 contract).
6. **Hide what cannot ship** — any control still non-functional at the end is removed or hidden.
