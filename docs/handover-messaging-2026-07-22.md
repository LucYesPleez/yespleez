# Handover — YesPleez Messaging, 2026-07-22

## `D6` — RESOLVED 2026-07-22. **An iPhone plays an Android voice note.**

Tested on real hardware, both directions, over a Cloudflare tunnel: an Android-recorded
`audio/webm;codecs=opus` note plays in iOS Safari, and the owner reports it sounds "really
good". `PREFERRED_MIME_TYPES` therefore stays as it is — **do not reorder it**, and do not
move `audio/mp4` up. The concern that Safari refuses WebM in `<audio>` is now measured and
false on current iOS, not assumed either way.

⚠ What the same test DID find, and is still open: **iOS-recorded notes sound bad**, in both
directions and worse than WhatsApp's equivalent. That is a RECORDING-side fault on Safari,
not a codec-compatibility one — playback of the same file is fine on the device that made
it. See "iOS recording quality" below.

The original entry follows, for the reasoning.

## ~~Start here: `D6` — can an iPhone play an Android voice note?~~ (resolved, above)

This is the highest-risk open item and it is **untested**. Voiceys record as
`audio/webm;codecs=opus` (see `PREFERRED_MIME_TYPES` in `v2/src/lib/voiceNotes.js`,
which falls back through ogg → mp4 → mpeg). Safari on iOS has historically refused
WebM in `<audio>`.

If it fails, a voice-first messenger is silently broken between platforms — and you
won't hear about it from users, you'll hear "I never got your voice note", months later.

**How to test it properly:** record a Voicey on an Android phone, then play it on a
real iPhone. Not a simulator, not desktop Safari. Both devices need the app over
HTTPS — the mic is invisible on the LAN address (see below).

**If it fails**, the fix is to reorder `PREFERRED_MIME_TYPES` so `audio/mp4` wins on
the recording side. Do it before there's a corpus of recordings.

## How to run it on a phone

The mic does not appear over `http://192.168.1.239:5173` — phones block microphone
access on insecure origins, so `canRecordVoice()` returns false and the composer
correctly hides the control. **This is not a bug; do not "fix" it in code.**

```
npx cloudflared tunnel --url http://localhost:5173
```

Run it in **Command Prompt, not PowerShell** (execution policy blocks `npx.ps1`).
Open the printed `*.trycloudflare.com` address on the phone. `vite.config.js` already
allows those hosts. A tunnel is a different origin, so you'll land on the sign-in screen.

## State

Branch `v2-react`, 6 commits unpushed, tree clean. 168 tests pass, build and lint clean.
Migrations M9a–M10b all applied and verified.

Messaging is feature-complete enough to test end to end: text, Voiceys, the Hand, EQ
receipts with true delivery acknowledgements, all verified live across two real accounts today.

## The remaining blockers, in order

1. **`D6`** — above. Untested, existential for a voice-first product.
2. ~~**Failed-send recovery.**~~ **DONE 2026-07-22** (`3f01fe0`, `2867798`). Text, the Hand
   and Voiceys all append optimistically and stay on the failed rung with a retry control;
   a failed Voicey keeps its recording and can be played back before retrying. Two caveats
   remain: nothing is persisted, so a **refresh still loses a pending send** (the durable
   outbox is the follow-up), and if the insert succeeds but its response never arrives you
   can briefly see both the real message and a red placeholder. **Not yet verified by eye —
   see below.**
3. **SEC-1** — `notifications` accepts unrestricted INSERT from any authenticated user.
   Documented deployment prerequisite; messaging adds `new_message` rows to that surface.
4. **`expire_held_notifications()` is never called**, so N4 is inert.

## Constraints that will bite if you don't know them

- **Never open `conversation_read_state` for reading.** Receipts come from
  `conversation_receipts(uuid)`, one aggregate row. This amends Identity §2.5 while keeping
  its actual concern — the sender learns *when*, never *who*, so a shared profile doesn't
  expose one colleague to the other party. A policy can't do this; a policy grants rows.
