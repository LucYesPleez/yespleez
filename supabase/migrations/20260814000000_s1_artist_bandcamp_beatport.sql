-- S1 · BANDCAMP AND BEATPORT BECOME STORABLE.
--
-- `lib/socialLinks.js` has known both platforms since it was written — its
-- PLATFORMS map normalises and links them correctly — but `profiles` has no
-- column for either, so no editor could offer a field and nothing could ever
-- hold a value. This closes that half: the columns exist, and the artist
-- editor writes them.
--
-- ⚠ RUN BEFORE PROMOTING THE S1 CODE. PostgREST rejects an INSERT naming a
-- column that does not exist with a 400 and writes NOTHING — so an editor
-- shipped ahead of this migration would not merely drop the two new fields,
-- it would fail every artist profile save outright. Migrations first (§7 of
-- the 2026-08-12 handover).
--
-- ⚠ NULLABLE TEXT, MATCHING THE OTHER NINE. Not empty-string-defaulted: the
-- whole social layer reads absence as NULL or 'N/A' (see ProfileScreen's
-- `na()` and SocialSection's N/A toggle), and a column that defaults to ''
-- would make "never filled in" a third state the readers do not know about.
--
-- ⛔ NO RLS OR GRANT CHANGES HERE. These are two more columns on a table
-- whose policies are column-blind; adding one does not widen anything, and
-- restating a profiles policy is how the SEC-1 class of defect gets made.

alter table public.profiles add column if not exists bandcamp text;
alter table public.profiles add column if not exists beatport text;

comment on column public.profiles.bandcamp is
  'Bare handle (artist.bandcamp.com → "artist"), normalised by lib/socialLinks.js. NULL = never set, ''N/A'' = explicitly declined.';
comment on column public.profiles.beatport is
  'Bare handle/path, normalised by lib/socialLinks.js. NULL = never set, ''N/A'' = explicitly declined.';
