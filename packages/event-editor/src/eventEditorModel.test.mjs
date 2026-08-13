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

/* ── SET TIMES HARDENING · fields this form does not offer ────────────── */

test('⚠ labelColor and pinned survive an editor round trip', () => {
  // THE DEFECT: both are written by the SET TIMES tab on the event page, which
  // this form knows nothing about. Rebuilding a slot from a fixed key list
  // deleted them, so opening the editor to change a poster silently threw away
  // an organiser's slot colours and locks.
  const stored = { id: 'x', time: '9:05', ampm: 'AM', dur: 45, label: 'Opener', labelColor: '#BF5FFF', pinned: true };
  assert.deepEqual(slotToSave(slotToEdit(stored)), stored);
});

test('⚠ a slot without them does NOT grow the keys', () => {
  // Otherwise every existing event acquires two null fields on its next save,
  // and `pinned: false` starts meaning something different from absent.
  const stored = { id: 'x', time: '9:05', ampm: 'AM', dur: 45, label: 'Opener' };
  const out = slotToSave(slotToEdit(stored));
  assert.ok(!('labelColor' in out), 'no phantom colour');
  assert.ok(!('pinned' in out),     'no phantom pin');
});

test('an unpinned slot keeps its explicit false rather than losing the key', () => {
  const stored = { id: 'x', time: '8:00', ampm: 'PM', dur: 60, label: '', pinned: false };
  assert.equal(slotToSave(slotToEdit(stored)).pinned, false);
});

/* ── SET TIMES HARDENING · the setTimesNeeded round trip ──────────────── */

test('⚠ set times OFF stays off across a load/save — no phantom Day 1', () => {
  // THE DEFECT, and note what makes it invisible: every other test in this file
  // spreads `setTimesNeeded` in BY HAND, which is exactly what hid the missing
  // round trip. This one deliberately does not.
  const r = row(); r.config.days = [];
  const v = { ...emptyEventForm(), ...fromConfig(r) };

  assert.equal(v.setTimesNeeded, false, 'the row says there is no running order');
  assert.deepEqual(toConfig(v).days, [], 'and a save must not invent one');
});

test('set times ON survives the same trip', () => {
  const v = { ...emptyEventForm(), ...fromConfig(row()) };
  assert.equal(v.setTimesNeeded, true);
  assert.equal(toConfig(v).days.length, 1);
});

test('the toggle is derived from the stored days, never a second flag', () => {
  assert.equal(fromConfig({ config: { days: [] } }).setTimesNeeded, false);
  assert.equal(fromConfig({ config: {} }).setTimesNeeded, false, 'absent is not "needed"');
  assert.equal(fromConfig({ config: { days: [{ name: '', slots: [] }] } }).setTimesNeeded, true,
    'a day with no slots yet is still an intention to have a running order');
});

/* ── THE VENUE: its link, and its town ──────────────────────────────────────
 *
 * `venue_profile_id` is a COLUMN and the town lives in `config.suburb`, so the
 * two halves of "where is this gig" are read from different places and it is
 * easy to drop one silently. These pin both.
 */

test('⚠ the venue link is read from the ROW, never from config', () => {
  const linked = fromConfig({ venue_profile_id: 'abc-123', config: { venue: 'The Coast Hotel' } });
  assert.equal(linked.venueProfileId, 'abc-123');

  // An event saved before the picker existed has no link, and that is "not
  // linked" rather than a defect — the picker opens on its search field.
  assert.equal(fromConfig({ config: { venue: 'The Coast Hotel' } }).venueProfileId, null);
});

test('⚠ the town is written as `suburb` — the key eventViewModel actually reads', () => {
  const v = {
    ...emptyEventForm(),
    venue: 'The Coast Hotel', venueTown: 'Wollongong',
    venueState: 'NSW', venuePostcode: '2500',
  };
  const out = toConfig(v);

  // eventViewModel's locality ladder is venueProfile.suburb → cfg.suburb.
  // Storing this under any other key would file a town the page cannot find.
  assert.equal(out.suburb, 'Wollongong');
  assert.equal(out.state, 'NSW');
  assert.equal(out.postcode, '2500', 'geo.js turns the postcode into the map centroid');
});

test('a town survives a load/save round trip rather than being dropped', () => {
  const r = { config: { venue: 'The Coast Hotel', suburb: 'Wollongong', state: 'NSW', postcode: '2500' } };
  const v = { ...emptyEventForm(), ...fromConfig(r) };

  assert.equal(v.venueTown, 'Wollongong', 'the importer has always written this; the editor must keep it');
  assert.equal(v.venueState, 'NSW');
  assert.equal(v.venuePostcode, '2500');

  const out = toConfig(v);
  assert.equal(out.suburb, 'Wollongong', 'a save that loses the town makes two rooms with one name identical again');
  assert.equal(out.postcode, '2500');
});

test('no town is null, not an empty string — absent is not "a town called nothing"', () => {
  const out = toConfig({ ...emptyEventForm(), venue: 'Some warehouse' });
  assert.equal(out.suburb, null);
  assert.equal(out.state, null);
  assert.equal(out.postcode, null);
});

/* ── THE SECRET LOCATION ────────────────────────────────────────────────────
 *
 * ⚠ THESE EXIST BECAUSE A CONTROL TEST FOUND THEM MISSING. Removing the
 * snake_case branch from `fromConfig` broke nothing in this suite, and the
 * failure it allows is silent and destructive: an older event stored as
 * `location_withheld` loads as "not secret", the organiser saves a poster, and
 * the address of a secret party is published by a form they never touched.
 */

