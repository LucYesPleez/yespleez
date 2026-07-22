# Handover — YesPleez Messaging, 2026-07-22

Rewritten at end of day. Supersedes the morning version, which described `D6` and
failed-send recovery as open; both are now closed on real hardware.

## State

Branch `v2-react`. **18 commits unpushed** (6 predate today). Tree clean.
**190 tests pass**, build and lint clean. Migrations M9a–M10b applied and verified.
No migration was needed for anything below — today was entirely client-side.

Messaging works end to end on real devices across two real accounts: text, Voiceys, the
Hand, EQ receipts with true delivery acknowledgements, and failed-send recovery.

## Closed today

### `D6` — an iPhone plays an Android voice note. RESOLVED.

Tested both directions on real hardware over a Cloudflare tunnel. An Android-recorded
`audio/webm;codecs=opus` note plays in iOS Safari and sounds good.

**Do not reorder `PREFERRED_MIME_TYPES`.** The reserve fix — moving `audio/mp4` up — is
measured as unnecessary. The premise turned out to be doubly wrong: iOS Safari now *records*
WebM/Opus too, so the platforms are not even producing different containers.

### Failed-send recovery — DONE and VERIFIED (`3f01fe0`, `2867798`).

The red `failed` rung had been built, tested and drawn since M10a with nothing setting it.
Text, the Hand and Voiceys now append optimistically and stay put: the placeholder becomes
the real row on success, or turns red with a tap-to-retry on failure. A failed Voicey keeps
its recording and can be **played back** before deciding whether to retry.

Verified in Airplane Mode on a handset: sends appeared, went red, retried cleanly.

⚠ **Wifi-off is not an offline test on a phone.** It falls back to mobile data, and the
tunnel is a public address, so everything sends normally over cellular. The first attempt
passed vacuously for exactly this reason. Use Airplane Mode.

Known gaps, both deliberate:
- Nothing is persisted — **a refresh loses a pending send**. The durable outbox is the
  follow-up, and is the thing to build if this needs to be stronger.
- If an insert succeeds but its response never arrives, you can briefly see both the real
  message and a red placeholder. Errs toward showing too much rather than losing something.

## iOS recording quality — CLOSED

Started at 1/5 against a Galaxy's 5/5 — quiet and muffled, worse than WhatsApp on the same
handset. Now "definitely better" with some hiss remaining.

**The fix was to stop describing the capture.** `C20` disabled echo cancellation, noise
suppression and gain control; on iOS `echoCancellation: false` is the master switch that
moves capture off Apple's voice-processing unit, taking its noise reduction and gain control
with it. Letting it default hands the recording back to Apple. See the §6.1 amendment block
in `voiceNotes.js` — the reasoning is written where the constants are.

**⚠ The rule that emerged, stated once so it is not rediscovered: every time we described
the capture we wanted, iOS gave us something worse than if we had not asked.** First
`echoCancellation`, then the sample-rate and channel hints. Android is the opposite — it
ignores what it cannot do and honours the rest, which is why `C20` stays exactly as ratified
on every other platform.

Ruled out along the way, each by measurement rather than argument — do not re-litigate these
without new data:

- **the codec, container, bitrate and sample rate.** iPhone and Galaxy recorded the same
  words seconds apart and produced *identical* capture: Opus, 48 kHz, 32 kbps, mono.
- **the WebAudio downmix.** Bypassed on iOS in `8a994d2`; no improvement. The bypass was
  kept anyway, being harmless and one less thing in the path.
- **the AAC bitrate.** `21efdd8` raised AAC to 64 kbps on the belief that Safari records
  AAC-LC. It records Opus. The change is correct but has never applied to an iPhone.

Also raised Opus 32 → 48 kbps, the top of §6.2's ratified range rather than the bottom. No
amendment needed; 48 was always permitted.

### The loose end — CLOSED (`82c62b4` tried it, `4f2a4df` reverted it)

`noiseSuppression: true` was requested on iOS to chase the residual hiss, committed
explicitly as a measurement, and reverted the same day. **A fresh iOS note captured with the
constraint requested still came back `noise_suppression: null`.** Safari ignores it, and
ignores `autoGainControl` too. ⚠ **Do not re-add either — this was tried and measured, not
overlooked.**

