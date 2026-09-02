/**
 * CALENDAR PREFERENCES — the client's half of `calendar_feeds`.
 *
 * One row per USER (auth.uid), the same account-level identity rule the
 * notification preference tables follow — ⛔ never per profile. The row
 * holds:
 *
 *     token       the feed's capability secret. Knowing the URL IS the
 *                 authentication (calendar clients cannot send headers), the
 *                 same model as Google Calendar's "secret address".
 *     enabled     the master switch.
 *     categories  jsonb of the per-category booleans.
 *
 * ⭐⭐ MASTER OFF MUST NOT ERASE THE CATEGORY CHOICES. Disabling writes
 * `enabled: false` and touches nothing else; re-enabling restores exactly
 * the toggles the user had. ⛔ Never delete the row to disable.
 *
 * ⚠ CALENDAR PREFERENCES ARE NOT NOTIFICATION PREFERENCES. Different
 * question ("what lands in my calendar" vs "what interrupts me"), different
 * table, and ⛔ neither reads the other.
 *
 * ⚠ The table ships in migration 20260902000000_cal1_calendar_feed.sql.
 * Until the owner applies it, every call here surfaces the error to the
 * screen rather than pretending — a 42P01/404 means "not available yet".
 */

import { supabase } from './supabase';
import { mergeCategories, calendarFeedUrl, calendarWebcalUrl } from './calendarFeed';

/**
 * ⭐⭐ WHICH ROLES THIS ACCOUNT HOLDS — read from `profiles`, the canonical
 * identity system, ⛔ NEVER inferred from activity. Having been booked once
 * does not make somebody an artist; holding an artist profile does.
 *
 * ⚠ Types only, ⛔ not ids: the screen decides which CHIPS to draw, and the
 * feed does its own profile scoping server-side inside the RPC. Nothing here
 * is a permission.
 */
export async function fetchProfileTypes(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('type')
    .eq('user_id', userId);
  if (error) return [];
  return [...new Set((data || []).map(r => r.type).filter(Boolean))];
}

/** The user's calendar row, or null when none exists yet. */
export async function fetchCalendarPrefs(userId) {
  const { data, error } = await supabase
    .from('calendar_feeds')
    .select('user_id, token, enabled, categories')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { error };
  return { row: data || null };
}

/**
 * Turn the master switch ON, minting the row (and its token) on first use.
 *
 * ⚠ UPSERT on the user PK so a second enable NEVER rotates the token — a
 * rotated token silently kills every calendar the user already subscribed.
 * The insert path supplies a token; the update path does not mention it.
 */
export async function enableCalendarSync(userId) {
  const { row, error: readError } = await fetchCalendarPrefs(userId);
  if (readError) return { error: readError };
  if (row) {
    const { error } = await supabase
      .from('calendar_feeds')
      .update({ enabled: true, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    return error ? { error } : { row: { ...row, enabled: true } };
  }
  const fresh = {
    user_id: userId,
    token: crypto.randomUUID(),
    enabled: true,
    categories: {},
  };
  const { error } = await supabase.from('calendar_feeds').insert(fresh);
  return error ? { error } : { row: fresh };
}

/** Master OFF — `enabled` only; token and categories stay exactly as set. */
export async function disableCalendarSync(userId) {
  const { error } = await supabase
    .from('calendar_feeds')
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  return { error: error || null };
}

/**
 * Flip one category. Merges into the stored jsonb so the other toggles are
 * untouched; absence still means ON (see mergeCategories).
 */
export async function setCalendarCategory(userId, key, on, storedCategories = {}) {
  const categories = { ...storedCategories, [key]: !!on };
  const { error } = await supabase
    .from('calendar_feeds')
    .update({ categories, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  return error ? { error } : { categories };
}

/* The URL builders live in lib/calendarFeed (pure); re-exported here so the
   screen has one import for the whole preferences surface. */
export { mergeCategories, calendarFeedUrl, calendarWebcalUrl };
