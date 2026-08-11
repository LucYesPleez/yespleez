import { useState, useEffect, useRef } from 'react';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { formatDuration } from '../lib/voiceNotes';
import HandIcon from './HandIcon';
import VoicePill, { PILL_WIDTH as PILL_W } from './VoicePill';
import LiveWaveform from './LiveWaveform';
import VoiceyStage from './VoiceyStage';
import { useVoiceyStage, setVoiceyStage } from '../hooks/useVoiceyStage';

/**
 * THE COMPOSER — one glass capsule, four slots, four states.
 *
 * ┌──────────────────────────────────────────────────────────┐
 * │  [ + ]   Message……………………   [ ~~|mic ]   [ hand ]         │
 * └──────────────────────────────────────────────────────────┘
 *    left        centre            pill        trailing
 *
 * ── ONE COMPONENT, NOT FOUR CONTROLS IN A ROW ────────────────────────
 *
 * The capsule is the object; the controls live INSIDE it. Before M9t each
 * element carried its own border and fill — the field was a bordered pill, the
 * buttons were separate circles — so the composer read as four things that
 * happened to be adjacent. Now one outline, one glass surface, one shadow, and
 * the controls sit in it rather than beside each other.
 *
 * The field in particular has no border or background of its own any more. It
 * is a hole in the glass, which is what stops the capsule from looking like a
 * frame drawn around a smaller frame.
 *
 * ── FOUR SLOTS THAT NEVER CHANGE COUNT ───────────────────────────────
 *
 * Every state is the SAME four slots wearing different costumes. Nothing mounts
 * or unmounts on a state change, so nothing can jump:
 *
 *   slot      idle          typing        recording      pending
 *   ────────────────────────────────────────────────────────────────
 *   left      + (disabled)  + (disabled)  discard        discard
 *   centre    field         field         timer + wave   duration
 *   pill      at rest       collapsed     live           at rest
 *   trailing  hand          send          send           send
 *
 * The pill COLLAPSES rather than unmounting when you type — width and opacity
 * to zero — because a control that vanishes on the first keystroke is the
 * abrupt layout change this redesign exists to remove. Everything else is a
 * costume change on a box that never moves.
 *
 * ── MODE IS DERIVED, NEVER STORED ────────────────────────────────────
 *
 * The recorder's `phase` is the authority. A `mode` in state would be a second
 * source of truth that can disagree with it — the exact class of bug that
 * produced a locked state with no way out.
 */

/**
 * The composer's surface, and the colour the wallpaper settles into.
 *
 * IT IS A GRADIENT, AND THAT IS DOING TWO JOBS AT ONCE.
 *
 * The message list bleeds down behind this bar, and the image's bottom now
 * rests half way up it (`COMPOSER_BLEED / 2` in ConversationView). So the top
 * half of this strip has photograph behind it and the bottom half does not.
 *
 *   .34 at the top  — light enough that the picture genuinely reads through,
 *                     which is the whole point of running it under here.
 *   .94 at the base — opaque enough to bury the line where the image ends,
 *                     so it stops behind something solid rather than in view.
 *
 * A flat fill could only ever get one of those right: light enough to show the
 * image meant showing where it stopped, and dark enough to hide that meant
 * hiding the image too.
 *
 * Legibility never depended on any of it — the capsule draws its own glass and
 * the field sits on that.
 *
 * `SCRIM_CLEAR` is the same colour at zero alpha rather than `transparent`.
 * `transparent` is rgba(0,0,0,0), so on some engines a gradient to it passes
 * through grey on the way — a faint dirty band across the image.
 */
const SCRIM_TOP    = 'rgba(11,11,15,.34)';
const SCRIM_BOTTOM = 'rgba(11,11,15,.94)';
const SCRIM_CLEAR  = 'rgba(11,11,15,0)';

/**
 * Every control in the capsule. One number governs the whole row.
 *
 * 46 → 36, to sit at the weight Messenger's composer does. At 46 with 6px of
 * inset the bar stood 88px tall, which is a lot of screen for a row you are not
 * using most of the time — and it was pushing the conversation up.
 *
 * ⚠ 36 IS THE FLOOR. Below this the microphone and Send stop being comfortable
 * touch targets on a phone, and this row is where every message is sent from.
 * The capsule around them adds its own padding, so the PRESSABLE area is a
 * little larger than the glyph suggests.
 */
