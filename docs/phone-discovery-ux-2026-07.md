# Phone Number Discovery — UX Design v1.2
**2026-07-26 · 🟢 CLEARED TO BUILD — no blockers · Companion mockups: `phone-discovery-mockups-2026-07.html`**

> **v1.2 — privacy model RATIFIED (owner, 2026-07-26).** k-anonymity hash prefixes for
> interactive lookup + HMAC-with-pepper for stored contact codes. Naive full-hash bulk upload is
> rejected and closed. Both owner decisions are now settled and this milestone has no remaining
> blockers.

> **v1.1 — NO SMS (owner decision, 2026-07-26).** The phone number is a pure identifier running
> on the existing data system; YesPleez sends no text messages for any purpose. There is no
> verification step and no telephony cost. Verification is replaced by the five mitigations in
> §0, governed by one rule: **a number claim confers nothing — it is a way to be found, never a
> way to be trusted.** The invitation half of the design was already SMS-free and is unchanged.

The complete user experience for finding people on YesPleez Messenger by phone number: first
discovery through ongoing privacy management. Written for direct implementation.

---

## Build status — 2026-07-26

**Working end to end:** the data layer (P1/P1a/P1b, applied) and a functional settings panel
reached from Messages → FIND ME. You can add, change and remove your number, see which one is
registered, and set who can find you. Owner confirmed it works.

**⚠ WHAT SHIPPED IS PLUMBING, NOT THE DESIGN.** The panel proves the architecture; it is not
what §2/§4/§7 describe. Deferred deliberately, to be done as ONE polish pass once the remaining
screens exist — polishing now means polishing twice:

| Designed (§) | Built today | Why deferred |
|---|---|---|
| Settings → Privacy → Phone Number, its own screen (§7) | a panel inside Messages behind FIND ME | the app has no settings section; NP1 says put it where people come for it |
| First-run prompt card + Signal Flare illustration (§2) | none — you open the panel yourself | needs a server-side "asked once" flag; no user-settings table exists yet |
| Searchable country card, GlowPill chip (§4) | native `<select>` | still a picker, so the house rule holds; just plain |
| Toast above the nav (§10) | an inline status line | no toast system exists in the app yet |
| Find People screen — search, invite, recently joined (§4/§5/§6) | not built | next functional slice |
| Contact sync + corroboration line (§3/§5) | client code written and tested, no UI | needs the contact-code layer |

**Permanently changed, not deferred:** the masked-number reveal eye (§7) is **gone**. The number
is stored as a one-way HMAC, so there is nothing to reveal — `last3` exists only so the panel can
say *which* number is registered. The mockup specifies something impossible.

---

## 0 · The one-sentence privacy rule

> **Your number lets friends find you. Nobody ever sees it.**

Every screen in this design is an elaboration of that sentence. If a piece of copy, a layout, or
an API can't be derived from it, it doesn't ship.

### The three concepts, kept separate

| Concept | What it is | Who controls it | Default |
|---|---|---|---|
| **Your number on file** | A lookup key you add to your account. **Not a credential, not verified, never texted to** | You, optional, removable | Not set |
| **Discoverability** | Whether *others* can find *you* by that key | You, per-account | Set by the first-run prompt |
| **Contact sync** | Whether *you* upload scrambled codes to find *them* | You, revocable, deletable | Off until asked for |

These never collapse into one switch. Adding your number does not make you discoverable. Being
discoverable does not sync your contacts. Syncing your contacts does not change who can find
you. Every settings screen restates the boundary it sits inside.

### ⛔ NO SMS. ANYWHERE. EVER. (owner decision, 2026-07-26)

**YesPleez sends no text messages** — not for verification, not for invitations, not for
recovery. The phone number is purely an identifier and runs entirely on the data system the
rest of the app already uses. No telephony provider, no per-message cost, no carrier
relationship, no Spam Act 2003 surface.

This has one consequence that must be designed around rather than wished away, and the rest of
this section is that design.

### The number is a lookup key, not a credential

**Identity is already solved upstream.** An account is authenticated by the existing Supabase
auth before it ever reaches this feature. The phone number is not being asked to prove who
someone is — the session already knows. It is only a *key other people can look you up by*.

