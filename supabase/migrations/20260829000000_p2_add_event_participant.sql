-- P2 · ADD PERSON — participation without an application.
--
-- ⭐⭐ THE ACTION THAT DEFINES THE PEOPLE ROOM. Without it, participation is
-- still secretly dependent on applications: the owner, the staff, the directly
-- invited headliner and the manually added crew never applied to anything, and
-- a roster that cannot hold them is an applications report wearing another
-- name.
--
-- ⛔⛔ A FESTIVAL PARTICIPANT IS A REGISTERED YESPLEEZ USER. RATIFIED BY THE
-- OWNER 2026-08-29. There are NO name-only, unclaimed or placeholder people in
-- participation. If someone is not registered they register first, and only
-- then can they be added.
--
-- ⚠⚠ THE TEMPTING COUNTER-EXAMPLE, AND WHY IT IS NOT ONE: set lists carry
-- hand-entered external DJ names. Those are PLACEHOLDERS FOR LINEUP DISPLAY —
-- they name a slot on a bill, they are not people with a relationship to the
-- event. ⛔ Do not cite them as precedent for anonymous participant records;
-- the owner ruled on exactly this.
--
-- ⭐ WHY AN RPC RATHER THAN CALLING `record_participation` DIRECTLY: that
-- function takes a `user_id`, and the client must never have to hold one. The
-- organiser picks a PROFILE; the account behind it is resolved here, server
-- side. ⛔ A festival must not learn a person's other identities, and handing
-- the client a `user_id` is the first step towards exactly that.

CREATE OR REPLACE FUNCTION public.add_event_participant(
  p_event_id         uuid,
  p_profile_id       uuid,
  p_participant_type text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id      uuid;
  v_profile_type text;
  v_rank         int;
  v_participation_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'add_event_participant: not authenticated';
  END IF;

  -- ⛔ THE GATE IS FIRST. SECURITY DEFINER bypasses RLS, so this IS the access
  -- control rather than a convenience check.
  IF NOT public.owns_festival_event(p_event_id) THEN
    RAISE EXCEPTION 'add_event_participant: not the owner of event %', p_event_id;
  END IF;

  SELECT pr.user_id, pr.type INTO v_user_id, v_profile_type
    FROM public.profiles pr WHERE pr.id = p_profile_id;

  IF v_profile_type IS NULL THEN
    RAISE EXCEPTION 'add_event_participant: no such profile %', p_profile_id;
  END IF;

  -- ⛔⛔ AN UNCLAIMED PROFILE HAS NO PERSON BEHIND IT. `profiles.user_id` is
  -- NULL for a large share of rows (imported and unclaimed acts), and a
  -- participation row with a null user_id belongs to nobody: it can never be
  -- read by its subject, never carry a résumé, and never be vouched for.
  -- ⭐ A NAMED refusal, so the organiser is told what to do rather than seeing
  -- a constraint error.
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'add_event_participant: that profile is not claimed by a registered account yet';
  END IF;

  SELECT default_rank INTO v_rank
    FROM public.participation_type_ceiling WHERE participant_type = p_participant_type;

  IF v_rank IS NULL THEN
    RAISE EXCEPTION 'add_event_participant: unknown participant type "%"', p_participant_type;
  END IF;

  -- ⭐⭐ THE SAME MAPPING AS `accept_festival_applications`, and it must stay
  -- identical: a volunteer participates as the PERSON, so the row carries no
  -- profile. Everything else participates as the identity that was chosen.
  -- ⛔ Two copies of this rule drifting apart is how a volunteer ends up
  -- credited under a band name.
  INSERT INTO public.participation
    (event_id, user_id, profile_id, participant_type, visibility_rank)
  VALUES (
    p_event_id,
    v_user_id,
    CASE WHEN p_participant_type = 'volunteer' THEN NULL ELSE p_profile_id END,
    p_participant_type,
    v_rank
  )
  -- ⭐ IDEMPOTENT BY THE SAME KEY the spine defines: one row per person per
  -- event per type. Adding someone twice must not create a second row — that is
  -- precisely how a person gets chased twice.
  ON CONFLICT (event_id, user_id, participant_type) WHERE user_id IS NOT NULL
  DO UPDATE SET updated_at = now()
  RETURNING id INTO v_participation_id;

  -- ⭐ `accepted`, ⛔ NOT `confirmed`. The organiser is asserting that the
  -- festival has taken this person on; only the person can confirm they agreed.
  -- ⚠ An organiser_assertion may never stand in for the subject's own answer.
  INSERT INTO public.participation_transition
    (participation_id, status, transition_type, verification_method, performed_by, metadata)
  VALUES (
    v_participation_id, 'accepted', 'manually_added', 'organiser_assertion', auth.uid(),
    jsonb_build_object('profile_id', p_profile_id, 'participant_type', p_participant_type)
  );

  RETURN v_participation_id;
END; $$;

REVOKE ALL ON FUNCTION public.add_event_participant(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_event_participant(uuid,uuid,text) TO authenticated;

COMMENT ON FUNCTION public.add_event_participant(uuid,uuid,text) IS
  'Add a registered person to an event as a participant, without an application. Owner-gated.';

NOTIFY pgrst, 'reload schema';
