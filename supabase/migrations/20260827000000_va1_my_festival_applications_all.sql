-- VA1 · A PERSON CAN SEE THEIR OWN FESTIVAL APPLICATIONS, ACROSS EVENTS.
--
-- ⚠⚠ WHY A SECOND FUNCTION AND NOT A CHANGE TO THE FIRST.
--
-- `my_festival_applications(p_event_id uuid)` answers "have I applied to THIS
-- event", which is what the event page's ✓ APPLIED chip asks. It takes the
-- event as an argument and returns no event identity, so it cannot answer
-- "what have I applied for" — you must already know the answer to ask the
-- question. Widening it would break every existing caller's contract, so this
-- is a sibling, not a replacement. ⛔ Do not delete the event-scoped one.
--
-- ⭐⭐ THE MASK IS COPIED EXACTLY, AND THAT IS THE POINT. Applicants have no
-- SELECT on `festival_applications` because RLS cannot hide a COLUMN, and a
-- readable row would leak `status` — including an `accepted` the organiser has
-- not released. Hold-and-release is a property of the DATABASE. A second
-- function that reads the same table is a second place that promise can be
-- broken, so the CASE below must stay character-identical to
-- `my_festival_applications`. ⛔ If one changes, both change.
--
-- ⚠ `shortlisted` is never emitted. Anything undecided or unreleased collapses
-- to `in_review`.

CREATE OR REPLACE FUNCTION public.my_festival_applications_all()
RETURNS TABLE(
  event_id            uuid,
  event_name          text,
  event_date          text,
  category_key        text,
  status              text,
  outcome_released_at timestamp with time zone,
  submitted_at        timestamp with time zone
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select
    a.event_id,
    e.name as event_name,
    -- ⭐⭐ A FESTIVAL'S DATE IS NOT IN `config`. Measured 2026-08-27: Echo
    -- Valley 2026 has `config->>'date'` = '' (EMPTY STRING, not null) while its
    -- real dates sit in `festival_event_settings` — starts_on 2026-11-12. A
    -- one-night gig carries its date on the event; a festival carries a RANGE
    -- on its settings row, and reading only the first would show a blank date
    -- on every festival application. ⛔ That is the permanent-dash failure the
    -- organiser's table just had, arriving on the applicant's side.
    --
    -- ⚠ NULLIF before COALESCE — '' is not NULL, so a bare coalesce would
    -- happily return the empty string and look like it worked.
    coalesce(nullif(fs.starts_on::text, ''), nullif(e.config->>'date', '')) as event_date,
    a.category_key,
    -- ⛔ THE MASK — identical to my_festival_applications. See the header.
    case
      when a.status in ('draft','submitted','withdrawn') then a.status
      when a.outcome_released_at is not null
           and a.status in ('accepted','declined')       then a.status
      else 'in_review'
    end as status,
    a.outcome_released_at,
    a.submitted_at
  from festival_applications a
  join profiles p on p.id = a.from_profile_id
  left join events e on e.id = a.event_id
  left join festival_event_settings fs on fs.event_id = a.event_id
  where p.user_id = auth.uid();
$$;

-- ⚠ A LEFT JOIN, deliberately. An application whose event was deleted is still
-- the applicant's own history, and dropping the row would make it vanish with
-- no explanation. The caller renders a null `event_name` honestly rather than
-- inventing one — see the rendering contract: Absent ≠ Unknown.

REVOKE ALL ON FUNCTION public.my_festival_applications_all() FROM PUBLIC;
GRANT ALL  ON FUNCTION public.my_festival_applications_all() TO anon;
GRANT ALL  ON FUNCTION public.my_festival_applications_all() TO authenticated;
GRANT ALL  ON FUNCTION public.my_festival_applications_all() TO service_role;

-- ⭐ `anon` is granted on purpose and is NOT a hole: the body filters on
-- `p.user_id = auth.uid()`, which is NULL for anon, so a signed-out caller
-- gets zero rows. Same grant shape as the event-scoped sibling; withholding it
-- would make the call ERROR rather than return [] before sign-in.
