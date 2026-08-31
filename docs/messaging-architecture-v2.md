# Messaging Architecture v2

**Status: FROZEN — 25 July 2026, amended 26 July 2026** (§9 rewritten for
reactions; §12 reactions moved from future to built).

A snapshot of how messaging actually works, not a roadmap and not a plan. It
describes the system as built and running on that date, so that a reader six
months later does not have to reconstruct it from commit archaeology.

**How to use this document.** Trust it about *shape and intent*; verify
*details* against the code, which is always the authority. Every section
names the files it describes. Where the code and this document disagree, the
code is right and this document is stale — fix it here in the same commit.

**How to amend it.** Do not edit sections to match a change in passing. A
change that contradicts anything in §1 (Invariants) is an architectural
decision and needs the owner. Everything else: change the code, then correct
the affected section, in one commit.

---

## 1 · The invariants

Six rules that the rest of the system is arranged around. They were each paid
for by a real failure, and they are the parts most expensive to get wrong later.

**I1 · User-created content is never silently discarded.**
Platform-wide, applying to Voiceys, photos, video and attachments equally.
Users never notice this working and immediately notice it failing.

**I2 · Once content reaches Draft, only explicit user intent may destroy it.**
An interruption, a crash, a closed tab, a dead battery — none of these are
intent. Delete is.

**I3 · If a parked Voicey exists, no recording control may implicitly discard it.**
The user must explicitly choose Continue, Send, Delete or Discard before a
new recording can begin. *(Ratified 25 Jul 2026, after the microphone button
destroyed a recording that had survived a phone call. A product rule, not a
platform workaround — it holds regardless of what the OS reports.)*

**I4 · Every outbound message enters the Outbox. There is no happy-path bypass.**
`Creating → Draft → Queued → Uploading → Sent` is the only path, online and
offline alike. One code path for both is the entire point; two paths diverge
in ways that only appear on a bad connection at a festival.

**I5 · Conversation content never leaves the conversation.**
`C32`. No message body or payload is copied into notifications, ranking,
recommendation, or any platform decision system. Notification rows carry ids;
the client resolves what to display, under RLS, from data the participant
could read anyway.

**I6 · Preferences and push govern DELIVERY, never EXISTENCE.**
A muted or undeliverable notification is still written. `NP1`, and the same
principle as `N1`'s held notifications: *a held notification is an asset; a
suppressed one is a deleted fact.*

---

## 2 · Conversation model

*Files: `supabase/migrations/…m8a_messaging_foundation.sql`, `…m8b…`, `…m8c_conversation_creation.sql`; `v2/src/lib/messaging.js`.*

### Shape

| Table | Key columns |
|---|---|
| `conversations` | `id`, `context_type`, `context_id`, `subject_state`, `status`, `participant_key`, `last_message_at` |
| `conversation_participants` | PK `(conversation_id, profile_id)`, `archived_at` |
| `messages` | `id`, `conversation_id`, `from_profile_id`, `from_user_id`, `body`, `kind`, `payload`, `created_at` |
| `conversation_read_state` | PK `(conversation_id, user_id)`, `last_read_at`, `last_delivered_at` |

`context_type ∈ (application, invitation, booking, event, venue)`.
`status ∈ (active, closed, restricted)`.

### The two identities on every message

`from_profile_id` is **attribution** — the profile that spoke.
`from_user_id` is **the human** — who actually typed it.

They are not interchangeable and the distinction is load-bearing. A colleague
acting as the same profile is a different human: their messages are unread to
you, and they receive their own notifications. Anything counting or
suppressing "your own" messages keys on `from_user_id`.

### Which of MY profiles am I speaking as (§2.0a, added 2026-08-31)

Client-side resolution, not a schema rule — the participant set is untouched.

`ConversationView` must decide which participant is "you". When only one
participant is actable the answer is forced. When **both** belong to one
account it is not, and the drawer used to take the first actable profile it
found: pressing MESSAGE on a host dashboard could seat the reader as their
**venue**, talking to their own host.

The surface that opens the drawer now states the identity it acted as, via
`open(id, { asProfileId })` (`lib/conversationUi.jsx`). Resolution order:

1. `asProfileId`, **only if `actableProfileIds` already returned it**;
2. the account's `punter` profile — note-keeping puts Personal on your side;
3. the first actable participant.

