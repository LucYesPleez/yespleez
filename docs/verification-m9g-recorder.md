# M9g — Recorder interaction · manual verification checklist

**Status: NOT YET RUN.** M9g is committed but must not be considered complete until this
passes. Everything below is behind auth or requires a real pointer, so none of it could be
verified from the agent side.

Run in a conversation with the composer empty (the mic replaces Send when there is no draft).

---

## The one that matters most

Every other row here is a feature. This one is the failure that leaves a **live microphone**
with nothing on screen to explain it — the user cannot make it stop, and has no reason to
trust the app afterwards.

**Watch the browser's recording indicator** (Chrome: the red dot in the tab and the camera/mic
icon in the omnibox) after every single exit below. It must go out **every time**.

---

## 1 · State machine

| # | Do | Expect |
|---|---|---|
| 1.1 | Press and hold the mic | Recording bar appears **immediately**, timer counts from 0:00, red dot pulses |
| 1.2 | Release after ~2s | `Sending…` then `Sent`, then back to the plain mic |
| 1.3 | Tap the mic (under 400 ms) | Nothing sends · notice reads **"Hold to record"** |
| 1.4 | Hold, slide **left** past ~80 px | Cancels immediately · nothing sends · no error |
| 1.5 | Hold, slide **up** past ~56 px | Locks · button becomes a padlock |
| 1.6 | Once locked, **release the finger** | **Recording continues** · timer keeps counting |
| 1.7 | Locked → press **Send** | Sends normally |
| 1.8 | Locked → press **Cancel** | Discards · nothing sends |

## 2 · Gesture discipline

| # | Do | Expect |
|---|---|---|
| 2.1 | Hold still, wobble the finger a few px | **Nothing** happens — no cancel hint, no lock hint |
| 2.2 | Drag **up** to lock while drifting well left | **Locks.** The cancel hint must never light up |
| 2.3 | Drag **left** to cancel while drifting up | **Cancels.** The lock hint must never light up |
| 2.4 | After locking, swipe left across the screen | **Nothing** — horizontal movement is dead once locked |
| 2.5 | Slide **right** or **down**, far | Nothing happens; the button does not move |
| 2.6 | Drag left to ~70 px then back to origin, release | Sends normally — no partial-cancel state |

Verified in the real engine already (gesture arithmetic only, not the DOM): axis commits on a
circular 10 px dead zone, cancel at 80 px, lock at 56 px, and the committed axis is final.
2.2 and 2.3 are the ones worth being fussy about — they are the defect the axis lock exists
to prevent.

## 3 · Exit paths — **check the mic indicator after each**

| # | Do | Expect |
|---|---|---|
| 3.1 | Hold, then **release** | Mic released |
| 3.2 | Hold, then **slide left to cancel** | Mic released |
| 3.3 | Hold, then press **Escape** | Cancels · mic released |
| 3.4 | **Locked**, then press **Escape** | Cancels · mic released |
| 3.5 | Hold, then **Alt-Tab / click another window** | Cancels · mic released |
| 3.6 | **Locked**, then Alt-Tab away and back | **Still recording** — deliberate, see note |
| 3.7 | Hold, then **close the drawer** mid-press | Cancels · mic released |
| 3.8 | **Locked**, then close the drawer | Cancels · mic released |
| 3.9 | Hold, then **navigate to another tab** in the app | Cancels · mic released |
| 3.10 | Hold, drag far off the button, release outside | Cancels or sends — never hangs · mic released |
| 3.11 | Hold, then **right-click** (desktop) | No context menu · recording unaffected |
| 3.12 | Mobile: hold, then let a notification interrupt | Cancels cleanly · mic released |

**3.6 is a deliberate divergence.** Blur cancels while *unlocked* because the pointer gesture
can no longer complete and `pointerup` may never arrive. Blur does **not** cancel while
*locked* — hands-free recording that survives an app switch is the entire reason lock exists,
and a notification stealing focus must not destroy a recording in progress.

## 4 · Feel

| # | Do | Expect |
|---|---|---|
| 4.1 | Watch the composer as recording starts | **Nothing reflows.** The bar overlays the row; the input does not shift or resize |
| 4.2 | Drag slowly left and right | Button tracks the finger with no lag and no rubber-banding back |
| 4.3 | Drag on a mid-range phone | Smooth. No stutter in the timer or the button |
| 4.4 | Drag left slowly | Cancel hint fades in progressively, not on/off |
| 4.5 | Drag up slowly | Lock hint rises and brightens progressively |
| 4.6 | Hold past **5:45** | Amber dot · "0:15 left" countdown appears |
| 4.7 | Hold past **6:00** | **Stops and SENDS.** Never discards |

## 5 · Failure paths

| # | Do | Expect |
|---|---|---|
| 5.1 | Deny microphone permission, then hold | Notice: "Microphone access was declined" · returns to idle |
| 5.2 | Record with the network off | Error surfaces · state returns to **idle**, not a stuck "Sending…" |
| 5.3 | Browser with no MediaRecorder | **No mic button at all** — never a button that cannot work |
| 5.4 | Reduced-motion enabled at OS level | Recording dot stops blinking but **stays visible** |

---

## Already verified (agent side)

- Gesture arithmetic — 14 unit tests plus a run in the real browser engine: circular dead
  zone, axis commitment final, ties resolve to lock (never the destructive one), progress
  bounded 0–1 and monotonic, right/down inert.
- Build, lint and the full 84-test suite.
- Capture profile on real hardware (M9f): DSP off, stored file decodes to 1 channel, Opus,
  ~27 kbps, peaks 169 bytes.

## Known not covered

- **iOS Safari.** Pointer capture, `touch-action`, and the hold-callout suppression all
  behave differently there and none of it has been exercised.
- **`D6` — the playback matrix.** Whether an Android-recorded WebM/Opus note plays in an
  `<audio>` element on iOS. Still open from M9f; cheap to change now, expensive once a corpus
  of recordings exists.
