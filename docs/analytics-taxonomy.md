# Analytics Event Taxonomy — v2

The canonical vocabulary for `public.usage_events.name`, enforced by the
`usage_events_name_check` constraint. **Adding an event means a migration
extending that CHECK plus an entry here, in the same commit** — that friction
is the point. No app invents a name ad hoc; a typo'd name is a rejected
insert on day one, not a zero chart in three months.

Two kinds of event, never conflated:

- **Raw interaction** — something a person did in an app. The row is the fact.
- **Business observation** — a product system recorded an authoritative
  transition and *told* analytics. The product's own table is the truth; the
  event only observes it. Analytics never reads product tables to reconstruct
  these (platform boundary rule), and props carry ids as opaque facts — no
  foreign keys, so the observation outlives the record it observed.

Identity fields on every row: `device_id` (required), `session_id`,
`user_id` (null = anonymous / pre-resolution). Schema version of this
vocabulary: **2** (AV5). Version 1 is the pre-AV5 19-name list.

## Raw interaction events

| name | producer | required props | notes |
|---|---|---|---|
| `opened_app` | client lifecycle | `reason`, `installed` | one per session start |
| `signed_up` | AuthScreen | — | acquisition |
| `install_prompt_shown/_accepted/_dismissed` | install funnel | — | Chromium-only by platform design |
| `installed_pwa` | install funnel | — | iOS's only install signal |
| `created_event` / `published_event` | event editor | `from` (publish) | |
| `applied` | ApplyButton | `has_note` | **the submission event** — see below |
| `sent_message` / `sent_voicey` | messaging | — | |
| `followed` / `shared` | profile & share surfaces | — | |
| `screen_view` | router hook | `path` (normalised, `/event/:id` form) | event/profile views are path prefixes |
| `session_end` | visibility/pagehide | `duration_s` | fires repeatedly BY DESIGN (durability); readers take `MAX(duration_s)` per `session_id` and count sessions as `DISTINCT session_id`, never rows |
| `error` | ErrorBoundary | `screen` | health |
| `filtered` | search/filter (A3) | surface + facets | never the query text |
| `gate_shown` / `intent_resumed` | ParticipationGate (O2) | `action` (+ `done`) | the conversion moment; no ids |
| `application_started` | ApplyButton (AV5) | `event_id` | apply flow **opened** — intent, before any application row exists |

## Business observation events (AV5)

| name | producer | authoritative system | required props |
|---|---|---|---|
| `application_accepted` | host decision paths (ApplicationsScreen; lineupFromApplication via add-to-bill) | `applications.status` | `event_id`, `via` |
| `application_released` | EventHostView slot-notice send | the P6 notification boundary (`lineup_members` notified state) | `event_id`, `kind` |
| `participation_recorded` | *no producer yet* — Festival integration phase wires it | the append-only participation transition log | `event_id` |

**`applied` is the submission event.** No `application_submitted` alias
exists or may be added: business names align with the ratified application
state machine, and a second name for one moment is how two dashboards
disagree. The funnel reads `applied`.

**Future names** (`ticket_purchased`, `ticket_checked_in`, …) are added by
migration when their authoritative system exists — never speculatively.

## Attribution (not a usage event)

A campaign arrival writes a row to `public.attribution_touches` (AV4), not a
`usage_events` row — the touch table's columns (`source`, `medium`,
`campaign`, `placement`, `creative`, `destination_key`) ARE its vocabulary.
URL params: `?src=` (required) `&m= &c= &pl= &cr=`, token-sanitised. QR codes
still write nothing at scan time; the app load records the touch.