The hint is a hint, never a grant: §A4 stands, ownership is asked and never
computed in the client, so an opener cannot assert an identity the account
does not hold. Openers that legitimately have no opinion — the inbox, a
notification deep-link — pass nothing and get the unchanged fallbacks.

⚠ Two different accounts can never reach this branch: the actable set only
holds profiles the reader can act as. It is invisible unless one person owns
both ends, which is why it went unnoticed.

### Participants are fixed at creation (§2.1)

> *"the participant set and the subject are FIXED. A new set or subject means a
> NEW conversation, never a mutation"*

There is no INSERT or DELETE policy on `conversation_participants` anywhere —
the rule is enforced by the absence of a way to break it, not by a check.

### Creation is idempotent

`open_conversation(context_type, context_id, participant_ids[]) → uuid`
(`SECURITY DEFINER`). Computes a stable md5 `participant_key`, takes an
advisory transaction lock, and **returns the existing conversation** rather
than raising (`C15`). Callers may call it freely without racing.

Authorisation is strict: the caller must `can_act_as` **at least one**
participant profile, or `42501`. Either side of a conversation may open it.

### Access control

Access is `can_act_as` on any participant profile — nothing else. Expressed as
two `SECURITY DEFINER` predicates, `is_conversation_participant(uuid)` and
`can_write_to_conversation(uuid)` (participant **and** `status = 'active'`).

- conversations / participants — SELECT only
- messages — SELECT + INSERT, where INSERT additionally requires
  `can_act_as(from_profile_id)` and `from_user_id = auth.uid()`
- **no UPDATE or DELETE policy anywhere** — `D9`, messages are immutable in v1

`conversations.last_message_at` is maintained by the `touch_conversation_last_message`
trigger, which is `SECURITY DEFINER` precisely *because* conversations have no
UPDATE policy; an invoker-rights trigger would match zero rows and fail silently.

### Archiving

Per-participant (`conversation_participants.archived_at`), deliberately not a
column on `conversations` — §2.6. See §12 for the unresolved tension this
creates with the unread badge.

---

## 3 · Messages and kinds

*Files: `supabase/migrations/…m9a_message_kinds.sql`, `…m9h_hand_kind.sql`; `v2/src/lib/messageKindList.js`, `messageKinds.jsx`.*

Two columns carry everything: `body` (human-readable text, and for non-text
kinds the **fallback** an older client or a screen reader says) and `payload`
(jsonb, kind-specific structure). Every kind must write something legible to
`body`.

`payload` is deliberately **not** validated per kind — a CHECK per kind would
need rewriting on every addition. The renderer owns its own payload shape.

### Unsend (U1) — messages are no longer immutable

*Files: `supabase/migrations/20260811000000_u1_message_unsend.sql`;
`v2/src/lib/unsend.js`, `messaging.js#unsendMessage`.*

The baseline's "IMMUTABLE in v1 … removal right deferred, not denied" is now
taken up. A sender may withdraw their own message for **15 minutes**.

It is a **tombstone, not a delete**: the row survives with `deleted_at`,
`deleted_by`, `body` replaced by a sentinel and `payload` emptied. A hard
DELETE would corrupt everything counted from `messages` — unread counts,
`last_message_at` — and leave a hole rather than an acknowledgement.

⚠⚠ **The UPDATE policy grants the power to rewrite history, and the trigger is
the only thing that does not.** `redact_message_on_unsend` rebuilds the row
from `OLD` and discards every value the client sent, so an UPDATE that also
tried to change `body`, `kind` or the author changes none of them. The client's
UPDATE expresses **intent only**. ⛔ Never send the tombstone body from the app.

⚠ The 15 minutes is enforced in the policy. `lib/unsend.js` mirrors it purely
to decide what to OFFER; if the two disagree, the app is wrong.

⚠ The realtime channel now subscribes to **UPDATE as well as INSERT**. Without
that the recipient's open conversation keeps displaying withdrawn text until
they reload — the sender told, truthfully, that it was withdrawn while it sits
on the other screen.

### The canonical list

`messages_kind_valid`:

```
sender:    text · voice · image · video · file · location · hand
workflow:  event · application · booking · approval
platform:  system
```

Mirrored client-side in `messageKindList.js#KINDS`, with
`messageKindContract.test.js` guarding the two against drift.