test('⚠ a secret location survives a load/save round trip', () => {
  const v = { ...emptyEventForm(), ...fromConfig({ config: { venue: 'A paddock', locationWithheld: true } }) };
  assert.equal(v.locationWithheld, true, 'loaded as secret');
  assert.equal(toConfig(v).locationWithheld, true, 'and saved as secret');
});

test('⚠ the snake_case spelling is read too, so older secret events stay secret', () => {
  const v = fromConfig({ config: { venue: 'A paddock', location_withheld: true } });
  assert.equal(v.locationWithheld, true,
    'an event stored under the older key must not load as public');
});

test('locationWithheld always saves as a boolean, never null', () => {
  // eventViewModel tests `=== true`; a null would read as public.
  assert.equal(toConfig({ ...emptyEventForm() }).locationWithheld, false);
  assert.strictEqual(typeof toConfig({ ...emptyEventForm() }).locationWithheld, 'boolean');
});

test('⛔ an unlisted venue keeps its name and never gains a profile id', () => {
  const row = { venue_profile_id: null, config: { venue: 'Coffs Hinterland', suburb: 'Coffs Harbour' } };
  const v = { ...emptyEventForm(), ...fromConfig(row) };
  assert.equal(v.venueProfileId, null, 'null in stays null');
  assert.equal(v.venue, 'Coffs Hinterland', 'and the location is preserved');
  assert.equal(toConfig(v).venue, 'Coffs Hinterland', 'through the save too');
});

/* ── THREE VENUE IDENTITIES × TWO VISIBILITIES ──────────────────────────────
 *
 * ⭐⭐ IDENTITY AND VISIBILITY ARE INDEPENDENT, and the whole point of these is
 * that all six combinations survive a save. Conflating "event-only" with
 * "secret" is the error the UI separation exists to prevent: an established
 * venue can host something unannounced, and a one-off paddock can publish its
 * address freely.
 *
 *   EXISTING    venue_profile_id set        → a catalogue venue
 *   CREATE      venueRequest true           → a real room awaiting Studio
 *   EVENT-ONLY  neither                     → this event's own location
 */

const IDENTITIES = [
  { label: 'EXISTING',   form: { venueProfileId: 'venue-1', venue: 'Elbows Rest',  venueRequest: false } },
  { label: 'CREATE',     form: { venueProfileId: null,      venue: 'The Old Barn', venueRequest: true  } },
  { label: 'EVENT-ONLY', form: { venueProfileId: null,      venue: 'A paddock',    venueRequest: false } },
];

for (const id of IDENTITIES) {
  for (const withheld of [false, true]) {
    test(`${id.label} venue + ${withheld ? 'SECRET' : 'PUBLIC'} location round-trips`, () => {
      const out = toConfig({ ...emptyEventForm(), ...id.form, locationWithheld: withheld });
      assert.equal(out.venue, id.form.venue, 'the name survives');
      assert.equal(out.locationWithheld, withheld, 'visibility is stored as chosen');
      assert.equal(out.venueRequest, id.form.venueRequest,
        'and identity is stored independently of visibility');
    });
  }
}

test('⛔ EVENT-ONLY never asks Studio for a venue', () => {
  const out = toConfig({ ...emptyEventForm(), venue: 'A paddock', venueRequest: false });
  assert.equal(out.venueRequest, false,
    'no request means no review queue entry and no catalogue venue, ever');
});

test('⭐ CREATE records the request, and the event still works immediately', () => {
  const out = toConfig({ ...emptyEventForm(), venue: 'The Old Barn', venueRequest: true });
  assert.equal(out.venueRequest, true, 'Studio can find it');
  assert.equal(out.venue, 'The Old Barn', 'and the event names its venue right now');
});

test('⚠ a confirmed request stops being a request', () => {
  /* Studio confirming creates the profile and sets `venue_profile_id`. If the
     flag survived that, the event would sit in the review queue forever asking
     for a venue that now exists. */
  const out = toConfig({ ...emptyEventForm(), venue: 'The Old Barn', venueRequest: true, venueProfileId: 'venue-9' });
  assert.equal(out.venueRequest, false);

  const loaded = fromConfig({ venue_profile_id: 'venue-9', config: { venue: 'The Old Barn', venueRequest: true } });
  assert.equal(loaded.venueRequest, false, 'and it does not come back on load either');
});

test('⚠ SECRET does not imply EVENT-ONLY — a pending venue can be secret', () => {
  const out = toConfig({ ...emptyEventForm(), venue: 'The Old Barn', venueRequest: true, locationWithheld: true });
  assert.equal(out.venueRequest, true, 'still a real venue we want catalogued');
  assert.equal(out.locationWithheld, true, 'whose address is simply not public yet');
});

test('⭐ show-area-map rides with SECRET and is cleared by PUBLIC', () => {
  const secret = toConfig({ ...emptyEventForm(), locationWithheld: true, showAreaMap: true });
  assert.equal(secret.showAreaMap, true, 'a secret event can keep its town map');

  /* ⚠ Meaningless on a public event, so it must not persist there: a stored
     true would silently arm the exception the moment someone flipped to
     SECRET, months later, with no idea they had. */
  const pub = toConfig({ ...emptyEventForm(), locationWithheld: false, showAreaMap: true });
  assert.equal(pub.showAreaMap, false);
});
