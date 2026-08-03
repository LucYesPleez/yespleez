-- ============================================================
-- PA1 — PROFILE ASSETS  (table + RLS + storage bucket + storage RLS)
-- Design: docs/professional-profile-requirements-engine-design-2026-08.md §4
-- ============================================================
--
-- WHAT THIS IS
-- The reusable professional document store. An artist uploads a press kit,
-- stage plot, rider or insurance certificate ONCE against a profile; every
-- future opportunity that asks for one references it instead of demanding
-- another upload. This is the largest gap the 2026-08 audit found.
--
-- ⚠ NOT applied automatically. Review and run manually in the Supabase SQL
-- Editor. Production writes stay a deliberate, human-reviewed action.
--
-- ── FOUR DECISIONS WORTH READING BEFORE YOU CHANGE ANYTHING ──
--
-- 1. NO CHECK CONSTRAINT ON `asset_type`, DELIBERATELY.
--    The obvious move is CHECK (asset_type IN ('PRESS_KIT', ...)). We have
--    already paid for that pattern once: `follows_entity_type_check` did not
--    include 'event', so every event heart failed with 23514 from launch until
--    2026-07-31, and the failure was misattributed to a Supabase outage for
--    weeks. A value list in a constraint means adding a tenth asset type is a
--    migration, and forgetting it produces a 23514 that reads like a client
--    bug. The registry in v2/src/lib/profileAssets.js is the source of truth;
--    an unrecognised key renders as itself rather than breaking (see
--    assetLabel()). Integrity here is not worth re-buying that outage.
--
-- 2. CARDINALITY IS NOT ENFORCED HERE EITHER, for the same reason —
--    knowing that PRESS_KIT is single-file and PROMO_PHOTOS is many-of would
--    require the same brittle list inside a partial unique index. The client
--    supersedes on replace. If a bug ever leaves two current press kits, the
--    requirements engine reads "satisfied" and nothing breaks.
--
-- 3. `user_id` AND `profile_id`, BOTH NOT NULL.
--    `profile_id` is what the asset belongs to. `user_id` is the RLS anchor and
--    is ALSO what makes account-scoped assets a later ADDITION rather than a
--    migration of live compliance data: adding a `scope` column and relaxing
--    `profile_id` to nullable would leave every existing row correct. Design
--    §10 item 1 — free now, expensive later.
--
-- 4. OWNER-ONLY, WITH NO VENUE READ PATH YET.
--    A venue seeing an applicant's documents is P5 (a submitted application
--    grants scoped read to the receiving profile). Until then these files are
--    private to their owner. Supabase grants ALL to anon on new tables unless
--    revoked, and RLS is the only read barrier — so the REVOKE below is not
--    decoration. This is the most sensitive data the platform will hold:
--    insurance certificates, riders, contact-bearing press kits.
--
-- ============================================================

BEGIN;

-- ── 1 · THE TABLE ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profile_assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The owning human. RLS anchor; also the seam for future account scope.
  user_id       uuid NOT NULL REFERENCES auth.users(id)     ON DELETE CASCADE,
  -- The professional identity this document belongs to.
  profile_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- A key from PROFILE_ASSET_TYPES. Text, not an enum — see decision 1.
  asset_type    text NOT NULL,

  -- Object path in the `profile-assets` bucket. UNIQUE so a row can never point
  -- at a file another row also claims. Segment one MUST be the profile id —
  -- the storage policies below read it as the authorization input.
  storage_path  text NOT NULL UNIQUE,
  file_name     text NOT NULL,          -- as uploaded, for display and download
  mime_type     text NOT NULL,
  byte_size     bigint NOT NULL,

  label         text,                   -- optional user note: "2026 rider"

  -- Reserved. Nothing reads this in P2 — expiry predicates are deferred (design
  -- §11). Present so an expiry date can be captured without a later migration.
  valid_until   date,

  is_current    boolean NOT NULL DEFAULT true,
  superseded_by uuid REFERENCES public.profile_assets(id) ON DELETE SET NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profile_assets IS
  'PA1 — reusable professional documents belonging to a profile. asset_type is a key from v2/src/lib/profileAssets.js; deliberately unconstrained (see migration header).';