**Renderers implemented today** (`messageKinds.jsx#RENDERERS`): `text`,
`voice`, `hand`, `image`, `file`. Everything else renders via `renderFallback`
— the body plus *"— not supported in this version yet"*. Adding a kind is a
value in the CHECK, a value in `KINDS`, and a renderer.

Geometry and material live beside the list, not in the renderer:
`KIND_SHAPE`, `KIND_MATERIAL`, `BARE_KINDS`, `UNHANDABLE_KINDS`.

---

## 4 · The Outbox

*Files: `v2/src/lib/outbox.js` (the only app surface), `outboxMachine.js` (pure), `outboxStore.js` (persistence), `outboxUploaders.js` (per-kind adapters), `messagingReliability.js` (runtime).*
*Doc: `docs/messaging-outbox-2026-07.md`.*

**One durable outbound pipeline for every message kind.** It is not "voice
drafts" — it is kind-agnostic by construction, which is what let images, files
and Hands join it without redesign.

### Lifecycle

```
Creating → Draft → Queued → Uploading → Sent
                ↘ Deleted
                   Upload Failed → Retry
```

Stored states are `draft · queued · uploading · failed`. **`sent` is not a
stored state** — sent means the row is removed.

`decideTransition(state, event)` is pure and total. Events: `send`,
`upload-start`, `upload-ok`, `upload-fail`, `retry`, `delete`. An unhandled
pair returns `null`, which means *do nothing* — never *drop it*. `delete`
applies from any state.

`failed + send` behaves as `failed + retry`, so a user pressing Send again on
a failed message does the obvious thing.

### Entry shape

```js
{ id, conversationId, kind, state, createdAt, updatedAt, payload }
```

The machine reads only the envelope and never the payload — which is why one
state machine serves every kind.

### Persistence

IndexedDB, with an automatic in-memory fallback if `indexedDB` throws (private
browsing). Blobs are stored as-is. One interface, two implementations, chosen
at runtime.

### Uploaders

A `kind → uploader` registry (`registerUploader`), so a new kind inherits
queueing, retry, offline and failure handling for free.

Registered today: `text`, `voice`, `image`, `file`, `hand`.

⚠ Each uploader must convert a returned `{ error }` into a **throw** — the
Outbox detects failure by exception. A missed conversion is a silently dropped
message, which is the single most dangerous bug available in this subsystem.

### Entry points

- `queueMessage(...)` — creates the entry **already `queued`** (durable from
  that line), persists, then attempts delivery. Offline, the flush no-ops and
  the entry waits. There is no separate online path (I4).
- `enqueueDraft(id)` — draft → queued → flush
- `retry(id)`, `remove(id)`
- `flush()` — self-guarding against concurrent calls
- `subscribeOutbox` / `subscribeDelivered` — change buses, because IndexedDB
  emits no events of its own

### Runtime

`startMessaging()` (called once from `App.jsx`) registers the uploaders,
flushes on `online`, and prunes + flushes on app open. **This is what makes
the offline promise real**: record with no signal, press Send, pocket the
phone, and it delivers when the bars return.

### Retention

- **One draft per conversation**, keyed by conversation.
- `DRAFT_TTL_MS` = 30 days. **Only `draft` ages out**, measured from
  `updatedAt`.
- `failed` is *never* pruned, however old — the user pressed Send on it, so it
  is content, not a scratchpad (I1/I2). Queued and uploading are in flight.
- A restored draft raises a **"Recovered draft"** banner. Silent restoration
  looks like a bug.

---

## 5 · Voicey lifecycle

*Files: `v2/src/lib/voiceNotes.js` (capture + upload), `hooks/useVoiceRecorder.js` (state), `lib/voiceMachine.js` (pure decisions), `voiceWave.js`, `voiceConcat.js`, `voiceScrub.js`, `mediaSession.js`.*

### Phases

`idle → recording → pending → uploading → sent → idle`

`pending` means **a parked note exists**. It is the state I2 and I3 protect.

Decisions are pure and tested (there is no React renderer in the test
infrastructure, so logic that matters lives outside the hook):

- `decideToggle({phase, starting}) → abort-start | park | start | resume | ignore`
- `decideSend({phase}) → upload-parked | stop-and-upload | ignore`
- `decideInterrupt({phase}) → park | ignore`

⚠ `starting` is checked **first**. During the `getUserMedia` gap `phase` is
still `idle`; without that check a second press opens a second microphone that
nothing holds a reference to — unstoppable, invisible, still recording.

