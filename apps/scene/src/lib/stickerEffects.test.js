/**
 * STICKER EFFECTS — the parts that must not drift.
 *
 * ⚠ The COMPOSITION cannot be tested here and pretending otherwise would be
 * worse than not testing it: canvas 2D is a browser API, and a stub that
 * records draw calls only proves the calls were made in the order this file
 * already asserts. What IS tested is everything the look depends on that is
 * pure — the stored keys, the alpha gate, the dilation geometry and the
 * metallic ramp. The pixels are verified in the browser, on real logos.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STICKER_EFFECTS, STICKER_EFFECT_KEYS, DEFAULT_STICKER_EFFECT,
  effectByKey, isStickerEffect, effectPadding,
  hasAlpha, dilationOffsets, metallicStops, enclosedRegions,
} from './stickerEffects.js';

/* ── the stored contract ───────────────────────────────────────────── */

test('the stored keys are pinned — renaming one silently un-styles every sticker', () => {
  assert.deepEqual(STICKER_EFFECT_KEYS, ['NONE', 'OUTLINE', 'PUFFY', 'METALLIC']);
});

test('the default is NONE — an effect is chosen, never assumed', () => {
  assert.equal(DEFAULT_STICKER_EFFECT, 'NONE');
  assert.equal(isStickerEffect(DEFAULT_STICKER_EFFECT), true);
});

test('an unrecognised key is not guessed at', () => {
  assert.equal(effectByKey('SHINY'), null);
  assert.equal(isStickerEffect('SHINY'), false);
  assert.equal(isStickerEffect(''), false);
  assert.equal(isStickerEffect(undefined), false);
});

test('every effect carries a label a person can read', () => {
  for (const e of STICKER_EFFECTS) {
    assert.ok(e.label && e.label.length, `${e.key} has no label`);
    assert.notEqual(e.label, e.key, `${e.key} is showing its stored key as a label`);
  }
});

/* ── padding ───────────────────────────────────────────────────────── */

test('METALLIC asks for no padding — it paints only inside the silhouette', () => {
  assert.equal(effectPadding('METALLIC', 1000), 0);
  assert.equal(effectPadding('NONE', 1000), 0);
});

test('the growing effects reserve room, or they clip against their own edge', () => {
  assert.ok(effectPadding('OUTLINE', 1000) > 0);
  assert.ok(effectPadding('PUFFY', 1000) > effectPadding('OUTLINE', 1000),
    'puffy carries a shadow as well as a band, so it needs the most room');
});

test('padding is a whole number — a fractional canvas shifts the artwork off centre', () => {
  for (const size of [37, 101, 255, 999, 1063]) {
    for (const key of STICKER_EFFECT_KEYS) {
      const p = effectPadding(key, size);
      assert.equal(p, Math.round(p), `${key} at ${size} produced ${p}`);
      assert.ok(p >= 0);
    }
  }
});

test('padding scales with the artwork, so a small logo is not swallowed by its own outline', () => {
  assert.ok(effectPadding('OUTLINE', 2000) > effectPadding('OUTLINE', 200));
});

/* ── the alpha gate ────────────────────────────────────────────────── */

/** RGBA for `count` pixels, the first `clear` of them transparent. */
function pixels(count, clear) {
  const d = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) d[i * 4 + 3] = i < clear ? 0 : 255;
  return d;
}

test('a fully opaque rectangle has no silhouette to work with', () => {
  assert.equal(hasAlpha(pixels(1000, 0)), false);
});

test('a logo on transparency passes', () => {
  assert.equal(hasAlpha(pixels(1000, 500)), true);
});

test('⛔ ONE STRAY SOFT PIXEL IS NOT A SILHOUETTE — the gate is a proportion', () => {
  // The naive "any pixel is transparent" check passes this. It must not:
  // a flat export with one anti-aliased corner is still a rectangle.
  assert.equal(hasAlpha(pixels(1000, 1)), false);
});

