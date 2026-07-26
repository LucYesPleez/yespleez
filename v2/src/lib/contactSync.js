import { supabase } from './supabase';
import { toE164, DEFAULT_COUNTRY } from './phoneNumber';
import { rememberNames, clearNames } from './contactNameStore';

/**
 * C1 · Contact sync — the only client surface for the contact-code layer.
 *
 * ⚠⚠ THE ADDRESS BOOK NEVER LEAVES THE DEVICE. What is uploaded is a list of
 * E.164 numbers, which the server immediately turns into peppered codes; what
 * is uploaded is NEVER a name. Every name in this module stays in
 * `contactNames` below, on this device, and is joined back on after the server
 * has answered.
 *
 * That is not a nicety — it is the entire promise the primer card makes ("no
 * names, no emails, no numbers"). A test asserts the RPC payload contains no
 * contact name, and it should be treated as load-bearing.
 *
 * ⚠ NOTHING HERE MAY READ `contact_codes` DIRECTLY. Both tables are RLS
 * deny-all with no policies; every path is a SECURITY DEFINER function. If a
 * screen needs something these wrappers do not expose, the answer is a new
 * database function, not a table read.
 */

/** The server's own cap. Bigger address books are chunked, never rejected. */
const MAX_PER_SYNC = 2000;

/**
 * `contact_code_id -> the name this device has that person saved under`.
 *
 * ⭐ THIS EXISTS FOR CONTACT JOIN NOTIFICATIONS, and it is why `sync_contacts`
 * returns an id for EVERY contact rather than only the matches. When someone
 * joins later, the push payload names their code id and nothing else; the
 * device looks the name up locally and renders "Sarah from your contacts
 * joined" without the server ever having known the word "Sarah".
 *
 * Kept for contacts that did NOT match, deliberately — those are exactly the
 * people who might join tomorrow.
 *
 * ⚠ MOVED TO INDEXEDDB (see contactNameStore.js). It was localStorage, which
 * worked in the app and could never have worked in the SERVICE WORKER — and
 * the service worker is what renders a push on a locked phone, which is the
 * whole point. Do not move it back.
 */
export { nameFor as localNameFor } from './contactNameStore';

/** Whether this browser can offer the device's address book at all. */
export function isContactPickerSupported() {
  return typeof navigator !== 'undefined'
    && 'contacts' in navigator
    && 'ContactsManager' in globalThis;
}

/**
 * Ask the OS for contacts.
 *
 * ⚠ THE PICKER IS THE PERMISSION. On Android Chrome this opens the system's
 * own multi-select sheet and the app receives ONLY what the user ticked —
 * "YesPleez never sees your address book" is mechanism here, not policy.
 * There is no persistent grant to revoke and no permission to re-request:
 * cancelling simply means "not this time".
 *
 * iOS has no equivalent, hence the capability check — see the platform matrix
 * in the design doc.
 *
 * @returns {Promise<Array<{number:string,name:string}>>} empty if cancelled
 */
export async function pickContacts() {
  if (!isContactPickerSupported()) return [];
  let picked;
  try {
    picked = await navigator.contacts.select(['name', 'tel'], { multiple: true });
  } catch {
    // Cancellation and "not allowed" arrive the same way. Neither is an error
    // worth surfacing — the user simply chose not to.
    return [];
  }

  const out = [];
  for (const entry of picked ?? []) {
    const name = entry?.name?.[0] ?? null;
    // One person can have several numbers, and any of them might be the one
    // their friends have saved. Upload all; the name rides along locally.
    for (const tel of entry?.tel ?? []) {
      if (tel) out.push({ number: tel, name });
    }
  }
  return out;
}

/**
 * Upload contacts as numbers, get back matches plus a code id for each.
 *
 * @param {Array<{number:string,name:string}>} contacts straight from the device
 * @returns {Promise<{matches:Array, uploaded:number, error:object|null}>}
 */
export async function syncContacts(contacts, iso = DEFAULT_COUNTRY) {
  // e164 -> local name, deduped. First name wins: the same number listed twice
  // is one person, and picking the later label would be arbitrary.
  const byNumber = new Map();
  for (const c of contacts ?? []) {
    const { e164 } = toE164(c?.number, iso);
    // A real address book contains "Pizza", "*611" and blank rows. One bad
    // entry must never cost the whole sync.
    if (e164 && !byNumber.has(e164)) byNumber.set(e164, c?.name ?? null);
  }

  const numbers = [...byNumber.keys()];
  if (numbers.length === 0) return { matches: [], uploaded: 0, error: null };

  const names = {};
  const matches = [];

  for (let i = 0; i < numbers.length; i += MAX_PER_SYNC) {
    const chunk = numbers.slice(i, i + MAX_PER_SYNC);
    const { data, error } = await supabase.rpc('sync_contacts', { p_e164: chunk });
    if (error) return { matches: [], uploaded: 0, error };

    for (const row of data ?? []) {
      // `with ordinality` is 1-based, and the index is per chunk.
      const e164 = chunk[row.input_index - 1];
      if (!e164) continue;             // an index we did not send is not ours
      const savedAs = byNumber.get(e164) ?? null;

      // Remembered for EVERY contact, matched or not — see the note on `store`.
      if (row.contact_code_id != null && savedAs) {
        names[String(row.contact_code_id)] = savedAs;
      }

      // profile_id is null for a contact who is not a discoverable member.
      if (row.profile_id) {
        matches.push({
          profileId: row.profile_id,
          displayName: row.display_name,
          avatar: row.avatar ?? null,
          // ⭐ The corroboration line. Joined on HERE, client-side, from a name
          // the server was never sent.
          savedAs,
        });
      }
    }
  }

  await rememberNames(names);
  return { matches, uploaded: numbers.length, error: null };
}

/** @returns {Promise<{state:{enabled:boolean,lastSyncedAt:string|null,codeCount:number}|null, error:object|null}>} */
export async function getContactSync() {
  const { data, error } = await supabase.rpc('my_contact_sync');
  if (error) return { state: null, error };
  const row = Array.isArray(data) ? data[0] : data;
  return {
    state: {
      enabled: row?.enabled === true,
      lastSyncedAt: row?.last_synced_at ?? null,
      codeCount: Number(row?.code_count ?? 0),
    },
    error: null,
  };
}

export async function setContactSync(enabled) {
  const { error } = await supabase.rpc('set_contact_sync', { p_enabled: enabled });
  return { error };
}

/**
 * Erase the uploaded codes — a different act from turning sync off.
 *
 * Also drops this device's name map: those ids no longer exist, so keeping
 * names against them would leave the only copy of an address-book fragment
 * sitting in storage for records that are gone.
 */
export async function deleteContactCodes() {
  const { data, error } = await supabase.rpc('delete_contact_codes');
  if (error) return { deleted: 0, error };
  await clearNames();
  return { deleted: Number(data ?? 0), error: null };
}
