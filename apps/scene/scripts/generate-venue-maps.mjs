/**
 * VENUE MAPS generator — one static map image per POSTCODE, into our own bucket.
 * ---------------------------------------------------------------------------
 *   node scripts/generate-venue-maps.mjs              # every postcode in use
 *   node scripts/generate-venue-maps.mjs 2454 2450    # just these
 *   node scripts/generate-venue-maps.mjs --force      # re-fetch ones we have
 *   node scripts/generate-venue-maps.mjs --dry-run    # show the plan, fetch nothing
 *
 * ⚠ THIS IS THE ONLY PLACE A MAP PROVIDER IS EVER CALLED. The app reads images
 * out of our storage and nothing else — see src/lib/venueMap.js. Rendering a
 * provider URL in the client would put the key in the public bundle and turn
 * every page view into a third-party request. Keep the key on this side.
 *
 * ⚠ COST IS PER POSTCODE, NOT PER VIEW. A town is fetched once, stored, and
 * served from the CDN forever after. Ten thousand people opening ten thousand
 * Bellingen events is still the one call made the day 2454 was added. That is
 * the whole reason for the bucket.
 *
 * ── ENV (v2/.env.local) ──────────────────────────────────────────────
 *   GOOGLE_MAPS_STATIC_KEY   provider key
 *   SUPABASE_SERVICE_ROLE_KEY  upload rights; the anon key cannot write here
 *
 * ⚠ NEITHER MAY BE PREFIXED `VITE_`. Vite inlines every VITE_ var into the
 * browser bundle, so the prefix alone would publish both keys.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import AU_POSTCODES from '../src/lib/postcodes.js';
// venueMapPath.js, not venueMap.js: the latter imports the browser Supabase
// client, which Node cannot resolve. The bucket name is still defined once.
import { VENUE_MAPS_BUCKET, venueMapPath } from '../src/lib/venueMapPath.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── env ────────────────────────────────────────────────────────────────
// Read .env.local ourselves rather than relying on --env-file, which lands in
// different Node versions and would make the command version-dependent.
function loadEnv() {
  const path = resolve(__dirname, '..', '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const value = m[2].trim().replace(/^["'](.*)["']$/, '$1');
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}
loadEnv();

const MAPS_KEY = process.env.GOOGLE_MAPS_STATIC_KEY;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ⭐ CLOUD MAP ID (owner, 2026-08-03), optional. Created once in Google Cloud
// Console → Map Management → Map Styles, and styled there — including the
// label DENSITY control that inline `style=` params cannot reach. That is
// what actually gets the town's own name printed on the picture: at zoom 13
// you are already "inside" Bellingen, so Google's default styling assumes you
// know where you are and drops the locality label. A raw colour/visibility
// rule cannot override that; the density control in the cloud style editor
// can. ⚠ MUTUALLY EXCLUSIVE with inline `style=` — Google ignores inline
// styling the moment a map_id is present, so the two branches below never mix.
const MAP_ID = process.env.GOOGLE_MAPS_MAP_ID;

// ── args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');
const explicit = args.filter(a => /^\d{4}$/.test(a));

// A REGION, not a street corner and not a town from orbit (owner, 2026-08-03:
// "can also read the town name and surrounding towns"). The image sits behind
// an address and a directions button — it answers "whereabouts is this?", and
// the tap-through answers "how do I get there?". Zooming to rooftops would
// assert a precision the postcode centroid does not have.
//
// ⚠ THIS ALSO FIXES THE MISSING LABEL. Zoom 13 was close enough that Google
// treats you as already standing in the town and suppresses its own name —
// that is why "Bellingen" never appeared, not a colour or style problem. 11 is
// pulled back into the zoom band where locality names render as a matter of
// course, at Bellingen/Coffs Harbour's ~44km separation: 640px wide at zoom 11
// covers roughly 42km, so the frame reaches from one town toward the edge of
// the other without needing the Map ID's density override to force it.
const ZOOM = Number(process.env.VENUE_MAP_ZOOM || 11);
const SIZE = process.env.VENUE_MAP_SIZE || '640x400'; // ×2 below → 1280×800

// ⭐ ALWAYS DARK (owner, 2026-08-03). The image is baked once and cached — there
// is no client-side light/dark toggle for a stored PNG, so "always dark mode"
// means dark at generation time, matching the app's own theme instead of
// Google's default white basemap sitting inside a dark card.
const DARK_STYLE = [
  'element:geometry|color:0x1a1a24',
  'element:labels.text.fill|color:0x8a8a9a',
  'element:labels.text.stroke|color:0x0f0f16',
  'feature:administrative|element:geometry|color:0x3a3a4a',
  'feature:poi|visibility:off',
  'feature:road|element:geometry|color:0x2a2a38',
  'feature:road|element:labels.text.fill|color:0x9a9aaa',
  'feature:road.highway|element:geometry|color:0x3a3a4e',
  'feature:transit|visibility:off',
  'feature:water|element:geometry|color:0x0e1a2a',
];

/**
 * ⭐ TOWN CENTRES, where the postcode's own centroid is not one.
 * ---------------------------------------------------------------------------
 * AU_POSTCODES holds ONE coordinate per postcode, and for a postcode covering
 * a single town that coordinate is the town. For a postcode covering a town
 * plus a large rural hinterland it is neither — it is the area's geometric
 * middle, which can sit tens of kilometres from where anybody lives.
 *
 * 2450 is the case that surfaced it: the postcode reaches from Coffs Harbour
 * on the coast inland past Karangi, Coramba, Nana Glen and up to Clouds Creek,
 * so its centroid lands ~50km north-west of the city, in the ranges. The map
 * rendered creek country and no coastline, for a venue whose address says
 * Coffs Harbour. (Owner, 2026-08-04: "the map for coffs isnt right".)
 *
 * This is the concrete form of the standing finding that drawing these maps
 * from centroids is a dead end. The durable fix is geocoding the venue's own
 * locality rather than its postcode; until then, a correction here is one line
 * and costs one regenerate.
 *
 * ⚠ ADDING AN ENTRY REQUIRES A REGENERATE OF THAT POSTCODE plus a
 * VENUE_MAP_VERSION bump, or every browser keeps the old picture.
 */
