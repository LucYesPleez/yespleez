# Event Public View — Redesign Roadmap

**Status:** Phase 0 substantially complete — EP-00a, EP-00b, EP-00c, EP-00d landed. EP-00e (tokenising) remains.
**Date:** 2026-08-01
**Scope:** the public-facing event page (`/event/:id`). The host editor is in scope only where it is entangled with the public view.

The reference mock is a **concept**, not a spec. This roadmap treats it as a direction and prices each part of it against the codebase as it actually stands. The mock's desktop top nav (Discover / Map / Calendar / Messages) is explicitly **out of scope** — the app's five-tab bottom nav is settled architecture.

---

## Part 0 — Empty state behaviour (RATIFIED 2026-08-01)

Governed by `docs/rendering-contract.md` (R1–R5). Read that first — these are its application to this page, not a separate policy.

Three owner decisions are baked in below and are not open:
1. **Date & Time does not appear in Event Details.** The hero already states it. Event Details carries only what the hero does not — doors, set times, age, accessibility, what to bring, parking, camping, refund policy.
2. **The owner sees every gap as a prompt** (`No ticket link. [Add Ticket Link]`). The public never sees unfinished work; the organiser always does.
3. **Information Sources is elevated to a trust surface**, not a footnote — contributing sources, last checked, confidence.

### Hero / Gallery
`0 images` → hide the pane, title block goes full width · `1` → single hero, **no dots** · `2+` → carousel with dots.

### Title block
Title and date always (R4 — their absence is a broken record). Status pill only for a known status. Time: start alone → `2:00pm`; start + end → `2:00pm – 11:00pm`; **never invent "– Late"**. Low-confidence date → qualified, never stated as fact. Location degrades venue+locality → venue → locality → omit. Genres: chips at 1+, else omit.

### Stat tiles
Per tile: real value or nothing — **never `0 Going`**. `0 tiles` → hide the row · `1` → single tile, not stretched · `2+` → the row.

### Description
Hide at zero. One source only — never concatenate two description fields.

### Quick actions
Share always (never data-dependent). Calendar only with date **and** start time. Website only for a genuine event/organiser URL — a discovery provenance URL is not one.

### Lineup
`0 artists, absent` → hide · `0, withheld by host` → "Lineup to be announced" (R1) · `1` → single card, no rail/arrow/sort · `2–N` → rail · `>N` → rail + arrow + "View full lineup". Sort control appears only above the count where sorting is meaningful.

### Venue
`coordinates` → map + pin + directions · `address only` → address + address-based directions · `locality only` → name + locality · `name only` → name · `nothing` → hide.
⚠ **Withheld ("secret location") never renders a map even when coordinates exist in the record.** A secret-location event may well carry coordinates; leaking them would break the organiser's decision.

### Event Details
Rows independent; card renders at ≥1 row, hides at 0. Stages: hide at 0 or 1, render at 2+. Tickets: link → "Tickets via <host>", nothing further claimed; no link → hide row.
⚠ **Absence never implies a default.** No age restriction shown must not read as "all ages" — that is a licensing claim made on the organiser's behalf.

### Presented By
Owner profile → full card; missing logo → monogram (never a placeholder person); missing bio → drop the line, keep the card. No owner but a linked venue → venue presents. Neither → hide. Unclaimed owner → card + the existing unclaimed disclosure.

### Information Sources
`manually created` → hide · `discovery-created` → sources + last checked + confidence · `merged` → all contributing sources · `low-confidence` → this card explains the R1 qualifier shown elsewhere. Its presence is itself information: "we found this, we did not write it."

### Sticky action bar
`0 actions` → hide the bar, reserve no height · `1` → full width · `2` → primary + secondary. Primary is Get Tickets when a link exists, otherwise the next available action is **promoted** — never a disabled primary CTA (R3).

### The floor
The minimum legitimate page: **poster-or-not, title, date, status, Share.** That is a finished listing. Everything else is enrichment. If the floor looks deliberate, no amount of sparseness looks broken.

Layout collapse is part of the layout definition: when the secondary column has no surviving cards, the primary column takes full width. Per R5 this requires **one declared section order**, not two hand-positioned columns.

---

## Part 1 — Audit of the current implementation

### 1.1 What existed before this roadmap

`src/screens/EventScreen.jsx` was a single 2,023-line module holding, in one file:

| Concern | Lines (approx) |
|---|---|
| Data loading (events + owner profile + lineup_members + performances + two profile joins) | 60–170 |
| Public render (poster, header, sync bar, tickets, set times, tally, about, location) | 499–1005, interleaved |
| Host render (manage panel, draft/live toggle, editor tab bar, four editor tabs, manage sheet) | 526–872, interleaved |
| Host mutations (`reorderSlot`, `removeArtist`, `publishSetTimes`, `unlockSetTimes`, `saveSlot`, `togglePin`, `respondApp`, `doAssign`, `persistClaimSwap`, `toggleAppsOpen`) | 286–496 |
| Drag-and-drop set-time reordering | 889–979 |
| `SlotEditModal`, `ApplyButton`, `SlotCard`, `SlotManageBtn`, six icons, `ManageSection`/`ManageItem` | 1113–1870 |
| `LineupMemberCard` — **dead code**, superseded by `ProfileCard`, still 151 lines | 1872–2023 |

### 1.2 Findings

**F1 — A live bug (fixed as EP-00a).** `resolvePerformerProfileId` was called at four sites (`removeArtist`, `publishSetTimes`, `respondApp`, `doAssign`) and **never imported**. Only `getPersonalProfileId` and `getPerformerProfiles` were. Every one of those calls threw `ReferenceError` at runtime:

- `removeArtist` — the `performances` row is deleted, then the function throws before `queryClient.invalidateQueries`, so the removal does not appear until a manual refresh, and neither the `slot_removed` notification nor the application reset to `tentative` is written.
- `publishSetTimes` — `performances` are already flipped to `offered` before the throw, so set times publish but **no artist is notified** and no application status advances. The lock write at the end never runs either.
- `doAssign` — the performance is created, then the throw loses the application status update and the slot-offer notification.
- `respondApp` — inside `try/catch`, so the shortlist notification failed silently.

This is exactly the class of defect a 2,000-line file hides, and the strongest argument for Phase 0.

**F2 — The public view is not a separable unit.** The punter page is expressed as negations of host state scattered through the tree: `!effectiveIsHost`, `(!effectiveIsHost || !showEditor || eventTab === 'SET_TIMES')`, `(effectiveIsHost || showTimesPublicly)`. There is no place where "the public event page" exists as a thing you can render, restyle, or test.

**F3 — No test coverage.** No `EventScreen` test exists. The only assertion touching the file was a source-text check in `src/lib/disclosure.test.js` (that `UnclaimedNotice context="apply"` is present). Any refactor here is verified by build, lint, and a person looking at it.

**F4 — Dead code.** `LineupMemberCard` (151 lines) with a comment above it saying it was removed.

**F5 — Two share paths.** `useShareTarget` declares the canonical resource share (per the navigation & sharing architecture) **and** a local `share()` function reads `window.location.href`. The local one is unreferenced.

**F6 — Presentation is inline, not tokenised.** Roughly 60 inline `style={{…}}` objects carry hardcoded hex (`#00E5A0`, `#BF5FFF`, `#FF8C42`) rather than CSS variables. Any visual redesign has to touch all of them, and none of them respond to a token change.

### 1.3 What the data model actually holds

Everything the page reads today:

```
events.name, .status, .description, .blurb, .applications_open,
       .host_id, .owner_profile_id
events.config { date, endDate, venue, location, bio, poster, poster_full,
                genres, days[], ticketLink, set_times_locked,
                host_controls_config.showTimesPublicly }
lineup_members, performances, profiles (joined)
follows  (the heart — entity_type 'event')
```

Note `config` is a JSONB blob. Adding presentational fields there is cheap; anything that needs to be **queried, aggregated, or secured** must become a real column or table.

---

## Part 2 — Phase 0: Architecture

### EP-00a — Fix the missing import ✅ LANDED

**Purpose** Restore four broken host mutations.
**Scope** One import line.
**Existing data** —. **New data** —. **Migration** —. **Backend** —.
**UI** none. **Dependencies** none. **Complexity** Small.
**Risk** none; strictly restores intended behaviour.
**Acceptance** Removing an artist updates the list without a refresh; publishing set times sends slot-offer notifications; assigning a slot from the shortlist advances the application to `offered`.

### EP-00b — Component extraction ✅ LANDED

**Purpose** Make the file navigable and give the redesign real components to work on.
**Scope** Move self-contained components out of `EventScreen.jsx` verbatim. No behaviour change.

