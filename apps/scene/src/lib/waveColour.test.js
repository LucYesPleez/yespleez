import test from 'node:test';
import assert from 'node:assert/strict';
import { playedAt, WAVE_STOPS, WAVE_BRIGHTNESS } from './waveColour.js';

const at = u => playedAt(u);
const near = (got, want, msg) => assert.ok(Math.abs(got - want) < 0.51, `${msg}: ${got} vs ${want}`);

/* Derived, never hardcoded. Brightness is a knob the owner will retune, and a
   test that pins literal channel values would fail on every adjustment while
   proving nothing about whether the gradient is still correct. */
const [CYAN, VIOLET, MAGENTA] = WAVE_STOPS;

test('each stop reproduces its own colour exactly', () => {
  // Boundary correctness. A piecewise interpolation that is a shade off AT the
  // stops is the failure nobody sees by looking.
  for (const s of WAVE_STOPS) {
    const c = at(s.at);
    near(c.r, s.c.r, `r at ${s.at}`);
    near(c.g, s.c.g, `g at ${s.at}`);
    near(c.b, s.c.b, `b at ${s.at}`);
  }
});

test('the wave runs cyan → violet → magenta', () => {
  // Identity of each stop, by shape rather than by value: cyan is blue-green
  // with no red, violet is red-and-blue with little green, magenta is red-led.
  assert.ok(CYAN.c.r === 0 && CYAN.c.b > CYAN.c.g, 'first stop is cyan');
  assert.ok(VIOLET.c.b > VIOLET.c.r && VIOLET.c.r > VIOLET.c.g, 'middle stop is violet');
  assert.ok(MAGENTA.c.r > MAGENTA.c.b && MAGENTA.c.b > MAGENTA.c.g, 'last stop is magenta');
});

test('the midpoint of the first leg sits between cyan and violet', () => {
  const c = at(VIOLET.at / 2);
  near(c.r, (CYAN.c.r + VIOLET.c.r) / 2, 'r');
  near(c.g, (CYAN.c.g + VIOLET.c.g) / 2, 'g');
  near(c.b, (CYAN.c.b + VIOLET.c.b) / 2, 'b');
});

test('it passes through violet, not through washed-out pink', () => {
  // The reason there are three stops. On a straight cyan→magenta line the
  // middle would be a pale blue-pink with none of the brand's violet in it.
  const straightLineGreen = (CYAN.c.g + MAGENTA.c.g) / 2;
  assert.ok(VIOLET.c.g < straightLineGreen - 30, 'violet must be far greener-poorer than a straight blend');
});

test('brightness scales every channel equally, so HUE is untouched', () => {
  // The load-bearing claim of the brightness knob. If it ever scaled channels
  // unevenly it would be a tint, not a dimmer, and the brand colour would
  // drift every time the owner adjusted it.
  const full = [
    { r: 0, g: 229, b: 255 },
    { r: 191, g: 95, b: 255 },
    { r: 255, g: 79, b: 216 },
  ];
  WAVE_STOPS.forEach((s, i) => {
    for (const k of ['r', 'g', 'b']) {
      near(s.c[k], full[i][k] * WAVE_BRIGHTNESS, `stop ${i} ${k}`);
    }
  });
});

test('the wave is dimmed, not at full strength', () => {
  // Guards the actual request: the played wave was too hot against a near-black
  // bubble. If this ever returns to 1 the complaint returns with it.
  assert.ok(WAVE_BRIGHTNESS < 1, 'brightness must be below full');
  assert.ok(WAVE_BRIGHTNESS > 0.4, 'but not so low the wave stops carrying the colour');
});

test('the colour advances monotonically in red across the wave', () => {
  // Red climbs across the stops, so it must never go backwards.
  let prev = -1;
  for (let u = 0; u <= 1.0001; u += 0.02) {
    const r = at(u).r;
    assert.ok(r >= prev - 0.001, `red went backwards at u=${u.toFixed(2)}`);
    prev = r;
  }
});

test('out-of-range clamps rather than extrapolating', () => {
  // Extrapolating past the ends produces channels outside 0–255, which is an
  // invalid colour — the bar would render as nothing rather than as wrong.
  assert.deepEqual(at(-1), at(0));
  assert.deepEqual(at(2), at(1));
  assert.deepEqual(at(-0.0001), at(0));
});

test('every channel stays inside 0–255 across the whole range', () => {
  for (let u = -0.5; u <= 1.5; u += 0.01) {
    const c = at(u);
    for (const k of ['r', 'g', 'b']) {
      assert.ok(c[k] >= 0 && c[k] <= 255, `${k} out of gamut at u=${u.toFixed(2)}: ${c[k]}`);
    }
  }
});

test('a non-finite position falls back to the start rather than NaN', () => {
  // NaN channels serialise to "rgba(NaN,...)", which the browser drops — a bar
  // that silently disappears instead of being visibly wrong.
  for (const bad of [NaN, undefined, null, 'x']) {
    const c = at(bad);
    assert.ok(Number.isFinite(c.r) && Number.isFinite(c.g) && Number.isFinite(c.b), String(bad));
  }
});

test('alpha is always fully opaque — REST owns transparency, not this', () => {
  // Brightness is applied to the CHANNELS, deliberately. Dimming via alpha
  // would blend the wave toward the wallpaper and change its colour as the
  // thread scrolled.
  for (const u of [0, 0.3, 0.58, 0.9, 1]) assert.equal(at(u).a, 1);
});
