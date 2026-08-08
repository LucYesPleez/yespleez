/**
 * PROFILE ASSETS — storage and table I/O.
 * ---------------------------------------------------------------------------
 * Kept separate from profileAssets.js on purpose: that module is a pure
 * registry with no Supabase import, so requirements.js (and its tests) can read
 * the asset vocabulary without dragging a client and an env into the test run.
 * This module is the side-effecting half.
 *
 * ⚠ THE BUCKET IS PRIVATE. There is no getPublicUrl path here and there must
 * never be one — every read goes through a short-lived signed URL. An insurance
 * certificate or a rider with a phone number on it is not a public object.
 * (uploadImage.js uses getPublicUrl because avatars ARE public; do not copy
 * that pattern into this file.)
 */

import { supabase } from './supabase';
import {
  ASSETS_BUCKET, ASSET_MAX_BYTES, ASSET_MIME_TYPES, DISTRIBUTABLE_ASSET_TYPES,
  assetPath, isMulti, assetLabel,
} from '@yespleez/requirements';

/** Signed URLs last 60s — long enough to open, short enough that a copied
 *  link is not a lasting leak. */
const SIGNED_URL_TTL = 60;

/** Every current asset for a profile, newest first. */
export async function listAssets(profileId) {
  if (!profileId) return [];
  const { data, error } = await supabase
    .from('profile_assets')
    .select('id, asset_type, storage_path, file_name, mime_type, byte_size, label, valid_until, is_current, created_at')
    .eq('profile_id', profileId)
    .eq('is_current', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Client-side gate. The bucket enforces both limits too, so this exists to give
 * a readable message rather than a 400 from the storage API — not as the
 * security boundary.
 */
export function validateAssetFile(file) {
  if (!file) return 'No file selected.';
  if (file.size > ASSET_MAX_BYTES) {
    return `That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${ASSET_MAX_BYTES / 1048576} MB.`;
  }
  if (!ASSET_MIME_TYPES.includes(file.type)) {
    return 'Please upload a PDF, JPG, PNG or WebP.';
  }
  return null;
}

/**
 * Upload a file and record it.
 *
 * Order matters: the object goes up FIRST, then the row. A row pointing at a
 * file that failed to upload would read as satisfied and show a broken link;
 * an uploaded file with no row is an orphan nobody sees, which is the cheaper
 * of the two failures. If the insert fails the object is removed again so the
 * orphan does not persist.
 *
 * For `single` types the previous current row is superseded, not deleted —
 * history is retained (design §4.2). For `many` types nothing is superseded.
 */
export async function uploadAsset({ userId, profileId, assetTypeKey, file, label = null }) {
  const invalid = validateAssetFile(file);
  if (invalid) throw new Error(invalid);
  if (!userId || !profileId) throw new Error('Missing profile.');

  const path = assetPath(profileId, assetTypeKey, file.name);

  const { error: upErr } = await supabase.storage
    .from(ASSETS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw upErr;

  const { data: row, error: insErr } = await supabase
    .from('profile_assets')
    .insert({
      user_id:      userId,
      profile_id:   profileId,
      asset_type:   assetTypeKey,
      storage_path: path,
      file_name:    file.name,
      mime_type:    file.type,
      byte_size:    file.size,
      label,
    })
    .select('id')
    .single();

  if (insErr) {
    // Roll the object back so a failed insert does not leave a file nothing references.
    await supabase.storage.from(ASSETS_BUCKET).remove([path]);
    throw insErr;
  }

  if (!isMulti(assetTypeKey)) {
    // Supersede any earlier current version of a single-file type. The old row
    // and its object are retained — replacing a rider should not destroy the
    // one an existing application already referenced.
    await supabase
      .from('profile_assets')
      .update({ is_current: false, superseded_by: row.id })
      .eq('profile_id', profileId)
      .eq('asset_type', assetTypeKey)
      .eq('is_current', true)
      .neq('id', row.id);
  }

  return row.id;
}

/**
 * Remove an asset the owner no longer wants held.
 *
 * Deliberately a real deletion, unlike a message: a professional document is
 * the owner's own property and withdrawing it is legitimate. The row goes
 * first — if the object delete fails, an unreferenced file is a storage
 * housekeeping problem, whereas a row pointing at a deleted object would render
 * as present-but-broken, which R4 (broken ≠ sparse) says must never happen.
 */
export async function deleteAsset(asset) {
  if (!asset?.id) return;
  const { error } = await supabase.from('profile_assets').delete().eq('id', asset.id);
  if (error) throw error;
  if (asset.storage_path) {
    await supabase.storage.from(ASSETS_BUCKET).remove([asset.storage_path]);
  }
}

/** A short-lived signed URL for viewing or downloading. Null if it cannot be
 *  signed, so callers render "unavailable" rather than a dead link. */
export async function assetUrl(storagePath) {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage
    .from(ASSETS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL);
  return error ? null : (data?.signedUrl || null);
}

/**
 * Logos for a set of profiles, for a PUBLIC surface (an event's collectables).
 *
 * ⚠ LOGO_PACK ONLY, and that is not a filter for tidiness — it is the privacy
 * boundary. `DISTRIBUTABLE_ASSET_TYPES` is the same set the RLS policies allow
 * anonymous reads for; asking for anything else here returns nothing because
 * the database refuses, not because this function is polite about it.
 *
 * Public URLs, not signed ones: an anonymous reader cannot sign anything, and
 * these files are deliberately world-readable. Everything else in this bucket
 * still requires `assetUrl()` and a session.
 *
 * @returns {Promise<Object>} `{ [profile_id]: [{id, url, file_name}] }`
 */
export async function fetchDistributableLogos(profileIds) {
  const ids = [...new Set((profileIds || []).filter(Boolean))];
  if (!ids.length) return {};

  const { data, error } = await supabase
    .from('profile_assets')
    .select('id, profile_id, asset_type, storage_path, file_name')
    .in('profile_id', ids)
    .in('asset_type', DISTRIBUTABLE_ASSET_TYPES)
    .eq('is_current', true)
    .order('created_at', { ascending: true });

  // A public shelf that throws would take the whole event page with it. An
  // empty shelf is the correct degraded state — R1, absent is absent.
  if (error || !data) return {};

  const out = {};
  for (const row of data) {
    const { data: pub } = supabase.storage.from(ASSETS_BUCKET).getPublicUrl(row.storage_path);
    if (!pub?.publicUrl) continue;
    (out[row.profile_id] ||= []).push({ id: row.id, url: pub.publicUrl, file_name: row.file_name });
  }
  return out;
}

/** "Press Kit — rider-2026.pdf (1.2 MB)" for a11y labels and tooltips. */
export function describeAsset(asset) {
  if (!asset) return '';
  const mb = asset.byte_size ? ` (${(asset.byte_size / 1048576).toFixed(1)} MB)` : '';
  return `${assetLabel(asset.asset_type)} — ${asset.file_name}${mb}`;
}