Created `src/screens/event/`:

| File | Contents | Used by |
|---|---|---|
| `slotUtils.js` | `parseDurMins`, `fmtDur`, `LABEL_PALETTE`, `labelColor`, `stripEmoji` | both |
| `SlotCard.jsx` | `HeadphoneIcon`, `SlotCard`, `SlotManageBtn` | both (read-only vs editable by props) |
| `SlotEditModal.jsx` | slot time/duration/label editor | host |
| `ApplyButton.jsx` | APPLY TO PLAY + acting-profile choice + `UnclaimedNotice` | public |
| `manageMenu.jsx` | six icons, `ManageSection`, `ManageItem` | host |

`EventScreen.jsx`: 2,023 → 1,110 lines. `LineupMemberCard` deleted. Unused imports removed (`ApplicationCard`, `UnclaimedBadge`, `UnclaimedNotice`, `socialProfileUrl`/`ensureHttps`, `useSortable`, `CSS`).
`src/lib/disclosure.test.js` repointed at `screens/event/ApplyButton.jsx` — the disclosure site moved, the requirement did not.

**Complexity** Medium. **Risk** low (mechanical move, verified by build + 698 tests + lint).
**Acceptance** Build green; 698/698 tests pass; no new lint errors; event page renders identically for punter, host-editor-off, and host-editor-on.

### EP-00c — Extract the data layer ✅ LANDED

**Purpose** One place that knows how to load an event, so the public view and the host view can be rendered independently.
**Scope** `src/screens/event/useEventData.js` — the `useQuery` block (query fn, the two profile-resolution joins, `claims`/`lineupMembers`/`memberPerfMap`/`memberProfiles`) plus the derived values (`cfg`, `isHost`, `isPast`, `totalSlots`, `takenSlots`, `lineupPct`, `isLocked`, `draftCount`, `allMixSlots`).
**Affected** `EventScreen.jsx`.
**New data / migration / backend** none.
**UI** none. **Dependencies** EP-00b. **Complexity** Medium.
**Risk** The derived values are computed after early returns today (`if (loading)`, `if (!event)`); moving them into a hook means they must tolerate `event === null`. Getting that wrong shows as a blank page, not an error.
**Acceptance** Build green, tests pass, page identical. `EventScreen.jsx` contains no `supabase.from('events').select`.

### EP-00d — Split public from host ✅ LANDED

**Result.** `src/screens/event/` now holds `EventPublicView.jsx` (140), `EventHostView.jsx` (709), `DaySlots.jsx` (130), and `EventScreen.jsx` is 90 lines of route entry. The public view renders standalone: verified in the running app as a guest, where `EventPublicView` is the only thing on the page and `EventHostView` is never imported into the render.

`DaySlots` came out as its own component rather than living in either view — it is the one piece both genuinely share. Without `editable` there is no `DndContext` at all; without `isHost` every action handler is null. The four host closures it used to capture (`setFillSlot`, `setEditingSlot`, `removeArtist`, `togglePin`) became props.

**Two defects found during the split, both invisible to `vite build`:**
- `SlotCard.jsx` was missing four imports after EP-00b — `useSession`, `getPersonalProfileId`, `resolveProfileId`, `track`/`EVENTS`. They were free identifiers resolved by EventScreen's own imports before the move. Following an artist from an expanded slot would have thrown.
- `EventHostView` referenced `isRealEvent`, which does not exist there.

Both were caught by `npx oxlint --deny no-undef`, not by the build. **This is the same defect class as EP-00a** (a call with no binding, which bundles fine and throws at runtime). Run that sweep after any extraction in this codebase — it is the only check that catches it. The same sweep found four pre-existing instances elsewhere: `ArtistDashboard.jsx:314` (`fromProfileId`) and `ContactSyncSettings.jsx` (`infoDotStyle`, `explainStyle`, `limitStyle`).

**Also removed:** the local `share()` (F5) — dead, `useShareTarget` is the canonical path. The follow logic moved to `event/useEventLike.js`; its toggle was already unreachable in EventScreen (declared, never called, no control rendered), so this is dead code given a home rather than a regression. Its effect is NOT dead and still runs — it warms the shared `likedEvents` cache. EP-02 renders the heart and calls `toggleLike`.

---

#### EP-00d — original plan (retained for the record)

