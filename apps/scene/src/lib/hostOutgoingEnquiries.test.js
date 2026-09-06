import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applicantLabel, fetchOutgoingEnquiries, APP_TABS } from './outgoingPipeline.js';
import { bucketsFor, rawStatusesFor } from './enquiryUtils.js';

/**
 * ⚠⚠ A PROMOTER'S OWN ENQUIRIES HAD NOWHERE TO LAND.
 *
 * ProfileScreen's picker offers every industry profile the account owns, host
 * included, so a promoter could enquire with a venue about a date. The row was
 * written correctly, the venue was notified, and the venue could answer it —
 * but HostDashboard never read `venue_enquiries`, so the sender saw none of it.
 * Exactly the defect fixed on the artist side on 2026-08-10, on the one
 * dashboard it was not fixed on. Closed 2026-08-11.
 *
 * Five things must hold, and each has a test below:
 *   CREATION      — a host may ask; a festival may not
 *   PERSISTENCE   — the row keeps what it was given, invents nothing
 *   VISIBILITY    — the sender can see it, and ONLY the profile that sent it
 *   STATUS        — the venue's answer moves it through the SAME four buckets
 *   NOTIFICATION  — the reply is addressed to the profile that ASKED
 */

const read = name => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
const PROFILE_SCREEN = read('../screens/ProfileScreen.jsx');
const HOST_DASH      = read('../screens/HostDashboard.jsx');
const VENUE_DASH     = read('../screens/VenueDashboard.jsx');

/**
 * A hand-rolled Supabase double. Deliberately not a mock library: it records
 * the filters it was given, which is the whole point — the bug being tested for
 * is a query keyed on the wrong column.
 */
function fakeSupabase({ enquiries = [], profiles = [] } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const filters = {};
      const call = { table, filters };
      calls.push(call);
      const api = {
        select() { return api; },
        eq(col, val) { filters[col] = val; return api; },
        in(col, vals) { filters[`in:${col}`] = vals; return api; },
        /* S5 · `.is(col, null)` — the cleared-row filter. Modelled as a real
           predicate rather than a no-op: a double that silently accepts a
           filter it does not apply would let a cleared row pass this suite.
           ⚠ Kept apart from `eq` because SQL NULL is not JS strict equality —
           a fixture with no such key is NULL in the database's terms, and
           `undefined === null` is false. */
        is(col, val) { filters[`is:${col}`] = val; return api; },
        order() { return api; },
        limit() { return api; },
        then(resolve) {
          const data = table === 'venue_enquiries'
            ? enquiries.filter(e =>
                Object.entries(filters).every(([k, v]) => {
                  if (k.startsWith('in:')) return true;
                  if (k.startsWith('is:')) {
                    const col = k.slice(3);
                    return v === null ? e[col] == null : e[col] === v;
                  }
                  return e[k] === v;
                }))
            : profiles.filter(p => (filters['in:id'] || []).includes(p.id));
          return Promise.resolve({ data }).then(resolve);
        },
      };
      return api;
    },
  };
}

const HOST_PROFILE_ID = 'host-profile-1';
const DJ_PROFILE_ID   = 'dj-profile-1';   // same human, different act
const VENUE = { id: 'venue-1', name: 'Elbows Rest', type: 'venue' };

const HOST_ENQUIRY = {
  id: 'e1', status: 'pending', created_at: '2026-08-11T02:00:00Z',
  date_requested: '2026-09-04', note: 'Looking to run a Friday night.',
  venue_profile_id: VENUE.id, applicant_profile_id: HOST_PROFILE_ID,
  initiated_by: 'applicant',
  // ⛔ NULL, and correctly so: a promoter asking for a room is not asking for
  // music, comedy or workshops. See the row component.
  ask_category: null,
};

// ── CREATION ────────────────────────────────────────────────────────────────

