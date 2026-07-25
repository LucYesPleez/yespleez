# Phone Number Discovery — UX Design v1.0
**2026-07-26 · Design complete, nothing built · Companion mockups: `phone-discovery-mockups-2026-07.html`**

The complete user experience for finding people on YesPleez Messenger by phone number: first
discovery through ongoing privacy management. Written for direct implementation.

---

## 0 · The one-sentence privacy rule

> **Your number lets friends find you. Nobody ever sees it.**

Every screen in this design is an elaboration of that sentence. If a piece of copy, a layout, or
an API can't be derived from it, it doesn't ship.

### The three concepts, kept separate

| Concept | What it is | Who controls it | Default |
|---|---|---|---|
| **Verification** | Your number proves the account is real (SMS OTP at signup) | Required | — |
| **Discoverability** | Whether *others* can find *you* by your number | You, per-account | Set by the first-run prompt |
| **Contact sync** | Whether *you* upload scrambled codes to find *them* | You, revocable, deletable | Off until asked for |

These never collapse into one switch. Verifying does not make you discoverable. Being
discoverable does not sync your contacts. Syncing your contacts does not change who can find
you. Every settings screen restates the boundary it sits inside.

### The privacy architecture (engineering contract the copy depends on)

Two mechanisms, two threats — do not merge them:

1. **Interactive lookup** (search-by-number, contact matching): **k-anonymity hash prefixes.**
   The client SHA-256s the E.164 number, sends only a short prefix (~16–20 bits), receives the
   bucket of registered full hashes + opaque user refs, and matches **locally**. The server
   never learns which number was searched, and bucket rate-limiting defeats enumeration.
2. **Stored contact codes** (needed for "People in my contacts" and Recently Joined):
   **HMAC-SHA-256 with a server-held pepper.** A database leak alone reveals nothing without
   the key, which answers the "hashes are trivially brute-forceable over a 10¹⁰ space"
   objection for data at rest. Deletable on demand; deletion removes the rows *and* every
   match edge derived from them.

The user-facing word for all of this is **"scrambled codes"** — one term, used everywhere,
never "hashes" in UI copy. The copy below is truthful under this architecture and remains
truthful if the owner later chooses naive full-hash upload (it would just be *less* true than
it could be — flag before downgrading).

**Recorded tension (T1):** "People in my contacts" cannot be evaluated with prefixes alone —
it requires the stored peppered codes. A user who picks that option without sync on is
undiscoverable by everyone; the UI must surface the dependency (§7, §9.4) rather than let the
setting silently mean "Nobody".

---

## 1 · The complete user journey

```
  SIGNUP                    FIRST ENTRY               INTENT                    ONGOING
┌───────────┐  once  ┌──────────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
│ Verify    │──────▶ │ Discoverability      │  │ Find People      │  │ Settings → Privacy   │
│ number    │        │ prompt (one card,    │  │  · search number │  │  · Phone Number      │
│ (SMS OTP) │        │ one time, over the   │  │  · contacts ──▶ primer ──▶ system picker /  │
└───────────┘        │ inbox)               │  │  · invite link   │  │    OS dialog         │
                     └──────────────────────┘  │  · recently joined │  · Contacts (sync,   │
                                               └──────────────────┘  │    delete codes)     │
                                                                     └──────────────────────┘
```

**The progressive-disclosure spine.** Each stage reveals exactly as much privacy detail as the
decision in front of the user requires — never more, never earlier:

| Stage | What the user decides | How much we explain |
|---|---|---|
| First entry | "Can friends find me?" | One sentence + the never-shown guarantee |
| Find People | (nothing — browsing) | Section labels only |
| Contacts primer | "Do I hand over codes?" | Three concrete facts + the undo |
| Settings | Fine-grained control | Everything, including counts and timestamps |

**The two hard rules of the journey:**

- **Permissions are requested at the moment of intent, never on entry.** First entry to
  Messenger asks nothing of the OS. The contacts dialog can only ever appear after the user
  taps *Find friends from contacts* and then *Continue* on the primer. Nobody is ever asked
  for their address book by a screen they didn't navigate to.
- **"Not now" is an answer, not a snooze.** Declining the prompt or the primer is recorded and
  never re-prompted. Every capability remains reachable as a quiet inline card on the Find
  People screen and in Settings — the user comes back to us; we do not go back to them.

---

## 2 · Screen 1 — First-time discoverability prompt