**Purpose** The deliverable of Phase 0: `EventPublicView` exists as a component you can render, restyle, and screenshot on its own.
**Scope**
- `event/EventPublicView.jsx` — poster, header, sync bar, `ApplyButton`, tickets, set-times/lineup (read-only), tally, about, location.
- `event/EventHostView.jsx` — manage panel, draft/live toggle, editor tab bar, the four editor tabs, manage sheet, go-live sheet, unlock confirm, `FillSlotModal`, `SlotEditModal`, assign-slot sheet, DnD.
- `EventScreen.jsx` — route entry: call `useEventData`, handle demo ids / loading / not-found, then branch.

**Behaviour to preserve exactly:** with the editor **off**, the host sees the manage panel *above* the full public view; with it **on**, the editor tabs replace the public content except on `SET_TIMES`, which shows the same day/slot list in editable mode. `viewAsPunter` renders `EventPublicView` with the preview banner and no manage chrome. This is why `SlotCard` had to become shared rather than duplicated.

**New data / migration / backend** none. **Dependencies** EP-00c. **Complexity** Large.
**Risk** Highest in the roadmap and there is no test net (F3). Mitigation: land EP-00c first, keep the JSX moves verbatim, and verify all six states by hand (punter / guest / host-editor-off / host-editor-on ×4 tabs / view-as-punter / past event).
**Acceptance** All six states visually identical to pre-refactor. `EventPublicView` renders correctly given only `{ event, cfg, claims, days }` and no host props.

### EP-00e — Tokenise the inline styles

**Purpose** Make Phase 1 a change to variables rather than a sweep of 60 style objects.
**Scope** Replace hardcoded hex with the existing CSS variables; move repeated style objects into `EventScreen.module.css` (or a new `EventPublicView.module.css`).
**Complexity** Medium. **Dependencies** EP-00d. **Risk** low, visible immediately.
**Acceptance** No literal hex remains in the public view's JSX; page unchanged.

---

## Part 3 — Phase 1: UI Redesign

Everything here is buildable on the current schema. Nothing in this phase requires a migration.

### EP-01 — Layout shell
**Purpose** The structural decision the rest of the mock rests on: two columns on desktop, stacked on mobile.
**Scope** A grid wrapper. Primary column: hero, lineup, event details. Secondary column: venue, presented-by, actions. Below a breakpoint it collapses to today's single column at the current max width.
**Existing data** all. **New data** none. **Migration** none. **Backend** none.
**UI** New layout CSS; every section becomes a placed child rather than a sibling in a flow.
**Dependencies** EP-00d. **Complexity** Medium.
**Risks** The page currently assumes `max-width: 680px` centred. The full-bleed hero background (`heroBg`/`heroBgDark`/`heroBgFade`) is positioned against that assumption and will need rework. The bottom nav's reserved space must survive (`bottom: var(--yp-nav-height)`).
**Acceptance** No horizontal scroll at 320/375/768/1280. Bottom nav unobstructed at every width.

### EP-02 — Hero
**Purpose** Answer what / when / where / should-I-care above the fold.
**Scope** Poster, title, live-status pill, date range, location, genre tags, favourite, share.
**Existing data** `name`, `status`, `config.{poster_full, date, endDate, venue, location, genres}`; favourite via `follows`; share via `useShareTarget`.
**New data** none. **Migration** none. **Backend** none.
**UI** Restyle `header` + `syncBar` into the mock's status-pill-over-title treatment; genre tags become chips (`config.genres` is a string today — split for display only, do not restructure the field).
**Dependencies** EP-01. **Complexity** Medium.
**Risks** The mock shows a poster carousel with dot pagination; there is exactly one poster. Render a single image, no dots — do not build a carousel for one item.
**Acceptance** Title, date, location, status and genres visible without scrolling at 375×812. Favourite writes to `follows` with `entity_type: 'event'`. Share yields the canonical `/event/:id` URL.

### EP-03 — Event details card
**Purpose** Replace the two bare `infoCard`s with the mock's icon-led detail rows.
**Scope** Date & time, tickets (link only), and any `config` fields present. **Render only what exists** — no empty rows, no placeholder text.
**Existing data** `config.{date, endDate, ticketLink}`, `description`/`blurb`.
**New data** none — but note the mock's "2 Stages", "18+ · Photo ID", "What to Bring" have **no fields**. They are EP-11 (see Phase 2), not this milestone.
**Complexity** Small. **Dependencies** EP-01.
**Risks** Temptation to stuff free text into `config` to fake the mock. Don't — an unqueryable string is not a feature.
**Acceptance** A minimal event (name + date only) renders with no empty cards.