const CONTROL = 36;

/** Breathing room between the glass and the controls inside it. */
const INSET = 5;

/**
 * How tall the field may grow before it starts scrolling instead.
 *
 * ⚠ THE CEILING IS THE POINT, NOT THE GROWTH. A field that grows without limit
 * eventually eats the conversation it belongs to — you end up composing into a
 * full-screen box with no sight of what you are replying to. Five lines is
 * roughly where the other messaging apps stop, and it still leaves the thread
 * readable on the shortest phone we support.
 *
 * 21px line-height × 5, plus the field's own 7px top and bottom padding. Both
 * numbers live in `.yp-composer-field`; if either changes, this does too.
 */
const FIELD_MAX_H = 21 * 5 + 14;

/*
 * ⛔ `CAMERA` AND `GUTTER` ARE GONE WITH THE CAMERA ITSELF.
 *
 * ⭐ AND THE FIELD GOT 52px BACK. The pair cost the capsule 44px of camera
 * plus an 8px gutter, which on a 360px handset took the text field from ~155px
 * to ~107px — the binding constraint the old comment called "the budget
 * spent". The capsule is now the whole row.
 *
 * ⚠ So if a second companion control is ever proposed beside the capsule, that
 * 52px is what it costs, and the 360px screen is where it has to be measured.
 */

/**
 * The bar's own padding above and below the capsule.
 *
 * ⚠ CHANGING THIS CHANGES THE COMPOSER'S HEIGHT, and `COMPOSER_BLEED` in
 * ConversationView is that height — it is how far the wallpaper runs on behind
 * this bar and where the image's bottom comes to rest. The two must move
 * together or the picture stops in the wrong place.
 */
const PAD = 8;

/** What ConversationView must bleed the message list by. Capsule + padding. */
export const COMPOSER_HEIGHT = CONTROL + INSET * 2 + 2 + PAD * 2;

