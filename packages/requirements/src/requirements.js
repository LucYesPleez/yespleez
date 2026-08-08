/**
 * REQUIREMENTS ENGINE — one predicate vocabulary for "what does this profile have?"
 * ---------------------------------------------------------------------------
 * Design: docs/professional-profile-requirements-engine-design-2026-08.md
 *
 * Two consumers, one engine:
 *
 *   1. PROFILE COMPLETION — the dashboard percentage. Was three copy-pasted
 *      closures (ArtistDashboard, HostDashboard, VenueDashboard), each with its
 *      own field list and its own idea of what "complete" means.
 *   2. OPPORTUNITY REQUIREMENTS — what an opportunity declares it needs, and
 *      whether an applicant can submit. Arrives at P4/P5; the engine is built
 *      for it now so there is never a second validator.
 *
 * ── WHY THE THREE CLOSURES HAD TO GO ─────────────────────────────────
 *
 * `PerformerDashboard` renders `ArtistDashboard` with a config, so BAND and
 * COMEDY profiles were scored against the ARTIST field list. That list counts
 * `sound`, `mixcloud`, `soundcloud` and `youtube` — columns those editors never
 * write. The result was a silent ceiling nobody could see from the code:
 *
 *     band    — no `sound`, no `mixcloud`                  → capped at 15/17 = 88%
 *     comedy  — no `sound`/`soundcloud`/`mixcloud`/`youtube` → capped at 13/17 = 76%
 *
 * A comedian could fill in every field their editor offers and still be told
 * they were 76% complete, forever. Per-type key lists fix it: each type is now
 * measured only against what its own editor collects.
 *
 * ⚠ ARTIST, HOST and VENUE ARITHMETIC IS PRESERVED EXACTLY. Their key lists and
 * predicates reproduce the old closures field-for-field, so no existing user's
 * percentage moves. Band and comedy go UP (they can now reach 100%). That
 * direction is deliberate — see the design's I4.
 *
 * ── THE PREDICATES, AND WHY THERE ARE THREE ──────────────────────────
 *
 * `'N/A'` is a literal string written into the column (see useProfileForm's
 * loadNa/toggleNa). It means "I was asked and I declined", which is NOT the
 * same as "never answered" — the Rendering Contract's R1, already implemented
 * in the old closures as the filled/done split. Kept, and made explicit:
 *
 *   filled   — a real value. 'N/A' is NOT an accepted answer (identity fields).
 *   done     — answered. 'N/A' IS an accepted answer (links and socials).
 *   answered — a tri-state boolean has been set either way (has_abn).
 *
 * Which predicate a key uses is what decides whether declining is allowed, so
 * changing one changes a user's percentage. Don't swap them casually.
 */

import { ASSET_REQUIREMENT_KEYS, assetLabel } from './profileAssets.js';

/** The six profile sections (design §9). One vocabulary: requirement grouping,
 *  readiness breakdown, and how the profile is described. Files are ALWAYS
 *  `assets` — a stage plot is an Asset, not Technical (I6). */
export const SECTIONS = ['identity', 'media', 'technical', 'commercial', 'availability', 'assets'];

/**
 * The canonical key registry. Requirements reference keys, never columns —
 * so the existing `mix_link`/`epk_link`/`video_link` and
 * `fee_travel`/`fee_plus_travel` duplication is absorbed here rather than
 * spreading into every opportunity that wants a demo mix (design I5).
 *
 * ⚠ BLOCKING RULE, REVISED 2026-08-03. Design §5.2 originally read every
 * requirement's `kind` to decide blocking: a ticked FIELD was required, a
 * ticked FILE only requested, so an opportunity could never withhold a
 * decision merely because a press kit hadn't been uploaded. The owner
 * overrode that: EVERY ticked item is now mandatory, field or file alike —
 * one tick means one requirement, with no second state to design, explain
 * or drift out of sync between the checklist and the engine. `kind` still
 * decides HOW a requirement is satisfied (a column read vs. an asset-table
 * lookup); it no longer decides WHETHER it can block.
 */
