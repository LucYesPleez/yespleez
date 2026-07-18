# Host Profile — v1 Definition (Phase 11C.5)

**Date:** 2026-07-18
**Status:** Ratified (product decisions). **No code yet** — this is the spec the
implementation pass builds against.
**Owner decisions captured in the 11C.5 workshop.**

---

## What a Host is

A **Host (Promoter)** is the person / collective / company that **runs events
and books the lineup** — the demand side of booking. In YesPleez terms they
create events (`events.host_id`), assemble the bill (book artists / bands /
comedy), and promote the night.

A Host is **not a performer** (there is nothing to book them *for* — no demo, no
availability-to-be-booked) and **not a venue** (no physical space to hire). They
are the organiser / curator. The editor confirms the shape: promoter/company
name, est. year, location, tagline, a short sound/vibe line, an "About your
events" bio, **what they host** (event categories), **genres they book**, vibes,
and a booking contact + socials.

This is the entity that had no agreed profile model — hence the sparse page.
It is **not** an "engineering deficiency" or a "second-class" profile (per the
11C audit correction); it just needed defining. This document defines it.

---

## Ratified decisions

1. **Purpose — both, events-first.** The page serves punters (follow the
   promoter's nights) *and* performers (see what they book), with the host's
   **upcoming / past events as the hero** of the page. The events are the value
   for both audiences.
2. **Booking direction — hosts invite performers.** A logged-in host viewing a
   performer should be able to invite them to a night — the same
   venue→performer flow venues already have (InviteSheet). This is **intent**;
   the build is booking-rework / M6 (see Boundaries). No inbound "pitch to host"
   flow in v1.

---

## Host Profile v1 — content model

In order down the page (reusing the shared, de-chromed profile layout — same as
performer/venue after 11C.4):

1. **Hero** — `avatar_hero` / default promoter image.
2. **Name + badge + location + est** — badge reads **HOST / PROMOTER**.
3. **Tagline** — their one punchy line.
4. **About** — the "About your events" bio (what they run, the vibe, what they
   offer artists).
5. **What we book** — the host's genres / categories / vibes, shown as the
   shared simple tag pills, under a heading that reads as *programming*, e.g.
   **WE BOOK** (not "STYLE" — a host does not *perform* these).
6. **Events — the hero content.** The host's **hosted** events (upcoming +
   past), using the same events sheet + cards as every other profile.
7. **Actions** — Follow · Message (placeholder until messaging exists) · Share
   (header icon). **No booking CTA on the host's own page in v1** — Fork B is
   the host acting on *performers'* pages, not an inbound action here.
8. **Socials row** — the visible icon row (instagram / facebook / website /
   email), same as every other type.

No demo player, no availability calendar, no "enquire" on the host's own page —
correct for this entity.

---

## What is buildable now vs deferred

**Buildable now — pure display, no schema / RLS / attribution / M6:**
- **Fix the events query (the #1 miss).** The public page currently queries
  `lineup_members` for a host (as if they *perform*) → always empty. Query
  `events` by **`host_id = profile.user_id`** instead, so a promoter's nights
  actually show. This is the single change that makes the page make sense.
- **"WE BOOK" section** — render the host's `genre_string` tokens as the shared
  tag pills under a booking-framed heading, instead of the performer "STYLE"
  treatment.
- Follow / Message / Share / socials already render.

**Deferred to the booking rework / M6:**
- **Fork B — hosts invite performers.** Extend the venue-owner invite context
  (`venueCtx` / InviteSheet) so a host-owner also gets it on performer profiles.
  This is **not** a display change: `venue_enquiries` is venue-shaped
  (`venue_user_id` / `venue_profile_id`), and the identity contract requires the
  row to **name the host as the actor** — a host is not a `venue_profile_id`. So
  hosts-as-bookers needs a contract/schema extension. Belongs with the
  enquiries/Booking rework (backlog S3/S4/S6/S32/S39) and is M6-gated. Decide
  intent now (done — yes); build there.

---

## Boundaries / flags

- Events-by-`host_id` and the WE-BOOK reframe are **display-only** and safe to
  ship in an implementation pass now — no soak/M6 conflict.
- `host_id` is account-keyed (like the other legacy keys) — a multi-profile
  account's host events key on the same `user_id`; acceptable for display, same
  known limitation family as S5/S28.
- Hosts-invite-performers **must not** be hacked in by reusing the venue columns
  — that would forge attribution (a host claiming to act as a venue). It waits
  for the seam. Surface, don't route around (per `CLAUDE.md`).

---

## Suggested next step (not part of 11C.5)

A small **11C.6 "Host profile display"** pass could ship the two safe items
(events-by-`host_id`, WE-BOOK section) — that alone turns the host page from
empty to useful. The booking-direction build stays with the M6 booking rework.
