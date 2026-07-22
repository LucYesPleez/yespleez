import test from 'node:test';
import assert from 'node:assert/strict';
import { barHeight, barCapacity } from './liveWaveform.js';


/* ── bar height is perceptual ───────────────────────────────────────── */

test('⚠ a normal speaking voice uses a real share of the meter', () => {
  // The bug this fixes: level() delivers ~.22–.55 for ordinary speech, and drawn
  // linearly on a 22px row that was 5–12px — reported as "barely shows" from a
  // real handset. The curve must lift those into the visible middle.
  const H = 34;
  const quiet = barHeight(0.22, H);
  const loud  = barHeight(0.55, H);

  assert.ok(quiet > 0.3 * H, `a quiet voice should clear a third of the meter, got ${(quiet / H).toFixed(2)}`);
  assert.ok(loud  > 0.6 * H, `a normal voice should clear .6 of the meter, got ${(loud / H).toFixed(2)}`);
  assert.ok(loud < H, 'and must leave headroom above it');
});

test('a shout still reaches the top, and nothing exceeds it', () => {
  // 1 maps to 1 for any exponent, so the curve cannot cost the meter its range.
  assert.equal(barHeight(1, 34), 34);
  assert.equal(barHeight(2, 34), 34, 'out of range clamps rather than overflowing the row');
});

test('silence draws a short bar, never a gap', () => {
  // A hole in the row would read as a hole in the recording.
  assert.equal(barHeight(0, 34), 2);
  assert.equal(barHeight(-1, 34), 2);
  assert.equal(barHeight(NaN, 34), 2, 'a missing sample must not become NaNpx');
  assert.equal(barHeight(undefined, 34), 2);
});

test('louder always draws taller', () => {
  // Monotonic, or the meter would misreport which of two moments was louder.
  let prev = 0;
  for (let v = 0; v <= 1; v += 0.05) {
    const h = barHeight(v, 34);
    assert.ok(h >= prev, `height went backwards at ${v.toFixed(2)}`);
    prev = h;
  }
});

/* ── the scrolling strip's geometry ─────────────────────────────────── */

test('the strip holds two spare bars, so neither edge gaps mid-slide', () => {
  // One bar is leaving on the left and one entering on the right at any moment.
  // With an exact fit the strip would show a gap at the right edge for the
  // duration of every slide — visible as a flicker seventeen times a second.
  assert.equal(barCapacity(100, 5), 22);   // 20 fit exactly, +2
  assert.equal(barCapacity(102, 5), 23);   // 20.4 → 21 visible, +2
});

test('a strip with no width asks for no bars', () => {
  // The composer's field is measured on mount and can legitimately be zero
  // before layout has run. Building bars against that would fill the strip with
  // elements that are never used and never cleaned up.
  assert.equal(barCapacity(0, 5), 0);
  assert.equal(barCapacity(-10, 5), 0);
  assert.equal(barCapacity(100, 0), 0);
  assert.equal(barCapacity(NaN, 5), 0);
  assert.equal(barCapacity(undefined, undefined), 0);
});

test('⚠ the bar width agrees between CSS and the component', async () => {
  // The component translates the strip by exactly one pitch per sample, and the
  // pitch is built from BAR_W. The width itself is set in index.css, because a
  // bar is styled there like everything else. Nothing at runtime notices when
  // the two disagree — the strip simply slides by the wrong distance every tick
  // and the motion stutters, which reads as a performance problem rather than as
  // a mismatched constant.
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../components/LiveWaveform.jsx', import.meta.url), 'utf8');

  const cssWidth = Number(css.match(/\.yp-live-bar\s*\{[^}]*width:\s*(\d+)px/s)?.[1]);
  const jsWidth = Number(view.match(/const BAR_W\s*=\s*(\d+)/)?.[1]);

  assert.ok(Number.isFinite(cssWidth), '.yp-live-bar has no width in index.css');
  assert.ok(Number.isFinite(jsWidth), 'BAR_W is missing from LiveWaveform.jsx');
  assert.equal(jsWidth, cssWidth, 'the strip would slide by the wrong distance every sample');
});

test('⚠ bars must never flex', async () => {
  // `flex: 1` is what the old stepping meter used, and it is incompatible with
  // scrolling: bars would share the container's width, so the pitch would change
  // with the container and the translate distance would stop being correct.
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  const rule = css.slice(css.indexOf('.yp-live-bar'), css.indexOf('.yp-live-bar') + 400);
  assert.match(rule, /flex:\s*none/, 'a flexing bar has no fixed pitch to translate by');
});
