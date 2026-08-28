/**
 * METRICS ROUTES — the live summary, on the canonical classifier.
 * ---------------------------------------------------------------------------
 * D6 closed: `population=all` fetches UNFILTERED and filters nothing.
 * D8 closed: session_id is selected. The route reads the WHOLE window
 * (paged, completeness reported) and classifies in code — honest for
 * every population, at local volumes. The query-level exclusion trick
 * returns as an optimisation only if volume forces it, and then per
 * population, stated on the payload.
 */

import { deriveDeviceSegments, POPULATIONS } from './identity.js';
import { aggregate } from './metrics.js';
import { dailySeries } from './daily.js';
import WEEKS from './weeks.cjs';

export function mountMetricsRoutes(app, db) {

  /** Shared read: window rows + current classification, once. */
  async function windowContext(sinceISO, untilISO) {
    const window =
      'usage_events?select=name,device_id,user_id,session_id,display_mode,platform,created_at' +
      (sinceISO ? '&created_at=gte.' + encodeURIComponent(sinceISO) : '') +
      '&created_at=lte.' + encodeURIComponent(untilISO) +
      '&order=id.asc';
    const [events, segs, links] = await Promise.all([
      db.readAll(window, { schema: 'public' }),
      db.readAll('account_segments?select=user_id,segment&order=user_id.asc'),
      db.readAll('identity_links?select=device_id,user_id&order=id.asc'),
    ]);
    const users = {};
    segs.rows.forEach((r) => { users[r.user_id] = r.segment; });
    return {
      events,
      segments: { users, devices: deriveDeviceSegments(links.rows, users) },
      linkedDevices: new Set(links.rows.map((l) => l.device_id)),
      complete: events.complete && segs.complete && links.complete,
      internalAccounts: Object.values(users).filter((s) => s === 'internal').length,
    };
  }

  app.get('/api/summary', async (req, res) => {
    const population = POPULATIONS.includes(req.query.population) ? req.query.population : 'public';

    // Window: 1–3650 days, or all history. asOf pins "now" to a given
    // instant so a figure can be recomputed later and match itself —
    // determinism as a feature, and what the reconciliation runs on.
    const all = req.query.days === 'all';
    const days = all ? null : Math.min(3650, Math.max(1, Number(req.query.days) || 7));
    const asOf = req.query.asOf && !Number.isNaN(Date.parse(req.query.asOf))
      ? new Date(req.query.asOf) : new Date();

    try {
      const since = all ? null : new Date(asOf.getTime() - days * 86400000).toISOString();
      const window =
        'usage_events?select=name,device_id,user_id,session_id,display_mode,platform,created_at' +
        (since ? '&created_at=gte.' + encodeURIComponent(since) : '') +
        '&created_at=lte.' + encodeURIComponent(asOf.toISOString()) +
        '&order=id.asc';

      const [events, segs, links] = await Promise.all([
        db.readAll(window, { schema: 'public' }),
        db.readAll('account_segments?select=user_id,segment&order=user_id.asc'),
        db.readAll('identity_links?select=device_id,user_id&order=id.asc'),
      ]);

      const users = {};
      segs.rows.forEach((r) => { users[r.user_id] = r.segment; });
      const segments = { users, devices: deriveDeviceSegments(links.rows, users) };
      const linkedDevices = new Set(links.rows.map((l) => l.device_id));

      res.json({
        generatedAt: new Date().toISOString(),
        asOf: asOf.toISOString(),
        window: all ? 'all history' : 'last ' + days + ' days',
        // A partial read must be a warning on the payload, never a
        // confident-looking undercount.
        complete: events.complete && segs.complete && links.complete,
        classification: {
          internal_accounts: Object.values(users).filter((s) => s === 'internal').length,
          internal_devices: Object.keys(segments.devices).length,
        },
        ...aggregate(events.rows, { population, segments, linkedDevices }),
      });
    } catch (e) {
      console.error('[analytics] ' + e.message);
      res.status(502).json({ error: e.message });
    }
  });

  /**
   * The daily series: canonical metrics per SYDNEY calendar day.
   * Days are derived, never stored — weeks remain the permanent
   * artefacts, so there is no second history to drift. Quiet days
   * appear as zero rows, not gaps.
   */
  app.get('/api/daily', async (req, res) => {
    const population = POPULATIONS.includes(req.query.population) ? req.query.population : 'public';
    const days = Math.min(120, Math.max(1, Number(req.query.days) || 14));
    try {
      const now = new Date();
      const toDay = WEEKS.localDate(now);
      const fromDay = WEEKS.localDate(new Date(now.getTime() - (days - 1) * 86400000));
      // Fetch one extra UTC day either side, then let the Sydney
      // bucketing decide — the timezone boundary, not the query, owns
      // which day an event belongs to.
      const since = new Date(now.getTime() - (days + 1) * 86400000).toISOString();
      const ctx = await windowContext(since, now.toISOString());
      res.json({
        population,
        from: fromDay,
        to: toDay,
        zone: WEEKS.ZONE,
        complete: ctx.complete,
        days: dailySeries(ctx.events.rows, {
          population, segments: ctx.segments, linkedDevices: ctx.linkedDevices,
          fromDay, toDay,
        }),
      });
    } catch (e) {
      console.error('[analytics] ' + e.message);
      res.status(502).json({ error: e.message });
    }
  });
}
