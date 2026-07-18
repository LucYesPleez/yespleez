# Phase 11C — Public Profile Audit

**Date:** 2026-07-18
**Status:** Audit + prioritisation. No code changes. Scope-of-work for the 11C implementation pass.
**Author:** Cowork session (YesPleez Main 8), with owner prioritisation.

---

## Scope correction (read first)

The task brief named five files — `ArtistProfileScreen.jsx`, `BandProfileScreen.jsx`,
`StandupProfileScreen.jsx`, `VenueProfileScreen.jsx`, `HostProfileScreen.jsx` — as "the
public profile screens." **They are not.** Routing (`App.jsx`) is unambiguous:

| Route | Screen | What it is |
|---|---|---|
| `/industry/artist/setup` | `ArtistProfileScreen` | **Editor** — "MY PROFILE" form |
| `/industry/band/setup` | `BandProfileScreen` | **Editor** — "YOUR MUSO PROFILE" |
| `/industry/standup/setup` | `StandupProfileScreen` | **Editor** |
| `/industry/venue/setup` | `VenueProfileScreen` | **Editor** |
| `/industry/host/setup` | `HostProfileScreen` | **Editor** |
| `/profile/:id` | **`ProfileScreen`** | **The public page** — one screen, branches by `profile.type` |

There is exactly **one** public profile page: `ProfileScreen.jsx` (~1,100 lines), which
renders all five types by branching on `isVenue` / `isBand` / `isStandup` / `isArtist` /
`isHost`. This audit compares the five **types** as rendered by that one page.

**Also note:** the brief listed `AvailabilitySection`, `EnquiryPanel`, `EnquiryCard` as
"shared components the profile pages use." They are **not** used by the public page — they
are dashboard (owner-side) components. The public page reimplements availability + enquiry
**inline**. That duplication is itself a finding (see §2).

The five editor forms have their *own* parity issues (Band/Standup/Venue all import
`ArtistProfileScreen.module.css`; Host has its own; field sets differ) — but that is a
**separate editor-parity audit**, out of scope here.

---

## 1. Feature matrix — public profile by type

Legend: ✅ present/working · ⚠ present but broken/partial · ❌ missing · — N/A by design

| Feature | Artist | Band | Comedy | Venue | Host |
|---|:--:|:--:|:--:|:--:|:--:|
| Hero blurred bg | ✅ | ✅ | ✅ | ✅ | ✅ |
| Hero photo (+ type default fallback) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Scroll-zoom hero | ✅ | ✅ | ✅ | ✅ | ✅ |
| Name | ✅ | ✅ | ✅ | ✅ | ✅ |
| Type badge(s) | ✅ role pills | ✅ | ✅ role pills | ✅ | ✅ |
| **Verification badge** | ❌ | ❌ | ❌ | ❌ | ❌ |
| Unclaimed + Claim flow | ✅ | ✅ | ✅ | ✅ | ✅ |
| Location | ✅ | ✅ | ✅ | ✅ | ✅ |
| Est. year | ✅ `years` | ✅ `established_year` | — | — | — |
| Tagline | ✅ | ✅ | ✅ | ✅ | ✅ |
| Demo/music player | ✅ | ✅ | ✅ | — (sound in box) | ❌ |
| Genre / STYLE line | ✅ | ✅ | ✅ (card_pills) | — (as "WE BOOK") | ⚠ empty in practice |
| Sound descriptor (italic) | ✅ | ✅ | ✅ | ✅ | ❌ |
| Bio / ABOUT | ✅ | ✅ | ✅ | ✅ (in dropdown) | ✅ |
| Venue Info box | — | — | — | ✅ | — |
| VIBE pills (glow-pill) | ⚠ plain line | ⚠ plain line | ⚠ plain line | ✅ glow-pill | ⚠ |
| Follow (+ multi-profile picker) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Message button** | ⚠ dead | ⚠ dead | ⚠ dead | ⚠ dead | ⚠ dead |
| **Check Availability (calendar)** | ❌ | ❌ | ❌ | ✅ | — |
| Enquire | ✅ venue→perf | ✅ venue→perf | ✅ venue→perf | ✅ perf→venue | ❌ none |
| Social links row | ✅ | ✅ | ✅ | ⚠ buried in dropdown | ✅ |
| Upcoming events | ✅ | ⚠ no legacy fallback | ⚠ no legacy fallback | ✅ | ❌ always empty |
| Past events + search | ✅ | ✅ | ✅ | ✅ | ❌ |
| Events view toggle + empty state | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Share** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Gallery** | ❌ | ❌ | ❌ | ❌ | ❌ |
| Responsive | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 2. Inconsistencies

### Intentional (product-justified — leave alone)
- Venue has no demo player and shows a Venue Info box instead — venues aren't performers.
- Two enquiry directions (performer→venue via venue calendar; venue→performer via
  `InviteSheet`) are the two halves of booking, correctly gated by viewer role.
- Demo-button wording differs per type ("PLAY DEMO MIX" / "PLAY MUSIC" / "PLAY DEMO") —
  deliberate vocabulary.
- Band/Comedy events have **no** `artist_id` legacy fallback — the code comment
  (`ProfileScreen.jsx` ~L88–93) shows this is deliberate (prevents cross-profile gig bleed
  for multi-profile accounts). M8-scoped, not a bug.

