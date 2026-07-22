-- ═══════════════════════════════════════════════════════════════════════
-- M10a — SEEN, as an aggregate watermark. Amends Identity §2.5.
-- ═══════════════════════════════════════════════════════════════════════
--
-- ⚠ THIS REVERSES A RATIFIED DECISION. M8d said, in its own words:
--
--     "NO SELECT on anyone else's read state — v1 has NO READ RECEIPTS.
--      Granting it later is additive; retracting it would not be."
--
-- The owner has chosen to grant it (2026-07-22) so the EQ receipt ladder can
-- reach its final state. The clause above is why this is deliberate rather than
-- incidental: once senders can see it, taking it away is a visible loss.
--
-- ── WHAT THIS DOES *NOT* DO, AND WHY THAT MATTERS ──────────────────────
--
-- It does NOT add a SELECT policy to conversation_read_state. That table stays
-- exactly as locked as M8d left it — `user_id = auth.uid()` and nothing else.
--
-- §2.5's objection was never "the sender must not know it was read". It was
-- that exposing the table "would expose one human's behaviour inside a shared
-- profile". A profile can be operated by several people; a raw SELECT would
-- tell a sender WHICH of them opened a booking negotiation and at what minute.
-- That is surveillance of a colleague, not a receipt.
--
-- So this exposes one aggregate and nothing else: the LATEST moment anyone
-- other than the caller read the conversation. The sender learns that it was
-- seen. They cannot learn by whom, how many, or in what order.
--
-- ANY owner's eyes count. On a three-owner profile, one person opening the
-- thread marks it seen for all three, and the sender cannot distinguish them.
-- That is the intended answer, not a limitation to fix later — the alternative
-- is the per-human exposure this exists to avoid.
--
-- ── WHY A FUNCTION AND NOT A POLICY ────────────────────────────────────
--
-- A policy grants rows. Rows carry user_id and last_read_at per human, and no
-- policy can aggregate them away — anything that lets you read the answer lets
-- you read the detail. A SECURITY DEFINER function is the only shape that can
-- return strictly less than it reads.
--
-- Pinned search_path, EXECUTE granted to `authenticated` only. Same discipline
-- as open_conversation.

BEGIN;

CREATE OR REPLACE FUNCTION public.conversation_seen_watermark(p_conversation_id uuid)
RETURNS timestamptz
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT max(crs.last_read_at)
    FROM public.conversation_read_state crs
   WHERE crs.conversation_id = p_conversation_id
     -- Everyone EXCEPT the caller. Your own reading has never made your own
     -- message "seen", and including yourself would mark every message seen the
     -- instant you sent it.
     AND crs.user_id <> auth.uid()
     -- ⚠ THE GUARD. Without it this is an oracle: pass any conversation id and
     -- learn whether it exists and is active, for threads you have no part in.
     -- SECURITY DEFINER bypasses RLS, so the check the table would have done
     -- has to be done here instead.
     AND public.is_conversation_participant(p_conversation_id);
$$;

COMMENT ON FUNCTION public.conversation_seen_watermark(uuid) IS
  'Latest moment any OTHER participant read this conversation, or NULL. '
  'Aggregate by design: amends §2.5 to allow receipts without exposing which '
  'human read it inside a shared profile. Never widen this to return rows.';

REVOKE ALL ON FUNCTION public.conversation_seen_watermark(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.conversation_seen_watermark(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.conversation_seen_watermark(uuid) TO authenticated;

COMMIT;


-- ═══════════════════════════════════════════════════════════════════════
-- VERIFICATION — every block RAISES on failure, so a clean run IS the proof.
-- Run it as a normal signed-in user. Rolls back; writes nothing.
-- ═══════════════════════════════════════════════════════════════════════
--
-- BEGIN;
--
-- DO $v$
-- DECLARE
--   v_cid  uuid;
--   v_mark timestamptz;
--   v_rows integer;
-- BEGIN
--   SELECT conversation_id INTO v_cid
--     FROM public.conversation_participants
--    LIMIT 1;
--   IF v_cid IS NULL THEN
--     RAISE EXCEPTION 'CANNOT TEST: no conversations exist';
--   END IF;
--
--   -- 1 · the function exists and is callable by this role
--   v_mark := public.conversation_seen_watermark(v_cid);
--   RAISE NOTICE '1 OK — watermark for % is %', v_cid, coalesce(v_mark::text, 'NULL');
--
--   -- 2 · ⚠ THE ORACLE CHECK. A conversation that cannot exist must come back
--   --     NULL rather than raising or leaking. This is the guard doing its job.
--   IF public.conversation_seen_watermark('00000000-0000-0000-0000-000000000000') IS NOT NULL THEN
--     RAISE EXCEPTION '2 FAILED: returned a watermark for a non-existent conversation';
--   END IF;
--   RAISE NOTICE '2 OK — unknown conversation returns NULL';
--
--   -- 3 · the underlying table is STILL locked. If this ever returns another
--   --     human's row, the policy has been widened and §2.5 is gone for real.
--   SELECT count(*) INTO v_rows
--     FROM public.conversation_read_state
--    WHERE user_id <> auth.uid();
--   IF v_rows <> 0 THEN
--     RAISE EXCEPTION '3 FAILED: % foreign read-state rows are visible — the table was opened up, which this migration deliberately does NOT do', v_rows;
--   END IF;
--   RAISE NOTICE '3 OK — conversation_read_state still exposes only your own rows';
--
--   -- 4 · your OWN reading must not mark your own messages seen
--   PERFORM public.mark_conversation_read(v_cid);
--   IF public.conversation_seen_watermark(v_cid) IS DISTINCT FROM v_mark THEN
--     RAISE EXCEPTION '4 FAILED: the caller''s own read state moved the watermark';
--   END IF;
--   RAISE NOTICE '4 OK — your own reading does not count as seen';
--
--   RAISE NOTICE 'ALL CHECKS PASSED';
-- END $v$;
--
-- ROLLBACK;
