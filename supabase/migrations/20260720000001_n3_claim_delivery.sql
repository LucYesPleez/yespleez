-- ============================================================
-- N3 · CLAIMING DELIVERS EVERYTHING HELD
-- Phase 13.2 Q1, docs/phase-13-q1-notifications-unclaimed-owners-2026-07.md
-- Requires: 20260720000000_n1_held_notifications.sql
-- ============================================================
--
-- `N3`: "On claim, held notifications become deliverable to the new owner.
-- Nothing is re-created, nothing migrates — the notifications were always
-- scoped to that profile, and claiming supplies the human they were
-- waiting for."
--
-- So delivery is one UPDATE populating to_user_id. There is no move, no
-- copy, no state machine: a held row and a delivered row differ only in
-- whether the delivery identity is present (`N1`).
--
-- ── WHY THIS IS IN THE DATABASE AND NOT IN THE APP ──────────────
--
-- Because the app never completes a claim. ClaimDialog.jsx opens an
-- Instagram DM or a mailto to claims@yespleez.com; the team reviews by
-- hand; someone then sets profiles.user_id in the SQL editor. NO CODE
-- PATH ANYWHERE WRITES profiles.user_id — verified across the whole
-- React app.
--
-- A JavaScript deliverHeldNotifications() would therefore never run at
-- the moment that matters. It would be dead code that looks like a
-- feature, and the first real claim would silently deliver nothing.
--
-- The handover asks for delivery to be designed against "a canonical
-- claim.completed event, manually triggered today, automated later."
-- The NULL → NOT NULL transition on profiles.user_id IS that event:
-- it is the single fact that means "this profile now has a human", it
-- is where the claim actually completes today, and it will still be
-- where the claim completes when a claim UI or an admin tool replaces
-- the SQL editor. Binding to the transition rather than to the caller
-- means none of those future paths has to remember to call anything.
--
-- ── ONLY NULL → NOT NULL. NOT OWNER CHANGES. ────────────────────
--
-- The trigger fires on a claim, not on a reattribution. Moving a profile
-- between owners (Phase 13 Q6) is a different event with different
-- semantics — the held pile has already been delivered, and re-running
-- delivery would hand the new owner nothing while looking successful.
-- Guarded in the WHEN clause so the distinction is enforced, not assumed.
-- ============================================================


