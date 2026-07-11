-- ============================================================
-- M4 VERIFICATION MATRIX SUITE — run once PRE and once POST
-- ============================================================
-- Implements docs/m4-design-review-2026-07.md §4. Run in the
-- Supabase SQL editor as one request (single implicit
-- transaction: an error anywhere rolls back everything).
--
-- Phase: replace __PHASE__ with PRE or POST before running.
--
-- How it works:
--  * pg_temp helpers simulate a session: set JWT-claim GUCs
--    (auth.uid() reads request.jwt.claim.sub — verified live) and
--    SET LOCAL ROLE authenticated/anon, run the probe, RESET ROLE.
--  * Write probes run inside a plpgsql subtransaction that is
--    force-rolled-back after capturing the row count — no write
--    test ever persists.
--  * Synthetic state-1/3/4 rows (design review §1.4) are created
--    as postgres at the start and deleted at the end; they use
--    real account uuids on legacy columns (FK-safe) and 2090/2091
--    dates so organic-row assertions can exclude them.
--  * Every expectation that depends on data volume is computed
--    live as a policy-replica count under postgres, so the suite
--    is deterministic against whatever the data is on run day.
--
-- Fixtures (discovered live 2026-07-11):
--   M  = 94a88288-43aa-445b-abb8-7dc895804b51  multi-type: artist/band/host/punter/venue
--        M_venue 424c551e-5b60-4873-8447-1d4686c0ad61 (Elbows Rest)
--        M_band  acb77a8a-c5db-446d-8ade-15f8031b4ce9 (Dusky Waters)
--   V  = daa848f2-bb48-4f14-8305-d9c61a824ace  venue-owning (Bellingen)
--        V_venue 4e77c0ae-9e05-4c79-853b-3edae1aab865
--   A  = 00026807-800b-464d-b8d2-effe9b058d22  artist (Pokki), A_prof af7dfe1e-30e1-427d-8aa2-8c21073e96b0
--   A2 = 7bb5c493-bd49-4beb-88ad-342d66253c81  artist (Elbow) — applications fixtures
--   DL = 01363de0-cff5-41ee-af29-7f9e17f4e729  artist (Daddy Longlegs) — lineup fixture
--   P  = 24f74757-8016-4885-9879-a6cb54f49a93  punter-only (Miller)
--   P2 = fe1cf0c6-6c8c-4e1f-8114-fb2a371a88cd  punter (Jamie Barber)
--   U  = 86c431ff-dd25-4851-b94b-73e91e7dd0ae  promoted-unclaimed profile (Test DJ)
--   EV1 = 55512cb8-72e8-446c-9fff-f195d7e002c3 (event with 3 applications)
--   LU1 = 7c2d7b49-e26a-4f19-9609-5b1acb1c5a95 (lineup row, artist DL, event 257038af-…)
--   APP_A2 = f4f5a4f1-f396-4066-adee-c36c56cc9568 (A2's application)
--   APP_MADDS = 370d4107-1c96-4b06-beb7-f938ffc66c0d (another artist's application)
-- Role coverage: Host/Band/Punter legs run under M's respective
-- profiles; no standup-typed profile exists in production (fact,
-- 2026-07-11) — standup cells are structurally identical to band
-- (no per-type policy anywhere in the cutover set) and are
-- represented by the band cells + the standup_availability anon
-- probe. Documented, not fabricated.
-- ============================================================

CREATE TEMP TABLE _phase(v text) ON COMMIT DROP;
INSERT INTO _phase VALUES ('__PHASE__');

CREATE TEMP TABLE _res(
  seq serial, test_id text, actor text, op text,
  description text, exp_pre text, exp_post text, actual text
) ON COMMIT DROP;

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION pg_temp.m4_as(p_uid text, p_role text) RETURNS void
LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN '{"role":"anon"}'
         ELSE '{"sub":"' || p_uid || '","role":"' || p_role || '"}' END, true);
  EXECUTE 'SET LOCAL ROLE ' || quote_ident(p_role);
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.m4_count(p_uid text, p_role text, p_q text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE v text;
BEGIN
  BEGIN
    PERFORM pg_temp.m4_as(p_uid, p_role);
    EXECUTE 'SELECT count(*)::text FROM (' || p_q || ') _t' INTO v;
  EXCEPTION WHEN OTHERS THEN v := 'err:' || SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  RETURN v;
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.m4_write(p_uid text, p_role text, p_q text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE v text; n bigint;
BEGIN
  BEGIN
    PERFORM pg_temp.m4_as(p_uid, p_role);
    EXECUTE p_q;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING errcode = 'P0399', message = 'rows:' || n;  -- rollback probe write
  EXCEPTION
    WHEN sqlstate 'P0399' THEN v := SQLERRM;
    WHEN insufficient_privilege THEN v := 'denied:42501';
    WHEN OTHERS THEN v := 'err:' || SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  RETURN v;
END $f$;

-- ---------- dynamic expectations (policy replicas, as postgres) ----------
CREATE TEMP TABLE _fx(k text primary key, v text) ON COMMIT DROP;
INSERT INTO _fx VALUES
 ('va_organic', (SELECT count(*)::text FROM venue_availability WHERE available_date < DATE '2090-01-01')),
 ('ve_organic', (SELECT count(*)::text FROM venue_enquiries   WHERE date_requested < DATE '2090-01-01')),
 ('m_follows',  (SELECT count(*)::text FROM follows WHERE user_id = '94a88288-43aa-445b-abb8-7dc895804b51')),
 ('profiles_all', (SELECT count(*)::text FROM profiles)),
 ('events_all',   (SELECT count(*)::text FROM events)),
 ('lineup_all',   (SELECT count(*)::text FROM lineup_members)),
 ('aa_all',       (SELECT count(*)::text FROM artist_availability)),
 ('a_aa',         (SELECT 'rows:' || count(*)::text FROM artist_availability WHERE user_id = '00026807-800b-464d-b8d2-effe9b058d22')),
 ('ba_m',         (SELECT count(*)::text FROM band_availability WHERE user_id = '94a88288-43aa-445b-abb8-7dc895804b51')),
 ('pp_eligible',  (SELECT count(*)::text FROM placeholder_profiles WHERE claim_status IN ('unclaimed','pending') AND is_duplicate = false AND blocklisted = false AND removed_at IS NULL)),
 ('a2_apps',      (SELECT count(*)::text FROM applications WHERE artist_id = '7bb5c493-bd49-4beb-88ad-342d66253c81')),
 ('m_apps_vis',   (SELECT count(*)::text FROM applications a WHERE a.artist_id = '94a88288-43aa-445b-abb8-7dc895804b51' OR EXISTS (SELECT 1 FROM events e WHERE e.id = a.event_id AND e.host_id = '94a88288-43aa-445b-abb8-7dc895804b51'))),
 ('ev1_apps_m',   (SELECT count(*)::text FROM applications a WHERE a.event_id = '55512cb8-72e8-446c-9fff-f195d7e002c3' AND (a.artist_id = '94a88288-43aa-445b-abb8-7dc895804b51' OR EXISTS (SELECT 1 FROM events e WHERE e.id = a.event_id AND e.host_id = '94a88288-43aa-445b-abb8-7dc895804b51')))),
 ('lu1_m_upd',    (SELECT CASE WHEN EXISTS (SELECT 1 FROM lineup_members lm JOIN events e ON e.id = lm.event_id WHERE lm.id = '7c2d7b49-e26a-4f19-9609-5b1acb1c5a95' AND e.host_id = '94a88288-43aa-445b-abb8-7dc895804b51') THEN 'rows:1' ELSE 'rows:0' END));

-- ---------- synthetic rows (deleted at end of suite) ----------
-- S1 state-3: legacy owner Miller, profile Bellingen
INSERT INTO venue_availability(user_id, available_date, profile_id)
VALUES ('24f74757-8016-4885-9879-a6cb54f49a93', DATE '2091-01-01', '4e77c0ae-9e05-4c79-853b-3edae1aab865');
-- S2 state-1: legacy owner V, no profile id
INSERT INTO venue_availability(user_id, available_date, profile_id)
VALUES ('daa848f2-bb48-4f14-8305-d9c61a824ace', DATE '2091-01-02', NULL);
-- S3 state-3: legacy sides Miller/Jamie, venue profile Bellingen
INSERT INTO venue_enquiries(venue_user_id, applicant_user_id, applicant_type, date_requested, status, venue_profile_id, applicant_profile_id)
VALUES ('24f74757-8016-4885-9879-a6cb54f49a93', 'fe1cf0c6-6c8c-4e1f-8114-fb2a371a88cd', 'artist', DATE '2091-01-03', 'pending', '4e77c0ae-9e05-4c79-853b-3edae1aab865', NULL);
-- S4 state-4: venue profile = promoted-unclaimed U
INSERT INTO venue_enquiries(venue_user_id, applicant_user_id, applicant_type, date_requested, status, venue_profile_id, applicant_profile_id)
VALUES ('24f74757-8016-4885-9879-a6cb54f49a93', 'fe1cf0c6-6c8c-4e1f-8114-fb2a371a88cd', 'artist', DATE '2091-01-04', 'pending', '86c431ff-dd25-4851-b94b-73e91e7dd0ae', NULL);

-- ============================================================
-- SECTION Z — policy-set sanity
-- ============================================================
INSERT INTO _res(test_id, actor, op, description, exp_pre, exp_post, actual)
SELECT 'Z1', 'postgres', 'meta', 'policy count on cutover tables', '4', '8',
  (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('venue_availability','venue_enquiries'));

-- ============================================================
-- SECTION A — venue_availability
-- ============================================================
INSERT INTO _res(test_id, actor, op, description, exp_pre, exp_post, actual) VALUES
 ('A1','M','SELECT','own organic availability', (SELECT v FROM _fx WHERE k='va_organic'), (SELECT v FROM _fx WHERE k='va_organic'),
   pg_temp.m4_count('94a88288-43aa-445b-abb8-7dc895804b51','authenticated', $q$SELECT 1 FROM venue_availability WHERE available_date < DATE '2090-01-01'$q$)),
 ('A2','A','SELECT','someone else''s availability', '0','0',
   pg_temp.m4_count('00026807-800b-464d-b8d2-effe9b058d22','authenticated', $q$SELECT 1 FROM venue_availability WHERE available_date < DATE '2090-01-01'$q$)),
 ('A3','anon','SELECT','availability, anonymous', '0','0',
   pg_temp.m4_count(NULL,'anon', $q$SELECT 1 FROM venue_availability WHERE available_date < DATE '2090-01-01'$q$)),
 ('A4','P','SELECT','availability, punter', '0','0',
   pg_temp.m4_count('24f74757-8016-4885-9879-a6cb54f49a93','authenticated', $q$SELECT 1 FROM venue_availability WHERE available_date < DATE '2090-01-01'$q$)),
 ('A5','M','INSERT','self-keyed dual-written row', 'rows:1','rows:1',
   pg_temp.m4_write('94a88288-43aa-445b-abb8-7dc895804b51','authenticated', $q$INSERT INTO venue_availability(user_id, available_date, profile_id) VALUES ('94a88288-43aa-445b-abb8-7dc895804b51', DATE '2090-12-01', '424c551e-5b60-4873-8447-1d4686c0ad61')$q$)),
 ('A6','M','INSERT','new-leg-only (user_id NULL) — M6-style write', 'denied:42501','rows:1',
   pg_temp.m4_write('94a88288-43aa-445b-abb8-7dc895804b51','authenticated', $q$INSERT INTO venue_availability(user_id, available_date, profile_id) VALUES (NULL, DATE '2090-12-02', '424c551e-5b60-4873-8447-1d4686c0ad61')$q$)),
 ('A7','M','INSERT','guard: legacy names Miller, profile is M''s', 'denied:42501','denied:42501',
   pg_temp.m4_write('94a88288-43aa-445b-abb8-7dc895804b51','authenticated', $q$INSERT INTO venue_availability(user_id, available_date, profile_id) VALUES ('24f74757-8016-4885-9879-a6cb54f49a93', DATE '2090-12-03', '424c551e-5b60-4873-8447-1d4686c0ad61')$q$)),
 ('A8','A','INSERT','legacy latitude: own user_id, M''s profile_id', 'rows:1','rows:1',
   pg_temp.m4_write('00026807-800b-464d-b8d2-effe9b058d22','authenticated', $q$INSERT INTO venue_availability(user_id, available_date, profile_id) VALUES ('00026807-800b-464d-b8d2-effe9b058d22', DATE '2090-12-04', '424c551e-5b60-4873-8447-1d4686c0ad61')$q$)),
 ('A9','V','SELECT','state-3 row via profile leg', '0','1',
   pg_temp.m4_count('daa848f2-bb48-4f14-8305-d9c61a824ace','authenticated', $q$SELECT 1 FROM venue_availability WHERE available_date = DATE '2091-01-01'$q$)),
 ('A10','P','SELECT','state-3 row via legacy leg (Miller)', '1','1',
   pg_temp.m4_count('24f74757-8016-4885-9879-a6cb54f49a93','authenticated', $q$SELECT 1 FROM venue_availability WHERE available_date = DATE '2091-01-01'$q$)),
 ('A11','V','UPDATE','state-3 in-place update w/o repairing user_id (guard blocks)', 'rows:0','denied:42501',
   pg_temp.m4_write('daa848f2-bb48-4f14-8305-d9c61a824ace','authenticated', $q$UPDATE venue_availability SET available_date = available_date WHERE available_date = DATE '2091-01-01'$q$)),
 ('A11b','V','UPDATE','state-3 update repairing user_id to NULL', 'rows:0','rows:1',
   pg_temp.m4_write('daa848f2-bb48-4f14-8305-d9c61a824ace','authenticated', $q$UPDATE venue_availability SET user_id = NULL WHERE available_date = DATE '2091-01-01'$q$)),
 ('A12','V','DELETE','state-3 delete via profile leg', 'rows:0','rows:1',
   pg_temp.m4_write('daa848f2-bb48-4f14-8305-d9c61a824ace','authenticated', $q$DELETE FROM venue_availability WHERE available_date = DATE '2091-01-01'$q$)),
 ('A13','anon','INSERT','anonymous insert', 'denied:42501','denied:42501',
   pg_temp.m4_write(NULL,'anon', $q$INSERT INTO venue_availability(user_id, available_date, profile_id) VALUES (NULL, DATE '2090-12-05', NULL)$q$)),
 ('A14a','V','SELECT','state-1 row (own legacy, no profile id)', '1','1',
   pg_temp.m4_count('daa848f2-bb48-4f14-8305-d9c61a824ace','authenticated', $q$SELECT 1 FROM venue_availability WHERE available_date = DATE '2091-01-02'$q$)),
 ('A14b','M','SELECT','state-1 row, non-owner', '0','0',
   pg_temp.m4_count('94a88288-43aa-445b-abb8-7dc895804b51','authenticated', $q$SELECT 1 FROM venue_availability WHERE available_date = DATE '2091-01-02'$q$));

-- ============================================================
-- SECTION B — venue_enquiries
-- ============================================================
INSERT INTO _res(test_id, actor, op, description, exp_pre, exp_post, actual) VALUES
 ('B1','M','SELECT','own organic enquiries (both sides M)', (SELECT v FROM _fx WHERE k='ve_organic'), (SELECT v FROM _fx WHERE k='ve_organic'),
   pg_temp.m4_count('94a88288-43aa-445b-abb8-7dc895804b51','authenticated', $q$SELECT 1 FROM venue_enquiries WHERE date_requested < DATE '2090-01-01'$q$)),
 ('B2a','V','SELECT','organic enquiries, uninvolved venue', '0','0',
   pg_temp.m4_count('daa848f2-bb48-4f14-8305-d9c61a824ace','authenticated', $q$SELECT 1 FROM venue_enquiries WHERE date_requested < DATE '2090-01-01'$q$)),
 ('B2b','anon','SELECT','enquiries, anonymous', '0','0',
   pg_temp.m4_count(NULL,'anon', $q$SELECT 1 FROM venue_enquiries$q$)),
 ('B3','M','UPDATE','venue-side status update, own enquiry', 'rows:1','rows:1',
   pg_temp.m4_write('94a88288-43aa-445b-abb8-7dc895804b51','authenticated', $q$UPDATE venue_enquiries SET status = status WHERE id = 1$q$)),
 ('B4','A','UPDATE','status update by uninvolved artist', 'rows:0','rows:0',
   pg_temp.m4_write('00026807-800b-464d-b8d2-effe9b058d22','authenticated', $q$UPDATE venue_enquiries SET status = status WHERE id = 1$q$)),
 ('B5','A','INSERT','artist self-enquiry to V, fully dual-written', 'rows:1','rows:1',
   pg_temp.m4_write('00026807-800b-464d-b8d2-effe9b058d22','authenticated', $q$INSERT INTO venue_enquiries(venue_user_id, applicant_user_id, applicant_type, date_requested, status, venue_profile_id, applicant_profile_id) VALUES ('daa848f2-bb48-4f14-8305-d9c61a824ace', '00026807-800b-464d-b8d2-effe9b058d22', 'artist', DATE '2090-11-01', 'pending', '4e77c0ae-9e05-4c79-853b-3edae1aab865', 'af7dfe1e-30e1-427d-8aa2-8c21073e96b0')$q$)),
 ('B6','A','INSERT','guard: forged applicant_user_id (Miller) + own profile', 'denied:42501','denied:42501',
   pg_temp.m4_write('00026807-800b-464d-b8d2-effe9b058d22','authenticated', $q$INSERT INTO venue_enquiries(venue_user_id, applicant_user_id, applicant_type, date_requested, status, venue_profile_id, applicant_profile_id) VALUES ('daa848f2-bb48-4f14-8305-d9c61a824ace', '24f74757-8016-4885-9879-a6cb54f49a93', 'artist', DATE '2090-11-02', 'pending', '4e77c0ae-9e05-4c79-853b-3edae1aab865', 'af7dfe1e-30e1-427d-8aa2-8c21073e96b0')$q$)),
 ('B7','A','INSERT','legacy latitude: own user_id, M''s band profile as applicant_profile_id', 'rows:1','rows:1',
   pg_temp.m4_write('00026807-800b-464d-b8d2-effe9b058d22','authenticated', $q$INSERT INTO venue_enquiries(venue_user_id, applicant_user_id, applicant_type, date_requested, status, venue_profile_id, applicant_profile_id) VALUES ('daa848f2-bb48-4f14-8305-d9c61a824ace', '00026807-800b-464d-b8d2-effe9b058d22', 'artist', DATE '2090-11-03', 'pending', '4e77c0ae-9e05-4c79-853b-3edae1aab865', 'acb77a8a-c5db-446d-8ade-15f8031b4ce9')$q$)),
 ('B8','V','INSERT','venue-initiated invite (InviteSheet shape) stays blocked', 'denied:42501','denied:42501',
   pg_temp.m4_write('daa848f2-bb48-4f14-8305-d9c61a824ace','authenticated', $q$INSERT INTO venue_enquiries(venue_user_id, applicant_user_id, applicant_type, date_requested, status, venue_profile_id, applicant_profile_id) VALUES ('daa848f2-bb48-4f14-8305-d9c61a824ace', '00026807-800b-464d-b8d2-effe9b058d22', 'artist', DATE '2090-11-04', 'pending', '4e77c0ae-9e05-4c79-853b-3edae1aab865', 'af7dfe1e-30e1-427d-8aa2-8c21073e96b0')$q$)),
 ('B9a','V','SELECT','state-3 enquiry via profile leg', '0','1',
   pg_temp.m4_count('daa848f2-bb48-4f14-8305-d9c61a824ace','authenticated', $q$SELECT 1 FROM venue_enquiries WHERE date_requested = DATE '2091-01-03'$q$)),
 ('B9b','V','UPDATE','state-3 status update via profile leg (no guard on UPDATE)', 'rows:0','rows:1',
   pg_temp.m4_write('daa848f2-bb48-4f14-8305-d9c61a824ace','authenticated', $q$UPDATE venue_enquiries SET status = status WHERE date_requested = DATE '2091-01-03'$q$)),
 ('B9c','P','SELECT','state-3 enquiry via legacy venue side (Miller)', '1','1',
   pg_temp.m4_count('24f74757-8016-4885-9879-a6cb54f49a93','authenticated', $q$SELECT 1 FROM venue_enquiries WHERE date_requested = DATE '2091-01-03'$q$)),
 ('B9d','P2','SELECT','state-3 enquiry via legacy applicant side (Jamie)', '1','1',
   pg_temp.m4_count('fe1cf0c6-6c8c-4e1f-8114-fb2a371a88cd','authenticated', $q$SELECT 1 FROM venue_enquiries WHERE date_requested = DATE '2091-01-03'$q$)),
 ('B10a','V','SELECT','state-4 (unclaimed profile) grants V nothing', '0','0',
   pg_temp.m4_count('daa848f2-bb48-4f14-8305-d9c61a824ace','authenticated', $q$SELECT 1 FROM venue_enquiries WHERE date_requested = DATE '2091-01-04'$q$)),
 ('B10b','M','SELECT','state-4 grants M nothing', '0','0',
   pg_temp.m4_count('94a88288-43aa-445b-abb8-7dc895804b51','authenticated', $q$SELECT 1 FROM venue_enquiries WHERE date_requested = DATE '2091-01-04'$q$)),
 ('B10c','P','SELECT','state-4 via legacy leg only (Miller)', '1','1',
   pg_temp.m4_count('24f74757-8016-4885-9879-a6cb54f49a93','authenticated', $q$SELECT 1 FROM venue_enquiries WHERE date_requested = DATE '2091-01-04'$q$)),
 ('B11','anon','INSERT','anonymous insert', 'denied:42501','denied:42501',
   pg_temp.m4_write(NULL,'anon', $q$INSERT INTO venue_enquiries(venue_user_id, applicant_user_id, applicant_type, date_requested, status) VALUES ('daa848f2-bb48-4f14-8305-d9c61a824ace', '00026807-800b-464d-b8d2-effe9b058d22', 'artist', DATE '2090-11-05', 'pending')$q$)),
 ('B12a','M','DELETE','no DELETE policy on either system (organic row)', 'rows:0','rows:0',
   pg_temp.m4_write('94a88288-43aa-445b-abb8-7dc895804b51','authenticated', $q$DELETE FROM venue_enquiries WHERE id = 1$q$)),
 ('B12b','V','DELETE','no DELETE policy on either system (state-3 row)', 'rows:0','rows:0',
   pg_temp.m4_write('daa848f2-bb48-4f14-8305-d9c61a824ace','authenticated', $q$DELETE FROM venue_enquiries WHERE date_requested = DATE '2091-01-03'$q$));

-- ============================================================
-- SECTION C — follows: the C2 guarantee (no follower enumeration)
-- ============================================================
INSERT INTO _res(test_id, actor, op, description, exp_pre, exp_post, actual) VALUES
 ('C1','M','SELECT','own follows, complete', (SELECT v FROM _fx WHERE k='m_follows'), (SELECT v FROM _fx WHERE k='m_follows'),
   pg_temp.m4_count('94a88288-43aa-445b-abb8-7dc895804b51','authenticated', $q$SELECT 1 FROM follows WHERE user_id = '94a88288-43aa-445b-abb8-7dc895804b51'$q$)),
 ('C2a','V','SELECT','"who follows me?" by entity_id — must be zero', '0','0',
   pg_temp.m4_count('daa848f2-bb48-4f14-8305-d9c61a824ace','authenticated', $q$SELECT 1 FROM follows WHERE entity_id = 'daa848f2-bb48-4f14-8305-d9c61a824ace'$q$)),
 ('C2b','V','SELECT','"who follows me?" by target_profile_id — must be zero', '0','0',
   pg_temp.m4_count('daa848f2-bb48-4f14-8305-d9c61a824ace','authenticated', $q$SELECT 1 FROM follows WHERE target_profile_id = '4e77c0ae-9e05-4c79-853b-3edae1aab865'$q$)),
 ('C3','A','SELECT','another user''s follow rows', '0','0',
   pg_temp.m4_count('00026807-800b-464d-b8d2-effe9b058d22','authenticated', $q$SELECT 1 FROM follows WHERE user_id = '94a88288-43aa-445b-abb8-7dc895804b51'$q$)),
 ('C4','anon','SELECT','follows, anonymous', '0','0',
   pg_temp.m4_count(NULL,'anon', $q$SELECT 1 FROM follows$q$)),
 ('C5','A','INSERT','forged follower (user_id = M)', 'denied:42501','denied:42501',
   pg_temp.m4_write('00026807-800b-464d-b8d2-effe9b058d22','authenticated', $q$INSERT INTO follows(user_id, entity_id, entity_type, entity_name) VALUES ('94a88288-43aa-445b-abb8-7dc895804b51', 'fe1cf0c6-6c8c-4e1f-8114-fb2a371a88cd', 'artist', 'probe')$q$)),
 ('C6','A','DELETE','another user''s follow', 'rows:0','rows:0',
   pg_temp.m4_write('00026807-800b-464d-b8d2-effe9b058d22','authenticated', $q$DELETE FROM follows WHERE user_id = '94a88288-43aa-445b-abb8-7dc895804b51'$q$));

-- ============================================================
-- SECTION D — regression spot-checks (tables untouched by M4)
-- ============================================================
INSERT INTO _res(test_id, actor, op, description, exp_pre, exp_post, actual) VALUES
 ('D1','anon','SELECT','profiles public read (incl. unclaimed U)', (SELECT v FROM _fx WHERE k='profiles_all'), (SELECT v FROM _fx WHERE k='profiles_all'),
   pg_temp.m4_count(NULL,'anon', $q$SELECT 1 FROM profiles$q$)),
 ('D2a','A','UPDATE','unclaimed profile U not writable', 'rows:0','rows:0',
   pg_temp.m4_write('00026807-800b-464d-b8d2-effe9b058d22','authenticated', $q$UPDATE profiles SET name = name WHERE id = '86c431ff-dd25-4851-b94b-73e91e7dd0ae'$q$)),
 ('D2b','M','UPDATE','unclaimed profile U not writable (multi-type owner)', 'rows:0','rows:0',
   pg_temp.m4_write('94a88288-43aa-445b-abb8-7dc895804b51','authenticated', $q$UPDATE profiles SET name = name WHERE id = '86c431ff-dd25-4851-b94b-73e91e7dd0ae'$q$)),
 ('D3a','A','SELECT','own profile visible', '1','1',
   pg_temp.m4_count('00026807-800b-464d-b8d2-effe9b058d22','authenticated', $q$SELECT 1 FROM profiles WHERE id = 'af7dfe1e-30e1-427d-8aa2-8c21073e96b0'$q$)),
 ('D3b','A','UPDATE','own profile writable', 'rows:1','rows:1',
   pg_temp.m4_write('00026807-800b-464d-b8d2-effe9b058d22','authenticated', $q$UPDATE profiles SET name = name WHERE id = 'af7dfe1e-30e1-427d-8aa2-8c21073e96b0'$q$)),
 ('D4','P','SELECT','applications invisible to punter', '0','0',
   pg_temp.m4_count('24f74757-8016-4885-9879-a6cb54f49a93','authenticated', $q$SELECT 1 FROM applications$q$)),
 ('D5','A2','SELECT','artist sees own applications', (SELECT v FROM _fx WHERE k='a2_apps'), (SELECT v FROM _fx WHERE k='a2_apps'),
   pg_temp.m4_count('7bb5c493-bd49-4beb-88ad-342d66253c81','authenticated', $q$SELECT 1 FROM applications WHERE artist_id = '7bb5c493-bd49-4beb-88ad-342d66253c81'$q$)),
 ('D6','M','SELECT','host sees applications for own event', (SELECT v FROM _fx WHERE k='ev1_apps_m'), (SELECT v FROM _fx WHERE k='ev1_apps_m'),
   pg_temp.m4_count('94a88288-43aa-445b-abb8-7dc895804b51','authenticated', $q$SELECT 1 FROM applications WHERE event_id = '55512cb8-72e8-446c-9fff-f195d7e002c3'$q$)),
 ('D7a','A2','UPDATE','artist updates own application (interim policy)', 'rows:1','rows:1',
   pg_temp.m4_write('7bb5c493-bd49-4beb-88ad-342d66253c81','authenticated', $q$UPDATE applications SET status = status WHERE id = 'f4f5a4f1-f396-4066-adee-c36c56cc9568'$q$)),
 ('D7b','A2','UPDATE','artist cannot update another artist''s application', 'rows:0','rows:0',
   pg_temp.m4_write('7bb5c493-bd49-4beb-88ad-342d66253c81','authenticated', $q$UPDATE applications SET status = status WHERE id = '370d4107-1c96-4b06-beb7-f938ffc66c0d'$q$)),
 ('D8a','anon','SELECT','events public read', (SELECT v FROM _fx WHERE k='events_all'), (SELECT v FROM _fx WHERE k='events_all'),
   pg_temp.m4_count(NULL,'anon', $q$SELECT 1 FROM events$q$)),
 ('D8b','A','UPDATE','non-host cannot update event', 'rows:0','rows:0',
   pg_temp.m4_write('00026807-800b-464d-b8d2-effe9b058d22','authenticated', $q$UPDATE events SET name = name WHERE id = '55512cb8-72e8-446c-9fff-f195d7e002c3'$q$)),
 ('D9a','anon','SELECT','lineup_members public read', (SELECT v FROM _fx WHERE k='lineup_all'), (SELECT v FROM _fx WHERE k='lineup_all'),
   pg_temp.m4_count(NULL,'anon', $q$SELECT 1 FROM lineup_members$q$)),
 ('D9b','DL','UPDATE','artist cannot update own lineup row (host-only)', 'rows:0','rows:0',
   pg_temp.m4_write('01363de0-cff5-41ee-af29-7f9e17f4e729','authenticated', $q$UPDATE lineup_members SET artist_name = artist_name WHERE id = '7c2d7b49-e26a-4f19-9609-5b1acb1c5a95'$q$)),
 ('D9c','M','UPDATE','host updates lineup row on own event', (SELECT v FROM _fx WHERE k='lu1_m_upd'), (SELECT v FROM _fx WHERE k='lu1_m_upd'),
   pg_temp.m4_write('94a88288-43aa-445b-abb8-7dc895804b51','authenticated', $q$UPDATE lineup_members SET artist_name = artist_name WHERE id = '7c2d7b49-e26a-4f19-9609-5b1acb1c5a95'$q$)),
 ('D10a','anon','SELECT','artist_availability public read', (SELECT v FROM _fx WHERE k='aa_all'), (SELECT v FROM _fx WHERE k='aa_all'),
   pg_temp.m4_count(NULL,'anon', $q$SELECT 1 FROM artist_availability$q$)),
 ('D10b','P','UPDATE','punter cannot touch artist availability', 'rows:0','rows:0',
   pg_temp.m4_write('24f74757-8016-4885-9879-a6cb54f49a93','authenticated', $q$UPDATE artist_availability SET available_date = available_date WHERE user_id = '00026807-800b-464d-b8d2-effe9b058d22'$q$)),
 ('D10c','A','UPDATE','artist manages own artist availability', (SELECT v FROM _fx WHERE k='a_aa'), (SELECT v FROM _fx WHERE k='a_aa'),
   pg_temp.m4_write('00026807-800b-464d-b8d2-effe9b058d22','authenticated', $q$UPDATE artist_availability SET available_date = available_date WHERE user_id = '00026807-800b-464d-b8d2-effe9b058d22'$q$)),
 ('D11a','anon','SELECT','band_availability has no public read', '0','0',
   pg_temp.m4_count(NULL,'anon', $q$SELECT 1 FROM band_availability$q$)),
 ('D11b','M','SELECT','band owner sees own band availability', (SELECT v FROM _fx WHERE k='ba_m'), (SELECT v FROM _fx WHERE k='ba_m'),
   pg_temp.m4_count('94a88288-43aa-445b-abb8-7dc895804b51','authenticated', $q$SELECT 1 FROM band_availability WHERE user_id = '94a88288-43aa-445b-abb8-7dc895804b51'$q$)),
 ('D11c','anon','SELECT','standup_availability has no public read', '0','0',
   pg_temp.m4_count(NULL,'anon', $q$SELECT 1 FROM standup_availability$q$)),
 ('D12a','anon','SELECT','placeholder_profiles eligible-rows public read', (SELECT v FROM _fx WHERE k='pp_eligible'), (SELECT v FROM _fx WHERE k='pp_eligible'),
   pg_temp.m4_count(NULL,'anon', $q$SELECT 1 FROM placeholder_profiles WHERE claim_status IN ('unclaimed','pending') AND is_duplicate = false AND blocklisted = false AND removed_at IS NULL$q$)),
 ('D12b','A','UPDATE','placeholder_profiles not client-writable', 'rows:0','rows:0',
   pg_temp.m4_write('00026807-800b-464d-b8d2-effe9b058d22','authenticated', $q$UPDATE placeholder_profiles SET claim_status = claim_status$q$));

-- ---------- remove synthetics ----------
DELETE FROM venue_availability WHERE available_date IN (DATE '2091-01-01', DATE '2091-01-02');
DELETE FROM venue_enquiries    WHERE date_requested IN (DATE '2091-01-03', DATE '2091-01-04');

-- ---------- results ----------
SELECT r.test_id, r.actor, r.op, r.description,
       r.exp_pre, r.exp_post, r.actual,
       CASE WHEN (SELECT v FROM _phase) = 'PRE'
            THEN (r.actual = r.exp_pre)
            ELSE (r.actual = r.exp_post) END AS pass,
       (SELECT v FROM _phase) AS phase
FROM _res r ORDER BY r.seq;
