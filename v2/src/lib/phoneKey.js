import { supabase } from './supabase';
import { toE164, DEFAULT_COUNTRY } from './phoneNumber';

/**
 * Phone discovery — the only client surface for the P1 data layer.
 *
 * Every function here is a thin wrapper over a SECURITY DEFINER RPC. The tables
 * themselves are RLS-deny-all with no policies, so there is deliberately no
 * `.from('phone_keys')` anywhere in the app and there must never be one — if a
 * screen needs something these functions do not expose, the answer is a new
 * function in the database, not a table read.
 *
 * ⚠ NOTHING HERE EVER RETURNS A PHONE NUMBER, and no RPC can. `find_by_phone`
 * returns a profile id and a display name; the number goes in and does not come
 * back. That is the shape the privacy rule depends on, not a convention.
 */

/** The server's own cap. Larger contact books are chunked, not rejected. */
const MAX_PER_LOOKUP = 2000;

/**
 * Claim or change your number.
 *
 * Normalises client-side first so a malformed number costs no round trip and
 * gets a specific reason rather than the database's generic rejection.
 *
 * The database enforces the 30-day change limit and the uniqueness rule; both
 * arrive here as errors and must be shown, never swallowed. `23505` is the
 * unique violation — someone else holds this number (§2).
 *
 * @returns {Promise<{error: object|null, reason: string|null}>}
 */
export async function setPhoneKey(raw, iso = DEFAULT_COUNTRY) {
  const { e164, reason } = toE164(raw, iso);
  if (!e164) return { error: null, reason };

  const { error } = await supabase.rpc('set_phone_key', { p_e164: e164 });
  if (error) {
    if (error.code === '23505') return { error, reason: 'already-taken' };
    if (error.code === '23514') return { error, reason: 'rate-limited' };
    return { error, reason: 'failed' };
  }
  return { error: null, reason: null };
}

/**
 * Your own key, for the settings panel.
 *
 * ⚠ THE NUMBER ITSELF CANNOT BE RETURNED — EVER, BY ANYONE. What is stored is
 * an HMAC, which is one-way, so the digits genuinely do not exist on the server
 * to send back. `last3` is kept separately for display precisely because of
 * that: without it there would be no way to tell a user WHICH number they
 * registered. This is why the design's "reveal your number" eye was dropped —
 * we cannot reveal what we do not have.
 *
 * @returns {Promise<{key: {hasKey:boolean,last3:string|null,visibility:string|null,
 *   discoverableFrom:string|null,nextChangeAllowed:string|null}|null, error: object|null}>}
 */
export async function myPhoneKey() {
  const { data, error } = await supabase.rpc('my_phone_key');
  if (error) return { key: null, error };

  // The RPC returns a single row; PostgREST hands back an array.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { key: { hasKey: false, last3: null, visibility: null,
    discoverableFrom: null, nextChangeAllowed: null }, error: null };

  return {
    key: {
      hasKey: row.has_key === true,
      last3: row.last3 ?? null,
      visibility: row.visibility ?? null,
      discoverableFrom: row.discoverable_from ?? null,
      nextChangeAllowed: row.next_change_allowed ?? null,
    },
    error: null,
  };
}

/** Delete the key outright. Not soft-deleted — see §7. */
export async function removePhoneKey() {
  const { error } = await supabase.rpc('remove_phone_key');
  return { error };
}

/** @param {'everyone'|'contacts'|'nobody'} visibility */
export async function setPhoneVisibility(visibility) {
  const { error } = await supabase.rpc('set_phone_visibility', {
    p_visibility: visibility,
  });
  return { error };
}

/**
 * Look up numbers. Serves both single search and a whole contact sync.
 *
 * ⚠ THE RPC RETURNS `input_index`, NOT THE NUMBER. The caller needs to know
 * WHICH of its inputs matched — `matchContacts` cannot attach the saved-as name
 * otherwise — and the position is the way to say that without a number
 * appearing in a response payload. The client already knows what it sent, so
 * the index tells it nothing new; a returned number would be a second copy of
 * the thing we promised only ever travels one way.
 *
 * The index is per-chunk, so it is resolved to the caller's own `e164` here
 * before it escapes this function.
 *
 * @param {string[]} rawNumbers
 * @returns {Promise<{matches: Array<{profileId:string,displayName:string,e164:string}>, error: object|null}>}
 */
export async function findByPhone(rawNumbers, iso = DEFAULT_COUNTRY) {
  const wanted = new Map();
  for (const raw of rawNumbers ?? []) {
    const { e164 } = toE164(raw, iso);
    // Unparseable entries are dropped rather than failing the batch: a contact
    // book always contains rubbish, and one bad row must not cost the sync.
    if (e164) wanted.set(e164, true);
  }
  const numbers = [...wanted.keys()];
  if (numbers.length === 0) return { matches: [], error: null };

  const matches = [];
  for (let i = 0; i < numbers.length; i += MAX_PER_LOOKUP) {
    const chunk = numbers.slice(i, i + MAX_PER_LOOKUP);
    const { data, error } = await supabase.rpc('find_by_phone', { p_e164: chunk });
    if (error) return { matches: [], error };
    for (const row of data ?? []) {
      // `with ordinality` is 1-based.
      const e164 = chunk[row.input_index - 1];
      if (!e164) continue; // defensive: an index we did not send is not ours
      matches.push({
        profileId: row.profile_id,
        displayName: row.display_name,
        e164,
      });
    }
  }
  return { matches, error: null };
}

/**
 * ⭐ Contact matching WITH the corroboration line — mitigation 4.
 *
 * Because numbers are unverified, a match must show both identities: the
 * account's chosen display name and the name the user themself saved that
 * number under. A mismatch ("Mallory X · saved as Bob") is the signal that a
 * number has been squatted, and it is visible to the only person who can judge
 * it.
 *
 * ⚠ THE PHONEBOOK NAME NEVER LEAVES THE DEVICE. It is joined back on here,
 * client-side, after the lookup returns — the RPC is only ever sent numbers.
 * Sending the name would hand the server a copy of the user's address book,
 * which is the one thing the whole design promises not to do. Do not
 * "simplify" this by passing names through the RPC to save a join.
 *
 * @param {Array<{number:string,name:string}>} contacts  straight from the device
 * @returns {Promise<{matches: Array<{profileId:string,displayName:string,savedAs:string|null}>, error: object|null}>}
 */
export async function matchContacts(contacts, iso = DEFAULT_COUNTRY) {
  // e164 → the local name, kept here and only here.
  const localNames = new Map();
  for (const c of contacts ?? []) {
    const { e164 } = toE164(c?.number, iso);
    if (e164 && !localNames.has(e164)) localNames.set(e164, c?.name ?? null);
  }

  const { matches, error } = await findByPhone([...localNames.keys()], iso);
  if (error) return { matches: [], error };

  // The join that makes mitigation 4 work, done here and nowhere else. The
  // number is dropped on the way out so callers cannot render or forward it.
  return {
    matches: matches.map(({ e164, ...m }) => ({
      ...m,
      savedAs: localNames.get(e164) ?? null,
    })),
    error: null,
  };
}
