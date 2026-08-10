import { formatLocation } from './formatLocation';

/**
 * WHAT THE VENUE WILL ACTUALLY SEE — the pre-send check's content.
 *
 * ⭐⭐ DERIVED FROM THE CARD THAT RECEIVES IT, NOT INVENTED HERE. When an
 * enquiry lands, the venue opens `EnquiryCard`, which reads a declared column
 * list. This projection names the same fields in the same order, so the
 * confirmation shows what is genuinely sent rather than a reassuring summary
 * of a different thing.
 *
 * ⚠ If EnquiryCard ever reads a new field, this must gain it too — there is a
 * contract test asserting the overlap. A preview that quietly omits something
 * is worse than no preview: it tells someone their fee is private when the
 * venue can read it.
 *
 * ── EVERY ROW IS LISTED, INCLUDING THE EMPTY ONES ──
 *
 * The Rendering Contract's "no placeholders, no visual holes" governs PUBLIC
 * surfaces. This is the opposite situation: a person's private view of their
 * own outgoing message, whose whole job is to show what is MISSING before they
 * send it. Same reasoning ProfileAssetsSection records — you cannot fix what
 * you cannot see. So an absent field renders as "Not provided", never hidden.
 */

/**
 * Columns the preview needs fetched for the acting profile.
 *
 * The enquiry picker only loads enough to draw a chooser row, so these are
 * fetched in addition. Kept as a list rather than `select('*')` so the widening
 * is visible in review — and so nobody wonders later which screen made the
 * profile query expensive.
 */
export const ENQUIRY_PREVIEW_COLUMNS = [
  'id', 'user_id', 'type', 'name', 'avatar', 'avatar_thumb',
  'tagline', 'location', 'suburb', 'state', 'genre_string', 'sound',
  'bio', 'years', 'mix_link', 'fee', 'fee_type', 'contact_email',
];

/** How a missing value reads. One string, so it cannot drift row to row. */
export const NOT_PROVIDED = 'Not provided';

/**
 * The fee as the venue sees it — the amount and its type are one fact, and
 * showing "250" without "per set" is how a misunderstanding starts.
 */
function formatFee(profile) {
  const fee = (profile?.fee ?? '').toString().trim();
  if (!fee || fee === 'N/A') return '';
  const type = (profile?.fee_type ?? '').toString().trim();
  return type ? `${fee} · ${type}` : fee;
}

/**
 * Build the rows shown in the pre-send check.
 *
 * @param {object} profile the ACTING profile, fetched with ENQUIRY_PREVIEW_COLUMNS
 * @returns {Array<{key: string, label: string, value: string, present: boolean}>}
 */
export function buildEnquiryPreview(profile) {
  const p = profile || {};
  const rows = [
    { key: 'name',     label: 'Name',        value: p.name },
    { key: 'tagline',  label: 'Tagline',     value: p.tagline },
    { key: 'location', label: 'Location',    value: formatLocation(p) },
    { key: 'genres',   label: 'Genres',      value: p.genre_string },
    { key: 'sound',    label: 'Sound',       value: p.sound },
    { key: 'years',    label: 'Years active', value: p.years },
    { key: 'bio',      label: 'Bio',         value: p.bio },
    { key: 'mix',      label: 'Demo mix',    value: p.mix_link },
    { key: 'fee',      label: 'Fee',         value: formatFee(p) },
    { key: 'email',    label: 'Contact email', value: p.contact_email },
  ];

  return rows.map(r => {
    const raw = (r.value ?? '').toString().trim();
    /**
     * ⚠ 'N/A' IS AN ANSWER, NOT A GAP — Rendering Contract R1, the same rule
     * the requirements verdict follows. Someone who was asked for a website and
     * said they have none has answered; showing that as "Not provided" would
     * push them to invent one. It is shown as what they wrote.
     */
    const present = raw !== '';
    return { key: r.key, label: r.label, value: present ? raw : NOT_PROVIDED, present };
  });
}

/**
 * A short summary line for the dialog header — how many of the venue's readable
 * fields are actually filled. Not a score and never a gate: an enquiry with a
 * sparse profile is still perfectly sendable, and the P6 requirements are the
 * only thing that can block one.
 */
export function previewCompleteness(rows) {
  const list = rows || [];
  return { filled: list.filter(r => r.present).length, total: list.length };
}
