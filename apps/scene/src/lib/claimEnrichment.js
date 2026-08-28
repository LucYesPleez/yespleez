/**
 * A SLOT CLAIM, FULLY DRESSED — the ONE definition, for every surface.
 *
 * ⭐⭐ WHY THIS EXISTS (owner, 2026-08-16, after an afternoon of it). `SlotCard`
 * and `DaySlots` were made canonical across the event page and the host
 * dashboard, and the two screens STILL behaved differently — because they built
 * their claims from two different loaders. One enriched, one did not.
 *
 * ⚠⚠ THE SYMPTOMS ALL LOOKED UNRELATED, and each was "fixed" on its own:
 *
 *     no avatars on the dash        → patched by attaching `profile`
 *     everyone drew the type default→ patched by adding `type`
 *     no play button, no mix rail   → `mix_link` was never selected
 *     drag bails at its first guard → `claims[active.id]` is the thin shape
 *
 * ⛔ Four patches, one cause. A component cannot be canonical while the DATA it
 * renders is assembled twice.
 *
 * ⚠ It is a function rather than a hook on purpose: `useEventData` loads ONE
 * event, the dashboard loads EVERY event in a single pass, and both need the
 * same answer. ⛔ Do not turn this into a hook — that would force the dashboard
 * into one call per event.
 */

/**
 * ⛔ THE COLUMN LIST IS PART OF THE CONTRACT. A caller that trims it re-creates
 * exactly the bug this module was written to end: the claim looks right, and one
 * control somewhere silently stops rendering.
 *
 * ⚠ `avatar`/`avatar_thumb` feed the card's background; `type` picks the default
 * image when an act has no picture; the four link columns feed the mix player;
 * `genre_string`/`sound` feed the descriptor line.
 */
import { notifyState } from './notifyPlan';

export const CLAIM_PROFILE_COLUMNS =
  /* ⭐⭐ `name` IS IN THIS LIST BECAUSE ITS ABSENCE WAS A VISIBLE BUG (owner,
     2026-08-28). A profile was renamed in Studio; the set-times card kept the
     OLD name while showing the NEW picture — the same act rendered half-current
     and half-stale, because the picture came from this row and the name came
     from `lineup_members.artist_name`, frozen at booking. ⛔ The column list is
     part of the contract: this is exactly the failure the header warns about. */
  'id, user_id, name, type, avatar, avatar_thumb, mix_link, soundcloud, mixcloud, '
  + 'instagram, facebook, youtube, website, genre_string, sound';

/**
 * Attach each claim's profile and lift the fields the cards read.
 *
 * ⚠ MUTATES the claim objects and returns them. That matches how both callers
 * already worked — the claim map is built first and dressed in place, so the
 * `bySlot`/`primary` indexes keep pointing at the same objects.
 *
 * @param db      supabase client
 * @param claims  flat array of claims from `indexPerformances`
 */
