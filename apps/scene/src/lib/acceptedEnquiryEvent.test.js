import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planAcceptedEnquiry, findEventForNight, draftEventForAcceptance } from './acceptedEnquiryEvent.js';

const VENUE = 'venue-1';
const ev = (date, extra = {}) => ({ id: `e-${date}`, venue_profile_id: VENUE, config: { date }, ...extra });
/* ⚠ A FIXED "today" for every case. Pinned to the real clock, each hardcoded
   future date silently stops testing anything the day it passes — the suite
   would go green for the wrong reason. */
const TODAY  = '2026-08-31';
const FUTURE = '2026-09-19';

/**
 * ⛔⛔ THE ONE-EVENT LAW IS THE POINT OF THIS MODULE.
 *
 * Acceptance is per ACT; an event is per NIGHT. Three acts accepted for one
 * Saturday must end as ONE event with three acts on its shortlist — never
 * three events, which is the split the law forbids and which "merge them
 * afterwards" explicitly does not fix.
 */
test('⛔⛔ a second acceptance on the SAME night attaches, it does not create', () => {
  const plan = planAcceptedEnquiry({
    todayStr: TODAY, viewerType: 'venue', otherType: 'artist',
    date: FUTURE, venueProfileId: VENUE, events: [ev(FUTURE)],
  });
  assert.equal(plan.action, 'attach');
  assert.equal(plan.event.id, `e-${FUTURE}`);
});

test('the FIRST acceptance for a night creates the draft', () => {
  const plan = planAcceptedEnquiry({
    todayStr: TODAY, viewerType: 'venue', otherType: 'artist',
    date: FUTURE, venueProfileId: VENUE, events: [ev('2026-10-02')],
  });
  assert.equal(plan.action, 'create');
});

test('⛔ nothing is created when the OTHER party owns the night', () => {
  // A venue accepting a promoter is agreeing to host someone else's event.
  const plan = planAcceptedEnquiry({
    todayStr: TODAY, viewerType: 'venue', otherType: 'host',
    date: FUTURE, venueProfileId: VENUE, events: [],
  });
  assert.equal(plan.action, 'none');
  assert.match(plan.reason, /other party/);
});

test('⛔⛔ a performer never creates an event, whoever they accepted', () => {
  for (const viewerType of ['artist', 'band', 'standup']) {
    for (const otherType of ['venue', 'host']) {
      const plan = planAcceptedEnquiry({ todayStr: TODAY, viewerType, otherType, date: FUTURE, events: [] });
      assert.equal(plan.action, 'none', `${viewerType} was asked to create an event`);
    }
  }
});

/**
 * ⛔⛔ NOBODY MAY ENQUIRE ABOUT A PAST DATE (owner, 2026-08-31) — and a row SENT
 * months ago can still be accepted today. Accepting one used to produce a draft
 * event that was archived the moment it existed: the organiser pressed accept,
 * was told a night had been made, and could not find it anywhere.
 */
test('⛔⛔ accepting an enquiry for a date that has passed creates no event', () => {
  const plan = planAcceptedEnquiry({
    todayStr: TODAY, viewerType: 'venue', otherType: 'artist',
    date: '2026-08-16', venueProfileId: VENUE, events: [],
  });
  assert.equal(plan.action, 'none');
  assert.match(plan.reason, /passed/);
});

test('⚠ TODAY is not past — a gig tonight is a real booking', () => {
  const plan = planAcceptedEnquiry({
    todayStr: TODAY, viewerType: 'venue', otherType: 'artist',
    date: TODAY, venueProfileId: VENUE, events: [],
  });
  assert.equal(plan.action, 'create');
});

test('an enquiry with no date creates nothing rather than an undated event', () => {
  const plan = planAcceptedEnquiry({ todayStr: TODAY, viewerType: 'venue', otherType: 'artist', date: null, events: [] });
  assert.equal(plan.action, 'none');
});

test('an enquiry that already names an event is left alone', () => {
  const plan = planAcceptedEnquiry({
    todayStr: TODAY, viewerType: 'venue', otherType: 'artist',
    date: FUTURE, events: [], hasEventAlready: true,
  });
  assert.equal(plan.action, 'none');
  assert.match(plan.reason, /already names an event/);
});

test('the same night at a DIFFERENT venue is a different night', () => {
  const events = [ev(FUTURE, { venue_profile_id: 'other-venue' })];
  assert.equal(findEventForNight(events, { venueProfileId: VENUE, date: FUTURE }), null);
});

test('an event with no venue link still counts as that venue\'s night', () => {
  // Legacy events predate venue_profile_id; treating them as "somebody else's"
  // would create a duplicate for a night that already exists.
  const events = [ev(FUTURE, { venue_profile_id: null })];
  assert.ok(findEventForNight(events, { venueProfileId: VENUE, date: FUTURE }));
});

test('the draft is a DRAFT, private, with no running order', () => {
  const d = draftEventForAcceptance({
    actName: 'BVP', venueName: 'Elbows Rest', date: FUTURE,
    venueProfileId: VENUE, ownerProfileId: 'own-1', userId: 'u-1',
  });
  assert.equal(d.status, 'draft');
  assert.equal(d.is_public, false);
  assert.equal(d.applications_open, false);
  assert.equal(d.name, 'BVP at Elbows Rest');
  assert.equal(d.config.date, FUTURE);
  assert.deepEqual(d.config.days, [], 'a running order nobody asked for');
  assert.equal(d.booking_model, 'managed');
  assert.equal(d.owner_profile_id, 'own-1');
  assert.equal(d.venue_profile_id, VENUE);
});

test('the title degrades rather than inventing a name', () => {
  assert.equal(draftEventForAcceptance({ venueName: 'Elbows Rest', date: 'x' }).name, 'Elbows Rest');
  assert.equal(draftEventForAcceptance({ date: 'x' }).name, 'New event');
});
