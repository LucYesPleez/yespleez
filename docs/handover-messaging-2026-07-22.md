# Handover — YesPleez Messaging, 2026-07-22

Rewritten at end of day, covering the whole session. Supersedes every earlier version.

## State

Branch `v2-react`, at `0161bb5`. **Everything is pushed — 0 unpushed.** Tree clean.
**233 tests pass**, build and lint clean. Migrations M9a–M10b applied and verified.

**No migration was written today.** Every change is client-side.

## ⛔ Read before touching anything

Two changes were built, pushed, and then **reverted at the owner's request**. Both are in
the log and look like working code. Do not reinstate either without asking:

| reverted | what it did | why it is gone |
|---|---|---|
| `93a6263` → `10bb845` | standalone Hand drew its clock BESIDE the mark | owner did not want the Hand message redrawn |
| `8b205b0` → `ebadfdb` | live recording meter scrolled instead of stepping | owner reverted without stating a reason |

The Hand-timestamp problem it was fixing was solved differently — see "unhandable" below.

## Closed today

### `D6` — an iPhone plays an Android voice note. RESOLVED.

Tested both directions on real hardware over a Cloudflare tunnel. **Do not reorder
`PREFERRED_MIME_TYPES`.** The premise turned out doubly wrong: iOS Safari now *records*
WebM/Opus too, so the platforms are not even producing different containers.

### Failed-send recovery — DONE and VERIFIED (`3f01fe0`, `2867798`)

Text, the Hand and Voiceys append optimistically and stay put: the placeholder becomes the
real row, or turns red with a tap-to-retry. A failed Voicey keeps its recording and can be
**played back** before retrying. Verified in Airplane Mode on a handset.

⚠ **Wifi-off is not an offline test on a phone** — it falls back to mobile data and the
tunnel is a public address. Use Airplane Mode. One test passed vacuously this way.

Still unpersisted by design: a refresh loses a pending send. The durable outbox is the
follow-up.

### iOS recording quality — CLOSED, and the decision is final

Went from 1/5 against a Galaxy's 5/5 to "definitely better". The fix was to **stop
describing the capture**: `C20` disabled DSP, and on iOS `echoCancellation: false` is the
master switch that moves capture off Apple's voice-processing unit. See the §6.1 amendment
block in `voiceNotes.js`.

⚠ **THE RULE:** every time we described the capture we wanted, iOS gave us something worse
than if we had not asked. First `echoCancellation`, then the sample-rate and channel hints.
`C20` is unchanged on every other platform, where the raw path measures well.

⛔ **OWNER DECISION: the capture is finished.** No EQ, shelf, gate or gain stage. The
residual hiss is accepted as the cost of a browser microphone; the quality question is
deferred to a native build if one ever happens. Both `noiseSuppression` and the WebAudio
bypass were tried and measured as dead ends — do not re-attempt them.

### Waveform v2 — a new payload format (`dc05312`)

v1 stored 56 buckets **whatever the note's length**, so a bar was 54ms on a 3s note and
536ms on a 30s one. Every long note converged on the same shape.

v2 buckets by TIME (~32ms), takes the loudest 4ms window inside each bucket, stores 8-bit
amplitudes as base64, and downsamples to bars by MAX. Measured: a 30s note went from 7
distinct drawn levels to 13, and from 3 bars on the floor to 0.

⚠ Two obvious fixes were measured and REJECTED — recorded so they are not retried:
peak-instead-of-RMS at 56 buckets made it *worse* (sd 0.179 → 0.170), and more bars alone
made it smoother, not livelier. They only work together.

⚠ **BOTH READ PATHS ARE PERMANENT.** Peaks are frozen at record time, so every Voicey
recorded before v2 carries only v1 and can never be upgraded. The branch in `VoiceMessage`
is the permanent shape of the code. **Nothing improves an existing note.**

### Voicey layout — grows to 20s, then compresses (`0161bb5`)

Like a text bubble. A bar is a fixed slice of time (625ms) and a fixed width (3.5px), so:

| note | bars | bubble | % of a 360px screen |
|---|---|---|---|
| 8s | 13 | 151px | 42% |
| 18s | 29 | 231px | 64% |
| 20s | 32 | 246px | **68% — ceiling** |
| 45s / 3min / 6min | 32 | 246px | same width, denser |

`MS_PER_BAR` is derived as `GROWTH_MS / DISPLAY_BARS` so the two cannot disagree.

Known limit: at 625ms per bar everything under ~5s lands on the 8-bar floor, so a 1s and a
3s note are the same size. Growth range and short-note resolution trade directly.

### The Yes badge — one layout contract (`37e7a7e`)

Every message renders inside `.yp-msg-frame`. The frame carries the 76% cap and shrink-wraps,
so its box IS the message's outer box **by definition rather than by measuring any kind's
rendering** — the anchor is semantic, and a new kind inherits placement by being rendered.

