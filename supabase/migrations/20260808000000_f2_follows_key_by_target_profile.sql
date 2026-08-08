-- F2 · a follow is keyed by the PROFILE followed, not by the ACCOUNT that owns it
--
-- ── WHAT IS BROKEN ───────────────────────────────────────────────────
--
-- `follows_user_id_entity_id_key` is UNIQUE (user_id, entity_id), and every
-- writer sets `entity_id = profile.user_id ?? profile.id` — the followed
-- ACCOUNT, not the followed PROFILE. So the key reads "Luc follows account
-- 6b50daa7" and has nowhere to record WHICH of that account's profiles.
--
-- An account with two followable profiles therefore cannot be followed twice.
-- Someone who runs a venue and also DJs has a `venue` profile and an `artist`
-- profile under one login; hearting the second is rejected as a duplicate
-- (23505), and on Discover it fails SILENTLY because no onError is passed.
--
-- The row already carries the right answer. `target_profile_id` names the
-- individual profile, was introduced by M5.1 (D6) as the canonical key, and is
-- what every read resolves by. The constraint simply predates it and was never
-- moved across. This moves it.
--
-- ── WHY TWO INDEXES AND NOT ONE ──────────────────────────────────────
--
-- `follows` stores two shapes. Profile follows carry target_profile_id; EVENT
-- follows (F1) carry entity_id = the event id and leave target_profile_id
-- NULL. A single UNIQUE (user_id, target_profile_id) would not constrain
-- events at all — in Postgres NULLs are distinct, so every event follow would
-- be unique to the index and duplicate event hearts would become writable for
-- the first time. Dropping the old key without replacing its event half would
-- REMOVE protection that exists today.
--
-- So each shape gets a partial index over the column that actually identifies
-- it, and neither can drift into the other's keyspace.
--
-- ── DATA STATE AT WRITE TIME (verified against production 2026-08-08) ─
--
--     42 rows · 36 profile follows · 6 event follows
--     profile rows with NULL target_profile_id ........ 0
--     event rows with target_profile_id set ........... 0
--     duplicates on (user_id, target_profile_id) ...... 0
--     duplicates on (user_id, entity_id) for events ... 0
--
-- Both indexes build clean with no backfill and no dedupe. ⚠ If that is no
-- longer true when this is applied, CREATE UNIQUE INDEX fails outright rather
-- than silently dropping rows — which is the behaviour worth having. Resolve
-- the duplicates first, do not weaken the index.
--
-- ⚠ `entity_id` IS NOT RETIRED HERE. Legacy rows key it by profile.id while
-- current rows key it by user_id, and reads still span both keyspaces
-- (FollowHeartBtn, ProfileScreen). Retiring it is a separate change that has
-- to backfill first; this migration only stops it being the UNIQUENESS rule.

begin;

alter table public.follows
  drop constraint if exists follows_user_id_entity_id_key;

-- Profile follows: one row per (follower, followed PROFILE).
create unique index if not exists follows_user_target_profile_key
  on public.follows (user_id, target_profile_id)
  where target_profile_id is not null;

-- Event follows: target_profile_id is NULL by design, so the event id is what
-- identifies the row. Preserves exactly the protection the dropped key gave.
create unique index if not exists follows_user_event_key
  on public.follows (user_id, entity_id)
  where entity_type = 'event';

comment on index public.follows_user_target_profile_key is
  'One follow per (follower, followed profile). Replaces follows_user_id_entity_id_key (F2, 2026-08-08), which keyed on the followed ACCOUNT and so allowed an account with two followable profiles to be followed only once — the second heart failed with 23505, silently.';

comment on index public.follows_user_event_key is
  'One follow per (follower, event). The event half of the dropped follows_user_id_entity_id_key: event follows leave target_profile_id NULL, and NULLs are distinct, so without this partial index duplicate event hearts would become writable.';

commit;