test('CREATION · a host may send an enquiry', () => {
  const picker = PROFILE_SCREEN.slice(PROFILE_SCREEN.indexOf('async function openEnquiry'));
  const query  = picker.slice(0, picker.indexOf('if (!profs?.length)'));
  assert.doesNotMatch(query, /neq\('type', 'host'\)/,
    'the promoter has been removed from the picker — their existing enquiries would be orphaned');
});

/**
 * ⛔ A FESTIVAL MAY NOT — not because the ask is wrong, but because Scene has
 * nowhere to show it the reply. `PROFILE_TYPES.festival.dashPath` is null: the
 * Portal administers that identity. An enquiry it could send and never hear
 * about again is a write into a void.
 */
test('CREATION · a festival may not send an enquiry from Scene', () => {
  const picker = PROFILE_SCREEN.slice(PROFILE_SCREEN.indexOf('async function openEnquiry'));
  const query  = picker.slice(0, picker.indexOf('if (!profs?.length)'));
  assert.match(query, /neq\('type', 'festival'\)/,
    'a festival can enquire from Scene and has nowhere to read the answer');
});

// ── PERSISTENCE ─────────────────────────────────────────────────────────────

/**
 * ⛔ A category is never invented to fill the chip. `ask_category` is resolved
 * from the acting profile's ROLE before the send and stored — a host resolves
 * to none, so the column is NULL and the row renders no chip.
 */
test('PERSISTENCE · the ask category is stored, never derived at read time', () => {
  assert.match(PROFILE_SCREEN, /ask_category:\s+askCategory,/,
    'the stored category is being computed at write time from something else');
  const pipeline = read('./outgoingPipeline.js');
  assert.doesNotMatch(pipeline, /resolveAskCategory|askCategoryFor/,
    'the outgoing list re-derives a category the row already carries');
});

test('PERSISTENCE · a chipless enquiry survives the round trip unchanged', async () => {
  const rows = await fetchOutgoingEnquiries(
    fakeSupabase({ enquiries: [HOST_ENQUIRY], profiles: [VENUE] }), HOST_PROFILE_ID);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ask_category, null, 'a null category was replaced with a guess');
  assert.equal(rows[0].note, HOST_ENQUIRY.note);
  assert.equal(rows[0].date_requested, '2026-09-04');
});

// ── VISIBILITY ──────────────────────────────────────────────────────────────

test('VISIBILITY · the host dashboard reads the enquiries the host sent', () => {
  assert.match(HOST_DASH, /fetchOutgoingEnquiries\(supabase, hostProfileId\)/,
    'HostDashboard still never reads venue_enquiries — the sender cannot see their own ask');
  assert.match(HOST_DASH, /enquiries=\{panelEnquiries\}/,
    'the enquiries are fetched but never reach the panel that renders them');
});

/**
 * ⛔ ONE SET OF DIRECTION TABS, and `EnquiryPanel` already owns it.
 *
 * ⚠ The first attempt drew INCOMING/OUTGOING a SECOND time directly above the
 * panel's own pair — two identical controls stacked, because the existing ones
 * were a few lines further down inside a component and went unread. Everything
 * needed already existed: withDirection, an OUTGOING status map, the tab, and
 * per-direction copy on the card.
 */
test('VISIBILITY · the direction tabs are not drawn twice', () => {
  assert.doesNotMatch(HOST_DASH, /key: 'OUTGOING'|'INCOMING', color:/,
    'HostDashboard has grown its own direction tabs on top of the panel\'s');
  assert.doesNotMatch(HOST_DASH, /APP_TABS|applicantLabel/,
    'a second status vocabulary is being applied over the panel\'s own');
});

/**
 * ⭐ THE COUNTERPARTY IS NAMED, NOT DERIVED. `EnquiryCard` resolves the
 * APPLICANT when handed no profile — right for a venue, who is never the
 * applicant, and wrong for a promoter reading their own enquiry, who would be
 * shown themselves.
 */
