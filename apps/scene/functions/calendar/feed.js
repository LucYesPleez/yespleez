/**
 * GET /calendar/feed?token=… — the YesPleez calendar subscription endpoint.
 *
 * A Cloudflare Pages Function (this repo's first): it deploys with the site
 * on every push, previews included, and its esbuild bundling lets it import
 * THE app's own calendar core — ⛔ no second generator, no Deno rewrite.
 *
 * ── SECURITY MODEL ───────────────────────────────────────────────────
 * Calendar clients fetch bare URLs — no headers, no cookies — so the token
 * IS the authentication (the same "secret address" model Google Calendar
 * uses). The token maps to exactly one user via the SECURITY DEFINER RPC
 * `calendar_feed_payload`, which does ALL row scoping in SQL and returns
 * only that user's own commitments with the private columns (notes, fees)
 * never selected. This function holds NO service key: it calls the RPC with
 * the public anon key, which on its own can read nothing from
 * `calendar_feeds` (RLS) — the token is the whole capability.
 *
 *     unknown token   → 404, no body worth probing
 *     disabled feed   → an EMPTY calendar, so subscribed clients clear
 *                       their YesPleez items (that is what "sync off" means)
 *     enabled feed    → text/calendar with the user's current commitments
 *
 * ⚠ Requires two Pages project env vars (Production AND Preview):
 * VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (SUPABASE_URL /
 * SUPABASE_ANON_KEY also accepted). Without them it answers 503 and says
 * so, ⛔ never a half-configured guess.
 */

import { feedCalendar } from '../../src/lib/calendarFeed.js';

const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!TOKEN_RE.test(token)) return new Response('Not found', { status: 404 });

  const base = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
  if (!base || !key) {
    return new Response('Calendar feed is not configured on this deployment.', { status: 503 });
  }

  const rpc = await fetch(`${base}/rest/v1/rpc/calendar_feed_payload`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ feed_token: token }),
  });
  if (!rpc.ok) return new Response('Not found', { status: 404 });

  const payload = await rpc.json();
  if (!payload || payload.found === false) return new Response('Not found', { status: 404 });

  const ics = feedCalendar(payload, { now: new Date() });
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="yespleez.ics"',
      /* Private: a capability URL must never land in a shared cache. Short
         max-age keeps a busy client from hammering the RPC. */
      'Cache-Control': 'private, max-age=300',
    },
  });
}
