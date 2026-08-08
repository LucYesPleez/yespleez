import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveHeroMedia, DEFAULT_CROP_Y, MIN_CROP_COVERAGE, MAX_SLIDES,
} from './heroMedia.js';

const img = (name, w, h) => ({ url: `img://${name}`, w, h, alt: name });

const COVER     = img('cover', 1920, 1280);
const ART       = img('artwork', 1920, 1005);
const POSTER    = img('poster', 1080, 1528);   // ordinary A-series poster
const TALL      = img('tall', 1080, 3240);     // banner-shaped, croppable to a sliver
const GALLERY   = [img('g1', 1600, 900), img('g2', 1600, 900)];

// ── the ladder, rung by rung ─────────────────────────────────────────

test('rung 1 · cover + gallery becomes a carousel, cover first', () => {
  const r = resolveHeroMedia({ cover: COVER, gallery: GALLERY, poster: POSTER });
  assert.equal(r.rung, 1);
  assert.equal(r.mode, 'images');
  assert.deepEqual(r.slides.map(s => s.alt), ['cover', 'g1', 'g2']);
});

test('rung 2 · cover alone is a single static slide', () => {
  const r = resolveHeroMedia({ cover: COVER, gallery: [], poster: POSTER });
  assert.equal(r.rung, 2);
  assert.equal(r.slides.length, 1);
});

test('rung 3 · landscape artwork is used when there is no cover', () => {
  const r = resolveHeroMedia({ landscapeArtwork: ART, poster: POSTER });
  assert.equal(r.rung, 3);
  assert.equal(r.slides[0].alt, 'artwork');
});

test('rung 4 · an organiser-chosen crop wins over the default', () => {
  const r = resolveHeroMedia({ poster: POSTER, posterCropY: 63 });
  assert.equal(r.rung, 4);
  assert.equal(r.mode, 'crop');
  assert.equal(r.cropY, 63);
});

test('rung 5 · with no choice made, the default band is TOP-weighted', () => {
  const r = resolveHeroMedia({ poster: POSTER });
  assert.equal(r.rung, 5);
  assert.equal(r.cropY, DEFAULT_CROP_Y);
  // The point of the default: it must sit in the upper half, where a poster
  // carries its title. A centred default would be a different decision.
  assert.ok(r.cropY < 50, 'default crop must be top-weighted, not centred');
});

test('rung 6 · a poster too tall to crop meaningfully is blurred instead', () => {
  const r = resolveHeroMedia({ poster: TALL });
  assert.equal(r.rung, 6);
  assert.equal(r.mode, 'blur');
});

test('rung 7 · nothing at all renders no Hero', () => {
  assert.equal(resolveHeroMedia({}), null);
  assert.equal(resolveHeroMedia(), null);
});

// ── the rules the ladder exists to enforce ───────────────────────────

test('⚠ gallery images never lead — without a cover there is no carousel', () => {
  // A gallery image promoting itself into the Cover's place would make the
  // Hero unpredictable for the organiser: they set a cover, we showed a photo.
  const r = resolveHeroMedia({ gallery: GALLERY, poster: POSTER });
  assert.notEqual(r.mode, 'images');
  assert.equal(r.mode, 'crop', 'should fall through to the poster derivation');
});

test('⚠ the carousel is capped at one cover plus five', () => {
  const many = Array.from({ length: 12 }, (_, i) => img(`g${i}`, 1600, 900));
  const r = resolveHeroMedia({ cover: COVER, gallery: many });
  assert.equal(r.slides.length, MAX_SLIDES);
  assert.equal(r.slides[0].alt, 'cover', 'the cover is never displaced by the cap');
});

test('⚠ a cover always outranks the poster — derivations are a last resort', () => {
  const r = resolveHeroMedia({ cover: COVER, poster: POSTER, posterCropY: 40 });
  assert.equal(r.mode, 'images');
  assert.equal(r.slides[0].alt, 'cover');
});

test('⚠ entries without a url are not slides', () => {
  const r = resolveHeroMedia({ cover: COVER, gallery: [{ alt: 'no url' }, GALLERY[0]] });
  assert.deepEqual(r.slides.map(s => s.alt), ['cover', 'g1']);
});

test('⚠ a poster with unknown dimensions is cropped, not blurred', () => {
  // Refusing to crop on missing metadata would push most real events onto the
  // blurred rung for no reason — the common case is an ordinary poster.
  const r = resolveHeroMedia({ poster: { url: 'img://x' } });
  assert.equal(r.mode, 'crop');
});

test('⚠ the crop/blur boundary is where the band stops representing the poster', () => {
  const aspect = 3 / 2;
  // Construct a poster sitting exactly at the threshold, and one just past it.
  const w = 1200;
  const bandH = w / aspect;                                  // 800
  const atLimit  = { url: 'a', w, h: Math.floor(bandH / MIN_CROP_COVERAGE) };
  const pastIt   = { url: 'b', w, h: Math.ceil(bandH / MIN_CROP_COVERAGE) + 200 };
  assert.equal(resolveHeroMedia({ poster: atLimit,  heroFrameAspect: aspect }).mode, 'crop');
  assert.equal(resolveHeroMedia({ poster: pastIt,   heroFrameAspect: aspect }).mode, 'blur');
});

test('⚠ an out-of-range crop position falls back to the default, not to NaN', () => {
  for (const bad of [-5, 140, '40', null, undefined, NaN]) {
    const r = resolveHeroMedia({ poster: POSTER, posterCropY: bad });
    assert.equal(r.rung, 5, `posterCropY=${String(bad)} should not count as chosen`);
    assert.equal(r.cropY, DEFAULT_CROP_Y);
  }
});