So the threat is not impersonation of an account. It is **squatting a key**: someone entering a
number they do not own, so that the owner's friends find *them* instead.

| Sounds like a risk | Actually |
|---|---|
| "Anyone can claim any account" | No — accounts are auth-protected and untouched by this |
| "Anyone can claim any number" | **Yes.** This is the real exposure, and it is bounded below |
| "Numbers could leak" | No — never displayed, never in a URL, never in an event (§0 architecture unchanged) |

### The five mitigations — all free, all on the existing data system

1. **Uniqueness, first claim wins.** One account per number, enforced by a unique constraint on
   the stored key. A squatter must know the number *and* get there first.
2. **A claim is not instantly findable.** A newly added number becomes discoverable after
   **24 hours**. Costs an attacker patience and removes every drive-by; costs a real user
   nothing they will notice, because they added their number to be found *later*.
3. **Changes are rate-limited and logged.** One number per account, changeable at most once per
   **30 days**, every change written to an audit row. This is what stops the real damage —
   cycling a single account through many numbers to harvest the contact graph.
4. **⭐ Phonebook-name corroboration, client-side.** The strongest signal available, and it is
   free *and* private. After a contact sync the device already knows it saved that number as
   "Bob"; the matched account says it is "Mallory X". The app shows both — `Mallory X · saved
   as Bob` — and the mismatch is visible to the only person who can judge it. The server never
   learns either name. A squatter cannot defeat this without also knowing what every victim's
   friends nicknamed them.
5. **Dispute and reclaim through Studio.** The ops platform already has a Claims Queue with
   `approve/reject_profile_claim()` and a reviewer team — a contested number is the same shape
   of problem and routes to the same place. A reclaimed number is released from the squatter's
   account and the squatter cannot re-add it.

### The rule that keeps this safe

> **A number claim confers nothing. It is a way to be found, never a way to be trusted.**

Concretely, and permanently: no "verified" badge anywhere in the product; no account recovery
through a phone number; no elevated permissions, no auto-trust, no bypass of any existing
consent; a discovered account is exactly as trusted as one found any other way. The moment a
number grants something, the lack of verification becomes a hole. It never grants anything, so
it never becomes one.

**T2 (recorded tension):** this is a deliberate trade — zero cost for a soft key. If YesPleez
later wants the number to *mean* something (recovery, trust signals, payments), verification
becomes non-optional and this section is where that conversation restarts.

### ✅ The privacy architecture — RATIFIED 2026-07-26 (owner)

**This is now the model, not a recommendation.** The owner chose k-anonymity over naive hashed
bulk upload; the alternatives are closed and should not be re-proposed. It is the engineering
contract every piece of copy below depends on — weaken either mechanism and the copy becomes
a lie rather than a simplification.

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
never "hashes" in UI copy.

⚠ **Do not "simplify" either mechanism during implementation.** Sending a full hash instead of
a prefix, or dropping the pepper because "it's already hashed", each look like tidy-ups in a
diff and each silently converts this into the model that was rejected. Neither failure is
visible in any test — the feature works identically. The prefix width and the pepper are
load-bearing; if one has to change, that is a design conversation, not a refactor.

**Recorded tension (T1):** "People in my contacts" cannot be evaluated with prefixes alone —
it requires the stored peppered codes. A user who picks that option without sync on is
undiscoverable by everyone; the UI must surface the dependency (§7, §9.4) rather than let the
setting silently mean "Nobody".

---

## 1 · The complete user journey

```
  ACCOUNT EXISTS            FIRST ENTRY               INTENT                    ONGOING
┌───────────┐  once  ┌──────────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
│ Auth'd    │──────▶ │ Discoverability      │  │ Find People      │  │ Settings → Privacy   │
│ (Supabase)│        │ prompt + inline      │  │  · search number │  │  · Phone Number      │
│ NO SMS    │        │ number entry, one    │  │  · contacts ──▶ primer ──▶ system picker /  │
└───────────┘        │ card, over the inbox │  │  · invite link   │  │    OS dialog         │
                     └──────────────────────┘  │  · recently joined │  · Contacts (sync,   │
                          ↓ 24h cooling        └──────────────────┘  │    delete codes)     │
                       discoverable                                  └──────────────────────┘
```