export default function Composer({
  draft,
  onDraftChange,
  onSubmit,
  onRecorded,
  onPark,
  onDiscard,
  onSendHand,
  onNotice,
  sending = false,
  canWrite = true,
  placeholder,
  inputRef,
  onInputEvent,
  // Absent = no photo sending on this mount. The camera dims itself rather
  // than throwing on tap, so a caller that has not wired this up gets a
  // visibly-unavailable control instead of a broken one.
  onPickImage,
  // Absent = no document sending. Same contract as `onPickImage`: the attach
  // menu offers only the rows its handlers exist for.
  onPickFile,
}) {
  const rec = useVoiceRecorder({ onRecorded, onNotice, onPark, onDiscard, disabled: !canWrite || sending });

  const hasText = Boolean(draft.trim());
  const busy    = rec.busy;

  // Attaching is available for the same reasons writing is, and never during a
  // recording — the + is wearing its discard costume then, and a picker taking
  // over the screen would leave a live microphone running behind it.
  const canAttach  = canWrite && !sending && !busy && Boolean(onPickImage || onPickFile);
  const [attachOpen, setAttachOpen] = useState(false);

  // The menu must not survive its own preconditions. A recording started from
  // the pill while the menu is open would otherwise leave it floating over a
  // composer whose + now means "discard".
  useEffect(() => {
    if (!canAttach || rec.active) setAttachOpen(false);
  }, [canAttach, rec.active]);

  // Derived. See header.
  const mode =
    rec.phase === 'recording' ? 'recording'
    : rec.phase === 'pending'   ? 'pending'
    : hasText                   ? 'typing'
    : 'idle';

  // The centre belongs to the voice note from the moment recording starts until
  // the "Sent" dwell ends — one continuous story in one place.
  const showVoiceSlot = rec.active || busy || rec.phase === 'sent';

  // Collapsed while typing, and while the note is on its way — in both cases
  // starting a recording is not the next thing anyone wants.
  const pillOpen = rec.supported && !hasText && !busy && rec.phase !== 'sent';

  const trailingIsSend = hasText || rec.active;

  /**
   * THE OVERSIZED STAGE. A remembered preference, raised by dragging the pill
   * upward and lowered by dragging it back down.
   *
   * ⚠ Shown only when the pill itself is available. The stage is a second face
   * for that one control, so it must not linger over a composer where the pill
   * has collapsed — mid-typing, mid-send, or where voice is unsupported. It is
   * NOT hidden while a note is parked: a parked Voicey is continued from this
   * control, and taking the big target away at that moment would be the same
   * discard-by-surprise the constitutional rule forbids.
   */
  const [stageRaised] = useVoiceyStage();
  const stageUp = stageRaised && pillOpen;

  function submit(e) {
    e.preventDefault();
    if (hasText) onSubmit?.(e);
  }

  /**
   * AUTOSIZE. Reset to `auto` first, then adopt the content's own height.
   *
   * ⚠ THE RESET IS NOT OPTIONAL. `scrollHeight` never reports less than the
   * element's current height, so measuring without collapsing it first means
   * the field can only ever grow — delete three lines and it stays three lines
   * tall, with a hole where the text was.
   */
  const fieldRef = useRef(null);

  function autosize(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, FIELD_MAX_H)}px`;
  }

  // A callback ref so the field is measured the moment it exists — including
  // when it REPLACES the voice slot, which remounts it with the draft already
  // several lines long. It also has to keep `inputRef` fed: the conversation
  // restores the caret through it.
  function setFieldRef(el) {
    fieldRef.current = el;
    if (inputRef) inputRef.current = el;
    autosize(el);
  }

  // Every change of the text, from any source. Typing is the obvious one; a
  // restored draft and a cleared-on-send field are the ones that break if this
  // is wired to the keystroke instead of the value.
  useEffect(() => { autosize(fieldRef.current); }, [draft]);

  /**
   * ENTER. ⚠⚠ THE ONE BEHAVIOUR A TEXTAREA SILENTLY TAKES AWAY.
   *
   * An `<input>` in a form submits on Enter for free. A `<textarea>` inserts a
   * newline instead — so the swap alone would have quietly broken sending by
   * keyboard for every desktop user, with no error and nothing to see.
   *
   * ⭐ THE RULE IS THE KEYBOARD, NOT THE SCREEN SIZE. Where there is a real
   * keyboard, Enter sends and Shift+Enter makes a new line — what every desktop
   * chat client does. On a touch keyboard Enter must make a new line, because
   * its Enter key is the ONLY way to get one and sending is a visible button
   * right there. Deciding this on width would get a tablet with a keyboard
   * wrong in both directions.
   */
  function onFieldKeyDown(e) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const hasKeyboard = typeof matchMedia === 'function'
      && matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (!hasKeyboard) return;          // touch: Enter is a new line
    e.preventDefault();
    if (hasText && !sending) onSubmit?.(e);
  }

  return (
    <form
      onSubmit={submit}
      style={{
        padding: `${PAD}px 12px`, flexShrink: 0,
        position: 'relative',   // anchors the fade above
        // The form IS the row: camera, then capsule. A wrapper div would have
        // been a second box doing one box's job. The fade below is absolutely
        // positioned, so it stays out of flow and is not a flex item.
        // ⚠ `flex-end` for the same reason the capsule uses it: the capsule
        // GROWS now, and a centred camera drifts to the middle of a five-line
        // message instead of staying level with the controls it belongs with.
        // Identical at one line, where both boxes are the same height.
        // No `gap`: the capsule is the row's only child now that the camera
        // has gone, so there is nothing left to space it from.
        display: 'flex', alignItems: 'flex-end',
        background: `linear-gradient(180deg, ${SCRIM_TOP} 0%, ${SCRIM_BOTTOM} 100%)`,
      }}
    >
      {/* ⚠ THE FADE HAS TO SIT ABOVE THIS ELEMENT, NOT INSIDE IT.

          The wallpaper is painted on the message list and simply STOPS where
          the list ends — which is exactly where this form begins. A gradient
          running from transparent at the form's own top therefore starts AT the
          boundary, so the image still cuts off against it in a dead straight
          line. That was the first attempt, and the line survived it.

          This strip is anchored to `bottom: 100%`, so it lives in the 76px
          ABOVE the composer, over the last of the image, fading from the
          composer's exact colour up to nothing. The boundary is now inside a
          gradient rather than at the end of one.

          `pointer-events: none` so it cannot swallow taps on the last message
          it covers. */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute', left: 0, right: 0, bottom: '100%', height: 76,
          // Closes on SCRIM_TOP, which is what the composer opens with — the
          // two meet at the same value so the join is invisible. Ending on any
          // other alpha would draw a line exactly where this exists to avoid one.
          background: `linear-gradient(to top, ${SCRIM_TOP}, ${SCRIM_CLEAR})`,
          pointerEvents: 'none',
        }}
      />
      {/* ── THE OVERSIZED STAGE · behind everything in this row ─────────
          Mounted FIRST so it paints under the controls in DOM order, and it
          carries the only z-index in here. It never unmounts while the pill is
          available: the raise and lower are an animation on a permanent
          element, so the row cannot jump when the stage moves. */}
      <VoiceyStage
        raised={stageUp}
        recording={mode === 'recording'}
        parked={mode === 'pending'}
        disabled={!canWrite || sending}
        getLevel={rec.getLevel}
        onToggle={() => void rec.toggle()}
      />

      {attachOpen && !rec.active && (
        <AttachMenu
          onClose={() => setAttachOpen(false)}
          onPickImage={onPickImage}
          onPickFile={onPickFile}
        />
      )}

      {/* ⛔ THE CAMERA IS GONE (owner, 2026-08-11).
          It stood beside the capsule and opened the rear camera directly with
          `capture="environment"`. Removed on instruction.

          ⚠ TAKING A PHOTO IS STILL POSSIBLE, just no longer one tap: the `+`
          menu's "Upload image" uses `accept="image/*"` with no `capture`, and
          both mobile platforms offer "Take Photo" in the chooser that opens.
          What was lost is the shortcut, not the capability — worth knowing
          before anyone "restores" it by adding capture to that row, which
          would instead REMOVE the library.

          The row is now one object: the capsule, full width. */}
      <div
        className="yp-composer"
        // Drives the capsule's recording accent, and gives the state one
        // inspectable name rather than leaving it implied by which children
        // happen to be mounted.
        data-state={mode}
        // ⚠ THE CAPSULE IS A FLEX ITEM NOW. `minWidth: 0` is load-bearing, not
        // decoration: a flex item's default `min-width: auto` floors it at its
        // content's min-content width, so without it the row OVERFLOWS a 360px
        // handset instead of the field giving way. Same trap `.yp-slot-collapse`
        // documents one slot down.
        style={{
          flex: 1, minWidth: 0,
          display: 'flex', gap: INSET,
          // ⚠ `flex-end`, NOT `center`, now that the field can grow. Centred
          // controls drift down the capsule as the text gets taller, so the
          // microphone ends up level with the middle of a paragraph. Anchored
          // to the bottom they stay where the thumb left them — and at one line
          // the two are identical, because everything is the same height.
          alignItems: 'flex-end',
          padding: INSET, boxSizing: 'border-box',
          /**
           * ⚠ 24, NOT 999, AND IT LOOKS THE SAME AT REST. At the resting 48px
           * height CSS was already clamping 999 to 24. But the capsule can be
           * 120px tall now, where 999 would resolve to 60 and turn the sides
           * into semicircles — a paragraph in a stadium. Stating the resolved
           * number keeps the resting shape exactly as it was and stops it
           * rounding further as it grows. Same reasoning as VoiceyStage's
           * RADIUS.
           */
          borderRadius: 24,
          // ⚠ FLOATS ON TOP OF THE STAGE. A positioned element paints above
          // static siblings regardless of source order, so without an explicit
          // layer here the stage would cover the entire row it sits behind.
          position: 'relative', zIndex: 1,
        }}
      >
        {/* ── LEFT · attach, or discard ───────────────────────────────
            ONE button, two costumes, like the trailing one. A separate discard
            that appeared beside a separate + would change the slot count
            mid-recording and shove the field sideways.

            THE + IS LIVE AS OF M12. It opens the attach menu — a photo from the
            library, or a document. It was disabled for as long as `image` and
            `file` had no client implementation, on the principle that a
            working-looking control which does nothing is worse than one that
            admits it is not ready. That is no longer true, and the layout did
            not change when it became true, which was the point of reserving the
            slot. */}
        <button
          type="button"
          onClick={
            rec.active ? () => void rec.discard()
            : () => setAttachOpen(o => !o)
          }
          disabled={!rec.active && !canAttach}
          aria-label={
            rec.active
              ? (mode === 'pending' ? 'Discard voice message' : 'Discard recording')
              : 'Attach a photo or file'
          }
          aria-expanded={rec.active ? undefined : attachOpen}
          aria-haspopup={rec.active ? undefined : 'menu'}
          title={rec.active ? undefined : 'Attach'}
          className={`yp-ctl yp-tap44 ${rec.active ? 'yp-ctl-danger' : 'yp-ctl-attach'}${attachOpen && !rec.active ? ' yp-ctl-attach-on' : ''}`}
          style={{ width: CONTROL, height: CONTROL }}
        >
          {rec.active ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
              <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 5v14" /><path d="M5 12h14" />
            </svg>
          )}
        </button>

        {/* ── CENTRE · the hole in the glass ──────────────────────────
            No border and no background: the capsule already draws the surface,
            and a second outline here is what made the old composer read as a
            frame inside a frame. Both costumes share one box, so swapping them
            costs no layout. */}
        {showVoiceSlot ? (
          <VoiceSlot rec={rec} phase={rec.phase} />
        ) : (
          <textarea
            ref={setFieldRef}
            rows={1}
            value={draft}
            onChange={e => { onDraftChange(e.target.value); onInputEvent?.(); }}
            onSelect={onInputEvent}
            onKeyUp={onInputEvent}
            onBlur={onInputEvent}
            onKeyDown={onFieldKeyDown}
            disabled={!canWrite || sending}
            placeholder={placeholder}
            aria-label="Message"
            className="yp-composer-field"
            // `height` is written by the autosize effect, not by React state:
            // measuring in a render would need a second render to apply, and
            // the field would visibly lag a character behind every keystroke.
            style={{ flex: 1, minWidth: 0, height: CONTROL, maxHeight: FIELD_MAX_H }}
          />
        )}

        {/* ── PILL · collapses, never unmounts ────────────────────────
            Width and opacity to zero so typing does not pop a control out of
            the row. `overflow: hidden` on the wrapper keeps the pill's own
            geometry intact while the slot closes around it — animating the
            pill itself would squash the microphone. */}
        <span
          className="yp-slot-collapse"
          style={{
            width: pillOpen ? PILL_W : 0,
            opacity: pillOpen ? 1 : 0,
            // A zero-width flex child still gets a gap on BOTH sides, so
            // closing the slot would otherwise leave 6px of nothing behind.
            // Cancelling one gap makes the collapse land exactly closed.
            marginRight: pillOpen ? 0 : -INSET,
          }}
          aria-hidden={!pillOpen}
        >
          {rec.supported && (
            <VoicePill
              stageRaised={stageRaised}
              onRaise={() => setVoiceyStage(true)}
              onLower={() => setVoiceyStage(false)}
              recording={mode === 'recording'}
              // While a note is parked the microphone CONTINUES it rather than
              // starting over — see decideToggle. The label must match, or the
              // button promises the discard that rule exists to forbid.
              parked={mode === 'pending'}
              disabled={!canWrite || sending || !pillOpen}
              onToggle={() => void rec.toggle()}
            />
          )}
        </span>

        {/* ── TRAILING · hand, or send ────────────────────────────────
            Never unmounted, always last, so the way to finish can never be
            squeezed out by anything beside it. */}
        <button
          type={hasText && !rec.active ? 'submit' : 'button'}
          onClick={
            rec.active ? () => void rec.send()
            : hasText   ? undefined              // the form submits
            : () => onSendHand?.()
          }
          disabled={!canWrite || sending || busy}
          aria-label={
            rec.active ? 'Send voice message'
            : hasText   ? 'Send'
            : 'Send a Yes'
          }
          title={trailingIsSend ? undefined : 'Send a Yes'}
          // The Hand wears the gradient as a RING; Send wears it as a fill. Same
          // gradient — the difference is "this is ours" versus "this is the act".
          // 36×36 measured, 5px clear of its neighbour — 4px of hit area each
          // side fits. Only THIS control takes yp-tap44, not `.yp-ctl` as a
          // whole: expanding both sides of that 5px gap would overlap them.
          className={`yp-ctl yp-tap44 ${trailingIsSend ? 'yp-ctl-send' : 'yp-hand-ring'}`}
          style={{ width: CONTROL, height: CONTROL }}
        >
          {busy ? '…' : trailingIsSend ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" />
            </svg>
          ) : (
            // 38 in a 46px button, larger than it looks: the artwork is uncropped
            // so its own padding is inside the box, and `contain` fits the whole
            // image rather than the mark. ~33px of actual ink.
            <HandIcon size={30} />
          )}
        </button>
      </div>
    </form>
  );
}

/**
 * THE ATTACH MENU (M12) — what the `+` opens.
 *
 * ── TWO ROWS, TWO INPUTS, TWO `accept` VALUES ────────────────────────
 *
 * It would be fewer lines to give the + a single input accepting everything and
 * branch on the file's type afterwards. That is worse ON A PHONE, which is the
 * only place it matters: `accept="image/*"` makes iOS and Android open the
 * PHOTO LIBRARY, while a mixed accept opens the file browser, from which
 * reaching your photos is several taps and a different mental model.
 *
 * The accept value is what chooses the picker, so choosing the picker means
 * committing to a row before the tap. Hence two.
 *
 * ⚠ THIS MENU IS NOW THE ONLY ROUTE TO A PHOTO. The camera that stood beside
 * the capsule was removed (2026-08-11), so "Upload image" carries what used to
 * be a one-tap gesture. It still reaches the camera — `accept="image/*"` with
 * no `capture` makes both mobile platforms offer "Take Photo" in the chooser —
 * but it is two taps deep now, and that is the trade.
 *
 * ⛔ DO NOT "FIX" THAT BY ADDING `capture` TO THIS ROW. It would open the
 * camera directly and REMOVE the library, which is the more common of the two
 * and the reason this row exists.
 *
 * ⚠ IT STOPS ABOVE THE BOTTOM NAV. It is anchored to the composer, not to the
 * viewport, so it rises out of the + and cannot reach the nav — see the
 * constitutional rule. Nothing here uses `inset: 0`.
 */
function AttachMenu({ onClose, onPickImage, onPickFile }) {
  const ref = useRef(null);

  // Close on Escape, and on a press anywhere else. `pointerdown` and not
  // `click`: a click listener fires after the press has already begun
  // interacting with whatever is underneath, so the menu would still be open
  // during the tap that was meant to dismiss it.
  useEffect(() => {
    const onKey  = e => { if (e.key === 'Escape') onClose(); };
    const onDown = e => { if (!ref.current?.contains(e.target)) onClose(); };
    window.addEventListener('keydown', onKey);
    // Capture phase, so this runs before the + button's own onClick can toggle
    // the menu back open on the very press that closed it.
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose]);

  /**
   * ⚠ THE HD CHOICE IS MADE BY WHICH ROW YOU TAP, not by a step afterwards.
   *
   * It was briefly a confirmation sheet carrying a "Preserve original"
   * checkbox. That put one extra tap on EVERY photo — including the large
   * majority that do not want an original kept — to serve the few that do.
   * Two rows costs nothing to the ordinary case and one glance to the
   * professional one, which is the right way round.
   *
   * Each row is a separate `<input>` with its own `accept`, and that is load-
   * bearing on a phone: `image/*` opens the photo library, `audio/*` opens the
   * music picker, and a mixed accept opens a file browser from which reaching
   * either is several taps. The accept value chooses the picker, so choosing
   * the picker means committing to a row before the tap.
   */
  const rows = [
    onPickFile && {
      key: 'file', label: 'Upload file', accept: FILE_ACCEPT,
      note: 'PDF, DOC, XLS, ZIP',
      onPick: file => onPickFile(file),
      icon: (
        <><path d="M14 2H6.5A1.5 1.5 0 0 0 5 3.5v17A1.5 1.5 0 0 0 6.5 22h11a1.5 1.5 0 0 0 1.5-1.5V7z" /><path d="M14 2v5h5" /></>
      ),
    },
    onPickImage && {
      key: 'photo', label: 'Upload image', accept: 'image/*',
      // SCRNSHOT, not "screenshots": every other note is a row of all-caps
      // format tokens, and one lowercase word among them read as a caption
      // rather than as a thing the row accepts.
      note: 'JPEG, SCRNSHOT',
      onPick: file => onPickImage(file, { preserveOriginal: false }),
      icon: (
        <><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="8.5" cy="10" r="1.8" /><path d="m21 16-5.5-5.5L7 19" /></>
      ),
    },
    onPickImage && {
      key: 'photo-hd', label: 'Upload HD image', accept: IMAGE_HD_ACCEPT, hd: true,
      note: 'RAW, TIFF, PNG',
      // Drawn as a clock beside the formats. It is the one thing on this row
      // that is a PROMISE rather than a description — how long the original
      // stays downloadable — so it gets a mark of its own instead of being
      // another item in a comma-separated list.
      timer: '72h',
      onPick: file => onPickImage(file, { preserveOriginal: true }),
      icon: (
        <><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="8.5" cy="10" r="1.8" /><path d="m21 16-5.5-5.5L7 19" /></>
      ),
    },
    onPickFile && {
      key: 'audio-hd', label: 'Upload HD audio', accept: AUDIO_ACCEPT, hd: true,
      // CHZ is not a real format. It is the owner's joke for the audio crowd,
      // kept deliberately — it appears in this LABEL only and never in
      // `AUDIO_ACCEPT`, so nothing tries to match it and no picker filters on
      // it. Do not "fix" it.
      note: 'WAV, AIFF, FLAC, CHZ',
      // No hd flag: the chip is derived from the FILE in messageFiles.js, so an
      // MP3 through this row is honestly chipless and a WAV through the plain
      // file row still earns it. The row only chooses the PICKER.
      onPick: file => onPickFile(file),
      icon: (
        <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>
      ),
    },
  ].filter(Boolean);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Attach"
      className="yp-attach-menu"
      style={{
        position: 'absolute',
        // Anchored to the + : the form's own padding on the left, and clear of
        // the capsule above it.
        left: 12, bottom: '100%', marginBottom: 6,
        minWidth: 188, padding: 5, borderRadius: 16, zIndex: 30,
      }}
    >
      {rows.map(row => (
        <label key={row.key} role="menuitem" className="yp-attach-row">
          <input
            type="file"
            accept={row.accept}
            onChange={e => {
              const file = e.target.files?.[0];
              e.target.value = '';        // or the same file cannot be picked twice
              onClose();
              if (file) row.onPick(file);
            }}
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
          />
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: .82 }}>
            {row.icon}
          </svg>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block' }}>{row.label}</span>
            {/* The window and the formats are stated HERE because this is the
                last moment anything can be said about them — there is no
                confirmation step downstream to carry the detail. */}
            {(row.note || row.timer) && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 1, fontSize: 10.5, color: 'var(--muted)' }}>
                {row.note && <span>{row.note}</span>}
                {row.timer && (
                  <>
                    {row.note && <span aria-hidden="true" style={{ opacity: .45 }}>·</span>}
                    {/* Hands at 10 and 2 rather than a generic circle: at 11px a
                        clock face is only legible if the hands break the
                        outline's symmetry. */}
                    <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" />
                    </svg>
                    <span>{row.timer}</span>
                  </>
                )}
              </span>
            )}
          </span>
          {row.hd && <span className="yp-hd-chip">HD</span>}
        </label>
      ))}
    </div>
  );
}

