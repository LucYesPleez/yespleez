# The Outbox — a durable lifecycle for every message

**Status: design + core built 2026-07-25.** Wiring (auto-save, restore banner, Send
integration, offline flush) follows. Ratified by the owner as the Messaging Reliability
milestone's foundation. This Markdown is the artifact; amend it here.

---

## 1 · Why this exists, and why it is not "Voicey drafts"

A friend recorded a Voicey, took a phone call, and lost it. The fix is not a voice feature —
it is a guarantee that should hold for photos, video, documents and anything a user creates:

> **Constitutional rule 1 — user-created content is never silently discarded.**
>
> **Constitutional rule 2 — once a message reaches the Draft state it is durable user
> content; from that point nothing but explicit user intent may destroy it.**

So there is one machine, the **Outbox**, and every message kind flows through the same states.
Voiceys are the first tenant; nothing about the machine is voice-specific.

---

## 2 · The lifecycle

```
Creating ─▶ Draft ─▶ Queued ─▶ Uploading ─▶ Sent(removed)
              │         ▲            │
              │         └── retry ── Failed
              ├─▶ Deleted (explicit)
              └─▶ Deleted (abandoned > 30 days)
```

| State | Meaning | Leaves to |
|---|---|---|
| **draft** | Being composed / recorded. Auto-saved continuously. One per conversation. | queued (Send), removed (Delete / send success / 30-day prune) |
| **queued** | Send pressed; waiting for a network turn. This is also the *offline* state. | uploading (a flush turn) |
| **uploading** | An upload attempt is in flight. | removed (success), failed (error) |
| **failed** | The attempt errored. Shows Retry. **Never discarded.** | queued (retry / reconnect) |
| *sent* | Uploaded; the real message row exists. The entry is **removed** — the thread now owns it. | — |

`sent` is not stored as a state; a sent entry is a deleted entry. The server row is the record
from then on.

---

## 3 · The entry — kind-agnostic by construction

```
{
  id:             uuid,
  conversationId: string,
  kind:           'voice' | 'text' | 'image' | 'video' | 'file' | …,
  state:          'draft' | 'queued' | 'uploading' | 'failed',
  createdAt:      epoch ms,
  updatedAt:      epoch ms,
  payload:        { … kind-specific … }
}
```

The machine reads only the envelope (`id`, `conversationId`, `kind`, `state`, timestamps).
It never looks inside `payload`. **Uploading is delegated to a registry** keyed by `kind`:

```
registerUploader('voice', async (entry) => { … upload, insert message … })
```

A new kind ships its payload shape and its uploader; it inherits queueing, retry, offline and
persistence with no change to the Outbox. That is the whole point of the design.

### 3.1 · The voice payload is a SEGMENT LIST from day one

```
payload = {
  segments:   [Blob, …],   // v1 always length 1
  durationMs: number,
  wave:       string,      // v2 envelope (or peaks, v1)
  mime:       string,
  capture:    { … C21 diagnostics … },
}
```

⚠ **`segments` is a list even though nothing yet produces more than one.** A stopped
MediaRecorder cannot resume, so *Resume Recording* — continue a parked note after a call — must
mean "record a second segment and join it." Joining encoded WebM/Opus blobs is a real remux
problem, deferred. But storing a **single blob** today and a **list** later would force a
migration of every saved draft. A one-element list costs nothing now and keeps Resume a pure
addition. **Resume Recording is NOT built here; the shape that permits it is.**

---

## 4 · Retention — durable, not hoarding

| Rule | Why |
|---|---|
| **One draft per conversation** | A conversation has one thing being composed. Saving a draft replaces the conversation's previous draft (same row id reused, so continuous auto-save is one upsert, not a pile). |
| **Auto-save continuously** | The user never presses "save a draft"; parking a recording, or leaving a half-typed message, is the save. |
| **Auto-restore on return** | Reopening the conversation rehydrates the draft. |
| **Delete on successful send** | A sent message is not a draft; the entry is removed the instant the server row exists. |
| **Delete on explicit delete** | The one destructive action the rules permit. |
| **Prune abandoned drafts after 30 days** | Storage stays tidy without the user losing recent work. Only `draft` state is pruned by age — a `failed` upload is never aged out, because the user asked to send it. |
| **"Recovered draft" banner on restore** | The user is told their work survived, rather than finding it silently. |

