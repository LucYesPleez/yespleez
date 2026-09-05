// EP-00 · extracted verbatim from EventScreen.jsx. Pure helpers shared by the
// slot renderer and the slot editor; no React, no data access.
export function parseDurMins(raw) {
  if (!raw) return 0;
  const n = Number(raw);
  if (n > 0) return n;
  const s = String(raw);
  const hr = s.match(/^([\d.]+)\s*hrs?$/i);
  if (hr) return Math.round(parseFloat(hr[1]) * 60);
  const mn = s.match(/^([\d.]+)\s*mins?$/i);
  if (mn) return Math.round(parseFloat(mn[1]));
  return 0;
}

export function fmtDur(mins) {
  if (!mins) return null;
  const m = Number(mins);
  if (!m) return null;
  if (m < 60) return `${m} mins`;
  const h = m / 60;
  return `${h % 1 === 0 ? h : h.toFixed(1)} hr${h !== 1 ? 's' : ''}`;
}

export const LABEL_PALETTE = ['#FFB830', '#BF5FFF', '#00E5A0', '#FF6B6B', '#FF8C42', '#7BC8F6'];
export function labelColor(label) {
  if (!label) return '#FFB830';
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) & 0xFFFFFF;
  return LABEL_PALETTE[Math.abs(hash) % LABEL_PALETTE.length];
}
/**
 * ⭐⭐ IS THIS A WELCOME TO COUNTRY? Asked for ONE reason: it is the only marker
 * on a running order that must not be dimmed (owner, 2026-08-28 — "stage close
 * can be muted, that's not as important; welcome to country is").
 *
 * ⚠ MATCHED ON MEANING, ⛔ not on an exact string. Organisers write "Welcome to
 * Country", "Welcome to Country / Choir" (Neverland's own), "Welcome & Smoking
 * Ceremony". A rule that only fired on one spelling would be a rule that
 * usually does not fire.
 *
 * ⚠ Acknowledgement of Country counts, both spellings: it is the same act of
 * respect, and an organiser who writes one rather than the other did not mean
 * anything by the choice.
 */
const WELCOME_RE = /\b(welcome|acknowledge?ment)\s+(to|of)\s+country\b/i;

export function isWelcomeToCountry(label) {
  return WELCOME_RE.test(String(label || ''));
}

export function stripEmoji(str) {
  return str?.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim() || '';
}

/**
 * ⭐⭐ WHAT A READER MAY SEE ON ONE SLOT — the ONE answer, for every surface.
 *
 * ⛔⛔ THIS EXISTS BECAUSE A SECOND SURFACE APPEARED. `SchedulePortrait`'s own
 * header states the law: the projection decides WHERE a card goes, the card
 * decides WHAT it says, and ⛔ restating the visibility rules in the projection
 * "gave one question two answers, and the day the two disagreed the page would
 * leak a name the card was hiding". The zoomed-out map needs a name to draw, so
 * the rules moved HERE and `SlotCard` reads them too. ⛔ Do not copy this logic
 * into a renderer — import it.
 *
 * The three rules, unchanged from the card that has always applied them:
 *   · a DRAFT booking does not exist for the public          → open slot
 *   · an unconfirmed booking exists but is not announced     → PENDING
 *   · only a CONFIRMED act is named
 *
 * ⚠ `isHost` turns all three off, because the host is looking at their own
 * working copy — that is the editor, not a leak.
 *
 * @returns { isEmpty, name, status } — `name` is '' when `isEmpty`.
 */
/**
 * ⚠⚠ `announced` IS THE HOST'S OVERRIDE, and it is the THIRD input on purpose.
 * Before it, an act was named publicly only once its performance was
 * `confirmed`, which left a host ready to post the running order looking at a
 * column of PENDING above a LINEUP naming every one of those acts. ⭐ The
 * override changes WHO IS NAMED and nothing else: `status` is returned
 * untouched, so the host's own SET TIMES chip still reads AWAITING REPLY and
 * `performances` still records the truth about who has agreed.
 *
 * ⛔⛔ A `draft` SLOT IS STILL HIDDEN FROM THE PUBLIC, announced or not — the
 * `isEmpty` test above runs first and deliberately does not consult it. A slot
 * whose time was never sent is not part of the running order being announced.
 */
export function slotOccupant(claim, isHost = false, announced = false) {
  const status = claim?.status || (claim?.user_id ? 'pending' : 'name_added');
  const isEmpty = !claim || (!isHost && status === 'draft');
  if (isEmpty) return { isEmpty: true, name: '', status };
  const named = isHost || announced || status === 'confirmed';
  return { isEmpty: false, name: named ? (claim?.name || '') : 'PENDING', status };
}
