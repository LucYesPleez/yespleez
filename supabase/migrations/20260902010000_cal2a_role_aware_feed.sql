-- CAL2A · the calendar feed becomes ROLE-AWARE.
--
-- ⛔⛔ NO NEW TABLES AND NO NEW COLUMNS. Phase 2A adds no schema at all: it
-- replaces one function so the existing feed can also answer the HOST, VENUE
-- and PUNTER/diary questions from data that already exists. The
-- `calendar_feeds` table, its token, its RLS and its category jsonb are
-- untouched — `categories` is schemaless, so role-scoped keys cost nothing.
--
-- ── WHAT IS ADDED TO THE PAYLOAD ──
--   profile_types  the role chips the account actually holds
--   diary          personal_events (the owner's own rows only)
--   hosting        events I own/host + their running order + acts I booked
--   venue_events   events at my venue + their running order
--   venue_bookings accepted enquiries for my venue
--
-- ⛔⛔ THE PRIVATE COLUMNS STAY OUT, AND THIS IS THE WHOLE SECURITY POINT.
-- `venue_enquiries.note` and `venue_enquiries.proposed_fee` are negotiation
-- material and appear in NO jsonb below, on either side of the enquiry.
-- Every row is scoped to profiles the token's user owns; a venue sees its own
-- pipeline and never another venue's, and a host never sees another host's.
--
-- ⚠ ROLE OWNERSHIP COMES FROM `profiles`, ⛔ NEVER FROM PARTICIPATION. Having
-- once played a gig does not make somebody an artist forever; holding an
-- artist profile does.

CREATE OR REPLACE FUNCTION public.calendar_feed_payload(feed_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  f              public.calendar_feeds%ROWTYPE;
  pids           uuid[];
  ptypes         text[];
  gig_event_ids  uuid[];
  host_event_ids uuid[];
  venue_event_ids uuid[];
  gigs           jsonb;
  att            jsonb;
  bookings       jsonb;
  deadlines      jsonb;
  diary          jsonb;
  hosting        jsonb;
  venue_events   jsonb;
  venue_bookings jsonb;
BEGIN
  SELECT * INTO f FROM public.calendar_feeds WHERE token = feed_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  IF NOT f.enabled THEN
    RETURN jsonb_build_object('found', true, 'enabled', false);
  END IF;

  SELECT COALESCE(array_agg(id), '{}'::uuid[]),
         COALESCE(array_agg(DISTINCT type), '{}'::text[])
    INTO pids, ptypes
    FROM public.profiles WHERE user_id = f.user_id;

  -- ── which events belong to which of my identities ────────────────
  SELECT COALESCE(array_agg(DISTINCT lm.event_id), '{}'::uuid[]) INTO gig_event_ids
    FROM public.lineup_members lm
   WHERE lm.status = 'on_bill'
     AND (lm.artist_profile_id = ANY(pids) OR lm.artist_id = f.user_id);

  -- ⚠ THREE WAYS TO OWN AN EVENT and all three count: the owner profile, the
  -- legacy host account, and the co-host join. ⛔ Reading only one of them is
  -- how 82 of 92 events once looked hostless.
  SELECT COALESCE(array_agg(DISTINCT e.id), '{}'::uuid[]) INTO host_event_ids
    FROM public.events e
   WHERE e.owner_profile_id = ANY(pids)
      OR e.host_id = f.user_id
      OR EXISTS (SELECT 1 FROM public.event_hosts eh
                  WHERE eh.event_id = e.id AND eh.profile_id = ANY(pids));

  SELECT COALESCE(array_agg(DISTINCT e.id), '{}'::uuid[]) INTO venue_event_ids
    FROM public.events e
   WHERE e.venue_profile_id = ANY(pids);

  -- ── the gig shape, reused for artist / host / venue ──────────────
  -- ⚠ `members`/`performances` are scoped to ME for a GIG (my own set), and
  -- to the WHOLE BILL for events I host or own the room for — on those the
  -- running order is mine to see. `slots`/`stages` are always whole-of-event
  -- because the midnight-rollover derivation needs every slot on the stage.
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
                WHERE m.event_id = e.id AND m.status = 'on_bill'),
    -- ⛔⛔ NO `booked` LIST. A host's "what have I committed to" was dropped:
    -- the acts on a bill are part of the night already carried by the
    -- hosting event and its running order, ⛔ not a separate appointment.
    -- ⚠ It also could never have worked — it read `venue_enquiries` joined by
    -- `event_id`, and NO accepted enquiry in production carries one.
    'performances', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', p.id, 'lineup_member_id', p.lineup_member_id, 'slot_uuid', p.slot_uuid,
                'status', p.status, 'updated_at', p.updated_at)), '[]'::jsonb)
                FROM public.performances p WHERE p.event_id = e.id)
  )), '[]'::jsonb) INTO hosting
  FROM public.events e WHERE e.id = ANY(host_event_ids);

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
                WHERE m.event_id = e.id AND m.status = 'on_bill'),
    'performances', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', p.id, 'lineup_member_id', p.lineup_member_id, 'slot_uuid', p.slot_uuid,
                'status', p.status, 'updated_at', p.updated_at)), '[]'::jsonb)
                FROM public.performances p WHERE p.event_id = e.id)
  )), '[]'::jsonb) INTO venue_events
  FROM public.events e WHERE e.id = ANY(venue_event_ids);

  -- ── the common categories ────────────────────────────────────────
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

  -- ⛔⛔ THE OWNER'S OWN ROWS ONLY. A diary entry is private free text; it
  -- reaches the feed of the account that wrote it and no other.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', pe.id, 'title', pe.title, 'event_date', pe.event_date,
    'time_start', pe.time_start, 'notes', pe.notes, 'created_at', pe.created_at
  )), '[]'::jsonb) INTO diary
  FROM public.personal_events pe WHERE pe.user_id = f.user_id;

  -- ── enquiries, both sides, private columns excluded ──────────────
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
                                  'proposed_time', v.proposed_time, 'set_duration', v.set_duration,
                                  'created_at', v.created_at),
    'venue', (SELECT jsonb_build_object('name', vp.name, 'suburb', vp.suburb, 'state', vp.state)
                FROM public.profiles vp WHERE vp.id = v.venue_profile_id)
  )), '[]'::jsonb) INTO venue_bookings
  FROM public.venue_enquiries v
  WHERE (v.venue_profile_id = ANY(pids) OR v.venue_user_id = f.user_id)
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
    'profile_types', to_jsonb(ptypes),
    'gigs', gigs,
    'attending', att,
    'bookings', bookings,
    'deadlines', deadlines,
    'diary', diary,
    'hosting', hosting,
    'venue_events', venue_events,
    'venue_bookings', venue_bookings
  );
END;
$$;

REVOKE ALL ON FUNCTION public.calendar_feed_payload(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calendar_feed_payload(uuid) TO anon, authenticated;
