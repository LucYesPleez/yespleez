import test from 'node:test';
import assert from 'node:assert/strict';
import { heroMediaInputsFromConfig } from './configMedia.js';
import { resolveHeroMedia } from './heroMedia.js';

test('null and empty configs produce empty inputs, and the ladder says no hero', () => {
  for (const cfg of [null, undefined, {}]) {
    const inputs = heroMediaInputsFromConfig(cfg);
    assert.deepEqual(inputs, {
      cover: null, gallery: [], landscapeArtwork: null, poster: null, posterCropY: null,
    });
    assert.equal(resolveHeroMedia(inputs), null);
  }
});

test('poster_full is preferred over poster; poster alone still works', () => {
  assert.deepEqual(
    heroMediaInputsFromConfig({ poster: 'crop.jpg', poster_full: 'full.jpg' }).poster,
    { url: 'full.jpg' },
  );
  assert.deepEqual(
    heroMediaInputsFromConfig({ poster: 'crop.jpg' }).poster,
    { url: 'crop.jpg' },
  );
  // A blank poster_full must not blank the poster.
  assert.deepEqual(
    heroMediaInputsFromConfig({ poster: 'crop.jpg', poster_full: '  ' }).poster,
    { url: 'crop.jpg' },
  );
});

test('gallery drops non-strings and blanks, shapes the rest', () => {
  assert.deepEqual(
    heroMediaInputsFromConfig({ gallery: ['a.jpg', '', null, 42, ' b.jpg'] }).gallery,
    [{ url: 'a.jpg' }, { url: ' b.jpg' }],
  );
  assert.deepEqual(heroMediaInputsFromConfig({ gallery: 'not-an-array' }).gallery, []);
});

test('posterCropY passes through only as a number — absent is not 0', () => {
  assert.equal(heroMediaInputsFromConfig({ posterCropY: 35 }).posterCropY, 35);
  assert.equal(heroMediaInputsFromConfig({ posterCropY: '35' }).posterCropY, null);
  assert.equal(heroMediaInputsFromConfig({}).posterCropY, null);
});

test('a config with a cover and gallery reaches the carousel rung end to end', () => {
  const media = resolveHeroMedia(heroMediaInputsFromConfig({
    cover: 'cover.jpg',
    gallery: ['one.jpg'],
  }));
  assert.equal(media.rung, 1);
  assert.equal(media.mode, 'images');
  assert.deepEqual(media.slides, [{ url: 'cover.jpg' }, { url: 'one.jpg' }]);
});
