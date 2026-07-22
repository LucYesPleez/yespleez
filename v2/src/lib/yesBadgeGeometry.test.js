import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * THE YES BADGE IS DEFINED IN TWO PLACES, AND THEY MUST AGREE.
 *
 * `index.css` owns the badge's anchor — the offsets, the overlap, the gutter it
 * reserves. `ConversationView.jsx` owns two of the same numbers because JS needs
 * them and cannot read a custom property: `HandIcon` takes a pixel size, and the
 * row reserves the drop as inline padding.
 *
 * Nothing at runtime notices when those drift. What the user notices is the
 * badge overlapping the message below it, or a gap under every row — the exact
 * class of fault the frame contract was built to remove. So the agreement is
 * asserted here rather than trusted to a comment.
 *
 * These read the source text on purpose. A component cannot be imported by this
 * project's test setup, and the CSS is never in a module at all.
 */

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const view = readFileSync(new URL('../components/ConversationView.jsx', import.meta.url), 'utf8');

const cssVar = name => {
  const m = css.match(new RegExp(`--yp-yes-${name}:\\s*(\\d+)px`));
  assert.ok(m, `--yp-yes-${name} is missing from index.css`);
  return Number(m[1]);
};

const jsConst = name => {
  const m = view.match(new RegExp(`const ${name}\\s*=\\s*(\\d+)`));
  assert.ok(m, `${name} is missing from ConversationView.jsx`);
  return Number(m[1]);
};

test('⚠ the badge size agrees between CSS and JS', () => {
  assert.equal(jsConst('YES_SIZE'), cssVar('size'),
    'HandIcon would draw at a different size than the box reserved for it');
});

test('⚠ the reserved drop agrees between CSS and JS', () => {
  // The row pads by YES_DROP; the badge drops by --yp-yes-drop. If the padding
  // is the smaller of the two the badge escapes its row and lands on the next
  // message, which is the fault this whole contract replaced.
  assert.equal(jsConst('YES_DROP'), cssVar('drop'),
    'the badge would escape its own row, or the row would reserve dead space');
});

test('the overlap stays inside every kind\'s padding', () => {
  // The badge may only intrude as far as the narrowest bubble padding, or it
  // reaches content: text, the clock, the EQ receipt, a Voicey's play button.
  // The tightest non-bare padding in KIND_SHAPE is the default 12px 16px, and a
  // Voicey's is 15px 17px — so the horizontal floor to respect is 16px.
  const overlap = cssVar('overlap');
  assert.ok(overlap >= 4 && overlap <= 6, `owner specified 4-6px, found ${overlap}`);
  assert.ok(overlap < 16, 'the badge would reach into bubble content');
});

test('⚠ no per-kind or per-direction positioning survives', () => {
  // The whole point of the frame contract. If any of these come back, the badge
  // has stopped having one anchor and the inconsistency is being rebuilt.
  assert.equal(/yp-yes-mark--mine/.test(css), false, 'a per-direction rule is back');
  assert.equal(/yp-yes-mark/.test(css), false, 'the old bubble-anchored mark is back');
  assert.equal(/yp-yes-mark/.test(view), false, 'the component still renders the old mark');

  // The badge must not be positioned from the component; index.css owns it.
  const badge = view.slice(view.indexOf('yp-yes-badge'), view.indexOf('yp-yes-badge') + 400);
  assert.equal(/bottom:|left:|right:|position:/.test(badge), false,
    'the badge is being positioned inline again, which no breakpoint can override');
});

test('every message renders inside the frame, whatever its kind', () => {
  // The contract a future kind inherits by doing nothing.
  assert.ok(/className="yp-msg-frame"/.test(view), 'the frame wrapper is missing');
  assert.ok(/\.yp-msg-frame\s*\{/.test(css), 'the frame has no rule to anchor against');

  // The frame carries the width cap, not the bubble — that is what makes its box
  // the message's outer box for every kind rather than a per-kind measurement.
  const frame = css.slice(css.indexOf('.yp-msg-frame'), css.indexOf('.yp-msg-frame') + 400);
  assert.ok(/max-width:\s*76%/.test(frame), 'the frame must own the width cap');
});

test('⚠ the desktop shift is paid for by the inset', () => {
  // The badge reaches `overlap + shift` into the frame. Past the tightest bubble
  // padding it starts clipping the clock and touching a Voicey's play button —
  // measured at a 12px shift: clock -1px, play 0px. The two elements that live
  // at the bubble's bottom-left move out of the way by --yp-yes-inset instead of
  // the badge being detached, which is the owner's stated preference.
  //
  // If the shift is ever raised without raising the inset, those collisions come
  // straight back, and they come back only on desktop and only on SHORT
  // messages — the combination least likely to be noticed in testing.
  const TIGHTEST_PADDING = 16;   // KIND_SHAPE's default '12px 16px'
  const AIR = 4;

  const desktop = css.slice(css.indexOf('@media (min-width: 641px)'));
  const shift = Number(desktop.match(/--yp-yes-shift:\s*(\d+)px/)?.[1]);
  const inset = Number(desktop.match(/--yp-yes-inset:\s*(\d+)px/)?.[1]);
  assert.ok(Number.isFinite(shift) && Number.isFinite(inset), 'desktop must set both shift and inset');

  const reach = cssVar('overlap') + shift;
  const needed = Math.max(0, reach - TIGHTEST_PADDING + AIR);
  assert.ok(inset >= needed,
    `a ${shift}px shift reaches ${reach}px and needs an inset of at least ${needed}px, found ${inset}px`);
});

test('phones pay nothing for a shift they do not have', () => {
  // The base values are the phone values — mobile-first, so a handset never
  // inherits desktop's compensation for an offset it was never given.
  const base = css.slice(0, css.indexOf('@media (min-width: 641px)'));
  assert.match(base, /--yp-yes-shift:\s*0px/);
  assert.match(base, /--yp-yes-inset:\s*0px/);
});