### EP-04 — Venue card
**Purpose** The mock's venue block, minus the map.
**Scope** `config.venue` + `config.location`, secret-location handling, and a link to the venue profile where one is linked.
**Existing data** `config.{venue, location}`.
**New data** none for text. **A map needs coordinates** — `lib/geo.js` + `AU_POSTCODES` can place a locality, so a coarse map is possible; a pin at the exact address is not, and events having no reliable location is a known gap (see `project_discovery_21`).
**Complexity** Small (text) / Medium (map).
**Risks** Showing a coarse locality pin as if it were the venue is worse than no map. If the map ships, label it as an area.
**Acceptance** Venue renders with no map when location cannot be resolved.

### EP-05 — Lineup presentation
**Purpose** The mock's horizontal artist rail — the biggest visual delta available for free.
**Scope** A rail of artist cards (avatar, name, location) above the existing set-times list, built from `lineupMembers` + `memberProfiles`, which are already loaded. "View full lineup" expands.
**Existing data** all of it, already in the query.
**New data / migration / backend** none.
**UI** New rail component; `SlotCard` list unchanged beneath it.
**Dependencies** EP-00d, EP-01. **Complexity** Medium.
**Risks** Rail drag speed is settled at `DRAG_SPEED = 1` in `useDragScroll` — reuse it, don't re-tune. No visible scrollbar (global rule); use a gradient edge cue. The mock shows a star badge on each artist with no defined meaning — omit it rather than invent one.
**Acceptance** Rail respects `showTimesPublicly` — it may show *who* is playing while set times stay hidden, if that is the intent; if not, it hides with them. **This needs an owner decision.**

