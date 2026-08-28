/**
 * YESPLEEZ ANALYTICS v2 — service foundation (Phase AV0).
 * ---------------------------------------------------------------------------
 * A separate application alongside Studio. Express, :4100, local-only.
 *
 * ⭐⭐ NEVER IN THE WRITE PATH. Clients write raw events straight to
 * Supabase under the A1 INSERT policy, exactly as before this service
 * existed. If this process is down, nothing is lost anywhere. This is
 * the platform's one READER of analytics evidence, and its one
 * interpreter.
 *
 * ⭐ THE ARITHMETIC IS NEVER IN A ROUTE. Routes fetch rows and serve
 * results; every decision about what a number MEANS lives in a pure,
 * tested module (the analytics-identity classifier arrives in the next
 * phase). Same contract Studio's analytics modules established.
 *
 * SECURITY: the service-role key lives in this process's env and
 * nowhere else. No route echoes it; error messages may carry
 * PostgREST's text but never the key. Local-only via requireLocal —
 * a placeholder for real auth when hosting arrives, not a form of it.
 */

import express from 'express';
import { fileURLToPath } from 'node:url';
import { requireLocal } from './lib/local.js';
import { makeDb } from './lib/db.js';
import { mountIdentityRoutes } from './lib/routes-identity.js';
import { mountMetricsRoutes } from './lib/routes-metrics.js';
import { mountAttributionRoutes } from './lib/routes-attribution.js';
import { mountSnapshotRoutes } from './lib/routes-snapshots.js';

const PORT = Number(process.env.ANALYTICS_PORT || 4100);
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CONFIGURED = Boolean(SUPABASE_URL && SERVICE_KEY);

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(requireLocal);

// The UI: one static page reading only /api/*. Same local gate as the
// API — the page without its data would just be an empty room.
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));

const db = CONFIGURED ? makeDb({ url: SUPABASE_URL, serviceKey: SERVICE_KEY }) : null;

/**
 * Health names its own findings. `configured` is env; `schema` is the
 * live exposure probe — the AV0 migration's manual PostgREST step
 * surfaces HERE by name if it was skipped, instead of as a mystery 406
 * three phases later.
 */
app.get('/api/health', async (req, res) => {
  const out = {
    service: 'yespleez-analytics',
    phase: 'F',
    configured: CONFIGURED,
  };
  if (!CONFIGURED) {
    out.reason = SUPABASE_URL
      ? 'SUPABASE_SERVICE_ROLE_KEY is not set in apps/analytics/.env'
      : 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set in apps/analytics/.env';
    return res.json(out);
  }
  out.schema = await db.checkExposure();
  res.json(out);
});

/**
 * The classification table, read straight through — AV0's proof that
 * the foundation reaches the database. Interpretation (classify,
 * populations, teams) arrives in later phases; this route will remain
 * as the raw inspection surface those phases' UI reads.
 */
app.get('/api/segments', async (req, res) => {
  if (!CONFIGURED) return res.status(503).json({ error: 'Service not configured; see /api/health.' });
  try {
    const { rows, total, complete } = await db.readAll(
      'account_segments?select=user_id,segment,source,note,updated_at&order=user_id.asc'
    );
    res.json({ segments: rows, total, complete });
  } catch (e) {
    console.error('[analytics] ' + e.message);
    res.status(502).json({ error: e.message });
  }
});

if (CONFIGURED) {
  mountIdentityRoutes(app, db);
  mountMetricsRoutes(app, db);
  mountAttributionRoutes(app, db);
  mountSnapshotRoutes(app, db);
}

app.use((req, res) => res.status(404).json({ error: 'Unknown route. The API lives under /api/.' }));

// Import-safe: tests import the app; only a direct run listens.
if (import.meta.url === 'file://' + process.argv[1]?.replace(/\\/g, '/')
    || process.argv[1]?.endsWith('server.js')) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log('[analytics] listening on http://127.0.0.1:' + PORT + (CONFIGURED ? '' : ' (NOT CONFIGURED — set .env)'));
  });
}

export { app };
