# M15 — Unclaimed marking: verification evidence

**19 Jul 2026.** Live results, recorded as run. Same convention as the M4/M5/M5.1/M14 evidence files.

Phase 15 implements **v1.0 §09 (Ethics) transparency** as narrowed by Phase 13 **`P-C2`** — *"wherever
an imported event or its owner appears publicly, the profile is marked unclaimed."* Implementation
only; no architecture was reopened.

---

## Applied, in order

| # | Commit | Change | Result |
|---|---|---|---|
| **M15a** | `8d15d13` | `lib/profileClaim.js` — canonical `isProfileUnclaimed()` | ✅ lint/build clean; nothing imports it |
| **M15b** | `4d6eec0` | `components/UnclaimedBadge.jsx` + `.module.css` | ✅ extracted verbatim; unused |
| **M15c** | `90f60a4` | ProfileScreen adopts both | ✅ 9/9 computed styles identical |
| **M15d** | `f2fd4d8` | ProfileCard + PortraitCard adopt the badge | ✅ 7 surfaces covered at once |
| **M15e** | `110d686` | MyScene DISCOVER select carries `id` | ✅ `/profile/undefined` eliminated |
| **M15f** | `d550c7e` | DISCOVER carousel keys React on `profiles.id` | ✅ 10 distinct keys |
| **M15g** | `3293e49` | ARTISTS PLAYING marks unclaimed acts | ✅ real profile row attached |
| **M15h** | `2728d68` | Event lineup slots mark unclaimed acts | ✅ both merge branches |
| **M15i** | *(this commit)* | ApplicationsScreen + this document | ✅ final `P-C2` surface |

---

## The canonical implementation

**One predicate.** `lib/profileClaim.js` — `isProfileUnclaimed(profile)`. Mirrors `profileIdentity()`:
never throws, never guesses. Keys on `profiles.user_id`, **not** `owner_user_id`, which does not
exist on this table (live-schema audit `D2`/`D2b`). ProfileScreen's existing `user_id == null` test
was *promoted* to canonical rather than duplicated.

**One component.** `UnclaimedBadge` — presentational only, returns `null` unless unclaimed, so it
disappears on claim with no call-site condition. The pill was lifted verbatim from
`ProfileScreen.jsx:486`; all seven declarations map 1:1. Only additions: `white-space: nowrap`,
`flex-shrink: 0`. No `className`/`style` prop — a per-call-site styling hook is how visual
consistency erodes.

**No pending state.** A `claim_status = 'pending'` row is still unowned, so it renders `UNCLAIMED`.
ProfileScreen's existing *"Claim under review"* wording carries the nuance and is unmodified, as is
`ClaimDialog` and the *"Is this you?"* entry point.

### Absent is not null

A row from a query that never selected `user_id` would satisfy a bare `== null` test and stamp
`UNCLAIMED` across **owned** profiles. §09 forbids misrepresentation in both directions and a false
*"unclaimed"* is the worse half — it tells a real business the platform does not recognise them. The
predicate therefore guards on `'user_id' in profile`, returns `false` when unknown, and warns in dev
naming the offending row so the **query** gets fixed rather than guessed at.

**That warning fired zero times across every surface driven in this phase** — which is the evidence
that no further query changes were required.

---

## Surfaces covered

| Surface | Component | Query change | Evidence |
|---|---|---|---|
| ProfileScreen hero | `ProfileScreen` | none | badge + 9/9 style match |
| Discover — search | `ProfileCard` | none | 1 badge, correct row |
| Discover — Recently Added | `PortraitCard` | none | 1 badge across 8 cards |
| MyScene — FOLLOWING ×3, UPDATES | `ProfileCard`/`PortraitCard` | none | 0 badges (all claimed) |
| Dashboard — FollowingSection | `PortraitCard` | none | 0 badges (all claimed) |
| MyScene — DISCOVER carousel | `PortraitCard` | **`id` added** | 1 badge, navigable |
| MyScene — ARTISTS PLAYING | bespoke row | row attached | 3 badges under stub |
| Event lineup slots | `SlotCard` | none | 3 badges under stub |
| Applications — applicant row | `AppCard` | none | 4 badges under stub |

