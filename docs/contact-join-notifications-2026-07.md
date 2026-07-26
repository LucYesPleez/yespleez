# Contact Join Notifications — spec + three unresolved conflicts
**2026-07-26 · Design accepted, NOT built · Roadmap: Phone Discovery → Contact Sync → *this* → Multi-profile Messenger → libsignal**

The owner's requirement, recorded verbatim in §1, followed by three conflicts that must be
settled before it can be built. **One of them constrains Contact Sync, the milestone
immediately before this one** — which is why this document exists now rather than later.

---

## 1 · The requirement, as given

When a person joins and their number becomes discoverable, compare them against existing
contact-sync matches. Where another user has sync enabled and a valid match exists, notify them:

> 🎉 Sarah from your contacts joined YesPleez.

falling back to *"Someone from your contacts joined YesPleez"* when no contact name is known.
Multiple joins in a short window group into one:

> 🎉 3 people from your contacts joined YesPleez today.

Tapping opens the existing conversation if there is one, otherwise their Messenger profile with
a Message button. A dedicated preference — **☑ Contacts joining YesPleez** — turns them off
independently of other Messenger notifications.

Privacy, as stated: contact names never leave the recipient's device; the joining user is never
told how they are saved; numbers are never revealed; matching uses the existing architecture.

---

## 2 · ⚠ CONFLICT 1 — the server cannot write "Sarah"

**"Use the local contact name"** and **"contact names never leave the device"** cannot both hold
if the notification text is composed on the server. And it must be composed somewhere the server
can reach, because the triggering event (someone else joining) happens nowhere near the
recipient's device.

This is the same shape as the corroboration line in Phone Discovery §5, and it has the same
resolution: **the server names nobody; the client resolves the name at render time.**

- **Server** stores and sends a notification whose payload carries only opaque references —
  the joining user's `profile_id`, and a correlator (below). No name, no number, no hash.
- **In-app** the notification list substitutes the local name when rendering.
- **Push** is resolved in the **service worker**, which can read the device-local contact map
  from IndexedDB before calling `showNotification`. This is the only way a *push* can say
  "Sarah" without the server knowing it — and it works, because the SW runs on the device.
- **No local name?** Render the fallback. Never ask the server.

### ⛔ THE CONSTRAINT THIS PUTS ON CONTACT SYNC — read before building it

For the client to name the joiner, it must be able to map the notification back to one of *its
own* contacts. It cannot: the payload carries a `profile_id`, and the client's local map is
keyed by phone number. The joiner was **not** a match at sync time — that is the entire point —
so no `profile_id → name` pair was ever learned.

Therefore **Contact Sync must return a stable per-row correlator for every uploaded code**, not
just for the ones that matched:

1. Client uploads codes; server stores them and returns a `contact_code_id` **per submitted
   entry, in order**, matched or not.
2. Client keeps `contact_code_id → local name` **on the device only**.
3. When someone joins, the server knows which stored code they matched and puts that
   `contact_code_id` in the notification payload.
4. Client (or service worker) looks up the name locally.

The server therefore learns only *that* stored code #N now corresponds to a member — which it
must know anyway to send the notification at all. **If Contact Sync ships without returning
per-row ids, named join notifications become impossible without sending names to the server.**
Retrofitting means re-syncing every user's address book.

---

## 3 · ⚠ CONFLICT 2 — "successfully verifies their phone number"

**There is no verification.** No SMS, by ratified decision (Phone Discovery §0). The trigger
condition should read *"adds a number and is discoverable"*.

This is not pedantry, because of what the notification then is. Everywhere else an unverified
claim stays inert — the rule is *a number claim confers nothing; it is a way to be found, never
a way to be trusted.* A notification saying **"Sarah from your contacts joined"** breaks that:
it takes an unverified claim and asserts an identity, in the recipient's own vocabulary, with a
celebratory emoji. Someone who squats a number gets themselves introduced to that person's
friends under a name those friends already trust.

**Mitigation (recommended, cheap):** the notification may say it, but the destination must not
let it stand alone. Wherever the tap lands, show the corroboration line — the account's own
display name **and** the saved-as name together:

> **Mallory X** · saved as Sarah

Agreement reads as confirmation and disappears. Disagreement is visible at exactly the moment
the recipient is deciding whether to talk to this person. The notification stays warm; the
screen behind it stays honest.

**T3 (recorded tension):** this milestone is the one place the product amplifies an unverified
claim into a trusted statement. Accepted deliberately, mitigated at the destination, and it is
the first thing to revisit if verification ever arrives.

---

## 4 · ⚠ CONFLICT 3 — grouping erases the name it just promised

*"3 people from your contacts joined YesPleez today"* is the right call for volume, but note it
silently drops the personalisation that motivated the feature. Proposed rule, so it is a
decision rather than an accident:

| Joins in the window | Notification |
|---|---|
| 1 | `🎉 Sarah from your contacts joined YesPleez.` |
| 2 | `🎉 Sarah and Tom from your contacts joined YesPleez.` |
| 3+ | `🎉 3 people from your contacts joined YesPleez today.` |

Two names still fit a lock screen and keep the feature's whole point — that these are *people
you know*. Grouping happens **client-side**, since only the client knows the names; the server
sends one notification per join and the client collapses them. A ~6 hour window, and never more
than one grouped notification per day.

---

## 5 · Plumbing this needs

- **A new notification type** with a row in `notification_expiry_policy` — category and expiry.
  Suggested `policy: 'never'`, matching `new_follower`: a friend joining does not go stale.
- **The preference** *"Contacts joining YesPleez"* joins `notification_preferences`. Per NP1 a
  muted notification is still written, never counted — do not special-case that here.
- **⚠ This is conversation-adjacent but is NOT conversation activity.** Per the navigation
  architecture, conversation activity never touches the bell. A contact joining is not a
  message, so it **does** belong on the bell and must **not** be added to
  `KNOWN_CONVERSATION_TYPES`.
- **Tap routing:** existing conversation → open it; otherwise the profile with a Message button.
  Both paths already exist (`openDirectConversation`, `/profile/:id`).

---

## 6 · Open questions

- **Q3:** does a join notify people whose sync ran *months* ago, or only recent syncs? Unbounded
  means a contact code uploaded once notifies forever, which is probably right but should be
  said.
- **Q4:** if the recipient's discoverability is `nobody`, do they still *receive* join
  notifications? The spec gates on the joiner's settings; the recipient's own discoverability is
  a separate axis and arguably irrelevant to what they are told. Recommend: irrelevant — receiving
  is not being found.
