import { createClient } from '@supabase/supabase-js';
import { captureBootState, armAuthDiagnostics } from './authDiagnostics';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ⚠ BEFORE createClient, AND THAT IS THE WHOLE POINT — see authDiagnostics.js.
// The client's `initialize()` starts as soon as it is constructed and can
// refresh (and on rejection, REMOVE) the stored session on its own. Reading
// storage after that would record a sign-out caused by this very page load as
// though the storage had been evicted while the app was closed. This is the
// only position in the module graph where running first is guaranteed rather
// than merely likely, which is why it lives here and not in main.jsx.
captureBootState();

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Module scope, so it registers exactly once per app instance: StrictMode
// double-invokes component effects, and a second subscription would double
// every entry in a fixed-size log.
armAuthDiagnostics(supabase);