const FIELD_KEYS = {
  // ── Identity ──────────────────────────────────────────────
  ACT_NAME:       { label: 'Name',              section: 'identity',   kind: 'profile_field', column: 'name',           predicate: 'filled' },
  PROFILE_PHOTO:  { label: 'Profile Photo',     section: 'identity',   kind: 'profile_field', column: 'avatar',         predicate: 'filled' },
  LOCATION:       { label: 'Location',          section: 'identity',   kind: 'profile_field', column: 'location',       predicate: 'filled' },
  STATE:          { label: 'State',             section: 'identity',   kind: 'profile_field', column: 'state',          predicate: 'filled' },
  TAGLINE:        { label: 'Tagline',           section: 'identity',   kind: 'profile_field', column: 'tagline',        predicate: 'filled' },
  BIO:            { label: 'Bio',               section: 'identity',   kind: 'profile_field', column: 'bio',            predicate: 'filled' },
  SOUND:          { label: 'Sound',             section: 'identity',   kind: 'profile_field', column: 'sound',          predicate: 'filled' },
  GENRES:         { label: 'Genres',            section: 'identity',   kind: 'profile_field', column: 'genre_string',   predicate: 'filled' },
  CARD_TAGS:      { label: 'Card Tags',         section: 'identity',   kind: 'profile_field', column: 'card_pills',     predicate: 'filled' },
  VENUE_TYPE:     { label: 'Venue Type',        section: 'identity',   kind: 'profile_field', column: 'venue_type',     predicate: 'filled' },
  CONTACT_EMAIL:  { label: 'Contact Email',     section: 'identity',   kind: 'profile_field', column: 'contact_email',  predicate: 'done' },
  EMERGENCY_CONTACT: { label: 'Emergency Contact', section: 'identity', kind: 'profile_field', column: 'emergency_name', predicate: 'filled' },

  // ── Media ─────────────────────────────────────────────────
  DEMO_MIX:       { label: 'Demo Mix',          section: 'media',      kind: 'profile_field', column: 'mix_link',       predicate: 'filled' },
  WEBSITE:        { label: 'Website',           section: 'media',      kind: 'profile_field', column: 'website',        predicate: 'done' },
  SOUNDCLOUD:     { label: 'SoundCloud',        section: 'media',      kind: 'profile_field', column: 'soundcloud',     predicate: 'done' },
  MIXCLOUD:       { label: 'Mixcloud',          section: 'media',      kind: 'profile_field', column: 'mixcloud',       predicate: 'done' },
  SPOTIFY:        { label: 'Spotify',           section: 'media',      kind: 'profile_field', column: 'spotify',        predicate: 'done' },
  YOUTUBE:        { label: 'YouTube',           section: 'media',      kind: 'profile_field', column: 'youtube',        predicate: 'done' },
  INSTAGRAM:      { label: 'Instagram',         section: 'media',      kind: 'profile_field', column: 'instagram',      predicate: 'done' },
  FACEBOOK:       { label: 'Facebook',          section: 'media',      kind: 'profile_field', column: 'facebook',       predicate: 'done' },
  TIKTOK:         { label: 'TikTok',            section: 'media',      kind: 'profile_field', column: 'tiktok',         predicate: 'done' },

  // ── Technical ─────────────────────────────────────────────
  // `tech_setup` is a shared column that only the artist editor writes today.
  // Until the band/comedy editors offer it (P3) it is deliberately absent from
  // their completion lists — scoring a type on a field it cannot fill is the
  // exact bug this module exists to remove.
  TECH_SETUP:     { label: 'Technical Setup',   section: 'technical',  kind: 'profile_field', column: 'tech_setup',     predicate: 'filled' },
  CAPACITY:       { label: 'Capacity',          section: 'technical',  kind: 'profile_field', column: 'capacity',       predicate: 'filled' },

  // ── Commercial ────────────────────────────────────────────
  FEE_EXPECTATION:{ label: 'Fee',               section: 'commercial', kind: 'profile_field', column: 'fee_type',       predicate: 'filled' },
  ABN:            { label: 'ABN',               section: 'commercial', kind: 'profile_field', column: 'has_abn',        predicate: 'answered' },
  GST_STATUS:     { label: 'GST Status',        section: 'commercial', kind: 'profile_field', column: 'gst_registered', predicate: 'answered' },

};

/**
 * Asset requirement keys are DERIVED from the asset registry, never re-declared
 * here. Two hand-maintained lists of the same nine strings is precisely the
 * duplicate-source-of-truth this codebase keeps paying for elsewhere
 * (mix_link/epk_link/video_link, fee_travel/fee_plus_travel). Adding an asset
 * type in profileAssets.js makes it requestable here with no second edit.
 */
const ASSET_KEYS = Object.fromEntries(
  ASSET_REQUIREMENT_KEYS.map(k => [k, {
    label: assetLabel(k), section: 'assets', kind: 'asset', assetType: k,
  }])
);

/** The canonical namespace an opportunity may reference: profile fields + assets. */
export const REQUIREMENT_KEYS = { ...FIELD_KEYS, ...ASSET_KEYS };

