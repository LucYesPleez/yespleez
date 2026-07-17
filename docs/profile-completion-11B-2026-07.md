# Public profile completion — Phase 11B

**Date:** 17 Jul 2026 · **Validated live** as a guest against one claimed profile of each type (Cosmatik / Dusky Waters / Test Comedian / The Bellingen Brewing Co / YesPleez).

## Headline

**The profile *structure* is largely complete — what looks half-finished is sparse test data, not missing code.** Every checklist section exists for the types that should have it; empty sections hide rather than showing an empty state (a design choice, not a gap). The two real, unfinished things are **product-model decisions**, not bugs:

1. **"How do I book/contact them?" is unanswered on performer and host profiles for a guest.** Only a *Venue* profile shows a booking CTA (Check Availability); only a logged-in *venue owner* can enquire to a performer. A guest, punter, or fellow performer sees only Follow + a non-functional Message. This is the checklist's question #2 going unanswered — and it's a model decision (see D-A), because the current booking model is venue→performer only.
2. **Message is a placeholder that does nothing** (M8 messaging doesn't exist yet). It renders on every profile with no click handler.

## Fixed in this pass

**Primary booking CTA now sits above Follow** (`ProfileScreen`, commit `bbdb476`). The booking CTA was already styled as primary (full-width, solid gradient) but positioned *below* the Follow/Message row. Reordered per the agreed hierarchy and the Discover → profile → **check availability** → enquire journey. Verified live: venue profile shows CHECK AVAILABILITY on top; profiles with no booking CTA are unchanged. Pure JSX reorder, no logic change.

---

## Per-type checklist matrix

✅ present · ⚪ present but empty in test data (renders when populated) · ➖ hidden when empty (by design) · ❌ absent from code · 🔶 product decision

| Checklist item | Artist/DJ | Band | Comedy/Poetry | Venue | Host |
|---|---|---|---|---|---|
| Hero (avatar/cover) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Name + tagline | ✅ | ✅ | ⚪ tagline | ✅ | ✅ |
| Verification / badge | ✅ type badge | ✅ | ✅ | ✅ | ✅ |
| Genres / categories | ✅ STYLE | ✅ | ✅ STYLE | ➖ (venues have VIBE) | ✅ |
| Location | ✅ | ✅ | ⚪ | ✅ | ✅ |
| Social links | ⚪ (Cosmatik: 3) | ⚪ | ⚪ | 🔶 in VENUE INFO only | ✅ |
| About / bio | ✅ when set | ⚪ | ⚪ | ✅ | ✅ |
| Gallery / media | ✅ audio only | ✅ audio | ✅ audio | ❌ none | ❌ none |
| Upcoming events / gigs | ➖ | ➖ | ➖ | ➖ | ✅ has data |
| Availability | ❌ 🔶 | ❌ 🔶 | ❌ 🔶 | ✅ Check Availability + calendar | ❌ 🔶 |
| **Primary CTA (book/contact)** | 🔶 none for guest | 🔶 | 🔶 | ✅ Check Availability | 🔶 none |
| Secondary CTA (Follow) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Empty states | ➖ sections hide | ➖ | ➖ | ✅ | ✅ |
| Mobile (375) | ✅ no overflow | ✅ | ✅ | ✅ | ✅ |
| Desktop (1280) | ✅ | ✅ | ✅ | ✅ | ✅ |

**Reading it:** the columns that look thin (performers) are thin because of *data* (empty test profiles) plus two *structural* items — no photo gallery, and no public availability/booking CTA for performers. Everything else renders correctly when the profile has content, and layout is clean at both widths for all five.

---

## Decisions required (the actual "completion" work)

### D-A — Can a guest / punter book or contact a performer? *(the core gap)*

Today: **no.** On a performer profile the only booking path is `CHECK AVAILABILITY & ENQUIRE`, which renders solely for a viewer who **owns a venue** (`venueCtx`). A guest sees Follow + a dead Message button. So the platform's headline question #2 — "how do I book them?" — has no answer on 3 of 5 profile types for most viewers.

This is a **model decision**, not a bug: the booking model is currently venue→performer. Options:
- **(a)** Keep it venue-only, and make that honest — e.g. on a performer profile, show a signed-out viewer a "Sign in as a venue to enquire" prompt in place of the empty slot, so the absence is explained rather than blank.
- **(b)** Open a general "Contact / Enquire" path for any signed-in user — a broader change that depends on M8 messaging.
- Either way, **Message must stop being a no-op** (D-C).

Recommend (a) as the low-cost interim: it answers "how do I book them" with a next step, without building M8.

### D-B — Do performers publish public availability?

Venues have a public availability calendar (`Check Availability`). Performers do not — the `artist/band/standup_availability` tables exist (S5) but nothing surfaces them on the public profile. Decision: should a performer profile show "available dates", or is availability a venue-only concept? If performers get it, it's new UI + the S5 `profile_id` columns (M6-adjacent). Likely **future**, not beta.

### D-C — The Message button is a no-op

`ProfileScreen` renders `MESSAGE` on every claimed profile with **no click handler** (deliberately — a placeholder for M8, per the code comment). A prominent button that does nothing when tapped fails the "how do I contact them" test and reads as broken. Options: label it visibly "coming soon" / disable it, or remove it until M8. **Recommend disabling with a "coming soon" affordance** so it's honest without losing the reserved slot. Not changed here — the placeholder is intentional and the call is yours.

### D-D — Venue social links

A venue's socials live only inside the collapsible **VENUE INFO** dropdown, while every other type shows them in a row under the CTAs. Intentional (venues keep their own info block) or should venues surface socials at the top level too? Minor; your call.

---

## Not gaps (verified, working as intended)

- **Media "coming soon" copy is correct per type** — "PLAY MUSIC / MUSIC COMING SOON" (band), "PLAY DEMO" (comedy), "PLAY DEMO MIX" (DJ). The 10E.3 brand-pass fix holds.
- **Upcoming/past gigs** exists with real empty states and portrait/list views; hidden when the profile has no events (design choice). Performers load gigs correctly via lineup membership.
- **About** renders with READ MORE truncation when a bio is set; correctly absent (no empty header) when not.
- **Bogus profile id** → "Profile not found." (clean error state, from 11A).
- **Layout** — zero page-level horizontal overflow on any type at 375px or 1280px.

## Future enhancements (documented, out of scope)

- **Photo gallery** — no gallery exists on any type; only the audio player. A real feature, not a fix.
- **Performer availability** (D-B) — depends on S5 + likely M6.
- **General contact/messaging** (D-A option b, D-C) — depends on M8.

## Build & lint

Build passes. oxlint 121 warnings, 0 errors (unchanged by the reorder).