### EP-06 — Sticky action bar
**Purpose** Keep the primary action reachable.
**Scope** Mobile: a bar above the bottom nav. Desktop: an action card in the secondary column.
**Existing data** `config.ticketLink`, `follows`, `applications_open`.
**New data** none. Buttons are limited to what exists: **Get Tickets**, **Favourite**, **Share**, **Apply to Play**. "Going" / "Interested" are EP-10.
**Dependencies** EP-01. **Complexity** Medium.
**Risks** The bottom nav is sacred — the bar sits at `bottom: var(--yp-nav-height)`, never over it. Any overlay must portal to `body` (`.header`'s transform traps `position: fixed`).
**Acceptance** Bar never overlaps the nav on any device; nav remains tappable.

### EP-07 — Motion & skeletons
**Scope** Replace the flat skeleton block with a shape matching the new layout; add image fade-in and section reveals.
**Complexity** Small. **Dependencies** EP-01–EP-06.
**Acceptance** No layout shift between skeleton and loaded state.

### EP-08 — Responsive refinement
**Scope** 320 → 1440 pass; touch targets; a real empty state for an event with no lineup, no poster, no ticket link.
**Complexity** Medium.
**Acceptance** Verified at 320/375/768/1024/1440.

---

## Part 4 — Phase 2: Platform Features

Each of these is a project, not a section. Listed in the order I would build them.

### EP-10 — Going / Interested
**Why not today** No attendance concept exists. `follows` is a *favourite* — one row per `(user_id, entity_id)`, UNIQUE — and cannot express two distinct intents, nor be counted per event without a scan.
**Schema** `event_attendance (event_id, profile_id, state 'going'|'interested', created_at)`, unique on `(event_id, profile_id)`.
**Write path** Toggle from the sticky bar, attributed to the Personal profile (per the identity architecture — attendance is a personal act).
**Aggregates** A count function, not an open table read — same shape as the EQ read-receipt aggregate. Reading the raw table would expose *who* is going to anyone who asks.
**Permissions** RLS: a user reads/writes only their own row; counts come from a `SECURITY DEFINER` function.
**Realtime** Not for v1. A count that updates on refresh is fine; live counts invite a subscription per viewer.
**Complexity** Project. **Depends on** EP-06.
**Risk** Deciding `follows` can carry a second meaning. It can't — the heart is already the favourite, and overloading it breaks My Scene.

### EP-11 — Ticket & event metadata
**Why not today** Price, capacity, remaining, sales-end, age restriction, dress code, what-to-bring have no fields. Only `config.ticketLink` exists.
**Schema** Descriptive fields (age restriction, dress, what-to-bring) can go in `config` — they are display-only. **Price, capacity and remaining cannot** — they are commercial claims that must be queryable and are wrong the moment they are stale. Tickets are sold off-platform today, so "remaining" is unknowable and should not be shown at all until native ticketing exists.
**Complexity** Medium (descriptive) / Project (commercial).
**Suggested order** Descriptive fields with EP-03; commercial fields deferred to native ticketing.

### EP-12 — Timeline schedule
**Why not today** `config.days[].slots[]` holds a time string and a duration, with no stage dimension and no doors-open. The mock's "Day Stage 2pm–9pm / Night Stage 9pm–Late" needs a stage per slot.
**Schema** `stage` on the slot (in `config`, since slots already live there) + `doors_open`.
**Write path** The set-times editor gains a stage field — a change to the host editor, which is why EP-00d must come first.
**Complexity** Large. **Depends on** EP-00d.
**Risk** Touches the frozen lineup/set-times model. Read the Lineup philosophy before starting.

### EP-13 — Host statistics
**Why not today** Follower counts and past-event counts are not aggregated anywhere.
**Schema** none new — `follows` and `events` hold the data; needs count functions and caching.
**Complexity** Medium.

### EP-14 — Media gallery
**Why not today** One poster, in `config`. No event media table, no bucket.
**Schema** `event_media` + a storage bucket (never merged with the four existing buckets).
**Permissions** Public-read bucket for public events; private events need the proxy pattern used by Beta Feedback attachments.
**Complexity** Project.

### EP-15 — Related events
**Why not today** No similarity model. Same-venue and same-promoter are trivial queries; "similar" is not.
**Suggested scope** Ship same-promoter and same-venue only. "Similar events" is a My Scene concern and must respect the My Scene philosophy (attention, not events; ladders, not scores).
**Complexity** Medium (scoped) / Project (similarity).

### EP-16 — Community activity
**Why not today** No comments, no updates, no friends-attending. Friends-attending additionally needs EP-10 *and* the contact graph, and is a privacy decision before it is a feature — it discloses one user's plans to another.
**Complexity** Project. **Depends on** EP-10, Phone Discovery.
**Risk** Highest privacy surface in the roadmap. Do not start without a privacy-copy pass (every topic ends with a limit).

---

## Part 5 — Phase 3: Future Expansion

Explicitly out of scope: weather, accommodation, ride sharing, food vendors, merchandise, livestream, lost & found, QR check-in, ticket transfers, event memories, AI recommendations, event chat, emergency alerts.

Two notes: **event chat** is not a new system — it belongs to Messaging Architecture v2 and must be designed there or not at all. **AI recommendations** is My Scene's territory and is constrained by the ratified My Scene philosophy.

---

## Part 6 — Mock vs. platform

**Where the mock exceeds the platform.** 320 Going · Tickets On Sale · price · capacity · 18+/Photo ID · What to Bring · two named stages with times · venue map pin · parking/transport · host follower count · comments · friends attending · media gallery · related events. None of these have a field behind them.

**Presentation only — buildable now.** Two-column layout · hero composition · status pill · genre chips · icon-led detail rows · artist rail · venue card (text) · presented-by card · sticky action bar · all motion and polish.

**Actually independent projects.** Going/Interested · commercial ticket data · timeline with stages · media gallery · community activity · similarity-based related events.

### Minimum viable redesign

**EP-01 → EP-02 → EP-05 → EP-06 → EP-03 → EP-04 → EP-07 → EP-08.**

Zero migrations. Delivers the two-column shell, the hero, the artist rail, the sticky CTA and the restyled cards — approximately 80–90% of the mock's visual impact. The remaining 10–20% is the stat numbers, and those are Phase 2.

Priority after that is **EP-10 (Going/Interested)**, because it is the only Phase 2 item that changes how the page *feels* rather than adding another slab of content.

---

## Open decisions

1. **EP-05** — does the artist rail respect `showTimesPublicly`, or may the bill be public while set times stay hidden? These are arguably two different announcements.
2. **EP-04** — ship a coarse locality map, or no map until real venue coordinates exist?
3. **EP-06** — what occupies the secondary action slot before EP-10 lands? The mock has "Invite Your Crew", which does not exist.
4. **EP-11** — confirm that commercial ticket data waits for native ticketing rather than being hand-entered and going stale.
