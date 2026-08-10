/**
 * ASK CATEGORY — what an interaction is asking FOR.
 * Design: `Claude Cowork\ask-category-design-2026-08-10.md` (ratified 2026-08-10).
 *
 * ⭐⭐ THE GOVERNING RULE:
 *
 *     An Ask Category must describe the requested SUPPLY,
 *     ⛔ not the identity of the person supplying it.
 *
 * That is the test every category, present and future, has to pass.
 *
 * ── ⚠⚠ "CATEGORY" ALREADY MEANS FOUR OTHER THINGS. ⛔ NEVER MERGE THEM. ──
 *
 *   Festival's CATEGORIES        what a festival RECRUITS      apps/festival/src/config
 *   Scene's CATEGORY_BADGES      what kind of EVENT it is      apps/scene/src/lib/eventBadges
 *   HOST_CATEGORIES / *_ROLES    what kind of ACT someone is   apps/scene/src/lib/profileTaxonomy
 *   THIS                         what is being asked FOR
 *
 * ── ⭐ THREE DIMENSIONS, NEVER COLLAPSED ──
 *
 *     ASK
 *     ├── interaction_type   enquiry · application · invitation
 *     ├── ask_category       ← this file
 *     └── context            event · venue · date · acting profile · terms
 *
 * ⛔ A chip never reads "Enquiry" or "Application". That is the mechanism.
 *
 * ── ⛔ WHY THIS IS A PACKAGE AND NOT A TABLE (for now) ──
 *
 * With `applies_to` deliberately excluded, the registry is nine static rows of
 * vocabulary nobody edits at runtime, and Scene is its only consumer. A table
 * plus RLS plus a seed migration would be more machinery than the need.
 *
 * ⭐ THE TRIGGER TO MOVE IT TO DATA, so nobody has to re-derive it: when
 * FESTIVAL reads this instead of its own config, or when a category must be
 * added without a deploy. Until then, one file beats one table.
 */

/**
 * ⚠ `key` IS STORED on interaction rows and must never change once shipped.
 * `label` is display-only and free to edit any time — which is exactly why the
 * key is stored and the label never is.
 *
 * ⭐ The keys are Festival's existing 12 MINUS the three `register_interest`
 * trades, so Festival's data needs no migration. `performance_artist` keeps its
 * key and takes the label "Performance": the label does not need to equal the
 * key, and preserving the key is what keeps that promise.
 *
 * ⛔ EXCLUDED — `sound_system`, `lighting`, `staging`. All three are
 * `register_interest` in Festival's config: the trades are "procured, not
 * auditioned … the durable thing for them is the PROFILE, not the
 * application". No queue, no decision ⇒ NO ASK ⇒ no category.
 * ⚠ That is also the test for contractors and workers when they arrive.
 *
 * ⚠ `FOOD VENDORS` and `VOLUNTEERS` still name the SUPPLIER rather than the
 * supply, and are kept deliberately (owner, 2026-08-10). Revisit only if a chip
 * reads wrong in use.
 */
export const ASK_CATEGORIES = [
  { key: 'music',              label: 'Music',         active: true, sort_order: 10 },
  { key: 'performance_artist', label: 'Performance',   active: true, sort_order: 20 },
  { key: 'workshop',           label: 'Workshops',     active: true, sort_order: 30 },
  { key: 'market_stall',       label: 'Market Stalls', active: true, sort_order: 40 },
  { key: 'food_vendor',        label: 'Food Vendors',  active: true, sort_order: 50 },
  { key: 'decor',              label: 'Decor',         active: true, sort_order: 60 },
  { key: 'media',              label: 'Media',         active: true, sort_order: 70 },
  { key: 'theme_camp',         label: 'Theme Camps',   active: true, sort_order: 80 },
  { key: 'volunteer',          label: 'Volunteers',    active: true, sort_order: 90 },
];

const BY_KEY = Object.fromEntries(ASK_CATEGORIES.map(c => [c.key, c]));

/** Every key, in display order. */
export const ASK_CATEGORY_KEYS = ASK_CATEGORIES.map(c => c.key);

/**
 * The definition for a key, or null.
 *
 * ⛔ Null for an unrecognised key rather than a guess — the same instinct as
 * `assetType()` and `profileIdentity()`: a stored key we no longer recognise
 * must never silently borrow another category's identity.
 */
export function askCategory(key) {
  return BY_KEY[key] || null;
}

/**
 * The label to show, or null.
 *
 * ⭐ NULL IS A REAL ANSWER AND MUST RENDER NOTHING. Three separate cases arrive
 * here as null, and all three mean "no chip":
 *   · the record predates Ask Categories (historical NULL — a fact, not a gap)
 *   · the asker had no applicable category (host, festival)
 *   · the stored key is no longer in the registry
 *
 * ⛔ Never fall back to the raw key. A chip reading `performance_artist` is
 * engine vocabulary on a user's screen.
 */
export function askCategoryLabel(key) {
  return BY_KEY[key]?.label ?? null;
}

/** Active categories in display order — for a picker, when one is ever built. */
export function activeAskCategories() {
  return ASK_CATEGORIES.filter(c => c.active)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** Is this a key the registry knows? Unknown keys are surfaced, never coerced. */
export function isAskCategory(key) {
  return Boolean(BY_KEY[key]);
}