Queued/failed entries are **not** subject to one-per-conversation — you can queue several sends
offline. Only `draft` is singular per conversation.

---

## 5 · Offline

`queued` **is** the offline state. A Send with no connectivity leaves the entry queued; the
`online` event (and an app-open sweep) runs a **flush**: each queued/failed entry is handed to
its kind's uploader, removed on success, marked failed on error. This is how text already feels
("Sent when connection returns") and now every kind inherits it — which matters because the
whole app targets festival and doof venues with poor reception.

---

## 6 · Storage

IndexedDB, one object store keyed by `id`, with indexes on `conversationId` and `state`. Blobs
are stored directly (IDB supports them; no base64 inflation). The logic is written against a
small **store interface** so it can run on an in-memory fake in tests — there is no IndexedDB in
the Node test runner, and the state machine is exactly the part worth testing on its real path.

```
put(entry) · get(id) · getDraft(conversationId) · byState(state)
byConversation(conversationId) · remove(id) · all()
```

---

## 7 · Status — COMPLETE 2026-07-25

**Every outbound message kind flows through the Outbox, and `pendingSend` is
removed. There is exactly one outbound pipeline.**

| Kind | Path | Live-verified |
|---|---|---|
| text | queueMessage → uploadText | ✓ real composer, offline queue + bubble |
| voice | queueMessage → uploadVoice | ✓ queued playable bubble; draft restore + banner |
| image | queueMessage → uploadImage (photo / RAW original) | ✓ runtime, all-kinds pass |
| file | queueMessage → uploadFile | ✓ runtime, all-kinds pass |
| hand | queueMessage → uploadHand | ✓ runtime, all-kinds pass |

Verified live in the owner's authed session (Claude in Chrome), with **no
message sent to a real contact** — a simulated uploader on throwaway conversation
ids, plus offline-forced sends through the real composer that were deleted before
reconnect. All passed: every kind delivers; offline queues 5 consecutive mixed
sends; reconnect delivers the whole queue; a failed send stays failed; retry
delivers. Draft restoration verified end to end (parked Voicey → Recovered draft
banner → Send/Delete).

**Removed:** `pendingSend.js` and its tests; `trySend`/`afterSend`; the five
per-kind retry branches; the `sending` round trip. ConversationView imports no
send function — it queues, and the Outbox sends.

**Deliberately still open (future, not blocking):** Resume Recording (the segment
list is ready); a delete-on-failed affordance for stuck sends; migrating the
optimistic double-tap Hand (message metadata, a different subsystem from the
conversation Hand).

## 8 · Original build notes (historical)

**Built (this commit):** the kind-agnostic core — the state transition table, the entry
operations (save/restore/enqueue/markUploading/markFailed/remove), one-draft-per-conversation
enforcement, 30-day prune, the flush loop over an uploader registry, and both stores (the
IndexedDB adapter and the in-memory fake). Voice segment-list payload shape. Fully tested via
the in-memory store.

**Pending (next):**
- Composer auto-saves the parked Voicey as a draft (hook into `useVoiceRecorder`'s `pending`).
- `ConversationView` restores the draft on mount and shows the **Recovered draft** banner.
- **Send** routes through `enqueue` + the voice uploader instead of calling `sendVoiceNote`
  directly, so a failure lands in the outbox with Retry rather than only on the optimistic bubble.
- The `online`-event flush and an app-open sweep.
- Text drafts as the second tenant (proves kind-agnosticism cheaply).

**Explicitly not built:** Resume Recording (segment concatenation). The segment list exists so
it can be added without touching any of the above.
