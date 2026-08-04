# Event media, Requirements Engine P4/P5, venue maps — handover, 4 Aug 2026

Branch `v2-react`, level with `main` and with origin at **`08c1412`**. **874 tests passing**
(`npm test` in `v2/`), build clean.

Everything below was verified against the live database or a live browser unless it says otherwise.
Where something is unverified it says so — those are the parts to check first.

---

## 1 · What shipped

| Area | Commits | Migration | State |
|---|---|---|---|
| Requirements Engine **P4** (opportunity requirements) | `7ac96a9` | `20260803000000` | ✅ applied |
| Requirements Engine **P5** (submission snapshot) | `7ac96a9` | `20260803000001` | ✅ applied |
| Availability by profile | `7ac96a9` | `20260803000002` | ✅ applied |
| Profile assets (PA1) | earlier | `20260802000000` | ✅ applied |
| Apply-form link to the editor | `c1c1b21` | — | ✅ |
| Venue maps — Coffs centring + framing | `c927ec1` `f8891fd` | — | ✅ regenerated |
| Cover / Poster separation | `d903e7d` `f59fa08` | — | ✅ |
| Posters never cropped on upload | `b9f833f` | — | ✅ |
| Cover band selector actually saves | `1111f55` | — | ⚠ see §4 |
| Poster crops → carousel, with zoom | `d7fdaec` `6d21d38` `42a70f2` | — | ✅ |
| Carousel: one ordered line, drag to reorder | `31e5a60` `c4ab3e7` `92588a1` | — | ✅ |
| Directions no longer aim at a postcode centroid | `08c1412` | — | ✅ |

All four migrations confirmed present in production before deploying:
`events.required_items`, `applications.requirements_snapshot`, `artist_availability.profile_id`,
`profile_assets`.

---

## 2 · The two findings that generalise

### 2.1 · A postcode centroid is not a place

`AU_POSTCODES` holds **one coordinate per postcode**. For a postcode covering one town that is the
town. For a postcode covering a town *plus* a rural hinterland it is neither — it is the geometric
middle, which can sit tens of kilometres from anyone.

It bit twice this week, through different doors:

- **The map.** 2450's centroid is ~50km north-west of Coffs Harbour, in the ranges. The venue map
  drew creek country for a venue on the coast. Fixed with `TOWN_CENTRES` in
  `scripts/generate-venue-maps.mjs`.
- **Directions.** The Bellingen Brewing Co has `lat/lng = -30.4598,152.8403` on its own profile,
  which is `AU_POSTCODES['2454']` to the digit. GET DIRECTIONS opened Kalang. Fixed with
  `navCoords` in `eventViewModel.js`.

**⚠ The data is still wrong.** Both fixes stop the symptom; neither corrects the stored coordinate.
Any future feature that trusts `profiles.lat/lng` will hit this again — see §5.

### 2.2 · A renderer with nothing feeding it is not "built"

`heroMedia.js` has had the full ladder — cover + gallery carousel, crop, blur — since it was
written. `EventHero.jsx` has had the snap track and the dots. **Rungs 1–3 had never once fired in
production**, because `eventViewModel` passed `cover: null` and `gallery: []` hardcoded, and the
editor only ever collected a poster.

Similarly the editor's "Adjust crop" control has existed since the editor was built and **never
saved anything** — `posterPos` went nowhere, and `cfg.posterCropY` (which the view model reads) was
written by nobody.

Worth carrying forward: *rendering code existing* is not evidence a path works. Ask what writes it.

---

## 3 · The media model, as it now stands

Layout spec §0 was already ratified; this session made it real.

```
COVER      → Hero at the top. May crop. Sells the experience.
+ up to 5  → carousel, swipe + dots (heroMedia rung 1)
POSTER     → § 11, whole and never cropped. Preserves the artwork.
```

