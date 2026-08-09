import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/**
 * ⛔⛔ `root` AND `envDir` ARE PINNED ON PURPOSE. DO NOT REMOVE THEM.
 *
 * This app's four VITE_* values come from a COMMITTED .env.production in this
 * directory, not from the Pages dashboard. Vite resolves `envDir` from the
 * current working directory when it is not set, so a build invoked from the
 * monorepo root — by a workspace script, a CI runner, or a Pages project whose
 * root directory is wrong — would look for .env.production one level up, find
 * nothing, and hand every variable back as `undefined`.
 *
 * ⚠ IT FAILS SILENTLY, AND WORSE THAN SILENTLY:
 *   · the Supabase client gets no URL or key
 *   · VITE_ORGANISER_ALLOWLIST is documented FAIL-CLOSED, so nobody can sign in
 *   · VITE_SCENE_URL falls back to localhost, so every application link this
 *     app hands out points at the organiser's own machine — valid-looking, dead
 *
 * Pinning both to this file's own directory makes the build independent of
 * where it was invoked from, which is the whole point in a monorepo.
 */
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  envDir: here,
  plugins: [react()],
  server: { port: 5180 },
});