**When:** the first time this account enters the Messages tab (server-side flag
`discovery_prompted_at`, not localStorage — it must survive devices). Shown *after* the inbox
paints, 400 ms later, so it reads as a card over a working app, never as a gate in front of it.

**Form:** app-scoped modal card (`.yp-modal` / `.yp-modal-card`, existing) — a card, not a
sheet, per the house rule. Backdrop blurs the inbox; the bottom nav stays visible and
undimmed below `--yp-nav-height`, as always.

### Layout (top to bottom)

| Element | Spec |
|---|---|
| Illustration | 96 px tall. **The Signal Flare:** the Hand mark at centre, two thin pink→cyan gradient rings pulsing outward, three small avatar dots that *land* on the rings (ypReactionLand-derived, 24 px drop, staggered 120 ms). Pulses run 3× then come to rest — everything in YesPleez comes to rest. |
| Header | Bebas Neue 26 px, `letter-spacing: 1.5px` — `YOUR SCENE IS ALREADY HERE` |
| Body | DM Sans 14.5 px `--text`, max 3 lines |
| Primary button | Full-width gradient pill (the `yp-ctl-send` treatment: `linear-gradient(135deg, #00E5FF, #BF5FFF)`, dark text) — Bebas 15 px |
| Secondary | Full-width ghost (transparent, `1px rgba(255,255,255,.16)` border) |
| Micro-line | 11.5 px `--muted`, centred |

### Copy

> **YOUR SCENE IS ALREADY HERE**
>
> Let friends who already have your number find you on YesPleez.
> Your number itself is never shown to anyone — not to friends, not on your
> profile, not ever.
>
> **[ LET FRIENDS FIND ME ]**
> [ Not now ]
>
> Change anytime · Settings → Privacy → Phone Number

### Behaviour

- **Let friends find me** → `discoverable = everyone`. Card dismisses with a 150 ms fade; a
  toast is *not* shown (the button was the confirmation).
- **Not now** → `discoverable = nobody`. Same dismissal, zero guilt copy, never re-prompted.
  The Find People screen retains a one-line inline card (§4) for re-enabling.
- Granularity (the three-way choice) is deliberately *not* offered here — a first-run card
  carries one decision. "People in my contacts" lives in Settings where its sync dependency
  can be explained.
- Backdrop tap and Escape = *Not now*. A dismissal is a decline; treating it as "ask me again
  later" is how apps become naggy.

**Visual hierarchy rationale:** the guarantee ("never shown to anyone") sits inside the body,
not in a footnote — it *is* the pitch. The primary button says what the user gets ("friends
find me"), not what we get ("enable discovery").

---

## 3 · Screen 2 — Contacts permission explanation (the primer)

**When:** every path into contact sync funnels through this card — the Find People section
button, the Settings toggle, the "People in my contacts" dependency prompt. It appears
*before* any system UI, always.

**Form:** same modal card pattern. Three icon rows — each one concrete fact, no
paragraphs of policy.

### Copy

> **FIND FRIENDS FROM YOUR CONTACTS**
>
> 🔒 **Scrambled on your phone**
> Your contacts are turned into unreadable codes before anything leaves your device.
>
> ⛔ **Codes only — nothing else**
> No names, no emails, no numbers. YesPleez never sees your address book.
>
> 🗑 **Yours to undo**
> Delete the uploaded codes any time in Settings → Privacy → Contacts.
>
> If you'd rather not, you can still search for anyone by their exact number.
>
> **[ CONTINUE ]**
> [ Not now ]

### Behaviour

- **Continue** → the platform's contact surface (OS permission dialog on native; the system
  contact picker on Android PWA — see §12). Our button says **Continue**, never "Allow" —
  accept-language belongs to the OS dialog alone, so the user never feels the real decision
  was smuggled past them.
- **Not now** → back to where they came from, unchanged. The "what if I decline" answer is
  already on the card (the search-by-number line), which is what makes declining feel safe —
  and safe-to-decline is what makes people say yes.
- The three headlines are the whole story at a glance; the sub-lines are for the people who
  read. Both audiences leave correctly informed.

---

## 4 · Screen 3 — Find People

**Route:** `/messages/find`. **Entry points:** a `+`/person-add icon in the Inbox header row,
and the "Find friends" line inside the empty inbox state. GlobalHeader (Back · logo · Share ·
Info · bell) stays; bottom nav stays (Messages tab active).

