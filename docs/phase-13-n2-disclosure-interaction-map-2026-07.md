# Phase 13.2 · `N2` — disclosure interaction map

**Audit only. No UI written.** Produced 2026-07-20, before implementation, per the owner's
instruction. Every row below was established by reading the live source at the cited line;
nothing is inferred from naming.

`N2`: *"Anyone acting toward an unclaimed profile sees that it is unclaimed and that their
action will be held rather than delivered, at the point of acting — not afterwards, and not in
help text."*

---

## 0 · The headline

**The app's current strategy for unclaimed profiles is to HIDE contact actions, not to disclose
them.** `ProfileScreen` gates Message, venue CHECK AVAILABILITY and performer CHECK AVAILABILITY
behind `!isUnclaimed`, and offers *"Is this you? Claim this profile"* instead.

That is a coherent strategy, but it is **not the one the specification describes**, and the two
cannot both be right. §3 of the Q1 brief permits Application and Enquiry toward an unclaimed
owner *"✅ Yes, with `N2` disclosure"*, and §2 is explicit about why:

> The artist then makes an informed choice. Some will apply anyway — a held application costs
> them little and may pay off. Others will not. **Either is fine; being surprised is not.**

Hiding does prevent surprise. It also removes the choice the spec wants the artist to have, and
it forfeits the held pile that `N3` calls the payoff of the whole model — a venue cannot claim
its profile and find three enquiries waiting if the enquiry button was never rendered.

**This is a scope decision for the owner, not a disclosure detail**, because closing the gap
means *enabling* actions that are currently blocked. It is called out here rather than resolved
silently. See §3.

**Meanwhile exactly one action can reach an unclaimed profile today and it discloses nothing:
Follow.** That is the true `N2` gap in the current build, and the smallest correct first step.

---

## 1 · Interaction inventory

Legend — **Reachable**: can a user perform this against an unclaimed target today?
**Notifies**: does it write a notification? **Disclosure**: is `N2` satisfied?

| # | Interaction | Site | Reachable when target unclaimed | Notifies | Disclosure | Verdict |
|---|---|---|---|---|---|---|
| **A** | **Follow a profile** | `ProfileScreen.jsx:374` insert · `:397` notify · button `:727` | ✅ **YES** — the Follow button is gated only on `followBusy \|\| !session`, never on claim state | ✅ **Held** since N1 | ❌ **none** | **`N2` REQUIRED — the live gap** |
| **B** | **Apply to an event** | `EventScreen.jsx:1201` insert · button `:1215` · render guard `:507` | ✅ **YES** — gated only on `!effectiveIsHost && !isGuest && event.applications_open`. **Never on the event owner's claim state.** Studio-imported events owned by unclaimed profiles are applyable today | ❌ **no notification at all** — `submit()` inserts the row and stops | ❌ none | **`N2` REQUIRED** |
| **C** | **Follow a performer from an event lineup** | `EventScreen.jsx:1519` | ✅ YES — no claim gate | ❌ none — unlike A, this path never calls `writeNotification` | ❌ none | **`N2` REQUIRED + N1 gap (§2)** |
| **D** | **Add a performer to a slot** | `FillSlotModal.jsx:38-41` | ✅ YES — selects profiles by `user_id`, which is NULL for unclaimed | ❌ none | ❌ none | **`N2` REQUIRED (host-facing)** |
| **E** | **Enquire — venue profile** (CHECK AVAILABILITY) | `ProfileScreen.jsx:755` | 🚫 **HIDDEN** by `isVenue && !isUnclaimed` | n/a | n/a — action absent | **Spec divergence (§3)** |
| **F** | **Enquire — performer profile** (CHECK AVAILABILITY) | `ProfileScreen.jsx:784` | 🚫 **HIDDEN** by `isPerformer && !isUnclaimed` | n/a | n/a | **Spec divergence (§3)** |
| **G** | **Venue invites a performer** | `InviteSheet.jsx:114` insert · `:133` notify | 🚫 Not via `ProfileScreen` (reached through the gated buttons at E/F). **`VenueDashboard.jsx:318` mounts it too — reachability there is UNVERIFIED** | ✅ would hold — `toUserId: artist.user_id` is NULL for unclaimed | ❌ none | **Verify reachability, then `N2`** |
| **H** | **Message** | `ProfileScreen.jsx:740` | 🚫 hidden, and disabled/`SOON` for everyone | n/a | n/a | **No action** — not built |
| **I** | **Follow an event** | `EventScreen.jsx:254`, `WhatsOnScreen.jsx:109` | ✅ yes, and the event's owner may be unclaimed | ❌ none | ❌ none | **No disclosure needed** — §2 |
| **J** | **Accept / decline an invite** | `ArtistDashboard.jsx:311` | 🚫 an unclaimed venue cannot have sent an invite | ✅ guarded `offer.venue_user_id &&` | n/a | **No action** — see §2 |
| **K** | **Shortlist / decline an applicant** | `ApplicationsScreen.jsx:71`, `HostDashboard.jsx:245` | 🚫 an applicant is always a real account | ✅ | n/a | **No action** |

