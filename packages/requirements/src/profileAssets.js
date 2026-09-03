/**
 * PROFILE ASSET TYPES — the canonical registry of reusable professional documents.
 * ---------------------------------------------------------------------------
 * Design: docs/professional-profile-requirements-engine-design-2026-08.md §3
 *
 * The problem this exists to end: an artist uploading the same press kit into
 * every festival's application form, forever. An asset is uploaded once against
 * a profile and referenced by every future opportunity that asks for it.
 *
 * ── I6 — WHAT BELONGS HERE ───────────────────────────────────────────
 *
 * Assets are FILES. If information is reusable and structured it belongs on the
 * profile (a fee, an ABN, a genre). If it is a reusable document or media file
 * it belongs here. That is the whole rule, and it is the one to apply when
 * something new needs a home — the failure mode this prevents is Assets slowly
 * accumulating structured fields until it becomes a second profile.
 *
 * ── WHY THE REGISTRY IS THIS SMALL ───────────────────────────────────
 *
 * `key`, `label`, `cardinality`. Nothing else.
 *
 * The first draft also carried `scope` (profile vs account), `expires`, and an
 * `enabled` flag. All three were cut because every row had the same value —
 * a property whose value never varies is not a property, it is a decision
 * already made. `cardinality` survives because it genuinely differs TODAY:
 * promo photos and logo packs are many-of, a press kit is one. That is also the
 * one that cannot be retrofitted cheaply, because the UI and the storage path
 * both depend on it.
 *
 * ⚠ `key` IS STORED in `profile_assets.asset_type` and in an opportunity's
 * requirement list. It must never change once shipped. `label` is display-only
 * and free to edit any time — the same contract as HOST_CATEGORIES.
 *
 * Adding a tenth type is one line here plus one line in ASSET_REQUIREMENT_KEYS'
 * exclusion list if it should not be requestable.
 */

/**
 * `single` — one current file, replacing supersedes the last.
 * `many`    — a collection; every current file counts.
 *
 * `distributable` — ⚠ THIS IS A PRIVACY BOUNDARY, NOT A DISPLAY HINT.
 * A distributable type is world-readable: its rows and its files are served to
 * anonymous visitors so a logo can appear in an event's collectables. Everything
 * else stays owner-only, which is the default and must remain so — this bucket
 * also holds insurance certificates, riders and press kits carrying phone
 * numbers. Adding a flag here is the same act as making those files public;
 * the RLS policies read this exact set (see the PA2 migration).
 *
 * LOGO_PACK alone, deliberately (owner, 2026-08-02). A logo pack exists to be
 * distributed — that is what it IS. Promo photos are the obvious next
 * candidate and are deliberately NOT included yet.
 *
 * ⚠ LOGO_PACK IS CALLED "STICKERS / LOGOS" EVERYWHERE A PERSON CAN READ IT
 * (owner, 2026-09-02): the logos an act uploads here are the things collected
 * off an event page. ⛔ The KEY stays LOGO_PACK forever — it is stored in
 * `profile_assets.asset_type` and in opportunity requirement lists, and the
 * PA2 RLS policies name it. Only `label` moved, which is exactly the edit
 * this list's contract allows.
 *
 * ⭐ BOTH WORDS, DELIBERATELY. "Stickers" alone names what the file BECOMES
 * on an event page but not what to upload, so nobody would know a logo goes
 * here; "Logos" alone names the file but not why anyone would bother. The
 * pair is the only version that answers both, and it is the owner's own
 * idiom for a row that covers two readings (cf. "bands / solo").
 */