-- ── 2 · INDEXES ────────────────────────────────────────────
-- The requirements engine asks exactly one question: does this profile have a
-- current asset of this type? Partial index, because superseded versions are
-- retained but never queried by that path.
CREATE INDEX IF NOT EXISTS idx_profile_assets_current
  ON public.profile_assets(profile_id, asset_type)
  WHERE is_current;

CREATE INDEX IF NOT EXISTS idx_profile_assets_user
  ON public.profile_assets(user_id);

-- ── 3 · updated_at ─────────────────────────────────────────
-- Reuses the function M-2026-07-24 already created for profiles.
DROP TRIGGER IF EXISTS trg_profile_assets_updated_at ON public.profile_assets;
CREATE TRIGGER trg_profile_assets_updated_at
  BEFORE UPDATE ON public.profile_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ── 4 · TABLE RLS — owner only ─────────────────────────────
ALTER TABLE public.profile_assets ENABLE ROW LEVEL SECURITY;

-- Not decoration: Supabase auto-grants ALL to anon/authenticated on new tables
-- in the public schema. Without this, RLS is the ONLY barrier and anon holds a
-- grant it should never have had.
REVOKE ALL ON public.profile_assets FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_assets TO authenticated;

-- can_act_as() is the sole ownership predicate (Identity v1.1 §A4 / R3).
-- No inline `auth.uid() = ...` ownership test anywhere in this file.
DROP POLICY IF EXISTS "assets readable by their owner" ON public.profile_assets;
CREATE POLICY "assets readable by their owner"
  ON public.profile_assets FOR SELECT
  TO authenticated
  USING (public.can_act_as(profile_id));

-- user_id is pinned to the caller as well as the profile being owned: it is the
-- RLS anchor for the storage objects and for future account scope, so a row may
-- never be created attributing a file to someone else.
DROP POLICY IF EXISTS "assets writable by their owner" ON public.profile_assets;
CREATE POLICY "assets writable by their owner"
  ON public.profile_assets FOR INSERT
  TO authenticated
  WITH CHECK (public.can_act_as(profile_id) AND user_id = auth.uid());

-- UPDATE exists for supersede (is_current, superseded_by) and for editing the
-- label. WITH CHECK repeats the predicate so a row cannot be moved to another
-- profile by updating profile_id.
DROP POLICY IF EXISTS "assets updatable by their owner" ON public.profile_assets;
CREATE POLICY "assets updatable by their owner"
  ON public.profile_assets FOR UPDATE
  TO authenticated
  USING (public.can_act_as(profile_id))
  WITH CHECK (public.can_act_as(profile_id) AND user_id = auth.uid());

-- DELETE is allowed, unlike the messaging buckets. A message is a record of
-- something said and may not be destroyed; a professional document is the
-- owner's own property and withdrawing it is a legitimate act (design §7.3
-- anticipates exactly this). Versioning via is_current/superseded_by is the
-- normal REPLACE path; deletion is a separate, deliberate one.
DROP POLICY IF EXISTS "assets deletable by their owner" ON public.profile_assets;
CREATE POLICY "assets deletable by their owner"
  ON public.profile_assets FOR DELETE
  TO authenticated
  USING (public.can_act_as(profile_id));

COMMIT;


-- ============================================================
-- 5 · STORAGE — run this part too. Separate statement block because
--     storage.buckets/objects live outside the public schema.
-- ============================================================

-- Private bucket: every read is a signed, expiring URL. Never public.
-- 15 MB — the REL application caps its uploads at 10 MB; this leaves headroom
-- for a multi-page rider without inviting video.
-- PDF and images only. No archives on purpose: a zip cannot be previewed or
-- trusted, and "logo pack" is the exact request that would smuggle one in.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile-assets',
  'profile-assets',
  false,
  15728640,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
