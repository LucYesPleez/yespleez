# YesPleez Analytics — Vision v1.0

**24 Jul 2026 · Product vision, ratified by the owner. No implementation in this document.**

Reviewed and endorsed with additions (Community Health, Relationship Graph, Success Stories,
privacy wording) which are incorporated below. This Markdown is the artifact; amend it here.

Status of the ground it stands on: `usage_events` instrumentation is live (13 event types,
one write path in `src/lib/analytics.js`); Studio reads it via localhost-only endpoints.
Everything in this document is a consumer of that foundation plus the four pre-deploy
additions named in §11.

---

## 0 · The framing everything else follows from

YesPleez is a **two-sided marketplace wearing a gig guide's clothes**. Punters bring demand.
Events, artists and venues are supply. Every marketplace lives or dies by the *gap* between
the sides — and almost every metric worth having is a measurement of that gap, in some
region, for some genre, at some moment.

Generic analytics (DAU, MAU, retention curves) measures one side. The analytics that defines
Studio measures **both sides against each other** — because YesPleez is the only gig platform
whose operator can personally close a supply gap within 48 hours by pointing the Gig Importer
at it. That loop is the spine of this document:

> **measure the gap → import to fill it → invite the warmest claims → claims convert supply
> into community → community creates demand → measure the gap.**

The founder filter applies to every card: *would knowing this change a decision?* If not, it
does not ship.

The drill-down philosophy applies to every card: **What?** (the number) → click →
**Why?** (the breakdown) → click → **Show me** (the underlying items — anonymous sessions,
or named transactions where §7 permits). No dead-end dashboards.

---

## 1 · The Morning Brief (Dashboard, top half)

*What happened since I went to bed — as a story, not a table.*

| Card | Why / question answered | Surface | Priority |
|---|---|---|---|
| **Since-you-were-last-here deltas** — signups, installs, claims submitted, applications, feedback, events published. Names only where the act was addressed to the platform. | The 30-second coffee read. Every number is either good news or work to do. | Dashboard | **Essential** |
| **Things needing attention** — pending claims, open feedback, imports waiting, enquiries unanswered > N days, events starting today with unfilled slots. | The difference between a dashboard and a command centre: an inbox, not a report. | Dashboard | **Essential** |
| **Last Hour strip** — sessions in the last 60 min, what screens they touched, acts completed. Session-based; no heartbeat; no names. | The buzz. Watching it move is the founder's reward; costs one query. | Live Activity | **Essential** |
| **Overnight AI digest** — three sentences, not thirty cards. | "Quiet night: 11 sessions. Worth knowing: both new signups searched Coffs and found two events." | AI Insights | Future |

---

## 2 · Growth & Activation

| Metric | Why / question | Surface | Priority |
|---|---|---|---|
| **Activation funnel** — install → account → profile → *first meaningful act* (follow, application, or message). | Where do new people stall? At this scale, fixing a 40% drop at "create profile" beats any new feature. | Analytics | **Essential** |
| **The "aha moment" cohort** — do users who follow ≥1 profile in session one return more than those who don't? | Defines what onboarding should push toward. If first-follow predicts retention, Discover becomes the landing screen. | Analytics | High |
| **Return rhythm** — gigs are weekly; measure whether people return *the following Thu–Sat*, and when the "what's on this weekend" check happens. | Sets notification timing, import cadence, publish deadlines. Retention curves are the wrong shape for a weekly product. | Analytics | High |
| **Regional growth map** — signups and sessions by region (postcode-level bucket, never finer). | Where word of mouth works; where the Bellingen strategy gets cloned next. | Analytics | High |
| **Dead accounts vs lurkers** — never-returned vs returns-but-never-acts. | Lurkers are healthy for a gig guide (reading *is* using it); dead-in-7-days is an onboarding indictment. Stops panic about the wrong number. | Analytics | Nice to have |

---

## 3 · The Marketplace Gap — the signature section

