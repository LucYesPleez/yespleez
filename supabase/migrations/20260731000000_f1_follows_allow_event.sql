-- F1 · follows_entity_type_check must permit 'event'
--
-- ── WHAT WAS BROKEN ──────────────────────────────────────────────────
--
-- Every event heart in the app has ALWAYS failed. The heart on What's On,
-- on EventScreen and (as of this week) on My Scene's Spotlight and catalogue
-- floor all insert `follows.entity_type = 'event'`, and the CHECK constraint
-- rejects it with 23514. None of those call sites read the returned error —
-- Supabase RETURNS errors rather than throwing — so the heart filled in, My
-- Scene toasted "Saved — find it under SAVED", and no row was ever written.
--
-- ── THE CONSTRAINT'S ACTUAL CONTENTS, FINALLY READ ───────────────────
--
-- docs/live-schema-audit-2026-07.md §6 records these values as never read
-- ("Unverifiable with the anon key"), which left backlog items S1, S28 and
-- S33 all blocked on the same unknown. Established 2026-07-31 by probing
-- each candidate with an authenticated insert and deleting the survivors:
--
--     ALLOWED   artist · venue · host · band · standup
--     REJECTED  event · profile · punter · crew
--
-- So the audit's standing hypothesis — that the "Supabase outage" blamed for
-- the event-heart 400 was really schema drift — is CONFIRMED. It was never an
-- outage. The constraint simply predates events becoming followable.
--
-- ── SCOPE ────────────────────────────────────────────────────────────
--
-- This adds 'event' ONLY. It deliberately does not add:
--   'profile' — S1's bug is that ProfileScreen writes a literal 'profile'
--               instead of the target's real type. The fix there is to write
--               the real type, NOT to widen the constraint to accept a value
--               that carries no information.
--   'punter'  — nothing is meant to follow a personal profile yet; adding it
--               would invite rows the product has no design for.
-- The constraint is worth keeping tight: it is the only thing that has been
-- telling us about these drifts at all.

alter table public.follows
  drop constraint if exists follows_entity_type_check;

alter table public.follows
  add constraint follows_entity_type_check
  check (entity_type in ('artist', 'venue', 'host', 'band', 'standup', 'event'));

comment on constraint follows_entity_type_check on public.follows is
  'Allowed follow targets: the five profile types plus ''event''. ''event'' added 2026-07-31 (F1) — it had been rejected since the table was created, silently breaking every event heart. Deliberately excludes ''profile'' (S1: write the target''s real type instead) and ''punter'' (no product design for following a personal profile).';