-- DO UPDATE, not DO NOTHING: if this bucket was ever created by hand, this
-- migration must CORRECT it rather than silently accept a public bucket.

-- ── The path IS the authorization input ────────────────────
-- Objects are stored at  <profile_id>/<ASSET_TYPE>/<stamp>.<ext>
-- so segment one is the profile whose ownership decides access. This mirrors
-- the messaging buckets, where segment one is the conversation id.
-- v2/src/lib/profileAssets.js assetPath() builds it and its test pins the shape.

DROP POLICY IF EXISTS "profile assets readable by their owner" ON storage.objects;
CREATE POLICY "profile assets readable by their owner"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'profile-assets'
    AND public.can_act_as(public.safe_uuid((storage.foldername(name))[1]))
  );

DROP POLICY IF EXISTS "profile assets writable by their owner" ON storage.objects;
CREATE POLICY "profile assets writable by their owner"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'profile-assets'
    AND public.can_act_as(public.safe_uuid((storage.foldername(name))[1]))
  );

DROP POLICY IF EXISTS "profile assets deletable by their owner" ON storage.objects;
CREATE POLICY "profile assets deletable by their owner"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'profile-assets'
    AND public.can_act_as(public.safe_uuid((storage.foldername(name))[1]))
  );

-- NO UPDATE POLICY, deliberately. Replacing a document uploads a NEW object and
-- supersedes the old row; overwriting bytes in place would mean an application
-- that referenced a certificate could silently be shown a different file.
-- RLS is deny-by-default, so omitting the policy denies it.


-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================
--
-- 1. Table and columns:
--
--      SELECT column_name, data_type, is_nullable
--      FROM information_schema.columns
--      WHERE table_schema='public' AND table_name='profile_assets'
--      ORDER BY ordinal_position;
--
--    Expect 14 columns; user_id and profile_id both NOT NULL.
--
-- 2. RLS is ON and anon holds no grant:
--
--      SELECT relrowsecurity FROM pg_class
--      WHERE oid = 'public.profile_assets'::regclass;          -- expect true
--
--      SELECT grantee, privilege_type FROM information_schema.role_table_grants
--      WHERE table_schema='public' AND table_name='profile_assets'
--      ORDER BY grantee, privilege_type;
--    Expect NO rows for 'anon'.
--
-- 3. Four table policies, all routed through can_act_as:
--
--      SELECT policyname, cmd, qual, with_check FROM pg_policies
--      WHERE schemaname='public' AND tablename='profile_assets' ORDER BY policyname;
--
--    Every qual/with_check must mention can_act_as and NONE may contain a bare
--    `auth.uid() =` ownership test other than the user_id pin.
--
-- 4. The bucket is PRIVATE:
--
--      SELECT id, public, file_size_limit, allowed_mime_types
--      FROM storage.buckets WHERE id='profile-assets';
--
--    Expect public = false. If it is true, stop — every document is world
--    readable by URL.
--
-- 5. Three storage policies, no UPDATE:
--
--      SELECT policyname, cmd FROM pg_policies
--      WHERE schemaname='storage' AND tablename='objects'
--        AND policyname LIKE 'profile assets%' ORDER BY policyname;
--
--    Expect exactly SELECT, INSERT, DELETE.
--
-- 6. The predicate actually resolves for a real profile (run as yourself):
--
--      SELECT id, type, public.can_act_as(id) FROM public.profiles
--      WHERE user_id = auth.uid();
--
--    Expect true for your own profiles. If false, the storage policies will
--    reject every upload and the cause is can_act_as, not this migration.
--
-- ROLLBACK
--
--   DROP POLICY IF EXISTS "profile assets readable by their owner"  ON storage.objects;
--   DROP POLICY IF EXISTS "profile assets writable by their owner"  ON storage.objects;
--   DROP POLICY IF EXISTS "profile assets deletable by their owner" ON storage.objects;
--   DELETE FROM storage.buckets WHERE id='profile-assets';   -- only if empty
--   DROP TABLE IF EXISTS public.profile_assets;
-- ============================================================