The same rows are the proof the amendment worked. `echo_cancellation` went `false` → `true`
between 04:45 and 05:01, exactly where the change deployed, and that is the recording rated
"definitely better" against 1/5 before it. `bitrate` reads `48000`. Apple's voice-processing
unit is on and its noise reduction rides along with it — there was never a second switch.

The residual hiss is gain doing its job, not absent NR: a quiet room turned up is a louder
quiet room and its noise floor becomes audible. **Nothing reachable from `getUserMedia`
changes that.**

### ⛔ OWNER DECISION 2026-07-22: STOP HERE. The capture is finished.

The iOS microphone is left exactly as it is. **Do not add EQ, a high shelf, a noise gate, a
gain stage, or any other processing to the capture or playback path.** The residual hiss is
accepted as the cost of a browser microphone, and the quality question is deferred to a
native build if one ever happens.

This closes a line of work, it is not a pause. Proposals to "just try a filter" are
re-opening a decision, and the reasoning they need to beat is in the §6.1 amendment block in
`voiceNotes.js`: hand-rolled processing has to survive whispers, shouting and every
microphone in the wild without pumping, and Apple has already done that work. Two things
were tried and measured here — a WebAudio bypass and an explicit noise-suppression request —
and both are documented as dead ends rather than untried ideas.

`v2/public/mic-check.html` is the analyser built for this investigation. It is kept because
it will be the fastest way to compare a native build against the browser one, but it is a
**diagnostic and must be deleted before any public launch** — it is an unauthenticated page
that opens the microphone.

The query that settles questions like this, for reuse:

```sql
select
  m.created_at,
  m.payload->'capture'->>'mime'        as mime,
  m.payload->'capture'->>'bitrate'     as bitrate,
  m.payload->'capture'->>'sample_rate' as sample_rate,
  m.payload->'capture'->'dsp'          as dsp
from messages m
where m.kind = 'voice'
order by m.created_at desc
limit 4;
```

⚠ Read it by platform: **iOS rows are the ones with `auto_gain: null`** (Safari does not
report what it does not implement); Chrome/Android reports `false`. That is how the two
handsets were told apart throughout this investigation.

## Remaining blockers

1. **SEC-1** — `notifications` accepts unrestricted INSERT from any authenticated user.
   Documented deployment prerequisite; messaging adds `new_message` rows to that surface.
2. **`expire_held_notifications()` is never called**, so N4 is inert.
3. **Durable outbox** — so a refresh does not lose a pending send. Optional; the visible
   failure and retry already protect the lost-enquiry case.

## How to run it on a phone

The mic does not appear over `http://192.168.1.239:5173` — phones block microphone access on
insecure origins, so `canRecordVoice()` returns false and the composer correctly hides the
control. **This is not a bug; do not "fix" it in code.**

```
npx cloudflared tunnel --url http://localhost:5173
```

Run it in **Command Prompt, not PowerShell** (execution policy blocks `npx.ps1`). Open the
printed `*.trycloudflare.com` address on the phone. `vite.config.js` already allows those
hosts. A tunnel is a different origin, so you will land on the sign-in screen.

A deploy is **not** required to test on a device — HTTPS is, and the tunnel provides it.
Deployment remains parked.

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
  live in `index.css`, not on the element. This has caught four separate changes — the
  retry control was written into the stylesheet for this reason.
- **`KIND_MATERIAL` overrides the bubble.** If a Voicey looks wrong, look in
  `lib/messageKindList.js` first — it's spread last and silently wins.
- **Peaks are normalised at record time.** `voicePeaks.js` scales every note to its own
  loudest moment, so the stored waveform **cannot** answer a question about absolute
  loudness. This was nearly used as evidence in the iOS investigation and would have been
  worthless.
- **Migrations are applied by hand by the owner, in the SQL editor.** Never suggest
  `supabase db push`. The editor has no JWT, so `auth.uid()` is `NULL` — verification blocks
  must impersonate with `SET LOCAL request.jwt.claims` or they pass vacuously.
- **Deployment is parked.** `yespleez.pages.dev` serves the legacy HTML prototype, not this
  app. Verify against localhost or a tunnel.

## Testing caveat

`94a88288` owns most profiles. Messaging between two profiles you both own will never show
Delivered or Read — both exclude your own user id, correctly. A genuine second account is
required, and the owner now has one.