const TOWN_CENTRES = {
  // Coffs Harbour CBD, not the 2450 centroid at [-30.0977, 152.6583].
  //
  // `focusX` — a COASTAL correction, not a general composition change. With
  // the town dead centre, everything right of it is open ocean: a third of
  // the picture is flat navy, and the part that says "this is a real place"
  // is squeezed into the left half. Pushing the town to 2/3 across trades
  // that empty water for the hinterland behind it.
  //
  // ⚠ Deliberately NOT applied to every map. An inland town like Bellingen
  // (2454) is surrounded by land on all sides and reads correctly centred —
  // owner, 2026-08-04: "bellingen one sits good on both phone and desktop.
  // it's just the coffs one". Only add this where the frame is genuinely
  // lopsided, and check the result rather than assuming.
  '2450': { at: [-30.2963, 153.1135], focusX: 2 / 3 },
};

/** Google's tile size — the constant behind every zoom/pixel conversion. */
const TILE_PX = 256;

/**
 * Where to CENTRE this postcode's map request.
 *
 * Usually the place itself. Where an entry declares `focusX`, the request is
 * offset so the place lands at that fraction across the frame instead of at
 * the middle: to put a town at 2/3, the camera has to sit 1/6 of a frame-width
 * west of it.
 *
 * The stored coordinate stays the TOWN's real position either way — the
 * offset is computed at fetch time and never written down, so the table
 * cannot rot into a set of mystery coordinates nobody can re-derive.
 */
function centreFor(postcode) {
  const override = TOWN_CENTRES[postcode];
  const at = override?.at ?? (Array.isArray(override) ? override : null) ?? AU_POSTCODES[postcode];
  if (!at) return null;

  const focusX = override?.focusX ?? 0.5;
  if (focusX === 0.5) return at;

  const [lat, lng] = at;
  const widthPx = Number(SIZE.split('x')[0]) || 640;
  // Longitude degrees per pixel at this zoom. Latitude is left alone: the ask
  // was horizontal, and a vertical shift would fight the CSS crop, which
  // already trims top and bottom to reach its aspect ratio.
  const degPerPx = 360 / (TILE_PX * 2 ** ZOOM);
  return [lat, lng - (focusX - 0.5) * widthPx * degPerPx];
}

/** Postcodes that actually have a venue on them. Fetching all 3,174 would be
 *  3,174 calls for 3,172 pictures nobody opens. */
async function postcodesInUse(db) {
  const { data, error } = await db
    .from('profiles')
    .select('postcode')
    .eq('type', 'venue')
    .not('postcode', 'is', null);
  if (error) throw new Error(`could not read venue postcodes: ${error.message}`);
  return [...new Set(data.map(r => String(r.postcode || '').trim()))]
    .filter(pc => /^\d{4}$/.test(pc))
    .sort();
}

async function existingFiles(db) {
  const { data, error } = await db.storage.from(VENUE_MAPS_BUCKET).list('', { limit: 1000 });
  // A missing bucket is a setup problem worth naming, not an empty listing.
  if (error) throw new Error(`could not list ${VENUE_MAPS_BUCKET}: ${error.message}`);
  return new Set(data.map(f => f.name));
}

