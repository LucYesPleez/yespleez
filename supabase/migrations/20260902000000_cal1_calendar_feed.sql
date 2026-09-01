-- CAL1 · the YesPleez calendar subscription feed.
--
-- One row per USER (auth identity, never a profile — the same account-level
-- rule the notification preference tables follow):
--
--   token       the feed's capability secret. Calendar clients fetch bare
--               URLs with no headers, so knowing the URL IS the
--               authentication — Google Calendar's own "secret address"
--               model. uuid, unguessable, never derived from the user id.
--   enabled     the master switch. ⛔ Disabling flips this and touches
--               NOTHING else — the category choices must survive an
--               off-and-on-again.
--   categories  jsonb of per-category booleans; an ABSENT key means ON
--               (the house absence-means-default convention, no backfill).
--
-- RLS ships in the same migration as the table — a per-user table is never
-- created open and tightened later.

CREATE TABLE IF NOT EXISTS public.calendar_feeds (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token      uuid        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  enabled    boolean     NOT NULL DEFAULT false,
  categories jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.calendar_feeds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_feeds_select_own ON public.calendar_feeds;
CREATE POLICY calendar_feeds_select_own ON public.calendar_feeds
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS calendar_feeds_insert_own ON public.calendar_feeds;
CREATE POLICY calendar_feeds_insert_own ON public.calendar_feeds
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS calendar_feeds_update_own ON public.calendar_feeds;
CREATE POLICY calendar_feeds_update_own ON public.calendar_feeds
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS calendar_feeds_delete_own ON public.calendar_feeds;
CREATE POLICY calendar_feeds_delete_own ON public.calendar_feeds
  FOR DELETE USING (auth.uid() = user_id);

-- ── the feed's one read path ─────────────────────────────────────────
--
-- SECURITY DEFINER: the anon key on its own can read nothing from any of
-- these tables that RLS does not already allow; the token is the whole
-- capability and every row this returns is scoped to the token's user.
--
-- ⛔⛔ THE PRIVATE COLUMNS ARE NEVER SELECTED. venue_enquiries.note and
-- venue_enquiries.proposed_fee are negotiation material and do not appear
-- in any jsonb below. Lineup/performance rows are the FEED USER'S OWN ONLY;
-- other artists' booking states never leave the database. Slot/stage rows
-- are whole-of-event because the midnight-rollover derivation needs every
-- slot on a stage, and a slot row holds times and labels, not people.
--
-- Shapes mirror useEventData's selects so lib/calendarFeed.js can hand them
-- to resolveSchedule/indexPerformances unchanged.

CREATE OR REPLACE FUNCTION public.calendar_feed_payload(feed_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  f             public.calendar_feeds%ROWTYPE;
  pids          uuid[];
  gig_event_ids uuid[];
  gigs          jsonb;
  att           jsonb;
  bookings      jsonb;
  deadlines     jsonb;
BEGIN
  SELECT * INTO f FROM public.calendar_feeds WHERE token = feed_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  IF NOT f.enabled THEN
    -- Disabled is a real state the endpoint serves as an EMPTY calendar so
    -- subscribed clients clear their items. ⛔ Not the same as unknown.
    RETURN jsonb_build_object('found', true, 'enabled', false);
  END IF;

  SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO pids
    FROM public.profiles WHERE user_id = f.user_id;

  SELECT COALESCE(array_agg(DISTINCT lm.event_id), '{}'::uuid[]) INTO gig_event_ids
    FROM public.lineup_members lm
   WHERE lm.status = 'on_bill'
     AND (lm.artist_profile_id = ANY(pids) OR lm.artist_id = f.user_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'event', jsonb_build_object('id', e.id, 'name', e.name, 'config', e.config, 'updated_at', e.updated_at),
    'venue', (SELECT jsonb_build_object('id', vp.id, 'name', vp.name, 'location', vp.location,
                                        'suburb', vp.suburb, 'state', vp.state, 'postcode', vp.postcode,
                                        'lat', vp.lat, 'lng', vp.lng)
                FROM public.profiles vp WHERE vp.id = e.venue_profile_id),
    'slots', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', s.id, 'event_id', s.event_id, 'day_index', s.day_index, 'day_name', s.day_name,
                'position', s.position, 'time', s.time, 'ampm', s.ampm, 'dur_mins', s.dur_mins,
                'label', s.label, 'label_color', s.label_color, 'pinned', s.pinned, 'stage_id', s.stage_id)
                ORDER BY s.day_index, s.position), '[]'::jsonb)
                FROM public.event_slots s WHERE s.event_id = e.id),
    'stages', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', st.id, 'event_id', st.event_id, 'name', st.name,
                'position', st.position, 'accent', st.accent)
                ORDER BY st.position), '[]'::jsonb)
                FROM public.event_stages st WHERE st.event_id = e.id),
    'members', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', m.id, 'artist_id', m.artist_id, 'artist_profile_id', m.artist_profile_id,
                'artist_name', m.artist_name)), '[]'::jsonb)
                FROM public.lineup_members m
                WHERE m.event_id = e.id AND m.status = 'on_bill'
                  AND (m.artist_profile_id = ANY(pids) OR m.artist_id = f.user_id)),
    'performances', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', p.id, 'lineup_member_id', p.lineup_member_id, 'slot_uuid', p.slot_uuid,
                'status', p.status, 'updated_at', p.updated_at)), '[]'::jsonb)
                FROM public.performances p
                JOIN public.lineup_members m2 ON p.lineup_member_id = m2.id
                WHERE p.event_id = e.id
                  AND (m2.artist_profile_id = ANY(pids) OR m2.artist_id = f.user_id))
  )), '[]'::jsonb) INTO gigs
  FROM public.events e WHERE e.id = ANY(gig_event_ids);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'event', jsonb_build_object('id', e.id, 'name', e.name, 'config', e.config, 'updated_at', e.updated_at),
    'venue', (SELECT jsonb_build_object('id', vp.id, 'name', vp.name, 'location', vp.location,
                                        'suburb', vp.suburb, 'state', vp.state, 'postcode', vp.postcode,
                                        'lat', vp.lat, 'lng', vp.lng)
                FROM public.profiles vp WHERE vp.id = e.venue_profile_id)
  )), '[]'::jsonb) INTO att
  FROM public.follows fo
  JOIN public.events e ON e.id = fo.entity_id
  WHERE fo.user_id = f.user_id AND fo.entity_type = 'event';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'enquiry', jsonb_build_object('id', v.id, 'status', v.status, 'date_requested', v.date_requested,
                                  'respond_by', v.respond_by, 'event_id', v.event_id,
                                  'proposed_time', v.proposed_time, 'set_duration', v.set_duration,
                                  'created_at', v.created_at),
    'venue', (SELECT jsonb_build_object('name', vp.name, 'suburb', vp.suburb, 'state', vp.state)
                FROM public.profiles vp WHERE vp.id = v.venue_profile_id)
  )), '[]'::jsonb) INTO bookings
  FROM public.venue_enquiries v
  WHERE (v.applicant_profile_id = ANY(pids) OR v.applicant_user_id = f.user_id)
    AND lower(COALESCE(v.status, '')) IN ('booked', 'accepted');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'enquiry', jsonb_build_object('id', v.id, 'status', v.status, 'date_requested', v.date_requested,
                                  'respond_by', v.respond_by, 'event_id', v.event_id,
                                  'created_at', v.created_at),
    'venue', (SELECT jsonb_build_object('name', vp.name, 'suburb', vp.suburb, 'state', vp.state)
                FROM public.profiles vp WHERE vp.id = v.venue_profile_id)
  )), '[]'::jsonb) INTO deadlines
  FROM public.venue_enquiries v
  WHERE (v.applicant_profile_id = ANY(pids) OR v.applicant_user_id = f.user_id)
    AND v.respond_by IS NOT NULL
    AND lower(COALESCE(v.status, '')) NOT IN ('booked', 'accepted', 'declined', 'cancelled', 'withdrawn');

  RETURN jsonb_build_object(
    'found', true,
    'enabled', true,
    'categories', COALESCE(f.categories, '{}'::jsonb),
    'gigs', gigs,
    'attending', att,
    'bookings', bookings,
    'deadlines', deadlines
  );
END;
$$;

-- The RPC is the feed's whole public surface: callable with the anon key,
-- and useless without a valid token.
REVOKE ALL ON FUNCTION public.calendar_feed_payload(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calendar_feed_payload(uuid) TO anon, authenticated;
