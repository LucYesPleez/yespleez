# M9s — Voicey pill · manual verification checklist

**Status: NOT YET RUN.** M9s is committed but must not be considered complete until this
passes.

**This replaces `verification-m9g-recorder.md`, which is deleted.** That document described
press-and-hold with a drag: hold the microphone, drag it sideways into a dock to lock, drag
it down to discard. None of that exists. It was also already stale when it was deleted — its
§1 and §2 described an even earlier model (up to lock at 56 px, left to cancel at 80 px)
that had been superseded by the dock. Two generations of gesture documentation for a control
that is now a toggle.

Run in a conversation with the composer empty — the pill only appears when there is no draft.

---

## The one that matters most

Every other row here is a feature. This one is the failure that leaves a **live microphone**
with nothing on screen to explain it — the user cannot make it stop, and has no reason to
trust the app afterwards.

**Watch the browser's recording indicator** (Chrome: the red dot in the tab and the
microphone icon in the omnibox) after every single exit in §3. It must go out **every time**.

---

## 1 · The toggle

The microphone slides between the two ends of its pill. **Left is recording, right is rest.**
There is no hold, no drag, and no lock.

| # | Do | Expect |
|---|---|---|
| 1.1 | Press the pill | Mic slides **left**, panel turns cyan, timer counts from 0:00, red dot pulses |
| 1.2 | Press it again | Mic slides **right** · **nothing sends** · centre reads the duration and "Ready to send" |
| 1.3 | From that pending state, press **Send** | `Sending…` then `Sent`, then back to an empty composer |
| 1.4 | While recording, press **Send** directly | Sends without passing through pending |
| 1.5 | While recording, press **Discard** (left of the row) | Nothing sends · returns to idle |
| 1.6 | While **pending**, press **Discard** | The parked note is gone · returns to idle |
| 1.7 | While **pending**, press the pill again | Starts a NEW recording · the old note is discarded |
| 1.8 | Press anywhere on the pill, including the waveform end | Toggles — the whole pill is the button, not just the mic |
| 1.9 | Toggle on and straight off (under 0.4 s) | Nothing parks · notice reads **"Too short to send"** |

**1.2 is the whole point of this release.** If stopping ever sends, the pending state has
collapsed back into the old hold model and there is no way to review a note before it goes.

## 2 · Nothing reflows

| # | Do | Expect |
|---|---|---|
| 2.1 | Watch the composer as recording starts | **Nothing changes height or width.** The mic moves; the row does not |
| 2.2 | Watch as it stops to pending | Same — the centre slot swaps content, not size |
| 2.3 | Type text while idle | The pill **disappears**; Send replaces the Hand |
| 2.4 | Clear the text | The pill returns, at rest |
| 2.5 | Reduced-motion enabled at OS level | The mic still **arrives** at the other end — it just does not animate there |
| 2.6 | Look at the microphone at rest, then recording | Neutral border → brand gradient **filled**. Colour only appears when it is actually recording |
| 2.7 | Watch the waveform as recording starts | Bars enter at the **RIGHT** edge and travel **left**. The live edge never moves |
| 2.8 | Compare the Hand on the bar with a Hand in the thread | Same brightness. Both are `--yp-hand-ink` |

Verified agent-side already: pill 84×46 in both states, microphone 46×46 flush to the pill's
top and bottom to the pixel, 38 px of travel, and `aria-pressed` tracking the state.

**2.7** was verified in the DOM rather than by eye — drawn bars occupied indices 37–41, then
28–41, then 19–41 of 42, with the right edge always live and the left edge never. **2.8** was
verified as computed colour: both hands resolve to `rgb(213,213,215)`, where the thread's
previously resolved to `rgb(232,232,240)`.

## 3 · Exit paths — **check the mic indicator after each**

| # | Do | Expect |
|---|---|---|
| 3.1 | Record, then toggle off | Mic released |
| 3.2 | Record, then Send | Mic released |
| 3.3 | Record, then Discard | Mic released |
| 3.4 | Record, then press **Escape** | Discards · mic released |
| 3.5 | **Pending**, then press Escape | Parked note discarded · nothing was holding the mic, confirm it is still off |
| 3.6 | Record, then **Alt-Tab / click another window** | **Still recording** — deliberate, see note |
| 3.7 | Record, then **close the drawer** | Mic released |
| 3.8 | **Pending**, then close the drawer | Parked note is gone · nothing sends |
| 3.9 | Record, then **navigate to another tab** in the app | Mic released |
| 3.10 | Record, then reload the page mid-recording | Mic released |

**3.6 is a deliberate change from M9g.** Blur used to cancel an unheld recording, because a
pointer gesture could not complete once the window was gone and `pointerup` might never
arrive. A toggle has no such dependency — it is hands-free by construction, which is exactly
what lock used to buy. A notification stealing focus must not destroy a recording.

## 4 · The startup gap

| # | Do | Expect |
|---|---|---|
| 4.1 | Press the pill and, **before granting permission**, press it again | Recording does **not** start · no microphone left open |
| 4.2 | Repeat 4.1 on a device with a slow microphone | Same |

**This is the defect the machine tests exist for.** `phase` is still `idle` for the whole
permission prompt, so without the `starting` guard the second press opens a second recorder
that nothing holds a reference to. Covered by `voiceMachine.test.js`, and mutation-checked —
but the browser is where it would actually bite.

## 5 · Failure paths

| # | Do | Expect |
|---|---|---|
| 5.1 | Deny microphone permission, then press | Notice: "Microphone access was declined" · returns to idle |
| 5.2 | Record with the network off, then Send | Error surfaces · state returns to **idle**, not a stuck "Sending…" |
| 5.3 | Browser with no MediaRecorder | **No pill at all** — never a control that cannot work |
| 5.4 | Hold past **5:45** | Amber dot · "0:15 left" countdown appears |
| 5.5 | Hold past **6:00** | **Stops and SENDS.** Never discards, and never stops to pending |

**5.5:** an unattended recording that hits the ceiling should complete, not wait for a press
that may never come.

---

## Already verified (agent side)

- Pill geometry in a real browser at mobile width, both states — see §2.
- **5.1** — permission denied surfaces the notice and returns the pill to rest.
- The transition table: 18 tests in `voiceMachine.test.js`, including the startup-gap guard,
  mutation-checked by reordering the guard and confirming the test fails.
- `isTooShort` rejects a non-finite duration — found by the test, not by review.
- Build, lint and the full 125-test suite.

## Known not covered

- **Any real recording.** The microphone is blocked in the agent's preview browser, so
  nothing past `getUserMedia` has been exercised: no capture, no pending note, no send, no
  duration, no waveform. §1 in its entirety is unverified.
- **iOS Safari.** `touch-action` and the hold-callout suppression that the old gesture needed
  are gone, which should make iOS *easier*, but none of it has been exercised.
- **`D6` — the playback matrix.** Whether an Android-recorded WebM/Opus note plays in an
  `<audio>` element on iOS. Still open from M9f; cheap to change now, expensive once a corpus
  of recordings exists.
