-- ═══════════════════════════════════════════════════════════════════════
-- S6 — A CANCELLED ASK MUST NOT HOLD THE DATE (owner, 2026-09-01)
-- ═══════════════════════════════════════════════════════════════════════
--
-- ⛔⛔ CANCELLING MEANT "NEVER AGAIN", AND NOBODY INTENDED THAT.
--
-- `venue_enquiries` is unique on (venue, applicant, date). Cancelling sets
-- `status = 'cancelled'` — it does NOT delete the row, deliberately: the other
-- side may already have read it, and erasing a conversation from one side is
-- not the same as ending it. But the row keeps occupying its slot in the unique
-- key, so re-enquiring the same venue about the same date is refused with
-- 23505 forever.
--
-- ⚠⚠ IT FAILED SILENTLY FROM THE PERSON'S SIDE. ProfileScreen reads 23505 and
-- says "You have already enquired about Saturday 17 October" — accurate about
-- the constraint, and completely wrong as advice, because they had cancelled
-- that enquiry precisely so they could ask again. The owner pressed SEND twice
-- and nothing was written either time.
--
-- ⭐ THE RULE: cancelling means "not this time", ⛔ not "never again".
--
-- ── WHY AN INDEX AND NOT A CONSTRAINT ──
--
-- Postgres UNIQUE *constraints* cannot be partial; only unique INDEXES can
-- carry a WHERE clause. So each constraint is replaced by the partial index
-- that expresses the same rule minus cancelled rows. ⚠ This is the one case
-- where a bare index is correct rather than a named constraint — P10 chose a
-- named constraint so P11 could drop it by name, and that reasoning does not
-- survive the need for a predicate.
--
-- ⛔ `cancelled` ONLY. A DECLINED enquiry still holds its date: the venue
-- answered, and letting someone re-ask the same date after a no is a different
-- product decision that nobody has made. Widening this predicate is a
-- behavioural change, not a tidy-up.
--
-- ⚠ BOTH KEYS ARE HANDLED. P10 added the profile-level key; the baseline
-- user-level key is P11's to drop and may or may not still be present. Each is
-- replaced with its own partial equivalent, so this migration neither depends
-- on P11 having run nor quietly performs it — whichever keys exist keep
-- enforcing exactly what they enforced, minus cancelled rows.
--
-- ⛔ CANNOT FAIL ON EXISTING DATA. The predicate only ever REMOVES rows from
-- the uniqueness set, so any row set that satisfied the total constraint
-- satisfies the partial index.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1 · PROFILE-LEVEL (P10) ────────────────────────────────────────────
ALTER TABLE public.venue_enquiries
  DROP CONSTRAINT IF EXISTS venue_enquiries_venue_profile_applicant_profile_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS venue_enquiries_live_profile_date_key
  ON public.venue_enquiries (venue_profile_id, applicant_profile_id, date_requested)
  WHERE status <> 'cancelled';

COMMENT ON INDEX public.venue_enquiries_live_profile_date_key IS
  'S6 — one LIVE ask per (venue profile, applicant profile, date). Replaces '
  'P10''s total constraint: a cancelled row keeps its history but releases the '
  'date, so the asker may enquire again. Cancelling means "not this time", not '
  '"never again" (owner, 2026-09-01).';

-- ── 2 · ACCOUNT-LEVEL (baseline, if P11 has not dropped it) ────────────
--
-- ⚠ Recreated as a partial index rather than simply dropped. Dropping it would
-- be P11's behavioural change smuggled into a bug fix; this keeps whatever
-- uniqueness the database currently enforces and only exempts cancelled rows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venue_enquiries_venue_user_id_applicant_user_id_date_reques_key'
      AND conrelid = 'public.venue_enquiries'::regclass
  ) THEN
    ALTER TABLE public.venue_enquiries
      DROP CONSTRAINT venue_enquiries_venue_user_id_applicant_user_id_date_reques_key;

    CREATE UNIQUE INDEX IF NOT EXISTS venue_enquiries_live_user_date_key
      ON public.venue_enquiries (venue_user_id, applicant_user_id, date_requested)
      WHERE status <> 'cancelled';
  END IF;
END $$;

-- ── VERIFY ─────────────────────────────────────────────────────────────
-- Expect the partial index/indexes, and NO total unique constraint on the
-- same columns:
--
--   SELECT indexname, indexdef
--     FROM pg_indexes
--    WHERE tablename = 'venue_enquiries'
--      AND indexname LIKE 'venue_enquiries_live_%';
--
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.venue_enquiries'::regclass AND contype = 'u';
--
-- And the behaviour, on the row this was found with (both 17 Oct asks to the
-- brewery are cancelled, so a fresh insert must now be accepted).