-- ── THE DELIVERY, AS A NAMED FUNCTION ──────────────────────────
-- Separate from the trigger deliberately: it can be called directly to
-- repair a claim completed before this migration existed, and it is the
-- thing to call from an admin tool or an Edge Function later. The trigger
-- is one caller, not the definition.
CREATE OR REPLACE FUNCTION public.deliver_held_notifications(
  p_profile_id uuid,
  p_user_id    uuid
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  delivered integer;
BEGIN
  IF p_profile_id IS NULL OR p_user_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.notifications
     SET to_user_id = p_user_id
   WHERE to_profile_id = p_profile_id
     AND to_user_id IS NULL;          -- held only (N1)

  GET DIAGNOSTICS delivered = ROW_COUNT;
  RETURN delivered;
END;
$$;

COMMENT ON FUNCTION public.deliver_held_notifications(uuid, uuid) IS
  'Phase 13.2 `N3` — deliver every held notification for a profile to its new '
  'owner by populating to_user_id. Idempotent: held rows are selected by '
  'to_user_id IS NULL, so a second call delivers nothing and returns 0. '
  'read/created_at are untouched — a claimant sees the notices unread and '
  'dated when they actually happened, which is the point of holding them.';


-- ── THE CANONICAL claim.completed EVENT ────────────────────────
CREATE OR REPLACE FUNCTION public.on_profile_claimed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.deliver_held_notifications(NEW.id, NEW.user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_claimed ON public.profiles;

CREATE TRIGGER trg_profile_claimed
  AFTER UPDATE OF user_id ON public.profiles
  FOR EACH ROW
  WHEN (OLD.user_id IS NULL AND NEW.user_id IS NOT NULL)   -- a claim, not a reattribution
  EXECUTE FUNCTION public.on_profile_claimed();

COMMENT ON FUNCTION public.on_profile_claimed() IS
  'Phase 13.2 `N3` — the canonical claim.completed event. Fires when '
  'profiles.user_id transitions NULL → NOT NULL, which is where a claim '
  'actually completes (manually in the SQL editor today; a claim UI later). '
  'Deliberately bound to the transition rather than to any caller, so no '
  'future claim path has to remember to trigger delivery.';


-- ============================================================
-- ⚠ TWO THINGS THIS DELIBERATELY DOES NOT DO
-- ============================================================
--
-- 1 · IT RUNS WITH INVOKER RIGHTS, NOT SECURITY DEFINER.
--
--    Today that is correct and sufficient: claims are completed in the
--    SQL editor, which runs as a privileged role and is not subject to
--    RLS, so the UPDATE succeeds.
--
--    It will NOT be sufficient once a claim can be completed through the
--    app by an ordinary authenticated user. A held row has
--    to_user_id IS NULL, so an RLS UPDATE policy scoped to
--    `to_user_id = auth.uid()` cannot match it, and delivery would fail
--    SILENTLY — the claim succeeding while the held pile stays invisible.
--
--    SECURITY DEFINER would fix that, and is deliberately NOT applied
--    here because it expands privilege and belongs in the dedicated
--    security pass that also settles notifications INSERT `with_check`.
--    RECORDED SO IT IS A DECISION, NOT A DISCOVERY. Revisit this
--    BEFORE moving claim completion into the app.
--
-- 2 · IT DELIVERS EVERYTHING HELD, INCLUDING STALE ITEMS.
--
--    `N4` expiry is not built. Until it is, a claim delivers applications
--    for gigs that have already happened and enquiries for dates already
--    past — which `N4` says is "worse than none": it tells the venue
--    about an opportunity they already missed.
--
--    Not a live problem yet: no claim has completed and no held rows
--    exist. It becomes one the moment both are true, so `N4` should land
--    before the first real claim.
-- ============================================================


-- ============================================================
-- VERIFICATION — run after applying
-- ============================================================
--
-- 1. The trigger exists and is bound to the right transition:
--
--      SELECT tgname, pg_get_triggerdef(oid)
--      FROM pg_trigger
--      WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal;
--
-- 2. END-TO-END, on real rows. This is the only test that proves N3;
--    a green migration proves only that the SQL parsed.
--
--      -- pick any unclaimed profile
--      SELECT id, name, user_id FROM public.profiles
--      WHERE user_id IS NULL LIMIT 1;                    -- ⇒ :pid
--
--      -- create a held notification for it (what a follow now writes)
--      INSERT INTO public.notifications (to_profile_id, type, message)
--      VALUES (:pid, 'new_follower', 'Someone followed your profile.');
--
--      -- confirm it is held and invisible to every user
--      SELECT id, to_user_id, to_profile_id FROM public.notifications
--      WHERE to_profile_id = :pid;                        -- ⇒ to_user_id NULL
--
--      -- complete the claim exactly as the team does by hand
--      UPDATE public.profiles SET user_id = :some_user_id WHERE id = :pid;
--
--      -- THE ASSERTION: the held row is now delivered, unread, original date
--      SELECT to_user_id, read, created_at FROM public.notifications
--      WHERE to_profile_id = :pid;                        -- ⇒ to_user_id = :some_user_id
--
--      -- clean up
--      DELETE FROM public.notifications WHERE to_profile_id = :pid;
--      UPDATE public.profiles SET user_id = NULL WHERE id = :pid;
--
-- 3. Idempotency — a second delivery is a no-op (expect 0):
--
--      SELECT public.deliver_held_notifications(:pid, :some_user_id);
--
-- 4. Reattribution must NOT re-fire (expect the trigger not to run):
--    change user_id from one non-null value to another and confirm no
--    rows are touched.
-- ============================================================
