/**
 * THE REACTION REGISTRY — the one definition of what can be reacted with.
 *
 * ⚠ THIS FILE IS THE ONLY PLACE A REACTION IS DECLARED. Adding one is a
 * single entry here plus a single value in the database CHECK (see the
 * `mr1` migration). No component changes: the bar, the counts and the
 * sheet all map over `REACTIONS` and render whatever they find. That is
 * the point of the registry — this release ships exactly SEVEN, and the
 * eighth must not cost an architecture change.
 *
 * ── KEYS ARE STORED, NEVER THE EMOJI CHARACTER ───────────────────────
 *
 * `😶‍🌫️` is not one character. It is face-without-mouth + ZERO WIDTH JOINER +
 * cloud, and `🫡` carries a variation selector on some platforms. Round-trip
 * any of that through a database CHECK, a URL, or a client that normalises
 * Unicode differently and rows stop matching each other for reasons nobody
 * can see in a query result.
 *
 * So the wire format is a short stable key — 'clouds', not the glyph — and
 * the glyph is presentation, owned by this file. Changing which emoji
 * 'woozy' renders as is then a cosmetic edit, not a data migration.
 *
 * ── ⚠ THE HAND IS NOT IN HERE, AND MUST NOT BE ADDED ─────────────────
 *
 * Owner's decision, 2026-07-25: *"the hand is purely on the command bar.
 * it's not an emoji so will not be grouped with them. it also is the one I
 * really want people to use more often. these are just backups for the
 * random times when a laugh emoji would be really good."*
 *
 * The Yes is the platform's own acknowledgement and carries product
 * meaning; these eight are expressive garnish. Putting the Hand in this
 * list would make it one of nine equal choices behind a long press — which
 * is precisely how you get people using it LESS.
 *
 * So the Hand keeps its own faster affordances (the composer button, and
 * double-tap on a message) and is stored in its own column, `handed_at`.
 * A reaction and a Yes are INDEPENDENT facts about the same row: someone
 * may Yes a message and react to it, and the Hand never loses a vote to a
 * laughing cat.
 *
 * If a future edit is tempted to unify them for tidiness, that tidiness
 * costs the distinction the owner asked for. Don't.
 */

/**
 * `custom: true` marks a glyph that is a YesPleez asset rather than an
 * emoji, resolved by the UI (see ReactionGlyph). No entry uses it today —
 * it exists so a future branded reaction does not need a shape change.
 * Kept as a FLAG rather than a component reference so this module stays
 * plain data: it is imported by node tests that have no React renderer.
 */
export const REACTIONS = [
  { key: 'salute',   label: 'Respect',    emoji: '\u{1FAE1}' },            // 🫡
  { key: 'joycat',   label: 'Hilarious',  emoji: '\u{1F639}' },            // 😹
  { key: 'woozy',    label: 'Cooked',     emoji: '\u{1F974}' },            // 🥴
  { key: 'flushed',  label: 'Whoa',       emoji: '\u{1F633}' },            // 😳
  { key: 'clouds',   label: 'Foggy',      emoji: '\u{1F636}\u{200D}\u{1F32B}\u{FE0F}' }, // 😶‍🌫️
  { key: 'facepalm', label: 'Facepalm',   emoji: '\u{1F926}' },            // 🤦
  { key: 'nails',    label: 'Unbothered', emoji: '\u{1F485}' },            // 💅
];

export const REACTION_KEYS = REACTIONS.map(r => r.key);

const BY_KEY = new Map(REACTIONS.map(r => [r.key, r]));

/** True for a key this release knows. */
export function isReactionKey(key) {
  return BY_KEY.has(key);
}

/**
 * The registry entry, or null.
 *
 * ⚠ Callers MUST tolerate null. A row can carry a key this build does not
 * know — an older client writing a reaction that was later removed, or a
 * newer one writing a reaction added after this bundle shipped. Rendering
 * must skip it, never crash and never coerce it into a different reaction,
 * because coercion silently rewrites what somebody said.
 */
export function reactionFor(key) {
  return BY_KEY.get(key) ?? null;
}

/**
 * Roll a message's rows up into what the thread renders beneath a bubble.
 *
 * @param {Array<{profile_id: string, reaction: string}>} rows
 * @param {string|null} viewerProfileId  which profile is "me", for the
 *                                       highlighted state
 * @returns {{counts: Array<{key, label, emoji, custom, count, mine}>, total: number, mine: string|null}}
 *
 * Ordered by the REGISTRY, not by count. Messenger-style bars reorder as
 * counts change, so the same message looks different every time you glance
 * at it; a stable order means a given reaction is always in the same place.
 *
 * Note this covers REACTIONS only. The Yes is counted separately from
 * `handed_at` — see the header on why they are not merged.
 *
 * Unknown keys are counted in `total` but omitted from `counts` — the number
 * stays honest even when this build cannot draw the glyph.
 */
export function summariseReactions(rows, viewerProfileId = null) {
  const tally = new Map();
  let total = 0;
  let mine = null;

  // ⚠ NOT a default parameter. A default only fires for `undefined`, and the
  // realistic bad input here is `null` — a failed fetch, or a Map lookup that
  // missed. This renders under every bubble in a thread, so it must be inert
  // on junk rather than take the thread down with it.
  const list = Array.isArray(rows) ? rows : [];

  for (const row of list) {
    if (!row || !row.reaction) continue;
    total++;
    tally.set(row.reaction, (tally.get(row.reaction) ?? 0) + 1);
    if (viewerProfileId && row.profile_id === viewerProfileId) mine = row.reaction;
  }

  const counts = [];
  for (const def of REACTIONS) {
    const count = tally.get(def.key) ?? 0;
    if (!count) continue;
    counts.push({ ...def, count, mine: mine === def.key });
  }

  return { counts, total, mine };
}

/**
 * What a tap on `key` means, given what this viewer already has.
 *
 * ⚠ ONE ACTIVE REACTION PER PERSON PER MESSAGE. Tapping a different
 * reaction REPLACES rather than adds — which is also what the table's
 * primary key (message_id, profile_id) enforces, so the rule cannot drift
 * between the UI and the database.
 *
 * Pure, so the three-way decision is testable without a renderer.
 *
 * @returns {'set'|'clear'} clear when tapping the one already active
 */
export function decideReactionTap({ current, tapped } = {}) {
  return current === tapped ? 'clear' : 'set';
}
