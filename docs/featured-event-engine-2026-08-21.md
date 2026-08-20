# Featured Event engine — V1

**Status:** built 2026-08-21. Engine, tests and What's On wiring are live in the tree.
Migration `fe1_featured_allocation` is **written but NOT applied**.

**The constitutional rule:**

> Featured exists to distribute useful exposure fairly, not to reward whoever is
> already biggest or whoever pays the most.

Files: `apps/scene/src/lib/featuredEvent.js` · `featuredEvent.test.js` ·
`useFeaturedAllocations.js` · `screens/WhatsOnScreen.jsx` ·
`supabase/migrations/20260821000000_fe1_featured_allocation.sql`

---

## 0 · The defect this replaces

`WhatsOnScreen.jsx` selected the hero with `events.find(ev => ev.config?.featured)`
over a list `useEvents` had already filtered to today-onwards. Exactly one event in
the whole database has ever carried the flag — *Beyond Jazz Weekender 2026*, dated
**15 Aug 2026**. From **16 Aug** it fell out of the list, `find` returned `undefined`,
and the heading, the card and every fallback vanished together. Nothing logged it.

A second defect sat directly underneath: `{!featuredEvent && !loading && <p>No
upcoming events.</p>}`. "Is one event featured?" is not "are there any events?", so
from 16 Aug that line printed **"No upcoming events."** at the foot of a page listing
nineteen of them. Both are fixed.

---

## 1 · What the audit found, and what it cost the design

Three factors in the intended weight table have **no data source**, for reasons that
are architectural rather than incidental.

| Factor | Weight | Status |
|---|---|---|
| Proximity | 25% | Available |
| Quality / completeness | 15% | Available |
| **Genuine popularity** | 15% | **Unavailable** |
| Local relevance | 10% | Available, currently inert |
| Discovery / lesser-known | 15% | Available via the ledger |
| **Organic engagement** | 10% | **Unavailable** |
| **Paid promotion** | 10% | **Unavailable** (no payments system) |

**Popularity and engagement are blocked twice over, independently.**

1. `usage_events` never records an event id. `normaliseScreenPath()` in
   `lib/analytics.js` rewrites `/event/<uuid>` to `/event/:id` **on the client**, and
   its own comment names this as the privacy control implementing
   `analytics-vision-2026-07.md §8` — not tidiness. `followed` carries
   `{entity_type:'event'}` and nothing else; `shared` carries `{resource:'event'}`
   and nothing else. The table also has **no SELECT policy at all** and is REVOKE'd
   from anon and authenticated.
2. `follows` is read-your-own-only under RLS (`follows_select_own`), so a client
   counting saves on an event gets 1 or 0, never a total.

And measured anyway, on 2026-08-21: **27 event saves across 17 of 90 events, top
event 4.** One person's heart would reorder the slot.

Get Tickets and Directions clicks are completely uninstrumented — the highest-intent
signals available, currently discarded. Adding event-attributed tracking is a
**values decision that breaches the ratified privacy rule**, so it is not taken here.

### The resolution: null and renormalise, never a silent zero

A factor with no source returns `null`, is dropped, and the remaining weights
renormalise. It is **never scored 0** — zero would mean "measured, and it is zero",
punishing every event for a table we do not have. This is the Rendering Contract's
absent-≠-unknown rule applied to ranking.

Availability is a **capability**, decided once per call, never per event. If saves
become readable, an event with no saves scores 0 — that is a fact, not an absence.

Today the surviving weights renormalise to: proximity 38.5%, quality 23.1%,
discovery 23.1%, local 15.4%. The day the data lands, each reserved factor starts
contributing at exactly its declared weight with **no code change**.

---

## 2 · Decisions taken

**A score here, though Spotlight refuses one.** `spotlight.js` argues against
scoring and is right — for My Scene, where the badge names the relationship and is
the product. What's On is the anonymous catalogue: no relationship to name, no badge
to protect, and three rules that genuinely conflict over one slot. That is the exact
bar `spotlight.js` sets for a score. ⛔ Do not carry this reasoning back to My Scene.