- **Receipts use Broadcast, not `postgres_changes`.** Forced: row-change events respect RLS
  and the sender cannot read the recipient's row, so a table subscription delivers nothing.
  Don't reintroduce the 15s poll that was removed.
- **`ConversationDock` is mounted on every screen** and is the only thing that hears a
  message wherever the user is. Delivery acks live there. A guard limiting it to docked tabs
  is what broke Delivered for two releases.
- **The EQ glyph must never loop.** It sits inches from voice notes that genuinely animate.
  Two locks: `animation-iteration-count: 3`, and React strips the class after 1300ms.
- **Inline styles beat media queries.** Anything a phone breakpoint needs to override must
  live in `index.css`, not on the element. This has caught three separate changes.
- **`KIND_MATERIAL` overrides the bubble.** If a Voicey looks wrong, look in
  `lib/messageKindList.js` first — it's spread last and silently wins.
- **Migrations are applied by hand by the owner, in the SQL editor.** Never suggest
  `supabase db push`. The editor has no JWT, so `auth.uid()` is `NULL` — verification blocks
  must impersonate with `SET LOCAL request.jwt.claims` or they pass vacuously.
- **Deployment is parked.** `yespleez.pages.dev` serves the legacy HTML prototype, not this
  app. Verify against localhost.

## iOS recording quality — OPEN

Measured 2026-07-22 on an iPhone 14 Pro. Android → iOS sounds good. **iOS → Android sounds
bad, and worse than a WhatsApp voice note recorded on the same handset.** Playback is
symmetrical and Android-recorded audio is fine on both, so the fault is in what Safari's
`MediaRecorder` is producing, not in the format or the player.

Two fixes are already in (`21efdd8`) and their effect has not yet been isolated:

- the `AudioContext` in `forceMono` was never resumed, and on iOS starts suspended — so
  until that commit the whole iOS record path ran through a graph that was not processing;
- `audioBitsPerSecond` was 32000 for every codec. That is an Opus number; Safari records
  AAC-LC, where it is audibly poor. AAC and MP3 now request 64000.

**The tell for whether a device has the fix: the live waveform moves while recording.** It
is driven by an analyser on the same context, so a still meter means a suspended context
means the fix is not loaded on that device.

Remaining hypotheses if the fault survives both, roughly in order:

1. **Safari ignores `audioBitsPerSecond`.** It is advisory and Safari has historically not
   honoured it. `C21` already stores the NEGOTIATED value in `payload.capture.bitrate` —
   read it off a real iOS note before theorising further. `context_state` is stored beside
   it for the same reason.
2. **The WebAudio downmix is degrading the signal on Safari.**
   `MediaStreamAudioDestinationNode` is a known weak spot there. Worth testing by skipping
   `forceMono` on iOS and recording the microphone stream directly — iOS generally reports
   a mono track anyway, so §6.3's guarantee costs little to give up on that platform.
   WhatsApp does not route through WebAudio at all.
3. **`C20`'s disabled DSP interacts badly with iOS.** With `autoGainControl: false` iOS can
   hand back a very quiet, thin capture. ⚠ Flipping any of those is a change to ratified
   architecture (§6.1), not a tuning decision — surface it, do not just try it.

## Manual verification required

Failed-send recovery is committed, tested and building, but **nobody has watched it
happen**. Messaging is behind auth, so it cannot be verified from a tool session. To check
it, open a conversation, turn off wifi, and send:

- a text message → should appear immediately, then turn red with "Not sent — tap to retry"
- a Hand → same
- a Voicey → same, and **the play button should still work** on the red bubble

Then turn wifi back on and tap retry on each. Each should send and settle to the normal
grey/cyan glyph. Watch for the message appearing **twice** after a retry — that would mean
the realtime echo is not being deduped, which is the one race the unit tests cover but the
real client has the final say on.

## Testing caveat

`94a88288` owns most profiles. Messaging between two profiles you both own will never show
Delivered or Read — both exclude your own user id, correctly. A genuine second account is
required, and the owner now has one.