| Metric | Why / question | Surface | Priority |
|---|---|---|---|
| **Scene Pulse: demand vs supply, by region × genre.** Demand = Discover sessions, genre filters used, empty-result moments. Supply = live events carrying that genre in range. *"Coffs: 9 sessions, 2 live events. Techno filter used 12×, 1 techno event exists."* | *Where is the scene asking for something the guide doesn't have?* The answer is an instruction — point GigPorter there this week. The only card on the board that hands you a to-do list. | Dashboard summary + Analytics drill-down | **Essential** |
| **Empty first impressions** — % of first-ever sessions where Discover showed < N events for the user's area. | The scariest churn driver a regional app has: lost before any funnel began. Decides which regions are ready for promotion and which need supply first. | Dashboard | **Essential** |
| **Unclaimed Value board** — every unclaimed profile ranked by accrued value: held notifications, followers waiting, enquiries, events attributed. *"The Federal Hotel: 9 followers, 2 enquiries waiting. Unclaimed."* | The outreach list, pre-ranked by warmth. Q7 tiers verification by accrued value; the same number read the other way says who to invite next. Track claim-invite → claim conversion. | Studio only | **Essential** |
| **Import ROI** — of GigPorter-created profiles/events: which got viewed, followed, claimed — by source. | Is importing producing engagement or shelf-stock? Decides where import effort goes. | Studio only | High |
| **Booking velocity** — median time from application → host decision, per host. | If hosts sit on applications for nine days, artists learn applying is pointless and the supply side quietly dies. Decides a nudge feature — or a phone call to one promoter. | Analytics | High |
| **Gig lifecycle funnel** — published → viewed → followed → applications → slots filled → set times. | Which *stage* of an event's life needs product attention. Views-but-no-applications means the apply flow, not discovery, is the problem. | Analytics | High |

---

## 4 · Engagement & Feature Truth

| Metric | Why / question | Surface | Priority |
|---|---|---|---|
| **Feature adoption honesty board** — % of active users touching each invested feature (Voiceys, availability, share, claims) per month, trend since release. | Stop polishing what nobody touches — or double down where it's working. | Analytics | **Essential** |
| **The Voicey effect** — do conversations/applications including a Voicey convert to bookings more often? Kind counts + outcomes only; never audio, never contents. | Measures the *outcome*, not the feature. A 25% acceptance lift moves Voiceys from "cute" to "the pitch". | AI Insights | High |
| **Navigation flows (anonymous)** — top session shapes; drill to *unnamed* example sessions (region, platform, timestamps, no identity). | The "show me" layer. You watch the journey; it isn't labelled with a person. | Analytics | High |
| **Abandoned flows** — started application / profile / event creation and quit, step recorded. | Every abandonment cluster is a form field earning its removal. | Analytics | High |
| **Search & filter demand** — genre filters, date ranges, regions chosen — taxonomy choices only, never typed text. | Feeds Scene Pulse. | Analytics | **Essential** |

---

## 5 · Community Health *(owner addition, 2026-07-24)*

| Metric | Why / question | Surface | Priority |
|---|---|---|---|
| **Firsts board** — first gig created, first booking, first Voicey, first follower gained, first venue claimed — counted per day. | Milestones, not sessions: are people *crossing thresholds*? "3 people created their first gig today" is the health of the scene in one line. Cheap: derivable from existing tables. | Dashboard | High |
| **Scene connectivity** — % of this month's bookings between profiles that had never interacted before; booking → follow → booking chains. | *Is the scene becoming more connected through YesPleez?* A YesPleez-only insight. Relationship data (bookings, follows) is fine to measure: both parties know these acts happened. | Analytics | Nice to have |
| **Relationship graph (visualised)** — the animated network of who booked/follows whom. | The picture version of the above. Valuable as a demo and a morale artifact; the *metrics* carry the decisions. | Studio only | Future |
| **Success Stories** — weekly aggregates worth sharing: artists booked, first-time bookings, venues claimed, follows created. | The stuff you share publicly. **Rules:** aggregates may be published freely; naming a person publicly requires their consent. **Cut from the original suggestion:** "friendships started" — inferring friendship means analysing private messaging patterns, which §7 forbids. | Dashboard + public use | Nice to have |

---

## 6 · Content Health (Studio only)

| Metric | Why / question | Surface | Priority |
|---|---|---|---|
| **Freshness index** — % of listed events in the past; profiles unedited 6 months; events missing posters/times/venue links. One score, trending. | A gig guide rots silently; it is only as good as its most recent week. | Dashboard card + Studio drill-down | High |
| **Duplicate pressure** — duplicates per import batch; claims blocked by the one-per-type collision. | Tells you when merge stops being a future feature and becomes overdue — with a number instead of a feeling. | Studio only | High |
| **Coverage map** — events per region per weekend vs followers in that region. | The honest answer to "are we covering the Northern Rivers or just Bellingen?" | Analytics | Nice to have |

