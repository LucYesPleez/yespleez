# Event Page — Permanent Layout Specification

**Version 3 · 2026-08-01** — media model made explicit: Cover, Poster, and up to five additional images.

Governs the layout of the public Event Page. Degradation behaviour is **not** in this document — that is `rendering-contract.md` (R1–R5, frozen) and Part 0 of `event-public-view-redesign-2026-08.md`. This document assumes a complete, high-quality event and describes where things go and why.

No section may be added or removed here without a decision recorded in this file.

---

## Principle 0 — The media model

**The Cover sells the experience. The Poster preserves the artwork.** Different jobs, different objects, different slots.

An event holds **three kinds of media**, and they are never interchanged:

| | **Event Cover** | **Official Event Poster** | **Gallery Images** |
|---|---|---|---|
| Count | 1 | 1 | up to 5 |
| Purpose | Emotion and atmosphere | The canonical artwork | More of the experience |
| Content | Crowd, performance, venue, landscape, festival photography | The flyer as the organiser made it | Same register as the Cover |
| Orientation | Landscape | Whatever it is — usually portrait | Any |
| Fit | **Fills. May crop.** | **Fits. Never crops.** | **Fills. May crop.** |
| Renders in | § 1 · Hero carousel | § 9 · Official Event Poster | § 1 · Hero carousel |
| Action | — | **Collect** | — |

**One surface each. Closed 2026-08-01.** The Hero carousel is the *only* place Cover and Gallery images render. They do not appear again anywhere on this page — not as thumbnails, not as a strip, not behind another section. Likewise the Poster renders only in § 9.

A future Photo Gallery — photos of the night, after the event — is a **separate feature and outside this specification**. Do not reserve space for it here, and do not treat Gallery Images as a stand-in for it.

**The Poster never appears in the Hero carousel, and the Cover never appears in the Poster section.** They are separate objects with separate jobs; the only bridge between them is the derivation ladder in §0.3, and even then the Poster still renders whole in its own section.

**The Poster is the canonical artwork.** Where an event has both, the Poster is the authored object of record; the Cover is a presentation asset serving the top of the page.

### 0.1 The Cover may crop. The Poster may not.

This reverses Version 1, and the reason is that Version 1 asked one image to do both jobs.

The Cover is atmosphere. It carries no information the page depends on, so cropping it costs nothing — a crowd shot works cropped. It fills its frame edge to edge, because a cinematic image with bars down the sides is not cinematic.

The Poster is the artwork. Cropping it deletes content the organiser designed and paid for — dates, lineup, ticket source, sponsor marks, all typically near the edges. It is shown whole, at its own aspect, always viewable at full resolution.

**Consequence:** the pillarboxing and height-capping machinery from Version 1 is obsolete. A wide Hero at a fixed aspect cannot punch the Band A hole that portrait posters used to, so the cap exists only as a viewport ceiling, not as a hole remedy.

### 0.2 The page still never reads either one

Unchanged from Version 1. Information printed on a poster is *poster content*, not page data. Duplication between what a poster states and what the page states is expected and correct. The page does not read the image, does not adapt to it, and does not suppress a field because the artwork happens to mention it.

### 0.3 The Hero fallback ladder

The Hero is a *role*, not a file. It is filled by the first rung that can be satisfied:

```
1  Event Cover + gallery images     → carousel, dots at 2+ only
2  Event Cover alone                → static Hero, fills frame
3  Landscape artwork                → static Hero, fills frame
4  ORGANISER-CHOSEN crop of poster  → the region the organiser positioned
5  Default crop of poster           → top-weighted band, no choice made yet
6  Blurred poster treatment         → scaled to cover, heavily blurred and
                                      darkened; atmosphere, not information
7  No Hero                          → section hidden (R1 · absent)
```

Rungs 1–3 are genuine Cover media. Rungs 4–6 are **derivations** from the Poster, and three rules govern them:

- **The Poster section renders regardless.** A poster-derived Hero is never a substitute for the poster — the whole point of the split is that the artwork is preserved separately, whole, at full resolution.
- **A derived Hero must not read as a second copy of the poster.** The Hero is a wide band; the Poster is a whole portrait artefact. Different shape, different job.
- **Rung 4 beats rung 5 because it is chosen, not guessed.** See §0.4.

