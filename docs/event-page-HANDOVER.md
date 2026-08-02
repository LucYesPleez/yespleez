# Event Page — Handover

**Written 2026-08-01. Branch `v2-react`, pushed at `4296723`.**

Read this first, then `event-page-layout-spec.md` (what the page is) and
`rendering-contract.md` (how anything sparse behaves, app-wide law).

---

## The one thing to understand before touching anything

**WIRED 2026-08-02 (EP-01). `/event/:id` now serves the new page** — see
"EP-01 · the wiring" below. What follows in this section is the state it was
handed over in, kept because the shape of the problem still explains the code.

~~**The new event page is not live.** It renders only at `/#/dev/event-layout`,
against invented fixtures, behind an `import.meta.env.DEV` guard.~~

`/event/:id` ~~still serves~~ *served* `EventPublicView.jsx`, which is the *old*
markup carried over from the extraction — poster, header, sync bar, apply
button, day slots. It imports none of the new sections. **It is still rendered
by the host editor**, which has its own slot grid and chrome; porting that
surface is a separate job.

So: every section described in the layout spec exists, is built and is verified,
~~and none of it is connected to a real event~~ **and is now fed by real rows
through `eventViewModel.js`.**

⚠ The app uses **`HashRouter`**. Routes live after the `#`:
`http://localhost:PORT/#/dev/event-layout`. A path URL renders the home screen
and looks exactly like a redirect bug. It is not one.

---

## What landed

### EP-00 — the extraction (touches live behaviour)

`EventScreen.jsx` went 2023 → 90 lines. It is now a route entry that loads the
event and branches to `EventHostView` or `EventPublicView`. Everything else
moved into `src/screens/event/`.

**A live bug was found and fixed doing this.** `resolvePerformerProfileId` was
called at four sites in `EventScreen.jsx` and never imported. Every call threw
`ReferenceError`. The worst of them: `publishSetTimes` flipped performances to
`offered`, then threw before the notification batch — **publishing set times
notified nobody**, and the lock write at the end never ran either.

### The new page (touches nothing)

Full-width hero cover → one two-column band (event info beside the lineup,
height-matched) → Event Details → Venue + Presented By → poster and
collectables → information sources. Phone reorders three sections; desktop does
not.

---

## EP-01 · the wiring (2026-08-02)

```
useEventData.js      row + owner + VENUE + lineup      the queries
eventViewModel.js    row → section props               pure, 24 tests
EventPage.jsx        props → sections                  arrangement + interaction
EventPageLayout      sections → the page               structure only
```

`EventScreen` routes non-hosts to `EventPage`. The host still gets
`EventHostView` — but its **View as Punter** preview now renders `EventPage`
too, because the banner says "this is how the event looks to the public" and
that sentence has to stay true.

**Nothing outside `eventViewModel.js` reads `event.config`.** Every legacy
spelling is listed once, where it can be tested: `date`/`start_date`,
`endDate`/`end_date`, `ticketLink`/`ticket_url`. Add a field there, not at the
component.

**Two live features were carried across, not dropped** — 3 events have
applications open and 2 publish set times. APPLY TO PLAY goes into the
`quickActions` slot; set times got a **new full-width `setTimes` slot directly
under the Lineup**, which is where the handover suggested it belonged.

### Three things this found

- **The lineup join was broken for every imported event.** `useEventData`
  gated the profile fetch on the legacy `artist_id`, which the Gig Importer
  never writes — it attaches `artist_profile_id` and no user account. 25 of 57
  `lineup_members` resolved to nothing: names with no avatar, no genre, no
  tap-through. Fixed in `lineupProfiles.js`, keyed by `lineup_members.id`,
  9 tests, mutation-checked.
- **The venue profile was never fetched.** `venue_profile_id` is set on 46 of
  50 events and holds the only coordinates that exist — `events.lat/lng` are
  null on all 50.
- **`.fullBand` had no `:empty` rule.** A null-returning section is still a
  truthy element, so its wrapper rendered and collected a 15px flex gap. The
  fixtures never showed it because they always had content; the first real
  event paid 30px of blank page. Same fix `.primary:empty` already carried.

⚠ The harness at `/#/dev/event-layout` **stays**. It is the only way to put a
section into a state no live event produces — 30 artists, a withheld venue, six
detail rows — and those states are still unverified against real data because
no real event has them.

## ⭐ The rule that keeps proving itself

```
npx oxlint --deny no-undef src/
```

**Run it after any extraction or refactor in this codebase.** `vite build`
passes these — they bundle fine and throw at runtime.

It has now caught four separate instances:
- `resolvePerformerProfileId` in `EventScreen` (above)
- four missing imports in the extracted `SlotCard` — **I introduced these**, and
  they would have thrown the first time anyone followed an artist from a slot
- `isRealEvent` in `EventHostView`

Ignore the browser-global false positives: `console`, `setTimeout`,
`clearTimeout`, `ResizeObserver`, `window`, and the Vite defines
`__APP_VERSION__` / `__BUILD_SHA__` / `__BUILD_TIME__`.

**Two pre-existing ones it found are NOT fixed** and are worth a look:
- `src/screens/ArtistDashboard.jsx:314` — `fromProfileId`, inside a
  notification write, so it may mean an unattributed or failed write rather
  than only a crash
- `src/components/ContactSyncSettings.jsx` — `infoDotStyle`, `explainStyle`,
  `limitStyle` at lines 344, 350, 377

---

## Verifying anything here

There is **no EventScreen test**, and the layout is not unit-testable. What
exists instead:

