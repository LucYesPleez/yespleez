-- ============================================================
-- AV5 · BUSINESS OBSERVATION EVENTS — the CHECK learns the funnel
--
-- ⚠ NOT YET APPLIED. Run after AV4. The ONE migration in the Analytics
-- v2 sequence that touches a live table — and only its name CHECK,
-- the same single-transaction drop/re-add A2 and O2 performed cleanly.
-- Worst case for an insert in flight is one dropped ping, which the
-- client contract already absorbs (fire-and-forget, errors swallowed).
--
-- Four names join the allow-list. They are OBSERVATIONS of business
-- transitions whose truth lives elsewhere — the products stay
-- authoritative; analytics stores that the transition happened:
--
--   application_started   the apply flow was OPENED (an interaction —
--                         intent, before any application row exists)
--   application_accepted  the host decision was recorded
--                         (applications.status is the truth)
--   application_released  the artist was TOLD — the slot notice went
--                         out (the P6 notification boundary is the truth)
--   participation_recorded  a participation transition was logged
--                         (the append-only transition log is the truth;
--                         no producer emits this yet — the name lands
--                         now so the vocabulary is complete, and the
--                         Festival integration phase wires the emitter)
--
-- ⭐ 'applied' IS ALREADY THE SUBMISSION EVENT and keeps that meaning.
-- ⛔ No application_submitted is added: the ratified vocabulary rule is
-- that business names align with the application state machine, and a
-- second name for the same moment is how two dashboards disagree.
-- ============================================================

BEGIN;

ALTER TABLE public.usage_events
  DROP CONSTRAINT IF EXISTS usage_events_name_check;

ALTER TABLE public.usage_events
  ADD CONSTRAINT usage_events_name_check CHECK (name IN (
    -- lifecycle (A1)
    'opened_app',
    'signed_up',
    -- install funnel (A1)
    'install_prompt_shown',
    'install_prompt_accepted',
    'install_prompt_dismissed',
    'installed_pwa',
    -- what people do (A1)
    'created_event',
    'published_event',
    'applied',
    'sent_message',
    'sent_voicey',
    'followed',
    'shared',
    -- the shape of a visit (A2)
    'screen_view',
    'session_end',
    'error',
    -- A3 · what people ASK for
    'filtered',
    -- O2 · the participation funnel
    'gate_shown',
    'intent_resumed',
    -- AV5 · business observations (props carry ids as opaque facts; no FK)
    'application_started',
    'application_accepted',
    'application_released',
    'participation_recorded'
  ));

COMMIT;

-- ============================================================
-- VERIFICATION
-- ============================================================

-- V1 · every name — the 19 existing AND the 4 new — is accepted, and
-- the constraint still exists at all.
DO $$
DECLARE
  expected text[] := ARRAY[
    'opened_app','signed_up',
    'install_prompt_shown','install_prompt_accepted','install_prompt_dismissed','installed_pwa',
    'created_event','published_event','applied','sent_message','sent_voicey','followed','shared',
    'screen_view','session_end','error','filtered','gate_shown','intent_resumed',
    'application_started','application_accepted','application_released','participation_recorded'
  ];
  nm text; def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
  FROM pg_constraint
  WHERE conrelid = 'public.usage_events'::regclass
    AND conname = 'usage_events_name_check';
  IF def IS NULL THEN
    RAISE EXCEPTION 'V1 FAILED: usage_events_name_check is GONE — the swap dropped and did not re-add';
  END IF;
  FOREACH nm IN ARRAY expected LOOP
    IF position('''' || nm || '''' in def) = 0 THEN
      RAISE EXCEPTION 'V1 FAILED: % missing from the CHECK', nm;
    END IF;
  END LOOP;
  RAISE NOTICE 'V1 PASSED: all % event names accepted', array_length(expected, 1);
END $$;

-- V2 · the allow-list still BITES (provoke-and-assert).
DO $$
BEGIN
  BEGIN
    INSERT INTO public.usage_events (device_id, name, display_mode, platform)
    VALUES ('00000000-0000-0000-0000-000000000000', 'application_submitted', 'browser', 'desktop');
    RAISE EXCEPTION 'V2 FAILED: the synonym application_submitted was ACCEPTED — ''applied'' is the submission event';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'V2 PASSED: unknown names still rejected; the vocabulary stays single';
  END;
END $$;

-- V3 · no historical row violates the new CHECK (they cannot — it is a
-- superset — but the claim is cheap to prove and expensive to assume).
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.usage_events e
  WHERE e.name NOT IN (
    'opened_app','signed_up',
    'install_prompt_shown','install_prompt_accepted','install_prompt_dismissed','installed_pwa',
    'created_event','published_event','applied','sent_message','sent_voicey','followed','shared',
    'screen_view','session_end','error','filtered','gate_shown','intent_resumed',
    'application_started','application_accepted','application_released','participation_recorded'
  );
  IF n <> 0 THEN
    RAISE EXCEPTION 'V3 FAILED: % historical row(s) carry a name outside the new CHECK', n;
  END IF;
  RAISE NOTICE 'V3 PASSED: every historical row conforms; nothing was orphaned';
END $$;