test('a dense logo that is mostly ink still passes — 2% is deliberately low', () => {
  assert.equal(hasAlpha(pixels(1000, 25)), true);
});

test('semi-transparent counts as transparent — a soft edge is still an edge', () => {
  const d = new Uint8ClampedArray(100 * 4);
  for (let i = 0; i < 100; i++) d[i * 4 + 3] = i < 50 ? 120 : 255;
  assert.equal(hasAlpha(d), true);
});

test('empty or malformed data fails closed', () => {
  assert.equal(hasAlpha(null), false);
  assert.equal(hasAlpha(new Uint8ClampedArray(0)), false);
  assert.equal(hasAlpha(new Uint8ClampedArray(2)), false);
});

/* ── dilation ──────────────────────────────────────────────────────── */

test('a zero radius stamps nothing — no padding means no outline', () => {
  assert.deepEqual(dilationOffsets(0), []);
});

test('⚠ THE STEP COUNT SCALES WITH THE RADIUS, or a thick outline goes polygonal', () => {
  const small = dilationOffsets(4);
  const large = dilationOffsets(40);
  assert.ok(large.length > small.length,
    'a larger radius must be stamped more often, not the same number of times');
});

test('consecutive stamps land under a pixel apart, up to the radius the cap supports', () => {
  // ⚠ Regression: the cap was 96, and radius 40 left 2.62px gaps — a visibly
  // polygonal outline on any reasonably large logo.
  for (const r of [3, 12, 40, 64, 81]) {
    const offs = dilationOffsets(r);
    const steps = offs.length / 2;            // two rings
    const gap = (2 * Math.PI * r) / steps;
    assert.ok(gap <= 1.05, `radius ${r} leaves a ${gap.toFixed(2)}px gap between stamps`);
  }
});

test('the step count is capped — a huge radius must not cost unbounded draws', () => {
  const offs = dilationOffsets(5000);
  assert.ok(offs.length <= 512 * 2, `${offs.length} draws is not a cap`);
});

test('two rings, so a concave shape does not keep an unfilled interior', () => {
  const offs = dilationOffsets(20);
  const radii = new Set(offs.map(([x, y]) => Math.round(Math.hypot(x, y))));
  assert.equal(radii.size, 2, 'expected an outer ring and a half-radius ring');
  assert.ok(radii.has(20) && radii.has(10));
});

test('every stamp sits on its ring, all the way round', () => {
  const r = 16;
  const outer = dilationOffsets(r).filter(([x, y]) => Math.round(Math.hypot(x, y)) === r);
  for (const [x, y] of outer) {
    assert.ok(Math.abs(Math.hypot(x, y) - r) < 0.01, `(${x},${y}) is off the ring`);
  }
  // All four quadrants are covered — a partial ring would outline one side.
  assert.ok(outer.some(([x, y]) => x > 0 && y > 0));
  assert.ok(outer.some(([x, y]) => x < 0 && y > 0));
  assert.ok(outer.some(([x, y]) => x > 0 && y < 0));
  assert.ok(outer.some(([x, y]) => x < 0 && y < 0));
});

/* ── the metallic ramp ─────────────────────────────────────────────── */

test('the ramp runs 0 to 1 in order — canvas throws on an out-of-order stop', () => {
  const stops = metallicStops();
  assert.equal(stops[0].at, 0);
  assert.equal(stops[stops.length - 1].at, 1);
  for (let i = 1; i < stops.length; i++) {
    assert.ok(stops[i].at >= stops[i - 1].at, 'stops must not go backwards');
  }
});

test('it starts and ends fully transparent, so the artwork is never tinted at the edges', () => {
  const stops = metallicStops();
  assert.match(stops[0].color, /,0?\.?0+\)$/);
  assert.match(stops[stops.length - 1].color, /,0?\.?0+\)$/);
});