**Storage** stays `cfg.cover` + `cfg.gallery[]` + `cfg.poster`, because that is what the ladder
reads and rung 2 (cover, no gallery) must stay distinguishable from rung 1. The **editor** joins
them into one ordered list on load and splits them on save — so the UI stops talking about two
things that are one thing, without changing the storage contract.

**Editor** (`CreateEventScreen`): an `EVENT MEDIA` block with **COVER IMAGE | EVENT POSTER** tabs,
and a six-slot image strip *outside* the tabs, always visible. Slot 1 is the cover. Crops taken
from the poster land in the strip.

Storage folders, all in the `posters` bucket:

| Folder | Contents |
|---|---|
| `event_covers/` | covers uploaded via the editor |
| `event_gallery/` | crops taken off a poster |
| `event_posters/` | posters uploaded via the editor |
| `official/` | organiser-authored posters uploaded by hand |
| `YesPleez Calendar pics/` | legacy promo/calendar images |

**Every upload converts to WebP** (`canvasToBlob`, JPEG fallback only if the browser cannot encode
WebP). Direct uploads to storage from a script bypass this — the Thelma Plum poster was already
`.webp`, which is the only reason it is fine.

---

## 4 · Not verified end to end — check these first

These are built and compile; nobody has driven them with a real signed-in user.

1. **The carousel has never rendered with real slides in production.** Make two crops on a live
   event, save, and confirm the top of the event page swipes and shows dots. If anything is wrong
   it will be in `EventHero`'s rung-1 path, which has never executed.
2. **The cover band selector's SAVE.** `1111f55` wired the write; I confirmed the band renders and
   the geometry matches `heroMedia`, but never pressed Save on a real event and re-read the row.
   Test on an event *without* a cover: drag the band somewhere obvious, save, reload the public
   page, confirm the hero moved.
3. **REPLY / MESSAGE in the booking dossier sheet.** Opens a conversation between two profiles via
   `openDirectConversation`. Rendered, never clicked against live data.
4. **The apply flow with requirements ticked.** Tick a couple on an event, apply as a performer,
   then:
   ```sql
   SELECT id, created_at, jsonb_pretty(requirements_snapshot) FROM public.applications
    WHERE requirements_snapshot IS NOT NULL ORDER BY created_at DESC LIMIT 3;
   ```
5. **Asset upload against production storage.** `ProfileAssetsSection` shipped; no real file has
   been pushed through it. PA2's two public-logo policies were never run, per project memory — if a
   press kit upload fails, look there first.

---

## 5 · Google Maps live — read this before starting

The owner intends to put a live Google Map in the venue section eventually. Three things will
matter:

**Venue coordinates are not trustworthy today.** At least one venue stores its postcode centroid as
its own `lat/lng`, and imported venues likely do the same. A live map pinned from `profiles.lat/lng`
would drop pins in paddocks. Size it first:

```sql
SELECT id, name, postcode, lat, lng FROM public.profiles
 WHERE type = 'venue' AND lat IS NOT NULL;
```

…then compare each against `AU_POSTCODES[postcode]` (in `v2/src/lib/postcodes.js`) — an exact match
means it is a centroid, not a venue. `eventViewModel`'s `navCoords` already does this comparison and
can be lifted out if a second caller needs it.

**The static-map economics are deliberate.** Today the provider is called **once per postcode**,
ever, and the image is served from our own bucket — so the free tier is never a constraint and no
key reaches the client. A live embedded map is per-view and per-key. That is a real cost change, not
a swap.

**`TOWN_CENTRES` becomes redundant, but the reason for it does not.** The correction table in
`generate-venue-maps.mjs` exists because one coordinate per postcode cannot frame a town. A live map
centred on a real geocoded venue address would not need it — a live map centred on
`profiles.lat/lng` would need it just as much.

The durable fix underneath all of this is **geocoding the venue's own address once, at save time,
and storing that** — which would retire `TOWN_CENTRES`, `navCoords`, and this whole class of bug
together.

---

