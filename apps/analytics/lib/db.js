/**
 * POSTGREST READER — the service's one road to the database.
 *
 * ── THE TWO RULES EVERY READ HERE OBEYS ──────────────────────────
 *
 * 1. ⭐ BOTH HEADERS, ALWAYS. `apikey` alone answers as anon and
 *    fabricates a false ground truth; `Authorization: Bearer` is what
 *    actually carries the service role. Every request sends both.
 *
 * 2. ⚠⚠ POSTGREST CAPS EVERY RESPONSE AT 1,000 ROWS whatever `limit`
 *    says. Reads that can exceed a page MUST go through readAll(),
 *    which pages on Range headers and reports whether it saw
 *    everything — a partial read must be visible, never silent.
 *
 * ── SCHEMA ADDRESSING ────────────────────────────────────────────
 *
 * v2 tables live in the `analytics` schema, reached with an
 * `Accept-Profile: analytics` header. Raw events stay in `public`
 * (the default profile). The schema is an argument, not a global, so
 * a call site says which world it is reading from.
 *
 * ⚠ `analytics` must be listed in the project's Exposed schemas
 * (Dashboard → Settings → API) or these reads 406 even under the
 * service role. checkExposure() turns that misconfiguration into a
 * named startup finding instead of a mystery.
 */

const PAGE = 1000;

export function makeDb({ url, serviceKey, fetchImpl = fetch }) {
  if (!url || !serviceKey) throw new Error('makeDb: url and serviceKey are required');
  const base = url.replace(/\/+$/, '') + '/rest/v1/';

  function headers(schema, extra) {
    const h = {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      ...extra,
    };
    // 'public' is PostgREST's default profile; sending the header for
    // it is harmless but noisy — omit, so the common case reads clean.
    if (schema && schema !== 'public') h['Accept-Profile'] = schema;
    return h;
  }

  /** One page, with exact count. { rows, total, status } */
  async function read(path, { schema = 'analytics', range = [0, PAGE - 1] } = {}) {
    const res = await fetchImpl(base + path, {
      headers: headers(schema, {
        Prefer: 'count=exact',
        Range: range[0] + '-' + range[1],
      }),
    });
    if (!res.ok && res.status !== 206) {
      const body = await res.text().catch(() => '');
      throw new Error('PostgREST ' + res.status + ' on ' + path.split('?')[0] + ': ' + body.slice(0, 200));
    }
    const rows = await res.json();
    const cr = res.headers.get('content-range') || '';
    const total = cr.includes('/') ? Number(cr.split('/')[1]) || rows.length : rows.length;
    return { rows, total, status: res.status };
  }

  /**
   * Every row, paged. `cap` bounds the total fetched; the return says
   * whether the cap (or the data) ended the read — the caller decides
   * whether incomplete is an error, but can never not know.
   * ⚠ The path must carry a stable `order` including a unique column,
   * or paging can duplicate/skip rows between pages.
   */
  async function readAll(path, { schema = 'analytics', cap = 200_000 } = {}) {
    const rows = [];
    let total = 0;
    for (let from = 0; from < cap; from += PAGE) {
      const page = await read(path, { schema, range: [from, from + PAGE - 1] });
      total = page.total;
      rows.push(...page.rows);
      if (page.rows.length < PAGE) break;
    }
    return { rows, total, complete: rows.length >= total };
  }

  /**
   * Startup probe: can the service actually reach the analytics
   * schema? Distinguishes the three failure worlds by name so the fix
   * is legible from the log alone.
   */
  async function checkExposure() {
    try {
      const res = await fetchImpl(base + 'account_segments?select=user_id&limit=1', {
        headers: headers('analytics', { Range: '0-0' }),
      });
      if (res.ok || res.status === 206) return { ok: true };
      if (res.status === 406) {
        return { ok: false, reason: "The 'analytics' schema is not in Supabase's Exposed schemas (Dashboard → Settings → API). Add it; this is config, not SQL." };
      }
      if (res.status === 404) {
        return { ok: false, reason: 'analytics.account_segments does not exist — migrations AV0/AV1 have not been applied.' };
      }
      const body = await res.text().catch(() => '');
      return { ok: false, reason: 'PostgREST ' + res.status + ': ' + body.slice(0, 160) };
    } catch (e) {
      return { ok: false, reason: 'Could not reach Supabase: ' + e.message };
    }
  }

  /**
   * Write to a table. PostgREST addresses a WRITE's schema with
   * `Content-Profile` (Accept-Profile only steers reads).
   *
   * Writes exist for the SERVICE'S OWN tables — classification, teams,
   * links. ⛔ Raw usage_events is never a valid target: the raw store
   * is written by clients under the A1 policy and read here, full stop.
   * The guard is structural, not advisory.
   */
  async function write(path, { method = 'POST', body, schema = 'analytics', prefer } = {}) {
    if (/^usage_events\b/.test(path)) {
      throw new Error('Refusing to write usage_events: raw events are immutable from this service.');
    }
    const h = headers(schema, {
      'Content-Type': 'application/json',
      Prefer: prefer ?? 'return=representation',
    });
    if (schema && schema !== 'public') h['Content-Profile'] = schema;
    const res = await fetchImpl(base + path, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error('PostgREST ' + res.status + ' on ' + method + ' ' + path.split('?')[0] + ': ' + text.slice(0, 200));
    }
    if (res.status === 204) return [];
    return res.json();
  }

  return { read, readAll, write, checkExposure };
}