test('VISIBILITY · an outgoing row names the VENUE as its counterparty', () => {
  assert.match(HOST_DASH, /profile: e\.venue \|\| null/,
    'the host would be shown their own profile as the other party');
});

/**
 * ⛔ READINESS DESCRIBES THE PARTY BEING BOOKED. On a promoter's outgoing row
 * the profile drawn is the VENUE, who is not being booked — it rendered
 * "23% READY" against Elbows Rest, which is not the venue's real completeness
 * (its own dashboard says 77%) but an artifact of the slim column list an
 * outgoing row is fetched with. A confident wrong number is worse than none.
 */
test('VISIBILITY · a venue is never given a booking-readiness score', () => {
  const CARD = read('../components/EnquiryCard.jsx');
  assert.match(CARD, /profile && p\.type !== 'venue' \? completionFor/,
    'a venue is being scored for booking readiness off a partial row');
});

/**
 * ⚠ Keyed on the SUBJECT being drawn, not on the screen doing the drawing — a
 * venue inviting an act still sees that act's readiness, because there the
 * subject really is the one being booked.
 */
test('VISIBILITY · the card takes its identity from the profile it draws', () => {
  const CARD = read('../components/EnquiryCard.jsx');
  assert.match(CARD, /PROFILE_TYPES\[profile\?\.type \|\| enq\.applicant_type\]/,
    "a venue's row would render in the asking profile's colour");
});

test('VISIBILITY · direction is derived at the fetch boundary, never stored', () => {
  assert.match(HOST_DASH, /withDirection\(outgoingEnquiries, 'applicant'\)/,
    'direction is being hand-written — the same row is incoming to the venue');
});

/**
 * ⛔ An enquiry the promoter SENT is the venue's to decide. A status write from
 * this side would be the asker marking their own request accepted.
 */
test('VISIBILITY · the host cannot answer their own outgoing enquiry', () => {
  const respond = HOST_DASH.slice(HOST_DASH.indexOf('async function handleEnquiryRespond'));
  const body    = respond.slice(0, respond.indexOf('\n  }'));
  assert.match(body, /allApps\.find/,
    'the respond path no longer looks the row up among the applications received');
  assert.doesNotMatch(body, /venue_enquiries/,
    'the promoter can write a status onto an enquiry they sent');
});

test('VISIBILITY · the sender sees their enquiry, with the venue attached', async () => {
  const rows = await fetchOutgoingEnquiries(
    fakeSupabase({ enquiries: [HOST_ENQUIRY], profiles: [VENUE] }), HOST_PROFILE_ID);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].venue.name, 'Elbows Rest');
});

/**
 * ⛔ ONE ACCOUNT, SEVERAL PROFILES. A promoter who also DJs must not see their
 * DJ act's enquiries on the host dashboard — the cross-over the 2026-08
 * profile-keying sweep removed everywhere else.
 */
test('VISIBILITY · another profile of the same account is not listed', async () => {
  const djEnquiry = { ...HOST_ENQUIRY, id: 'e2', applicant_profile_id: DJ_PROFILE_ID };
  const rows = await fetchOutgoingEnquiries(
    fakeSupabase({ enquiries: [HOST_ENQUIRY, djEnquiry], profiles: [VENUE] }), HOST_PROFILE_ID);
  assert.deepEqual(rows.map(r => r.id), ['e1'],
    "the host dashboard is showing another of this account's profiles");
});

/**
 * ⛔ An OFFER is not an ENQUIRY. A venue-initiated row is an invitation the host
 * received; merging it into the outgoing list would tell them they asked for
 * something they were offered.
 */
test('VISIBILITY · a venue-initiated row is not an outgoing enquiry', async () => {
  const offer = { ...HOST_ENQUIRY, id: 'e3', initiated_by: 'venue' };
  const rows = await fetchOutgoingEnquiries(
    fakeSupabase({ enquiries: [HOST_ENQUIRY, offer], profiles: [VENUE] }), HOST_PROFILE_ID);
  assert.deepEqual(rows.map(r => r.id), ['e1'], 'an offer received is being shown as an ask sent');
});