⚠ From `pending` the toggle **resumes** (I3). It must never return `start`,
which clears the parked note and every segment.

### The three verbs

- **`park(mode)`** — stop capture, freeze what exists as a durable parked
  segment, accumulate duration and envelope, move to `pending`.
- **`salvage`** — `park('salvage')`, the interruption path. `handle.salvage()`
  never rejects; it returns whatever the interruption left behind, and the user
  sees *"Recording saved — you were interrupted"*.
- **`resume`** — see §6.

### Interruption detection

`recorder.start(TIMESLICE_MS)` with `TIMESLICE_MS = 1000`, so chunks
accumulate continuously; without it `chunks` stays empty until `stop()` and an
interruption loses everything.

Three watchers, all reporting into one deduplicated `flagInterrupt`:
`MediaRecorder` error, track `ended` / `mute`, and `AudioContext` statechange
to `suspended` / `interrupted`. The watcher only *reports*; `decideInterrupt`
decides, and the hook parks.

**Parks on the audio pipeline breaking — NOT on `visibilitychange`.** A
desktop tab switch keeps recording; mobile background, lock and call all trip
the pipeline.

#### Measured platform behaviour — iPhone, iOS 26.5.2, installed PWA, 3 real calls

| Signal | Fired |
|---|---|
| `track.mute` | **3 / 3**, always first, ~1 ms |
| `AudioContext` → `interrupted` | **1 / 3** |
| `track.ended` | 0 / 3 |
| `visibilityState` → hidden | 0 / 3 |

⚠ **The AudioContext is non-deterministic on iOS.** Twice it sat at `running`
straight through the seizure. **`track.mute` is the only signal that can be
relied on.** A later "simplification" dropping the track-mute watcher in
favour of the context watcher would break interruption recovery on iPhone two
times in three *while passing every test in this repository*, because none of
it reproduces without real hardware and a real caller.

Corollaries: a visibility-based check would have caught nothing, and
`navigator.userActivation.isActive` drops to false during any normal recording
so it carries no interruption signal at all.

### Diagnostics

`lib/voiceDiagnostics.js` + `components/VoiceDiagnosticsPanel.jsx` (on the
beta-feedback screen, one tap from the global header). Observation only —
never behaviour. Records every signal plus a **once-per-second heartbeat** of
`visibilityState`, `AudioContext.state`, `MediaRecorder.state`, track
`readyState`/`muted`/`enabled`, `hasFocus`, `userActivation`.

⚠ A **gap** in the heartbeat is itself evidence: the interval cannot run while
the OS has the page frozen, so a hole dates a suspension no in-page event
could report. Do not move it to a worker to "fix" the gaps.

### Constants

`MIN_DURATION_MS = 400` · `MAX_DURATION_MS = 6 min` (total across all
segments) · `WARN_REMAINING_MS = 15 s` · `TIMESLICE_MS = 1000` ·
waveform `WAVE_VERSION = 2`, `BUCKET_MS = 32`.

### Playback

`components/VoiceMessage.jsx` — a plain `<audio>` element, waveform as DOM
nodes painted by `paintBars(progress)` from a rAF loop. Scrubbing maths is
pure and tested in `voiceScrub.js` (including a 50 ms end-margin so
drag-to-end does not fire `ended` and snap to zero). Playback arbitration is
`lib/mediaSession.js` — a Voicey always claims the SHORT slot and interrupts
the resumable mix.

⚠ iOS capture is fragile. Do not touch `PREFERRED_MIME_TYPES` or the
echo-cancellation settings without reading the §6.1 notes: *every time we
described the capture we wanted, iOS gave us something worse.*

---

## 6 · Resume Recording

A stopped `MediaRecorder` cannot be resumed, and after an interruption the
track is dead. So **Continue records a NEW segment and appends it.**

Naively concatenating two independent WebM/Opus blobs does not produce a
playable file (broken headers and duration — typically only the first segment
plays). The design that avoids a player rewrite:

- **Store segments compressed and separate.** Small on the wire, which matters
  for the festival case.
- **Stitch on first play.** `voiceConcat.js` fetches each segment, decodes,
  concatenates PCM, encodes one in-memory WAV, and hands the player a single
  object URL. The WAV is transient — never stored, never uploaded, so no WASM
  dependency and no bandwidth cost. A single-segment note never goes through it.
