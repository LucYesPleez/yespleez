-- M2 · PARTICIPATION — the spine.
--
-- ⭐⭐ APPLICATIONS ARE REQUESTS. PARTICIPATION IS REALITY.
-- ⭐⭐ STATUS IS DERIVED FROM IMMUTABLE EVIDENCE.
--
-- Two layers. `participation` is the current relationship;
-- `participation_transition` is an APPEND-ONLY log and is the canonical source
-- of truth. Everything on the participation row that could disagree with the
-- log — status, festival_id, current_transition_id — is DERIVED and maintained
-- by trigger, never written by a client.
--
-- ⛔ NO UI DEPENDS ON THIS YET, ON PURPOSE. It lands before the surfaces that
-- read it, because the first thing to write a participation row is `accept`,
-- and an acceptance recorded as an application status is the model this exists
-- to replace.
--
-- ⭐⭐ THE SECURITY CRUX, and the reason both tables are read-only to every
-- client role: the confidence ladder is AUTHORITY-BEARING. If a client could
-- name its own `verification_method`, any punter could insert a QR-Scan
-- transition and mint verified history. THE SERVER STAMPS THE METHOD; THE
-- CLIENT NEVER SENDS IT.

-- ── Visibility ceilings ─────────────────────────────────────────────────────
-- ⭐ A TABLE, NOT A CHECK CONSTRAINT. New participant types are coming — crew,
-- medical, security — and each one must not be a schema migration. Adding a
-- type is a row; adding an enum member is a deployment.
CREATE TABLE IF NOT EXISTS public.participation_type_ceiling (
  participant_type text PRIMARY KEY,
  -- Higher is more visible. Ranked so "narrow, never widen" is a comparison
  -- rather than a table of special cases.
  ceiling_rank     int  NOT NULL,
  -- ⭐ NOT DERIVABLE FROM THE CEILING, which is why it is a column and not a
  -- formula. Professional types default TO their ceiling — the credit is the
  -- reason they did it. Volunteer and attendee default to the most private
  -- setting available, because that history is somebody's private life.
  default_rank     int  NOT NULL,
  note             text,
  CONSTRAINT participation_type_default_within_ceiling CHECK (default_rank <= ceiling_rank)
);

COMMENT ON TABLE public.participation_type_ceiling IS
  'Gate 1: the MAXIMUM visibility a participant type may ever reach. Set by the role, not the user.';

INSERT INTO public.participation_type_ceiling (participant_type, ceiling_rank, default_rank, note) VALUES
  ('artist',             40, 40, 'performing — professional credit is the point'),
  ('band',               40, 40, 'performing'),
  ('standup',            40, 40, 'performing'),
  ('market_stall',       30, 30, 'festival context only'),
  ('food_vendor',        30, 30, 'festival context only'),
  ('workshop',           30, 30, 'festival context only'),
  ('decor',              30, 30, 'festival context only'),
  ('media',              30, 30, 'festival context only'),
  ('theme_camp',         30, 30, 'festival context only'),
  ('performance_artist', 30, 30, 'festival context only'),
  ('volunteer',          20, 10, 'friend-gated ceiling, private by default — that is people''s private life'),
  ('attendee',           10, 10, 'private — who went to what is the most sensitive type')
ON CONFLICT (participant_type) DO NOTHING;

-- ── The relationship ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.participation (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ⛔ ATTACHES TO THE EVENT, NEVER THE FESTIVAL PROFILE. The profile is the
  -- organisation; the event is the occurrence you took part in.
  event_id              uuid NOT NULL,

  -- ⭐ DERIVED from the event's owner. Denormalised for "every festival I have
  -- worked" without a join, and trigger-maintained so it cannot disagree.
  festival_id           uuid,

  -- ⭐ WHOSE HISTORY THIS IS. Portable: one person, one résumé.
  user_id               uuid,

  -- The identity they participated UNDER. ⭐ NULLABLE BY DESIGN — a volunteer
  -- has no role profile; it is the punter account itself.
  profile_id            uuid,

  participant_type      text NOT NULL,

  -- ⭐ DERIVED from the log. Never written by a client.
  status                text NOT NULL DEFAULT 'invited',
  current_transition_id uuid,

  -- Gate 2: the user's own setting, at or below their type's ceiling.
  visibility_rank       int  NOT NULL DEFAULT 10,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- ⭐ SMALL AND STABLE. ⛔ Never grow this for a participant type — that is
  -- what `transition_type` on the log is for. Operational events are EVIDENCE,
  -- not statuses.
  CONSTRAINT participation_status_check CHECK (status = ANY (ARRAY[
    'invited','applied','accepted','confirmed','checked_in',
    'participated','completed','cancelled','withdrawn','rejected','no_show'
  ])),
  CONSTRAINT participation_visibility_check CHECK (visibility_rank = ANY (ARRAY[10,20,30,40]))
);