**Rung 5's default is top-weighted, not centred.** Posters carry their title and headline artwork near the top; a centred landscape band through a portrait poster tends to catch the middle of an illustration or a block of small type. Top-weighted is the better default until the organiser moves it.

Rung 7 hides the Hero. Per R5 the band collapses and the summary takes the full width — it does not sit beside a reserved void.

### 0.4 Choosing the crop — the Cover selector

**The crop region is chosen by the organiser, not detected by us.** This closes the question Version 2 left open, and it closes it by removing the guesswork rather than improving it.

In the event editor, the poster is shown with a **landscape band overlaid on it**, labelled as what it is — *this section shows as the cover at the top of your event page*. The organiser drags the band up and down the poster until it frames what they want. What they leave it on is stored and is what the public Hero renders.

Design notes for that control, recorded here because they follow from this document even though the editor itself is host-side and specified elsewhere:

- The band's aspect **must match the live Hero frame exactly**, or the organiser is composing against a lie.
- The band moves along the poster's long axis only. It is a position, not a free-form crop — no resize, no rotate, no zoom.
- A live preview of the resulting Hero should sit beside it. Composition is judged on the result, not on the marquee.
- Until the organiser touches it, the band sits at the rung-5 default so the page always has something legitimate to show.

**Uploading a dedicated Cover supersedes the crop entirely.** Rungs 1–3 outrank 4–7; a real cover image always wins over a derivation, and choosing a crop never blocks uploading a proper cover later.

---

## Canonical section order

One declared sequence. The desktop two-column layout is a **projection** of it, never a separate arrangement. Mobile renders this order unmodified.

| # | Section | Reader's question |
|---|---|---|
| 1 | Hero | What is this like? |
| 2 | Event Summary — Identity | When and where? |
| 3 | Event Summary — Decision | Can I get in? |
| 4 | Event Summary — Description | What is it? |
| 5 | Quick Actions | What else can I do with it? |
| 6 | Lineup | Should I care? |
| 7 | Venue | How do I get there? |
| 8 | Event Details | What do I need to know? |
| 9 | **Official Event Poster** | *(the artefact)* |
| 10 | Presented By | Who is behind it? |
| 11 | Information Sources | How do we know? |
| — | Sticky Action Bar | fixed, outside the flow — mobile only |

---

## Top to bottom

### 1 · Hero — the Event Cover
Primary column, leading. Renders the Cover, per the ladder in §0.3.

**Frame.** A fixed cinematic aspect — **3:2 on desktop, 16:9 on mobile** — that the image fills.

3:2 rather than something wider is deliberate. At a 657px primary column, 3:2 gives a 438px frame against a secondary column that runs ~507px, so Band A closes up with a ~69px difference. A 16:9 desktop hero would be 370px and open a ~137px gap under itself. Mobile has no facing column, so the wider ratio is free there and reads better as a banner.

**A note on going full-bleed.** A Hero spanning the whole content width would be more cinematic still, but it displaces the summary stack and forces a rebalance of Band A — that is a page restructure, not a media change, and is deliberately not taken here. It remains available as a separate decision.

**Cap.** `70vh` mobile, `clamp(400px, 62vh, 700px)` desktop. With a fixed aspect this is now only a ceiling for extreme viewports, not a remedy for anything.

**Carousel.** The Cover leads; gallery images follow in the organiser's order. Maximum six slides — one Cover plus five. Dots at 2+ only; one dot is a bug, not a state. Horizontal snap, no visible scrollbar.

**This is the only surface for these images.** They render here and nowhere else on the page.

Every slide fills the same fixed frame and may crop. Gallery images are atmosphere, held to the same standard as the Cover, and a portrait phone photo cropped to a wide band is an acceptable outcome for atmosphere in a way it would never be for artwork.

**The Poster is never a slide here.** It has its own section, and a poster squeezed into a cinematic band is the exact failure this revision exists to prevent.

**No overlaid controls.** See §9.2 — the Favourite lives beside the title in § 2, not on an image.

### 2 · Event Summary — Identity
Secondary column, top, aligned to the Hero's top edge. **Uncontained** — sits directly on the background rather than in a card, so it does not compete with the containers below it.

Order: status pill → title + Favourite → when → where → genres.

