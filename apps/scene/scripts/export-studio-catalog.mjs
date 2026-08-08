/**
 * YesPleez → Studio catalog export (run in the v2 app; NOT part of Studio)
 * ---------------------------------------------------------------------------
 * Studio must never read Supabase directly. This script — which lives in the
 * v2 app where Supabase access legitimately exists — takes a point-in-time
 * snapshot of the live catalog (profiles + events) and writes it as the JSON
 * that Studio's registered provider loads. Re-run whenever the live data
 * changes and you want Studio to dedupe against the latest state.
 *
 *   node scripts/export-studio-catalog.mjs
 *
 * Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env.local.
 * Writes to  C:\Users\L-c\GigImporter\catalog-export.json  (override --out=PATH).
 *
 * PII-SAFE BY CONSTRUCTION: an ALLOWLIST decides which columns leave the
 * database. Sensitive fields (contact_email, phone, abn, emergency_*, …) are
 * never selected into the snapshot — add a key to FIELD_ALLOW only if it is
 * public-facing identity/dedup data.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const argOut = process.argv.find(a => a.startsWith('--out='));
const OUT = argOut ? argOut.slice(6) : 'C:\\Users\\L-c\\GigImporter\\catalog-export.json';

/* ---- env ---- */
function loadEnv() {
  const raw = readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8');
  const env = {};
  raw.split(/\r?\n/).forEach(line => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
  return env;
}
const env = loadEnv();
const url = env.VITE_SUPABASE_URL, key = env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) { console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local'); process.exit(1); }
const supabase = createClient(url, key);

/* ---- mapping ---- */
// profiles.type -> Studio catalog bucket. Performer types collapse to `artists`
// (Studio's importer treats every lineup act as an `artist` candidate).
const TYPE_BUCKET = {
  venue: 'venues', host: 'hosts', festival: 'festivals',
  artist: 'artists', band: 'artists', standup: 'artists', dj: 'artists', musician: 'artists',
  // punter and any other type are intentionally NOT exported (not dedup targets)
};
// Public identity / dedup fields only. Anything not here never leaves the DB.
const FIELD_ALLOW = [
  'name', 'display_name', 'aliases', 'location', 'suburb', 'state', 'postcode',
  'address', 'website', 'instagram', 'facebook', 'genre_string', 'tagline',
  'capacity', 'established', 'years',
];

function pick(row) {
  const out = {};
  FIELD_ALLOW.forEach(k => { if (row[k] != null && row[k] !== '') out[k] = row[k]; });
  const img = row.avatar_thumb || row.avatar || row.avatar_hero;
  if (img) out.image = img;
  if (out.genre_string && !out.genre) { out.genre = out.genre_string; delete out.genre_string; }
  return out;
}

async function main() {
  const { data: profiles, error: pErr } = await supabase
    .from('profiles')
    .select('*');
  if (pErr) throw pErr;

  const catalog = { events: [], venues: [], artists: [], hosts: [], festivals: [] };
  const nameById = {};
  const skipped = {};

  (profiles || []).forEach(p => {
    nameById[p.id] = p.name;
    const bucket = TYPE_BUCKET[p.type];
    if (!bucket) { skipped[p.type] = (skipped[p.type] || 0) + 1; return; }
    catalog[bucket].push(Object.assign(
      { id: p.id, type: p.type === 'venue' || p.type === 'host' || p.type === 'festival' ? p.type : 'artist',
        ownership: p.user_id ? 'claimed' : 'unclaimed' },
      pick(p),
    ));
  });

  const { data: events, error: eErr } = await supabase
    .from('events')
    .select('id, host_id, name, config, created_at')
    .order('created_at', { ascending: false })
    .limit(500);
  if (eErr) throw eErr;

  (events || []).forEach(ev => {
    const cfg = ev.config || {};
    catalog.events.push({
      id: ev.id, name: ev.name,
      venue: cfg.venue || '', date: cfg.date || '',
      host: nameById[ev.host_id] || '', ownership: 'unknown',
    });
  });

  const meta = {
    generatedAt: new Date().toISOString(),
    source: 'yespleez-supabase (v2 app export)',
    counts: Object.fromEntries(Object.keys(catalog).map(k => [k, catalog[k].length])),
    skippedTypes: skipped,
  };
  writeFileSync(OUT, JSON.stringify({ meta, ...catalog }, null, 2), 'utf8');
  console.log('Wrote', OUT);
  console.log('Counts:', meta.counts);
  if (Object.keys(skipped).length) console.log('Skipped (non-dedup types):', skipped);
}

main().catch(e => { console.error('Export failed:', e.message || e); process.exit(1); });