-- ⛔ RESTRICT, NOT CASCADE. Participation is permanent history — deleting an
-- event must not erase that someone worked it. If an event genuinely must go,
-- its participation is dealt with deliberately first.
ALTER TABLE public.participation
  ADD CONSTRAINT participation_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE RESTRICT;

-- ⭐⭐ SET NULL, NEVER CASCADE — the single most important line in this file.
-- Account deletion cascading into participation would silently destroy the log,
-- which is the exact failure the whole design exists to prevent. Erasure severs
-- the PERSON from the record; it never deletes the record.
-- (Note this deliberately differs from `profiles.user_id`, which cascades.)
ALTER TABLE public.participation
  ADD CONSTRAINT participation_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.participation
  ADD CONSTRAINT participation_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.participation
  ADD CONSTRAINT participation_type_fkey
  FOREIGN KEY (participant_type) REFERENCES public.participation_type_ceiling(participant_type);

-- ⭐ ONE ROW PER PERSON PER EVENT PER TYPE. A person may perform AND volunteer
-- at the same festival — two rows, two relationships — but not two volunteer
-- rows, which is how someone gets chased twice.
CREATE UNIQUE INDEX IF NOT EXISTS participation_one_per_role_idx
  ON public.participation (event_id, user_id, participant_type)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS participation_user_idx     ON public.participation (user_id);
CREATE INDEX IF NOT EXISTS participation_event_idx    ON public.participation (event_id);
CREATE INDEX IF NOT EXISTS participation_festival_idx ON public.participation (festival_id);

-- ── The evidence ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.participation_transition (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participation_id    uuid NOT NULL REFERENCES public.participation(id) ON DELETE CASCADE,

  status              text NOT NULL,

  -- ⭐ HOW the status was reached: 'shift_completed', 'stage_manager_confirmed',
  -- 'trading_approved', 'sound_check'. Free text on purpose — this is where new
  -- participant types express themselves WITHOUT touching the status enum.
  transition_type     text,

  -- ⭐⭐ THE LADDER. Confidence is DERIVED from this and NEVER stored:
  --   qr_scan > accreditation_scan > ticket_validation > stage_manager >
  --   gate_crew > organiser_assertion > manual_override > self_assertion
  -- ⭐ self_assertion is categorically different — every other method is someone
  -- ELSE attesting; this is the subject attesting about themselves, and it can
  -- never satisfy a history or reputation metric.
  verification_method text NOT NULL,

  -- The ACTOR, not the subject — usually gate crew. ⛔ Identity of the subject
  -- lives on the participation row only, so erasure has one link to sever.
  performed_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  performed_at        timestamptz NOT NULL DEFAULT now(),

  -- ⚠ THESE TWO ARE THE LEAK. Keep them structured and enumerated; never
  -- free-text descriptions of a person. They are the only fields redaction may
  -- NULL, and redaction is the one permitted mutation of this log.
  reason              text,
  metadata            jsonb,

  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT participation_transition_status_check CHECK (status = ANY (ARRAY[
    'invited','applied','accepted','confirmed','checked_in',
    'participated','completed','cancelled','withdrawn','rejected','no_show','redacted'
  ])),
  CONSTRAINT participation_transition_method_check CHECK (verification_method = ANY (ARRAY[
    'qr_scan','accreditation_scan','ticket_validation','stage_manager',
    'gate_crew','organiser_assertion','manual_override','self_assertion','system'
  ]))
);

CREATE INDEX IF NOT EXISTS participation_transition_participation_idx
  ON public.participation_transition (participation_id, performed_at DESC);

ALTER TABLE public.participation
  ADD CONSTRAINT participation_current_transition_fkey
  FOREIGN KEY (current_transition_id)
  REFERENCES public.participation_transition(id) ON DELETE SET NULL;