The title is the largest type on the page. The Favourite sits in the same row, to its right — moved here from the Decision block on 2026-08-01. It reads as part of the headline rather than as a second action competing with the ticket CTA for the same row. On a wrapped multi-line title the button stays level with the *first* line rather than drifting to the vertical centre.

**Chip language — resolved 2026-08-01.** Three meanings had one appearance, which is a scanning failure. They now differ structurally, not decoratively:

| | Form | Meaning |
|---|---|---|
| **State** | Filled, carries a dot, colour means something | Something is true right now |
| **Taxonomy** | Reuses the Featured/Spotlight card pill (`FeaturedEventCard.module.css` `.tag`) — translucent fill, cyan border, blurred | What kind of thing this is |
| **Control** | Affordance + hover | Something you can press |

A reader should be able to tell which of the three a chip is without reading it. Genres are never coloured individually — colour would imply a ranking between genres that does not exist — but they DO carry one uniform accent, because that accent is the app's existing genre-pill identity: My Scene's Spotlight rail renders `FeaturedEventCard` directly, so Featured and Spotlight already share one pill style, and Identity's genre chips now match it rather than inventing a fourth visual language.

**The status pill does not read `events.status`.** In this codebase `status: 'live'` means *published* — the other half of the host's DRAFT/LIVE toggle — and the old event screen rendered it as "LIVE NOW", so an event published three months early read as though it were on right now. A punter cannot see drafts at all, so publication state carries no information for them. The pill shows **temporal** state, derived from the dates: `PAST EVENT`, `ON NOW`, or nothing. Upcoming gets no pill — the date already says it (R3).

Date granularity only. Times exist on well under half of events, so an hour-accurate "on now" would be a guess dressed as a fact for most of them.

### 3 · Event Summary — Decision
Immediately below Identity. Contained.

Holds the **primary CTA** — the strongest interactive element on the page. Attendance sits alongside as supporting context at clearly lower weight, never as a peer tile.

**Rationale:** the ticket action must not be rendered as a statistic. In the reference concept it appears as a passive tile beside a headcount while the actual CTA is pinned to the bottom of the screen, furthest from the lineup and description that motivate it. The conversion action belongs beside the content that earns it.

On desktop this block becomes sticky within the secondary column on scroll.

**The Favourite does not live here — moved 2026-08-01 to sit beside the title in Identity (§ 2).** It reads as part of the headline now rather than as a second action competing with the ticket CTA for the same row. This block is R1 · absent when there is neither a ticket link nor attendance to show — an event with neither can still be favourited, because that control no longer depends on this card existing.

### 4 · Event Summary — Description
Below Decision, visually distinct from it. The organiser's voice. Generous line height. Clamped past roughly four lines with a reveal.

### 5 · Quick Actions
Below Description, closing the secondary column's first group. Share · Add to Calendar · Website. Low emphasis, evenly weighted, no primary among them.

**One window, not three loose pills — resolved 2026-08-01.** Each action originally carried its own border, which made the row read as three unrelated buttons rather than one group of utilities, and put the same visual weight on "Share" as the Decision block gave its own ticket action above it. The row now shares that card treatment; the actions inside it are separated by a divider rather than each carrying a border of its own.

**Collect does not belong here.** It is an action on an artefact, not a page utility. See §9.2.

*Group boundary — increased vertical separation.*

### 6 · Lineup
**Primary column. Not full width — resolved 2026-08-01.**

Version 1 said the Lineup "may take the full content width", while the Explicitly Optimal list said "Venue paired beside Lineup". Both could not hold: a full-width Lineup breaks Band B into two stacked rows and orphans the Venue below it.

Resolved in favour of the pairing — "who is playing" and "where is it" are scanned together, and that adjacency was called optimal deliberately. The width the full-bleed option was chasing is bought instead with card sizing: **112px cards in a 657px primary column show 5.4 artists**, against the reference concept's four. The bill gets its extra visibility without costing the Venue its place.

Heading · count · sort control · horizontal rail · overflow affordance · full-lineup entry.

**Ordering.** `BILL` — the organiser's own order — is the default and the resting state, because it carries meaning A–Z destroys: who headlines, who opens, how the night is shaped. A–Z is a lookup aid.

**The sort control appears at 8+ artists.** Below that you can take the whole bill in by scanning, and a control that reorders something already absorbed is a button earning nothing.

