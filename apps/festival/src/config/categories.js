/**
 * THE CATEGORY REGISTRY — the single description of what a festival recruits.
 *
 * ⭐ Categories are NOT pages. There is one Applications workspace, and this
 * file is what makes it serve every category. Adding "Sponsors" next year is
 * an entry here: a tab appears, the table takes the right columns, the empty
 * state says the right thing. No new route, no new screen, no new component.
 *
 * `columns` names which column definitions (see `columns.js`) that category
 * shows. This is presentation configuration, not filtering — the table is
 * still the single source of truth about how a row renders.
 *
 * Keys match the platform's ratified role keys: `food_vendor` is separate
 * from `market_stall`, and the non-music performance role is
 * `performance_artist` — never `performer`, which would collide with Scene's
 * music artists. ⭐ The LABEL is free to say "Performers"; display and identity
 * were never the same thing.
 *
 * ⚠ A category is NOT always a role. `volunteer` has no role profile behind it
 * — a volunteer applies as their punter identity, which every account already
 * has. Do not assume one-to-one when reading this registry.
 *
 * ⭐ `appliesAs` — WHICH PROFILE TYPES MAY APPLY.
 *
 * The profile IS the application. Applying links an existing profile to a
 * category; it never asks someone to retype what their profile already says,
 * and the organiser reviews the profile rather than a duplicate of it.
 *
 * ⚠ Most categories OMIT it, and that is correct today. A market stall
 * or lighting crew would apply as a `market_stall` / `lighting` profile, and
 * those role types do not exist yet — the platform has six: punter, venue,
 * host, artist, band, standup. An empty list means "nobody can apply to this
 * yet", which the UI must state rather than offering a button that cannot
 * work. Deliverance 2026 runs Music and Volunteer only.
 *
 * ⭐ `punter` is why Volunteer works for everyone: every account already has
 * one, so a volunteer needs no new identity at all.
 *
 * ⭐ `intent` — is this category a QUEUE or a LIST?
 *
 *   open_call         People apply, you review, you accept or decline.
 *   register_interest Crews list themselves so they can be found. No queue,
 *                     no decision, no decline.
 *
 * The trades (sound, lighting, staging) are procured, not auditioned: a
 * festival runs three or four and usually knows them already. Rendered as a
 * competitive queue, "3 applications" reads as broken rather than correct —
 * and "Declined" is the wrong word for a crew you will see next weekend. The
 * durable thing for them is the PROFILE, not the application: listing makes a
 * small crew findable and lets their history accumulate, which is the whole
 * reason they are here.
 */