- **One continuous waveform.** `computeCombinedWave` builds a single envelope
  across all segments at record time, computed incrementally so Continue never
  re-decodes prior segments and Send stays instant.
- **The timer counts from the accumulated duration**, never flashing back to
  0:00 — that flash is the one place the segmented implementation would show.

**Segments are internal storage only.** The recipient gets ONE note: one
duration, one waveform, one scrubber, one speed, no visible "parts".

### Payload

```js
// single segment (legacy shape, unchanged)
{ path, duration_ms, mime, wave?, capture? }

// resumed note
{ paths: [...], seg_ms: [...], duration_ms, mime, wave?, capture? }
```

⚠ **Any future deletion, unsend, disappearing-message or export path must
handle `paths` as an array** and remove *every* object, or storage leaks.
No deletion path exists today, so nothing is currently broken — this is a note
for whoever builds one.

The 6-minute cap applies to the **combined** duration.

---

## 7 · Draft persistence and the upload queue

These are not two features. Draft persistence, the upload queue and offline
delivery are three stages of one IndexedDB-backed lifecycle — §4. They are
listed separately here only because they were requested separately.

- **Draft persistence** — the parked note (segments, duration, wave, mime,
  capture) is written to IndexedDB the moment it is parked, so it survives a
  reload, a crash, a browser update, or a battery-saver tab kill. Restored on
  returning to the conversation, with the "Recovered draft" banner.
- **Upload queue** — `queued → uploading → sent`, `failed → retry`. The blob
  is never lost on a failed upload.
- **Offline** — Send with no reception queues durably and delivers on
  reconnect. **This is a selling point, not a fallback**: the whole app targets
  poor-reception venues.

---

## 8 · Read state, delivery and receipts

*Files: `supabase/migrations/…m8d_read_state.sql`, `…m10a…`, `…m10b…`; `v2/src/lib/messaging.js`.*

### The one counting rule (§5.6)

Unread = messages in scope where
`from_user_id IS DISTINCT FROM auth.uid()` **and**
`created_at > COALESCE(last_read_at, '-infinity')`.

Excluded by **human**, not profile (see §2). Three surfaces share it, so they
cannot disagree:

- `conversation_unread_count(conversation_id)` — one thread
- `total_unread_count()` — the badge, scoped purely by RLS on `messages`
- `total_unread_count_for(user_id)` — the same rule parameterised for
  server-to-server use by push (§10). `service_role` only. **A hand-maintained
  mirror: change both in one commit.**

`mark_conversation_read` is monotonic — `GREATEST(existing, now)`, so a
watermark can never move backwards.

### Delivery is separate from read

`last_delivered_at` + `mark_conversation_delivered`, inserting with
`last_read_at = '-infinity'` so a delivery can never imply a read. Called
**only when this device genuinely has the message** — never on send, never on
notify. Delivery is per-device; read is per-human.

### Receipts return WHEN, never WHO

`conversation_receipts(conversation_id) → (delivered_at, seen_at)` — a
`SECURITY DEFINER` aggregate over the other participants, with an explicit
participant guard inside the function (a definer function bypasses RLS, so
without the guard it is an existence oracle).

⚠ **This must never be widened to return rows.** A SELECT policy on
`conversation_read_state` would expose `user_id`, revealing *which* human on a
shared profile opened a booking negotiation. *A `SECURITY DEFINER` function is
the only shape that can return strictly less than it reads.*

### Liveness vs durability

The **table row is the durable record**, read on thread open. Liveness rides a
Supabase **broadcast** channel (`receipts:<id>`, `broadcast: { self: false }`),
opened just long enough to announce and then closed — a persistent socket per
thread would be too expensive. Missing a broadcast is harmless by design: the
state reconciles from the table.

New messages and badges use `postgres_changes`; receipts use `broadcast`. The
split is deliberate.

---

## 9 · Acknowledgement and reactions

*Files: `supabase/migrations/…m9h_hand_kind.sql`, `…m9i_message_participant_state.sql`, `…mr1_message_reactions.sql`; `v2/src/lib/hands.js`, `messageState.js`, `reactions.js`; `components/HandIcon.jsx`, `ReactionBar.jsx`, `MessageActionSheet.jsx`.*

The ratified rule:

> **A CONVERSATION Hand is a MESSAGE. A MESSAGE Hand is METADATA.**