**Where the number is actually entered.** With no SMS step there is no verification screen, so
the number has to be collected somewhere — and a standalone "add your number" screen for a
feature the user hasn't asked for yet is exactly the friction this design avoids. It goes
**inside the first-run prompt** (§2): the card that explains *why* is the card that takes it.
One screen, one decision, one field. Users who tap "Not now" are never asked for a number at
all, which is the correct outcome — an unused key should not be stored.

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
| **Number field** | The composer-glass capsule (§4's treatment) — country chip + `tel` input. Empty, focused only on tap, never autofocused (a keyboard flying up over a first-run card reads as a demand) |
| Primary button | Full-width gradient pill (the `yp-ctl-send` treatment: `linear-gradient(135deg, #00E5FF, #BF5FFF)`, dark text) — Bebas 15 px. Disabled until the number parses valid |
| Secondary | Full-width ghost (transparent, `1px rgba(255,255,255,.16)` border) |
| Micro-line | 11.5 px `--muted`, centred |

### Copy

> **YOUR SCENE IS ALREADY HERE**
>
> Add your number so friends who already have it can find you.
> It's only ever used to match you — never shown to anyone, never
> texted, and you can remove it whenever you like.
>
> `[ +61 ▾ │ Your mobile number ]`
>
> **[ LET FRIENDS FIND ME ]**
> [ Not now ]
>
> Change anytime · Settings → Privacy → Phone Number

**Why "never texted" is in the body copy.** Every user has been trained by a decade of apps
that handing over a number means SMS — a verification code now and marketing later. Saying we
don't is a genuine differentiator and it costs one clause. It is also simply true, which is
the only reason it is allowed to be there.

### Behaviour

- **Let friends find me** → stores the number as a key, `discoverable = everyone`. Card
  dismisses with a 150 ms fade; a toast is *not* shown (the button was the confirmation).
- **Already taken** (unique constraint rejects) → inline under the field, no dialog:
  `That number is already on an account. If it's yours, get in touch and we'll sort it.`
  → links to Beta Feedback, which routes into the Studio queue where a human resolves it (§0.5).
  Deliberately not "someone stole your number" — the overwhelmingly common cause is a second
  account of the user's own, and the copy shouldn't accuse.
- **Cooling period is silent.** The user is told they're findable; the 24 h delay is an
  anti-squatting measure, not a state they need to track. Surfacing it would invite the
  question "findable *when?*" for a benefit they cannot perceive.
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
  `Joined this week · saved as Lena` — the corroboration line (§5) applies here too, since
  these are contact-derived matches and carry the same squatting risk.

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
| Second line | The **primary profile** as a GlowPill (`DJ / PROD.`, `VENUE`, a festival name…). Messenger-only members get the caption `On YesPleez` in `--muted` 12 px — never an empty slot. Contact matches append `· saved as Bob` — **the name from the user's own phonebook**, rendered client-side, never uploaded (see below). |

### ⭐ The corroboration line — how an unverified key stays safe

Because numbers are unverified (§0), a contact match must show **both identities**: the
account's chosen display name *and* the name the user themself saved that number under.

```
┌────────────────────────────────────────────────┐
│ (◉)  Mallory X                      [ MESSAGE ]│
│      DJ / PROD.  ·  saved as Bob               │   ← mismatch is visible
└────────────────────────────────────────────────┘
```

When they agree (`Jess Deluxe · saved as Jess`) it reads as confirmation and disappears into
the background. When they disagree it is the one thing on the row that looks wrong — to the
only person on earth qualified to judge it, using knowledge only their device has. The server
never learns the phonebook name; matching already happens on-device, so this is free.

Styling: `--muted` 11.5 px, same weight as the rest of the meta line. **Never** red, never a
warning icon, never a modal — the overwhelmingly common case is a nickname mismatch
("saved as Jess Mobile"), and crying wolf on those would train users to ignore the real one.
It informs; it does not adjudicate.

Search-by-number results carry the same line when the number is in the user's contacts.
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

**RATIFIED 2026-07-26** (was a recommendation; the owner's no-SMS decision settles it): YesPleez
never sends SMS to anyone. The invite is a **share link the user sends themself** through the
native share sheet — zero cost, no Spam Act 2003 exposure, and a message from a mate converts
where a message from a platform gets reported. This half of the milestone needed no redesign;
it was already the answer.

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
│ Never shown to anyone · Change   │
│ Remove my number                 │  ← quiet text row, not danger-styled
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
  `Your number, ending 789`. **No "Verified" tick anywhere** — it isn't verified, and a badge
  claiming otherwise would be the single most damaging line in the product (§0's rule).
- **Change** → the same capsule inline, subject to the 30-day rate limit. If blocked:
  `You can change your number again in 12 days.` Plain, no apology, no support link — the
  limit is doing its job.
- **Remove my number** → confirm card: `You won't be findable by number. Your conversations,
  profiles and everything else stay exactly as they are.` On confirm the key is deleted
  outright (not soft-deleted — an identifier nobody can use should not be retained), and the
  number is immediately claimable by whoever legitimately owns it.
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
- **Labels:** `Message Jess Deluxe`, `Invite Sam Torres`, `Your number, ending 789`,
  `Reveal your number for five seconds`. The corroboration line is part of the row's accessible
  name, not a visual-only cue: `Mallory X, DJ / PROD., saved in your contacts as Bob` — a
  screen-reader user must get the mismatch signal too.
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
| `PhoneKeyCapsule` | shared by the first-run card and Settings → Change; country picker + `tel` input + E.164 parse |

### Data layer — what the five mitigations need (all Postgres, no external service)

- `profile_phone_keys`: `profile_id`, `key_hmac` (peppered, **UNIQUE** → mitigation 1),
  `created_at`, `discoverable_from` (= `created_at + 24h` → mitigation 2), `visibility`
  (`everyone` / `contacts` / `nobody`).
- `profile_phone_key_changes`: append-only audit row per add/change/remove; a
  `BEFORE INSERT` trigger enforces the 30-day rate limit (→ mitigation 3) so the rule lives in
  the database and cannot be bypassed by a second client.
- Lookup RPC returns rows only where `now() >= discoverable_from` and visibility admits the
  caller. **Never a table read** — same discipline as the read-receipt aggregate: the gate is
  the function, so there is no policy to get wrong twice.
- The pepper is a Vault secret, exactly like `push_notify_service_key`. ⚠ **It is a manual
  per-environment step, and if it is missing every lookup silently matches nothing** — the same
  trap that bit push notifications. Fail loudly at startup instead.
- Mitigation 4 (phonebook corroboration) needs **no schema at all** — the name never leaves
  the device.
- Mitigation 5 reuses the Studio Claims Queue; contested numbers become a queue item and are
  resolved through a function, never a direct `UPDATE` (house rule).

### Analytics (per the ratified privacy rule — the API shape carries no parameter a raw number could travel through)

`discovery_prompt_shown/choice{on|not_now}` · `contacts_primer_shown/choice{continue|not_now|os_denied}` ·
`contacts_sync{codes_count,matched_count}` · `find_search{outcome: match|none}` ·
`invite_share{surface}` · `privacy_change{setting,value}` · `invite_join{}`.

### Dependencies & open questions

> **🟢 NO BLOCKERS REMAIN. This milestone is cleared to build (2026-07-26).** Both owner
> decisions are closed — see 1 and 2 below. Q1 and Q2 are open *questions*, not gates; each
> has a stated default that is safe to build against.

1. ~~**SMS provider**~~ — **RESOLVED 2026-07-26: there is none, and never will be.** The number
   is a lookup key on the existing data system; no telephony, no verification screen, no cost.
   See §0's no-SMS block and the five mitigations that replace verification.
2. ~~**Privacy model ratification**~~ — **RESOLVED 2026-07-26: k-anonymity, ratified by the
   owner.** §0's two-mechanism architecture is the model: hash prefixes for interactive lookup,
   HMAC-with-pepper for stored codes. Naive full-hash bulk upload is **rejected and closed** —
   do not re-propose it, and do not let it back in through an implementation "simplification"
   (see the warning in §0).
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
