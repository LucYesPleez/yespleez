import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BREATH_MS } from '../lib/installCoach';
import s from './InstallSpotlight.module.css';

/**
 * THE INSTALL SPOTLIGHT — teaching one icon by lighting it.
 *
 * Shown once, on an iPhone that has not installed the app. The screen dims
 * and blurs, a soft feathered circle stays clear around the install icon in
 * the header, and a glass card a third of the way down says what the icon is
 * for. Then it gets out of the way.
 *
 * ⚠⚠ THE ICON IS NOT DRAWN HERE. It is the real InstallButton, still in the
 * header, still in its own place — this layer only removes light from
 * everything else. That is the entire idea: nothing on screen moves, nothing
 * is duplicated, and the thing the user learns to tap is the thing they will
 * tap tomorrow, in the same position. A rendered copy of the icon floating in
 * an overlay would teach a location that does not survive the overlay closing.
 *
 * ⚠ WHICH IS WHY THE LAYER IS TOUCH-TRANSPARENT. `.root` is
 * pointer-events: none, and four blocker strips fenced around the icon's box
 * put the modality back everywhere else. Taps inside that box fall straight
 * through to the header button underneath. Reverse this and the one control
 * being pointed at becomes the only one that cannot be pressed.
 *
 * ⚠⚠ PORTALLED TO document.body, FOR THE SAME REASON AS InstallSheet — and
 * this one is measured from inside the header, so the trap is easy to walk
 * into twice. `.header` carries `transform: translateX(-50%)`, which makes it
 * the containing block for any `position: fixed` descendant: a full-screen
 * overlay rendered inside it resolves `inset: 0` against a 680×54 strip.
 */

/**
 * THE LIT RADIUS, in CSS pixels from the icon's centre.
 *
 * ⚠ 86px WAS FAR TOO WIDE — owner: "reduce how far the hue glows out, that's
 * nuts". At that size the lit circle swallowed BETA and half the YESPLEEZ tag,
 * so the light was pointing at a corner of the header rather than at a
 * control. A spotlight that contains three things is not a spotlight.
 *
 * 58px is measured against the button, not chosen for looks: the icon is
 * 26px in a 42×34 button, so its furthest corner is ~21px from centre. The
 * feather runs from 40% to 100% of the radius (see the mask), which puts the
 * clear zone at 23px — just past the icon's own edge — and finishes the fade
 * by 58px, before it reaches BETA.
 */
const RADIUS = 58;

/** Padding around the icon's box for the tap-through gap. Generous on
 *  purpose: a fat-thumbed near-miss should still open the install sheet
 *  rather than being swallowed by a blocker and feeling broken. */
const TAP_PAD = 16;

/**
 * ⚠ `lit` IS A PROP, NOT STATE OWNED HERE — and it has to be. The halo in this
 * overlay and the shimmer on the icon in the header are two elements in two
 * different components, and they must rise and fall as one light. Two
 * `useBreath` calls would start at two different moments (this component
 * mounts a frame or two after the header) and drift apart from there, turning
 * one breath into a stutter. InstallButton owns the clock; both read it.
 */
export default function InstallSpotlight({ open, lit, targetRef, onDismiss }) {
  const [rect, setRect] = useState(null);

  /**
   * WHERE THE ICON ACTUALLY IS, asked of the DOM rather than assumed.
   *
   * ⚠ THE FIRST MEASUREMENT IS ROUTINELY WRONG, and silently so. The header
   * uses Bebas Neue and DM Sans; until those land, YESPLEEZ and BETA are laid
   * out in fallback metrics and everything after them sits at the wrong x.
   * The lamp would then light a patch of empty header — which looks like a
   * deliberate design choice, not a bug, so nobody would report it.
   *
   * Hence three sources, all cheap: document.fonts.ready, a ResizeObserver on
   * the button itself (catches the 480px breakpoint retuning the header's gap
   * and letter-spacing), and window resize/orientation.
   */
  useEffect(() => {
    if (!open) return undefined;

    const measure = () => {
      const el = targetRef?.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // A zero box means the header has not laid out yet; keep the last good
      // reading rather than parking the lamp at the origin.
      if (!r.width || !r.height) return;
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };

    measure();

    const ro = new ResizeObserver(measure);
    if (targetRef?.current) ro.observe(targetRef.current);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    if (document.fonts?.ready) document.fonts.ready.then(measure).catch(() => {});

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [open, targetRef]);

  /**
   * Escape dismisses, and the page behind must not scroll — the header is
   * fixed, so a scrolling page would slide the feed out from under a lamp
   * that stays put, which is exactly the "interface moves" the brief rules out.
   */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onDismiss?.(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onDismiss]);

  // Nothing is shown until the icon has been found. There is no fallback
  // position and there should not be one: a spotlight on the wrong spot
  // teaches the wrong thing, which is worse than teaching nothing.
  if (!open || !rect) return null;

  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  // The tap-through window, in viewport coordinates.
  const gap = {
    top: rect.top - TAP_PAD,
    bottom: rect.top + rect.height + TAP_PAD,
    left: rect.left - TAP_PAD,
    right: rect.left + rect.width + TAP_PAD,
  };
  const swallow = (e) => e.stopPropagation();

  return createPortal((
    <div
      className={s.root}
      role="dialog"
      aria-modal="true"
      aria-label="How to install YesPleez"
      style={{
        '--sx': `${cx}px`,
        '--sy': `${cy}px`,
        '--sr': `${RADIUS}px`,
        '--breath': `${BREATH_MS}ms`,
      }}
    >
      <div className={s.veil} />
      <div className={s.cone} />

      {/* ⚠ KEYED ON THE BREATH COUNT so React replaces the node instead of
          re-rendering it. A CSS animation does not replay when its class is
          re-applied to the same element — the browser considers it already
          running — so without a fresh node the halo would breathe once and
          then never again. */}
      <div
        key={lit ? 'breath-on' : 'breath-off'}
        className={`${s.halo} ${lit ? s.breathing : ''}`}
        aria-hidden="true"
      />

      {/* The fence. Four inert strips; the icon's box is the gap between them. */}
      <div className={s.blocker} onClick={swallow} style={{ top: 0, left: 0, right: 0, height: Math.max(0, gap.top) }} />
      <div className={s.blocker} onClick={swallow} style={{ top: gap.bottom, left: 0, right: 0, bottom: 0 }} />
      <div className={s.blocker} onClick={swallow} style={{ top: gap.top, height: gap.bottom - gap.top, left: 0, width: Math.max(0, gap.left) }} />
      <div className={s.blocker} onClick={swallow} style={{ top: gap.top, height: gap.bottom - gap.top, left: gap.right, right: 0 }} />

      {/* ⚠ TWO LINES, AND NO INSTRUCTION AMONG THEM. An earlier draft said
          "tap the ⟨icon⟩ to install" with the icon drawn inline; the owner cut
          it to this. The spotlight is already the instruction — a lit icon in
          a dark room needs no sentence explaining that it is lit, and reading
          one takes longer than looking. What is left says only WHY, which is
          the one thing light cannot say. */}
      <div className={s.message}>
        <p className={s.headline}>Install the App!</p>
        <p className={s.sub}>It’s free and feature packed!</p>

        {/* ⚠ THE ONLY BUTTON IN THE OVERLAY IS THE WAY OUT. There is no
            "Install" here — the install control is the icon we are pointing
            at, and adding a second one would answer the question the
            spotlight was asked to teach, then leave the user no better at
            finding it next time. */}
        <button type="button" className={s.later} onClick={onDismiss}>
          Maybe later
        </button>
      </div>
    </div>
  ), document.body);
}
