import { supabase } from './supabase';
import { localDateStr } from './dates';

/**
 * APPLYING TO A FESTIVAL, FROM SCENE.
 *
 * ⭐ OWNER'S RULING, 2026-08-06, which reversed the previous day's hand-off:
 *
 *   "A festival profile should behave exactly like every other profile in
 *   Scene. When someone taps an event, it should open the normal Scene event
 *   page, not switch applications. The public doesn't need to know a Festival
 *   app exists."
 *
 * So the public never leaves Scene. The Festival app is the ORGANISER's tool —
 * it creates the festival, configures the event, and reviews what arrives.
 *
 * ⚠ THE PIPELINE RULE SURVIVED THAT REVERSAL, and it is the important part:
 * there is still exactly ONE table a festival application may land in. Scene's
 * own `applications` table is for a host's event; a festival's application goes
 * to `festival_applications`, which is what the organiser's dashboard reads.
 * Writing to the wrong one loses the application silently — no error, and the
 * organiser never learns anyone applied.
 */

/**
 * ⛔ DUPLICATED FROM THE FESTIVAL PORTAL'S `config/categories.js`, AND THAT IS
 * DEBT, NOT A DESIGN.
 *
 * `appliesAs` — which profile types may apply to a category — is the Portal's
 * to own, and Scene now needs it too because Scene is where people apply. The
 * two repos cannot share code yet (the `@yespleez/*` packages do not exist), so
 * this is a second copy of a fact, which is the failure mode this codebase
 * spent 2026-08-06 removing everywhere else.
 *
 * ⭐ THE FIX, WHEN THERE IS ROOM FOR IT: move `label` and `applies_as` onto a
 * shared `festival_category_registry` table so both apps read one row. A
 * category's eligible profile types is platform DATA — a noun — and the
 * platform owns nouns. Do that before a third category opens; two copies of two
 * entries is survivable, two copies of twelve is not.
 *
 * Kept deliberately SHORT: only the categories that can actually be applied to
 * are listed. The other ten have no eligible profile type in the Portal either,
 * so copying them would duplicate ten pieces of nothing.
 */
const APPLICABLE_CATEGORIES = {
  music: {
    label: 'Performers',
    appliesAs: ['artist', 'band'],
    blurb: 'DJs, live acts and bands',
  },
  volunteer: {
    // ⭐ `punter`, not a `volunteer` profile type — every account already has a
    // punter identity from registration, so there is nothing to create first.
    // Ratified: "one registered punter can have any or even all roles."
    label: 'Volunteer Crew',
    appliesAs: ['punter'],
    blurb: 'Help make it happen',
    // WHAT is asked is a property of volunteering; WHICH OPTIONS belong to the
    // event. Both lists come from the organiser's configuration below.
    asksAvailability: true,
    asksDepartments: true,
  },
};

const PHASES = [
  ['build_starts_on', 'build_ends_on', 'build'],
  ['starts_on', 'ends_on', 'festival'],
  ['packdown_starts_on', 'packdown_ends_on', 'pack-down'],
];

/**
 * The days an applicant can offer, DERIVED from the organiser's date ranges.
 *
 * ⭐ NEVER A LIST THE ORGANISER TYPES. Every real volunteer form writes its own
 * dates by hand — Dragon Dreaming's runs thirteen of them — which is thirteen
 * chances to typo something that already exists as configuration.
 *
 * Returns [] when no dates are set, and that is a real state rather than a
 * failure: a festival that has not chosen dates cannot ask anyone which of them
 * they can work, so the caller renders nothing and the apply stays one-click.
 *
 * @param {object|null} settings a `festival_event_settings` row
 */
export function festivalDayOptions(settings) {
  if (!settings) return [];
  const out = [];
  for (const [fromKey, toKey, phase] of PHASES) {
    const from = settings[fromKey];
    const to = settings[toKey];
    if (!from || !to) continue;
    const d = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime())) continue;
    // A reversed or absurd range is something an organiser can type, and a UI
    // that hangs is a worse answer than one that shows nothing.
    let guard = 0;
    while (d <= end && guard++ < 400) {
      /**
       * ⚠ THE LABEL AND THE VALUE MUST NAME THE SAME DAY, and for a long time
       * they did not.
       *
       * This was `d.toISOString().slice(0, 10)` while the label beside it came
       * from `toLocaleDateString` — one UTC, one local. `d` starts at LOCAL
       * midnight (`${from}T00:00:00`), which in AEST is 14:00 the previous day
       * in UTC, so every option READ "Fri, 14 Aug" and SUBMITTED "2026-08-13".
       *
       * ⛔ Worse than the `todayStr` bug in MySceneScreen, not the same shape.
       * That one misfired only between local midnight and the UTC rollover and
       * looked fine every afternoon. This was wrong at every hour of every day,
       * and silently: the volunteer picked the right-looking day and the stored
       * availability named the day before.
       */
      const iso = localDateStr(d);
      if (!out.some(o => o.value === iso)) {
        out.push({
          value: iso,
          label: d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }),
          phase,
        });
      }
      d.setDate(d.getDate() + 1);
    }
  }
  return out;
}