- **Composer Hand → a message.** `kind = 'hand'`, `body = 'Yes'`. Routed
  through the Outbox like every other kind (`uploadHand`).
- **Double-tap a message → metadata.** `message_participant_state`
  (PK `(message_id, profile_id)`, plus `from_user_id`, `handed_at`).

### ⚠ The acknowledgement is NOT a reaction

Owner, 2026-07-25: *"the hand is purely on the command bar. it's not an
emoji so will not be grouped with them. it also is the one I really want
people to use more often."*

`reactions.js` therefore contains **no `hand` entry**, and there is a test
asserting it never gains one. Making the acknowledgement one of N equal
choices behind a long press is precisely how it gets used less. It keeps its
own column, its own gesture, and its own place in the UI.

### The seven reactions

A fixed set, declared once in `reactions.js` — the registry owns every
glyph, its order and its label, so the bar and the badge contain no emoji
and no list. **Adding one is an entry there plus a value in the `mr1` CHECK.
No component changes.** There is deliberately no More button and no picker:
reactions are fast punctuation, not a decision.

Stored as a **stable key** (`'clouds'`), never the glyph — `😶‍🌫️` is three
codepoints joined by a ZWJ and several others carry variation selectors, so
storing glyphs means a CHECK that passes or fails depending on which client
normalised the string.

### ⚠ One badge slot, so they are mutually exclusive

The chosen emoji renders in **exactly the position the Hand occupies** on
the bubble. Two marks cannot share one slot, so acknowledging clears any
reaction and reacting clears any acknowledgement.

Enforced at the single write path in `messageState.js` — `handMessage` nulls
`reaction`, `setReaction` nulls `handed_at`. **The schema permits both; the
product does not.** Deliberately not a CHECK constraint: it is a
presentation decision, and the day the badge can hold two marks it should
change in one file rather than needing a migration.

One active reaction per person per message needs no constraint at all — the
primary key `(message_id, profile_id)` already enforces it.

### Two bugs the reaction column created

Both fixed, both pinned by tests, both silent failures:

- `unhandMessage` used to **DELETE the row**, which would have taken the
  reaction with it. It now nulls `handed_at`.
- `handMessage` used `ON CONFLICT DO NOTHING`, so acknowledging a message
  you had already reacted to would have done nothing at all.

### Naming

Product copy says neither "Hand" nor "Yes". The **mark is the branding**;
the word is **Acknowledged**. Two tests guard this.

`HAND_BODY` remains the literal `'Yes'` — that is the stored message *body*,
already written into every existing acknowledgement and quoted by
notification rows. Labels are presentation and change freely; stored text
does not.

### Gestures

| | |
|---|---|
| single tap (photo) | enlarge |
| double tap (any kind) | acknowledge |
| long press (any kind) | reaction bar + action sheet |

⚠ **They must not overlap, and two handlers is not enough.** Every double tap
*begins* as a single tap, so opening a photo on the first one put the viewer
on screen before the second could land. The open waits out a **240ms**
window; a second tap inside it cancels the open and lets `dblclick` reach the
bubble. The cost is honest: a photo opens a quarter-second after the tap.

⚠ **The thread never enters native text selection.** No handles, no
highlight, no caret, no OS copy bubble competing for the same gesture. This
costs copy-by-drag, which is why **Copy Text** in the action sheet is
load-bearing rather than a nicety.

The action sheet contains **actions only** and the bar **reactions only** —
they are never mixed. It ships Copy Text alone; Reply, Forward and
Unsend/Delete are absent rather than disabled (see §12).

### Feedback

A reaction does not appear, it **arrives**: spawned 78px above its resting
place, falling in 180ms with an accelerating fall and decelerating settle,
squashing 1.06 → 0.96 → 1.0. It squashes rather than bounces — it never
leaves the surface twice. A replacement remounts (keyed on the reactions) so
it lands rather than pops.

Sound is `lib/uiSound.js`: Web Audio, decoded once at startup, unlocked on
the first real gesture. **There is no silent-mode API on any platform** — iOS
silences Web Audio via the hardware switch itself; elsewhere the Message
Sounds setting is the only control.

**Designed in, not yet driven:** `payload.scale` with `handScale()` and
`HAND_SCALE_MAX = 3` are stored and rendered, but no press-and-hold gesture
produces a scale above 1 yet.

---

## 10 · Push notifications