---

## 2 · Findings that are not disclosure

Surfaced by the audit; recorded so they are not lost, **not** in `N2`'s scope.

**F1 · The lineup follow (C) writes no notification, while the profile follow (A) does.**
Following the same artist produces a held notification from their profile page and nothing from
an event lineup. `N1`'s guarantee is therefore path-dependent. `EventScreen.jsx:1519` also
writes `entity_id: claim.user_id`, which is **NULL** for an unclaimed member, and hardcodes
`entity_type: 'artist'` — already logged as **S33**.

**F2 · Adding an unclaimed performer to a lineup (D) writes `artist_id: prof.user_id` = NULL.**
The lineup row exists but names nobody. Distinct from S32, which is the Band-type variant.

**F3 · Applying to an event notifies nobody, claimed or not (B).** `new_application` exists in
`TYPE_META` and is written by no code path. Hosts discover applications by visiting their
dashboard. Worth confirming this is intended before `N2` copy implies a notification was sent.

**F4 · (J) carries an ownership guard of the same shape N1 removed** — `if (offer.venue_user_id
&& …)`. Currently unreachable, but it becomes live if custodial publication (`P-C5`) ever lets
an unclaimed venue appear to send an invite.

**F5 · Following an event (I) needs no disclosure.** Following a *listing* is not an act of
contact toward a person, nothing is held, and nobody is waiting for a reply. Disclosing here
would train users to ignore the notice where it matters. Recorded as a deliberate exclusion.

---

## 3 · The decision this audit forces

Rows E and F are actions the specification says should exist **with disclosure**, and which the
app currently **hides**. Three coherent positions:

**Option 1 — Disclose only where the gap is live (A, B, C, D).**
Leave E/F hidden. Smallest, safest, ships now. Fully satisfies `N2` for every interaction a user
can actually perform. Leaves the app diverging from §3's per-workflow table, which should then
be recorded as an accepted deviation so a future reader does not "fix" it.

**Option 2 — Disclose the live gap, and additionally unhide E/F with disclosure.**
Matches the spec as written and starts building the held pile that makes `N3` worth having. But
it is a **feature change**: it enables enquiries that today cannot be sent, and it needs the
enquiry write path to work with a NULL `venue_user_id` / `applicant_user_id`, which is
**unverified** and probably blocked — `venue_enquiries` inserts are already RLS-constrained
(**S4**), and `ProfileScreen.jsx:282` states the flow assumes a claimed venue row.

**Option 3 — Option 1 now, Option 2 as its own milestone.**
Disclosure lands where it is needed today; enabling contact toward unclaimed profiles gets the
schema and RLS work it actually requires, rather than riding in on a copy change.

**Recommendation: Option 3.** `N2` is a disclosure milestone, and E/F are not a disclosure
problem — they are a capability problem wearing disclosure's clothes. Bundling them would mean
shipping an enquiry path whose write may fail under RLS, and the failure mode is the one this
whole phase exists to prevent: a user told their message will be held, when in fact it was
rejected.

---

## 4 · Proposed disclosure surfaces (for implementation, once §3 is settled)

Per the owner's constraints — concise, confidence-inspiring, not technical; no internal
concepts ("held", queue, database); part of normal UX, not a warning dialog; claimed flows
untouched.

| Interaction | Surface | Draft copy |
|---|---|---|
| **A · Follow** | Inline line beneath the Follow button, appearing only when unclaimed | *"They haven't joined YesPleez yet — we'll let them know you're following when they do."* |
| **B · Apply** | Inline note inside the apply panel, above the send button | *"This event's organiser hasn't joined YesPleez yet. Your application will be waiting for them when they do."* |
| **C · Lineup follow** | Same line as A, in the lineup card context | as A |
| **D · Add to slot** | Host-facing helper under the selected performer | *"This performer hasn't joined YesPleez yet, so they won't be notified. You can still add them to the lineup."* |

Notes on the copy: it names the *person's* status, never the system's state; it says what will
happen rather than what will not; and it avoids "held", "queued", "pending" and "unclaimed" as
user-facing words. `UnclaimedBadge` already carries the display-time label (`P-C2`), so these
lines are the **action-time** counterpart and should not repeat the badge.

**Reuse, do not invent.** `isProfileUnclaimed()` is the single predicate (`profileClaim.js`) and
must be passed a canonical `profiles` row — several render paths build synthetic objects whose
`user_id` is `lineup_members.artist_id`, a different column, which returns a confidently wrong
answer. Rows C and D are exactly those paths.

---

## 5 · Verification plan

1. `npm test` — extend the reader/policy contract tests with a disclosure contract: every site
   that can act on an unclaimed target renders the disclosure. Static, like the `N4` policy test.
2. Drive each surface at `localhost:5173` against a real unclaimed profile (Studio has minted
   Farfetchd, Wyldcard, Phoenix) and confirm the line appears — and, more importantly, that it
   does **not** appear on a claimed profile.
3. Confirm no claimed-profile flow changed: A/B/C/D must be byte-identical when the target is
   claimed.