The badge is a sibling of the bubble inside that frame, positioned only from `index.css` by
custom properties. Verified identical for text/voice/bare, sent and received: 27×27,
left −22, bottom +6, never escaping its row, never covered.

⚠ One `z-index` survives, on the badge, ordering siblings inside one frame. It is needed
because a Voicey's `backdrop-filter` makes its bubble a stacking context. Hit-tested:
`z-index: 999` on the mark alone still loses — only raising the row/frame works.

### A standalone Hand cannot be given a Yes (`1bae82c`)

A Hand IS a Yes. `UNHANDABLE_KINDS` is an **allow-by-default** list — every other kind,
including ones not yet written, inherits the double-tap. Two gates: the gesture is refused,
AND an existing badge is hidden (rows handed before this still carry the state). The data is
untouched in the database, just not drawn.

## Open

1. **SEC-1** — `notifications` accepts unrestricted INSERT from any authenticated user.
   Deployment prerequisite.
2. **`expire_held_notifications()` is never called**, so N4 is inert.
3. **Durable outbox** — so a refresh does not lose a pending send. Optional.
4. **The "charged Hand"** — designed, not built, and the owner parked it mid-conversation.
   ⚠ Worth knowing: `payload.scale` (1–3), `handScale()` and `HandMessage`'s
   `HAND_BASE_PX * scale` **already exist** for exactly this — the comment says "a future
   press-and-hold will send something bigger". Only the input is missing. The design
   discussion concluded charge should map to SCALE, or holding buys nothing.

## Traps this session actually fell into

- ⚠ **The 360px handset is the binding constraint, not desktop.** Caught me twice. The
  Voicey player there is far tighter than desktop's, so anything sized against desktop
  overflows a phone silently.
- ⚠ **Inline styles beat media queries.** Four separate changes caught by this. Anything a
  breakpoint must reach lives in `index.css`.
- ⚠ **Measuring an animating element gives wrong numbers.** The Yes badge measured 5.4px
  mid-`ypYes` and produced a false "does not escape the row". Suppress the animation or wait.
- ⚠ **`npm test` says nothing about whether the CSS parses.** A broken stylesheet failed the
  build while 202 tests passed green.
- ⚠ **Peaks are normalised at record time**, so the stored waveform cannot answer any
  question about absolute loudness. Nearly used as evidence in the iOS investigation.
- ⚠ **Do not state an unpushed count without measuring it.** Reported "24" and "26" when the
  real figures were 1 and 2, and spent several turns urging a push of a backlog that did not
  exist.

## Needs the owner's eyes

Nothing below has been seen by anyone — the composer and thread are behind auth, so every
value is measured or reasoned, never watched:

- a **freshly recorded** Voicey for the v2 waveform (existing notes keep their old shape)
- a short note beside a long one, for the growth/compression contrast
- the live recording meter at its 34px height with the perceptual curve
- the Yes badge on a handed message directly above a Voicey

## How to run it on a phone

The mic does not appear over `http://192.168.1.239:5173` — phones block microphone access on
insecure origins. **This is not a bug; do not "fix" it in code.**

```
npx cloudflared tunnel --url http://localhost:5173
```

**Command Prompt, not PowerShell** (execution policy blocks `npx.ps1`). `vite.config.js`
already allows those hosts. A deploy is **not** required — HTTPS is, and the tunnel provides
it. Deployment remains parked.

`v2/public/mic-check.html` is a diagnostic that measures peak/RMS/noise-floor/SNR from the
real capture path. Kept because it is the fastest way to compare a native build against this
one, but it is an unauthenticated page that opens the microphone — **delete it before any
public launch.**

## Constraints that will bite if you don't know them

- **Never open `conversation_read_state` for reading.** Receipts come from
  `conversation_receipts(uuid)`, one aggregate row. The sender learns *when*, never *who*.
- **Receipts use Broadcast, not `postgres_changes`.** Row-change events respect RLS and the
  sender cannot read the recipient's row. Don't reintroduce the 15s poll.
- **`ConversationDock` is mounted on every screen** and is the only thing that hears a
  message wherever the user is. A guard limiting it to docked tabs broke Delivered twice.
- **The EQ glyph must never loop.** `animation-iteration-count: 3`, and React strips the
  class after 1300ms.
- **`KIND_MATERIAL` overrides the bubble.** If a Voicey looks wrong, look in
  `lib/messageKindList.js` first — it is spread last and silently wins.
- **Migrations are applied by hand by the owner, in the SQL editor.** Never suggest
  `supabase db push`. The editor has no JWT, so verification blocks must impersonate with
  `SET LOCAL request.jwt.claims` or they pass vacuously.
- **Deployment is parked.** `yespleez.pages.dev` serves the legacy HTML prototype.

## Testing caveat

`94a88288` owns most profiles. Messaging between two profiles you both own will never show
Delivered or Read — both exclude your own user id, correctly. A genuine second account is
required, and the owner has one.