-- ── Gate 1: narrow, never widen ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.participation_enforce_ceiling()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_ceiling int;
BEGIN
  SELECT ceiling_rank INTO v_ceiling
    FROM public.participation_type_ceiling
   WHERE participant_type = NEW.participant_type;

  IF v_ceiling IS NULL THEN
    RAISE EXCEPTION 'participation: unknown participant_type %', NEW.participant_type;
  END IF;

  -- ⛔ RAISES rather than clamping. Silently lowering a request would tell the
  -- caller their setting was accepted when it was not, and a privacy control
  -- that lies is worse than one that refuses.
  IF NEW.visibility_rank > v_ceiling THEN
    RAISE EXCEPTION 'participation: % may not exceed visibility rank % (asked for %)',
      NEW.participant_type, v_ceiling, NEW.visibility_rank;
  END IF;

  RETURN NEW;
END; $$;

CREATE TRIGGER trg_participation_ceiling
  BEFORE INSERT OR UPDATE OF visibility_rank, participant_type ON public.participation
  FOR EACH ROW EXECUTE FUNCTION public.participation_enforce_ceiling();

-- ── Derived: festival_id ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.participation_derive_festival()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  SELECT e.owner_profile_id INTO NEW.festival_id
    FROM public.events e WHERE e.id = NEW.event_id;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_participation_derive_festival
  BEFORE INSERT OR UPDATE OF event_id ON public.participation
  FOR EACH ROW EXECUTE FUNCTION public.participation_derive_festival();

-- ── Derived: status follows the log ─────────────────────────────────────────
-- ⚠ A test that inserts a transition and asserts these columns followed is the
-- only thing that catches this trigger being dropped: the row still LOOKS right
-- when the log has quietly stopped being the source of truth.
CREATE OR REPLACE FUNCTION public.participation_apply_transition()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  -- A redaction is an audit record, not a state change.
  IF NEW.status = 'redacted' THEN RETURN NEW; END IF;

  UPDATE public.participation
     SET status                = NEW.status,
         current_transition_id = NEW.id,
         updated_at            = now()
   WHERE id = NEW.participation_id;

  RETURN NEW;
END; $$;

CREATE TRIGGER trg_participation_apply_transition
  AFTER INSERT ON public.participation_transition
  FOR EACH ROW EXECUTE FUNCTION public.participation_apply_transition();

-- ── APPEND-ONLY ─────────────────────────────────────────────────────────────
-- ⭐ THE DURABLE GUARD. Grants and RLS are both necessary and neither is
-- sufficient: a later migration can silently re-grant, and this cannot be
-- re-granted around. Catches ONE named exception and raises on everything else.
CREATE OR REPLACE FUNCTION public.participation_transition_append_only()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'participation_transition is append-only: DELETE is never permitted';
  END IF;

  -- The ONE permitted mutation: redaction, which may only NULL the two free-text
  -- fields. Every other column must be identical — a redaction that could change
  -- a status or a method would be a rewrite wearing a privacy label.
  IF NEW.id                  IS DISTINCT FROM OLD.id
  OR NEW.participation_id    IS DISTINCT FROM OLD.participation_id
  OR NEW.status              IS DISTINCT FROM OLD.status
  OR NEW.transition_type     IS DISTINCT FROM OLD.transition_type
  OR NEW.verification_method IS DISTINCT FROM OLD.verification_method
  OR NEW.performed_by        IS DISTINCT FROM OLD.performed_by
  OR NEW.performed_at        IS DISTINCT FROM OLD.performed_at
  OR NEW.created_at          IS DISTINCT FROM OLD.created_at
  OR NEW.reason              IS NOT NULL
  OR NEW.metadata            IS NOT NULL THEN
    RAISE EXCEPTION 'participation_transition is append-only: only redaction (reason/metadata -> NULL) is permitted';
  END IF;

  RETURN NEW;
END; $$;

CREATE TRIGGER trg_participation_transition_append_only
  BEFORE UPDATE OR DELETE ON public.participation_transition
  FOR EACH ROW EXECUTE FUNCTION public.participation_transition_append_only();

-- ── Grants ──────────────────────────────────────────────────────────────────
-- ⚠ EXPLICIT REVOKE FIRST. Supabase's ALTER DEFAULT PRIVILEGES grants ALL on
-- every new table to anon/authenticated/service_role, so these tables are born
-- fully open — the M1 finding, applied at creation rather than discovered later.
-- ⛔ Do NOT use a schema-wide ALTER DEFAULT PRIVILEGES to fix this: it would
-- change behaviour for every future table in public, including Scene's.
REVOKE ALL ON public.participation             FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.participation_transition  FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.participation_type_ceiling FROM anon, authenticated, PUBLIC;