/**
 * Which keys count toward each profile type's completion percentage.
 *
 * ⚠ EVERY KEY HERE MUST BE A FIELD THAT TYPE'S EDITOR ACTUALLY WRITES.
 * That is the whole point — see the header. Before adding one, check the
 * editor's save() payload.
 *
 * artist / host / venue reproduce the old closures exactly. band and comedy
 * drop the artist-only fields they were being scored on and add their own.
 */
export const COMPLETION_KEYS = {
  // ArtistProfileScreen.jsx save() — 17 keys, byte-for-byte the old list.
  artist: [
    'ACT_NAME', 'PROFILE_PHOTO', 'LOCATION', 'SOUND', 'TAGLINE', 'BIO', 'GENRES',
    'DEMO_MIX', 'CARD_TAGS', 'FEE_EXPECTATION', 'EMERGENCY_CONTACT', 'ABN',
    'SOUNDCLOUD', 'MIXCLOUD', 'INSTAGRAM', 'YOUTUBE', 'FACEBOOK',
  ],
  // BandProfileScreen.jsx save() — no `sound`, no `mixcloud`; has `spotify`.
  band: [
    'ACT_NAME', 'PROFILE_PHOTO', 'LOCATION', 'TAGLINE', 'BIO', 'GENRES',
    'DEMO_MIX', 'CARD_TAGS', 'FEE_EXPECTATION', 'EMERGENCY_CONTACT', 'ABN',
    'SOUNDCLOUD', 'SPOTIFY', 'INSTAGRAM', 'YOUTUBE', 'FACEBOOK',
  ],
  // StandupProfileScreen.jsx save() — no `sound`/`soundcloud`/`mixcloud`/`youtube`; has `tiktok`.
  standup: [
    'ACT_NAME', 'PROFILE_PHOTO', 'LOCATION', 'TAGLINE', 'BIO', 'GENRES',
    'DEMO_MIX', 'CARD_TAGS', 'FEE_EXPECTATION', 'EMERGENCY_CONTACT', 'ABN',
    'INSTAGRAM', 'TIKTOK', 'FACEBOOK',
  ],
  // HostProfileScreen.jsx save() — 8 keys, the old list. Host collects no
  // commercial fields at all, so none are scored.
  host: [
    'ACT_NAME', 'PROFILE_PHOTO', 'LOCATION', 'SOUND', 'TAGLINE', 'GENRES', 'BIO', 'WEBSITE',
  ],
  // VenueProfileScreen.jsx select/save — 13 keys, the old list.
  venue: [
    'ACT_NAME', 'PROFILE_PHOTO', 'LOCATION', 'STATE', 'VENUE_TYPE', 'CAPACITY',
    'SOUND', 'TAGLINE', 'BIO', 'GENRES', 'WEBSITE', 'INSTAGRAM', 'CONTACT_EMAIL',
  ],
};

/**
 * The `profiles` columns needed to evaluate a set of keys, deduped.
 *
 * ⚠ THE FAILURE THIS PREVENTS IS SILENT. A caller that fetches a PARTIAL
 * profiles row and evaluates against it gets a wrong answer, not an error: an
 * unselected column arrives as `undefined`, which every predicate reads as
 * `absent`. A complete profile scores 70%, or a met requirement reads as
 * unmet, and the number looks entirely plausible.
 *
 * Two callers fetch a subset and evaluate: the dashboards' enquiry join (a
 * display subset — see ENQUIRY_CARD_COLUMNS) and the apply flow (only what an
 * opportunity actually asked for). Both derive their list from here rather
 * than keeping one by hand, which is how EnquiryCard's FEE and EMAIL rows came
 * to read columns nobody fetched.
 *
 * Asset keys contribute no column — they resolve against `dossier.assets`.
 */
export function columnsFor(keys) {
  return [...new Set(
    (keys || []).map(key => FIELD_KEYS[key]?.column).filter(Boolean)
  )];
}

/** Every column any completion list reads. */
export const COMPLETION_COLUMNS = columnsFor(Object.values(COMPLETION_KEYS).flat());