`DiscoverScreen`, `WhatsOnScreen` and `FollowingSection` required **no edit** — they inherit through
the two shared cards. Two components covered seven surfaces.

---

## The synthetic-object trap

Three surfaces build their own row objects carrying a `user_id` key that is **not**
`profiles.user_id`:

| Surface | Its `user_id` actually is |
|---|---|
| `EventScreen` `claim` | `lineup_members.artist_id` |
| `MySceneScreen` `dayArtists` | `lineup_members.artist_id` |

Testing those for claim state compiles, runs, and returns a **confidently wrong** answer — and wrong
in the direction that looks right: `FillSlotModal.jsx:41` writes `artist_id = prof.user_id`, which is
`NULL` for an unclaimed profile, so the bad test would appear to pass on precisely the case it breaks.

Both now attach the resolved `profiles` row whole (`profile:`) and hand *that* to the predicate.
Neither needed a query change — `EventScreen`'s `socialCols` and `MySceneScreen`'s avatar joins
already selected `id, user_id`; the row was being **discarded**, not missed.

`profile` is deliberately left null where no profile resolves. That is a typed billing name, which is
not an unclaimed profile and correctly renders no badge — observed directly: on *Solstice Soirée* all
16 typed-name slots stayed unbadged while the 3 resolved slots badged.

---

## Live data

Production at time of verification: **37 profiles — 36 claimed, 1 unclaimed.**

The single unclaimed subject is **Test DJ** (`artist`, `86c431ff-dd25-4851-b94b-73e91e7dd0ae`,
`claim_status = 'unclaimed'`).

**Observed unbadged (negative case), real data:** claimed ProfileScreen (*Elbow*), MyScene FOLLOWING
portrait + list, MyScene UPDATES, dashboard FollowingSection, 19 *Solstice Soirée* slot rows, 5 *fds*
slot rows, 4 *Solstice Soirée* applicant cards, 4 ARTISTS PLAYING rows.

**Observed badged (positive case), real data:** Test DJ on ProfileScreen, in Discover search, in
Discover Recently Added, and in the MyScene DISCOVER carousel.

---

## Temporary verification methodology

Test DJ is followed by nobody, is on no lineup, and has submitted no application. Three surfaces
therefore had **no reachable unclaimed subject in live data**. Rather than write follower/lineup rows
into production to manufacture one, each was driven with a **temporary local stub** that forced
resolved profiles to `user_id: null`, marked `// TEMP-VERIFY-*`.

| Surface | Stub | Observed |
|---|---|---|
| ARTISTS PLAYING | every resolved profile | 3 badges on 3 resolved rows; typed-name row unbadged |
| Event lineup slots | every merged profile | 3 badges on 3 resolved slots; 16 typed-name slots unbadged; legacy `socialsByUid` branch also badged on *fds* |
| Applications | every applicant profile | 4 badges on 4 cards |

**Every stub was reverted before its commit.** Confirmed by grepping all of `v2/src` for
`TEMP-VERIFY` (result: clean) and by reading each full diff. **No test code is present in any M15
commit.**

Stubs prove the render path, not the data path. Where a stub was used, the claim is *"the component
renders correctly when handed an unclaimed row"* — not *"an unclaimed profile has been observed on
this surface in production."*

---

## Layout, measured

Row/card heights compared with the badge shown vs hidden, at 375×812 and 1280×720.

| Surface | Baseline | With badge | Cost |
|---|---|---|---|
| ProfileCard name row | 25px | 25px | none |
| PortraitCard | 150×200 | 150×200 | none |
| Event lineup slot | 25px | 25px | **none** |
| Applications card | 44px | 44px | **none** |
| ARTISTS PLAYING row | 69/69/97 | 73/73/101 | uniform +4px |

**One regression was found and fixed by measuring.** In M15g the badge was first *trailed on the
row*, which took ~76px from the `min-width: 0` info block; the genre line — which wraps freely,
unlike the ellipsising name — reflowed and grew a long-genre row **97px → 125px**, a variable cost
scaling with genre length. Pairing the badge with the **name** instead (the name already truncates,
so it yields width) reduced this to a uniform +4px. A visual check would not have caught it.