### Anatomy (top to bottom)

```
  FIND PEOPLE                          ← Bebas 24px page title
┌─────────────────────────────────┐
│ +61 ▾ │ Search by phone number  │   ← glass capsule (composer material)
└─────────────────────────────────┘
  FROM YOUR CONTACTS                   ← Bebas 13px section label, --muted
  [ …state-dependent block… ]
  INVITE                               ← only these three section labels, ever
  ┌ Know someone who'd love it here? ┐
  │ Send them your invite link.      │
  │            [ SEND YOUR LINK ]    │
  └──────────────────────────────────┘
  RECENTLY JOINED
  [ …rows, or absent entirely… ]
```

- **Search capsule** reuses the composer's glass material (`.yp-composer` treatment) — the
  one YesPleez surface that already means "type here". Country chip (`+61` default, Bebas,
  GlowPill outline) opens an app-scoped card with a searchable country list — a **picker,
  never free-typed** (house rule: constrained input over manual text). The field itself is
  `inputmode="tel"`, digits/space/`+` only, live-formatted per selected country
  (`0412 345 678`), pasted international numbers re-parse the country chip automatically.
- **Search is explicit, not incremental.** The SEARCH pill enables only when the number
  parses valid (E.164); each search is one exact lookup. No as-you-type lookups — that's an
  enumeration surface and a privacy promise broken by keystroke.
- **FROM YOUR CONTACTS** block renders exactly one of the states in the table below.
- **INVITE** is always present — it is the one path with zero dependencies.
- **RECENTLY JOINED** renders only when sync is on *and* it has rows; there is no "nothing
  recent" placeholder — an empty ambient section is noise. Rows: people whose codes are among
  yours, whose discoverability admits you, who joined in the last 30 days. Meta line:
  `Joined this week · in your contacts`.

### FROM YOUR CONTACTS — state table

