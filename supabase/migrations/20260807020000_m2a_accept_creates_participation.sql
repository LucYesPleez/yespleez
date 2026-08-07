-- M2a · ACCEPTANCE CREATES PARTICIPATION.
--
-- ⭐⭐ THE SEAM THE WHOLE MILESTONE EXISTED TO PROTECT. Until now `decide()` set
-- `status = 'accepted'` and stopped, which meant the fact that someone is part
-- of a festival lived only as an application status — the exact model
-- [[participation]] replaces. Applications are requests; participation is
-- reality, and an acceptance is where one becomes the other.
--
-- ⭐ ONE STATEMENT, NOT TWO. The application stamp and the participation record
-- happen in a single transaction because they are one fact. Wiring this in the
-- client would leave a window where an application reads accepted and no
-- participation exists — and nothing would ever notice, because both halves
-- look fine on their own.
--
-- ⭐ THE MAPPING LIVES HERE, NOT IN THE ORGANISER'S TOOL. Which participant type
-- an accepted application becomes is platform knowledge: `volunteer` is the
-- category applying as the punter identity, everything else participates as
-- whatever profile applied. The Portal should not have to learn that, and a
-- second copy of it in Scene would be a third place to get it wrong.
--
-- ⛔ ONLY ACCEPTANCE. Shortlisted, waitlisted and declined create nothing —
-- participation begins at Accepted, and a waitlisted person is still an
-- applicant whose application simply has another outcome.

CREATE OR REPLACE FUNCTION public.accept_festival_applications(p_ids uuid[])
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  r      record;
  v_type text;
  v_rank int;
  v_pid  uuid;
  v_n    int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'accept_festival_applications: not authenticated';
  END IF;

  FOR r IN
    SELECT a.id, a.event_id, a.category_key, a.from_profile_id,
           p.type AS profile_type, p.user_id
      FROM public.festival_applications a
      JOIN public.profiles p ON p.id = a.from_profile_id
     WHERE a.id = ANY(p_ids)
  LOOP
    -- Checked per row, not once: a caller could pass ids spanning two events.
    IF NOT public.owns_festival_event(r.event_id) THEN
      RAISE EXCEPTION 'accept_festival_applications: not the owner of event %', r.event_id;
    END IF;

    v_type := CASE WHEN r.category_key = 'volunteer' THEN 'volunteer' ELSE r.profile_type END;

    SELECT default_rank INTO v_rank
      FROM public.participation_type_ceiling WHERE participant_type = v_type;

    -- ⚠ A NAMED FAILURE, not a foreign-key violation. Without this, accepting a
    -- category whose profile type has no ceiling row fails with a constraint
    -- error naming neither the application nor the type, and the organiser sees
    -- "something went wrong" for a fixable configuration problem.
    IF v_rank IS NULL THEN
      RAISE EXCEPTION 'accept_festival_applications: no participation ceiling for type "%" (application %)',
        v_type, r.id;
    END IF;

    UPDATE public.festival_applications
       SET status = 'accepted', decided_at = now()
     WHERE id = r.id;

    INSERT INTO public.participation
      (event_id, user_id, profile_id, participant_type, visibility_rank)
    VALUES (
      r.event_id,
      r.user_id,
      -- ⭐ NULL for a volunteer: they participate as the PERSON, not an
      -- identity. The punter account is not a role profile.
      CASE WHEN v_type = 'volunteer' THEN NULL ELSE r.from_profile_id END,
      v_type,
      v_rank
    )
    ON CONFLICT (event_id, user_id, participant_type) WHERE user_id IS NOT NULL
    DO UPDATE SET updated_at = now()
    RETURNING id INTO v_pid;

    -- ⭐ The evidence. `application_accepted` is a transition_type, never a
    -- status — operational events explain HOW a canonical status was reached.
    -- ⚠ metadata stays structured: ids and keys, never prose about a person.
    INSERT INTO public.participation_transition
      (participation_id, status, transition_type, verification_method, performed_by, metadata)
    VALUES (
      v_pid, 'accepted', 'application_accepted', 'organiser_assertion', auth.uid(),
      jsonb_build_object('application_id', r.id, 'category_key', r.category_key)
    );

    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END; $$;

REVOKE ALL ON FUNCTION public.accept_festival_applications(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_festival_applications(uuid[]) TO authenticated;
