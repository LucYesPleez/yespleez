# Release readiness — Phase 11A (closed-beta validation)

**Date:** 17 Jul 2026 · **Branch:** `v2-react` · **Build:** passes · **Lint:** 121 warnings, 0 errors

## 1. Verdict

**Conditional GO for a closed beta scoped to browsing + profile setup. NOT ready for a beta whose core loop is following, personal-events, or venue→artist booking.**

The split is clean and worth stating plainly:

- **The unauthenticated / discovery surface is beta-ready.** Validated live end-to-end (§2): zero runtime or console errors, correct empty and error states, no broken images, no page-level layout overflow at desktop *or* mobile. A tester can browse events, discover profiles, view any profile, and search — reliably.
- **The authenticated / industry surface carries several real defects (§4), and every one of them is an RLS-policy, schema, or M6 issue — none is fixable in a code-only pass.** They need a migration or a product decision, both out of 11A's scope ("do not change the database schema"). So this phase changed almost nothing in code by design, not omission.

**The honest coverage caveat:** roughly the guest-reachable ~40% of the app was validated by driving it. Everything behind auth — the five profile editors, all four dashboards, applications, enquiries, the opportunity pipeline, invitations, save/delete flows, notifications-with-data, and every follow/booking *action* — **could not be exercised without credentials** and is unverified here. The standing rule applies: those are the tester's job (§10), and the P1/P2 list below is drawn from the accumulated audits, not from live 11A observation.

---

## 2. What was validated live (guest session, desktop 1280 + mobile 375)

| Surface | Result |
|---|---|
| Auth screen, guest entry | ✓ renders, guest flow works |
| What's On (calendar, event cards) | ✓ no errors |
| Discover (cards, filters, search "lucious") | ✓ search filters correctly |
| Event page (valid UUID) | ✓ renders lineup/details |
| Profile page (venue, via card click) | ✓ renders, canonical `?type=` URL |
| My Scene (guest) | ✓ correct sign-in gate |
| Notifications (guest) | ✓ empty state (but see P3-c) |
| Navigation (card → event, card → profile) | ✓ works |
| Error states | ✓ "Profile not found"; bad event id → redirect home |
| Images | ✓ 17 distinct, 0 broken |
| Horizontal overflow | ✓ none at page level, either width (rail children scroll internally, by design) |
| Console/runtime errors on normal flows | ✓ none |

The reachable surface is genuinely clean. This is a real result, not an absence of looking.

---

## 3. Bugs fixed in this pass (1)

**`EventScreen` had two `enabled` keys on its event query** (`enabled: isRealEvent` and `enabled: !!id`) — a duplicate object key, so the first was silently dead. Removed the dead key, kept the effective one (`!!id`), so **runtime behaviour is exactly what shipped** — verified live for valid, malformed, and nonexistent event ids (all three unchanged). Commit `0eb090d`.

Notably, the *tempting* fix — keeping `isRealEvent` as the intended guard — was tried and **reverted**: it disables the query for malformed ids, which then fall to a `navigate('/')` called during render, which React Router swallows, leaving a **blank event page** instead of the redirect. Only driving it in the browser caught that. Recorded because it is a precise example of why a validation phase tests behaviour rather than trusting that the "obviously correct" refactor is safe.

---

## 4. Findings by severity

**None classified P0.** Nothing on the reachable surface crashes, white-screens, or corrupts data; the guest experience is stable. The authenticated defects are serious but degrade features rather than block the app from running.

### P1 — High (fix before the beta relies on these loops)

Every P1 is RLS/schema — a migration, not a code change.

| ID | Issue | Why P1 | Fix path (out of 11A scope) |
|---|---|---|---|
| **S1** | The profile **FOLLOW button silently fails for everyone** (`entity_type: 'profile'` violates a CHECK; error unchecked). Following is advertised on My Scene as a core loop. | A primary, promoted action that has never worked, for any user, on any profile. | Read `follows_entity_type_check` (still unread — needs SQL), write the profile's real type, add `.error` handling. Pair with **S28** (the multi-profile picker inserts type strings into a uuid column) — same subsystem, fix together. |
| **S30** | **`personal_events` returns 500 on every query** — infinite recursion in its RLS policy. The My Scene "add to your scene" feature is 100% non-functional in production. | A visible feature that fails on every load. Fails closed (no data risk), so not P0. | Read + rewrite the recursive policy (SQL editor). Retire the "outage" hypothesis in `supabase-pending`. |
| **S29** | **Anon can enumerate Personal (`punter`) profiles and read display names** — §A9 ("never publicly discoverable") is unenforced. | A stated, frozen privacy invariant is violated with the public anon key. Names + ids only (no contact/credentials), so tolerable for a *trusted* closed cohort — **but must close before the beta widens.** | RLS policy on `profiles` restricting `type='punter'` reads to the owner. SECURITY class → its own schedule, independent of M6. C6 (the resolver work) does **not** close it. |

### P2 — Normal