export const PROFILE_ASSET_TYPES = [
  { key: 'PRESS_KIT',         label: 'Press Kit',         cardinality: 'single' },
  { key: 'STAGE_PLOT',        label: 'Stage Plot',        cardinality: 'single' },
  { key: 'TECH_RIDER',        label: 'Tech Rider',        cardinality: 'single' },
  { key: 'HOSPITALITY_RIDER', label: 'Hospitality Rider', cardinality: 'single' },
  { key: 'PUBLIC_LIABILITY',  label: 'Public Liability',  cardinality: 'single' },
  { key: 'PROMO_PHOTOS',      label: 'Promo Photos',      cardinality: 'many'   },
  { key: 'LOGO_PACK',         label: 'Stickers / Logos',  cardinality: 'many', distributable: true },
  { key: 'MEDIA_KIT',         label: 'Media Kit',         cardinality: 'single' },
  { key: 'OTHER',             label: 'Other',             cardinality: 'many'   },
];

/** The world-readable types. The RLS policies must match this list exactly —
 *  a type added here but not to the policy simply stays private, which is the
 *  safe direction to fail. */
export const DISTRIBUTABLE_ASSET_TYPES = PROFILE_ASSET_TYPES
  .filter(t => t.distributable)
  .map(t => t.key);

export function isDistributable(key) {
  return DISTRIBUTABLE_ASSET_TYPES.includes(key);
}

export const ASSET_TYPE_KEYS = PROFILE_ASSET_TYPES.map(t => t.key);

const BY_KEY = Object.fromEntries(PROFILE_ASSET_TYPES.map(t => [t.key, t]));

/**
 * The one way to turn an asset-type key into its definition.
 * Returns null for an unrecognised key rather than guessing — the same
 * instinct as profileIdentity()'s UNKNOWN_PROFILE: a stored key we no longer
 * recognise must not silently borrow another type's identity.
 */
export function assetType(key) {
  return BY_KEY[key] || null;
}

/** Display label for a key, falling back to the raw key so an unrecognised
 *  value is still visible rather than rendering as an empty row. */
export function assetLabel(key) {
  return BY_KEY[key]?.label || key;
}

export function isMulti(key) {
  return BY_KEY[key]?.cardinality === 'many';
}

/**
 * Asset types an opportunity may ask for.
 *
 * `OTHER` is excluded: it is a catch-all bucket for the applicant's own
 * miscellaneous documents, and "we require an Other" is not a requirement
 * anyone can satisfy deliberately.
 *
 * requirements.js derives its asset requirement keys from THIS list rather than
 * declaring its own copy — one registry, one source of truth.
 */
export const ASSET_REQUIREMENT_KEYS = ASSET_TYPE_KEYS.filter(k => k !== 'OTHER');

// ── Storage ───────────────────────────────────────────────────────────

/** The bucket. Private — every read is a signed URL. */
export const ASSETS_BUCKET = 'profile-assets';

/** 15 MB. The REL form caps its uploads at 10 MB; this leaves headroom for a
 *  multi-page rider without inviting someone to store video here. Enforced by
 *  the storage API too, so a client that forgets still cannot exceed it. */
export const ASSET_MAX_BYTES = 15 * 1024 * 1024;

/** Documents and images. Deliberately no video, no archives: a zip cannot be
 *  previewed, scanned, or trusted, and "logo pack" is the exact request that
 *  would smuggle one in — supply the images instead. */
export const ASSET_MIME_TYPES = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp',
];

/**
 * Storage path for a new asset object.
 *
 * ⚠ THE FIRST SEGMENT MUST BE THE PROFILE ID. The storage RLS policies read
 * `can_act_as(safe_uuid((storage.foldername(name))[1]))` — the path IS the
 * authorization input. Changing this shape silently changes who can read and
 * write every file. (Same contract as the messaging buckets, where segment one
 * is the conversation id.)
 */
export function assetPath(profileId, assetTypeKey, fileName) {
  const ext = (fileName || '').includes('.') ? fileName.split('.').pop().toLowerCase() : 'bin';
  // Date.now + random keeps two uploads in the same second distinct without
  // needing a round-trip to reserve an id.
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${profileId}/${assetTypeKey}/${stamp}.${ext}`;
}