GRANT SELECT ON public.participation             TO authenticated;
GRANT SELECT ON public.participation_transition  TO authenticated;
GRANT SELECT ON public.participation_type_ceiling TO authenticated, anon;

ALTER TABLE public.participation              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participation_transition   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participation_type_ceiling ENABLE ROW LEVEL SECURITY;

CREATE POLICY participation_type_ceiling_read ON public.participation_type_ceiling
  FOR SELECT USING (true);

-- ⭐ THE SUBJECT AND THE COUNTERPARTY, AND NOBODY ELSE YET.
--
-- Gate 3 (the festival's announcement embargo) suppresses the PUBLIC tier and
-- depends on the Publication Model, which does not exist. ⛔ Until it does,
-- unannounced participation is NOT public — that is the ratified safe default,
-- not a placeholder. So there is deliberately no public read policy here, and
-- adding one before the embargo exists would leak staged lineup announcements.
--
-- ⭐ The counterparty always keeps its own record: a festival can always see who
-- worked its own event, at any visibility setting. Visibility governs third
-- parties, never the relationship itself.
CREATE POLICY participation_read_subject ON public.participation
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY participation_read_counterparty ON public.participation
  FOR SELECT USING (public.owns_festival_event(event_id));

-- ⛔ TRANSITIONS ARE NEVER PUBLIC, at any visibility. They carry `performed_by`
-- and `reason` — who did what to whom — which is operational, not résumé.
CREATE POLICY participation_transition_read_subject ON public.participation_transition
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.participation p
     WHERE p.id = participation_transition.participation_id
       AND p.user_id = auth.uid()));

CREATE POLICY participation_transition_read_counterparty ON public.participation_transition
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.participation p
     WHERE p.id = participation_transition.participation_id
       AND public.owns_festival_event(p.event_id)));

-- ── The only way in ─────────────────────────────────────────────────────────
-- ⭐⭐ THE SERVER STAMPS THE METHOD. This is the whole security model in one
-- function: the caller says WHAT happened, the database decides HOW MUCH THAT
-- COUNTS. A client that could pass 'qr_scan' could mint verified history.
CREATE OR REPLACE FUNCTION public.record_participation(
  p_event_id         uuid,
  p_user_id          uuid,
  p_participant_type text,
  p_status           text,
  p_profile_id       uuid DEFAULT NULL,
  p_transition_type  text DEFAULT NULL,
  p_reason           text DEFAULT NULL,
  p_metadata         jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_participation_id uuid;
  v_method           text;
  v_default_rank     int;
  v_is_owner         boolean;
  v_is_self          boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'record_participation: not authenticated';
  END IF;

  v_is_owner := public.owns_festival_event(p_event_id);
  v_is_self  := (p_user_id = auth.uid());

  IF NOT v_is_owner AND NOT v_is_self THEN
    RAISE EXCEPTION 'record_participation: may only record for yourself or an event you own';
  END IF;

  -- ⭐ THE LADDER, DECIDED HERE AND NOWHERE ELSE. The organiser asserting is
  -- worth more than the subject asserting, and neither can claim a scan.
  v_method := CASE WHEN v_is_owner THEN 'organiser_assertion' ELSE 'self_assertion' END;

  SELECT default_rank INTO v_default_rank
    FROM public.participation_type_ceiling WHERE participant_type = p_participant_type;

  INSERT INTO public.participation (event_id, user_id, profile_id, participant_type, visibility_rank)
  VALUES (p_event_id, p_user_id, p_profile_id, p_participant_type, COALESCE(v_default_rank, 10))
  ON CONFLICT (event_id, user_id, participant_type) WHERE user_id IS NOT NULL
  DO UPDATE SET updated_at = now()
  RETURNING id INTO v_participation_id;

  INSERT INTO public.participation_transition
    (participation_id, status, transition_type, verification_method, performed_by, reason, metadata)
  VALUES
    (v_participation_id, p_status, p_transition_type, v_method, auth.uid(), p_reason, p_metadata);

  RETURN v_participation_id;
END; $$;

REVOKE ALL ON FUNCTION public.record_participation(uuid,uuid,text,text,uuid,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_participation(uuid,uuid,text,text,uuid,text,text,jsonb) TO authenticated;