**`config.featured` becomes the editorial channel, not a third mechanism.** It
already existed and had two readers. It now accepts `{from, to, reason, by}` as well
as legacy `true`; an object is truthy so `spotlight.js` is unaffected. This gives
§10's start/end/reason/audit with no new table and no admin identity — which matters,
because **the schema has no notion of a staff user at all** (no role column, no
admins table, no JWT claim). Provenance is recorded instead of an actor, following
`m2_participation_spine`.

**The ledger records allocations, never impressions.** ⛔ No `impressions`,
`device_id`, `user_id` or `session_id`. A count of who-saw-what is browsing history
under another name. Days-featured answers fairness just as well and carries no
personal data.

**Rotation without a cron.** There is no pg_cron, no worker and no scheduled Edge
Function in this project. Selection is a pure function of (candidates, day, prior
allocations), so history is **recomputable** — `replayHistory()`. This follows
`n4b_expiry_on_delivery`, which does its scheduled work lazily on read.

**⚠⚠ The replay must see the past.** Replaying 30 days over a today-onwards list
hands a month of allocations to gigs that have not happened yet. Measured live: it
pushed the hero from an event 3 days out to one 14 days out. What's On therefore
fetches a **second, wider window** for the replay — free, because `useEvents` shares
one cached query and filters in JS. **This bug looked exactly like working code.**

**No `cancelled` gate.** `events.status` is unconstrained text whose only live values
are draft/live/completed. Cancellation is not modelled on events anywhere in this
schema, so the strongest available statement is `status === 'live'`.

**Quality and discovery carry equal weight, deliberately.** Completeness correlates
with how a row was authored — 9 of 19 upcoming events have no `time`, and they are
overwhelmingly importer rows, the small acts discovery exists to lift. ⛔ Do not
raise one without the other. (Reassuringly, the live winner is an importer row that
scores 1.00 on quality via legacy spellings.)

---

## 3 · Measured behaviour, live catalogue

88 live events, 21 Aug 2026. **9 eligible today, 7 distinct scores** — the spread is
real, the tie-break is not doing the work.

```
score   prox  qual  local disc   date        name
1.000   1.00  1.00  1.00  1.00   2026-08-22  Skyscraper Stan • Oskar Herbig
0.962   1.00  0.83  1.00  1.00   2026-08-22  Tech-Now
0.923   0.80  1.00  1.00  1.00   2026-08-24  Kingswood at Bellingen Brewery
0.788   0.55  0.83  1.00  1.00   2026-08-27  Open Mic Comedy Night
0.654   0.30  0.67  1.00  1.00   2026-09-04  The Friday Mix Up feat MADSPiN BABY
```

Over 21 days with an accumulating ledger: **10 distinct events, 0 dark days**, no run
longer than the 3-day cap.

**Local relevance is currently inert** and honestly so: all 19 upcoming events sit in
the Bellingen/Coffs region, so a Sydney viewer's ranking is unchanged. The mechanism
is tested against synthetic coordinates and will discriminate the moment a second
region has supply.

---

## 4 · Open, and needing a ruling

1. **Apply `fe1`.** Until then the ledger 404s (fails soft, 1 request in production,
   2 in dev via StrictMode) and fairness runs on replay only.
2. **Who writes the ledger.** Writes are service_role only — an anon/authenticated
   INSERT grant would be a lever on the ranking, not merely bad data. So nothing
   writes it yet. Options: Studio records the daily allocation, or the grant is
   opened with the trust model stated. **This is the main unfinished piece.**
3. **Popularity.** Do we instrument Get Tickets and Directions clicks with event
   attribution — breaching `analytics-vision §8` — or leave the factor reserved?
   Recommend: leave it reserved. The constitutional rule does not need it.
4. **Category context.** The hero ignores the category chips, as it always has.
   Respecting them risks a dark slot; a soft factor would add an eighth weight.
   Deliberately out of V1 scope.
5. **`profiles.config.featured_event_id`** is a separate per-profile pin on My Scene.
   Untouched, and not to be conflated.