/**
 * What the File row will accept.
 *
 * ⚠ THIS IS A CONVENIENCE, NOT THE LIMIT. `accept` only filters the picker —
 * it is trivially bypassed and means nothing on the server. The real allow-list
 * is M12's `allowed_mime_types`, enforced by the storage API against every
 * client. KEEP THE TWO IN STEP: a type offered here and refused there is a file
 * a user can choose and cannot send.
 */
const FILE_ACCEPT = [
  '.pdf', '.txt', '.csv', '.rtf',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.mp3', '.wav', '.flac', '.m4a',
].join(',');

/**
 * The HD audio row.
 *
 * ⚠ THIS IS NOT A VOICEY, AND MUST NOT BECOME ONE. A Voicey is recorded in the
 * app, compressed to Opus, capped at ten minutes, and lives in `voice-notes`.
 * This is a FILE a musician already has — a master, a demo, a rough mix —
 * uploaded byte-for-byte with no re-encoding, because re-encoding a WAV to send
 * it defeats the only reason to send a WAV.
 *
 * `audio/*` first, so a phone opens its music picker rather than a file
 * browser; the explicit extensions follow because some Android builds ignore
 * the wildcard for audio.
 */
const AUDIO_ACCEPT = ['audio/*', '.wav', '.flac', '.mp3', '.m4a', '.aiff', '.aif'].join(',');