test('VISIBILITY · no profile means an empty list, never the whole table', async () => {
  const sb = fakeSupabase({ enquiries: [HOST_ENQUIRY], profiles: [VENUE] });
  assert.deepEqual(await fetchOutgoingEnquiries(sb, null), []);
  assert.equal(sb.calls.length, 0, 'an unkeyed query was issued for an account with no host profile');
});

// ── STATUS CHANGES ──────────────────────────────────────────────────────────

/**
 * The venue answers with its own vocabulary; the asker reads four buckets. The
 * mapping is shared, so a host's `shortlisted` reads exactly as a DJ's does.
 */
test('STATUS · the venue\'s vocabulary maps onto the asker\'s four buckets', () => {
  assert.equal(applicantLabel('pending'),     'SUBMITTED');
  assert.equal(applicantLabel('new'),         'SUBMITTED');
  assert.equal(applicantLabel('shortlisted'), 'BEING CONSIDERED');
  assert.equal(applicantLabel('tentative'),   'BEING CONSIDERED');
  assert.equal(applicantLabel('offered'),     'BEING CONSIDERED');
  assert.equal(applicantLabel('accepted'),    'BOOKED');
  assert.equal(applicantLabel('confirmed'),   'BOOKED');
  assert.equal(applicantLabel('booked'),      'BOOKED');
  assert.equal(applicantLabel('declined'),    'NOT SELECTED');
  assert.equal(applicantLabel('rejected'),    'NOT SELECTED');
});

test('STATUS · ⛔⛔ `interested` IS A BUCKET, NOT A STORED STATUS', () => {
  /**
   * ⚠⚠ THIS TEST USED TO ASSERT THE OPPOSITE. It pinned
   * `applicantLabel('interested') === 'BEING CONSIDERED'`, encoding the very
   * misconception the label function carried. `interested` is the OUTGOING
   * BUCKET — the ASKER's name for the state the recipient calls `shortlisted`
   * — and it appears in `enquiryUtils` only as a map VALUE. Nothing writes it,
   * so handing it to a function that takes a RAW status is a malformed
   * question, and answering it with the considered bucket disguised which side
   * of the map the caller was on.
   *
   * ⭐ THE RELATIONSHIP IT NAMES IS REAL AND STAYS: the three raw spellings
   * below all bucket as `interested` for whoever did the asking, whatever kind
   * of profile either side is.
   */
  for (const dir of ['incoming', 'outgoing']) {
    for (const b of bucketsFor(dir)) {
      assert.ok(!rawStatusesFor(b, dir).includes('interested'),
        `interested must not be a raw status of ${dir}/${b}`);
    }
  }
  assert.deepEqual(rawStatusesFor('interested', 'outgoing').sort(),
    ['offered', 'shortlisted', 'tentative']);
  for (const raw of rawStatusesFor('interested', 'outgoing')) {
    assert.equal(applicantLabel(raw), 'BEING CONSIDERED', `${raw} is the asker's INTERESTED`);
  }
  // ⛔ and the bucket name itself is an unknown status, filed under the catch-all
  assert.equal(applicantLabel('interested'), 'SUBMITTED');
});

test('STATUS · ⭐ a WITHDRAWN ask is off the table, not still waiting', () => {
  /* ⛔⛔ `cancelled` used to fall through every raw list to the default and
     read as SUBMITTED — an ask the person had deliberately withdrawn, shown as
     though it were still out there. Both status maps file it under `declined`,
     the "off the table" pile, and deriving the bucket picks that up for free. */
  assert.equal(applicantLabel('cancelled'), 'NOT SELECTED');
});