### Accidental (candidates for work)
- **Share** — `share()` is defined (`ProfileScreen.jsx` L318) but **no button ever calls
  it**. Missing on all types. The only Share button in the app is in `GlobalHeader` (events).
- **Message** — rendered on every claimed profile, wired to nothing. The messaging system
  itself doesn't exist yet.
- **Performer availability is a broken contract** — performers set dates via
  `AvailabilitySection` (dashboard), whose modal literally says *"these show on your
  profile so promoters can find you."* But the public page's availability calendar only
  reads `venue_availability`. A performer's marked dates are **never shown publicly.**
- **Duplicated calendars** — the public page's inline venue-availability modal
  (`ProfileScreen.jsx` L790–857) and `AvailabilitySection`'s `AvailCalModal` (L103–161) are
  ~90% the same grid, independently maintained.
- **Venue socials buried** — every other type shows a visible social row
  (`ProfileSocialLinks`); venue's are hidden inside the collapsed Venue Info dropdown.
- **"Your 5 tags" rendered two ways** — venue gets glow-pills; performers get a plain
  dot-separated line from the same `card_pills` data.

### Not an inconsistency — an undecided entity (Host)
The Host profile renders sparse (no demo, no enquire path, events query treats it as a
performer so it is always empty, typically no genre). This is **not** an engineering
deficiency and Host is **not** "second-class." A Host is a distinct entity — neither
performer nor venue — and the platform **has not yet decided what information a Host
profile should present.** The empty sections are the symptom of that undecided model, not
bugs. Fixing it by bolting on sections would be premature. See §5 (11C.5).

---

## 3. Three classes of work

The audit's real value is separating these — so effort goes to what's genuinely broken, not
to parity for its own sake.

**Class 1 — Bugs / incomplete features (objective; do these)**
- **Share** — function exists, should be wired. Easy win.
- **Message** — do not ship dead UI. **Decision: hide until messaging exists** (preferred
  over a disabled "Coming Soon" state).
- **Performer availability** — a genuine broken contract (dashboard promises it; profile
  never shows it). **Highest priority of the three.**

**Class 2 — Technical debt (worth doing)**
- **Duplicated calendar** — same class of duplication removed in Phase 10F. Extract
  `AvailabilityCalendar` once; both `ProfileScreen` and `AvailabilitySection` consume it.
  Engineering work, not product work.

**Class 3 — Product decisions (do not touch in 11C implementation)**
- **Host** — a product-definition question: *what is a Host profile?* Decide before
  building. (11C.5, workshop — no code.)
- **Gallery** — new feature, not a completion task.
- **Verification** — new feature, not Phase 11C.

---

## 4. Implementation roadmap (owner-ratified 2026-07-18)

| Sub-phase | Work | Class | Notes |
|---|---|---|---|
| **11C.1** | Share (wire it) + Message cleanup (hide) | 1 | Quick wins, all 5 types, nowhere near M6 |
| **11C.2** | Extract shared `AvailabilityCalendar` | 2 | Dedupe first — foundation for 11C.3 |
| **11C.3** | Public performer availability (read-only) | 1 | The broken contract. ⚠ display-only — see §6 |
| **11C.4** | Venue polish — unbury socials, tag consistency | (accidental) | Small, contained |
| **11C.5** | Host product workshop | 3 | **No coding.** Decide what a Host profile *is* |

Sequencing note: 11C.3 depends on 11C.2 (build the shared calendar before mirroring it to
performers). 11C.1 and 11C.4 are independent and can slot in anytime.

---

## 5. File / component estimate

| Sub-phase | Files touched |
|---|---|
| 11C.1 Share + Message | **1** — `ProfileScreen.jsx` (+ maybe a tiny `ShareButton`, or reuse `GlobalHeader`'s) |
| 11C.2 Shared calendar | **+2** — new `AvailabilityCalendar.jsx`, refactor `AvailabilitySection.jsx` |
| 11C.3 Performer availability | **+1–2** — `ProfileScreen.jsx` (+ its `.module.css`) |
| 11C.4 Venue polish | **1** — `ProfileScreen.jsx` (+ CSS) |
| 11C.5 Host | 0 — product decision |

- The five **editor** forms are **not** touched in this pass.
- Most work concentrates in `ProfileScreen.jsx` plus one new shared component.

---

## 6. Boundary flags (M6 / identity / schema)

- **Do not** touch `venue_enquiries` insert attribution or `InviteSheet`'s stamping — that
  is the identity contract / M6.
- 11C.3 is **display-only.** *Showing* a performer's availability is safe; *adding* a new
  performer enquiry write path is M6-adjacent (applicant/target attribution) → surface,
  don't implement.
- `years` vs `established_year` (Est. year) is schema drift — display-side coalescing stays
  as-is; no schema change.
- Events `artist_id` legacy fallback stays artist-only (intentional; M8-scoped).

---

## Source references
- Public page: `v2/src/screens/ProfileScreen.jsx`
- Type identity: `v2/src/lib/profileTypes.js` (`PROFILE_TYPES`)
- Owner-side availability: `v2/src/components/AvailabilitySection.jsx`
- Routing: `v2/src/App.jsx`
- Editor forms (out of scope): `v2/src/screens/{Artist,Band,Standup,Venue,Host}ProfileScreen.jsx`
