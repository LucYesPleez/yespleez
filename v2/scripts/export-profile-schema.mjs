/**
 * YesPleez → Studio PROFILE SCHEMA export (run in the v2 app; NOT part of Studio)
 * ---------------------------------------------------------------------------
 * Bundles the app's canonical profile taxonomy (src/lib/profileTaxonomy.js) and
 * location data (src/lib/auLocations.js) into a single JSON that Studio loads,
 * so Studio's genre tags, suburb picker and per-type profile fields always
 * match the app. Re-run after changing the profile model — no Studio edits.
 *
 *   node scripts/export-profile-schema.mjs
 *
 * Writes  C:\Users\L-c\GigImporter\profile-schema.json  (override --out=PATH).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as TAX from '../src/lib/profileTaxonomy.js';
import * as LOC from '../src/lib/auLocations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const argOut = process.argv.find(a => a.startsWith('--out='));
const OUT = argOut ? argOut.slice(6) : 'C:\\Users\\L-c\\GigImporter\\profile-schema.json';

// auLocations exports the SUBURB_MAP indirectly; re-read the module's map by
// probing resolveLocationToPostcodes over its own keys is unnecessary — the map
// is the source, so import it. It isn't exported, so reconstruct from the file's
// public helpers is avoided: profileTaxonomy owns taxonomy; locations owns the map.
// We import the map via a tiny re-export shim expectation: auLocations must export
// SUBURB_MAP. If it doesn't yet, add `export { SUBURB_MAP }`.
const suburbMap = LOC.SUBURB_MAP || {};

const schema = {
  meta: {
    generatedAt: new Date().toISOString(),
    source: 'yespleez app · src/lib/profileTaxonomy.js + auLocations.js',
  },
  genres: {
    main: TAX.MAIN_GENRES,
    sub: TAX.SUBGENRES,
    host: TAX.HOST_GENRES,
    all: TAX.ALL_GENRES,
    vibes: TAX.VIBES,
    sep: TAX.GENRE_SEP,
  },
  locations: { suburbMap },
  profileFields: TAX.PROFILE_FIELDS,
  hostCategories: TAX.HOST_CATEGORIES,
};

writeFileSync(OUT, JSON.stringify(schema, null, 2), 'utf8');
console.log('Wrote', OUT);
console.log('genres.main:', schema.genres.main.length, '· suburbs:', Object.keys(suburbMap).length,
  '· types:', Object.keys(schema.profileFields).join(', '));