/**
 * What the HD image row will accept.
 *
 * ⚠ THE EXTENSIONS ARE NOT DECORATION — `image/*` DOES NOT MATCH RAW. A camera
 * raw file is reported as `application/octet-stream` or as an empty type by
 * most browsers, so a wildcard alone hides exactly the files this row exists
 * for. Each vendor gets its own extension because each vendor invented its own:
 * Canon CR2/CR3, Nikon NEF, Sony ARW, Fuji RAF, Olympus ORF, Panasonic RW2,
 * Pentax PEF, Sigma X3F, and DNG where anyone adopted the standard.
 *
 * These files cannot be decoded by any browser, and that is expected here —
 * `sendOriginalOnly` stores them with no preview and the bubble draws a card.
 */
const IMAGE_HD_ACCEPT = [
  'image/*',
  '.dng', '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.srf', '.sr2',
  '.raf', '.orf', '.rw2', '.pef', '.x3f', '.raw', '.tif', '.tiff',
].join(',');

/**
 * The voice readout — the centre slot's other costume, at the field's exact
 * height so nothing around it moves when recording starts.
 */
function VoiceSlot({ rec, phase }) {
  if (phase === 'uploading' || phase === 'sent') {
    return (
      <div style={{ ...slot, gap: 8, color: 'var(--muted)', fontSize: 13 }}>
        <span style={{
          width: 8, height: 8, borderRadius: 999,
          background: phase === 'sent' ? '#3DDC84' : 'var(--muted)',
        }} />
        {phase === 'sent' ? 'Sent' : 'Sending…'}
      </div>
    );
  }

  // PARKED. A still dot, not a pulsing one: the pulse means a live microphone,
  // and reusing it here would say the thing this state exists to deny.
  if (phase === 'pending') {
    return (
      <div style={{ ...slot, gap: 10 }}>
        <span style={{ width: 9, height: 9, borderRadius: 999, flexShrink: 0, background: '#BF5FFF' }} />
        <span style={{ fontSize: 13.5, fontVariantNumeric: 'tabular-nums', color: 'var(--text)', flexShrink: 0 }}>
          {formatDuration(rec.elapsed / 1000)}
        </span>
        {/* CONTINUE — records another segment onto this same note. The user sees
            the one note simply get longer; "segments" never appears. This is
            what turns interruption recovery into "pick up where you left off". */}
        <button
          type="button"
          onClick={() => void rec.resume()}
          aria-label="Continue recording"
          style={{
            marginLeft: 'auto', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
            background: 'rgba(191,95,255,.16)', border: '1px solid rgba(191,95,255,.34)',
            color: 'rgba(240,220,255,.95)', borderRadius: 999, padding: '4px 10px',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="12" cy="11" r="4" /><path d="M12 15v3M8 21h8" />
          </svg>
          Continue
        </button>
      </div>
    );
  }

  return (
    <div style={{ ...slot, gap: 10 }}>
      <span style={{
        width: 9, height: 9, borderRadius: 999, flexShrink: 0,
        background: rec.closing ? '#FFB020' : '#FF3B5C',
        animation: 'ypPulse 1.4s ease-in-out infinite',
      }} />
      <span style={{ fontSize: 13.5, fontVariantNumeric: 'tabular-nums', color: 'var(--text)', flexShrink: 0 }}>
        {formatDuration(rec.elapsed / 1000)}
      </span>

      {rec.closing && (
        <span style={{ fontSize: 11.5, color: '#FFB020', flexShrink: 0 }}>
          {formatDuration(Math.max(0, rec.remaining) / 1000)} left
        </span>
      )}

      {/* The field becomes the recording: live audio rolling right to left, so
          the thing taking up the composer is the thing being captured. */}
      <LiveWaveform getLevel={rec.getLevel} />
    </div>
  );
}

/** The field's exact box — no surface of its own; the capsule is the surface. */
const slot = {
  flex: 1, minWidth: 0, height: CONTROL, boxSizing: 'border-box',
  display: 'flex', alignItems: 'center',
  padding: '0 4px',
};
