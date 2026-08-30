/**
 * Poster Wall — the one fetch, shared by the full-screen wall and the
 * My Scene teaser strip (same react-query key, so the strip IS a slice of
 * the real wall, not a second query that can disagree with it).
 *
 * Reads relationship records only — follows, lineup membership, hosted
 * events — and hands them to lib/posterWall's pure model. Nothing here
 * decides what belongs on the wall.
 */
import { supabase } from './supabase';
import { fetchDistributableLogos } from './profileAssetStore';

export const POSTER_WALL_QUERY_KEY = (uid) => ['posterWall', uid];

export async function fetchPosterWallData(uid) {
  const [fRes, claimsRes, myEvRes] = await Promise.all([
    supabase.from('follows').select('entity_id,entity_type,target_profile_id').eq('user_id', uid),
    supabase.from('lineup_members').select('event_id').eq('artist_id', uid).eq('status', 'on_bill'),
    supabase.from('events').select('id,name,config').eq('host_id', uid),
  ]);

  const follows = fRes.data || [];
  const hostedRows = myEvRes.data || [];
  const hostedIdSet = new Set(hostedRows.map(e => e.id));
  const followedEventIds = [...new Set(follows.filter(f => f.entity_type === 'event').map(f => f.entity_id).filter(Boolean))];
  const playedIds = new Set((claimsRes.data || []).map(c => c.event_id).filter(Boolean));

  const missing = [...new Set([...followedEventIds, ...playedIds])].filter(id => !hostedIdSet.has(id));
  const evRes = missing.length
    ? await supabase.from('events').select('id,name,config').in('id', missing)
    : { data: [] };
  const events = [...hostedRows, ...(evRes.data || [])];

  // Logo stickers come from followed acts. Canonical key only — a legacy
  // follow row without target_profile_id has no resolvable profile here, and
  // guessing by entity_id re-opens the dual-keyspace trap.
  const pids = [...new Set(follows.filter(f => f.entity_type !== 'event' && f.target_profile_id).map(f => f.target_profile_id))];
  let followedProfiles = [];
  let logosByProfile = {};
  if (pids.length) {
    const [pRes, logos] = await Promise.all([
      supabase.from('profiles').select('id,name').in('id', pids),
      fetchDistributableLogos(pids),
    ]);
    followedProfiles = pRes.data || [];
    logosByProfile = logos || {};
  }

  return {
    events,
    playedIds,
    hostedIds: hostedIdSet,
    followedIds: new Set(followedEventIds),
    followedProfiles,
    logosByProfile,
  };
}

/* ── Wall curation state — hidden set + placement/size overrides ────────
   Per user, local for now. The membership query stays canonical either way;
   losing this state can only reveal more of the wall, never lie about it. */
const stateKey = (uid) => `_posterWall_${uid}`;

export function loadWallState(uid) {
  try {
    const raw = localStorage.getItem(stateKey(uid));
    const s = raw ? JSON.parse(raw) : null;
    return { hidden: s?.hidden || [], pos: s?.pos || {}, size: s?.size || {} };
  } catch {
    return { hidden: [], pos: {}, size: {} };
  }
}

export function saveWallState(uid, state) {
  try { localStorage.setItem(stateKey(uid), JSON.stringify(state)); } catch { /* best effort */ }
}