/**
 * The categories this event is currently taking applications for, in the order
 * the registry lists them.
 *
 * ⚠ A CATEGORY THE ORGANISER OPENED BUT SCENE CANNOT SERVE IS OMITTED, not
 * shown as disabled. Scene has never heard of market stalls or decor — that
 * ignorance is deliberate and is what keeps them out of Scene's discovery — so
 * rendering a dead "Market Stalls" row here would be Scene claiming knowledge
 * it does not have, and offering something it cannot deliver.
 *
 * @param {string} eventId
 * @returns {Promise<Array<{key,label,blurb,appliesAs,decisionMode}>>}
 */
export async function listOpenFestivalCategories(eventId) {
  if (!eventId) return [];
  const { data, error } = await supabase
    .from('festival_categories')
    .select('key, state, decision_mode')
    .eq('event_id', eventId)
    .eq('state', 'open');
  if (error) return [];

  const open = new Set((data || []).map(r => r.key));
  const modes = Object.fromEntries((data || []).map(r => [r.key, r.decision_mode]));

  return Object.entries(APPLICABLE_CATEGORIES)
    .filter(([key]) => open.has(key))
    .map(([key, c]) => ({ key, ...c, decisionMode: modes[key] ?? 'hold' }));
}

/**
 * What this account has already applied for on this event.
 *
 * ⭐ THROUGH AN RPC, NEVER THE TABLE, and copying that from the Portal is not
 * optional. Applicants have NO select on `festival_applications` by design:
 * RLS cannot hide a COLUMN, so a readable row would expose `status` — including
 * an `accepted` the organiser has not released yet. The function is SECURITY
 * DEFINER and masks it server-side, which makes hold-and-release a property of
 * the database rather than a promise Scene's UI makes.
 *
 * ⛔ Do not "optimise" this into a select. It will appear to work.
 *
 * @param {string} eventId
 * @returns {Promise<Array<{categoryKey, status, submittedAt}>>}
 */
export async function myFestivalApplications(eventId) {
  if (!eventId) return [];
  const { data, error } = await supabase.rpc('my_festival_applications', {
    p_event_id: eventId,
  });
  if (error) return [];
  return (data || []).map(r => ({
    categoryKey: r.category_key,
    // ⭐ ALREADY MASKED BY THE DATABASE. `shortlisted` is never exposed and a
    // decision reads `in_review` until the organiser releases it — see
    // my_festival_applications. So this can be rendered directly: there is no
    // outcome here the applicant is not entitled to see.
    status: r.status,
    outcomeReleasedAt: r.outcome_released_at ?? null,
    submittedAt: r.submitted_at ?? null,
  }));
}

/**
 * What an applicant is told about their own application.
 *
 * ⛔ NEVER INVENT A STATE THE DATABASE DID NOT RETURN. The mask is the contract:
 * anything undecided or unreleased arrives as `in_review`, and this must not
 * dress that up as "shortlisted" or guess at progress from elapsed time.
 *
 * The decline wording is deliberate. This is the moment a person finds out, and
 * a festival saying "Declined" in the same flat voice it says "Accepted" reads
 * as a machine sorting them. It is also not the applicant's failure.
 */
export function applicationOutcome(status) {
  switch (status) {
    case 'accepted':  return { label: "YOU'RE IN",    tone: 'good',    note: 'The festival will be in touch with the details.' };
    case 'declined':  return { label: 'NOT THIS TIME', tone: 'closed',  note: 'They could not fit everyone in this year.' };
    case 'withdrawn': return { label: 'WITHDRAWN',     tone: 'closed',  note: 'You withdrew this application.' };
    default:          return { label: 'APPLIED',       tone: 'pending', note: 'The festival has your application.' };
  }
}

/**
 * The event's configured dates and volunteer departments, for the questions a
 * category asks. Both tables are anon-readable so this works signed out.
 *
 * @param {string} eventId
 */
export async function festivalEventConfig(eventId) {
  if (!eventId) return { settings: null, departments: [] };
  const [cfg, depts] = await Promise.all([
    supabase.from('festival_event_settings').select('*').eq('event_id', eventId).maybeSingle(),
    supabase.from('festival_departments').select('id, name, description')
      .eq('event_id', eventId).eq('archived', false).order('sort_order'),
  ]);
  return { settings: cfg.data ?? null, departments: depts.data ?? [] };
}

/**
 * Submit.
 *
 * ⚠ A DUPLICATE IS DETECTED BY LETTING THE DATABASE REJECT IT (23505), not by
 * asking first — because asking first is a select this client is not allowed to
 * make (see above). Applying twice is an ordinary thing a person does, so it is
 * reported plainly rather than thrown.
 *
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function applyToFestival({ eventId, categoryKey, profileId, answers = {} }) {
  if (!eventId || !categoryKey || !profileId) {
    return { ok: false, reason: 'incomplete' };
  }
  const { error } = await supabase.from('festival_applications').insert({
    event_id: eventId,
    category_key: categoryKey,
    from_profile_id: profileId,
    status: 'submitted',
    answers,
  });
  if (error) {
    if (error.code === '23505') return { ok: false, reason: 'already_applied' };
    return { ok: false, reason: 'failed' };
  }
  return { ok: true };
}

export { APPLICABLE_CATEGORIES };
