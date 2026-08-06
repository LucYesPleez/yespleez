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
/**
 * ⚠ TEMPORARY DIAGNOSTIC — remove after the Cloudflare env experiment.
 *
 * One question: do values entered in the dashboard's "Variables and secrets"
 * panel reach the Vite build? VITE_DASHBOARD_PROBE exists ONLY in the
 * dashboard (deliberately not in .env.production), so its presence here is
 * conclusive either way. Presence booleans only — never the values.
 */
console.info('[env-diagnostic]', {
  mode: import.meta.env.MODE,
  dev: import.meta.env.DEV,
  prod: import.meta.env.PROD,
  hasUrl: Boolean(import.meta.env.VITE_SUPABASE_URL),
  hasAnonKey: Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY),
  hasAllowlist: Boolean(import.meta.env.VITE_ORGANISER_ALLOWLIST),
  hasDashboardProbe: Boolean(import.meta.env.VITE_DASHBOARD_PROBE),
  dashboardProbeValue: import.meta.env.VITE_DASHBOARD_PROBE ?? null,
});

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
