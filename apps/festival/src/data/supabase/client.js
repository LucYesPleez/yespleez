import { createClient } from '@supabase/supabase-js';

/**
 * The Supabase client — the SAME project as the Scene app.
 *
 * One backend, two front-ends. Auth, identity, profiles, messaging and
 * notifications are shared; this repo adds festival tables beside them and
 * never stands up a second account system.
 *
 * ⚠ Only the anon key belongs here. It ships to every browser and is
 * public by design — RLS is what protects the data, not the key. The service
 * role key must never appear in a VITE_ variable.
 */
// build-stamp: 2026-08-06 env-var rebuild — a real change, because an empty
// commit hits Cloudflare's build cache and reuses the old output byte-for-byte.
// NOTE:
// This application is client-side only.
// Values in VITE_* are intentionally public and are compiled into the bundle.
// Do not place secrets here.
// Authentication and data protection are enforced by Supabase RLS.
//
// ⚠ These values come from `.env.production` at build time — a DOCUMENTED
// DEPLOYMENT DECISION, not an accident. See DEPLOYMENT.md for the controlled
// experiment behind it before "fixing" this back to dashboard variables.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Fail loudly at startup rather than at the first query. A missing env var
// otherwise surfaces as an unauthorised fetch deep inside a repository, which
// reads like a permissions bug and sends you looking in the wrong place.
if (!url || !anonKey) {
  throw new Error(
    'Supabase env missing: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local',
  );
}

export const supabase = createClient(url, anonKey);
