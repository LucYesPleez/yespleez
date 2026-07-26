import { supabase } from './supabase';

/**
 * CJ2 · HOW you are told, as distinct from WHETHER you are told.
 *
 * ⚠ THIS IS A SECOND AXIS, NOT A REPLACEMENT FOR notification_preferences.
 * That table is per-CATEGORY (`social`, `bookings`, …) and answers "do I want
 * these at all". This one is per-TYPE and answers "by what route". They stack:
 * muting the category still suppresses the notification no matter what channel
 * is chosen here, because a channel is a delivery route and NP1's rule is that
 * preferences govern delivery, never existence.
 *
 * Three channels, owner's words:
 *
 *   push       phone buzzes, bell shows it, FIND FRIENDS badges
 *   in_app     FIND FRIENDS badge ONLY — no push, and NOT the bell
 *   off        written and retained, never shown anywhere
 *
 * ⚠ `in_app` MEANS *NOT THE BELL*, WHICH IS WHY A ROW CARRIES ITS CHANNEL.
 * The owner was asked directly and chose the literal reading: "In Messages
 * only" means only inside Messages. The bell is a different tab, so it must
 * not light up. There is no way to express that with `suppressed_at` alone —
 * that flag is all-or-nothing, and `off` already uses it — so the chosen
 * channel is stamped onto each notification row as it is written, and the
 * bell filters on it. See the CJ2 migration.
 */
export const CHANNELS = ['push', 'in_app', 'off'];

/**
 * The channel a type falls back to when the user has never chosen one.
 *
 * ⚠ `push` ON PURPOSE, AND IT IS THE PERMISSIVE DEFAULT. A contact joining is
 * the payoff of having synced contacts at all — someone who opted into contact
 * matching has already said they want to hear about this. Defaulting to `off`
 * would silently disable the feature for everyone who never opened settings,
 * which is indistinguishable from it being broken. Push permission is a
 * separate gate the OS already owns, so this cannot make a phone buzz that the
 * user has not independently allowed.
 */
export const DEFAULT_CHANNEL = 'push';

/**
 * Read the caller's channel for one notification type.
 *
 * @param {string} type e.g. 'contact_joined'
 * @returns {Promise<{channel: string, error: object|null}>} falls back to
 *   DEFAULT_CHANNEL on absence AND on error — a settings screen that cannot
 *   read should show the real default, not a third state the user cannot act on.
 */
export async function getChannel(type) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { channel: DEFAULT_CHANNEL, error: null };

  const { data, error } = await supabase
    .from('notification_channel_prefs')
    .select('channel')
    .eq('user_id', user.id)
    .eq('type', type)
    .maybeSingle();

  if (error) return { channel: DEFAULT_CHANNEL, error };
  return { channel: data?.channel ?? DEFAULT_CHANNEL, error: null };
}

/**
 * Set the caller's channel for one type.
 *
 * ⚠ VALIDATED HERE AS WELL AS IN SQL. The CHECK constraint is the real
 * guarantee; this exists so a typo'd channel fails as a clear client error
 * instead of a constraint violation surfacing as "something went wrong".
 */
export async function setChannel(type, channel) {
  if (!CHANNELS.includes(channel)) {
    return { error: new Error(`unknown channel: ${channel}`) };
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: new Error('not signed in') };

  const { error } = await supabase
    .from('notification_channel_prefs')
    .upsert(
      { user_id: user.id, type, channel, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,type' },
    );
  return { error: error ?? null };
}
