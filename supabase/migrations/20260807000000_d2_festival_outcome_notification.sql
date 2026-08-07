-- D2 · TELL THE APPLICANT.
--
-- Verification of the organiser → applicant loop (2026-08-07) found it did not
-- close: `releaseOutcomes()` stamped `outcome_released_at` and nothing else, and
-- neither app wrote a notification anywhere. A festival could accept someone and
-- that person would only ever find out by revisiting the event page unprompted.
--
-- ⭐ IT LIVES IN THE DATABASE, NOT IN EITHER APP. Notifications are a platform
-- noun; release is an application verb. The Portal cannot import Scene's
-- writeNotification (separate repos, no shared package yet), so putting it in
-- app code would mean a second implementation the day anything else releases.
-- One trigger serves every present and future release path.
--
-- ⛔ A FAILED NOTIFICATION MUST NEVER ROLL BACK A RELEASE. Platform contract:
-- nothing may block the transaction that records what it announces. The insert
-- is wrapped so that a notification failure loses the notification, never the
-- decision — the organiser's release is the fact, the telling is a consequence.

CREATE OR REPLACE FUNCTION public.notify_festival_outcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id    uuid;
  v_event_name text;
  v_festival   uuid;
  v_category   text;
BEGIN
  -- ⚠ ONLY THE null → NOT NULL TRANSITION. `releaseOutcomes` is idempotent by
  -- nature (an organiser can press release again with a wider selection), and
  -- re-announcing an outcome someone already read is worse than not announcing:
  -- it reopens a decision in their head that was settled.
  IF NEW.outcome_released_at IS NULL OR OLD.outcome_released_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Only outcomes are announceable. `releaseOutcomes` already filters on
  -- decided_at, but a release of anything else must stay silent rather than
  -- send a notification with no outcome in it.
  IF NEW.status NOT IN ('accepted', 'declined') THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT p.user_id INTO v_user_id
      FROM public.profiles p
     WHERE p.id = NEW.from_profile_id;

    -- No recipient, nothing to send. An unclaimed profile has no account behind
    -- it yet; N1's held-notification pattern is for rows addressed to nobody on
    -- purpose, and this is not that.
    IF v_user_id IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT e.name, e.owner_profile_id INTO v_event_name, v_festival
      FROM public.events e
     WHERE e.id = NEW.event_id;

    -- Humanised from the key rather than a label lookup: `appliesAs` and the
    -- category labels are already duplicated across two repos, and a third copy
    -- in SQL would be the one nobody remembers to update.
    v_category := initcap(replace(NEW.category_key, '_', ' '));

    INSERT INTO public.notifications (
      to_user_id, to_profile_id, about_profile_id,
      type, event_id, event_name, message, data
    )
    VALUES (
      v_user_id,
      -- WHICH of their profiles this concerns — the one that applied.
      NEW.from_profile_id,
      -- WHOSE activity it is: the festival. Gives the bell an avatar to show.
      v_festival,
      CASE WHEN NEW.status = 'accepted'
           THEN 'festival_accepted' ELSE 'festival_declined' END,
      NEW.event_id,
      v_event_name,
      CASE WHEN NEW.status = 'accepted'
           THEN COALESCE(v_event_name, 'A festival') || ' accepted your ' || v_category || ' application.'
           -- Not the applicant's failure, and not a verdict on them.
           ELSE COALESCE(v_event_name, 'A festival') || ' could not fit you in for ' || v_category || ' this year.'
      END,
      jsonb_build_object(
        'event_id',       NEW.event_id,
        'category_key',   NEW.category_key,
        'application_id', NEW.id
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Swallowed deliberately. See the header: the release is the fact.
    NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_festival_outcome ON public.festival_applications;

CREATE TRIGGER trg_notify_festival_outcome
  AFTER UPDATE OF outcome_released_at ON public.festival_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_festival_outcome();

-- Categorised so the existing preference machinery governs these like every
-- other booking notice. ⚠ WITHOUT THIS an uncategorised type falls through
-- `notification_category_is_mutable` as "always deliver" — which works, but
-- silently exempts it from preferences the user believes apply to everything.
INSERT INTO public.notification_expiry_policy (type, category, policy, note)
VALUES
  ('festival_accepted', 'bookings', 'event', 'D2 festival released an acceptance'),
  ('festival_declined', 'bookings', 'event', 'D2 festival released a decline')
ON CONFLICT (type) DO NOTHING;