| State | Block content |
|---|---|
| **Never connected** | Card: person-plus glyph · "See which of your contacts are already here. Scrambled codes only — never names or numbers." · `[ FIND FRIENDS FROM CONTACTS ]` (gradient pill) → primer (§3) |
| **Syncing** | 3 × `Skeleton` rows (existing component) + status line `Matching scrambled codes…` with the three-bar EQ mark rising (it comes to rest). `aria-live="polite"`. |
| **Synced, matches** | Match rows (§5), most recent joiners first. Landing animation on first reveal (§10). Footer line: `Synced today · Settings → Privacy → Contacts` |
| **Synced, zero matches** | "None of your contacts are here yet. Someone has to be first — bring them in." · `[ SEND YOUR LINK ]` (promotes the Invite section's action) |
| **Permission denied** | §9.1 card |
| **Sync turned off** | Quiet single line: `Contact sync is off · Turn on` — a text row, not a card; the user chose this state and we don't shout at choices. |
| **Offline** | §11.5 |
| **Discoverability off** (`nobody`) | An additional one-line banner *above* the section, dismissible per-visit: `Friends can't find you right now · Change` → Settings. Informational, amber-free, never blocking. |

### Loading & search states

- Search in flight: the SEARCH pill swaps to a 3-bar EQ mark; field locks. Sub-400 ms
  responses skip the indicator entirely (no flash-of-spinner).
- Rate-limited (the k-anonymity bucket limiter surfacing honestly):
  `Too many searches. Give it a minute.` — plain, no error styling beyond `--muted`.

---

## 5 · Screen 4 — Search results & match rows

One row component (`PersonRow`) serves search results, contact matches, and Recently Joined.

### Row anatomy

```
┌────────────────────────────────────────────────┐
│ (◉) 44px   Jess Deluxe              [ MESSAGE ]│
│ avatar     DJ / PROD.  ← GlowPill              │
└────────────────────────────────────────────────┘
```

| Element | Spec |
|---|---|
| Avatar | 44 px circle; fallback = initial on `--card2` with a 1 px pink→cyan gradient ring (the `yp-hand-ring` technique) |
| Display name | DM Sans 15 px / 600, `--text`, single line, ellipsis |
| Second line | The **primary profile** as a GlowPill (`DJ / PROD.`, `VENUE`, a festival name…). Messenger-only members get the caption `On YesPleez` in `--muted` 12 px — never an empty slot. Contact matches append `· in your contacts` (client-side knowledge only; matching happened on-device). |
| Action | `MESSAGE` — Bebas 12 px gradient pill, 44 px min tap target. Opens the conversation through the existing messaging surface. |

**What a row may never contain:** a phone number, any fragment of one, or the device
contact-book name as the primary label. The member's chosen display identity is canonical —
their phonebook alias is not ours to surface. `aria-label` on the action:
`Message Jess Deluxe`.

**Search-by-number result:** the typed number stays in the search field (theirs — they typed
it) but is never echoed in the result card. One match maximum, by construction.

### No match — the indistinguishability rule

Not-registered and registered-but-hidden **must produce byte-identical UI**, or the product
leaks membership through its own compassion:

> No match for that number. They might not be on YesPleez yet —
> or they've chosen not to be found.
>
> **[ INVITE THEM ]**

Same response timing, same copy, same CTA in both cases. `INVITE THEM` → native share sheet
(§6) — and note the share message contains the *link*, not the searched number.

---

## 6 · Screen 5 — Invite flow

**Architectural decision (standing recommendation, restated):** YesPleez never sends SMS to
non-members. The invite is a **share link the user sends themself** through the native share
sheet — zero SMS cost, no Spam Act 2003 exposure, and a message from a mate converts where a
message from a platform gets reported.

### Flow

1. Any `INVITE` / `SEND YOUR LINK` control → `navigator.share` with:
   > I'm on YesPleez — come find your scene. `yespleez.com/i/k7f3q`
2. The link is a **personal invite code**: when someone joins through it, the pair are
   auto-suggested to each other (bypassing discoverability *for this one deliberate,
   reciprocal act* — sending someone your link is consent to be found by them), and the
   inviter gets a bell notification: `Someone joined from your invite`.
3. Share promise resolves → toast `Invite shared`. Dismissed/cancelled → nothing. We never
   claim "sent" — we can't see whether it was, and the design doesn't lie in small ways.
4. `navigator.share` unavailable (desktop) → app-scoped card: the link, the message, and
   `[ COPY LINK ]` → toast `Link copied`.

### Contacts not on YesPleez

After a sync, unmatched contacts *can* be listed under INVITE — but only because matching is
**local**: the unmatched set never left the device, so their names may be rendered
client-side. Rows: contact display name (12 px `--muted` caption `Not on YesPleez yet`) +
ghost `INVITE` pill. Cap the list at 5 with `SHOW ALL` — an invite section that scrolls
forever reads as a growth hack, and YesPleez is not that app. Sorted by contact-list
frequency-of-interaction where the platform exposes it; alphabetical otherwise.

**Never**: bulk "invite all", pre-ticked checkboxes, or any control that fans one tap into
many messages.

---

## 7 · Screen 6 — Settings → Privacy → Phone Number

Standard settings list page (GlobalHeader + back). New route: `/settings/privacy/phone`.

### Layout

```
  PHONE NUMBER                        ← Bebas page title
┌──────────────────────────────────┐
│ Your number      ••• ••• 789  👁 │  ← masked; tap the eye to reveal 5s
│ Verified · never shown to anyone │
└──────────────────────────────────┘

  FIND ME BY PHONE NUMBER            ← section label
┌──────────────────────────────────┐
│ ◉ Everyone                       │
│   Anyone who has your number     │
│   can find you here. Best for    │
│   meeting the wider scene.       │
├──────────────────────────────────┤
│ ○ People in my contacts          │
│   Only people whose numbers are  │
│   saved in your phone can find   │
│   you. Needs contact sync on, so │
│   we know who they are.          │
├──────────────────────────────────┤
│ ○ Nobody                         │
│   No one can find you by number. │
│   You can still message and be   │
│   messaged through profiles and  │
│   shared links.                  │
└──────────────────────────────────┘
  Your number is only ever used to connect
  you with people — it is never displayed,
  searchable as text, or shared.
```

### Behaviour

- **Own number masked by default** (`••• ••• 789`) — the user knows their number; screenshots
  and shoulder-surfers don't need it. Eye icon reveals for 5 s. Screen-reader label:
  `Your verified number, ending 789`.
- Radio rows: whole row tappable, `role="radiogroup"`, selection applies **immediately** +
  toast `Privacy updated.` No save button — a privacy switch that waits for "Save" is a
  privacy switch that sometimes silently didn't happen.
- Selected row: GlowPill-on treatment (cyan-tinted border, `glow-chip.on` gradient wash).
- **Everyone → Nobody** while contact-derived matches exist: applies instantly (no
  confirmation friction on the *more* private direction, ever). Existing conversations are
  untouched — the copy for Nobody already says so.
- **→ People in my contacts** with sync off: the row selects, then an inline dependency card
  unfolds beneath it (`ypAttachIn` motion):
  > This needs contact sync, so YesPleez knows who your contacts are.
  > **[ TURN ON CONTACT SYNC ]** · [ Keep, but it works as Nobody for now ]
  Honest about T1: the setting without sync *is* Nobody, and we say so rather than let a
  privacy setting quietly mean something else.

---

## 8 · Screen 7 — Settings → Privacy → Contacts

Route: `/settings/privacy/contacts`.

### Layout

```
  CONTACTS
┌──────────────────────────────────┐
│ Sync contacts              [ON ] │
│ Finds friends as they join, by   │
│ scrambled code only.             │
├──────────────────────────────────┤
│ Last synced                      │
│ Today, 2:14 pm · 212 codes       │
├──────────────────────────────────┤
│ Contacts access                  │
│ Allowed ✓                        │  ← or: Denied / Not requested / Pick again (PWA)
├──────────────────────────────────┤
│ Sync now                       ↻ │
└──────────────────────────────────┘

┌──────────────────────────────────┐
│ 🗑 Delete uploaded contact codes  │  ← danger row (--yp-ctl-danger palette)
│ Removes every scrambled code     │
│ from YesPleez servers.           │
└──────────────────────────────────┘
```

### Behaviour

- **"212 codes"**, never "212 contacts" — the label is the privacy model, repeated where it
  matters most.
- **Toggle OFF** → stops all future syncs, then a follow-up card (not a blocker):
  > Sync is off. The 212 codes already uploaded still power your matches.
  > **[ DELETE THEM TOO ]** · [ Keep them ]
  Respecting the difference between "stop" and "erase" — and offering the erase unprompted is
  what a trustworthy app does.
- **Delete uploaded contact codes** → confirm card listing real consequences:
  > This removes every scrambled code from our servers.
  > · Contact matches disappear from Find People
  > · "Recently joined" goes quiet
  > · If "People in my contacts" is on, nobody can find you until you sync again
  > **[ DELETE CODES ]** (danger) · [ Cancel ]
  On confirm: server delete → toast `Contact codes deleted.` → `Last synced` becomes `—`,
  match rows collapse (150 ms fade; existing conversations are conversations and stay).
  If discoverability was *People in my contacts*, a one-line banner appears on this screen:
  `Find me by number is effectively Nobody until you sync again · Review`.
- **Permission status** row states: `Allowed ✓` / `Denied — fix in phone settings ›` (§9.3) /
  `Not requested` / on Android PWA: `Chosen per sync ›` (§12).
- **Reconnect contacts** appears in place of *Sync now* whenever access is broken; it routes
  to §9.3.
- Auto-resync policy: while ON with a persistent grant, sync on app-open at most once per
  24 h. On picker-based platforms, "sync" always means a fresh user gesture (§12).

---

## 9 · Permission denied & change flows — every edge

The shared posture: **a denial is a setting, not an error.** Nothing red, nothing modal,
nothing repeated. Every denied state answers three questions — *what happened, what still
works, how to change it* — and the "what still works" is always search + invite.

### 9.1 · User denies at the OS dialog
Return to Find People; the contacts block becomes:
> **CONTACTS ARE OFF**
> No problem — you can still search anyone by number, or send your link.
> [ Allow in settings › ]        ← native; on Android PWA: [ CHOOSE CONTACTS ] (re-pick is free)

Never auto-re-prompted. The analytics event records `contacts_primer_choice: os_denied`.

### 9.2 · User previously denied, taps "Find friends from contacts" again
The primer renders with its footer swapped for a platform-aware line — on native (where the
OS will silently no-op a second request):
> You previously said no in your phone's settings, so your phone won't ask again.
> To turn it on: **Settings → Apps → YesPleez → Contacts → Allow**, then come back.
> **[ OPEN PHONE SETTINGS ]** (native deep link) · [ Not now ]

On Android PWA the picker is always re-askable — the primer simply runs again, unchanged.

### 9.3 · Permission revoked later in device settings
Detected on the next sync attempt (never by polling). Sync stops silently; no toast, no
badge-storm. The state surfaces passively in two places: the Contacts settings row flips to
`Denied — fix in phone settings ›`, and the Find People block shows §9.1. If
*People in my contacts* is active, the §8 amber one-liner appears — that one earns a voice
because it changed who can find the user.

### 9.4 · Discoverability changed later
- Any → more private: instant, toast only.
- → *People in my contacts* without sync: dependency card (§7). Choosing "keep anyway" stores
  the preference but shows the effectively-Nobody line until sync exists.
- *Nobody* → *Everyone*: instant. No celebration, no "welcome back" — it's a switch, not a
  conversion event.

### 9.5 · Sync turned off · 9.6 · Codes deleted
Both fully specified in §8. The invariant across every flow in this section: **existing
conversations never change.** Discovery settings govern *finding*, never *reaching* — a
consistent answer that makes every one of these switches safe to flip, which is what makes
people willing to flip them.

---

## 10 · Success states

One toast system: app-scoped, docked above `--yp-safe-bottom` (the nav is sacred — nothing
covers it, including good news), 2.4 s, one at a time, `aria-live="polite"`, entering with
`ypAttachIn` (rises 6 px, 160 ms) and leaving by fade.

| Moment | Treatment |
|---|---|
| **Contacts synced, matches found** | Inline banner in the contacts section — Bebas: `SYNCED — 5 FRIENDS FOUND`, then match rows **land** one by one: the ypReactionLand fall shortened to 24 px, 40 ms stagger. Reuse of the reaction physics is deliberate: in YesPleez, things that matter *arrive*, they don't appear. |
| **Synced, nobody found** | Inline, warm, zero failure-styling: `Synced. None of your contacts are here yet — someone has to be first. [ SEND YOUR LINK ]` |
| **Invite shared** | Toast: `Invite shared` (only on a resolved share promise — see §6.3) |
| **Privacy updated** | Toast: `Privacy updated.` |
| **Codes deleted** | Toast: `Contact codes deleted.` + the §8 collapse choreography |
| **Someone joins from your invite** | Bell notification (allowed: this is not conversation activity): `Someone joined from your invite · say g'day` → opens their profile |
| **Contacts join later (ambient)** | Batched, at most weekly, bell: `2 people from your contacts joined YesPleez` → Find People. Never per-person pushes — ambient joy, not engagement-bait. |

---

## 11 · Empty states

House shape for every empty state: small Hand-motif glyph (40 px, `--muted`, never the loud
brand gradient — empties are quiet), Bebas one-liner, one DM Sans sentence, at most one CTA.

| State | Copy |
|---|---|
| **11.1 No contacts on device** | `NOT MUCH IN THERE` — "Your phone gave us nothing to match. Search by number, or send your link instead." · [ SEND YOUR LINK ] |
| **11.2 Nobody on YesPleez** | `FIRST OF YOUR CREW` — "None of your contacts are here yet. Someone has to be first — bring them in." · [ SEND YOUR LINK ] |
| **11.3 No search results** | §5's indistinguishable no-match card (it is the empty state) |
| **11.4 No permission** | §9.1's card (never a full-screen empty for a revocable choice) |
| **11.5 Offline** | `OFF THE GRID` — "Discovery needs a connection. Everything here will be waiting when you're back in range." · no CTA; previously-loaded matches stay visible at 55% opacity with actions disabled (stale beats blank). The phrase is chosen for the audience — half this scene's life happens where there is no signal, and the app should sound like it knows that. |

---

## 12 · Platform reality (PWA today, native later)

YesPleez ships today as an installable PWA. This design is written for the full native-grade
experience and **degrades by capability, not by rewrite** — same screens, same copy, three
platform profiles:

| Capability | Android (Chrome PWA) | iOS (PWA) | Future native wrapper |
|---|---|---|---|
| Contacts access | **Contact Picker API** — system multi-select sheet, per-gesture, no persistent grant | **None** | Full permission + background resync |
| "OS dialog" in this doc | The picker itself (primer still always precedes it) | — | Real permission dialog |
| Re-ask after denial | Free — cancel just means "not this time" | — | OS-gated (§9.2) |
| Sync refresh | User re-picks (button: `PICK AGAIN TO REFRESH`) | — | Automatic ≤ daily |
| Search by number | ✓ | ✓ | ✓ |
| Invite via share sheet | ✓ | ✓ (share sheet is excellent on iOS) | ✓ |
| Discoverability settings | ✓ | ✓ | ✓ |

**iOS PWA:** the FROM YOUR CONTACTS section renders one honest card —
> Contact matching arrives with the YesPleez app. For now, search by number or send your
> link — it does the same job, one friend at a time.

**A quiet gift of the picker model:** on Android PWA, "YesPleez never sees your address book"
is not just policy but *mechanism* — the app physically receives only what the user ticked.
The primer copy is identical everywhere; it simply becomes more literally true here.

---

## 13 · Accessibility

- **Targets:** every actionable element ≥ 44 px hit area (pills may *render* smaller; the
  target doesn't — the `.yp-voice-play::before` inset technique is the house pattern).
- **Semantics:** discoverability = `role="radiogroup"`; sync = `role="switch"`; toasts and
  sync status = `aria-live="polite"`; the primer and prompt cards = `role="dialog"` with
  `aria-modal`, focus trapped, Escape = secondary action, focus returned to the invoking
  control on close.
- **Labels:** `Message Jess Deluxe`, `Invite Sam Torres`, `Your verified number, ending 789`,
  `Reveal your number for five seconds`.
- **Reduced motion:** the house rule verbatim — motion is decoration; state is not. Landings
  and pulses become instant appearances; the EQ progress mark still *arrives* at its state.
  Nothing conveys meaning by animation alone.
- **Contrast:** body copy always `--text` (#e8e8f0, 14.9:1 on `--dark`). `--muted` (#7070a0,
  ~4.1:1) is confined to captions ≥ 12 px and never carries sole meaning. The gradient
  primary button uses near-black text (#0a0a0f) on its lightest stop — verified ≥ 7:1.
- **Masked number:** the mask glyphs are presentational; the accessible name carries the
  ending digits, so a screen reader never announces "bullet bullet bullet".

---

## 14 · Engineering handoff

### Component & route map

| New | Builds on |
|---|---|
| `FindPeopleScreen` (`/messages/find`) | GlobalHeader, Skeleton, GlowPill, composer glass tokens |
| `PersonRow` | ProfileCard avatar conventions |
| `DiscoveryPromptCard`, `ContactsPrimerCard` | `.yp-modal` / `.yp-modal-card` |
| `CountryPickerCard` | `.yp-modal-card` + list |
| `SettingsPrivacyPhone`, `SettingsPrivacyContacts` (`/settings/privacy/*`) | first Settings-surface screens; establish the settings list-row idiom here |
| `useContactSync` (state machine) | `idle → priming → picking → hashing → uploading → matching → done(count) / denied / offline` |
| `InviteShare` | existing ShareSheet / `useShareTarget` resource-share architecture — invite link is a share *resource*, not a screen-specific fork (house rule) |

### Analytics (per the ratified privacy rule — the API shape carries no parameter a raw number could travel through)

`discovery_prompt_shown/choice{on|not_now}` · `contacts_primer_shown/choice{continue|not_now|os_denied}` ·
`contacts_sync{codes_count,matched_count}` · `find_search{outcome: match|none}` ·
`invite_share{surface}` · `privacy_change{setting,value}` · `invite_join{}`.

### Dependencies & open questions

1. **SMS provider** (owner decision, pending) — blocks verification, which blocks everything
   here. Verification-screen UX is deliberately out of this document's scope.
2. **Privacy model ratification** (owner decision, pending — previously deferred): this
   design *assumes and recommends* §0's two-mechanism architecture. The screens survive a
   downgrade to naive full-hash upload, but the copy's strength and T1's resolution come from
   the recommended model. Re-raise before build, per standing note.
3. **Q1:** does messaging a discovered stranger (discoverable = Everyone) open a plain
   conversation or a message-request state? This design assumes plain (discoverability *is*
   the consent); revisit when message-requests exist as a concept.
4. **Q2:** invite-code join attribution needs `yespleez.com` link handling — currently
   deployment is parked and the domain is email-only. The link format `/i/<code>` is reserved
   now so printed/shared links never rot.

### Non-negotiables carried from the platform constitution

Bottom nav sacred (every overlay stops at `--yp-safe-bottom`) · app-scoped dialogs, cards not
sheets, column-width on desktop · all motion from `--yp-ease` + the three speeds, everything
comes to rest, reduced-motion honoured · pickers over free text · no raw number in any event,
log, or URL · **and phone numbers appear on exactly one screen in the entire product: your
own, masked, on `/settings/privacy/phone`.**