**Overflow affordances are measured, not counted.** Whether the bill fits depends on the column, which depends on the viewport, so the arrow, the gradient and the full-lineup entry are all driven by the actual layout rather than by an artist count. Offering "view all" for a bill entirely on screen is a link to what the reader is already looking at.

**The arrow is gated on pointer, not width** — `(hover: hover) and (pointer: fine)`. A touch user swipes; the button would only sit over the third card and take a slot the bill could have used. On touch the cue is the gradient plus the rail's own first-visit nudge, which is the app's established idiom.

**No decorative badges on artist cards.** Avatar, name, location, nothing else. A missing avatar is a monogram, never a placeholder person — the same rule Presented By uses for a missing logo.

### 7 · Venue
Secondary column, top-aligned with Lineup. Name · locality · map · directions.

**Map size follows map precision.** A region-level pin in a large frame reads as an error rather than an intention. Where a location is withheld, the notice leads and the map yields.

*Group boundary.*

### 8 · Event Details
Primary column, below Lineup. Icon-led rows, one per fact. Visually lighter than Lineup.

**Contains no date and no tickets.** Date is stated in Identity; tickets are consolidated into Decision and the Sticky Action Bar. What remains is genuinely secondary — doors, set times, stages, age, accessibility, what to bring, parking, camping, refund policy.

### 9 · Official Event Poster
**Secondary column, first item of Band C**, above Presented By.

#### 9.1 Why here

**Why the secondary column.** The poster is usually portrait, and the secondary column is the narrower one — at ~475px a 1080×1528 poster renders ~672px tall at its own aspect, with no bars. The same poster in the 58% primary column would need pillarboxing, which is exactly what this whole revision exists to stop. A portrait artefact belongs in a portrait-shaped slot.

**Why Band C.** The poster answers none of the decision questions — the Hero, Lineup and Decision block have already done that work by the time the reader reaches it. What it belongs with is authorship: *here is the artwork, here is who made it, here is how we know*. Poster → Presented By → Information Sources is one coherent thought, and Band C is the reference group where that thought lives.

**Why not higher.** It no longer carries the page's visual weight. Placing it above Lineup or Venue would restore exactly the competition with the Hero that the split removed.

#### 9.2 The Collect action

Collect lives **on the poster**, not in Quick Actions and not in the Decision block. It is an action on an artefact, and it belongs to the object it acts on.

**Collect is not Favourite and not Save.** Favourite follows an *event*. Collect keeps a *poster* — digital memorabilia, a permanent artefact on the collector's profile. Different verb, different object, different outcome.

**They must not share iconography.** No heart, no bookmark, no star for Collect. The mark must be distinct enough that nobody reads it as "save this event", and the label should say **Collect** in words rather than relying on an icon alone.

**Consequence — the Favourite moves off the Hero.** This resolves the open question carried since Version 1. With Collect overlaid on the poster, a Favourite overlaid on the Hero would put two circular controls on two images on the same page, which will read as the same control no matter how they are drawn. The clean division is:

> **Image overlays are reserved for artefact-level actions. Event-level actions live off the image.**

So Collect stays on the poster; the Favourite lives with the event's own identity instead. **Placed beside the title in § 2 (moved there from an initial stop in the Decision block, 2026-08-01)** — it reads as part of the headline rather than as a second action sharing the ticket CTA's row. Exactly one overlaid control exists anywhere on the page, and it is Collect.

#### 9.3 Behaviour

- Rendered at the poster's own aspect. **Never cropped.**
- **Always viewable at full resolution** — the poster opens to a full-screen view. This is not optional; it is what makes the artefact an artefact.
- Renders even when the Hero was derived from this same poster (ladder rungs 4–6). The crop at the top of the page takes nothing away from the whole artwork here.
- One poster per event.
- Hidden when there is no poster (R1 · absent).
- Emphasis: moderate. Visual, so it draws the eye regardless — it does not need help, and must not out-weigh the Lineup.

### 10 · Presented By
Secondary column, below the Poster. Logo · name · role · bio · profile entry.

Emphasis slightly above where the reference concept places it. This is the page's primary trust signal, particularly for imported or unclaimed events where the reader is deciding whether the event is real.

### 11 · Information Sources
Secondary column, last card, grouped with Presented By. Sources · last checked · confidence. Lowest emphasis on the page, fully legible when sought.