test('STATUS · an unknown or missing status is SUBMITTED, never dropped', () => {
  // ⛔ A row that falls through every bucket is counted in the total and
  // invisible in every tab — which is how 'offered' hid before.
  assert.equal(applicantLabel(null),        'SUBMITTED');
  assert.equal(applicantLabel(undefined),   'SUBMITTED');
  assert.equal(applicantLabel('brand-new'), 'SUBMITTED');
  APP_TABS.forEach(t => assert.ok(typeof t === 'string'));
  ['pending', 'shortlisted', 'interested', 'accepted', 'booked', 'declined',
   'rejected', 'confirmed', 'offered', 'tentative', 'new', 'viewed', ''].forEach(st => {
    assert.ok(APP_TABS.includes(applicantLabel(st)), `'${st}' lands outside every tab`);
  });
});

/**
 * The host's outgoing list is bucketed by `normaliseStatus`, the panel's own
 * OUTGOING map — AWAITING / INTERESTED / ACCEPTED / DECLINED. `applicantLabel`
 * remains the artist dashboard's, which merges applications and enquiries into
 * one list and needs a vocabulary spanning both. ⛔ Neither may be reimplemented
 * on a screen.
 */
test('STATUS · every venue status finds a home in the outgoing buckets', async () => {
  const { normaliseStatus } = await import('./enquiryUtils.js');
  const buckets = ['awaiting', 'interested', 'accepted', 'declined'];
  ['pending', 'new', 'shortlisted', 'tentative', 'offered', 'accepted',
   'confirmed', 'booked', 'declined', 'rejected', 'unrecognised', ''].forEach(st => {
    const b = normaliseStatus({ direction: 'outgoing', status: st });
    assert.ok(buckets.includes(b), `'${st}' lands outside every outgoing tab (${b})`);
  });
});

test('STATUS · the host dashboard defines no status vocabulary of its own', () => {
  assert.doesNotMatch(HOST_DASH, /function applicantLabel|function normaliseStatus/,
    'the host dashboard has grown its own copy of the status mapping');
});

// ── NOTIFICATION LINKAGE ────────────────────────────────────────────────────

/**
 * ⭐⭐ THE REPLY GOES TO THE PROFILE THAT ASKED, and the row already names it.
 *
 * This was `resolvePerformerProfileId(artistId)` — "which act does this account
 * perform as", a different question. For a host who enquired about a room it
 * returns their DJ act, or null: the venue's answer addressed to a profile that
 * never asked, or to nobody. Same class of defect as acceptInvite losing
 * attribution (D1), same fix.
 */
test('NOTIFICATION · the venue\'s reply is addressed to the profile that asked', () => {
  const respond = VENUE_DASH.slice(VENUE_DASH.indexOf('async function handleEnquiryRespond'));
  const body    = respond.slice(0, respond.indexOf('\n  }\n'));
  assert.match(body, /toProfileId:\s+enq\.applicant_profile_id/,
    "the reply is addressed to a re-derived performer profile, not the one that enquired");
});

test('NOTIFICATION · the legacy seam stays, and only as a fallback', () => {
  const respond = VENUE_DASH.slice(VENUE_DASH.indexOf('async function handleEnquiryRespond'));
  const body    = respond.slice(0, respond.indexOf('\n  }\n'));
  assert.match(body, /enq\.applicant_profile_id[\s\S]{0,120}\?\?[\s\S]{0,80}resolvePerformerProfileId/,
    'rows written before applicant_profile_id was populated now notify nobody');
});

/**
 * The enquiry that STARTS the chain notifies the venue, and its `about` is the
 * asking profile — whichever type that is. Nothing here may narrow to a
 * performer.
 */
test('NOTIFICATION · the enquiry itself is attributed to the asking profile', () => {
  assert.match(PROFILE_SCREEN, /aboutProfileId: enquiryProf\.id \?\? null,/,
    'the enquiry notification names something other than the profile that sent it');
});