*Files: `v2/src/lib/push.js`, `components/PushNotificationToggle.jsx`, `public/sw.js`, `supabase/functions/push-notify/index.ts`, migrations `…mp1…`, `…mp4b…`, `…mp5b…`.*

**Push is a delivery channel, never a source of truth.** The `notifications`
table stays authoritative: `notify_new_message` (M8e) decides *who* is
notified and the `NP1` trigger decides *whether*. The edge function reacts to
a row that authority already wrote and approved, and re-derives display text
only. There is no second notification pipeline and no client-side send.

### The path

1. A message insert fires `notify_new_message`, which fans out one
   notification row **per human** who can currently act as each recipient
   profile (§A7), skipping the sender, holding for unclaimed profiles (`N1`).
2. `trigger_push_notify` (MP4b) fires on that insert and calls the edge
   function via `pg_net`, reading its credential from Vault. Fire-and-forget:
   a push must never fail, delay or roll back the write it reacts to.
3. `push-notify` checks eligibility (`to_user_id` present, `suppressed_at`
   null, type in scope), resolves the sender's display name and the message
   *kind*, computes the badge count, and fans out to every registered device.
4. `sw.js` shows the notification and sets the app-icon badge.

### Rules that hold it together

- **Keyed on `user_id`**, because delivery is per-human — matching the unread
  badge, not inventing a second model of who a notification is for.
- **`endpoint` is globally unique**, so a re-subscribe upserts and a dead
  device is pruned by endpoint alone without touching another device.
- **404 / 410 prunes the subscription** — the push service is saying the
  endpoint is permanently gone. Any other failure is left alone; it may be
  transient.
- **The endpoint + keys are a credential.** RLS is owner-only; anon has
  nothing.
- **Same-conversation collapse** via `tag: conversation-<id>` — five texts read
  as one alert.
- **The badge comes from the counts the app already holds** (§8), never a
  second tally. When the app is closed, the service worker cannot see app
  state, which is why `total_unread_count_for` exists.

### ⚠ Forward-compatible with libsignal, structurally

The push payload carries **routing information only**: notification id,
conversation id, sender display name, message kind, badge count.
`messages.body` and `messages.payload` are never read by the sender. Once
messages are end-to-end encrypted this path needs nothing it will not have —
the server sending the push will not possess plaintext to leak even if asked.

A future "show the message text in the preview" feature must be satisfied
**client-side** (the service worker looking up or decrypting locally). Sending
plaintext through the push service is not an option.

### Platform reality

iOS requires **Add to Home Screen + iOS 16.4+**; a normal Safari tab receives
nothing and the toggle correctly hides itself. Android and desktop Chrome work
without installing. Permission is requested **only from an explicit tap** — a
prompt on load is permanently and silently blocked once dismissed.

State is reconciled on mount (`reconcilePushState`) because revocation fires no
event that survives the app being closed.

### Operational note

Supabase's Database Webhooks **cannot be used on this project** —
`ERROR 3F000: schema "supabase_functions" does not exist`, and enabling
`pg_net` does not create it. The trigger replaces it and is the better
artefact: reproducible from the repository rather than invisible in a
dashboard.

**Per-environment manual step:** the `service_role` key must be stored in
Vault as `push_notify_service_key` (documented in the MP4b header). Without it
every push silently no-ops.

---

## 11 · Attachments and storage

*Files: migrations M9b / M11 / M12 / M13; `v2/src/lib/messageImages.js`, `messageFiles.js`, `voiceNotes.js`.*

Four **private** buckets, never merged:

| Bucket | Holds | Limit |
|---|---|---|
| `voice-notes` | Voicey segments | — |
| `message-images` | display images | 8 MB, mime allow-list |
| `message-files` | documents | 50 MB |
| `message-originals` | HD originals | large, accepts HEIC |

Path layout is `<conversation_id>/<uuid>.<ext>`, and **the first segment is
load-bearing**: every storage policy reads the conversation id out of
`storage.foldername(name)[1]` to authorise. All four buckets have SELECT and
INSERT policies **only** — no UPDATE, no DELETE.

### Expiry is a READ GATE, not a deletion job

There is no scheduler in this system (`expire_held_notifications()` has never
run). So `message_originals.expires_at` gates the SELECT policy: once the
window closes, Postgres refuses to sign a URL. `NULL` means never expires (the
future premium case). There is no UPDATE policy, so a client cannot extend its
own window. Bytes are not reclaimed today — deferred, deliberately, as a cost
exercise.