**Rationale:** the artwork, its author, and its provenance are one thought — *what it is, who says so, how we know*. Placed last because it answers a question the reader only asks once already sceptical; earlier, it surfaces doubt to readers who had none.

### Sticky Action Bar
**Mobile only.** Sits above the bottom nav, never over it. Maximum two actions; the secondary must earn its place.

**Does not render on desktop.** The Decision block's in-column sticky behaviour replaces it.

---

## Layout rules

**Columns.** Primary ~58%, secondary ~42%.

**The spacing groups and the desktop rows are the same structure.** Each group is one desktop row-band, and each band's DOM runs `[primary column][secondary column]`:

```
Band A  1 Hero           │ 2 Identity  3 Decision  4 Description  5 Quick Actions
Band B  6 Lineup         │ 7 Venue
Band C  8 Event Details  │ 9 Poster  10 Presented By  11 Information Sources
```

Read top-to-bottom, left-to-right within each band and you get 1–11 — the canonical order exactly. Consequences:

- **Mobile requires no reordering at all.** Bands stack, columns inside them stack, and the result is canonical. No `order` property anywhere.
- **The alignment points come free.** Identity tops out level with Hero, Venue level with Lineup, Poster level with Event Details — each is the first item of its band. Nothing is measured or matched.
- Within a band the columns are independent: the shorter one ends where it ends. Nothing stretches, nothing fills. R5 is satisfied by the band boundary, not by padding a column out.

Gaps: within a group 16px (mobile) / 20px (desktop); between groups 40px / 56px. **Verified across the whole page:** every within-group gap measures a single value, and the group boundary is a clear 2.8:1 against it.

### Weight tiers

Order alone does not create hierarchy. Measured whole, the reference sections were rendering **pixel-identical** — same 17px heading, 16px padding, border, background and radius — which is precisely the flatness that made the concept read as "everything matters equally", reproduced in weight instead of spacing.

Three tiers, not eleven. Fine ordering between peers is carried by position; only the extremes need their own treatment:

| Tier | Sections | Treatment |
|---|---|---|
| **1** | Lineup | Uncontained, 20px heading |
| **2** | Venue · Event Details · Poster · Presented By | Card, 17px heading |
| **3** | Information Sources | No fill, fainter border, 13px muted heading |

Information Sources is the only section the spec calls "lowest emphasis on the page", so it is the only one demoted. Five gradations of card would be noise.

### The Poster is bounded

Measured at full column width the poster card came out **745px — the tallest element on the page**, above the Hero (438) and 2.8× the Lineup (263). § 9.3 requires moderate emphasis and that it "must not out-weigh the Lineup", and the entire point of splitting Cover from Poster was that the poster no longer carries the page's visual weight. At full width it carried the most.

The image is now bounded by **height** (430px), which leaves the aspect untouched — nothing is cropped, the artwork is simply not given more room than its job needs, and full resolution is one click away. Poster card: 745 → **551**, a peer of Venue (520). The Hero still holds 2.2× the poster's visual area.

### Column imbalance — measured, and permitted

| Band | Primary | Secondary | Empty in | Gap |
|---|---|---|---|---|
| A | 438 | 474 | primary | **36** |
| B | 263 | 520 | primary | **257** |
| C | 446 | 968 | primary | **522** |

This is the shorter column ending, which this document permits and which the band boundary absorbs. Two honest notes:

- **Band B's 257px is the more visible of the two**, because content continues below it; Band C's sits at the end of the page where content simply stops.
- The structural alternative for Band C is swapping its columns — Poster to primary, Details + Presented By + Sources to secondary — which narrows the gap to ~399px but requires exchanging sections 8 and 9 in the canonical order. **Not taken:** a reorder of the reading sequence is too high a price for ~120px, and it would put the artwork ahead of the practical detail in a band whose job is reference.

Reducing Band B further means either shrinking the Venue's map or enlarging the artist cards, and the latter trades directly against the "show more of the bill" decision in § 6. Neither is worth it.

**Columns are flex, not grid — and that is load-bearing.** A grid's column tracks exist whether or not anything occupies them, so a section that renders nothing still reserves its width, which is precisely the hole R5 forbids. Flex tracks only what is present: an empty column is hidden and the survivor takes the full width with no further rule. This also catches the case a JS check cannot — a section component that returns `null` is still a truthy React element at the call site, so only the DOM knows it rendered nothing.