/**
 * P4 · THE KEYS A HOST MAY TICK, in checklist order.
 *
 * Design §5.4's list, minus two entries. `SOCIALS` and `AVAILABLE_ON_DATE`
 * appear there but resolve to nothing in the registry today — there is no
 * combined-socials predicate and no availability read in the dossier. The
 * engine would hand either back as `state: 'unknown', blocking: false`, which
 * is the right behaviour for a STALE key on an old opportunity but the wrong
 * thing to offer on a fresh checklist: a host would tick "Available on the
 * date", no applicant could ever satisfy it, and the requirement would read as
 * permanently unmet through no one's fault.
 *
 * I5 is the governing rule — a key exists only if the thing it resolves to
 * already exists. Both are one-line additions here the day their predicate
 * lands; `requirements.test.js` fails if anything in this list stops
 * resolving, so the list cannot rot back into offering a phantom.
 *
 * Deliberately NOT offered, though they resolve: `STATE`, `SOUND`, `TAGLINE`,
 * `CARD_TAGS`, `EMERGENCY_CONTACT`, the individual socials, and the venue-only
 * `VENUE_TYPE` / `CAPACITY`. A checklist of everything is a checklist nobody
 * reads, and an applicant's emergency contact is not a booking precondition.
 */
export const REQUESTABLE_KEYS = [
  // Identity
  'ACT_NAME', 'BIO', 'PROFILE_PHOTO', 'LOCATION', 'CONTACT_EMAIL',
  // Media
  'DEMO_MIX', 'WEBSITE',
  // Technical
  'TECH_SETUP',
  // Commercial
  'FEE_EXPECTATION', 'ABN', 'GST_STATUS',
  // Assets — every requestable asset type, from the registry (never re-listed)
  ...ASSET_REQUIREMENT_KEYS,
];

/**
 * The checklist, grouped for display. Section order is SECTIONS; within a
 * section, REQUESTABLE_KEYS order. Empty sections are omitted rather than
 * rendered as an empty heading (R5 — no visual holes).
 */
export function requestableBySection() {
  return SECTIONS
    .map(section => ({
      section,
      keys: REQUESTABLE_KEYS.filter(k => REQUIREMENT_KEYS[k]?.section === section),
    }))
    .filter(g => g.keys.length > 0);
}

/** Display label for a requirement key. Falls back to the key itself so a
 *  stale requirement on an old opportunity still names something. */
export function requirementLabel(key) {
  return REQUIREMENT_KEYS[key]?.label || key;
}

/**
 * P5 · THE SUBMISSION SNAPSHOT — a record of a VERDICT, not a copy of a profile.
 *
 * ── WHY A SNAPSHOT AT ALL, WHEN NOTHING ELSE HERE IS ONE ──
 *
 * Profile completion is deliberately live: EnquiryCard recomputes it on every
 * read, because "how complete is this act" is a question about now. A
 * submitted application asks a different question — "did they meet what I
 * asked, when they asked?" — and that one has an answer only at a moment. A
 * host opening an application six months later must not see 6/8 because the
 * artist deleted a press kit last week; that would silently rewrite what was
 * submitted.
 *
 * ── WHY THE VERDICT AND NOT THE PROFILE ──
 *
 * Copying profile fields onto the application would re-create exactly the
 * copy-by-value the identity migration (M1–M6, M14) spent itself removing —
 * and it would rot: a renamed act, a re-uploaded asset, an edited bio all make
 * the copy a lie about the present while claiming to describe the past.
 *
 * The verdict has neither problem. It is immutable by nature (a decision made
 * at a time), it stays true when the profile changes, and it survives the HOST
 * editing `required_items` afterwards — which is why `required_items` is
 * stored here too rather than re-read from the event. Live values are still
 * one join away, so "8/8 at submission · 7/8 now" is a comparison of two
 * verdicts rather than a diff of two profile copies.
 *
 * NOT stored: labels (derivable, and they would go stale against the
 * registry), profile values, and anything the applicant did not supply. The
 * snapshot records what was asked and how it was answered — nothing more.
 */
export function snapshotEvaluation(evaluation, requiredItems, at = new Date()) {
  return {
    v: 1,
    evaluated_at: at.toISOString(),
    required_items: [...(requiredItems || [])],
    items: (evaluation?.items || []).map(it => ({ key: it.key, state: it.state })),
    satisfied: evaluation?.satisfiedCount ?? 0,
    total: evaluation?.totalCount ?? 0,
  };
}

// ── Predicates ────────────────────────────────────────────────────────
// Lifted verbatim from the closures they replace. `String(v).trim()` is the
// VenueDashboard variant; the ArtistDashboard one used `v.trim &&`, which
// silently failed any non-string truthy. Every column involved is text, so the
// two agree on real data — this is the more correct of the pair.

const filled = v => !!(v && v !== 'N/A');
const nonEmpty = v => !!(v !== null && v !== undefined && String(v).trim());

