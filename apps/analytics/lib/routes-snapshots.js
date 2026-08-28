/**
 * SNAPSHOT ROUTES — list, and the explicit rebuild.
 * ---------------------------------------------------------------------------
 * No scheduler here yet, deliberately: a snapshot regenerates from raw
 * at any time, so the cost of not having one is a click, and the
 * catch-up scheduler pattern arrives with the UI phase if wanted.
 * The rebuild is the Phase F deliverable: every completed week, all
 * populations, current classification, reason recorded.
 */

import { deriveDeviceSegments, POPULATIONS } from './identity.js';
import { buildSnapshot, partitionHolds, WEEKS, SCHEMA_VERSION } from './snapshots.js';

export function mountSnapshotRoutes(app, db) {

  app.get('/api/snapshots', async (req, res) => {
    try {
      const { rows } = await db.readAll(
        'snapshots?select=schema_version,population,week_start,week_end,metrics,rows_in_population,finalised,generated_at,rebuild_reason&order=week_start.desc,population.asc'
      );
      res.json({ snapshots: rows, schema_version: SCHEMA_VERSION });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  /**
   * Rebuild every completed week from raw events, at SCHEMA_VERSION 2.
   * Requires a reason — a rewrite of reporting history must say why,
   * and the rows carry it. Upserts on (version, population, week), so
   * rerunning is an idempotent regeneration, never a duplicate.
   */
  app.post('/api/snapshots/rebuild', async (req, res) => {
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim();
    if (!reason) return res.status(400).json({ error: 'A rebuild must state its reason.' });
    try {
      const [events, segs, links] = await Promise.all([
        db.readAll('usage_events?select=name,device_id,user_id,session_id,platform,created_at&order=id.asc', { schema: 'public' }),
        db.readAll('account_segments?select=user_id,segment&order=user_id.asc'),
        db.readAll('identity_links?select=device_id,user_id&order=id.asc'),
      ]);
      if (!events.complete) return res.status(502).json({ error: 'Raw read incomplete — refusing to rebuild on a partial dataset.' });

      const users = {};
      segs.rows.forEach((r) => { users[r.user_id] = r.segment; });
      const segments = { users, devices: deriveDeviceSegments(links.rows, users) };
      const linkedDevices = new Set(links.rows.map((l) => l.device_id));

      // Every completed Sydney week from the first event to now.
      const firstAt = new Date(events.rows[0].created_at);
      const weeks = [];
      let w = WEEKS.weekOf(new Date());
      // A week in progress is not history — start from the last COMPLETED one.
      w = WEEKS.previousWeek(w);
      while (w.endUTC.getTime() > firstAt.getTime()) {
        weeks.push(w);
        w = WEEKS.previousWeek(w);
      }

      const written = [];
      let partitionFailures = 0;
      for (const week of weeks) {
        const s = week.startUTC.toISOString(), e = week.endUTC.toISOString();
        const weekRows = events.rows.filter((r) => r.created_at >= s && r.created_at < e);
        const byPopulation = {};
        for (const population of POPULATIONS) {
          byPopulation[population] = buildSnapshot(weekRows, {
            population, segments, linkedDevices, week, finalised: true, reason,
          });
        }
        if (!partitionHolds(byPopulation)) { partitionFailures++; continue; }
        for (const population of POPULATIONS) {
          await db.write('snapshots?on_conflict=schema_version,population,week_start', {
            body: byPopulation[population],
            prefer: 'resolution=merge-duplicates,return=minimal',
          });
          written.push(week.weekStart + '/' + population);
        }
      }

      if (partitionFailures) {
        return res.status(500).json({
          error: partitionFailures + ' week(s) FAILED the partition property (populations do not sum to all) and were not written — the rebuild must not be trusted until diagnosed.',
        });
      }
      res.json({
        schema_version: SCHEMA_VERSION,
        weeks: weeks.length,
        rows_written: written.length,
        reason,
        raw_rows_read: events.rows.length,
        v1_untouched: true,
      });
    } catch (e) {
      console.error('[analytics] ' + e.message);
      res.status(502).json({ error: e.message });
    }
  });
}