- **741 tests**, 42 of them new — pure resolvers for the hero ladder
  (`heroMedia.js`), event status (`eventStatus.js`), lineup (`lineupDisplay.js`)
  and venue (`venueDisplay.js`). The four hero-ladder rules are mutation-checked.
- **`/#/dev/event-layout`** — the harness. Switch rows across the top flip each
  section through its data cases independently, so you can produce states no
  real event would give you.

⚠ **A green build proves very little here.** The bar that has actually caught
things is: build + 741 tests + the no-undef sweep + loading the page and
measuring it.

⚠ **Measure, do not eyeball.** Several faults in this work looked completely
fine and were only visible in numbers — see the CSS traps below.

### Harness gotchas

- Switch labels repeat across rows (`WITHHELD` and `NONE` appear in both LINEUP
  and VENUE). Scope clicks to the right row or you will get false passes — this
  produced a completely wrong Venue result once.
- The browser pane emits **no scroll events** (it does not composite), so
  anything scroll-driven must be tested by dispatching the event by hand.
- `scroll-behavior: smooth` on the lineup rail means a programmatic `scrollTop`
  animates; read it back too early and you catch it mid-flight.
- Ports 5173/5199/5200/4180 are held by other chats' servers. `v2-layout` on
  **5201** is configured in `Claude Cowork/.claude/launch.json`. Never stop
  another session's server.

---

## CSS traps this page is built on

Each of these was a real fault, diagnosed by measurement. They are commented at
the site, but they are the things most likely to be undone by accident.

**Flex, not grid, for the layout columns.** A grid's tracks exist whether or not
anything occupies them, so a section that renders nothing still reserves its
width — R5's hole exactly. Flex tracks only what is present.

**A `null`-returning component is still a truthy React element.** The JS check
cannot see that a section rendered nothing; only the DOM can. Hence
`.primary:empty` and, where wrapper divs get in the way, `:not(:has(section))`.

**`align-items: stretch` matches the TALLEST column.** With 30 artists the
lineup won and dragged the band to 2652px. The secondary column is absolutely
positioned so it contributes zero height and fills what the primary decides.
Only valid while that column holds exactly one section.

**Grid rows cannot size from `aspect-ratio` or percentage padding.** Both
contribute zero during intrinsic row sizing, so `grid-template-rows` computed to
12.65px while cards drew 164px and fifteen rows stacked on top of each other.
The lineup is flex-wrap with an explicit item width for this reason.

**Specificity beats intent.** `.oBand2 { display: contents }` lost to
`.band { display: flex }` declared later at equal specificity, and the phone
layout rendered Venue and Details above the hero. It is `.band.oBand2` now.

**`--yp-safe-bottom` already contains the nav height.** Offsetting by the nav
*and* padding by safe-bottom counted it twice. The nav renders on every route
including desktop, so the bottom reserve is unconditional.

---

## Decisions that are settled — do not re-litigate

- **The hero image is an artefact, not an information source.** The page never
  reads it. Duplication between what a poster states and what the page states is
  expected and correct.
- **Cover vs Poster are different jobs.** The Cover sells the experience and may
  crop; the Poster preserves the artwork and never crops. The Poster is never a
  hero slide.
- **The crop is chosen, never detected.** The organiser positions a band over
  their poster; we do not guess a focal region.
- **Collect ≠ Favourite ≠ Save.** Collect keeps a *poster* on a profile;
  Favourite follows an *event*; Save-to-phone downloads a file. No shared
  iconography.
- **The status pill does not read `events.status`.** In this codebase `live`
  means *published*. The old screen rendered it as "LIVE NOW", so an event
  published three months early read as happening now. The pill is temporal,
  derived from dates.
- **`BILL` is the lineup's resting order**, not A–Z. The running order carries
  meaning A–Z destroys.
- **Absence never implies a default.** No age row must not read as "all ages" —
  that is a licensing claim made on the organiser's behalf.

---

## Open, and genuinely open

1. **GALLERY vs the poster section.** The layout has a GALLERY slot, currently
   pointed at the poster/collectables section because it is the closest thing
   that exists. But a photo gallery was explicitly ruled out of scope earlier
   ("the Hero carousel is the only surface for Cover and Gallery images"). Needs
   a decision on which it is.
2. **RELATED EVENTS** — slot exists, renders nothing. No component, no data
   path. Same-promoter and same-venue are trivial queries; "similar" is not.
3. **Set times** — asked and never answered. My suggestion was its own section
   directly under the Lineup, since it already has real withheld semantics via
   `showTimesPublicly`.
4. **Confidence is a claim.** Information Sources renders "Confidence: High" and
   nothing computes it. Something must, and be defensible when wrong.
5. **`.presenter*` CSS is dead** in `EventSections.module.css` — it belonged to
   the hand-built block `PortraitCard` replaced. `EventDecision.jsx` is dead too,
   superseded by `EventSummaryCard`. Both safe to delete now that this is
   committed.
6. **The lineup's visible row count is coupled to the context column's height.**
   They are height-matched, so if the event info grows or shrinks, the number of
   artists on screen moves with it. Commented at the site.

---

## Data reality, so nobody designs against a fantasy

50 events. Poster 48, start time 23, end time 13, coordinates 20, lineup 4,
ticket link 8, owner profile 32. **Their intersection is empty** — no event has
everything, which is why the harness uses fixtures.

`events.config` is a JSONB blob with several generations of schema in it: dates
appear as `date`/`start_date`/`endDate`/`end_date`, tickets as
`ticketLink`/`ticket_url`, and `events.lat`/`lng`/`postcode` are empty on all 50
while the populated ones live in `config`.

`venue_profile_id` is set on **46 of 50** and was never read before this work.
`owner_profile_id` is on 32 — which is why Presented By falls back to the venue.