/** satisfied | withheld | absent — never throws, never returns undefined. */
function fieldState(predicate, value) {
  if (predicate === 'answered') return value !== null && value !== undefined ? 'satisfied' : 'absent';
  // 'N/A' means the user was asked and declined. Only `done` keys accept that
  // as an answer; a `filled` key treats it as still missing.
  if (value === 'N/A') return predicate === 'done' ? 'withheld' : 'absent';
  if (predicate === 'done') return nonEmpty(value) ? 'satisfied' : 'absent';
  return filled(value) ? 'satisfied' : 'absent';
}

/** A current asset of this type exists. P2 supplies `dossier.assets`; until
 *  then the list is empty and every asset key reads `absent` — which is
 *  correct, not a stub. */
function assetState(assetType, assets) {
  const has = (assets || []).some(a => a && a.asset_type === assetType && a.is_current !== false);
  return has ? 'satisfied' : 'absent';
}

/** States that count as "the applicant has dealt with this". Declining is an
 *  answer (design §8) — it completes a section and never blocks a submission. */
const SETTLED = new Set(['satisfied', 'withheld']);

/**
 * The engine. Compares a list of requirement keys against a dossier.
 *
 * @param {string[]} keys      requirement keys — an opportunity's tick-list, or a completion list
 * @param {object}   dossier   { profile, assets }
 * @param {object}   _context  { opportunityDate } — RESERVED, deliberately unread today.
 *                             The design's §10 keeps this third argument from day one so
 *                             date-aware predicates (an insurance certificate valid on the
 *                             event date, not merely present) land later as a pure addition
 *                             rather than a signature change rippling through every caller.
 *                             Underscored only to satisfy no-unused-vars; callers pass
 *                             `context` positionally and the name is not part of the contract.
 * @returns {{items: object[], canSubmit: boolean, satisfiedCount: number, totalCount: number,
 *            blockingCount: number, sections: object}}
 */
export function evaluate(keys, dossier = {}, _context = {}) {
  const profile = dossier.profile || {};
  const assets = dossier.assets || [];

  const items = (keys || []).map(key => {
    const def = REQUIREMENT_KEYS[key];

    // An unrecognised key must not silently vanish — a venue that asked for
    // something would see their requirement disappear. It is surfaced and
    // deliberately NON-blocking, so a stale key can never trap an applicant
    // behind something they cannot fix. (Same instinct as enquiryUtils'
    // unrecognised-status fallback: give it a home rather than dropping it.)
    if (!def) return { key, label: key, section: 'identity', kind: 'unknown', state: 'unknown', blocking: false };

    const state = def.kind === 'asset'
      ? assetState(def.assetType, assets)
      : fieldState(def.predicate, profile[def.column]);

    // Every recognised key blocks now, field or asset alike — see the
    // 2026-08-03 note above the registry. Only an UNRECOGNISED key (above)
    // stays non-blocking.
    return { key, label: def.label, section: def.section, kind: def.kind, state, blocking: true };
  });

  const sections = {};
  for (const it of items) {
    const s = sections[it.section] || (sections[it.section] = { total: 0, satisfied: 0, pct: 0 });
    s.total += 1;
    if (SETTLED.has(it.state)) s.satisfied += 1;
  }
  for (const s of Object.values(sections)) s.pct = s.total ? (s.satisfied / s.total) * 100 : 0;

  const satisfiedCount = items.filter(it => SETTLED.has(it.state)).length;
  const blocking = items.filter(it => it.blocking && !SETTLED.has(it.state));

  return {
    items,
    sections,
    satisfiedCount,
    totalCount: items.length,
    blockingCount: blocking.length,
    canSubmit: blocking.length === 0,
  };
}

/**
 * Profile completion for a dashboard.
 *
 * @param {object} profile the profiles row
 * @param {string} type    the profile type — pass it explicitly. ArtistDashboard
 *                         serves band and comedy through PerformerDashboard's
 *                         config, so `cfg.profileType` is authoritative and the
 *                         row's own `type` is not always what the screen means.
 * @returns {{pct: number, sections: object, items: object[]}|null} null when
 *          there is no profile or the type has no completion list — the caller
 *          passes `undefined` to DashboardProfileCard, which hides the bar.
 */
export function completionFor(profile, type) {
  const t = type || profile?.type;
  const keys = COMPLETION_KEYS[t];
  if (!profile || !keys) return null;
  const result = evaluate(keys, { profile });
  return {
    pct: result.totalCount ? (result.satisfiedCount / result.totalCount) * 100 : 0,
    sections: result.sections,
    items: result.items,
  };
}
