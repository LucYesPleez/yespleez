import assert from 'node:assert';
import { test } from 'node:test';
import { fromConfig, toConfig, emptyEventForm, slotToEdit, slotToSave } from './eventEditorModel.js';

/**
 * ROUND-TRIP TESTS for the one place `events.config` is interpreted.
 *
 * ⭐ These exist because the mapping is now SHARED. Every host goes through it,
 * so a silent change here would corrupt events in all of them at once — and the save path cannot be exercised in a browser without writing
 * to a real event.
 */

const row = () => ({
  name: 'Three Day Gathering 2026',
  is_public: false,
  applications_open: true,
  required_items: ['tech_rider', 'press_kit'],
  config: {
    date: '2026-11-13', endDate: '2026-11-15', venue: 'Echo Valley',
    genres: 'psytrance, forest', categoryBadge: 'MULTI DAY', openMicBadge: false,
    ticketLink: 'https://humanitix.com/x', bio: 'Three days in the hills.',
    cover: 'c.jpg', gallery: ['g1.jpg', 'g2.jpg'],
    poster: 'p.jpg', poster_thumb: 'pt.jpg', poster_full: 'pf.jpg',
    posterCropY: 22,
    days: [{ name: 'Friday', slots: [{ id: 's1', time: '9:30', ampm: 'PM', dur: 90, label: 'Headline' }] }],
    host_controls_config: { artistsCanRemove: false, showRankedBackup: true, showGenrePickers: false, privateSetTimes: true, showTimesPublicly: true },
  },
});

test('a stored event survives a load/save round trip', () => {
  const v = { ...emptyEventForm(), ...fromConfig(row()), setTimesNeeded: true };
  const out = toConfig(v);
  const original = row().config;

  for (const k of ['date', 'endDate', 'venue', 'genres', 'categoryBadge', 'ticketLink', 'bio',
                   'poster', 'poster_thumb', 'poster_full', 'posterCropY', 'cover']) {
    assert.deepEqual(out[k], original[k], `field drifted: ${k}`);
  }
  assert.deepEqual(out.gallery, original.gallery);
  assert.deepEqual(out.host_controls_config, original.host_controls_config);
  assert.equal(out.days[0].name, 'Friday');
  assert.deepEqual(out.days[0].slots[0], original.days[0].slots[0]);
});

test('the cover/gallery split rejoins and re-splits without losing order', () => {
  const v = { ...emptyEventForm(), ...fromConfig(row()) };
  assert.deepEqual(v.slides, ['c.jpg', 'g1.jpg', 'g2.jpg']);
  const out = toConfig({ ...v, setTimesNeeded: true });
  assert.equal(out.cover, 'c.jpg');
  assert.deepEqual(out.gallery, ['g1.jpg', 'g2.jpg']);
});

test('⚠ an absent posterCropY means "no choice made", never 0', () => {
  const r = row(); delete r.config.posterCropY;
  const v = fromConfig(r);
  assert.notEqual(v.posterCropY, 0);
  assert.equal(typeof v.posterCropY, 'number');
});

test('posterCropY is dropped when there is no poster, and kept when there is', () => {
  const base = { ...emptyEventForm(), setTimesNeeded: true };
  assert.equal(toConfig({ ...base, poster: '', posterCropY: 40 }).posterCropY, null);
  assert.equal(toConfig({ ...base, poster: 'p.jpg', posterCropY: 40 }).posterCropY, 40);
});

test('set times off writes an empty schedule rather than stale slots', () => {
  const v = { ...emptyEventForm(), ...fromConfig(row()), setTimesNeeded: false };
  assert.deepEqual(toConfig(v).days, []);
});

test('days are only replaced on load when the row actually has some', () => {
  const r = row(); r.config.days = [];
  assert.equal(fromConfig(r).days, undefined, 'undefined lets the form keep its blank day');
});

test('required_items: NULL and absent both mean none declared', () => {
  assert.deepEqual(fromConfig({ ...row(), required_items: null }).requiredItems, []);
  assert.deepEqual(fromConfig(row()).requiredItems, ['tech_rider', 'press_kit']);
});

test('is_public / applications_open default to true only when absent', () => {
  assert.equal(fromConfig({ config: {} }).isPublic, true);
  assert.equal(fromConfig({ config: {}, is_public: false }).isPublic, false);
  assert.equal(fromConfig({ config: {}, applications_open: false }).appsOpen, false);
});

test('slot time parsing round-trips', () => {
  const stored = { id: 'x', time: '9:05', ampm: 'AM', dur: 45, label: 'Opener' };
  assert.deepEqual(slotToSave(slotToEdit(stored)), stored);
});