---

## 7 · Product Health

| Metric | Why / question | Surface | Priority |
|---|---|---|---|
| **Crash & error board** — error events with screen and version. | A crash nobody reports is the quietest churn there is. Highest value per line of code in this document. (ErrorBoundary currently reports to nobody.) | Dashboard | **Essential** |
| **Version adoption** — % of sessions on latest build. | Doubles as "is the service-worker update path working." | Analytics | High |
| **Slow screens** — p95 time-to-interactive per screen. | One degenerate screen can poison the whole app's feel. | Analytics | Nice to have |
| **Notification outcomes** — sent → seen → acted on, per type. | You can't tune a notification mix blind. | Analytics | Future (needs push) |

---

## 8 · Privacy policy for analytics — the governing rule

> **Behaviour analytics are anonymous by default, but identifiable when required for
> support, moderation, or fraud prevention, or when the user has initiated an interaction
> with YesPleez (a claim, a feedback report, a support request).**

Concretely:

**Named and detailed is right when —**
- **they asked YesPleez something**: claims, feedback, enquiries → full context, including
  their profiles and history *with the platform* (Studio already behaves this way);
- **they reported a problem**: pulling *that user's* error events to debug their report is
  service, not surveillance — the report is the basis;
- **account-level facts**: last seen, platform, install state, version — coarse, expected,
  useful for support.

**Aggregate / anonymous-session is right for** everything about movement: screens, paths,
dwell, filters, abandonment. Drill-down goes to *sessions*, never to named people.

**Never (write it down as policy):** message or Voicey contents, typed search text, a
browsable named-user timeline, precise location, fingerprinting, inferring social
relationships from private interaction patterns.

**Obligation:** a plain-language privacy page ships with the deploy. The underground scene
is exactly the crowd that notices — at this scale, trust is a feature.

---

## 9 · AI Insights — what the assistant should notice on its own

Rule: an insight must name an **action**, not a fact.

- "Techno filter use is up 3× in Coffs this month. Supply there: one event. **Import target.**"
- "9 of 11 abandoned applications died on the bio step. **That field is costing you artists.**"
- "The Federal Hotel's held pile crossed 10 items. **Warmest claim invite you have.**"
- "Applications answered within 24h are accepted 3× more often. **Two hosts are sitting on 6 apps.**"
- "Every returning user this week follows ≥2 profiles; no one-session user followed any.
  **Onboarding should land on Discover with follow prompts.**"
- "Saturday 4–6pm is the weekly usage peak. **Publish imports Thursday night.**"

*AI Insights: Future. The data collection that feeds them: Essential now.*

---

## 10 · Explicitly cut, with reasons

| Cut | Reason |
|---|---|
| Named user timelines | The one real ethical line; aggregate paths answer the same product questions. |
| "Friendships started" | Requires analysing private messaging patterns — §8 forbids it. |
| Heatmaps & scroll depth | Click-coordinate capture for insight not acted on at this scale; rent a third-party tool for a week if ever curious. |
| Literal session replay | The event-path version gives 90% of the value with none of the privacy weight. |
| True "online right now" presence | Needs heartbeats; Last Hour gives the feeling free. Revisit at 500+ DAU. |
| Revenue cards | No payments exist; empty cards corrode trust in the whole board. |
| Forecasting | Forecasting from tens of users is astrology with axes. |

---

## 11 · Sequencing — what must exist before the rest can

Four pre-deploy instrumentation additions (unbackfillable; ~an afternoon; ship inside the
deploy): **session_id** on every event · **screen_view** on route change · **session
end/duration** via the existing visibility hook · **error events** from ErrorBoundary.
Plus structural search/filter events shortly after. Everything above is then built later,
against real data, in roughly this order: Morning Brief → Scene Pulse + Unclaimed Value →
activation funnel + errors → feature adoption → the rest as questions arise.

---

## 12 · The signature feature

Not a chart. A loop.

**Scene Pulse + the Unclaimed Value board, feeding each other on the Dashboard.** Demand
tells you what to import; importing creates unclaimed profiles; accrued value tells you who
to invite; claims convert supply into community; community creates demand. Studio doesn't
report on YesPleez — **it steers it**. That's what the internal tools at Spotify or Airbnb
do that admin panels don't, and it's achievable here precisely because one operator holds
an importer, not a committee holding a BI tool.

And the emotional heart stays the **Last Hour strip** — because the command centre should
also just feel *alive*.