async function fetchMap(postcode) {
  const [lat, lng] = centreFor(postcode);
  const url = new URL('https://maps.googleapis.com/maps/api/staticmap');
  url.searchParams.set('center', `${lat},${lng}`);
  url.searchParams.set('zoom', String(ZOOM));
  url.searchParams.set('size', SIZE);
  url.searchParams.set('scale', '2');
  url.searchParams.set('format', 'png');
  url.searchParams.set('maptype', 'roadmap');
  if (MAP_ID) {
    // The Map ID owns the whole style, including label density — see the note
    // where MAP_ID is read. Inline `style=` must NOT also be sent.
    url.searchParams.set('map_id', MAP_ID);
  } else {
    // Fallback with no Map ID configured: inline colour styling, plus an
    // explicit force-on for the locality label. This makes the town's name
    // more likely to survive at this zoom, but — unlike the Map ID's density
    // control — cannot guarantee it. Prefer setting GOOGLE_MAPS_MAP_ID.
    [...DARK_STYLE, 'feature:administrative.locality|element:labels|visibility:on']
      .forEach(rule => url.searchParams.append('style', rule));
  }
  url.searchParams.set('key', MAPS_KEY);

  const res = await fetch(url);
  const type = res.headers.get('content-type') || '';
  // ⚠ A refused key comes back as readable text, and an unchecked write would
  // store that text as `2454.png` — a "successful" run leaving a broken image.
  if (!res.ok || !type.startsWith('image/')) {
    const detail = type.startsWith('image/') ? res.statusText : (await res.text()).slice(0, 300);
    throw new Error(`provider returned ${res.status} ${type || '(no type)'} — ${detail}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const missing = [
    !MAPS_KEY && 'GOOGLE_MAPS_STATIC_KEY',
    !SUPABASE_URL && 'VITE_SUPABASE_URL',
    !SERVICE_KEY && 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter(Boolean);
  if (missing.length) {
    console.error(`Missing in v2/.env.local: ${missing.join(', ')}`);
    process.exit(1);
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const wanted = explicit.length ? explicit : await postcodesInUse(db);
  if (!wanted.length) {
    console.log('No venue postcodes found — nothing to do.');
    return;
  }

  const have = await existingFiles(db);
  const plan = [];
  for (const pc of wanted) {
    // centreFor, not AU_POSTCODES directly: a curated TOWN_CENTRES entry is a
    // perfectly good coordinate, and testing the table it overrides would skip
    // any postcode that exists only as a correction.
    if (!centreFor(pc)) {
      // Not a failure: it means the postcode is outside the AU table (an NZ
      // locality, or a typo). Say so and carry on — one odd venue must not
      // stop the other towns being generated.
      console.log(`  ${pc}  skipped — no coordinates in AU_POSTCODES`);
      continue;
    }
    if (have.has(venueMapPath(pc)) && !FORCE) {
      console.log(`  ${pc}  already stored`);
      continue;
    }
    plan.push(pc);
  }

  if (!plan.length) {
    console.log('\nEvery postcode in use already has a map. Use --force to refresh them.');
    return;
  }

  console.log(`\n${plan.length} to fetch at zoom ${ZOOM}, ${SIZE}@2x:`);
  if (DRY_RUN) {
    plan.forEach(pc => console.log(`  ${pc}  would fetch`));
    return;
  }

  let ok = 0;
  for (const pc of plan) {
    try {
      const png = await fetchMap(pc);
      // ⚠ cacheControl: '0' — NOT the earlier hour-long max-age. The URL is a
      // pure function of the postcode with no version in it (by design: no DB
      // column to keep in sync), so re-running this script updates the same
      // URL in place. A long max-age meant a browser that had already loaded
      // "2454.png" once kept reusing that exact byte-for-byte copy for up to
      // an hour after a `--force` regenerate — which is what made a real style
      // change (dark→dark, still stale) look like it silently reverted to
      // light. `0` still lets the browser cache the body; it just revalidates
      // via ETag on each request, so a fresh regenerate is visible immediately
      // while an unchanged file still costs a cheap 304, not a re-download.
      const { error } = await db.storage
        .from(VENUE_MAPS_BUCKET)
        .upload(venueMapPath(pc), png, { contentType: 'image/png', upsert: true, cacheControl: '0' });
      if (error) throw new Error(error.message);
      console.log(`  ${pc}  stored (${Math.round(png.length / 1024)} KB)`);
      ok += 1;
    } catch (err) {
      // Keep going: one town's failure is not the run's failure.
      console.error(`  ${pc}  FAILED — ${err.message}`);
    }
  }

  console.log(`\n${ok}/${plan.length} stored. Failures, if any, are listed above.`);
  if (ok < plan.length) process.exitCode = 1;
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