## 6 · Decisions taken this session, and why

| Decision | Reason |
|---|---|
| Every ticked requirement is **mandatory**, file or field | Owner override of design §5.2. One tick = one requirement; no second state to explain. Only an *unrecognised* key stays non-blocking, so a stale requirement cannot trap an applicant. |
| Event ownership restricted to **venue + host** | Owner override of identity v1.3 `O-R4` ("any profile type"). `OWNER_ELIGIBLE_TYPES` is now hand-listed, deliberately — the old derivation made a new profile type owner-eligible for free, which is what the override removes. |
| Requirements snapshot stores the **verdict**, not the profile | Copying profile fields would re-create the copy-by-value the identity migration removed, and would rot. `required_items` is duplicated into the snapshot on purpose so a host editing their checklist later cannot rewrite what was asked. |
| Readiness is **live**, requirements are **snapshotted** | "How complete is this act" is a question about now; "did they meet what I asked" is a question about a moment. |
| Posters are **never cropped** on upload | Spec §0.1. Cards crop at display time via `object-fit`, reversibly. A pre-cropped file destroyed information to duplicate what CSS already did. |
| The image strip sits **outside** the media tabs | "What have I got and how much room is left" does not stop mattering because you switched to the poster — and cropping the poster is what fills the strip. |
| No CAROUSEL tab | Its panel owned no controls; adding and reordering both happen in the strip. A tab that owns nothing is a place to look for something that is not there. |

---

## 7 · Smaller things worth knowing

- **`inferToProfileId` was decoupled from `getOwnerProfiles`.** Narrowing `OWNER_ELIGIBLE_TYPES` to
  venue/host would have made a notification lookup for `'artist'` silently return a venue profile.
  No live caller hits it today; it was primed to misfire. Now uses `getProfilesOfType`.
- **`EnquiryCard`'s FEE and EMAIL rows had never rendered.** The dashboards' batch query never
  selected those columns, and `.filter(([, v]) => v)` dropped the rows silently. Column lists are
  now derived from the engine (`COMPLETION_COLUMNS`, `ENQUIRY_CARD_COLUMNS`) so they cannot drift.
- **`sendEnquiry` and `ApplyButton` now write notifications.** Neither did. `new_application` had a
  UI label and an expiry policy since Phase 13 and *nothing had ever written one*.
- **A performer's dashboards were account-keyed, not profile-keyed.** One person's DJ, band and
  comedy profiles showed each other's bookings, applications and offers, and shared one availability
  calendar. Fixed across four queries plus the availability table.
- **`launch.json` cut from 6 dev-server configs to 2** (`preview` on 5173, `gigimporter` on 4000).
  Five orphaned `.cmd` scripts deleted. `start-v2-lan.cmd` went with them — if phone-on-WiFi testing
  is needed, use a `cloudflared` tunnel from **cmd**, not PowerShell.
- **Latent, not fixed:** the N4 expiry sweep compares `ve.id = (data->>'enquiry_id')::uuid`, but
  `venue_enquiries.id` is **bigint**. It only fires for *held* `availability_request` rows, which
  this path cannot currently produce — one business-rule change away from being live.

---

## 8 · Verification habits that earned their keep

- **`oxlint --deny no-undef` after any refactor.** It caught `fromProfileId` being block-scoped and
  read outside its block — accepting a venue invite threw a ReferenceError before the notification
  wrote, so the button appeared to do nothing. `vite build` compiles that happily.
- **Measure the DOM, do not trust the screenshot.** The crop window looked right and was landing
  somewhere else entirely: a `maxHeight` on the container meant a percentage overlay computed
  against 320px while the poster was 648px tall. The crop taken was not the crop shown.
- **Mutation-check every new test.** Each regression test added this session was verified to fail
  when its guard is reverted.
- **A stale console is not a clean one.** Errors citing older HMR `?t=` stamps are from mid-edit
  states; open a fresh tab before concluding anything.
