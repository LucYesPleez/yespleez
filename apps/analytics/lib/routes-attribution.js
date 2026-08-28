/**
 * ATTRIBUTION ROUTES — campaigns and funnels, strengths always named.
 * Routes fetch and serve; lib/attribution.js decides.
 */

import { coalesceTouches, funnel } from './attribution.js';

/** The standard product funnel, path-prefix and event-name driven. */
const STAGES = [
  { key: 'touch', match: () => false },                    // filled from touches, not events
  { key: 'event_view', match: (e) => e.name === 'screen_view' && typeof e.props_path === 'string' && e.props_path.startsWith('/event/') },
  { key: 'application_open', match: (e) => e.name === 'screen_view' && typeof e.props_path === 'string' && e.props_path.startsWith('/apply') },
  { key: 'applied', match: (e) => e.name === 'applied' },
];

export function mountAttributionRoutes(app, db) {

  app.get('/api/campaigns', async (req, res) => {
    try {
      const { rows, complete } = await db.readAll(
        'attribution_touches?select=campaign,source,medium,placement,creative,device_id,session_id,platform,created_at&order=id.asc',
        { schema: 'public' }
      );
      res.json({ campaigns: coalesceTouches(rows), raw_touches: rows.length, complete });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  /**
   * One funnel, scoped by ?source= or ?campaign= (at least one).
   * Every stage carries its strength split and platform split; the
   * touch row count opens the funnel. Days bounds the EVENT window;
   * touches are read in full — a poster keeps working for months.
   */
  app.get('/api/funnels', async (req, res) => {
    const source = typeof req.query.source === 'string' ? req.query.source : null;
    const campaign = typeof req.query.campaign === 'string' ? req.query.campaign : null;
    if (!source && !campaign) return res.status(400).json({ error: 'Pass ?source= or ?campaign=.' });
    const days = Math.min(3650, Math.max(1, Number(req.query.days) || 90));
    try {
      const filter = (source ? '&source=eq.' + encodeURIComponent(source) : '') +
                     (campaign ? '&campaign=eq.' + encodeURIComponent(campaign) : '');
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const [touches, events, links] = await Promise.all([
        db.readAll('attribution_touches?select=device_id,session_id,user_id,platform,created_at' + filter + '&order=id.asc', { schema: 'public' }),
        db.readAll(
          'usage_events?select=name,device_id,user_id,session_id,platform,created_at,props' +
          '&created_at=gte.' + encodeURIComponent(since) + '&order=id.asc',
          { schema: 'public' }
        ),
        db.readAll('identity_links?select=device_id,user_id&order=id.asc'),
      ]);
      // Flatten the one prop the stages read, so match() stays cheap.
      const evs = events.rows.map((e) => ({ ...e, props_path: e.props?.path }));
      const stages = funnel(touches.rows, evs, links.rows, STAGES.slice(1));
      res.json({
        source, campaign, window_days: days,
        touches: touches.rows.length,
        touch_devices: new Set(touches.rows.map((t) => t.device_id)).size,
        stages,
        complete: touches.complete && events.complete && links.complete,
        note: 'Stage totals are sums of named strengths; unattributed events are not in them.',
      });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });
}