### ⚠ Image orientation

Browsers **already** apply EXIF orientation. Applying it again sends photos
sideways. Detection is via the JPEG SOF marker; never rotate back.
`loadCorrectedCanvas` is shared with avatars and posters — a change here
affects all three.

---

## 12 · Future hooks

What the architecture is already shaped to accept. None of this is built.

**libsignal (end-to-end encryption).** The path is prepared rather than
started. Push carries routing ids only (§10). Notifications carry no content
(I5). Bodies and payloads are already treated as opaque by everything except
the renderer. The remaining work is key management, device identity, and the
fact that server-side search and previews become impossible by construction —
which is a product decision, not a technical one. Scheduled after the
messaging UX is frozen, so encryption is not debugged alongside interaction
changes.

**Disappearing messages.** Blocked on nothing structural, but see the two
warnings above: deletion must handle `payload.paths` as an array (§6), and
there is no scheduler, so expiry will have to be a read gate like
`message_originals` (§11) rather than a sweep.

**Reactions — BUILT 2026-07-26, see §9.** They landed exactly where this
section predicted: an emoji column on `message_participant_state`, which is
why it was one `ADD COLUMN` rather than a subsystem. `played_at` and
`hidden_at` are still deliberately absent, still pending the same visibility
decision on the conversation-wide SELECT policy — reactions did not need it,
because a reaction is meant to be seen by the other party exactly as a Yes
is. Those two are not.

**Multi-profile messenger.** `profile_actors` already returns a *set*, and
fan-out already delivers one notification per human. The single-owner
assumption lives in `can_act_as`'s body, not in delivery. When that body
becomes a multi-owner join, `profile_actors` must change **in the same
commit** — they are two projections of one fact.

**Message editing / deletion.** Currently impossible by policy: no UPDATE or
DELETE anywhere (`D9`). Adding either is an architectural change, not a
feature.

---

## 13 · Known tensions and honest gaps

Recorded rather than resolved, because resolving them needs decisions rather
than code.

1. **Archived conversations still count toward the unread badge.** §2.6 makes
   `archived` per-profile; §2.5 makes unread per-human. A per-human count
   cannot depend on per-profile state without reintroducing the coupling `C11`
   forbids. The restrictive default was chosen because it cannot hide a real
   message. *A v1 default, not a ruling.*
2. **`total_unread_count_for` is a hand-maintained copy** of
   `total_unread_count`. Known drift risk, accepted because the alternative
   (one function with an optional argument) obscures which one RLS protects.
3. **M10a reversed M8d's ratified "v1 has no read receipts".** Both files
   remain; M8d's comment now contradicts shipped behaviour.
4. **`conversation_seen_watermark` (M10a) is superseded by
   `conversation_receipts` (M10b)**, but both functions and both client
   wrappers still exist.
5. **The storage migrations (M9b, M11, M12, M13) carry `⚠ NOT APPLIED`
   headers, yet voice notes, photos and files demonstrably deliver in the live
   app.** The headers are stale, not the features. Do not re-run them blindly;
   verify against the live schema first.
6. **Stale comments in `messageKinds.jsx`** claim text is the only renderer,
   and elsewhere that `file` is not implemented. Both are wrong.
7. **`lib/hands.js#sendHand` may be dead code** — the live path is
   `queueMessage` + `uploadHand`.
8. **Seven of eight interruption scenarios are unmeasured.** Only the incoming
   call is characterised (§5). The instrument is in place for the rest.
9. **A voice send uploads segments sequentially before the insert**; a failure
   partway leaves orphaned storage objects. No cleanup path exists.

---

## Appendix · Where to start reading

| To understand | Read first |
|---|---|
| How a message gets sent at all | `lib/outbox.js`, then `outboxUploaders.js` |
| Why a send behaves oddly offline | `outboxMachine.js` (pure, tested) |
| Anything about Voiceys | `lib/voiceMachine.js`, then `hooks/useVoiceRecorder.js` |
| Why iOS is doing something strange | §5 above, then `lib/voiceDiagnostics.js` |
| Who can read what | `m8a` and `m8c` migration headers |
| Why a notification did or didn't arrive | `m8e` (fan-out), `NP1` (suppression), then `push-notify` |
| The identity rules under all of it | `lib/writeNotification.js` header |