test('⭐ THE HORIZON IS AN ABRUPT REVERSAL — a smooth ramp reads as plastic, not metal', () => {
  const stops = metallicStops();
  let found = false;
  for (let i = 1; i < stops.length; i++) {
    const gap = stops[i].at - stops[i - 1].at;
    if (gap > 0 && gap <= 0.05) { found = true; break; }
  }
  assert.ok(found, 'no tight stop pair — the gradient has no hard light-to-dark edge');
});

/* ── the enclosed interior ─────────────────────────────────────────── */

/** Build RGBA from an ASCII map: '#' opaque, '.' transparent. */
function ascii(rows) {
  const h = rows.length, w = rows[0].length;
  const d = new Uint8ClampedArray(w * h * 4);
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '#') d[(y * w + x) * 4 + 3] = 255;
  }));
  return { data: d, w, h };
}

test('⭐⭐ A POCKET INSIDE THE OUTLINE IS FOUND — that is the bit showing through', () => {
  const { data, w, h } = ascii([
    '.....',
    '.###.',
    '.#.#.',
    '.###.',
    '.....',
  ]);
  const p = enclosedRegions(data, w, h);
  assert.equal(p[2 * w + 2], 1, 'the pocket was not found');
  assert.equal([...p].filter(Boolean).length, 1, 'something other than the pocket was marked');
});

test('⛔ A GAP THAT OPENS TO THE OUTSIDE IS NOT A POCKET — between two fingers is outside', () => {
  const { data, w, h } = ascii([
    '.....',
    '.###.',
    '.#...',
    '.###.',
    '.....',
  ]);
  assert.equal([...enclosedRegions(data, w, h)].filter(Boolean).length, 0);
});

test('⛔ THE OUTLINE CANNOT MOVE — nothing opaque is ever marked', () => {
  const { data, w, h } = ascii(['.....', '.###.', '.#.#.', '.###.', '.....']);
  const p = enclosedRegions(data, w, h);
  for (let i = 0; i < p.length; i++) {
    if (data[i * 4 + 3] > 8) assert.equal(p[i], 0, `pixel ${i} would overwrite the band`);
  }
});

test('⚠ 4-CONNECTED, NOT 8 — the outside must not squeeze through a diagonal', () => {
  const { data, w, h } = ascii(['.###.', '.#.##', '##..#', '.####', '.....']);
  assert.equal(enclosedRegions(data, w, h)[2 * 5 + 2], 1,
    'the pocket drained out through a diagonal');
});

test('two separate pockets are both found', () => {
  const { data, w, h } = ascii([
    '.......',
    '.#####.',
    '.#.#.#.',
    '.#####.',
    '.......',
  ]);
  const p = enclosedRegions(data, w, h);
  assert.equal(p[2 * 7 + 2], 1);
  assert.equal(p[2 * 7 + 4], 1);
  assert.equal(p[0], 0, 'the outside was marked');
});

test('a solid block and an empty field both have nothing to fill', () => {
  assert.equal([...enclosedRegions(ascii(['####', '####']).data, 4, 2)].filter(Boolean).length, 0);
  assert.equal([...enclosedRegions(ascii(['....', '....']).data, 4, 2)].filter(Boolean).length, 0);
});

test('artwork running off the edge does not trap the whole background', () => {
  const { data, w, h } = ascii(['##..', '##..', '....']);
  assert.equal([...enclosedRegions(data, w, h)].filter(Boolean).length, 0);
});

test('a large field does not blow the stack — the flood is iterative', () => {
  const w = 400, h = 400;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 10; y < h - 10; y++) {
    for (let x = 10; x < w - 10; x++) {
      if (y === 10 || y === h - 11 || x === 10 || x === w - 11) d[(y * w + x) * 4 + 3] = 255;
    }
  }
  assert.ok([...enclosedRegions(d, w, h)].filter(Boolean).length > 100000);
});

test('malformed input returns an empty mask rather than throwing', () => {
  assert.equal(enclosedRegions(null, 4, 4).length, 16);
  assert.equal(enclosedRegions(new Uint8ClampedArray(0), 0, 0).length, 0);
});
