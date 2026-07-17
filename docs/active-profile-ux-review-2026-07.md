# Active Profile Context — UX review & recommendation

**Date:** 17 Jul 2026 · **Status:** review, not implementation · **Implements:** Identity Architecture v1.1 §A4b (R6, R6.1), constrained by R2 and §A9

> **Milestone note.** R6's purpose is stamping `from_profile_id` at write time. **That column lands at M6, which is paused at M5.1.** This document is design only. Nothing here is permission to start M6. The design is deliberately staged so the indicator can ship before the column exists (see §5.4).

---

## 0. Three corrections to the brief

Stated first because they change what is being designed.

**1. There is no active profile today — and the "My Scene profile area" is not one.**
The brief describes reviewing "the existing My Scene profile area that currently displays the active profile." It doesn't display an active profile. [`MySceneScreen.jsx:482`](../v2/src/screens/MySceneScreen.jsx#L482) renders a pill containing a generic person glyph and the **Personal (`punter`) profile's name**, with the account email beneath it. Tapping it opens a **rename dialog** ([`:466`](../v2/src/screens/MySceneScreen.jsx#L466)). It is an account-identity affordance, not a profile indicator, and it currently conflates profile with account — the exact conflation v1.1 exists to separate.

**2. The active profile cannot affect permissions — R2 forbids it.**
The brief asks to "identify every screen where the active profile affects permissions or behaviour." Per **R2**, the answer to the permissions half is **none, and none ever may**. The active profile is client-stored, untrusted UX state; a tampered value must change *only a label*. §4 therefore lists where it affects **attribution and scoping** — and separately flags the screens that today conflate the two.

**3. "Organisation" should not appear in the visual treatment.**
The brief suggests showing organisation. v1.1 **§A8/D1** locks V1 to single owner and strikes the word "manage"; an org line implies profiles belong to a company that several people act for. That is multi-manager surface, which the brief itself asks us not to expose. Recommendation: **no org field.** Owner is always "you" — rendering it says nothing true and forecloses nothing useful.

---

## 1. UX review of the current implementation

### 1.1 What exists

| Surface | File | What it does |
|---|---|---|
| Session context | [`App.jsx:41`](../v2/src/App.jsx#L41) | `SessionCtx = { session, isGuest }`. **No profile state of any kind.** |
| Global header | [`GlobalHeader.jsx`](../v2/src/components/GlobalHeader.jsx) | Back · `YESPLEEZ` tag · bell · info · share. **No profile indicator.** |
| Industry sheet | [`IndustryPanel.jsx`](../v2/src/components/IndustryPanel.jsx) | Bottom sheet listing the user's set-up types; navigates to `/industry/<type>`. **The de facto switcher.** |
| Role picker | [`RoleSelectorScreen.jsx`](../v2/src/screens/RoleSelectorScreen.jsx) | Full-screen role cards. Adds a profile; routes to setup or dashboard. |
| My Scene pill | [`MySceneScreen.jsx:482`](../v2/src/screens/MySceneScreen.jsx#L482) | Personal name + email; opens rename dialog. |
| Dashboard hero | [`DashboardProfileCard.jsx`](../v2/src/components/DashboardProfileCard.jsx) | Per-dashboard profile card: avatar, name, type badge, location, completion. |
| **Edit role tabs** | [`ProfileEditScreen.jsx:26,47-53,98-113`](../v2/src/screens/ProfileEditScreen.jsx#L98) | **The only working profile switcher in the product.** `activeType` state + tabs. Page-scoped. |
| **Enquiry "send as"** | [`ProfileScreen.jsx:196-206`](../v2/src/screens/ProfileScreen.jsx#L196) | **Explicit user-chosen sender picker**, prompts only when `n > 1` → full dual-write at `:215-224`. |
| **Follow-as picker** | [`ProfileScreen.jsx:257-266`](../v2/src/screens/ProfileScreen.jsx#L257) | Same shape, for follows. |
| **`viewAsPunter`** | [`EventScreen.jsx:219,478`](../v2/src/screens/EventScreen.jsx#L219) | Host↔punter view toggle + banner. A hand-rolled context switch. |
| Identity tokens | [`profileTypes.js`](../v2/src/lib/profileTypes.js) | **Sole source of truth** for accent, gradient, label, shortLabel, emoji, defaultImage, dashPath. |

**The product already promises this feature.** [`RoleSelectorScreen.jsx:158`](../v2/src/screens/RoleSelectorScreen.jsx#L158) reads *"Switch between modes anytime."* Nothing implements it. Picking a role sets no state — it navigates.

### 1.2 The core finding — the route *is* the active profile

There is no active-profile state. Instead, **the URL carries the type, and the type plus the user resolves the profile at read time**:

```
/industry/artist  →  profiles WHERE user_id = <me> AND type = 'artist'   → maybeSingle()
/industry/venue   →  profiles WHERE user_id = <me> AND type = 'venue'    → maybeSingle()
```

This pattern appears ~12 times ([`ArtistDashboard.jsx:159`](../v2/src/screens/ArtistDashboard.jsx#L159), [`HostDashboard.jsx:57`](../v2/src/screens/HostDashboard.jsx#L57), [`resolveProfileId.js:7`](../v2/src/lib/resolveProfileId.js#L7), and more), with 27 `maybeSingle()`/`single()` calls against `profiles` across the app.

**It works only because of a schema constraint.** [`MySceneScreen.jsx:466`](../v2/src/screens/MySceneScreen.jsx#L466) upserts with `onConflict: 'user_id,type'`, which proves **`UNIQUE(user_id, type)`** exists in the live database. One profile per type per user. So a user has **at most six** profiles: `punter`, `venue`, `host`, `artist`, `band`, `standup`.

This is the single most important input to the design, and it is good news — see §5.5.

### 1.3 Faults

**F1 — Two dead artefacts that look like the feature.** [`RoleSelectorScreen.jsx:111-122`](../v2/src/screens/RoleSelectorScreen.jsx#L111) writes a localStorage array via `activateRole`; `getActiveRoles` is read by nothing but `activateRole` itself, and both are exported and **imported by no one**. Separately, [`IndustryScreen.jsx`](../v2/src/screens/IndustryScreen.jsx) is **unrouted, unimported dead code** — and it holds the app's only role-detection logic. A future implementer will find one of these and reasonably assume it is the active-profile store. Neither is. **Delete both** before building; leaving them is an invitation to extend the wrong thing.

**F2 — Apply *displays* an arbitrary profile as fact.** [`EventScreen.jsx:1138`](../v2/src/screens/EventScreen.jsx#L1138):

```js
supabase.from('profiles').select('name,sound,genre_string,mix_link')
  .eq('user_id', userId).neq('type', 'punter').limit(1).maybeSingle()
```

`limit(1)` with **no `order`**. For a user with artist + band + standup profiles, Postgres returns whichever row it likes — and that profile is then rendered to the user as **"APPLYING AS: {name}"** ([`:1176-1178`](../v2/src/screens/EventScreen.jsx#L1176)), with no way to change it. The insert sets `artist_id: userId` only ([`:1160`](../v2/src/screens/EventScreen.jsx#L1160)), so the row cannot record which profile applied either.

**So the app already makes an attribution claim to the user's face, and the claim is arbitrary.** This is v1.1's `B2` reproducing itself in the UI, and it is the strongest argument for the whole feature.

**F2b — Two writes hardcode `'artist'`.** [`EventScreen.jsx:399`](../v2/src/screens/EventScreen.jsx#L399) and [`:1434`](../v2/src/screens/EventScreen.jsx#L1434) call `resolveProfileId(<user>, 'artist')`. A **band or standup** applicant therefore gets `artist_profile_id: null` silently. Attribution is not merely absent — it is wrong for two of the three performer types. Independent of the switcher, and worth logging separately.

**F3 — Event attribution is silent and derived, not chosen.** [`CreateEventScreen.jsx:374`](../v2/src/screens/CreateEventScreen.jsx#L374) calls `resolveProfileId(session.user.id, 'venue')` at submit and stamps `venue_profile_id`. Stamping at write time is accidentally **R6.1-correct**, but the value is *derived from the user*, never *chosen by them*. A user with both a host and a venue profile publishes events attributed to their venue with no indication that happened.

**F4 — Personal has no identity tokens, and adding them naively breaks §A9.** `punter` is absent from `PROFILE_TYPES`, deliberately ([`ProfileScreen.jsx:838`](../v2/src/screens/ProfileScreen.jsx#L838) comments that it "isn't a PROFILE_TYPES entry"). But the switcher must render Personal. **Do not simply add `punter` to `RAW_TYPES`** — `PROFILE_TYPE_ORDER` derives from `Object.keys(PROFILE_TYPES)` and drives filter tokens in [`FollowingSection.jsx:13`](../v2/src/components/FollowingSection.jsx#L13) and label maps in [`MySceneScreen.jsx:21-22`](../v2/src/screens/MySceneScreen.jsx#L21). Adding it there would surface Personal in discovery-adjacent filter UI — a **§A9 violation** ("never publicly discoverable"). Personal needs a *separate* export consumed only by the switcher.

**F5 — Accessibility baseline is zero.** Whole app: 6 `aria-label`s, no `aria-expanded`, no `aria-haspopup`, no `role="dialog"`, no `aria-modal`, no Escape handling, no `prefers-reduced-motion`. The switcher will be the app's **first** real disclosure widget. Budget for it; do not assume the pattern exists.

**F6 — `ProfileScreen` has no "this is mine" signal.** Viewing your own public profile is byte-identical to viewing a stranger's, save that the enquiry button is suppressed ([`ProfileScreen.jsx:177`](../v2/src/screens/ProfileScreen.jsx#L177)). There is no EDIT affordance and no ownership badge. Once a header chip says *"acting as Lucious"* while the page below gives no hint that this **is** Lucious, the gap becomes conspicuous. Not caused by this work, but surfaced by it.

**F7 — `AvailabilitySection` drops `profile_id`.** [`AvailabilitySection.jsx:34`](../v2/src/components/AvailabilitySection.jsx#L34) upserts with `user_id` only, while [`VenueDashboard.jsx:116`](../v2/src/screens/VenueDashboard.jsx#L116) writes `user_id` **and** `profile_id` to the same table shape. One of the two is wrong. Out of scope here — logged so it is not lost.

**F8 — The follow-as picker cannot work by design.** ⚠️ **Live bug — already known, see below.**

> **Previously discovered; not a new finding.** [`m2-design-review-2026-07.md:50`](m2-design-review-2026-07.md) recorded this on 2026-07-11 ("`followSelected` is keyed by `p.type` … passes an array of **type strings** into … `follows.user_id` (a `uuid` column)") and deliberately left it unfixed as out of scope for M2. [`known-issues/profile-follow-entity-type-drift.md:29-31`](known-issues/profile-follow-entity-type-drift.md) cross-references it. It reached this review independently, which is corroboration, not discovery. It is restated here only because it **decides open question 3** — and because it had never been surfaced into the active soak backlog (now **S28**).

[`ProfileScreen.jsx:841`](../v2/src/screens/ProfileScreen.jsx#L841) keys the selection Set by **`p.type`**, so `followSelected` holds `'venue'`, `'artist'`, `'punter'`. [`:865`](../v2/src/screens/ProfileScreen.jsx#L865) then calls `doFollow([...followSelected])`, and [`:276-277`](../v2/src/screens/ProfileScreen.jsx#L276) does:

```js
ids.map(uid => supabase.from('follows').insert({ user_id: uid, … }))
```

It inserts the **string `'venue'` into `follows.user_id`, a uuid column**. Postgres rejects it — `invalid input syntax for type uuid`. `doFollow` never checks the returned error, so it fails silently.

**Effect: a user with more than one profile cannot follow any profile.** Single-profile users take the `:265` path (`doFollow(session.user.id)` — a real uuid) and never reach this defect.

> **But they are not fine either.** Backlog **S1** / [`known-issues/profile-follow-entity-type-drift.md`](known-issues/profile-follow-entity-type-drift.md) records that `doFollow` also hardcodes `entity_type: 'profile'`, which violates `follows_entity_type_check` (`23514`) on **every** path, single-profile included. A live census found **zero rows in the table's entire history** with `entity_type = 'profile'`.
>
> **So the ProfileScreen follow button has apparently never recorded a follow for any account, in any configuration** — two independent defects stacked on one insert, both failing silently because `doFollow` never reads `.error`. Fixing the uuid bug alone changes nothing; S1 still rejects the row. This is why it survives: the button optimistically flips to "FOLLOWING" regardless.

**And it could not work even if the types were uuids.** Every profile a user owns shares **one** `user_id` — the account id. `follows` has no `from_profile_id` (v1.1 §A6 adds it at M6), and the query at [`:257-259`](../v2/src/screens/ProfileScreen.jsx#L257) does not even select `profiles.id`. **The picker asks a question the schema cannot represent.** With uuids fixed it would write N identical duplicate rows.

This is v1.1's `B2` a third time, and it is the cleanest possible demonstration of why §A6 says follows must **gain** a profile column rather than move the user one.

> **Hypothesis worth testing — the "Supabase outage" follow 400 may be this constraint.** A separate note records a `follows` 400 on the **event heart** ([`EventScreen.jsx:233`](../v2/src/screens/EventScreen.jsx#L233)), provisionally blamed on a Supabase platform outage or an `entity_name` mismatch. That path passes a real uuid, so it is not the F8 defect — **but it inserts `entity_type: 'event'`, and the same `follows_entity_type_check` that rejects `'profile'` (S1) may reject `'event'` too.** The census found only `'artist'` and `'venue'` values in the table's history, and S1's own checklist notes the constraint's allowed values **have never been read** (`pg_get_constraintdef` is not visible through REST).
>
> If the constraint excludes `'event'`, then the "outage" 400 was never an outage — it was the same schema drift, and it is still there. **One SQL query settles it.** See §5.7.

**F9 — One layout, not two.** `.header` is `width: min(100%, 680px)` centred ([`GlobalHeader.module.css`](../v2/src/components/GlobalHeader.module.css)); `BottomNav` is always mounted. **There is no desktop layout** — desktop is the same 680px column. The brief's "desktop and mobile header" question largely dissolves: design once, at 680px, and verify at 360px.

---

## 2. Where the active profile matters

### 2.1 Permissions — nowhere (R2)

No screen may gate permission on the active profile. Authorization is `owner_user_id` server-side, through `can_act_as()` from M6. **If a reviewer finds the switcher value reaching an authorization check, that is a bug, not a feature.**

Today's ownership gates correctly use the *account*: [`ProfileScreen.jsx:182`](../v2/src/screens/ProfileScreen.jsx#L182) compares against `session.user.id`. That is right and must not change.

### 2.2 Attribution — the write surfaces

Every row written on behalf of a profile. Sourced from the app's `.insert(` calls and cross-checked against v1.1 §A3.

| Screen / component | Table | Identity written today | Pair? |
|---|---|---|---|
| [`EventScreen`](../v2/src/screens/EventScreen.jsx#L1160) `ApplyButton` | `applications` | `artist_id` (user) | ✗ **missing** |
| [`notifActions.js:48`](../v2/src/lib/notifActions.js#L48) `acceptInvite` | `applications` | `artist_id` (user) | ✗ **missing** |
| [`ArtistDashboard.jsx:274`](../v2/src/screens/ArtistDashboard.jsx#L274) offer respond | `applications` | `artist_id` (user) | ✗ **missing** |
| [`EventScreen.jsx:233`](../v2/src/screens/EventScreen.jsx#L233) follow | `follows` | `user_id` | ✗ **missing** |
| [`CreateEventScreen.jsx:375`](../v2/src/screens/CreateEventScreen.jsx#L375) | `events` | `host_id` + `venue_profile_id` | ✓ (derived) |
| [`FillSlotModal.jsx:41`](../v2/src/components/FillSlotModal.jsx#L41) | `lineup_members` | `artist_id` + `artist_profile_id` | ✓ (subject) |
| [`InviteSheet.jsx:90`](../v2/src/components/InviteSheet.jsx#L90) | `venue_enquiries` | `applicant_profile_id` + user | ✓ |
| [`writeNotification.js`](../v2/src/lib/writeNotification.js), `notifActions` | `notifications` | `user_id` | ✗ (M6/M8) |

Three `applications` call sites and `follows` are the gap — exactly v1.1's audit. **Note `lineup_members.artist_profile_id` is the performer being booked — the *subject*, not the actor.** Do not let a switcher rewrite it.

### 2.3 Scoping — R6 scopes the feed, R5 aggregates the badge

The unread badge queries `.eq('user_id', session.user.id)` ([`App.jsx:71`](../v2/src/App.jsx#L71)) — account-wide. **This already satisfies R5** ("the badge aggregates across every profile"). v1.1 §A4b flags this tension as *intentional*. When the feed becomes profile-scoped at M6+, **do not "fix" the badge to match.** Add a code comment saying so.

### 2.3b The capability this unblocks — IA-01

The active profile context is not only about *labelling*. It is what makes **`docs/identity-validation-scenarios.md` IA-01** possible: a user acting as their Venue enquiring to their own Artist profile, as two independent parties.

Today [`ProfileScreen.jsx:177`](../v2/src/screens/ProfileScreen.jsx#L177) suppresses that entire affordance with `if (profile.user_id === session.user.id) return;` — an **account-level** fact answering a **profile-level** question. The profile-level form is `if (profile.id === activeProfile.id) return;`, which **cannot be written until this context exists**. The app cannot ask "am I this profile?" while it only knows which account you are.

**So the scope here is larger than the review's framing implies.** §2.4 treats the missing context as a *confusion* risk. IA-01 shows it is also a *capability* gap: a fundamental interaction the architecture promises and the app cannot express. See IA-01 for why that scenario, in particular, isolates attribution — `can_act_as()` is true for both profiles, so nothing but attribution can carry the behaviour.

### 2.4 Screens where the wrong profile would confuse — ranked

| Rank | Screen | Confusion |
|---|---|---|
| **1** | `EventScreen` apply | Application shows a *random* profile's name/mix (F2). User cannot see or choose. Irreversible impression on a host. |
| **2** | `CreateEventScreen` | Event silently attributed to your venue while you believe you are acting as host (F3). Public and permanent. |
| **3** | [`InviteSheet`](../v2/src/components/InviteSheet.jsx#L64) enquiry | Enquiry appears to come from a profile the sender never picked — `resolveProfileId` derives it. Commercial, addressed to a stranger. **Note the split:** the *other* enquiry path ([`ProfileScreen.jsx:196`](../v2/src/screens/ProfileScreen.jsx#L196)) **does** ask. Same feature, two surfaces, opposite behaviour — which is the whole argument in §4. |
| **4** | Follows | Personal follows pollute a venue's roster (v1.1 §A6, known live fault). Invisible until M6 splits it. |
| **5** | `ProfileEditScreen` | Multi-profile users edit "a" profile with weak signal as to which. |
| **6** | Notifications feed | Post-M6 scoping will make "where did my notification go?" possible if the indicator is absent. |

Ranks 1–3 are all **sends** — irreversible, outward-facing, seen by another human. That drives the recommendation.

---

## 3. Three approaches

### Approach A — Header chip + dropdown

Persistent chip in `GlobalHeader` (avatar + name + chevron); tap opens an anchored dropdown listing profiles.

**Pros:** always visible; conventional (Google/GitHub/Slack); one component; indicator and control colocated.
**Cons:** header is already back + wordmark + 3 icons ≈ 260px of 360px — a chip with a name does not fit at 360px without cutting something; dropdowns are top-anchored and thumb-hostile on mobile; the app has no dropdown/focus-trap pattern (F5); tap targets near the notification bell invite mis-taps — an **accidental switch adjacent to a real control**.

### Approach B — Header avatar (indicator) + bottom-sheet switcher

Header shows a **small avatar only** (28px, type-accent ring). Tapping opens a bottom sheet — the same pattern as `IndustryPanel`.

**Pros:** avatar-only fits the 360px budget; sheet is thumb-reachable and has room for six rows with avatar, name, type badge; **reuses the existing sheet pattern** users already meet under INDUSTRY; degrades to the same layout at 680px; sheet is a natural `role="dialog"` — easier to make accessible than a dropdown.
**Cons:** avatar alone is a weak identity signal — an unset profile shows a default image and two profiles could look alike; two sheet patterns (Industry + switcher) risk conceptual overlap; one extra tap versus a dropdown.

### Approach C — No global indicator; per-action "Sending as ▼"

No persistent chip. Every write surface carries an inline attribution control at the point of send. This is the control v1.1 §A4b names explicitly.

> **This already exists and works.** [`ProfileScreen.jsx:196-206`](../v2/src/screens/ProfileScreen.jsx#L196) prompts the user to choose which profile an enquiry is sent as — but **only when they have more than one** — and then performs the cleanest write in the codebase ([`:215-224`](../v2/src/screens/ProfileScreen.jsx#L215)): `applicant_profile_id` *and* `applicant_user_id`, both stamped at submit. [`:257-266`](../v2/src/screens/ProfileScreen.jsx#L257) does the same for follows. **Approach C is not a proposal. It is an existing, working, R6.1-shaped pattern that was simply never generalised.**

**Pros:** friction lands exactly where harm occurs (§2.4 ranks 1–3 are all sends); **R6.1 becomes literal** — you choose at the moment you write; nothing to mis-tap while browsing; zero header cost; **proven in this codebase**.
**Cons:** no ambient answer to "who am I right now?", which the brief explicitly asks for; must be added to every write surface and **silently omitted from the next one** — which is exactly what happened: the enquiry path got it, the apply path (F2) did not; scoping (dashboards, feed) still needs a context this does not provide.

---

## 4. Recommendation — B + C, with the friction at the send

**Adopt Approach B for the indicator and switching, and Approach C for confirmation at write time.** They are not alternatives; they answer different questions.

The reasoning is architectural, not aesthetic. **R6 says switching never edits existing data.** So switching is *cheap and reversible* — an accidental switch changes a label and the next write's attribution, nothing more. **R6.1 says attribution is stamped at the write.** So the *dangerous* moment is not the switch, it is the send.

> **Therefore: make switching easy and make sending explicit.** Put no confirmation on the switch. Put an unmissable "Sending as …" on every write.

This inverts the brief's instinct to "minimise accidental profile switches" by guarding the switcher. Guarding the switcher is the wrong place — it adds friction to a harmless act while leaving F2 (the actual harm) untouched.

**The evidence backs this.** The codebase ran the experiment already. The enquiry path asks the user who they are sending as ([`ProfileScreen.jsx:196`](../v2/src/screens/ProfileScreen.jsx#L196)) and writes a correct, complete, attributable row. The apply path does not ask, and writes an unattributable row under an arbitrary name (F2). Same app, same week, same author — the difference is entirely whether the send surface asked. **Generalise the pattern that worked.**

What is genuinely new is only the ambient indicator and the shared context. The write-time control is a promotion of `ProfileScreen`'s picker into a reusable component.

### 4.1 Visual treatment

**Header indicator** — avatar (28px) with a 2px ring in the profile's `PROFILE_TYPES.accent`, plus a chevron. Name is **not** in the header: it does not fit at 360px, and the sheet carries it.

**In the sheet, each row:** avatar (40px) · name (Bebas Neue) · type badge (`shortLabel`, accent pill — the established `.typeBadge` treatment) · location. This is `DashboardProfileCard`'s vocabulary at list density; reuse its tokens, do not invent.

**Colour alone is never the signal** (accessibility, and two performer types both trend pink/violet). Every row and the header chip carry the **type badge text**. The accent ring is reinforcement, not information.

**Personal** needs a token set (F4). Add a **separate export** — e.g. `PERSONAL_TYPE` in `profileTypes.js`, deliberately *outside* `RAW_TYPES` so `PROFILE_TYPE_ORDER` never sees it — consumed only by the switcher. Suggested: neutral grey accent, label `PERSONAL`, a person glyph rather than a photo. Its visual quietness is correct: Personal is not an industry identity and is never discoverable.

### 4.2 Should the My Scene component go global?

**Neither — retire it as an identity surface.** It is not an active-profile component (§0.1); promoting it would globalise the profile/account conflation. Split its two jobs:

- **Identity** (who am I acting as) → the new global header indicator.
- **Account** (email, rename Personal, sign out) → stays in My Scene, relabelled as account settings. Renaming your Personal profile is an **account-level action** — v1.1 §A3's account-actionable class — and belongs nowhere near the switcher.

`DashboardProfileCard` stays page-specific. It is a *profile hero* (completion bar, edit CTA), not an indicator. Do not fold it into the switcher.

**`ProfileEditScreen`'s role tabs** ([`:98-113`](../v2/src/screens/ProfileEditScreen.jsx#L98)) are the app's only working switcher, and they **should be retired into the global context** once it exists — otherwise the app has two competing answers to "which profile am I editing?" that can disagree. Until then they are the best reference implementation available: read `activeType`/`switchType` before writing the context.

**`viewAsPunter`** ([`EventScreen.jsx:219`](../v2/src/screens/EventScreen.jsx#L219)) is a hand-rolled context switch that exists because `isHost` is an **account-level** check (`host_id === user.id`) — a user who is both host and performer on their own event gets host UI unconditionally and needs an escape hatch. **Leave it alone for now.** It is a view toggle, not attribution, and folding it into the switcher would quietly make the active profile look load-bearing for what the host can see — an R2 smell. Revisit only after the context ships.

### 4.3 One profile → many

`UNIQUE(user_id, type)` caps profiles at **six**. No search, no pagination, no grouping, no virtualisation — ever, under the current schema. The design does not need to "scale"; it needs to be correct at n ≤ 6.

| State | Header | Sheet |
|---|---|---|
| Guest | *(nothing)* | — |
| Personal only (`n=1`) | Avatar, **no chevron**, not a button | — (tap → `/role-select` to add) |
| 2–6 profiles | Avatar + chevron | Rows + `ADD PROFILE` |

No org line, no "acting on behalf of", no manager language (§0.3). At `n=1` the control is **not interactive** — a switcher with one option is a lie.

### 4.4 Staging — this can ship before M6

Deliberately ordered so the paused migration is not a blocker:

1. **Now (safe):** `ActiveProfileCtx` in `App.jsx`; header indicator; sheet; scoping only. **Read-only — touches no write path.** Delete `yp_active_roles` (F1). Fix F2's missing `order` so today's arbitrary pick becomes at least deterministic.
2. **M6 (paused — do not start):** `from_profile_id` lands; context feeds attribution; "Sending as" appears on write surfaces; `can_act_as()` binds R3.2.

Step 1 is genuinely useful alone: it fixes "which profile am I?" without touching a single write. **Step 2 is M6 work and is not authorised.**

---

## 5. Interaction flow

### 5.1 State

```
ActiveProfileCtx  (App.jsx, beside SessionCtx)
  activeProfileId : uuid | null      // localStorage 'yp_active_profile_id'
  activeProfile   : profiles row | null
  profiles        : profiles row[]   // WHERE user_id = me, ordered
  setActiveProfile(id)
```

**Untrusted by construction (R2).** Rules:

- On load: read localStorage → **verify the id is in `profiles`** (owner check server-side via RLS) → else fall back to Personal. A tampered id resolves to a profile you do not own → **discard it**.
- Default: **Personal**. Never a commercial profile — defaulting to Venue would make an unattended send attribute commercially.
- Order: `PROFILE_TYPE_ORDER` (Venue-first canonical), Personal pinned last.
- **Never** passed to an authorization check. **Never** stamped anywhere but at a write (R6.1).

### 5.2 Header

```
┌──────────────────────────────────────────────────┐
│  ‹     [ YESPLEEZ ]          (◍▾)  🔔²  ⓘ  ⤴   │
└──────────────────────────────────────────────────┘
                                  ▲
                    28px avatar, ring = type accent
                    chevron only when n ≥ 2
```

Placement: **leftmost in `.actions`**, before the bell. Rationale — it is identity, not an action; separating it from the bell reduces mis-taps; `.actions` already has `margin-left:auto`, so no layout surgery.

Budget at 360px: back 36 + tag 90 + chip 40 + icons 102 + gaps 28 = **296 / 360**. Fits. At 680px it simply sits further right.

### 5.3 Switch flow

```
Tap avatar
   │
   ├─ n = 1 ──→ navigate /role-select  ("add a profile")
   │
   └─ n ≥ 2 ──→ Bottom sheet: "ACTING AS"
                 ┌────────────────────────────────┐
                 │  ▔▔▔▔  (drag handle)           │
                 │  ACTING AS                     │
                 │  ┌──────────────────────────┐  │
                 │  │ ◍  Elbows Rest   [VENUE] │✓ │ ← current: accent border + ✓
                 │  │    Bellingen, NSW        │  │
                 │  ├──────────────────────────┤  │
                 │  │ ◍  Lucious    [DJ/PROD.] │  │
                 │  ├──────────────────────────┤  │
                 │  │ ◍  You         [PERSONAL]│  │ ← pinned last, neutral
                 │  └──────────────────────────┘  │
                 │  ＋ ADD PROFILE                │
                 └────────────────────────────────┘
                          │
                   Tap a row
                          │
                   setActiveProfile(id)
                   sheet closes (~180ms)
                   header avatar cross-fades
                   toast: "Now acting as Lucious"   ← 2.5s, polite
                          │
                   NO confirmation dialog — switching edits nothing (R6)
```

**Switching never navigates.** You stay on the page. Scoped views refetch; public views are unaffected. (Today's model would navigate to `/industry/<type>` — that conflation is what we are removing.)

### 5.4 Send flow — where the friction lives (M6)

```
EventScreen ▸ APPLY TO PLAY
   ┌────────────────────────────────┐
   │  Sending as                    │
   │  ┌──────────────────────────┐  │
   │  │ ◍ Lucious   [DJ/PROD.] ▾ │  │ ← tap = same sheet, scoped to
   │  └──────────────────────────┘  │   eligible types (performers only)
   │  [ note … ]                    │
   │        [ SEND APPLICATION ]    │
   └────────────────────────────────┘
              │
        on submit → read activeProfile NOW  (R6.1: stamp at write)
                  → insert { from_profile_id, from_user_id }
```

Three properties, each traceable to a rule:

- **Read at submit, not at mount.** Switch mid-compose and the send carries the new value — this is precisely the case v1.1 §A4b says R6.1 exists to dissolve.
- **Eligibility ≠ permission.** Filtering the picker to performer types is a UI affordance (R2). The server still authorizes via `can_act_as` (R3.2). The filter must never be the check.
- **Drafts do not re-attribute.** A draft has no attribution (v1.1 §A4b: drafts are workspace). Only the send stamps.

### 5.5 Accessibility (net-new — F5)

| Element | Requirement |
|---|---|
| Header chip | `<button>`, `aria-haspopup="dialog"`, `aria-expanded`, `aria-label="Acting as Lucious, DJ / Prod. Change profile"` |
| Sheet | `role="dialog"`, `aria-modal="true"`, labelled by the "ACTING AS" heading |
| Focus | Trap while open; move to current row on open; **return to the chip on close** |
| Keyboard | `Esc` closes; arrows move rows; `Enter`/`Space` selects |
| Current row | `aria-current="true"` — not colour alone |
| Switch announce | `aria-live="polite"` on the toast |
| Motion | Honour `prefers-reduced-motion` — no slide, no cross-fade |
| Targets | ≥44px rows; chip ≥44px hit area though painted 28px |

### 5.6 Open questions

1. **Personal's tokens** — accent, glyph and the exact label (`PERSONAL` vs `YOU`) are unspecified. Product call.
2. **`booking_interest`** — still unresolved from the archive work; if it exists live, it is a send surface and needs "Sending as".
3. ~~**Follows attribution** — should following *as a venue* be possible pre-M6?~~ **Resolved by F8: it is not possible, at all, until M6.** `follows` has no `from_profile_id`; every profile shares one `user_id`; the column that would carry the answer does not exist. **Personal owns every follow until §A6's split lands.**
   Consequences for this design: the "Sending as" control **must not** appear on the follow button pre-M6 — it would present a choice the database cannot record, which is exactly F8's mistake repeated deliberately. The existing picker should be **removed, not fixed**: it is unreachable-by-design work that only ever produced a 400. It returns at M6, backed by a real column.
4. **`punter`-only users** — is Personal even shown, or is the chip hidden until a second profile exists? §4.3 assumes shown-but-inert; worth testing.

### 5.7 One Supabase session unblocks three parked items

Three findings across two phases of work are all blocked on the same thing — **read access to the live schema** — and none can be settled from the repository:

| Item | Question | Raised in |
|---|---|---|
| `booking_interest` | Does the table exist? v1.1 §A3 says "✓ already"; the repo has no trace. | `docs/architecture/README.md`, CI spec registry |
| Tier 2 baseline dump | `pg_dump --schema-only` — migrations contain no `CREATE TABLE`, so C2/C3/C5 cannot run without it. C3 must exist before M6. | `docs/identity-ci-spec.md` Tier 2 |
| `follows_entity_type_check` | What values does it allow? Decides S1, S28, and whether the "outage" event-heart 400 is really schema drift. | S1 checklist; F8 above |

**The dump answers all three.** It contains the table list (settles `booking_interest`), it *is* the Tier 2 prerequisite, and it carries every `CHECK` definition (settles the constraint). Sequencing note: the dump is already on the critical path for M6 via C3 — taking it early costs nothing extra and closes two other threads for free.