export const CATEGORIES = [
  {
    key: 'music',
    label: 'Music',
    icon: 'music',
    count: 184,
    noun: 'act',
    appliesAs: ['artist', 'band'],
    intent: 'open_call',
    columns: ['applicant', 'genre', 'country', 'stage', 'status', 'date'],
  },
  {
    key: 'volunteer',
    label: 'Volunteers',
    icon: 'volunteer',
    count: 93,
    noun: 'volunteer',
    // ⚠ The only category with no role profile behind it — a volunteer applies
    // as their punter identity, which every account already has.
    appliesAs: ['punter'],
    /**
     * ⭐ WHAT is asked lives here; WHICH OPTIONS lives on the event.
     *
     * A volunteer application always needs availability and a department
     * preference — that is a property of volunteering, not of one festival.
     * But the DAYS come from the organiser's build/festival/pack-down dates,
     * and the DEPARTMENTS are rows the organiser created. ⛔ Never hardcode
     * either: real lists run 16 at one festival and 30+ at another, and a
     * beach festival's reads Boat Crew / Beach Patrol / Shuttle Drivers.
     *
     * ⛔ Anything durable about the person — skills, emergency contact,
     * accessibility, phone, tickets — lives on `profiles` and is never
     * re-asked. If the answer would be the same at every festival, it does not
     * belong in an application at all.
     */
    asksAvailability: true,
    asksDepartments: true,
    intent: 'open_call',
    /**
     * ⚠⚠ WAS `['applicant','skills','availability','stage','status','date']`
     * and FOUR of those six rendered a permanent dash (measured 2026-08-27).
     *
     * ⛔ `skills` is gone because the platform decided never to collect it —
     * this file's own header says skills live on `profiles` and are never
     * re-asked, so the column reserved 160px for something no volunteer can
     * ever have. ⛔ `stage` is gone because NOTHING writes it, for any
     * category. A column that cannot hold a value is a permanent visual hole,
     * and here it read as "they didn't answer".
     *
     * ⭐ `departments` replaces them: which departments this volunteer
     * offered, which is the fact an organiser allocates on.
     */
    columns: ['applicant', 'departments', 'availability', 'status', 'date'],
  },
  {
    key: 'market_stall',
    label: 'Market Stalls',
    icon: 'market_stall',
    count: 41,
    noun: 'stall',
    intent: 'open_call',
    columns: ['applicant', 'trades', 'frontage', 'stage', 'status', 'date'],
  },
  {
    key: 'food_vendor',
    label: 'Food Vendors',
    icon: 'food_vendor',
    count: 22,
    noun: 'vendor',
    // ⛔ Ratified separate from market_stall: a food truck needs a power
    // allocation and a stall does not, and the columns differ accordingly.
    intent: 'open_call',
    columns: ['applicant', 'cuisine', 'power', 'stage', 'status', 'date'],
  },
  {
    key: 'workshop',
    label: 'Workshops',
    icon: 'workshop',
    count: 18,
    noun: 'workshop',
    intent: 'open_call',
    columns: ['applicant', 'topic', 'duration', 'stage', 'status', 'date'],
  },
  {
    key: 'performance_artist',
    label: 'Performers',
    icon: 'performance_artist',
    count: 27,
    noun: 'act',
    intent: 'open_call',
    columns: ['applicant', 'discipline', 'country', 'stage', 'status', 'date'],
  },
  {
    key: 'decor',
    label: 'Decor',
    icon: 'decor',
    count: 11,
    noun: 'crew',
    intent: 'open_call',
    columns: ['applicant', 'discipline', 'scale', 'stage', 'status', 'date'],
  },
  {
    key: 'media',
    label: 'Media',
    icon: 'media',
    count: 12,
    noun: 'outlet',
    intent: 'open_call',
    columns: ['applicant', 'outlet', 'country', 'stage', 'status', 'date'],
  },
  {
    key: 'theme_camp',
    label: 'Theme Camps',
    icon: 'theme_camp',
    count: 9,
    noun: 'camp',
    intent: 'open_call',
    columns: ['applicant', 'campSize', 'footprint', 'stage', 'status', 'date'],
  },
  // ── The trades. Procured, not auditioned — see `intent` in the header. ──
  {
    key: 'sound_system',
    label: 'Sound Systems',
    icon: 'sound_system',
    count: 6,
    noun: 'rig',
    intent: 'register_interest',
    // No `stage` column: a workflow stage describes progress through a queue,
    // and there is no queue here.
    columns: ['applicant', 'rig', 'power', 'scale', 'status', 'date'],
  },
  {
    key: 'lighting',
    label: 'Lighting',
    icon: 'lighting',
    count: 5,
    noun: 'crew',
    intent: 'register_interest',
    columns: ['applicant', 'discipline', 'power', 'scale', 'status', 'date'],
  },
  {
    key: 'staging',
    label: 'Staging',
    icon: 'staging',
    count: 3,
    noun: 'crew',
    // ⭐ Grouped with sound and lighting, NOT decor: these three share rigging,
    // load ratings and engineering sign-off. Decor is aesthetic and rarely
    // load-bearing, and asking every decor applicant about rigging
    // certification is noise for nine out of ten of them.
    intent: 'register_interest',
    columns: ['applicant', 'scale', 'footprint', 'status', 'date'],
  },
];

/** The "All" pseudo-category. Not in the list above — it is a view of it. */
export const ALL_CATEGORY = {
  key: 'all',
  label: 'All',
  icon: 'dashboard',
  noun: 'application',
  // Explicit rather than absent: "All" spans both intents, and the reviewing
  // affordances have to be present for the open-call rows it contains.
  intent: 'open_call',
  columns: ['applicant', 'category', 'country', 'stage', 'status', 'date'],
  get count() {
    return CATEGORIES.reduce((n, c) => n + c.count, 0);
  },
};

export function getCategory(key) {
  if (!key || key === 'all') return ALL_CATEGORY;
  // An unknown key falls back to All rather than throwing or 404ing: a stale
  // bookmark to a retired category should show the list, not a dead end.
  return CATEGORIES.find(c => c.key === key) || ALL_CATEGORY;
}
