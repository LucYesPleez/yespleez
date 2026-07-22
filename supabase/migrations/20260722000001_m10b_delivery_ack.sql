-- ═══════════════════════════════════════════════════════════════════════
-- M10b — TRUE DELIVERY ACKNOWLEDGEMENTS. One column, no new table.
-- ═══════════════════════════════════════════════════════════════════════
--
-- "Delivered" must mean THE RECIPIENT'S DEVICE HAS THE MESSAGE. Not stored,
-- not queued, not notified, not assumed. Only an acknowledgement sent BY the
-- recipient's client may set it.
--
-- ── WHY NOT message_participant_state (M9i) ────────────────────────────
--
-- It is the obvious home and it is the wrong one. Its key is
-- (message_id, profile_id) — per PROFILE, because a Hand from a profile is one
-- Hand whichever human gave it. Delivery is the opposite: it is a fact about a
-- DEVICE. Two people share a profile, one has the app open, and a
-- profile-keyed ack would claim delivery for the colleague whose phone is off.
-- It is also one row per message, where delivery only ever needs a watermark.
--
-- ── WHY conversation_read_state IS ALREADY THE RIGHT SHAPE ─────────────
--
-- Keyed (conversation_id, user_id): per human, per conversation — `C11`'s
-- reasoning exactly, and the same reasoning delivery needs. It already holds a
-- monotonic watermark, already has the four policies this needs, and already
-- restricts every row to its owner.
--
-- So this adds ONE nullable column. No new table, no new policies, no change
-- to what any existing statement returns.
--
-- NULLABLE, not defaulted: every row that exists today predates delivery
-- tracking, and back-filling `now()` would assert a delivery that never
-- happened. Unknown must stay unknown — that is the whole point of the feature.

BEGIN;

ALTER TABLE public.conversation_read_state
  ADD COLUMN IF NOT EXISTS last_delivered_at timestamptz;

COMMENT ON COLUMN public.conversation_read_state.last_delivered_at IS
  'Everything created at or before this instant has REACHED this human''s '
  'device. Set only by mark_conversation_delivered, called by the recipient '
  'client on actually receiving a message. NULL means unknown, never "no".';

COMMENT ON TABLE public.conversation_read_state IS
  'Per (conversation, human) message state: what has reached this device '
  '(last_delivered_at) and what they have read (last_read_at). Named for read '
  'state historically; C11 keys it by human because two people can act as one '
  'profile.';


-- ── THE ACKNOWLEDGEMENT ────────────────────────────────────────────────
--
-- SECURITY INVOKER, like mark_conversation_read: RLS already states who may
-- write a row here, and elevating would put that authority in a second place
-- that could disagree with the first.
--
-- IDEMPOTENT BY CONSTRUCTION. `GREATEST` means a replayed, delayed or
-- out-of-order acknowledgement can never walk the watermark backwards and
-- un-deliver a message. Sending it a hundred times is the same as once.
CREATE OR REPLACE FUNCTION public.mark_conversation_delivered(p_conversation_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'mark_conversation_delivered: no authenticated user'
      USING ERRCODE = '42501';
  END IF;

  -- The INSERT is refused by M8d's policy unless the caller is a participant,
  -- so no separate authorisation check is needed or wanted here.
  INSERT INTO public.conversation_read_state (conversation_id, user_id, last_read_at, last_delivered_at)
       -- A brand-new row must NOT claim the conversation is read. Delivery and
       -- reading are different events and this function only witnesses one.
       -- `-infinity` is the honest "nothing read yet"; the column is NOT NULL,
       -- so it cannot simply be omitted.
       VALUES (p_conversation_id, v_uid, '-infinity', v_now)
  ON CONFLICT (conversation_id, user_id) DO UPDATE
     SET last_delivered_at = GREATEST(
           COALESCE(public.conversation_read_state.last_delivered_at, '-infinity'::timestamptz),
           EXCLUDED.last_delivered_at)
   RETURNING last_delivered_at INTO v_now;

  RETURN v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_conversation_delivered(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_conversation_delivered(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_delivered(uuid) TO authenticated;


-- ── READING BOTH WATERMARKS, FOR EVERYONE ELSE ─────────────────────────
--
-- Supersedes conversation_seen_watermark (M10a) — one round trip instead of
-- two, and the same aggregate discipline: the caller learns WHEN, never WHO.
-- The old function stays callable so an older client keeps working.
--
-- The oracle guard is load-bearing. SECURITY DEFINER bypasses RLS, so without
-- is_conversation_participant this would answer for any conversation id and
-- leak the existence of threads the caller has no part in.
CREATE OR REPLACE FUNCTION public.conversation_receipts(p_conversation_id uuid)
RETURNS TABLE (delivered_at timestamptz, seen_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT max(crs.last_delivered_at),
         -- '-infinity' is the sentinel a delivery-only row carries; it means
         -- "not read", and must never surface as a real timestamp that would
         -- mark every message seen.
         max(NULLIF(crs.last_read_at, '-infinity'::timestamptz))
    FROM public.conversation_read_state crs
   WHERE crs.conversation_id = p_conversation_id
     AND crs.user_id <> auth.uid()
     AND public.is_conversation_participant(p_conversation_id);
$$;

COMMENT ON FUNCTION public.conversation_receipts(uuid) IS
  'Latest delivery and read moments across every OTHER participant. Aggregate '
  'by design: tells the sender WHEN, never WHO, so a shared profile does not '
  'expose one colleague''s behaviour to the other party. Never widen to rows.';

REVOKE ALL ON FUNCTION public.conversation_receipts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.conversation_receipts(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.conversation_receipts(uuid) TO authenticated;

COMMIT;