export async function enrichClaims(db, claims = []) {
  const list = (claims || []).filter(Boolean);
  if (!list.length) return list;

  /* ⚠ Resolved by PROFILE first, account second. `profile_id` is the real
     reference; `user_id` is the legacy account key and is null for the many
     profiles with nobody behind them. */
  const pidValues = [...new Set(list.filter(c => c.profile_id).map(c => c.profile_id))];
  const uidValues = [...new Set(list.filter(c => !c.profile_id && c.user_id).map(c => c.user_id))];

  const [byPidRes, byUidRes] = await Promise.all([
    pidValues.length
      ? db.from('profiles').select(CLAIM_PROFILE_COLUMNS).in('id', pidValues)
      : Promise.resolve({ data: [] }),
    uidValues.length
      ? db.from('profiles').select(CLAIM_PROFILE_COLUMNS).in('user_id', uidValues)
      : Promise.resolve({ data: [] }),
  ]);

  const byId  = {}; (byPidRes.data || []).forEach(p => { byId[p.id] = p; });
  const byUid = {}; (byUidRes.data || []).forEach(p => { byUid[p.user_id] = p; });

  for (const claim of list) {
    const p = claim.profile_id ? byId[claim.profile_id] : byUid[claim.user_id];
    /* ⛔ Left undressed for a typed billing name with no profile behind it.
       That is not a missing profile, it is an act somebody wrote down. */
    if (!p) continue;

    /* ⚠ THE WHOLE ROW, not just fields lifted off it. `isProfileUnclaimed` and
       `UnclaimedBadge` take the profiles row itself, and `claim.user_id` is
       `lineup_members.artist_id` — a different column with a different meaning,
       null for an unclaimed profile, so a claim-state test against it looks
       correct on exactly the case it gets wrong. */
    claim.profile = p;

    /* ⚠ ONE link, chosen in order, and ⛔ 'N/A' is not a link — imported rows
       carry that string literally. */
    const link = [p.mix_link, p.soundcloud, p.mixcloud].find(v => v && v.trim() && v !== 'N/A');
    if (link && !claim.mix_link) claim.mix_link = link;

    if (p.soundcloud) claim.soundcloud = p.soundcloud;
    if (p.mixcloud)   claim.mixcloud   = p.mixcloud;
    if (p.instagram)  claim.instagram  = p.instagram;
    if (p.facebook)   claim.facebook   = p.facebook;
    if (p.youtube)    claim.youtube    = p.youtube;
    if (p.website)    claim.website    = p.website;

    /**
     * ⭐⭐ THE PROFILE'S NAME WINS, ⛔ and this is the ONE lift that works that
     * way round. Everything above defers to the claim's own copy; a name does
     * not, because a linked act IS that profile and renaming it is the person
     * saying what they are called now.
     *
     * ⚠⚠ THE BUG (owner, 2026-08-28): a profile renamed in Studio showed the
     * NEW picture and the OLD name on the same set-times card — the picture
     * comes from this row, the name came from `lineup_members.artist_name`,
     * denormalised at booking and never revisited. "Changed everywhere but the
     * set times."
     *
     * ⛔ NOT APPLIED WHEN THERE IS NO PROFILE. A hand-entered act's typed name
     * is all there is, and `if (!p) continue` above has already left it alone.
     *
     * ⚠ This follows the convention `EventHostView` already uses in two places
     * (`prof?.name || member.artist_name`); `toClaim` was the one assembler
     * that could not, because it never sees a profile. ⭐ The snapshot is still
     * on `claim.member.artist_name` for anything that genuinely wants what the
     * act was BILLED as on the night.
     */
    if (p.name) claim.name = p.name;

    /* ⛔ Only when the claim has nothing of its own: a `lineup_members` row
       denormalises these at booking time and that copy wins. */
    if (!claim.genre && p.genre_string) claim.genre = p.genre_string;
    if (!claim.sound && p.sound)        claim.sound = p.sound;
  }

  return list;
}

/**
 * ── ⭐⭐ P6.2 · WHAT HAVE WE TOLD THE ACT ON THIS SLOT? ──────────────────────
 *
 * ⚠⚠ ATTACHED HERE FOR THE REASON THIS MODULE EXISTS. `SlotCard` is canonical
 * across the event page and the dashboard, and the two screens behaved
 * differently for an afternoon because their claims were assembled twice. A
 * notification chip computed in one surface and not the other would be the same
 * bug wearing a new hat.
 *
 * ⛔ PURE, and ⛔ no database read: every fact it needs is already loaded. It
 * attaches `claim.notify` in place, exactly as `enrichClaims` attaches profiles.
 *
 * ⚠ `perfsByMember`, ⛔ NOT `claim.performance` alone. A member may hold several
 * slots, and the state depends on ALL their placements — judging from one row
 * would call a two-slot act settled on the strength of half their bookings.
 *
 * ⛔ It decides nothing and sends nothing. `lib/notifyPlan` owns the rule.
 */
export function attachNotifyState(claims = [], { members = [], perfsByMember = {}, event = null } = {}) {
  const byId = {};
  (members || []).forEach(m => { if (m?.id) byId[m.id] = m; });

  (claims || []).forEach(c => {
    /* ⚠ The member row from the LOADER, which carries `notified_at` and
       `notified_slot_uuid`. `claim.member` came through `toClaim` and holds the
       same row, but reading the map keeps one source when a caller enriches a
       claim list assembled elsewhere. */
    const member = byId[c?.member_id] || c?.member || null;
    c.notify = notifyState(member, (perfsByMember || {})[c?.member_id] || [], event);
  });
  return claims;
}