**Emphasis order**, highest to lowest:
Title → Primary CTA → Hero → Lineup → Description → Venue → Event Details → **Poster** → Presented By → Quick Actions → Attendance → Information Sources.

**Mobile.** Single column, canonical order, unmodified. Hero full-bleed at 16:9. Lineup rail scrolls horizontally with a gradient edge cue and no visible scrollbar. Sticky bar above the nav.

**Breakpoints.** The two-column projection applies above the wide breakpoint only. There is no intermediate three-column or reordered state — one order, two projections.

---

## Explicitly optimal — unchanged from the reference concept

- Hero leading the primary column
- Lineup before Venue — correct question order
- Venue paired beside Lineup on desktop *(and the Lineup stays in the primary column to preserve it — see § 6)*
- Event Details as an icon-led lookup table below the lineup
- Presented By low in the secondary column

---

## Resolved

- **Tall-hero hole** (V1) — obsolete. The Hero is a fixed wide aspect and cannot cause it.
- **Favourite placement** (V1) — moves off the Hero. First stop was the Decision block; moved again on 2026-08-01 to sit beside the title in § 2, once it read as competing with the ticket CTA for the same row. Image overlays are reserved for artefact-level actions; Collect is the only one.
- **Focal detection** (V2) — obsolete. The organiser positions the crop (§0.4); we never guess. Rung 5's top-weighted default covers the untouched case.
- **Where gallery images surface** (V3) — **closed 2026-08-01.** The Hero carousel is the only surface for Cover and Gallery images; they do not render again anywhere on this page. A future Photo Gallery is a separate feature, outside this specification.
- **Chip differentiation** — resolved 2026-08-01, see § 2. State / taxonomy / control differ structurally.

## Open

1. **Full-bleed Hero** — available as a separate decision; it restructures Band A and is out of scope for a media revision.
2. **Band A's inverse gap on long content.** With a long title, eight genres and a long description, the summary column runs 214px past the Hero clamped, 331px expanded — whitespace under the Hero before Band B. This is the shorter column ending, which this document explicitly permits, and the sticky Decision block partly covers it on scroll. Measured, not estimated. Judge it in the spacing pass rather than growing the Hero to match text length, which would make the artwork's size depend on how much the organiser wrote.

---

## Implementation status

**Built and verified:** the layout shell (bands, flex-column collapse, canonical-order projection) and the Hero, rebuilt for the Cover model.

The ladder is a pure function (`heroMedia.js`) with 14 tests, because a render condition that cannot be tested is one nobody trusts. All four rules were mutation-checked — a centred default, a gallery image leading without a cover, a removed slide cap, and a removed crop/blur guard each fail a test.

Measured at 1280×800, primary column 657px:

| Rung | Frame | Fit | Object position | Notes |
|---|---|---|---|---|
| 1 Cover + gallery | 657×438 (3:2) | cover | 50% 50% | 6 slides, 6 dots — cap holds |
| 2 Cover only | 657×438 | cover | 50% 50% | static, no dots |
| 3 Artwork | 657×438 | cover | 50% 50% | static |
| 4 Chosen crop | 657×438 | cover | **50% 62%** | the organiser's position |
| 5 Default crop | 657×438 | cover | **50% 22%** | top-weighted |
| 6 Blurred | 657×438 | cover | 50% 50% | filter applied |
| 7 No Hero | — | — | — | band collapses, summary at full width |

**Band A closes to 3px.** The 3:2 desktop choice lands almost exactly on the secondary column's natural height. Band B and Band C both top-align. The Poster sits in the secondary column at 475px, Event Details in the primary at 657px.

**Mobile (390×844):** 16:9, 358×201 — **24% of the viewport**, against 60% under Version 1's portrait Hero. Identity now begins at y=399 of an 844px screen, so the whole summary clears the fold comfortably. The V1 fold concern is closed by the cinematic frame, not by shrinking type.

**The Summary trio** (Identity · Decision · Description) is built and verified across seven content cases at 1280×800 and 390×844.

**⚠ Superseded by the 2026-08-01 revision below:** the CTA/Favourite table originally here described the Favourite living inside the Decision block, promoted to full width when there was no ticket link. That block no longer exists — the Favourite moved beside the title (§ 2) and renders identically regardless of content case, so it is no longer part of Decision's own degradation. Current behaviour:

| Case | Pill | Decision block | Description |
|---|---|---|---|
| Complete | — | CTA + 320 going | full |
| Minimal | — | **R1 · absent, no card at all** | — |
| Long everything | — | CTA + 1284 going | clamped + MORE |
| No tickets | — | **12 going alone, no CTA row** | full |
| On now | **ON NOW** | CTA + 64 going | full |
| Past | **PAST EVENT** | **210 going alone, no CTA row** | full |
| Unconfirmed date | — | **R1 · absent** | — |

The Decision card now hides entirely rather than promoting the Favourite to fill it — an event with neither a ticket link nor an attendance count has nothing left for this block to say, and the Favourite doesn't need it to exist.

No horizontal overflow in any case. Title clamps 30→46px and wraps to three lines on the longest title without widening its column, and the Favourite stays level with the title's first line rather than drifting to vertical centre.

**Mobile:** the primary CTA sits at y=722 of an 844px screen — hero, title, date, location, genres *and* the ticket action all clear the fold. The Decision block is `static` on mobile and `sticky` only from 1024px, so the mobile sticky bar remains the mechanism there and takes no viewport on desktop.

**The Lineup** is built and verified across seven bill cases at 1280×800 and 390×844:

| Case | Renders | Cards visible | Sort | Arrow / fade | View all |
|---|---|---|---|---|---|
| 30 artists | rail | **5.4** | BILL ⇄ A–Z | yes | yes |
| 5 artists | rail | 5.4 | no | no | no |
| 2 artists | rail | — | no | no | no |
| 1 artist | single card | — | no | no | no |
| Withheld | **"TO BE ANNOUNCED"** | — | no | no | no |
| Absent | **section hidden** | — | — | — | — |
| Long names | rail | — | no | no | no |

A–Z sorts case-insensitively (`Air Max 97, Andras, Brawther, CC:DISCO!`) and toggles back to the bill order (`Locklead, Jesse M, Tiana, Brawther`) without mutating it.

**R5 verified at the band level:** with the Lineup absent, Venue takes the full 1152px of Band B while Band C is untouched — one band collapses, the others do not.

Mobile: 2.9 cards visible at 390px, no visible scrollbar, no page overflow.

**Every remaining section** — Quick Actions, Venue, Event Details, Official Poster + Collect, Presented By, Information Sources, Sticky Action Bar — is built and verified.

**Venue ladder**, all six rungs. The one that matters: the withheld case carries a `mapUrl` in the fixture and still renders **no map, no address, no directions** — only the name, the area and the notice. Withheld is checked before coordinates are consulted at all, because a secret-location event may well hold coords from an import or an earlier geocode.

| Rung | Map | Address | Directions | Notice |
|---|---|---|---|---|
| map | ✅ | ✅ | ✅ | — |
| address | — | ✅ | ✅ | — |
| locality | — | — | ✅ | — |
| name only | — | — | ✅ | — |
| **withheld (coords present)** | **—** | **—** | **—** | ✅ |
| none | *section hidden* | | | |

**Poster:** renders at natural ratio 0.707 against an intrinsic 0.707 — uncropped, confirmed by measurement. Collect toggles `COLLECT POSTER` ⇄ `COLLECTED`. The full-resolution viewer opens with `object-fit: contain` and closes on Escape or click.

**Presented By** falls back to the venue as presenting entity when no owner is known, and hides when neither exists. **Information Sources** hides entirely for a manually created event and shows contributors, last-checked and confidence for a discovered one. **Event Details** hides at zero rows, renders at one or more.

**Sticky bar promotion:** with tickets, `GET TICKETS` (250px) + `SAVE`; without, `SAVE EVENT` promoted to the full 338px. Never a disabled primary.

**A layout bug found and fixed here:** the sticky bar sat 148px above the viewport bottom against a 69px nav. The wrapper was offset by `--yp-nav-height` *and* padded by `--yp-safe-bottom`, which already contains it — the nav height counted twice, leaving 79px of dead space. Now offset by `--yp-safe-bottom` (which also clears the player, so it stays correct while a track is playing) with a flat 10px pad: the bar clears the nav by exactly 10px, and the reserved page padding keeps the last section from being trapped under it.

**Not built:** the Cover selector (host-side).
