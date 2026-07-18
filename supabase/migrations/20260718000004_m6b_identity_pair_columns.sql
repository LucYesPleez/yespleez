-- ============================================================
-- M6b — IDENTITY PAIR COLUMNS  (SCHEMA — additive only)
-- ============================================================
--
-- Run ALONE, after M6a. Adds columns; writes no data and changes no
-- policy. The U4 backfill is M6c; the R3.2 binding is M6d.
--
-- Identity v1.1 §A3 (the identity pair), §A6 (follows split),
-- §A7 (notification identities), §A10 (M6 scope).
--
-- ── WHY ONLY from_profile_id, NOT THE FULL PAIR ──
--
-- §A3's pair is (from_profile_id, from_user_id). On these tables the
-- user half already exists: applications.artist_id and
-- follows.user_id. §A10 accordingly says M6 "adds from_profile_id to
-- applications and follows" — singular. Adding a from_user_id beside
-- artist_id would be two columns doing one job, which is the exact
-- fault v1.0 §03 outlaws ("one column never again does both jobs").
--
-- venue_enquiries (venue_profile_id, applicant_profile_id) and
-- lineup_members (artist_profile_id) already carry theirs — §A3's
-- "already". Untouched here.
--
-- ── COLUMNS STAY NULLABLE, AND THAT IS DELIBERATE ──
--
-- U4 (decided 18 Jul 2026) leaves historical rows NULL wherever the
-- sender is ambiguous, so NOT NULL can never apply to these columns.
-- Presence is enforced for NEW rows instead, by R3.2 in M6d:
-- `WITH CHECK (can_act_as(from_profile_id))` is false when the value
-- is NULL, so an insert without a sender profile is rejected by the
-- policy. Historical NULLs remain readable and untouched, which is
-- what M7's pre-cutover exemption exists for.
--
-- Enforcement therefore lives in one place (the policy) rather than
-- being split between a constraint and a policy that must agree.
--
-- ── DECISION 1 · FK ON DELETE BEHAVIOUR ──  ⚠ CONFIRM
--
-- NO ACTION (the default) is used: a profile cannot be deleted while
-- rows still attribute themselves to it.
--
-- The alternative, ON DELETE SET NULL, would let the profile go and
-- silently erase who applied or who followed — destroying attribution
-- to make a delete convenient. Attribution is the entire point of
-- this milestone, so the default is to refuse the delete and make the
-- caller deal with it explicitly.
--
-- Cost: deleting a profile with applications or follows now fails
-- with a FK error until those rows are handled. If that breaks a real
-- flow, say so — it is a deliberate trade, not an oversight.
--
-- ── DECISION 2 · notifications.user_id IS NOT RENAMED ──  ⚠ CONFIRM
--
-- §A7 names three identities: about_profile_id (subject),
-- to_profile_id (recipient/scoping), to_user_id (delivery).
--
-- `notifications.user_id` already IS the delivery identity. This
-- migration adds the two profile columns and leaves user_id named as
-- it is, because renaming it would break every read site in v2/src
-- during a migration whose job is schema, not app churn. The
-- concept matches §A7; only the column name differs.
--
-- If the name should match the specification exactly, the rename
-- belongs at M8 contract alongside the other consolidation — not
-- here, mid-migration, with no app changes in the same commit.
--
-- Not addressed here, flagged when the policy dump was read:
-- notifications also carries both `from_id` and `from_uid`, which
-- look like two columns for one sender. That predates M6 and needs
-- its own investigation rather than a guess inside this file.
-- ============================================================


-- ── applications · sender profile ──────────────────────────
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS from_profile_id uuid REFERENCES public.profiles(id);

COMMENT ON COLUMN public.applications.from_profile_id IS
  'Identity v1.1 §A3 — which profile submitted this application. NULL on pre-M6 rows where the sender is unrecoverable (U4). Enforced for new rows by R3.2 in M6d, not by NOT NULL.';


-- ── follows · sender profile (split, not moved — §A6) ──────
-- user_id STAYS. It carries dedup, delivery and the §05 C2/C3
-- privacy guarantees. from_profile_id is added beside it and answers
-- a different question: which profile's roster this follow belongs
-- to. Moving the user column instead of splitting would break
-- notification dedup, which is why §A6 says split.
ALTER TABLE public.follows
  ADD COLUMN IF NOT EXISTS from_profile_id uuid REFERENCES public.profiles(id);

COMMENT ON COLUMN public.follows.from_profile_id IS
  'Identity v1.1 §A6 — which profile is doing the following. Added beside user_id, never replacing it (dedup/delivery/§05 C2-C3 depend on user_id). Fixes venue rosters polluted by their owner''s personal follows.';


-- ── notifications · subject and recipient (§A7) ────────────
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS about_profile_id uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS to_profile_id    uuid REFERENCES public.profiles(id);

COMMENT ON COLUMN public.notifications.about_profile_id IS
  'Identity v1.1 §A7 — the subject: which profile this notification is about. May reference an unclaimed profile.';
COMMENT ON COLUMN public.notifications.to_profile_id IS
  'Identity v1.1 §A7 — the recipient: which profile this notification is scoped to. Distinct from user_id, which remains the delivery identity (§A7 to_user_id).';
COMMENT ON COLUMN public.notifications.user_id IS
  'Identity v1.1 §A7 — the delivery identity (to_user_id in the specification; not renamed at M6 to avoid breaking every read site mid-migration). Feed scopes by to_profile_id; badge aggregates by user_id — deliberate, per §A7.';


-- ── indexes ────────────────────────────────────────────────
-- from_profile_id on follows is a roster lookup ("who does this
-- venue follow") and will be queried per profile page render.
-- The others back the R3.2 policy predicates added in M6d.
CREATE INDEX IF NOT EXISTS idx_follows_from_profile        ON public.follows(from_profile_id);
CREATE INDEX IF NOT EXISTS idx_applications_from_profile   ON public.applications(from_profile_id);
CREATE INDEX IF NOT EXISTS idx_notifications_to_profile    ON public.notifications(to_profile_id);
CREATE INDEX IF NOT EXISTS idx_notifications_about_profile ON public.notifications(about_profile_id);


-- ============================================================
-- VERIFY — expect 5 rows, all is_nullable = YES
-- ============================================================
--   SELECT table_name, column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND column_name IN ('from_profile_id','about_profile_id','to_profile_id')
--   ORDER BY table_name, column_name;
--
-- And the FKs point at profiles(id):
--   SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE contype = 'f'
--     AND conrelid::regclass::text IN ('applications','follows','notifications')
--   ORDER BY 1, 2;
--
-- Nothing is populated yet — every new column is NULL on every
-- existing row. That is M6c.
-- ============================================================
