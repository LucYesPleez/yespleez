/**
 * THE COLUMNS AN ANONYMOUS VISITOR MAY READ FROM `profiles`.
 *
 * ⛔⛔ WHY THIS FILE EXISTS. Supabase grants SELECT on a table to `anon` by
 * default, and **RLS filters ROWS, not COLUMNS**. `profiles` is meant to be
 * publicly readable — that is how a signed-out visitor sees an artist's page —
 * so the row policy is correct. But the same grant that exposes `name` and
 * `avatar` also exposed `email`, `emergency_phone` and `abn`, because they are
 * just columns on the same row.
 *
 * ⚠⚠ MEASURED 2026-08-29 with the publishable key and NO session: `email` on
 * **78** profiles, `emergency_name` / `emergency_phone` / `emergency_rel` on
 * **19**, `abn` on 12, `age` on 17 — all returned in one request. The emergency
 * contacts are next-of-kin who never used YesPleez at all.
 *
 * ⭐⭐ IT WAS INVISIBLE BECAUSE EVERY PAGE LOOKED RIGHT. The app only RENDERS
 * public fields; the API hands over all 84 columns to anyone who names them.
 * ⛔ Never conclude a field is private because no screen displays it.
 *
 * ⭐ THE LIST IS DERIVED FROM THE TABLE, ⛔ not hand-written: 83 columns minus
 * the 10 private ones = 73. A hand-typed list silently drops whatever it
 * forgets, and the failure mode is a blank field on a public page.
 *
 * ⛔⛔ AND DERIVING IT BADLY IS WORSE THAN TYPING IT. The first version of this
 * list was extracted from a `select=*` response with `grep -o '"[a-z_]*":'`,
 * which also matched keys INSIDE jsonb values (`links`, `card_pills`,
 * `required_items`). That invented a column — `studio_local_id` — that does not
 * exist, and PostgREST answers a select naming it with **42703**, so BOTH
 * branches of `resolveProfileRoute` failed and every public profile page on
 * production read "Profile not found".
 *
 * ⚠⚠ IT PASSED VERIFICATION BECAUSE THE BROWSER HELD THE OLD BUNDLE. The pages
 * were checked after the deploy and rendered perfectly — from cache. ⭐ A
 * post-deploy UI check must FORCE A RELOAD, or it is measuring the code you
 * just replaced. ⭐ Parse JSON with a JSON parser: `Object.keys(rows[0])`,
 * never a regex over the text.
 *
 * ⚠ `contact_email` IS PUBLIC AND STAYS. `ProfileScreen` renders it as a
 * `mailto:` link beside the social icons — publishing a booking address is the
 * owner's own choice. ⛔ Do not confuse it with `email`, which is the ACCOUNT
 * address and was never chosen for publication.
 *
 * ⚠ `age` is never rendered on a public page, and there is an `age_private`
 * flag beside it — so someone could tick "keep my age private" while the value
 * stayed readable through the API. ⭐ A UI privacy switch is not a boundary.
 *
 * ⛔ `user_id` REMAINS IN THIS LIST FOR NOW. Its exposure lets anyone correlate
 * every identity behind one account, and closing it is its own piece of work
 * with a legacy-URL dependency — deliberately NOT folded into a PII fix.
 */
export const PRIVATE_PROFILE_COLUMNS = Object.freeze([
  'email',            // the ACCOUNT address; contact_email is the public one
  'phone',
  'emergency_name',
  'emergency_phone',
  'emergency_rel',
  'abn',
  'has_abn',
  'gst_registered',
  'age',
  'age_private',
]);

export const PUBLIC_PROFILE_COLUMNS = Object.freeze([
  'accessibility', 'act_type', 'atmosphere', 'availability_private', 'avatar',
  'avatar_hero', 'avatar_thumb', 'band_type', 'bandcamp', 'beatport', 'bio',
  'capacity', 'card_pills', 'claim_status', 'claimed_at', 'claimed_via',
  'contact_email', 'country', 'created_at', 'created_via', 'dj_name',
  'epk_link', 'established_year', 'experience', 'external_ref', 'facebook',
  'fee', 'fee_local', 'fee_max', 'fee_negotiable', 'fee_plus_travel',
  'fee_travel', 'fee_type', 'genre_string', 'id', 'instagram', 'is_live',
  'label', 'lat', 'links', 'live_nights', 'lng', 'location', 'member_count',
  'mix_link', 'mixcloud', 'name', 'onboarding_seen_at', 'perfect_for',
  'postcode', 'required_items', 'scene_radius_km', 'set_length', 'sound',
  'soundcloud', 'source', 'spotify', 'stage_dims', 'state',
  'suburb', 'tagline', 'tech_features', 'tech_setup', 'tiktok', 'type',
  'updated_at', 'user_id', 'venue_type', 'vibe_tags', 'video_link', 'website',
  'years', 'youtube',
]);

/** Ready to hand to `.select()`. */
export const PUBLIC_PROFILE_SELECT = PUBLIC_PROFILE_COLUMNS.join(', ');
