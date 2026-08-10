-- ═══════════════════════════════════════════════════════════════════
-- P12 · ASK CATEGORY — what an interaction is asking FOR
-- Design: `Claude Cowork\ask-category-design-2026-08-10.md` (ratified).
-- MANUAL APPLY. Paste into the Supabase SQL editor. Never `supabase db push`.
-- ═══════════════════════════════════════════════════════════════════
--
-- ⭐⭐ THE GOVERNING RULE: an Ask Category describes the requested SUPPLY,
-- ⛔ never the identity of the person supplying it.
--
--     DJ       → music              ⛔ not: artist  → music
--     comedian → performance_artist ⛔ not: standup → performance_artist
--
-- The second column is only true because roles currently live inside profile
-- types. The resolver keys on the ROLE so that stays true when someone is a DJ,
-- a comedian and a facilitator at once.
--
-- ── ⛔⛔ THE COLUMN STORES. IT DOES NOT RESOLVE. ──
--
-- No DEFAULT, no trigger, no generated expression, no CHECK against a
-- vocabulary. The RESOLVER decides the value (Scene:
-- `lib/askCategoryResolver.js`, from `@yespleez/ask-categories`); this column
-- holds the resulting HISTORICAL FACT and nothing else.
--
-- Putting resolution in the database would mean two implementations of one
-- rule, and the SQL one would silently win on any path that forgot to ask.
--
-- ── ⭐ WHY STORED AND NEVER DERIVED AT READ TIME ──
--
-- Profile types change and event configuration is editable, so a category
-- derived on read would silently rewrite what an old enquiry was ASKING FOR.
-- Same reason `applications.requirements_snapshot` and
-- `venue_enquiries.requirements_snapshot` exist: the record must keep naming
-- what was true at the time.
--
-- ⭐ Stores the KEY, ⛔ never the label. Labels are display and drift by design;
-- the registry owns them. A stored label would go stale against it.
--
-- ── ⚠ NULL IS A REAL ANSWER — THREE OF THEM ──
--
--   1. the row predates Ask Categories        (every existing row)
--   2. the asker has NO applicable category   (host, festival — see below)
--   3. the asker must CHOOSE and has not yet  (cannot occur today)
--
-- ⛔ NO BACKFILL, and no inference for historical rows. NULL means "created
-- before this existed" — a fact, not a failure. Readers render NO CHIP; they
-- must never substitute a guess or a placeholder.
--
-- ⚠ `host` and `festival` profiles resolve to NULL deliberately. A promoter
-- enquiring with a venue is asking to USE THE ROOM, which none of the nine
-- categories covers — they all came from a festival recruiting suppliers. ⛔ Do
-- NOT invent `venue_hire` to remove the null: neither type has a dashboard that
-- shows enquiries at all (HostDashboard never reads venue_enquiries; a festival
-- profile has no Scene dashboard), so the category would describe a flow the
-- product does not support. Whether the picker should offer those types is a
-- separate product question.
--
-- ── UNCONSTRAINED TEXT, for P4's reason ──
--
-- No CHECK against the nine keys. An unrecognised key is surfaced by the
-- registry as "no label, no chip" and is harmless, whereas a CHECK would reject
-- the entire write whenever code shipped ahead of the data. Failing open on one
-- field beats failing closed on the whole enquiry.
--
-- ⛔ `festival_applications.category_key` is NOT touched. It already stores an
-- explicitly chosen category and is authoritative.
-- ⛔ Invitations are NOT given a category here — an invitation contains no
-- statement of supply (see the design note §5a). They remain NULL by design.

ALTER TABLE public.venue_enquiries
  ADD COLUMN IF NOT EXISTS ask_category text;

COMMENT ON COLUMN public.venue_enquiries.ask_category IS
  'P12 — what this interaction is asking FOR, from the Ask Category registry '
  '(@yespleez/ask-categories). Describes the requested SUPPLY, never the '
  'supplier''s identity. Resolved from the acting profile''s ROLE and stored at '
  'creation; ⛔ never derived at read time, or a later profile edit would '
  'rewrite what an old enquiry meant. Stores the KEY, never the label. NULL is '
  'a real answer: the row predates this, or the asker had no applicable '
  'category (host/festival), or a choice is owed. ⛔ No backfill. Readers render '
  'no chip. ⚠ initiated_by = ''venue'' rows stay NULL — an invitation contains '
  'no statement of supply.';

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS ask_category text;

COMMENT ON COLUMN public.applications.ask_category IS
  'P12 — what this application is asking FOR, from the Ask Category registry. '
  'Same rules as venue_enquiries.ask_category: resolved from the acting '
  'profile''s ROLE, stored at creation, key not label, NULL for rows that '
  'predate it. ⛔ Distinct from the EVENT''s category (CATEGORY_BADGES) and from '
  'the applicant''s profile taxonomy — four different things have been called '
  '"category" in this codebase and merging them is the debt this registry was '
  'created to end.';

-- No RLS change. Both tables' policies already govern their rows; this is an
-- ordinary field of each and is visible to exactly whoever the row is.

-- ── VERIFY ──
-- Expect two rows, both text / YES:
--
--   SELECT table_name, column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND column_name = 'ask_category'
--    ORDER BY table_name;
--
-- Expect ZERO rows — nothing may be backfilled by this migration:
--
--   SELECT count(*) FROM public.venue_enquiries WHERE ask_category IS NOT NULL;
--   SELECT count(*) FROM public.applications    WHERE ask_category IS NOT NULL;
--
-- ⚠ AFTER the code ships, this becomes the standing invariant — an invitation
-- must never carry a category. Expect zero rows:
--
--   SELECT id FROM public.venue_enquiries
--    WHERE initiated_by = 'venue' AND ask_category IS NOT NULL;
--
-- ── ROLLBACK ──
--   ALTER TABLE public.venue_enquiries DROP COLUMN IF EXISTS ask_category;
--   ALTER TABLE public.applications    DROP COLUMN IF EXISTS ask_category;