| ID | Issue | Notes |
|---|---|---|
| **S2** | Venue availability invisible to non-owners — no public-read policy, so the CHECK AVAILABILITY calendar and enquiry picker render empty for exactly their audience. | RLS + a product decision (public vs authed read). Degrades the enquiry flow, which is itself partly M6-gated. |
| **S9** | "APPLYING AS: \<wrong profile\>" for multi-role accounts on the apply flow. | Cosmetic-to-wrong; multi-profile accounts only. Root is S6 (applications has no profile column) → M6. |
| **S3** | Applicant accept/decline on enquiries is a silent no-op (UPDATE policy is venue-side only; UI optimistically lies). | Business-rule decision + RLS. |

### P3 — Polish (documented; not fixed — see §6 for the risk rationale)

- **(a)** `EventScreen:1737` — duplicate `fontSize` key in an inline style object (second wins, first dead). Cosmetic; left to keep this commit to the one behaviour-relevant fix.
- **(b)** `auLocations.js` — ~29 duplicate keys in the suburb→postcode map. Same-named suburbs in different states (Hamilton NSW/VIC/QLD…) silently collapse to the last one, so a postcode search finds only one. A flat `name → postcode` map structurally can't represent this; fixing means re-keying by name+state — an architectural change, out of scope. Future enhancement.
- **(c)** Guest **Notifications** shows "NO NOTIFICATIONS YET / We'll let you know when something happens" — but a guest can never receive one. My Scene shows a sign-in prompt in the same situation; Notifications should too. Inconsistent, harmless.
- **(d)** Unknown route (`#/nonsense`) falls through to the default screen — no 404 page. Soft-fail, no crash.
- **(e)** A malformed/nonexistent event id **silently redirects to What's On** rather than showing "event not found", so a broken shared link looks like it worked and lands on the wrong page.

### Future enhancements / out of scope (documented elsewhere)

- **S4** — venue→artist invites return `42501` until M6 (applicant-side-only INSERT policy). Now schema-correct with a graceful "Venues can't send invites yet" message, so it reads as *disabled*, not broken. **Not a bug** — an M6 feature.
- **M6 itself** — write-cutover, `can_act_as()`, the identity seam. Paused. S5/S6/S9 resolve here.
- **D1–D8** — booking-vocabulary decisions (`docs/booking-vocabulary-2026-07.md`).
- **S31, S35–S38** — completion formulas, accent resolver polish, terminology, dashboard architecture, dead code. Debt, not defects.

---

## 5. Build & lint

- **Build:** `vite build` passes clean.
- **Lint:** `oxlint` — **0 errors, 121 warnings** (down 1 from the dupe-key fix). The remaining warnings are `no-unused-vars` on `_` catch params, `exhaustive-deps` (deliberately left — changing a deps array changes when effects run, a behaviour change), and the two documented dupe-keys (P3-a, P3-b). None is a release blocker.

---

## 6. Why so little was changed — and why that's correct

11A is a validation phase, and the discipline is *not* to manufacture fixes. The reachable surface validated clean, so there was nothing to fix there. The authenticated defects are all migration/decision work the phase explicitly excludes. The one code change (the dupe-key) was the only genuine, safe, code-level bug validation surfaced — and even that required a revert when the first approach proved to be a regression. Changing more would have meant either editing behind-auth code I cannot verify, or touching RLS the phase forbids. A validation phase that ships one verified fix and a classified defect map is doing its job.

---

## 7. Manual regression checklist — the unverified surface (tester, logged in)

I could not reach any of this without credentials. For a closed-beta sign-off, a human should drive each, as each profile type:

**Editors (all five)** — load, edit a field, **save**; confirm no `created_at`/`updated_at` written back; STATE dropdown and experience chips populate (10G moved those constants).
**Dashboards (Artist/Band/Comedy, Host, Venue)** — render; the OUTGOING applications empty tabs read as clean sentences (10H fix); enquiry panel empty sub-tabs too.
**Applications** — apply to an event; confirm "APPLYING AS" shows the intended profile (S9 caveat for multi-profile accounts).
**Enquiries** — artist→venue enquiry end-to-end (this is the flow that breaks if the `venue_enquiries` migration wasn't applied — it was; confirm it still writes).
**Invitations** — venue→artist invite; expect the graceful "Venues can't send invites yet" message (S4, by design until M6), **not** a raw error.
**Following** — follow a profile from its page; **this currently fails silently (S1)** — confirm whether that's acceptable for the beta or a pre-req fix.
**Personal events** — My Scene "add to your scene"; **currently 500s (S30)** — same question.
**Notifications (with data)** — a real inbox renders, badges clear on read.
**Save/delete flows** — create/edit/delete an event; delete an event that has an enquiry (exercises `ON DELETE SET NULL`).
**Responsive** — repeat a dashboard and an editor at 375px; confirm no overflow or clipping.
**Cross-profile** — a multi-profile account: switch between dashboards, confirm no data bleed and correct per-type branding.