Wrapping was likewise measured against a baseline rather than assumed: on `ProfileCard`, a short name
is 1 line / 25px **identical** with and without the badge; a long name wraps to 2 lines **both with
and without**, so that wrap is pre-existing `.nameRow` behaviour, not badge-induced.

No horizontal document overflow was observed on any surface at either viewport.

---

## Completed

**`P-C2` — unclaimed marking.** Every surface in the audit where a profile row is rendered now marks
it unclaimed, through one predicate and one component, with no page-specific logic and no duplicated
implementation.

---

## Outstanding — explicitly **not** in M15, and still tracked

### `R5` · Event venues cannot yet be marked

Every event surface renders the venue as the **denormalised string** `config.venue`, never a linked
profile — `EventScreen.jsx:472`, `EventCard.jsx:101/134/180`, `FeaturedEventCard.jsx:31`,
`WhatsOnScreen.jsx:141/170`, `ProfileScreen.jsx:807`. **There is no clickable venue link anywhere in
the application.** The real relation (`events.venue_profile_id`) is only ever read backwards.

An imported event will therefore name a venue with no badge and no link. This is the §09 surface that
Studio publishing hits hardest, and closing it means wiring `venue_profile_id` through the event
surfaces — plumbing, not a badge. **Out of scope for M15. It plausibly gates Studio publication and
should be sized before that begins.**

### `R10` · §09 provenance is unimplemented

§09 also requires unclaimed profiles to *"state they were compiled from public information"*, and
imported data to be marked *imported & unverified*. `created_via` and `source_*` exist on the schema
but are **all NULL live** and are referenced **nowhere** in the client.

**M15 closes `P-C2` (marking). It does not close §09.** §09's ship-with list — the no-account
correction/removal channel, visible provenance, claim/interest rate-limiting, a retention policy —
remains outstanding and is a **launch** condition for public unclaimed profiles.

---

## Found in passing, deliberately excluded

**Duplicate React keys from account identity.** `user_id` identifies an *account*, not a profile, and
one account owns many profiles. The signed-in account owns **six** under
`94a88288-43aa-445b-abb8-7dc895804b51`, five of which render simultaneously in the DISCOVER carousel
— so `key={p.user_id}` emitted five identical keys **today, for claimed profiles**, with no unclaimed
row involved. React: non-unique keys *"may cause children to be duplicated and/or omitted"*.

Confirmed pre-existing by reproducing it with M15f stashed. M15f fixed the carousel; the same fault
remains at `MySceneScreen.jsx:996`, `:1112` (`p.user_id`) and `:1039` (`follows.entity_id`, the mixed
account/profile keyspace). **Raised as a separate narrowly-scoped task** — it is an identity-modelling
concern, not an unclaimed-marking one, and deserves its own review question.

**`FillSlotModal.jsx:38`** does `.eq('artist_id', prof.user_id)`, which for an unclaimed profile is
`.eq('artist_id', null)` — PostgREST will not match it, so the dedup lookup fails and repeat fills
insert duplicate `lineup_members`. Pre-existing, adjacent, untouched. Will bite once Studio publishes
unclaimed profiles that hosts add to lineups.

**`R3` · Unclaimed acts render without affordances.** `EventScreen.jsx:1474` gates Follow, social
links and VIEW PROFILE on `claim?.user_id`, which is `NULL` for an unclaimed profile. Such an act is
now *marked* but still renders without those controls. Held out of M15 by instruction: it is a
behaviour change, not marking, and belongs to its own task.

---

## Limits of this evidence

- Three surfaces were verified by stub, not by production data (see methodology above).
- The `claim_status = 'pending'` → *"Claim under review"* branch was **never exercised**: no live row
  is pending. That code is unmodified in every M15 diff and is verified by inspection only.
- Only one unclaimed profile exists in production. Behaviour with *many* unclaimed profiles on one
  surface — which is exactly what Studio publication produces — has not been observed. The duplicate-
  key finding above is one concrete reason to expect that scenario to surface further issues.
- No automated tests exist in `v2` (`oxlint` + `vite build` only), so every claim here rests on
  driving the running application and measuring the DOM.
