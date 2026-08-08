import { supabase } from './supabase';

// Pure lookup: (user_id, type) -> profiles.id, or null. Never creates, modifies, or throws — a miss is just null.
export async function resolveProfileId(userId, type) {
  if (!userId || !type) return null;
  try {
    const { data } = await supabase.from('profiles').select('id').eq('user_id', userId).eq('type', type).maybeSingle();
    return data?.id || null;
  } catch {
    return null;
  }
}
