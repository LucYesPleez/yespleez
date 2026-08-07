--
-- PostgreSQL database dump
--

\restrict 1kNGJigBKOvVJtcb7tlkpXEkl5TaUlMKyNiOZkf482vcKMLMZFgCW4gZlU9KiZi

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- ⚠ ADDED BY HAND, not produced by pg_dump.
--
-- `--schema=public` omits CREATE EXTENSION, but production has pg_trgm
-- installed INTO public — `placeholder_profiles_name_trgm` is a GIN index
-- using public.gin_trgm_ops and cannot be created without it. Without this
-- line the baseline fails at line ~3572 on a fresh database.
--
-- pgcrypto is NOT needed here: it is referenced as extensions.hmac(), and
-- Supabase pre-installs it in the `extensions` schema on every project.
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: apply_notification_channel(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_notification_channel() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_channel text;
begin
  if new.to_user_id is null then
    return new;                       -- held (N1): no recipient, no preference
  end if;
  if tg_op = 'UPDATE' and old.to_user_id is not null then
    return new;                       -- already delivered; not a delivery event
  end if;

  select channel into v_channel
    from public.notification_channel_prefs
   where user_id = new.to_user_id
     and type    = new.type;

  if v_channel is null then
    return new;                       -- absence means the column default
  end if;

  new.channel := v_channel;

  -- 'off' is expressed the way every other mute already is. Only ever SET,
  -- never cleared: clearing would un-mute something the category preference
  -- had already suppressed.
  if v_channel = 'off' and new.suppressed_at is null then
    new.suppressed_at := now();
  end if;

  return new;
end;
$$;


--
-- Name: apply_notification_preferences(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_notification_preferences() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_category text;
  v_enabled  boolean;
BEGIN
  IF NEW.to_user_id IS NULL THEN
    RETURN NEW;                       -- held (N1) — not delivered, nothing to suppress
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.to_user_id IS NOT NULL THEN
    RETURN NEW;                       -- already delivered; not a delivery event
  END IF;
  IF NEW.suppressed_at IS NOT NULL THEN
    RETURN NEW;                       -- an explicit caller decision is left alone
  END IF;

  SELECT category INTO v_category
    FROM public.notification_expiry_policy
   WHERE type = NEW.type;

  IF NOT public.notification_category_is_mutable(v_category) THEN
    RETURN NEW;                       -- payments / account / uncategorised: always deliver
  END IF;

  SELECT enabled INTO v_enabled
    FROM public.notification_preferences
   WHERE user_id = NEW.to_user_id
     AND category = v_category;

  -- Absence means enabled. Only an explicit `false` withholds delivery.
  IF v_enabled IS NOT NULL AND v_enabled = false THEN
    NEW.suppressed_at := now();
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION apply_notification_preferences(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.apply_notification_preferences() IS 'NP1 — stamps suppressed_at when the recipient has muted this notification''s category, at the moment to_user_id becomes non-NULL. Covers BOTH delivery paths: an ordinary insert and `N3` claim delivery. SECURITY DEFINER because the writer is usually not the recipient, and under RLS an invoker-rights read of the recipient''s preferences would silently return nothing.';


--
-- Name: approve_profile_claim(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_profile_claim(p_request_id bigint) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  req public.profile_claim_requests%ROWTYPE;
  target_type text;
BEGIN
  SELECT * INTO req FROM public.profile_claim_requests
   WHERE id = p_request_id FOR UPDATE;
  IF req.id IS NULL THEN
    RAISE EXCEPTION 'approve_profile_claim: no request %', p_request_id;
  END IF;
  IF req.status <> 'pending' THEN
    RAISE EXCEPTION 'approve_profile_claim: request % is already %', p_request_id, req.status;
  END IF;

  SELECT type INTO target_type FROM public.profiles
   WHERE id = req.profile_id AND user_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_profile_claim: profile % already has an owner', req.profile_id;
  END IF;

  -- One profile per (user_id, type). If the claimant already owns this type,
  -- this is a duplicate to MERGE, not a fresh claim — refuse legibly.
  IF EXISTS (
    SELECT 1 FROM public.profiles owned
     WHERE owned.user_id = req.user_id AND owned.type = target_type
  ) THEN
    RAISE EXCEPTION
      'approve_profile_claim: account % already owns a % profile — this is a DUPLICATE to merge, not a fresh claim (merge is not built yet)',
      req.user_id, target_type;
  END IF;

  UPDATE public.profiles
     SET user_id      = req.user_id,
         claim_status = 'claimed',
         claimed_at   = now(),
         claimed_via  = 'in_app_claim'
   WHERE id = req.profile_id;

  UPDATE public.profile_claim_requests
     SET status = 'approved', decided_at = now()
   WHERE id = req.id;

  UPDATE public.profile_claim_requests
     SET status = 'rejected', decided_at = now(),
         decision_note = 'Profile was claimed by another account.'
   WHERE profile_id = req.profile_id AND status = 'pending' AND id <> req.id;
END;
$$;


--
-- Name: can_act_as(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_act_as(profile_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = profile_id
      AND p.user_id IS NOT NULL
      AND p.user_id = auth.uid()
  );
$$;


--
-- Name: FUNCTION can_act_as(profile_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.can_act_as(profile_id uuid) IS 'Identity v1.1 §A4 — the sole ownership predicate. Signature frozen; body may evolve (V1 single-owner). Returns false for NULL, unclaimed profiles, and unauthenticated callers.';


--
-- Name: can_write_to_conversation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_write_to_conversation(p_conversation_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.conversations c
     WHERE c.id = p_conversation_id
       AND c.status = 'active'
  )
  AND public.is_conversation_participant(p_conversation_id);
$$;


--
-- Name: FUNCTION can_write_to_conversation(p_conversation_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.can_write_to_conversation(p_conversation_id uuid) IS 'Communication Architecture 4.4 / 2.6 — participation AND status = active.';


--
-- Name: conversation_participant_key(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.conversation_participant_key(p_conversation_id uuid) RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT COALESCE(
    md5(string_agg(profile_id::text, ',' ORDER BY profile_id::text)),
    ''
  )
  FROM public.conversation_participants
  WHERE conversation_id = p_conversation_id;
$$;


--
-- Name: conversation_receipts(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.conversation_receipts(p_conversation_id uuid) RETURNS TABLE(delivered_at timestamp with time zone, seen_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
  SELECT max(crs.last_delivered_at),
         max(NULLIF(crs.last_read_at, '-infinity'::timestamptz))
    FROM public.conversation_read_state crs
   WHERE crs.conversation_id = p_conversation_id
     AND crs.user_id <> auth.uid()
     AND public.is_conversation_participant(p_conversation_id);
$$;


--
-- Name: conversation_seen_watermark(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.conversation_seen_watermark(p_conversation_id uuid) RETURNS timestamp with time zone
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
  SELECT max(crs.last_read_at)
    FROM public.conversation_read_state crs
   WHERE crs.conversation_id = p_conversation_id
     AND crs.user_id <> auth.uid()
     AND public.is_conversation_participant(p_conversation_id);
$$;


--
-- Name: FUNCTION conversation_seen_watermark(p_conversation_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.conversation_seen_watermark(p_conversation_id uuid) IS 'Latest moment any OTHER participant read this conversation, or NULL. Aggregate by design: amends 2.5 to allow receipts without exposing which human read it inside a shared profile. Never widen this to return rows.';


--
-- Name: conversation_unread_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.conversation_unread_count(p_conversation_id uuid) RETURNS integer
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT count(*)::integer
    FROM public.messages m
    LEFT JOIN public.conversation_read_state rs
           ON rs.conversation_id = m.conversation_id
          AND rs.user_id         = auth.uid()
   WHERE m.conversation_id = p_conversation_id
     AND m.from_user_id IS DISTINCT FROM auth.uid()
     AND m.created_at > COALESCE(rs.last_read_at, '-infinity'::timestamptz);
$$;


--
-- Name: delete_contact_codes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_contact_codes() RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare uid uuid := auth.uid(); n bigint;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  delete from public.contact_codes where owner_user_id = uid;
  get diagnostics n = row_count;
  update public.contact_sync_state set last_synced_at = null where user_id = uid;
  return n;
end;
$$;


--
-- Name: deliver_held_notifications(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deliver_held_notifications(p_profile_id uuid, p_user_id uuid) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE delivered integer;
BEGIN
  IF p_profile_id IS NULL OR p_user_id IS NULL THEN RETURN 0; END IF;
  PERFORM public.expire_held_notifications(p_profile_id);
  UPDATE public.notifications
     SET to_user_id = p_user_id
   WHERE to_profile_id = p_profile_id
     AND to_user_id IS NULL
     AND expired_at IS NULL;
  GET DIAGNOSTICS delivered = ROW_COUNT;
  RETURN delivered;
END;
$$;


--
-- Name: FUNCTION deliver_held_notifications(p_profile_id uuid, p_user_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.deliver_held_notifications(p_profile_id uuid, p_user_id uuid) IS 'Phase 13.2 `N3` — deliver every LIVE held notification for a profile to its new owner by populating to_user_id. Skips rows expired under `N4`. Idempotent; read/created_at untouched, so a claimant sees the notices unread and dated when they actually happened.';


--
-- Name: direct_context_id(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.direct_context_id(p_a uuid, p_b uuid) RETURNS uuid
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT md5(
    CASE WHEN p_a::text < p_b::text
      THEN p_a::text || ':' || p_b::text
      ELSE p_b::text || ':' || p_a::text
    END
  )::uuid;
$$;


--
-- Name: enforce_phone_key_rate_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_phone_key_rate_limit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  last_change timestamptz;
begin
  select max(changed_at) into last_change
    from public.phone_key_changes
   where user_id = new.user_id;

  -- The first claim is always free; only subsequent ones are limited.
  if last_change is not null and last_change > now() - interval '30 days' then
    raise exception
      'phone key changed too recently; next change allowed after %',
      last_change + interval '30 days'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;


--
-- Name: ensure_personal_profile(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_personal_profile() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (user_id, type, name, email)
  VALUES (
    NEW.id,
    'punter',
    COALESCE(
      NULLIF(btrim(NEW.raw_user_meta_data ->> 'name'), ''),
      NULLIF(split_part(NEW.email, '@', 1), ''),
      ''
    ),
    NEW.email
  )
  ON CONFLICT (user_id, type) DO NOTHING;

  RETURN NEW;
END;
$$;


--
-- Name: event_end_date(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.event_end_date(p_event_id uuid) RETURNS date
    LANGUAGE sql STABLE
    AS $$
  SELECT public.safe_date(e.config->>'date')
       + GREATEST(COALESCE(jsonb_array_length(
           CASE WHEN jsonb_typeof(e.config->'days') = 'array'
                THEN e.config->'days' END), 1) - 1, 0)
  FROM public.events e
  WHERE e.id = p_event_id;
$$;


--
-- Name: FUNCTION event_end_date(p_event_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.event_end_date(p_event_id uuid) IS 'Phase 13.2 `N4` — the last day an event is actionable. Derived: config->>''date'' plus (length of config->''days'' - 1), because events have no end-date column and day objects carry no dates. NULL when the date is missing or unparseable.';


--
-- Name: expire_held_notifications(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expire_held_notifications(p_profile_id uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE expired integer;
BEGIN
  UPDATE public.notifications n
     SET expired_at = now()
   WHERE n.to_user_id IS NULL
     AND n.expired_at IS NULL
     AND (p_profile_id IS NULL OR n.to_profile_id = p_profile_id)
     AND public.held_notification_is_stale(n.type, n.data);
  GET DIAGNOSTICS expired = ROW_COUNT;
  RETURN expired;
END;
$$;


--
-- Name: find_by_phone(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_by_phone(p_e164 text[]) RETURNS TABLE(input_index integer, profile_id uuid, display_name text, avatar text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_catalog'
    AS $_$
declare
  uid      uuid := auth.uid();
  v_pepper text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if array_length(p_e164, 1) is null or array_length(p_e164, 1) > 2000 then
    raise exception 'between 1 and 2000 numbers per lookup'
      using errcode = 'invalid_parameter_value';
  end if;

  v_pepper := public.phone_key_pepper();

  return query
    select n.idx::int, pr.id, pr.name, coalesce(pr.avatar_thumb, pr.avatar)
      from unnest(p_e164) with ordinality as n(e164, idx)
      join public.phone_keys pk
        on pk.key_hmac = extensions.hmac(n.e164, v_pepper, 'sha256')
      join public.profiles pr
        on pr.user_id = pk.user_id and pr.type = 'punter'
     where n.e164 ~ '^\+[1-9][0-9]{6,14}$'
       and pk.discoverable_from <= now()
       and pk.user_id          <> uid
       and public.phone_key_discoverable_by(pk.user_id, uid);
end;
$_$;


--
-- Name: held_notification_counts(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.held_notification_counts(p_profile_id uuid) RETURNS TABLE(live bigint, stale bigint, total bigint)
    LANGUAGE sql STABLE
    AS $$
  SELECT
    count(*) FILTER (WHERE NOT judged.is_stale)::bigint,
    count(*) FILTER (WHERE judged.is_stale)::bigint,
    count(*)::bigint
  FROM (
    SELECT (n.expired_at IS NOT NULL)
        OR public.held_notification_is_stale(n.type, n.data) AS is_stale
      FROM public.notifications n
     WHERE n.to_profile_id = p_profile_id AND n.to_user_id IS NULL
  ) AS judged;
$$;


--
-- Name: held_notification_is_stale(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.held_notification_is_stale(p_type text, p_data jsonb) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.notification_expiry_policy p
     WHERE p.type = p_type
       AND (
            (p.policy = 'event'
               AND public.event_end_date((p_data->>'event_id')::uuid) IS NOT NULL
               AND public.event_end_date((p_data->>'event_id')::uuid) < current_date)
         OR (p.policy = 'enquiry'
               AND public.safe_bigint(p_data->>'enquiry_id') IS NOT NULL
               AND EXISTS (
                     SELECT 1 FROM public.venue_enquiries ve
                      WHERE ve.id = public.safe_bigint(p_data->>'enquiry_id')
                        AND public.safe_date(ve.date_requested::text) IS NOT NULL
                        AND public.safe_date(ve.date_requested::text) < current_date))
           )
  );
$$;


--
-- Name: is_conversation_participant(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_conversation_participant(p_conversation_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.conversation_participants cp
     WHERE cp.conversation_id = p_conversation_id
       AND public.can_act_as(cp.profile_id)
  );
$$;


--
-- Name: FUNCTION is_conversation_participant(p_conversation_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_conversation_participant(p_conversation_id uuid) IS 'Communication Architecture 2.2 — true when the caller can act as any participant profile of this conversation. SECURITY DEFINER to avoid 42P17 recursion. Consults can_act_as only.';


--
-- Name: is_event_main_host(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_event_main_host(_event_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ SELECT EXISTS (SELECT 1 FROM public.events e LEFT JOIN public.profiles p ON p.id = e.owner_profile_id WHERE e.id = _event_id AND (p.user_id = auth.uid() OR e.host_id = auth.uid())) $$;


--
-- Name: mark_conversation_delivered(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_conversation_delivered(p_conversation_id uuid) RETURNS timestamp with time zone
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'mark_conversation_delivered: no authenticated user'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.conversation_read_state (conversation_id, user_id, last_read_at, last_delivered_at)
       VALUES (p_conversation_id, v_uid, '-infinity', v_now)
  ON CONFLICT (conversation_id, user_id) DO UPDATE
     SET last_delivered_at = GREATEST(
           COALESCE(public.conversation_read_state.last_delivered_at, '-infinity'::timestamptz),
           EXCLUDED.last_delivered_at)
   RETURNING last_delivered_at INTO v_now;

  RETURN v_now;
END;
$$;


--
-- Name: mark_conversation_read(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_conversation_read(p_conversation_id uuid) RETURNS timestamp with time zone
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'mark_conversation_read: no authenticated user'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.conversation_read_state (conversation_id, user_id, last_read_at)
  VALUES (p_conversation_id, auth.uid(), v_now)
  ON CONFLICT (conversation_id, user_id) DO UPDATE
    SET last_read_at = GREATEST(public.conversation_read_state.last_read_at, EXCLUDED.last_read_at);

  RETURN v_now;
END;
$$;


--
-- Name: message_conversation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.message_conversation(p_message_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT m.conversation_id FROM public.messages m WHERE m.id = p_message_id;
$$;


--
-- Name: my_contact_sync(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_contact_sync() RETURNS TABLE(enabled boolean, last_synced_at timestamp with time zone, code_count bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
  select coalesce(st.enabled, false),
         st.last_synced_at,
         (select count(*) from public.contact_codes cc where cc.owner_user_id = auth.uid())
    from (select 1) _
    left join public.contact_sync_state st on st.user_id = auth.uid();
$$;


--
-- Name: my_festival_applications(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_festival_applications(p_event_id uuid) RETURNS TABLE(category_key text, status text, outcome_released_at timestamp with time zone, submitted_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    a.category_key,
    -- ⛔ The mask. Shortlisted is NEVER exposed — organisers see the workflow,
    -- applicants see the outcome — and a decision stays "in_review" until it
    -- is released. The database, not the UI, is what enforces this.
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
  where a.event_id = p_event_id
    and p.user_id = auth.uid();
$$;


--
-- Name: my_phone_key(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_phone_key() RETURNS TABLE(has_key boolean, last3 text, visibility text, discoverable_from timestamp with time zone, next_change_allowed timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  return query
    select pk.user_id is not null,
           pk.last3,
           pk.visibility,
           pk.discoverable_from,
           (select max(c.changed_at) + interval '30 days'
              from public.phone_key_changes c
             where c.user_id = uid)
      from public.phone_keys pk
     where pk.user_id = uid;

  -- No row means no key. Say so explicitly rather than returning nothing,
  -- so the client can tell "not set" from "call failed".
  if not found then
    return query select false, null::text, null::text, null::timestamptz, null::timestamptz;
  end if;
end;
$$;


--
-- Name: notification_category_is_mutable(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notification_category_is_mutable(p_category text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT p_category IS NOT NULL
     AND p_category NOT IN ('payments', 'account');
$$;


--
-- Name: FUNCTION notification_category_is_mutable(p_category text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.notification_category_is_mutable(p_category text) IS 'NP1 — payments and account always deliver, per the owner 2026-07-20. A NULL category (an uncategorised type) is also treated as un-mutable, so an unclassified type is delivered rather than silently withheld.';


--
-- Name: notify_contact_joins(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_contact_joins() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
begin
  with eligible as (
    select cc.owner_user_id as recipient,
           cc.id            as contact_code_id,
           pr.id            as joiner_profile_id
      from public.contact_codes cc
      join public.contact_sync_state st
        on st.user_id = cc.owner_user_id
       and st.enabled                                   -- spec: sync must be on
      join public.profiles pr
        on pr.user_id = new.user_id
       and pr.type    = 'punter'                        -- the Messenger identity
     where cc.code_hmac      = new.key_hmac             -- they have this number saved
       and cc.owner_user_id <> new.user_id              -- never notify yourself
       -- Both privacy settings respected in one call: the joiner's
       -- discoverability decides whether this recipient may learn of them.
       and public.phone_key_discoverable_by(new.user_id, cc.owner_user_id)
       and not exists (
             select 1 from public.contact_join_notified j
              where j.recipient_user_id = cc.owner_user_id
                and j.joiner_user_id    = new.user_id)
  ),
  written as (
    insert into public.notifications
           (to_user_id, about_profile_id, type, message, data, read)
    select e.recipient,
           e.joiner_profile_id,
           'contact_joined',
           -- ⚠ THE FALLBACK, NOT THE FINAL TEXT. The client replaces this
           -- with "Sarah from your contacts joined YesPleez" when it can
           -- resolve the name locally. The server has no name to put here
           -- and must never be given one.
           'Someone from your contacts joined YesPleez.',
           jsonb_build_object('contact_code_id', e.contact_code_id),
           false
      from eligible e
    returning 1
  )
  insert into public.contact_join_notified (recipient_user_id, joiner_user_id)
  select e.recipient, new.user_id from eligible e
  on conflict do nothing;

  return new;
end;
$$;


--
-- Name: notify_new_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_new_message() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_recipient_profile uuid;
  v_actor             uuid;
  v_actor_count       integer;
BEGIN
  FOR v_recipient_profile IN
    SELECT cp.profile_id
      FROM public.conversation_participants cp
     WHERE cp.conversation_id = NEW.conversation_id
       AND cp.profile_id <> NEW.from_profile_id
  LOOP
    v_actor_count := 0;

    FOR v_actor IN
      SELECT a FROM public.profile_actors(v_recipient_profile) AS a
    LOOP
      v_actor_count := v_actor_count + 1;

      IF v_actor IS DISTINCT FROM NEW.from_user_id THEN
        INSERT INTO public.notifications
          (to_user_id, to_profile_id, about_profile_id, type, message, data, read)
        VALUES (
          v_actor, v_recipient_profile, NEW.from_profile_id,
          'new_message', 'New message',
          jsonb_build_object('conversation_id', NEW.conversation_id,
                             'message_id', NEW.id),
          false
        );
      END IF;
    END LOOP;

    IF v_actor_count = 0 THEN
      INSERT INTO public.notifications
        (to_user_id, to_profile_id, about_profile_id, type, message, data, read)
      VALUES (
        NULL, v_recipient_profile, NEW.from_profile_id,
        'new_message', 'New message',
        jsonb_build_object('conversation_id', NEW.conversation_id,
                           'message_id', NEW.id),
        false
      );
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;


--
-- Name: on_profile_claimed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.on_profile_claimed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM public.deliver_held_notifications(NEW.id, NEW.user_id);
  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION on_profile_claimed(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.on_profile_claimed() IS 'Phase 13.2 `N3` — the canonical claim.completed event. Fires when profiles.user_id transitions NULL → NOT NULL, which is where a claim actually completes (manually in the SQL editor today; a claim UI later). Deliberately bound to the transition rather than to any caller, so no future claim path has to remember to trigger delivery.';


--
-- Name: open_conversation(text, uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.open_conversation(p_context_type text, p_context_id uuid, p_participant_ids uuid[]) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_participants    uuid[];
  v_participant_key text;
  v_conversation_id uuid;
  v_authorised      boolean;
BEGIN
  IF p_context_type IS NULL OR p_context_id IS NULL THEN
    RAISE EXCEPTION 'open_conversation: context_type and context_id are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT pid)
    INTO v_participants
    FROM unnest(COALESCE(p_participant_ids, '{}'::uuid[])) AS pid
   WHERE pid IS NOT NULL;

  IF v_participants IS NULL OR cardinality(v_participants) = 0 THEN
    RAISE EXCEPTION 'open_conversation: at least one participant profile is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM unnest(v_participants) AS pid
     WHERE public.can_act_as(pid)
  ) INTO v_authorised;

  IF NOT v_authorised THEN
    RAISE EXCEPTION 'open_conversation: caller cannot act as any participant profile. Conversation creation derives from participant authority, not from authentication or visibility.'
      USING ERRCODE = '42501';
  END IF;

  SELECT md5(string_agg(pid::text, ',' ORDER BY pid::text))
    INTO v_participant_key
    FROM unnest(v_participants) AS pid;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_context_type || ':' || p_context_id::text || ':' || v_participant_key)
  );

  SELECT c.id
    INTO v_conversation_id
    FROM public.conversations c
   WHERE c.context_type    = p_context_type
     AND c.context_id      = p_context_id
     AND c.participant_key = v_participant_key;

  IF v_conversation_id IS NOT NULL THEN
    RETURN v_conversation_id;
  END IF;

  INSERT INTO public.conversations (context_type, context_id)
  VALUES (p_context_type, p_context_id)
  RETURNING id INTO v_conversation_id;

  INSERT INTO public.conversation_participants (conversation_id, profile_id)
  SELECT v_conversation_id, pid
    FROM unnest(v_participants) AS pid;

  RETURN v_conversation_id;
END;
$$;


--
-- Name: FUNCTION open_conversation(p_context_type text, p_context_id uuid, p_participant_ids uuid[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.open_conversation(p_context_type text, p_context_id uuid, p_participant_ids uuid[]) IS 'Communication Architecture v1.0 4.3 - the ONLY sanctioned way to create a conversation. SECURITY DEFINER because M8b grants no client INSERT. STRICT caller rule: the caller must be able to can_act_as at least one participant profile. Idempotent per C15.';


--
-- Name: open_direct_conversation(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.open_direct_conversation(p_from_profile_id uuid, p_to_profile_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_context uuid;
BEGIN
  IF p_from_profile_id IS NULL OR p_to_profile_id IS NULL THEN
    RAISE EXCEPTION 'open_direct_conversation: both profiles are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_from_profile_id = p_to_profile_id THEN
    RAISE EXCEPTION 'open_direct_conversation: cannot open a conversation with yourself'
      USING ERRCODE = '22023';
  END IF;

  v_context := public.direct_context_id(p_from_profile_id, p_to_profile_id);

  RETURN public.open_conversation('direct', v_context,
                                  ARRAY[p_from_profile_id, p_to_profile_id]);
END;
$$;


--
-- Name: owns_festival_event(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.owns_festival_event(p_event_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from events e
    join profiles p on p.id = e.owner_profile_id
    where e.id = p_event_id and p.user_id = auth.uid()
  );
$$;


--
-- Name: phone_key_discoverable_by(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.phone_key_discoverable_by(p_owner uuid, p_viewer uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
  select case pk.visibility
           when 'everyone' then true
           when 'contacts' then exists (
             select 1
               from public.contact_codes cc
               join public.phone_keys vk on vk.user_id = p_viewer
              where cc.owner_user_id = p_owner
                and cc.code_hmac     = vk.key_hmac
           )
           else false                       -- 'nobody'
         end
    from public.phone_keys pk
   where pk.user_id = p_owner;
$$;


--
-- Name: phone_key_hash(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.phone_key_hash(p_e164 text) RETURNS bytea
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_catalog'
    AS $_$
begin
  if p_e164 !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'number must be E.164 normalised by the client'
      using errcode = 'invalid_parameter_value';
  end if;

  return extensions.hmac(p_e164, public.phone_key_pepper(), 'sha256');
end;
$_$;


--
-- Name: phone_key_pepper(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.phone_key_pepper() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'vault', 'pg_catalog'
    AS $$
declare
  s text;
begin
  select decrypted_secret into s
    from vault.decrypted_secrets
   where name = 'phone_key_pepper';

  if s is null or length(s) = 0 then
    raise exception
      'phone_key_pepper missing from Vault — phone discovery is not configured';
  end if;

  return s;
end;
$$;


--
-- Name: profile_actors(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.profile_actors(p_profile_id uuid) RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT p.user_id
    FROM public.profiles p
   WHERE p.id = p_profile_id
     AND p.user_id IS NOT NULL;
$$;


--
-- Name: reject_context_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_context_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.context_type IS DISTINCT FROM OLD.context_type
     OR NEW.context_id IS DISTINCT FROM OLD.context_id THEN
    RAISE EXCEPTION 'C13: a conversation context is immutable (% % -> % %). Context records the origin, not the present — use subject_state, or create a new conversation (2.1).',
      OLD.context_type, OLD.context_id, NEW.context_type, NEW.context_id;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: reject_profile_claim(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_profile_claim(p_request_id bigint, p_note text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  req public.profile_claim_requests%ROWTYPE;
  remaining integer;
BEGIN
  SELECT * INTO req FROM public.profile_claim_requests
   WHERE id = p_request_id FOR UPDATE;
  IF req.id IS NULL THEN
    RAISE EXCEPTION 'reject_profile_claim: no request %', p_request_id;
  END IF;
  IF req.status <> 'pending' THEN
    RAISE EXCEPTION 'reject_profile_claim: request % is already %', p_request_id, req.status;
  END IF;

  UPDATE public.profile_claim_requests
     SET status = 'rejected', decided_at = now(), decision_note = p_note
   WHERE id = req.id;

  SELECT count(*) INTO remaining FROM public.profile_claim_requests
   WHERE profile_id = req.profile_id AND status = 'pending';
  IF remaining = 0 THEN
    UPDATE public.profiles
       SET claim_status = 'unclaimed'
     WHERE id = req.profile_id AND user_id IS NULL;
  END IF;
END;
$$;


--
-- Name: remove_phone_key(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.remove_phone_key() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  delete from public.phone_keys where user_id = uid;

  insert into public.phone_key_changes (user_id, action) values (uid, 'remove');
end;
$$;


--
-- Name: safe_bigint(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.safe_bigint(txt text) RETURNS bigint
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  IF txt IS NULL OR btrim(txt) = '' THEN RETURN NULL; END IF;
  RETURN txt::bigint;
EXCEPTION WHEN others THEN RETURN NULL;
END;
$$;


--
-- Name: safe_date(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.safe_date(txt text) RETURNS date
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  IF txt IS NULL OR btrim(txt) = '' THEN
    RETURN NULL;
  END IF;
  RETURN txt::date;
EXCEPTION WHEN others THEN
  RETURN NULL;              -- unparseable ⇒ unknown date ⇒ never expires
END;
$$;


--
-- Name: FUNCTION safe_date(txt text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.safe_date(txt text) IS 'Parse text to date, returning NULL instead of raising. Used because event dates live in JSONB free text and malformed values exist; an unknown date must mean "cannot expire this", never "abort the run".';


--
-- Name: safe_uuid(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.safe_uuid(txt text) RETURNS uuid
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  IF txt IS NULL OR btrim(txt) = '' THEN RETURN NULL; END IF;
  RETURN txt::uuid;
EXCEPTION WHEN others THEN RETURN NULL;
END;
$$;


--
-- Name: FUNCTION safe_uuid(txt text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.safe_uuid(txt text) IS 'Parse text to uuid, returning NULL instead of raising. Used by storage policies, where the object path is untrusted input and a raise would surface as a 500 rather than a refusal. Mirrors safe_date (N4).';


--
-- Name: set_contact_sync(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_contact_sync(p_enabled boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  insert into public.contact_sync_state (user_id, enabled)
       values (uid, p_enabled)
  on conflict (user_id) do update set enabled = p_enabled;
end;
$$;


--
-- Name: set_phone_key(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_phone_key(p_e164 text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  uid      uuid := auth.uid();
  h        bytea;
  existed  boolean;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  h := public.phone_key_hash(p_e164);
  select exists (select 1 from public.phone_keys where user_id = uid) into existed;

  insert into public.phone_keys as pk (user_id, key_hmac, last3)
       values (uid, h, right(p_e164, 3))
  on conflict (user_id) do update
          set key_hmac          = excluded.key_hmac,
              last3             = excluded.last3,
              created_at        = now(),
              discoverable_from = now()      -- was now() + 24h
        where pk.key_hmac is distinct from excluded.key_hmac;

  insert into public.phone_key_changes (user_id, action)
       values (uid, case when existed then 'change' else 'add' end);
end;
$$;


--
-- Name: set_phone_visibility(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_phone_visibility(p_visibility text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  update public.phone_keys
     set visibility = p_visibility
   where user_id = uid;
end;
$$;


--
-- Name: set_profile_claim_pending(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_profile_claim_pending() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.profiles
     SET claim_status = 'pending'
   WHERE id = NEW.profile_id
     AND user_id IS NULL;
  RETURN NEW;
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: sync_contacts(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_contacts(p_e164 text[]) RETURNS TABLE(input_index integer, contact_code_id bigint, profile_id uuid, display_name text, avatar text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_catalog'
    AS $_$
declare
  uid      uuid := auth.uid();
  v_pepper text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if array_length(p_e164, 1) is null or array_length(p_e164, 1) > 2000 then
    raise exception 'between 1 and 2000 numbers per sync'
      using errcode = 'invalid_parameter_value';
  end if;

  v_pepper := public.phone_key_pepper();

  insert into public.contact_codes (owner_user_id, code_hmac)
  select uid, extensions.hmac(n.e164, v_pepper, 'sha256')
    from unnest(p_e164) with ordinality as n(e164, idx)
   where n.e164 ~ '^\+[1-9][0-9]{6,14}$'
  on conflict (owner_user_id, code_hmac) do nothing;

  insert into public.contact_sync_state (user_id, enabled, last_synced_at)
       values (uid, true, now())
  on conflict (user_id) do update
          set enabled = true, last_synced_at = now();

  return query
    select n.idx::int,
           cc.id,
           pr.id,
           pr.name,
           coalesce(pr.avatar_thumb, pr.avatar)
      from unnest(p_e164) with ordinality as n(e164, idx)
      join public.contact_codes cc
        on cc.owner_user_id = uid
       and cc.code_hmac     = extensions.hmac(n.e164, v_pepper, 'sha256')
      left join public.phone_keys pk
        on pk.key_hmac          = cc.code_hmac
       and pk.user_id          <> uid
       and pk.discoverable_from <= now()
       and public.phone_key_discoverable_by(pk.user_id, uid)
      left join public.profiles pr
        on pr.user_id = pk.user_id
       and pr.type    = 'punter'
     where n.e164 ~ '^\+[1-9][0-9]{6,14}$';
end;
$_$;


--
-- Name: sync_conversation_participant_key(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_conversation_participant_key() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_conversation_id uuid := COALESCE(NEW.conversation_id, OLD.conversation_id);
BEGIN
  UPDATE public.conversations
     SET participant_key = public.conversation_participant_key(v_conversation_id)
   WHERE id = v_conversation_id;
  RETURN NULL;
END;
$$;


--
-- Name: sync_profile_email(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_profile_email() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  SELECT email INTO NEW.email
  FROM auth.users
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;


--
-- Name: total_unread_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.total_unread_count() RETURNS integer
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT count(*)::integer
    FROM public.messages m
    LEFT JOIN public.conversation_read_state rs
           ON rs.conversation_id = m.conversation_id
          AND rs.user_id         = auth.uid()
   WHERE m.from_user_id IS DISTINCT FROM auth.uid()
     AND m.created_at > COALESCE(rs.last_read_at, '-infinity'::timestamptz);
$$;


--
-- Name: total_unread_count_for(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.total_unread_count_for(p_user_id uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT count(*)::integer
    FROM public.messages m
    LEFT JOIN public.conversation_read_state rs
           ON rs.conversation_id = m.conversation_id
          AND rs.user_id         = p_user_id
   WHERE m.from_user_id IS DISTINCT FROM p_user_id
     AND m.created_at > COALESCE(rs.last_read_at, '-infinity'::timestamptz);
$$;


--
-- Name: FUNCTION total_unread_count_for(p_user_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.total_unread_count_for(p_user_id uuid) IS 'MP5b — total_unread_count() §5.6, parameterised for server-to-server use (the push-notify edge function has no auth.uid() of its own). Mirrors the same rule exactly so the OS app-icon badge, set from the service worker, can never disagree with what the in-app Messages badge computes.';


--
-- Name: touch_conversation_last_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_conversation_last_message() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.conversations
     SET last_message_at = NEW.created_at
   WHERE id = NEW.conversation_id;
  RETURN NULL;
END;
$$;


--
-- Name: FUNCTION touch_conversation_last_message(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.touch_conversation_last_message() IS 'Maintains conversations.last_message_at (2.7) so a list sorts without joining messages. SECURITY DEFINER because conversations has no UPDATE policy by design.';


--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;


--
-- Name: trigger_push_notify(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trigger_push_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault', 'pg_temp'
    AS $$
DECLARE
  v_key text;
  v_url text := 'https://doqzxvppibuzieajqkxm.supabase.co/functions/v1/push-notify';
BEGIN
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'push_notify_service_key';

  IF v_key IS NULL THEN
    RAISE WARNING 'trigger_push_notify: push_notify_service_key not found in Vault — push not sent for notification %', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object(
      'type',   'INSERT',
      'table',  'notifications',
      'schema', 'public',
      'record', row_to_json(NEW)
    ),
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION trigger_push_notify(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.trigger_push_notify() IS 'MP4b — fires the push-notify edge function on every notifications INSERT via pg_net, reading the calling credential from Vault (push_notify_service_key) rather than from this function''s own text, so the service_role key is never committed to the repository. Fire-and-forget by design.';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    type text DEFAULT 'artist'::text NOT NULL,
    dj_name text,
    name text,
    location text,
    state text,
    bio text,
    tagline text,
    age text,
    age_private boolean DEFAULT false,
    experience text,
    tech_setup text,
    fee_type text,
    fee text,
    fee_plus_travel boolean DEFAULT false,
    fee_negotiable boolean DEFAULT false,
    genre_string text,
    mix_link text,
    soundcloud text,
    mixcloud text,
    instagram text,
    youtube text,
    facebook text,
    website text,
    email text,
    avatar text,
    years text,
    updated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    label text DEFAULT ''::text,
    card_pills text DEFAULT ''::text,
    sound text,
    emergency_name text,
    emergency_phone text,
    emergency_rel text,
    fee_local boolean,
    lat double precision,
    lng double precision,
    postcode text,
    suburb text,
    tiktok text,
    contact_email text,
    epk_link text,
    video_link text,
    spotify text,
    vibe_tags text,
    fee_travel boolean DEFAULT false,
    band_type text,
    member_count integer,
    established_year integer,
    venue_type text,
    stage_dims text,
    tech_features text,
    live_nights text,
    act_type text,
    set_length integer,
    has_abn boolean DEFAULT false,
    abn text,
    gst_registered boolean DEFAULT false,
    capacity integer,
    fee_max integer,
    avatar_hero text,
    avatar_thumb text,
    atmosphere text,
    perfect_for text,
    is_live boolean DEFAULT true,
    claim_status text DEFAULT 'claimed'::text NOT NULL,
    claimed_at timestamp with time zone,
    claimed_via text,
    created_via text,
    source jsonb,
    onboarding_seen_at timestamp with time zone,
    phone text,
    accessibility text,
    country text,
    links jsonb,
    external_ref text,
    scene_radius_km smallint
);


--
-- Name: COLUMN profiles.scene_radius_km; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.scene_radius_km IS 'My Scene floor radius pref. NULL = never set (app default 50). 0 = Anywhere (no cap) - the app maps 0 to no-filter; never fed to geo directly.';


--
-- Name: accounts_with_email; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.accounts_with_email AS
 SELECT u.id AS user_id,
    u.email,
    u.created_at AS signed_up_at,
    p.type AS profile_type,
    p.name AS profile_name,
    p.updated_at AS profile_updated_at
   FROM (auth.users u
     LEFT JOIN public.profiles p ON ((p.user_id = u.id)))
  ORDER BY u.created_at DESC;


--
-- Name: applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid,
    artist_id uuid,
    note text,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    guest_name text,
    guest_email text,
    guest_genre text,
    guest_sound text,
    guest_mix_link text,
    applicant_name text,
    from_profile_id uuid,
    requirements_snapshot jsonb
);


--
-- Name: COLUMN applications.requirements_snapshot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.applications.requirements_snapshot IS 'P5 (Requirements Engine, 2026-08) — the evaluation VERDICT at submission: {v, evaluated_at, required_items[], items[{key,state}], satisfied, total}. Built only by snapshotEvaluation() in v2/src/lib/requirements.js. Stores the decision, never profile values. `required_items` is duplicated here on purpose so a host editing their checklist later cannot rewrite what an applicant was asked. NULL = no requirements declared, or the row predates P5; render nothing, not 0/0.';


--
-- Name: approval_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    code text NOT NULL,
    slot_ids text[],
    artist_id uuid,
    application_id uuid,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: artist_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artist_availability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    available_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    profile_id uuid
);


--
-- Name: band_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.band_availability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    available_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: beta_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beta_feedback (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    area text NOT NULL,
    severity text,
    description text NOT NULL,
    attachment_paths text[] DEFAULT '{}'::text[] NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    CONSTRAINT beta_feedback_severity_check CHECK ((severity = ANY (ARRAY['BLOCKER'::text, 'MAJOR'::text, 'MINOR'::text, 'IMPROVEMENT'::text]))),
    CONSTRAINT beta_feedback_status_check CHECK ((status = ANY (ARRAY['new'::text, 'investigating'::text, 'fixed'::text, 'closed'::text]))),
    CONSTRAINT beta_feedback_type_check CHECK ((type = ANY (ARRAY['BUG'::text, 'SUGGESTION'::text, 'LOVE'::text, 'QUESTION'::text])))
);


--
-- Name: beta_feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.beta_feedback ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.beta_feedback_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claims (
    id text DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    genre text,
    notes text,
    updated_at timestamp without time zone DEFAULT now(),
    event_id uuid,
    slot_id text,
    backups jsonb DEFAULT '[]'::jsonb,
    user_id uuid,
    card_pills text DEFAULT ''::text,
    sound text,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: contact_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_codes (
    id bigint NOT NULL,
    owner_user_id uuid NOT NULL,
    code_hmac bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contact_codes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contact_codes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contact_codes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contact_codes_id_seq OWNED BY public.contact_codes.id;


--
-- Name: contact_join_notified; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_join_notified (
    recipient_user_id uuid NOT NULL,
    joiner_user_id uuid NOT NULL,
    notified_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contact_sync_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_sync_state (
    user_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    last_synced_at timestamp with time zone
);


--
-- Name: conversation_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_participants (
    conversation_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE conversation_participants; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.conversation_participants IS 'The participant source of truth. Participants are PROFILES (Identity v1.1 A5), never accounts. The set is FIXED at creation (2.1). READ STATE MUST NOT BE ADDED HERE: C11 keys it (conversation, user), because two humans can act as one profile.';


--
-- Name: COLUMN conversation_participants.archived_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.conversation_participants.archived_at IS '2.6 — hides the conversation from THIS participant list only. Never global.';


--
-- Name: conversation_read_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_read_state (
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    last_read_at timestamp with time zone DEFAULT now() NOT NULL,
    last_delivered_at timestamp with time zone
);


--
-- Name: COLUMN conversation_read_state.last_delivered_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.conversation_read_state.last_delivered_at IS 'Everything created at or before this instant has REACHED this human''s device.';


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    context_type text NOT NULL,
    context_id uuid NOT NULL,
    subject_state text,
    status text DEFAULT 'active'::text NOT NULL,
    participant_key text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_message_at timestamp with time zone,
    CONSTRAINT conversations_context_type_valid CHECK ((context_type = ANY (ARRAY['application'::text, 'invitation'::text, 'booking'::text, 'event'::text, 'venue'::text, 'direct'::text]))),
    CONSTRAINT conversations_status_valid CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text, 'restricted'::text])))
);


--
-- Name: TABLE conversations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.conversations IS 'Communication Architecture v1.0 §2.1. A durable, ordered sequence of messages between a FIXED set of profiles about a FIXED subject. Participants belong to profiles (Identity v1.1 §A5), never accounts.';


--
-- Name: COLUMN conversations.context_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.conversations.context_type IS 'C13/C14 — the workflow act that caused this conversation. IMMUTABLE: it records the origin, not the present. Constrained to the five derived contexts.';


--
-- Name: COLUMN conversations.subject_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.conversations.subject_state IS 'C14 — what has become of the subject since. Changes freely; the context does not. Display only, never consulted for permission.';


--
-- Name: COLUMN conversations.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.conversations.status IS '2.6 — active / closed / restricted. `archived` is NOT here: it is per-participant, because a global archive would let one party hide the thread from the other.';


--
-- Name: event_hosts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_hosts (
    event_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    "position" smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    host_id uuid,
    name text NOT NULL,
    status text DEFAULT 'draft'::text,
    config jsonb,
    host_controls jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    applications_open boolean DEFAULT false,
    is_public boolean DEFAULT true,
    postcode text,
    lat numeric,
    lng numeric,
    venue_profile_id uuid,
    owner_profile_id uuid,
    external_ref text,
    required_items text[]
);


--
-- Name: COLUMN events.required_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.events.required_items IS 'P4 (Requirements Engine, 2026-08) — requirement keys the host ticked, from REQUESTABLE_KEYS in v2/src/lib/requirements.js. NULL and ''{}'' both mean no declared requirements. Deliberately unconstrained: the engine treats an unrecognised key as non-blocking and surfaces it, whereas a CHECK would reject the host''s entire save.';


--
-- Name: festival_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.festival_applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    category_key text NOT NULL,
    from_profile_id uuid NOT NULL,
    status text DEFAULT 'submitted'::text NOT NULL,
    stage text,
    submitted_at timestamp with time zone DEFAULT now(),
    decided_at timestamp with time zone,
    outcome_released_at timestamp with time zone,
    answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT festival_applications_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'in_review'::text, 'shortlisted'::text, 'accepted'::text, 'declined'::text, 'withdrawn'::text])))
);


--
-- Name: festival_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.festival_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    key text NOT NULL,
    state text DEFAULT 'closed'::text NOT NULL,
    opens_at date,
    closes_at date,
    decision_mode text DEFAULT 'hold'::text NOT NULL,
    intent text DEFAULT 'open_call'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT festival_categories_decision_mode_check CHECK ((decision_mode = ANY (ARRAY['hold'::text, 'immediate'::text]))),
    CONSTRAINT festival_categories_intent_check CHECK ((intent = ANY (ARRAY['open_call'::text, 'register_interest'::text]))),
    CONSTRAINT festival_categories_state_check CHECK ((state = ANY (ARRAY['open'::text, 'scheduled'::text, 'closed'::text, 'paused'::text])))
);


--
-- Name: festival_departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.festival_departments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    sort_order integer DEFAULT 0 NOT NULL,
    archived boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: festival_event_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.festival_event_settings (
    event_id uuid NOT NULL,
    build_starts_on date,
    build_ends_on date,
    starts_on date,
    ends_on date,
    packdown_starts_on date,
    packdown_ends_on date,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived boolean DEFAULT false NOT NULL
);


--
-- Name: follows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.follows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    entity_name text,
    created_at timestamp with time zone DEFAULT now(),
    target_profile_id uuid,
    from_profile_id uuid,
    CONSTRAINT follows_entity_type_check CHECK ((entity_type = ANY (ARRAY['artist'::text, 'venue'::text, 'host'::text, 'band'::text, 'standup'::text, 'event'::text])))
);


--
-- Name: gigs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gigs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    artist_id uuid DEFAULT gen_random_uuid(),
    event_name text,
    venue text,
    date text,
    poster_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lineup_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lineup_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    artist_id uuid,
    artist_name text,
    genre text,
    sound text,
    card_pills jsonb DEFAULT '[]'::jsonb,
    role text DEFAULT 'performer'::text NOT NULL,
    source text DEFAULT 'direct'::text NOT NULL,
    status text DEFAULT 'on_bill'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    artist_profile_id uuid
);


--
-- Name: message_originals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_originals (
    object_path text NOT NULL,
    conversation_id uuid NOT NULL,
    message_id uuid,
    bytes bigint NOT NULL,
    width integer,
    height integer,
    mime text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT message_originals_bytes_check CHECK ((bytes > 0))
);


--
-- Name: message_participant_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_participant_state (
    message_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    from_user_id uuid NOT NULL,
    handed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reaction text,
    CONSTRAINT mps_reaction_valid CHECK (((reaction IS NULL) OR (reaction = ANY (ARRAY['salute'::text, 'joycat'::text, 'woozy'::text, 'flushed'::text, 'clouds'::text, 'facepalm'::text, 'nails'::text]))))
);


--
-- Name: COLUMN message_participant_state.reaction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.message_participant_state.reaction IS 'MR1 — the participant''s single emoji reaction to this message, as a stable key ("clouds"), never the glyph. NULL means no reaction, which is distinct from handed_at being NULL (no Yes): the two are independent facts and a row may carry either, both, or — briefly, before cleanup — neither. One active reaction per person per message is enforced by the primary key.';


--
-- Name: CONSTRAINT mps_reaction_valid ON message_participant_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT mps_reaction_valid ON public.message_participant_state IS 'MR1 — must mirror REACTIONS in v2/src/lib/reactions.js. Adding a reaction means adding it in BOTH places, in the same commit; the client would otherwise offer a button whose write the database rejects.';


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    from_profile_id uuid NOT NULL,
    from_user_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text DEFAULT 'text'::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    client_id text,
    CONSTRAINT messages_body_not_blank CHECK ((btrim(body) <> ''::text)),
    CONSTRAINT messages_kind_valid CHECK ((kind = ANY (ARRAY['text'::text, 'voice'::text, 'image'::text, 'video'::text, 'file'::text, 'location'::text, 'hand'::text, 'event'::text, 'application'::text, 'booking'::text, 'approval'::text, 'system'::text])))
);


--
-- Name: TABLE messages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.messages IS 'Communication Architecture v1.0 2. IMMUTABLE in v1 (D9 default) — no edited_at, no deleted_at, no UPDATE policy. 2.4 right to remove one own contribution is deferred, not denied; implementing it is additive.';


--
-- Name: COLUMN messages.from_profile_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.messages.from_profile_id IS 'Identity v1.1 A3 — ATTRIBUTION. The profile that spoke. This is what displays as the author.';


--
-- Name: COLUMN messages.from_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.messages.from_user_id IS 'Identity v1.1 A3 — the HUMAN who acted. For audit and delivery. NEVER displayed as the actor, never consulted for permission (A4: can_act_as is the sole ownership predicate).';


--
-- Name: COLUMN messages.kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.messages.kind IS 'What this message IS. Renderers dispatch on it. Defaults to text so every existing row is correct without a backfill, and so a client that does not set it keeps working.';


--
-- Name: COLUMN messages.payload; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.messages.payload IS 'Kind-specific structure — storage path and duration for voice, an event id for an event card. NOT validated per kind by design: a per-kind CHECK would need rewriting on every addition. The renderer owns its payload shape. This is conversation CONTENT and is subject to C32 exactly as body is.';


--
-- Name: notification_channel_prefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_channel_prefs (
    user_id uuid NOT NULL,
    type text NOT NULL,
    channel text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_channel_prefs_channel_check CHECK ((channel = ANY (ARRAY['push'::text, 'in_app'::text, 'off'::text])))
);


--
-- Name: notification_expiry_policy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_expiry_policy (
    type text NOT NULL,
    policy text NOT NULL,
    note text,
    category text,
    CONSTRAINT notification_expiry_policy_policy_check CHECK ((policy = ANY (ARRAY['never'::text, 'event'::text, 'enquiry'::text])))
);


--
-- Name: TABLE notification_expiry_policy; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notification_expiry_policy IS 'Per-type notification registry. `policy` is the Phase 13.2 `N4` expiry rule (never / event / enquiry). `category` is the NP1 preference grouping — the unit a user mutes. A type absent from this table is never expired and, having no category, is never suppressed: both defaults fail toward delivery, which is the recoverable direction.';


--
-- Name: COLUMN notification_expiry_policy.category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notification_expiry_policy.category IS 'NP1 preference grouping: bookings / events / social / payments / messages / account. NULL means the type predates categorisation and is always delivered.';


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    user_id uuid NOT NULL,
    category text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE notification_preferences; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notification_preferences IS 'NP1 — per-USER delivery preferences, one row per muted category. Absence of a row means ENABLED, so no backfill is required and a new type is on by default. Per-user rather than per-profile because Identity v1.2 `U4` leaves to_profile_id NULL whenever it cannot be uniquely inferred, which would make a per-profile preference unenforceable for exactly those rows. Governs DELIVERY only — nothing here can prevent a notification being written.';


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    to_user_id uuid,
    type text DEFAULT 'general'::text NOT NULL,
    from_id uuid,
    event_id uuid,
    slot_id text,
    message text,
    status text DEFAULT 'pending'::text,
    read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    slot_label text,
    event_name text,
    from_uid uuid,
    from_name text,
    data jsonb,
    about_profile_id uuid,
    to_profile_id uuid,
    expired_at timestamp with time zone,
    suppressed_at timestamp with time zone,
    channel text DEFAULT 'push'::text NOT NULL,
    dismissed_at timestamp with time zone,
    responded_at timestamp with time zone,
    CONSTRAINT notifications_addressable CHECK (((to_user_id IS NOT NULL) OR (to_profile_id IS NOT NULL))),
    CONSTRAINT notifications_channel_check CHECK ((channel = ANY (ARRAY['push'::text, 'in_app'::text, 'off'::text])))
);


--
-- Name: COLUMN notifications.to_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications.to_user_id IS 'Identity v1.1 §A7 — DELIVERY: the human with the device. NULL means HELD (Phase 13.2 `N1`): the notification is addressed to to_profile_id, an unclaimed profile with no owner yet. It is created and retained, never suppressed, and becomes deliverable when the profile is claimed (`N3`) by populating this column. Readers MUST filter on this column so held rows stay invisible.';


--
-- Name: COLUMN notifications.expired_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications.expired_at IS 'Phase 13.2 `N4` — when this HELD notification stopped being worth delivering. NULL means live. Only ever set on rows with to_user_id IS NULL; delivered notifications are governed by retention, not expiry. The row is retained deliberately: `N1` treats a held notification as an asset and a suppressed one as a deleted fact, and the held pile is the claim pitch.';


--
-- Name: COLUMN notifications.suppressed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications.suppressed_at IS 'NP1 — when delivery was withheld because the recipient had muted this category. NULL means deliverable. The row is retained: preferences govern delivery, never existence. Readers MUST require this to be NULL, alongside to_user_id, or muted notifications reappear in the feed.';


--
-- Name: COLUMN notifications.dismissed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications.dismissed_at IS 'When the recipient removed this from their inbox. NULL = visible. The row is never deleted: see SEC-6a and N1 — a dismissed notification is hidden, not a deleted fact.';


--
-- Name: COLUMN notifications.responded_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications.responded_at IS 'When the recipient answered an actionable notification. NULL = still awaiting a response, and the row shows its ACCEPT/DECLINE buttons. Stamped by markResponded() AFTER the underlying action commits, so a failure here re-offers the buttons rather than losing the action.';


--
-- Name: CONSTRAINT notifications_addressable ON notifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT notifications_addressable ON public.notifications IS 'Every notification must be addressable: a delivery identity (to_user_id) or a recipient profile (to_profile_id), or both. Deliberately an OR — requiring to_profile_id would break Identity v1.2 `U4`, under which a delivered row correctly has a NULL to_profile_id when the destination profile is not uniquely inferable.';


--
-- Name: performances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.performances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lineup_member_id uuid NOT NULL,
    event_id uuid NOT NULL,
    slot_id text,
    status text DEFAULT 'offered'::text NOT NULL,
    offered_at timestamp with time zone DEFAULT now(),
    accepted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: personal_event_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.personal_event_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    personal_event_id uuid NOT NULL,
    invitee_id uuid NOT NULL,
    invitee_name text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: personal_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.personal_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    event_date date NOT NULL,
    time_start text,
    notes text,
    is_private boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: phone_key_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.phone_key_changes (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    action text NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT phone_key_changes_action_check CHECK ((action = ANY (ARRAY['add'::text, 'change'::text, 'remove'::text])))
);


--
-- Name: phone_key_changes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.phone_key_changes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: phone_key_changes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.phone_key_changes_id_seq OWNED BY public.phone_key_changes.id;


--
-- Name: phone_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.phone_keys (
    user_id uuid NOT NULL,
    key_hmac bytea NOT NULL,
    visibility text DEFAULT 'everyone'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    discoverable_from timestamp with time zone DEFAULT now() NOT NULL,
    last3 text,
    CONSTRAINT phone_keys_visibility_check CHECK ((visibility = ANY (ARRAY['everyone'::text, 'contacts'::text, 'nobody'::text])))
);


--
-- Name: placeholder_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.placeholder_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type text NOT NULL,
    name text NOT NULL,
    bio text,
    genre_string text,
    sound text,
    avatar_url text,
    location text,
    state text,
    website text,
    social_links jsonb DEFAULT '{}'::jsonb NOT NULL,
    source text,
    source_name text,
    source_url text,
    claim_status text DEFAULT 'unclaimed'::text NOT NULL,
    claimed boolean DEFAULT false NOT NULL,
    claimed_at timestamp with time zone,
    claimed_via text,
    owner_user_id uuid,
    claimed_by uuid,
    merged_to uuid,
    duplicate_of uuid,
    is_duplicate boolean DEFAULT false NOT NULL,
    blocklisted boolean DEFAULT false NOT NULL,
    removed_at timestamp with time zone,
    removal_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT placeholder_profiles_claim_status_check CHECK ((claim_status = ANY (ARRAY['unclaimed'::text, 'pending'::text, 'claimed'::text, 'rejected'::text]))),
    CONSTRAINT placeholder_profiles_type_check CHECK ((type = ANY (ARRAY['artist'::text, 'band'::text, 'standup'::text, 'venue'::text, 'host'::text])))
);


--
-- Name: profile_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    asset_type text NOT NULL,
    storage_path text NOT NULL,
    file_name text NOT NULL,
    mime_type text NOT NULL,
    byte_size bigint NOT NULL,
    label text,
    valid_until date,
    is_current boolean DEFAULT true NOT NULL,
    superseded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profile_claim_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile_claim_requests (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    profile_id uuid NOT NULL,
    user_id uuid NOT NULL,
    relationship text NOT NULL,
    evidence text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    decided_at timestamp with time zone,
    decision_note text,
    CONSTRAINT profile_claim_requests_evidence_check CHECK ((btrim(evidence) <> ''::text)),
    CONSTRAINT profile_claim_requests_relationship_check CHECK ((relationship = ANY (ARRAY['owner'::text, 'manager'::text, 'member'::text, 'representative'::text]))),
    CONSTRAINT profile_claim_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: profile_claim_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.profile_claim_requests ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.profile_claim_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE push_subscriptions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.push_subscriptions IS 'MP1 — one row per subscribed device. endpoint is unique across ALL users (a browser push endpoint is globally unique by construction), so upsert-on-conflict(endpoint) is how a device re-subscribes without creating a duplicate row.';


--
-- Name: shortlist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shortlist (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id text NOT NULL,
    artist_id uuid NOT NULL,
    added_by uuid,
    note text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: slot_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slot_offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slot_id text,
    event_id text,
    slot_label text,
    event_name text,
    offered_to_email text NOT NULL,
    offered_to_name text,
    offered_to_uid uuid,
    offered_by_uid uuid,
    offered_by_name text,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    offer_type text DEFAULT 'slot'::text
);


--
-- Name: standup_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.standup_availability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    available_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: unclaimed_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unclaimed_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    sound text DEFAULT ''::text,
    bio text DEFAULT ''::text,
    genre_string text DEFAULT ''::text,
    card_pills text DEFAULT ''::text,
    mix_link text DEFAULT ''::text,
    claim_email text DEFAULT ''::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: usage_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_events (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    device_id uuid NOT NULL,
    user_id uuid,
    name text NOT NULL,
    display_mode text NOT NULL,
    platform text NOT NULL,
    browser text,
    app_version text,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    session_id uuid,
    CONSTRAINT usage_events_display_mode_check CHECK ((display_mode = ANY (ARRAY['standalone'::text, 'browser'::text, 'minimal-ui'::text, 'fullscreen'::text, 'twa'::text, 'unknown'::text]))),
    CONSTRAINT usage_events_name_check CHECK ((name = ANY (ARRAY['opened_app'::text, 'signed_up'::text, 'install_prompt_shown'::text, 'install_prompt_accepted'::text, 'install_prompt_dismissed'::text, 'installed_pwa'::text, 'created_event'::text, 'published_event'::text, 'applied'::text, 'sent_message'::text, 'sent_voicey'::text, 'followed'::text, 'shared'::text, 'screen_view'::text, 'session_end'::text, 'error'::text, 'filtered'::text]))),
    CONSTRAINT usage_events_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text, 'desktop'::text, 'other'::text])))
);


--
-- Name: COLUMN usage_events.session_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usage_events.session_id IS 'A2 — groups events into one visit. Minted client-side per session and reset after the same 30-minute idle window that governs opened_app, so a session here means the same thing it means there. NULL on rows written before A2. Identifies a VISIT, never a person.';


--
-- Name: usage_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.usage_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.usage_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: venue_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venue_availability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    available_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    profile_id uuid
);


--
-- Name: venue_enquiries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venue_enquiries (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    venue_user_id uuid NOT NULL,
    applicant_user_id uuid NOT NULL,
    applicant_type text DEFAULT 'artist'::text NOT NULL,
    date_requested date NOT NULL,
    note text,
    status text DEFAULT 'pending'::text NOT NULL,
    venue_profile_id uuid,
    applicant_profile_id uuid,
    headliner text,
    slot_role text,
    set_duration integer,
    extras text[],
    respond_by date,
    event_id uuid,
    proposed_time time without time zone,
    proposed_fee text,
    initiated_by text DEFAULT 'applicant'::text NOT NULL,
    CONSTRAINT venue_enquiries_initiated_by_check CHECK ((initiated_by = ANY (ARRAY['venue'::text, 'applicant'::text])))
);


--
-- Name: venue_enquiries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.venue_enquiries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: venue_enquiries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.venue_enquiries_id_seq OWNED BY public.venue_enquiries.id;


--
-- Name: contact_codes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_codes ALTER COLUMN id SET DEFAULT nextval('public.contact_codes_id_seq'::regclass);


--
-- Name: phone_key_changes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_key_changes ALTER COLUMN id SET DEFAULT nextval('public.phone_key_changes_id_seq'::regclass);


--
-- Name: venue_enquiries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_enquiries ALTER COLUMN id SET DEFAULT nextval('public.venue_enquiries_id_seq'::regclass);


--
-- Name: applications applications_event_id_artist_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_event_id_artist_id_key UNIQUE (event_id, artist_id);


--
-- Name: applications applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_pkey PRIMARY KEY (id);


--
-- Name: approval_codes approval_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_codes
    ADD CONSTRAINT approval_codes_pkey PRIMARY KEY (id);


--
-- Name: artist_availability artist_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_availability
    ADD CONSTRAINT artist_availability_pkey PRIMARY KEY (id);


--
-- Name: band_availability band_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.band_availability
    ADD CONSTRAINT band_availability_pkey PRIMARY KEY (id);


--
-- Name: band_availability band_availability_user_id_available_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.band_availability
    ADD CONSTRAINT band_availability_user_id_available_date_key UNIQUE (user_id, available_date);


--
-- Name: beta_feedback beta_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beta_feedback
    ADD CONSTRAINT beta_feedback_pkey PRIMARY KEY (id);


--
-- Name: claims claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims
    ADD CONSTRAINT claims_pkey PRIMARY KEY (id);


--
-- Name: contact_codes contact_codes_owner_user_id_code_hmac_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_codes
    ADD CONSTRAINT contact_codes_owner_user_id_code_hmac_key UNIQUE (owner_user_id, code_hmac);


--
-- Name: contact_codes contact_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_codes
    ADD CONSTRAINT contact_codes_pkey PRIMARY KEY (id);


--
-- Name: contact_join_notified contact_join_notified_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_join_notified
    ADD CONSTRAINT contact_join_notified_pkey PRIMARY KEY (recipient_user_id, joiner_user_id);


--
-- Name: contact_sync_state contact_sync_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_sync_state
    ADD CONSTRAINT contact_sync_state_pkey PRIMARY KEY (user_id);


--
-- Name: conversation_participants conversation_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_participants
    ADD CONSTRAINT conversation_participants_pkey PRIMARY KEY (conversation_id, profile_id);


--
-- Name: conversation_read_state conversation_read_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_read_state
    ADD CONSTRAINT conversation_read_state_pkey PRIMARY KEY (conversation_id, user_id);


--
-- Name: conversations conversations_c15_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_c15_unique UNIQUE (context_type, context_id, participant_key) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: event_hosts event_hosts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_hosts
    ADD CONSTRAINT event_hosts_pkey PRIMARY KEY (event_id, profile_id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: festival_applications festival_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.festival_applications
    ADD CONSTRAINT festival_applications_pkey PRIMARY KEY (id);


--
-- Name: festival_categories festival_categories_event_id_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.festival_categories
    ADD CONSTRAINT festival_categories_event_id_key_key UNIQUE (event_id, key);


--
-- Name: festival_categories festival_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.festival_categories
    ADD CONSTRAINT festival_categories_pkey PRIMARY KEY (id);


--
-- Name: festival_departments festival_departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.festival_departments
    ADD CONSTRAINT festival_departments_pkey PRIMARY KEY (id);


--
-- Name: festival_event_settings festival_event_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.festival_event_settings
    ADD CONSTRAINT festival_event_settings_pkey PRIMARY KEY (event_id);


--
-- Name: follows follows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_pkey PRIMARY KEY (id);


--
-- Name: follows follows_user_id_entity_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_user_id_entity_id_key UNIQUE (user_id, entity_id);


--
-- Name: gigs gigs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gigs
    ADD CONSTRAINT gigs_pkey PRIMARY KEY (id);


--
-- Name: lineup_members lineup_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lineup_members
    ADD CONSTRAINT lineup_members_pkey PRIMARY KEY (id);


--
-- Name: message_originals message_originals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_originals
    ADD CONSTRAINT message_originals_pkey PRIMARY KEY (object_path);


--
-- Name: message_participant_state message_participant_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_participant_state
    ADD CONSTRAINT message_participant_state_pkey PRIMARY KEY (message_id, profile_id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: notification_channel_prefs notification_channel_prefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_channel_prefs
    ADD CONSTRAINT notification_channel_prefs_pkey PRIMARY KEY (user_id, type);


--
-- Name: notification_expiry_policy notification_expiry_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_expiry_policy
    ADD CONSTRAINT notification_expiry_policy_pkey PRIMARY KEY (type);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id, category);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: performances performances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.performances
    ADD CONSTRAINT performances_pkey PRIMARY KEY (id);


--
-- Name: personal_event_invites personal_event_invites_personal_event_id_invitee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_event_invites
    ADD CONSTRAINT personal_event_invites_personal_event_id_invitee_id_key UNIQUE (personal_event_id, invitee_id);


--
-- Name: personal_event_invites personal_event_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_event_invites
    ADD CONSTRAINT personal_event_invites_pkey PRIMARY KEY (id);


--
-- Name: personal_events personal_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_events
    ADD CONSTRAINT personal_events_pkey PRIMARY KEY (id);


--
-- Name: phone_key_changes phone_key_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_key_changes
    ADD CONSTRAINT phone_key_changes_pkey PRIMARY KEY (id);


--
-- Name: phone_keys phone_keys_key_hmac_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_keys
    ADD CONSTRAINT phone_keys_key_hmac_key UNIQUE (key_hmac);


--
-- Name: phone_keys phone_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_keys
    ADD CONSTRAINT phone_keys_pkey PRIMARY KEY (user_id);


--
-- Name: placeholder_profiles placeholder_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.placeholder_profiles
    ADD CONSTRAINT placeholder_profiles_pkey PRIMARY KEY (id);


--
-- Name: profile_assets profile_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_assets
    ADD CONSTRAINT profile_assets_pkey PRIMARY KEY (id);


--
-- Name: profile_assets profile_assets_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_assets
    ADD CONSTRAINT profile_assets_storage_path_key UNIQUE (storage_path);


--
-- Name: profile_claim_requests profile_claim_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_claim_requests
    ADD CONSTRAINT profile_claim_requests_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_user_type_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_type_unique UNIQUE (user_id, type);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: shortlist shortlist_event_id_artist_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shortlist
    ADD CONSTRAINT shortlist_event_id_artist_id_key UNIQUE (event_id, artist_id);


--
-- Name: shortlist shortlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shortlist
    ADD CONSTRAINT shortlist_pkey PRIMARY KEY (id);


--
-- Name: slot_offers slot_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_offers
    ADD CONSTRAINT slot_offers_pkey PRIMARY KEY (id);


--
-- Name: standup_availability standup_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.standup_availability
    ADD CONSTRAINT standup_availability_pkey PRIMARY KEY (id);


--
-- Name: standup_availability standup_availability_user_id_available_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.standup_availability
    ADD CONSTRAINT standup_availability_user_id_available_date_key UNIQUE (user_id, available_date);


--
-- Name: unclaimed_profiles unclaimed_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unclaimed_profiles
    ADD CONSTRAINT unclaimed_profiles_pkey PRIMARY KEY (id);


--
-- Name: usage_events usage_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_events
    ADD CONSTRAINT usage_events_pkey PRIMARY KEY (id);


--
-- Name: venue_availability venue_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_availability
    ADD CONSTRAINT venue_availability_pkey PRIMARY KEY (id);


--
-- Name: venue_availability venue_availability_user_id_available_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_availability
    ADD CONSTRAINT venue_availability_user_id_available_date_key UNIQUE (user_id, available_date);


--
-- Name: venue_enquiries venue_enquiries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_enquiries
    ADD CONSTRAINT venue_enquiries_pkey PRIMARY KEY (id);


--
-- Name: venue_enquiries venue_enquiries_venue_user_id_applicant_user_id_date_reques_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_enquiries
    ADD CONSTRAINT venue_enquiries_venue_user_id_applicant_user_id_date_reques_key UNIQUE (venue_user_id, applicant_user_id, date_requested);


--
-- Name: artist_availability_profile_date_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX artist_availability_profile_date_key ON public.artist_availability USING btree (profile_id, available_date) WHERE (profile_id IS NOT NULL);


--
-- Name: beta_feedback_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beta_feedback_status_created_idx ON public.beta_feedback USING btree (status, created_at DESC);


--
-- Name: contact_codes_by_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contact_codes_by_code ON public.contact_codes USING btree (code_hmac);


--
-- Name: festival_applications_event_cat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX festival_applications_event_cat_idx ON public.festival_applications USING btree (event_id, category_key);


--
-- Name: festival_applications_from_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX festival_applications_from_idx ON public.festival_applications USING btree (from_profile_id);


--
-- Name: festival_applications_one_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX festival_applications_one_active_idx ON public.festival_applications USING btree (event_id, category_key, from_profile_id) WHERE (status <> 'withdrawn'::text);


--
-- Name: festival_departments_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX festival_departments_event_idx ON public.festival_departments USING btree (event_id, sort_order);


--
-- Name: idx_applications_from_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_applications_from_profile ON public.applications USING btree (from_profile_id);


--
-- Name: idx_conversation_participants_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversation_participants_profile ON public.conversation_participants USING btree (profile_id);


--
-- Name: idx_conversation_read_state_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversation_read_state_user ON public.conversation_read_state USING btree (user_id);


--
-- Name: idx_conversations_context; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_context ON public.conversations USING btree (context_type, context_id);


--
-- Name: idx_conversations_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_recent ON public.conversations USING btree (last_message_at DESC NULLS LAST);


--
-- Name: idx_event_hosts_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_hosts_event ON public.event_hosts USING btree (event_id);


--
-- Name: idx_event_hosts_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_hosts_profile ON public.event_hosts USING btree (profile_id);


--
-- Name: idx_events_config_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_config_date ON public.events USING btree (((config ->> 'date'::text)));


--
-- Name: idx_events_external_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_events_external_ref ON public.events USING btree (external_ref) WHERE (external_ref IS NOT NULL);


--
-- Name: idx_events_host_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_host_id ON public.events USING btree (host_id);


--
-- Name: idx_events_id_config; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_id_config ON public.events USING btree (id);


--
-- Name: idx_events_owner_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_owner_profile ON public.events USING btree (owner_profile_id);


--
-- Name: idx_events_venue_profile_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_venue_profile_id ON public.events USING btree (venue_profile_id);


--
-- Name: idx_follows_from_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_follows_from_profile ON public.follows USING btree (from_profile_id);


--
-- Name: idx_follows_target_profile_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_follows_target_profile_id ON public.follows USING btree (target_profile_id);


--
-- Name: idx_lineup_members_artist_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lineup_members_artist_id ON public.lineup_members USING btree (artist_id);


--
-- Name: idx_lineup_members_artist_profile_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lineup_members_artist_profile_id ON public.lineup_members USING btree (artist_profile_id);


--
-- Name: idx_lineup_members_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lineup_members_event_id ON public.lineup_members USING btree (event_id);


--
-- Name: idx_messages_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conversation ON public.messages USING btree (conversation_id, created_at);


--
-- Name: idx_notifications_about_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_about_profile ON public.notifications USING btree (about_profile_id);


--
-- Name: idx_notifications_deliverable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_deliverable ON public.notifications USING btree (to_user_id) WHERE (suppressed_at IS NULL);


--
-- Name: idx_notifications_held_by_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_held_by_profile ON public.notifications USING btree (to_profile_id) WHERE (to_user_id IS NULL);


--
-- Name: idx_notifications_held_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_held_live ON public.notifications USING btree (to_profile_id) WHERE ((to_user_id IS NULL) AND (expired_at IS NULL));


--
-- Name: idx_notifications_to_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_to_profile ON public.notifications USING btree (to_profile_id);


--
-- Name: idx_performances_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_performances_event_id ON public.performances USING btree (event_id);


--
-- Name: idx_performances_lineup_member_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_performances_lineup_member_id ON public.performances USING btree (lineup_member_id);


--
-- Name: idx_performances_slot_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_performances_slot_id ON public.performances USING btree (slot_id);


--
-- Name: idx_profile_assets_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profile_assets_current ON public.profile_assets USING btree (profile_id, asset_type) WHERE is_current;


--
-- Name: idx_profile_assets_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profile_assets_user ON public.profile_assets USING btree (user_id);


--
-- Name: idx_profiles_external_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_profiles_external_ref ON public.profiles USING btree (external_ref) WHERE (external_ref IS NOT NULL);


--
-- Name: idx_profiles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_user_id ON public.profiles USING btree (user_id);


--
-- Name: idx_venue_availability_profile_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venue_availability_profile_id ON public.venue_availability USING btree (profile_id);


--
-- Name: idx_venue_enquiries_applicant_profile_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venue_enquiries_applicant_profile_id ON public.venue_enquiries USING btree (applicant_profile_id);


--
-- Name: idx_venue_enquiries_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venue_enquiries_event_id ON public.venue_enquiries USING btree (event_id);


--
-- Name: idx_venue_enquiries_initiated_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venue_enquiries_initiated_by ON public.venue_enquiries USING btree (initiated_by);


--
-- Name: idx_venue_enquiries_venue_profile_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venue_enquiries_venue_profile_id ON public.venue_enquiries USING btree (venue_profile_id);


--
-- Name: message_participant_state_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX message_participant_state_message_idx ON public.message_participant_state USING btree (message_id);


--
-- Name: messages_client_id_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX messages_client_id_uniq ON public.messages USING btree (client_id) WHERE (client_id IS NOT NULL);


--
-- Name: mps_by_message_reaction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mps_by_message_reaction ON public.message_participant_state USING btree (message_id) WHERE (reaction IS NOT NULL);


--
-- Name: notifications_inbox_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_inbox_idx ON public.notifications USING btree (to_user_id) WHERE (dismissed_at IS NULL);


--
-- Name: phone_key_changes_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX phone_key_changes_user_time ON public.phone_key_changes USING btree (user_id, changed_at DESC);


--
-- Name: placeholder_profiles_claim_status_dedup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX placeholder_profiles_claim_status_dedup ON public.placeholder_profiles USING btree (claim_status, is_duplicate) WHERE (removed_at IS NULL);


--
-- Name: placeholder_profiles_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX placeholder_profiles_name_trgm ON public.placeholder_profiles USING gin (name public.gin_trgm_ops);


--
-- Name: profile_claim_requests_one_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profile_claim_requests_one_pending ON public.profile_claim_requests USING btree (profile_id, user_id) WHERE (status = 'pending'::text);


--
-- Name: profile_claim_requests_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profile_claim_requests_status_created_idx ON public.profile_claim_requests USING btree (status, created_at DESC);


--
-- Name: push_subscriptions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_subscriptions_user_idx ON public.push_subscriptions USING btree (user_id);


--
-- Name: usage_events_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_events_created_idx ON public.usage_events USING btree (created_at DESC);


--
-- Name: usage_events_device_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_events_device_created_idx ON public.usage_events USING btree (device_id, created_at DESC);


--
-- Name: usage_events_filtered_props_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_events_filtered_props_idx ON public.usage_events USING gin (props) WHERE (name = 'filtered'::text);


--
-- Name: usage_events_name_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_events_name_created_idx ON public.usage_events USING btree (name, created_at DESC);


--
-- Name: usage_events_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_events_session_idx ON public.usage_events USING btree (session_id, created_at) WHERE (session_id IS NOT NULL);


--
-- Name: phone_keys phone_keys_notify_contact_joins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER phone_keys_notify_contact_joins AFTER INSERT ON public.phone_keys FOR EACH ROW EXECUTE FUNCTION public.notify_contact_joins();


--
-- Name: phone_keys phone_keys_rate_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER phone_keys_rate_limit BEFORE INSERT OR UPDATE OF key_hmac ON public.phone_keys FOR EACH ROW EXECUTE FUNCTION public.enforce_phone_key_rate_limit();


--
-- Name: placeholder_profiles placeholder_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER placeholder_profiles_updated_at BEFORE UPDATE ON public.placeholder_profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: notifications trg_apply_notification_channel; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_apply_notification_channel BEFORE INSERT OR UPDATE OF to_user_id ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.apply_notification_channel();


--
-- Name: notifications trg_apply_notification_preferences; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_apply_notification_preferences BEFORE INSERT OR UPDATE OF to_user_id ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.apply_notification_preferences();


--
-- Name: profile_claim_requests trg_claim_request_pending; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_claim_request_pending AFTER INSERT ON public.profile_claim_requests FOR EACH ROW EXECUTE FUNCTION public.set_profile_claim_pending();


--
-- Name: messages trg_notify_new_message; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_new_message AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.notify_new_message();


--
-- Name: profile_assets trg_profile_assets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profile_assets_updated_at BEFORE UPDATE ON public.profile_assets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: profiles trg_profile_claimed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profile_claimed AFTER UPDATE OF user_id ON public.profiles FOR EACH ROW WHEN (((old.user_id IS NULL) AND (new.user_id IS NOT NULL))) EXECUTE FUNCTION public.on_profile_claimed();


--
-- Name: profiles trg_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: conversations trg_reject_context_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_reject_context_mutation BEFORE UPDATE OF context_type, context_id ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.reject_context_mutation();


--
-- Name: conversation_participants trg_sync_participant_key; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_participant_key AFTER INSERT OR DELETE ON public.conversation_participants FOR EACH ROW EXECUTE FUNCTION public.sync_conversation_participant_key();


--
-- Name: profiles trg_sync_profile_email; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_profile_email BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW WHEN (((new.email IS NULL) OR (new.email = ''::text))) EXECUTE FUNCTION public.sync_profile_email();


--
-- Name: messages trg_touch_conversation_last_message; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_conversation_last_message AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.touch_conversation_last_message();


--
-- Name: notifications trg_trigger_push_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trigger_push_notify AFTER INSERT ON public.notifications FOR EACH ROW WHEN ((new.channel IS DISTINCT FROM 'in_app'::text)) EXECUTE FUNCTION public.trigger_push_notify();


--
-- Name: applications applications_artist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: applications applications_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: applications applications_from_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_from_profile_id_fkey FOREIGN KEY (from_profile_id) REFERENCES public.profiles(id);


--
-- Name: approval_codes approval_codes_artist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_codes
    ADD CONSTRAINT approval_codes_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES auth.users(id);


--
-- Name: approval_codes approval_codes_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_codes
    ADD CONSTRAINT approval_codes_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: artist_availability artist_availability_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_availability
    ADD CONSTRAINT artist_availability_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: artist_availability artist_availability_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_availability
    ADD CONSTRAINT artist_availability_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: band_availability band_availability_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.band_availability
    ADD CONSTRAINT band_availability_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: beta_feedback beta_feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beta_feedback
    ADD CONSTRAINT beta_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: claims claims_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims
    ADD CONSTRAINT claims_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: claims claims_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims
    ADD CONSTRAINT claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: contact_codes contact_codes_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_codes
    ADD CONSTRAINT contact_codes_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: contact_join_notified contact_join_notified_joiner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_join_notified
    ADD CONSTRAINT contact_join_notified_joiner_user_id_fkey FOREIGN KEY (joiner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: contact_join_notified contact_join_notified_recipient_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_join_notified
    ADD CONSTRAINT contact_join_notified_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: contact_sync_state contact_sync_state_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_sync_state
    ADD CONSTRAINT contact_sync_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: conversation_participants conversation_participants_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_participants
    ADD CONSTRAINT conversation_participants_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_participants conversation_participants_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_participants
    ADD CONSTRAINT conversation_participants_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id);


--
-- Name: conversation_read_state conversation_read_state_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_read_state
    ADD CONSTRAINT conversation_read_state_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_read_state conversation_read_state_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_read_state
    ADD CONSTRAINT conversation_read_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: event_hosts event_hosts_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_hosts
    ADD CONSTRAINT event_hosts_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_hosts event_hosts_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_hosts
    ADD CONSTRAINT event_hosts_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: events events_host_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_host_id_fkey FOREIGN KEY (host_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: events events_owner_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_owner_profile_id_fkey FOREIGN KEY (owner_profile_id) REFERENCES public.profiles(id);


--
-- Name: events events_venue_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_venue_profile_id_fkey FOREIGN KEY (venue_profile_id) REFERENCES public.profiles(id);


--
-- Name: festival_applications festival_applications_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.festival_applications
    ADD CONSTRAINT festival_applications_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: festival_applications festival_applications_from_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.festival_applications
    ADD CONSTRAINT festival_applications_from_profile_id_fkey FOREIGN KEY (from_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: festival_categories festival_categories_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.festival_categories
    ADD CONSTRAINT festival_categories_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: festival_departments festival_departments_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.festival_departments
    ADD CONSTRAINT festival_departments_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: festival_event_settings festival_event_settings_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.festival_event_settings
    ADD CONSTRAINT festival_event_settings_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: follows follows_from_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_from_profile_id_fkey FOREIGN KEY (from_profile_id) REFERENCES public.profiles(id);


--
-- Name: follows follows_target_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_target_profile_id_fkey FOREIGN KEY (target_profile_id) REFERENCES public.profiles(id);


--
-- Name: follows follows_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: lineup_members lineup_members_artist_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lineup_members
    ADD CONSTRAINT lineup_members_artist_profile_id_fkey FOREIGN KEY (artist_profile_id) REFERENCES public.profiles(id);


--
-- Name: lineup_members lineup_members_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lineup_members
    ADD CONSTRAINT lineup_members_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: message_originals message_originals_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_originals
    ADD CONSTRAINT message_originals_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: message_originals message_originals_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_originals
    ADD CONSTRAINT message_originals_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: message_participant_state message_participant_state_from_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_participant_state
    ADD CONSTRAINT message_participant_state_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES auth.users(id);


--
-- Name: message_participant_state message_participant_state_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_participant_state
    ADD CONSTRAINT message_participant_state_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: message_participant_state message_participant_state_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_participant_state
    ADD CONSTRAINT message_participant_state_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: messages messages_from_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_from_profile_id_fkey FOREIGN KEY (from_profile_id) REFERENCES public.profiles(id);


--
-- Name: messages messages_from_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES auth.users(id);


--
-- Name: notification_channel_prefs notification_channel_prefs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_channel_prefs
    ADD CONSTRAINT notification_channel_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_about_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_about_profile_id_fkey FOREIGN KEY (about_profile_id) REFERENCES public.profiles(id);


--
-- Name: notifications notifications_to_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_to_profile_id_fkey FOREIGN KEY (to_profile_id) REFERENCES public.profiles(id);


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES auth.users(id);


--
-- Name: performances performances_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.performances
    ADD CONSTRAINT performances_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: performances performances_lineup_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.performances
    ADD CONSTRAINT performances_lineup_member_id_fkey FOREIGN KEY (lineup_member_id) REFERENCES public.lineup_members(id) ON DELETE CASCADE;


--
-- Name: personal_event_invites personal_event_invites_invitee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_event_invites
    ADD CONSTRAINT personal_event_invites_invitee_id_fkey FOREIGN KEY (invitee_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: personal_event_invites personal_event_invites_personal_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_event_invites
    ADD CONSTRAINT personal_event_invites_personal_event_id_fkey FOREIGN KEY (personal_event_id) REFERENCES public.personal_events(id) ON DELETE CASCADE;


--
-- Name: personal_events personal_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_events
    ADD CONSTRAINT personal_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: phone_key_changes phone_key_changes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_key_changes
    ADD CONSTRAINT phone_key_changes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: phone_keys phone_keys_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_keys
    ADD CONSTRAINT phone_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: placeholder_profiles placeholder_profiles_claimed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.placeholder_profiles
    ADD CONSTRAINT placeholder_profiles_claimed_by_fkey FOREIGN KEY (claimed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: placeholder_profiles placeholder_profiles_duplicate_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.placeholder_profiles
    ADD CONSTRAINT placeholder_profiles_duplicate_of_fkey FOREIGN KEY (duplicate_of) REFERENCES public.placeholder_profiles(id) ON DELETE SET NULL;


--
-- Name: placeholder_profiles placeholder_profiles_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.placeholder_profiles
    ADD CONSTRAINT placeholder_profiles_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: profile_assets profile_assets_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_assets
    ADD CONSTRAINT profile_assets_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profile_assets profile_assets_superseded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_assets
    ADD CONSTRAINT profile_assets_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES public.profile_assets(id) ON DELETE SET NULL;


--
-- Name: profile_assets profile_assets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_assets
    ADD CONSTRAINT profile_assets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profile_claim_requests profile_claim_requests_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_claim_requests
    ADD CONSTRAINT profile_claim_requests_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profile_claim_requests profile_claim_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_claim_requests
    ADD CONSTRAINT profile_claim_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: shortlist shortlist_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shortlist
    ADD CONSTRAINT shortlist_added_by_fkey FOREIGN KEY (added_by) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: slot_offers slot_offers_offered_by_uid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_offers
    ADD CONSTRAINT slot_offers_offered_by_uid_fkey FOREIGN KEY (offered_by_uid) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: slot_offers slot_offers_offered_to_uid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_offers
    ADD CONSTRAINT slot_offers_offered_to_uid_fkey FOREIGN KEY (offered_to_uid) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: standup_availability standup_availability_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.standup_availability
    ADD CONSTRAINT standup_availability_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: usage_events usage_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_events
    ADD CONSTRAINT usage_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: venue_availability venue_availability_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_availability
    ADD CONSTRAINT venue_availability_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id);


--
-- Name: venue_availability venue_availability_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_availability
    ADD CONSTRAINT venue_availability_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: venue_enquiries venue_enquiries_applicant_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_enquiries
    ADD CONSTRAINT venue_enquiries_applicant_profile_id_fkey FOREIGN KEY (applicant_profile_id) REFERENCES public.profiles(id);


--
-- Name: venue_enquiries venue_enquiries_applicant_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_enquiries
    ADD CONSTRAINT venue_enquiries_applicant_user_id_fkey FOREIGN KEY (applicant_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: venue_enquiries venue_enquiries_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_enquiries
    ADD CONSTRAINT venue_enquiries_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;


--
-- Name: venue_enquiries venue_enquiries_venue_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_enquiries
    ADD CONSTRAINT venue_enquiries_venue_profile_id_fkey FOREIGN KEY (venue_profile_id) REFERENCES public.profiles(id);


--
-- Name: venue_enquiries venue_enquiries_venue_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_enquiries
    ADD CONSTRAINT venue_enquiries_venue_user_id_fkey FOREIGN KEY (venue_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: claims Anyone can delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can delete" ON public.claims FOR DELETE USING (true);


--
-- Name: claims Anyone can insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can insert" ON public.claims FOR INSERT WITH CHECK (true);


--
-- Name: claims Anyone can read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read" ON public.claims FOR SELECT USING (true);


--
-- Name: lineup_members Anyone can read lineup_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read lineup_members" ON public.lineup_members FOR SELECT USING (true);


--
-- Name: performances Anyone can read performances; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read performances" ON public.performances FOR SELECT USING (true);


--
-- Name: profiles Anyone can read profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read profiles" ON public.profiles FOR SELECT USING (true);


--
-- Name: claims Anyone can update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can update" ON public.claims FOR UPDATE USING (true);


--
-- Name: venue_enquiries Applicant profile owner can insert own enquiries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Applicant profile owner can insert own enquiries" ON public.venue_enquiries FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = venue_enquiries.applicant_profile_id) AND (p.user_id = auth.uid())))) AND ((applicant_user_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = venue_enquiries.applicant_profile_id) AND (p.user_id = venue_enquiries.applicant_user_id))))) AND ((venue_profile_id IS NULL) OR (venue_user_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = venue_enquiries.venue_profile_id) AND (p.user_id = venue_enquiries.venue_user_id)))))));


--
-- Name: POLICY "Applicant profile owner can insert own enquiries" ON venue_enquiries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON POLICY "Applicant profile owner can insert own enquiries" ON public.venue_enquiries IS 'M4 identity migration 2026-07: profile-based applicant INSERT leg, additive-permissive. Applicant-side only, mirrors legacy. WITH CHECK carries identity-consistency guard on both column pairs. M8 must recreate without guard. Design: docs/m4-design-review-2026-07.md.';


--
-- Name: performances Artist can update own performance status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Artist can update own performance status" ON public.performances FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.lineup_members lm
  WHERE ((lm.id = performances.lineup_member_id) AND (lm.artist_id = auth.uid())))));


--
-- Name: claims Artists can delete their own claims; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Artists can delete their own claims" ON public.claims FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: slot_offers Artists can read their own slot offers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Artists can read their own slot offers" ON public.slot_offers FOR SELECT USING (((offered_to_uid)::text = (auth.uid())::text));


--
-- Name: unclaimed_profiles Authenticated can create unclaimed; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated can create unclaimed" ON public.unclaimed_profiles FOR INSERT WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: unclaimed_profiles Authenticated can read unclaimed; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated can read unclaimed" ON public.unclaimed_profiles FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: unclaimed_profiles Creator can manage unclaimed; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Creator can manage unclaimed" ON public.unclaimed_profiles USING ((auth.uid() = created_by));


--
-- Name: lineup_members Host can delete lineup_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Host can delete lineup_members" ON public.lineup_members FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.events
  WHERE ((events.id = lineup_members.event_id) AND (events.host_id = auth.uid())))));


--
-- Name: performances Host can delete performances; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Host can delete performances" ON public.performances FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.events
  WHERE ((events.id = performances.event_id) AND (events.host_id = auth.uid())))));


--
-- Name: lineup_members Host can insert lineup_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Host can insert lineup_members" ON public.lineup_members FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.events
  WHERE ((events.id = lineup_members.event_id) AND (events.host_id = auth.uid())))));


--
-- Name: performances Host can insert performances; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Host can insert performances" ON public.performances FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.events
  WHERE ((events.id = performances.event_id) AND (events.host_id = auth.uid())))));


--
-- Name: lineup_members Host can update lineup_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Host can update lineup_members" ON public.lineup_members FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.events
  WHERE ((events.id = lineup_members.event_id) AND (events.host_id = auth.uid())))));


--
-- Name: performances Host can update performances; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Host can update performances" ON public.performances FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.events
  WHERE ((events.id = performances.event_id) AND (events.host_id = auth.uid())))));


--
-- Name: slot_offers Hosts can read slot offers for their events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Hosts can read slot offers for their events" ON public.slot_offers FOR SELECT USING ((event_id IN ( SELECT (events.id)::text AS id
   FROM public.events
  WHERE ((events.host_id)::text = (auth.uid())::text))));


--
-- Name: approval_codes Hosts manage their event codes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Hosts manage their event codes" ON public.approval_codes USING (true) WITH CHECK (true);


--
-- Name: venue_enquiries Profile owner can read their enquiries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Profile owner can read their enquiries" ON public.venue_enquiries FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = venue_enquiries.venue_profile_id) AND (p.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = venue_enquiries.applicant_profile_id) AND (p.user_id = auth.uid()))))));


--
-- Name: POLICY "Profile owner can read their enquiries" ON venue_enquiries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON POLICY "Profile owner can read their enquiries" ON public.venue_enquiries IS 'M4 identity migration 2026-07: profile-based SELECT leg (either side), additive-permissive. Design: docs/m4-design-review-2026-07.md.';


--
-- Name: venue_availability Profile owner manages venue availability; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Profile owner manages venue availability" ON public.venue_availability USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = venue_availability.profile_id) AND (p.user_id = auth.uid()))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = venue_availability.profile_id) AND (p.user_id = auth.uid())))) AND ((user_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = venue_availability.profile_id) AND (p.user_id = venue_availability.user_id)))))));


--
-- Name: POLICY "Profile owner manages venue availability" ON venue_availability; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON POLICY "Profile owner manages venue availability" ON public.venue_availability IS 'M4 identity migration 2026-07: profile-based ownership leg, additive-permissive beside legacy user_id policy. WITH CHECK carries the identity-consistency guard. M8 must recreate without guard when user_id dropped. Design: docs/m4-design-review-2026-07.md.';


--
-- Name: placeholder_profiles Public read active placeholder profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public read active placeholder profiles" ON public.placeholder_profiles FOR SELECT USING (((claim_status = ANY (ARRAY['unclaimed'::text, 'pending'::text])) AND (is_duplicate = false) AND (blocklisted = false) AND (removed_at IS NULL)));


--
-- Name: artist_availability Public read availability; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public read availability" ON public.artist_availability FOR SELECT USING (true);


--
-- Name: venue_enquiries Users can insert own enquiries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own enquiries" ON public.venue_enquiries FOR INSERT WITH CHECK ((auth.uid() = applicant_user_id));


--
-- Name: artist_availability Users manage own availability; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own availability" ON public.artist_availability USING ((auth.uid() = user_id));


--
-- Name: band_availability Users manage own band availability; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own band availability" ON public.band_availability USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: standup_availability Users manage own standup availability; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own standup availability" ON public.standup_availability USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: venue_availability Users manage own venue availability; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own venue availability" ON public.venue_availability USING ((auth.uid() = user_id));


--
-- Name: notifications Users see own notifs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see own notifs" ON public.notifications FOR SELECT USING ((auth.uid() = to_user_id));


--
-- Name: notifications Users update own notifs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update own notifs" ON public.notifications FOR UPDATE USING ((auth.uid() = to_user_id));


--
-- Name: venue_enquiries Venue owner can read their enquiries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Venue owner can read their enquiries" ON public.venue_enquiries FOR SELECT USING (((auth.uid() = venue_user_id) OR (auth.uid() = applicant_user_id)));


--
-- Name: venue_enquiries Venue owner can update status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Venue owner can update status" ON public.venue_enquiries FOR UPDATE USING ((auth.uid() = venue_user_id));


--
-- Name: venue_enquiries Venue profile owner can update status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Venue profile owner can update status" ON public.venue_enquiries FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = venue_enquiries.venue_profile_id) AND (p.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = venue_enquiries.venue_profile_id) AND (p.user_id = auth.uid())))));


--
-- Name: POLICY "Venue profile owner can update status" ON venue_enquiries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON POLICY "Venue profile owner can update status" ON public.venue_enquiries IS 'M4 identity migration 2026-07: profile-based venue UPDATE leg, additive-permissive. Venue-side only. No guard here by design (post-claim divergence legitimate). Design: docs/m4-design-review-2026-07.md.';


--
-- Name: applications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

--
-- Name: approval_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approval_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: artist_availability; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artist_availability ENABLE ROW LEVEL SECURITY;

--
-- Name: applications artists can apply; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "artists can apply" ON public.applications FOR INSERT WITH CHECK ((auth.uid() = artist_id));


--
-- Name: applications artists can update own application (interim); Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "artists can update own application (interim)" ON public.applications FOR UPDATE USING ((auth.uid() = artist_id)) WITH CHECK ((auth.uid() = artist_id));


--
-- Name: POLICY "artists can update own application (interim)" ON applications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON POLICY "artists can update own application (interim)" ON public.applications IS 'INTERIM — added during the 2026-07 security sprint solely to preserve existing application behaviour (acceptSlotOffer/declineSlotOffer) after removing the unconditional "Hosts update apps" policy. Not a confirmation that direct artist writes to applications.status are the intended design. To be revisited during the Booking architecture review: determine whether performances should become the sole writable booking state and applications.status should become derived/read-only. KNOWN LIMITATION: this is a row-level policy only. anon/authenticated already hold UPDATE grants on every column of this table (verified 2026-07-11), so a column-level restriction to status-only was considered and rejected for this sprint — it would have required revoking those existing all-column grants, which is broader privilege restructuring than a security patch should do. In practice this policy permits an artist to rewrite any column on their own row (not just status) via a direct API call, even though no current application code does so. Revisit column-level restriction alongside the Booking architecture review.';


--
-- Name: applications artists can withdraw application; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "artists can withdraw application" ON public.applications FOR DELETE USING ((auth.uid() = artist_id));


--
-- Name: applications artists see own applications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "artists see own applications" ON public.applications FOR SELECT USING ((auth.uid() = artist_id));


--
-- Name: profile_assets assets deletable by their owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "assets deletable by their owner" ON public.profile_assets FOR DELETE TO authenticated USING (public.can_act_as(profile_id));


--
-- Name: profile_assets assets readable by their owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "assets readable by their owner" ON public.profile_assets FOR SELECT TO authenticated USING (public.can_act_as(profile_id));


--
-- Name: profile_assets assets updatable by their owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "assets updatable by their owner" ON public.profile_assets FOR UPDATE TO authenticated USING (public.can_act_as(profile_id)) WITH CHECK ((public.can_act_as(profile_id) AND (user_id = auth.uid())));


--
-- Name: profile_assets assets writable by their owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "assets writable by their owner" ON public.profile_assets FOR INSERT TO authenticated WITH CHECK ((public.can_act_as(profile_id) AND (user_id = auth.uid())));


--
-- Name: notifications authenticated users can insert notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated users can insert notifications" ON public.notifications FOR INSERT WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: POLICY "authenticated users can insert notifications" ON notifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON POLICY "authenticated users can insert notifications" ON public.notifications IS 'INTERIM — as of the 2026-07 security sprint, this is the sole INSERT gate on notifications after removing the unconditional "Anyone can insert notifs" policy. It closes anonymous/unauthenticated spoofing but NOT authenticated cross-user spoofing: any authenticated user can still write to any other user''s inbox with any content, because this check only verifies the requester is logged in, not who the target is or what relationship justifies the write. This is a deliberately deferred residual, not an oversight — the real fix requires designing a relationship-scoped authorization model (host-owns-event, venue-owns-enquiry, artist-responds-to-counterparty, open-follow), which is a Notifications-milestone design exercise, not a security-patch-sized change. Do not tighten this policy piecemeal; replace it as part of that redesign.';


--
-- Name: band_availability; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.band_availability ENABLE ROW LEVEL SECURITY;

--
-- Name: beta_feedback beta feedback insert own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "beta feedback insert own" ON public.beta_feedback FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: beta_feedback beta feedback select own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "beta feedback select own" ON public.beta_feedback FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: beta_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.beta_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_channel_prefs channel_prefs_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY channel_prefs_own ON public.notification_channel_prefs TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: profile_claim_requests claim requests insert own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "claim requests insert own" ON public.profile_claim_requests FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.profiles pr
  WHERE ((pr.id = profile_claim_requests.profile_id) AND (pr.user_id IS NULL))))));


--
-- Name: profile_claim_requests claim requests select own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "claim requests select own" ON public.profile_claim_requests FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: claims; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_join_notified; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_join_notified ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_sync_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_sync_state ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_participants conversation_participants_select_participant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_participants_select_participant ON public.conversation_participants FOR SELECT USING (public.is_conversation_participant(conversation_id));


--
-- Name: conversation_read_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversation_read_state ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_read_state conversation_read_state_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_read_state_insert_own ON public.conversation_read_state FOR INSERT WITH CHECK (((user_id = auth.uid()) AND public.is_conversation_participant(conversation_id)));


--
-- Name: conversation_read_state conversation_read_state_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_read_state_select_own ON public.conversation_read_state FOR SELECT USING (((user_id = auth.uid()) AND public.is_conversation_participant(conversation_id)));


--
-- Name: conversation_read_state conversation_read_state_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_read_state_update_own ON public.conversation_read_state FOR UPDATE USING (((user_id = auth.uid()) AND public.is_conversation_participant(conversation_id))) WITH CHECK (((user_id = auth.uid()) AND public.is_conversation_participant(conversation_id)));


--
-- Name: conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: conversations conversations_select_participant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversations_select_participant ON public.conversations FOR SELECT USING (public.is_conversation_participant(id));


--
-- Name: profile_assets distributable assets are public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "distributable assets are public" ON public.profile_assets FOR SELECT TO authenticated, anon USING (((asset_type = 'LOGO_PACK'::text) AND is_current));


--
-- Name: gigs enable all for authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "enable all for authenticated users" ON public.gigs TO authenticated USING (true) WITH CHECK (true);


--
-- Name: profiles enable all for authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "enable all for authenticated users" ON public.profiles TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: profiles enable read for everyone; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "enable read for everyone" ON public.profiles FOR SELECT TO authenticated, anon USING (true);


--
-- Name: event_hosts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_hosts ENABLE ROW LEVEL SECURITY;

--
-- Name: event_hosts event_hosts_delete_main_host; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_hosts_delete_main_host ON public.event_hosts FOR DELETE USING (public.is_event_main_host(event_id));


--
-- Name: event_hosts event_hosts_insert_main_host; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_hosts_insert_main_host ON public.event_hosts FOR INSERT WITH CHECK (public.is_event_main_host(event_id));


--
-- Name: event_hosts event_hosts_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_hosts_read ON public.event_hosts FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = event_hosts.event_id) AND e.is_public AND (e.status = ANY (ARRAY['live'::text, 'completed'::text]))))) OR public.is_event_main_host(event_id)));


--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

--
-- Name: festival_applications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.festival_applications ENABLE ROW LEVEL SECURITY;

--
-- Name: festival_applications festival_applications_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY festival_applications_insert ON public.festival_applications FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = festival_applications.from_profile_id) AND (p.user_id = auth.uid())))));


--
-- Name: festival_applications festival_applications_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY festival_applications_read ON public.festival_applications FOR SELECT USING (public.owns_festival_event(event_id));


--
-- Name: festival_applications festival_applications_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY festival_applications_update ON public.festival_applications FOR UPDATE USING (public.owns_festival_event(event_id)) WITH CHECK (public.owns_festival_event(event_id));


--
-- Name: festival_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.festival_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: festival_categories festival_categories_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY festival_categories_read ON public.festival_categories FOR SELECT USING (true);


--
-- Name: festival_categories festival_categories_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY festival_categories_write ON public.festival_categories USING (public.owns_festival_event(event_id)) WITH CHECK (public.owns_festival_event(event_id));


--
-- Name: festival_departments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.festival_departments ENABLE ROW LEVEL SECURITY;

--
-- Name: festival_departments festival_departments_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY festival_departments_read ON public.festival_departments FOR SELECT USING (true);


--
-- Name: festival_departments festival_departments_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY festival_departments_write ON public.festival_departments USING (public.owns_festival_event(event_id)) WITH CHECK (public.owns_festival_event(event_id));


--
-- Name: festival_event_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.festival_event_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: festival_event_settings festival_event_settings_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY festival_event_settings_read ON public.festival_event_settings FOR SELECT USING (true);


--
-- Name: festival_event_settings festival_event_settings_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY festival_event_settings_write ON public.festival_event_settings USING (public.owns_festival_event(event_id)) WITH CHECK (public.owns_festival_event(event_id));


--
-- Name: profiles festival_profile_creation_is_invite_only; Type: POLICY; Schema: public; Owner: -
--

-- ⚠ SANITISED BY HAND — the one deliberate divergence from production.
--
-- Production names a specific auth user here: the beta gate that limits
-- festival-profile creation to one account. This repository is PUBLIC, so the
-- real UUID is not committed.
--
-- The all-zeros UUID matches no user, so a rebuilt environment FAILS CLOSED:
-- nobody can create a festival profile until someone sets the real value.
-- That is the safe direction — deleting the policy instead would let anyone
-- create one.
--
-- ⭐ Replace with the real UUID (or better, generalise the gate to an
-- allowlist table) when the beta gate is next revisited.
CREATE POLICY festival_profile_creation_is_invite_only ON public.profiles AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (((type <> 'festival'::text) OR (user_id = '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: follows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

--
-- Name: follows follows_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY follows_delete_own ON public.follows FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: follows follows_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY follows_insert_own ON public.follows FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: follows follows_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY follows_select_own ON public.follows FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: gigs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gigs ENABLE ROW LEVEL SECURITY;

--
-- Name: slot_offers hosts can insert offers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "hosts can insert offers" ON public.slot_offers FOR INSERT WITH CHECK ((auth.uid() = offered_by_uid));


--
-- Name: shortlist hosts can manage their shortlist; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "hosts can manage their shortlist" ON public.shortlist USING ((auth.uid() = added_by)) WITH CHECK ((auth.uid() = added_by));


--
-- Name: slot_offers hosts can read offers they sent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "hosts can read offers they sent" ON public.slot_offers FOR SELECT USING ((auth.uid() = offered_by_uid));


--
-- Name: shortlist hosts can read their shortlist; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "hosts can read their shortlist" ON public.shortlist FOR SELECT USING ((auth.uid() = added_by));


--
-- Name: applications hosts can update application status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "hosts can update application status" ON public.applications FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.events
  WHERE ((events.id = applications.event_id) AND (events.host_id = auth.uid())))));


--
-- Name: events hosts manage own events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "hosts manage own events" ON public.events USING ((host_id = auth.uid()));


--
-- Name: applications hosts see applications for their events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "hosts see applications for their events" ON public.applications FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.events
  WHERE ((events.id = applications.event_id) AND (events.host_id = auth.uid())))));


--
-- Name: lineup_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lineup_members ENABLE ROW LEVEL SECURITY;

--
-- Name: message_originals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_originals ENABLE ROW LEVEL SECURITY;

--
-- Name: message_participant_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_participant_state ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: messages messages_insert_participant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_insert_participant ON public.messages FOR INSERT WITH CHECK ((public.can_write_to_conversation(conversation_id) AND public.can_act_as(from_profile_id) AND (from_user_id = auth.uid())));


--
-- Name: messages messages_select_participant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_select_participant ON public.messages FOR SELECT USING (public.is_conversation_participant(conversation_id));


--
-- Name: message_participant_state mps_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mps_delete_own ON public.message_participant_state FOR DELETE USING (public.can_act_as(profile_id));


--
-- Name: message_participant_state mps_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mps_insert_own ON public.message_participant_state FOR INSERT WITH CHECK ((public.can_write_to_conversation(public.message_conversation(message_id)) AND public.can_act_as(profile_id) AND (from_user_id = auth.uid())));


--
-- Name: message_participant_state mps_select_participant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mps_select_participant ON public.message_participant_state FOR SELECT USING (public.is_conversation_participant(public.message_conversation(message_id)));


--
-- Name: message_participant_state mps_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mps_update_own ON public.message_participant_state FOR UPDATE USING ((public.can_act_as(profile_id) AND (from_user_id = auth.uid()))) WITH CHECK ((public.can_act_as(profile_id) AND (from_user_id = auth.uid())));


--
-- Name: notification_channel_prefs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_channel_prefs ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_expiry_policy; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_expiry_policy ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_expiry_policy notification_expiry_policy_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_expiry_policy_read ON public.notification_expiry_policy FOR SELECT USING (true);


--
-- Name: notification_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_preferences notification_preferences_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_preferences_select_own ON public.notification_preferences FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: notification_preferences notification_preferences_write_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_preferences_write_own ON public.notification_preferences USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: message_originals originals readable by conversation participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "originals readable by conversation participants" ON public.message_originals FOR SELECT TO authenticated USING (public.is_conversation_participant(conversation_id));


--
-- Name: message_originals originals writable by those who may send; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "originals writable by those who may send" ON public.message_originals FOR INSERT TO authenticated WITH CHECK (public.can_write_to_conversation(conversation_id));


--
-- Name: personal_events pe_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pe_delete ON public.personal_events FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: personal_events pe_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pe_insert ON public.personal_events FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: personal_events pe_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pe_select ON public.personal_events FOR SELECT USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM public.personal_event_invites
  WHERE ((personal_event_invites.personal_event_id = personal_events.id) AND (personal_event_invites.invitee_id = auth.uid()))))));


--
-- Name: personal_events pe_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pe_update ON public.personal_events FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: personal_event_invites pei_invitee_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pei_invitee_select ON public.personal_event_invites FOR SELECT USING ((auth.uid() = invitee_id));


--
-- Name: personal_event_invites pei_owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pei_owner_all ON public.personal_event_invites USING ((EXISTS ( SELECT 1
   FROM public.personal_events
  WHERE ((personal_events.id = personal_event_invites.personal_event_id) AND (personal_events.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.personal_events
  WHERE ((personal_events.id = personal_event_invites.personal_event_id) AND (personal_events.user_id = auth.uid())))));


--
-- Name: performances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.performances ENABLE ROW LEVEL SECURITY;

--
-- Name: personal_event_invites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.personal_event_invites ENABLE ROW LEVEL SECURITY;

--
-- Name: personal_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.personal_events ENABLE ROW LEVEL SECURITY;

--
-- Name: phone_key_changes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.phone_key_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: phone_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.phone_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: placeholder_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.placeholder_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profile_assets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profile_assets ENABLE ROW LEVEL SECURITY;

--
-- Name: profile_claim_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profile_claim_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: events public read events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read events" ON public.events FOR SELECT USING (true);


--
-- Name: events public read live events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read live events" ON public.events FOR SELECT USING ((status = 'live'::text));


--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions push_subscriptions_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subscriptions_delete_own ON public.push_subscriptions FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: push_subscriptions push_subscriptions_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subscriptions_insert_own ON public.push_subscriptions FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: push_subscriptions push_subscriptions_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subscriptions_select_own ON public.push_subscriptions FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: push_subscriptions push_subscriptions_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subscriptions_update_own ON public.push_subscriptions FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: shortlist; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shortlist ENABLE ROW LEVEL SECURITY;

--
-- Name: slot_offers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.slot_offers ENABLE ROW LEVEL SECURITY;

--
-- Name: standup_availability; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.standup_availability ENABLE ROW LEVEL SECURITY;

--
-- Name: unclaimed_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unclaimed_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: usage_events usage events insert own or anonymous; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "usage events insert own or anonymous" ON public.usage_events FOR INSERT TO authenticated, anon WITH CHECK (((user_id IS NULL) OR (user_id = auth.uid())));


--
-- Name: usage_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications users can read their own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can read their own notifications" ON public.notifications FOR SELECT USING ((auth.uid() = to_user_id));


--
-- Name: slot_offers users can read their own offers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can read their own offers" ON public.slot_offers FOR SELECT USING (((auth.uid() = offered_to_uid) OR (offered_to_email = (( SELECT users.email
   FROM auth.users
  WHERE (users.id = auth.uid())))::text)));


--
-- Name: notifications users can update their own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can update their own notifications" ON public.notifications FOR UPDATE USING ((auth.uid() = to_user_id));


--
-- Name: venue_availability; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.venue_availability ENABLE ROW LEVEL SECURITY;

--
-- Name: venue_enquiries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.venue_enquiries ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

--
-- ⚠⚠ ADDED BY HAND — WITHOUT THIS THE BASELINE IS INSECURE.
--
-- pg_dump emits GRANTs but never REVOKEs: it assumes objects start with no
-- privileges. On Supabase they do not. `ALTER DEFAULT PRIVILEGES` grants ALL
-- on every new table to anon/authenticated/service_role, so each table is
-- born fully open and the GRANTs below are ADDITIVE on top of that.
--
-- The consequence, measured against production 2026-08-07: a rebuild had
-- anon holding TRUNCATE on 46 tables where production allows 4, SELECT on 46
-- where production allows 35, UPDATE on 46 where production allows 32. Every
-- privilege ever REVOKED — the whole July security sprint — was silently
-- absent from the rebuild.
--
-- Resetting to zero here makes the GRANTs below authoritative rather than
-- additive, so the rebuild reproduces production's ACLs exactly.
--
-- ⚠ NOT covered: function EXECUTE privileges. Production REVOKEs EXECUTE on
-- at least one function (approve_profile_claim, see c1_profile_claim_requests)
-- and the same blind spot applies. Revoking EXECUTE wholesale is NOT safe
-- here, because pg_dump omits grants for default-ACL functions and they would
-- be left unreachable. Needs its own diff.
--

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated, service_role;


GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION apply_notification_channel(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.apply_notification_channel() TO anon;
GRANT ALL ON FUNCTION public.apply_notification_channel() TO authenticated;
GRANT ALL ON FUNCTION public.apply_notification_channel() TO service_role;


--
-- Name: FUNCTION apply_notification_preferences(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.apply_notification_preferences() TO anon;
GRANT ALL ON FUNCTION public.apply_notification_preferences() TO authenticated;
GRANT ALL ON FUNCTION public.apply_notification_preferences() TO service_role;


--
-- Name: FUNCTION approve_profile_claim(p_request_id bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.approve_profile_claim(p_request_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.approve_profile_claim(p_request_id bigint) TO service_role;


--
-- Name: FUNCTION can_act_as(profile_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_act_as(profile_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_act_as(profile_id uuid) TO anon;
GRANT ALL ON FUNCTION public.can_act_as(profile_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_act_as(profile_id uuid) TO service_role;


--
-- Name: FUNCTION can_write_to_conversation(p_conversation_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.can_write_to_conversation(p_conversation_id uuid) TO anon;
GRANT ALL ON FUNCTION public.can_write_to_conversation(p_conversation_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_write_to_conversation(p_conversation_id uuid) TO service_role;


--
-- Name: FUNCTION conversation_participant_key(p_conversation_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.conversation_participant_key(p_conversation_id uuid) TO anon;
GRANT ALL ON FUNCTION public.conversation_participant_key(p_conversation_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.conversation_participant_key(p_conversation_id uuid) TO service_role;


--
-- Name: FUNCTION conversation_receipts(p_conversation_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.conversation_receipts(p_conversation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.conversation_receipts(p_conversation_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.conversation_receipts(p_conversation_id uuid) TO service_role;


--
-- Name: FUNCTION conversation_seen_watermark(p_conversation_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.conversation_seen_watermark(p_conversation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.conversation_seen_watermark(p_conversation_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.conversation_seen_watermark(p_conversation_id uuid) TO service_role;


--
-- Name: FUNCTION conversation_unread_count(p_conversation_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.conversation_unread_count(p_conversation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.conversation_unread_count(p_conversation_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.conversation_unread_count(p_conversation_id uuid) TO service_role;


--
-- Name: FUNCTION delete_contact_codes(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_contact_codes() FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_contact_codes() TO service_role;
GRANT ALL ON FUNCTION public.delete_contact_codes() TO authenticated;


--
-- Name: FUNCTION deliver_held_notifications(p_profile_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.deliver_held_notifications(p_profile_id uuid, p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.deliver_held_notifications(p_profile_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.deliver_held_notifications(p_profile_id uuid, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION direct_context_id(p_a uuid, p_b uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.direct_context_id(p_a uuid, p_b uuid) TO anon;
GRANT ALL ON FUNCTION public.direct_context_id(p_a uuid, p_b uuid) TO authenticated;
GRANT ALL ON FUNCTION public.direct_context_id(p_a uuid, p_b uuid) TO service_role;


--
-- Name: FUNCTION enforce_phone_key_rate_limit(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_phone_key_rate_limit() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_phone_key_rate_limit() TO service_role;


--
-- Name: FUNCTION ensure_personal_profile(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.ensure_personal_profile() TO anon;
GRANT ALL ON FUNCTION public.ensure_personal_profile() TO authenticated;
GRANT ALL ON FUNCTION public.ensure_personal_profile() TO service_role;


--
-- Name: FUNCTION event_end_date(p_event_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.event_end_date(p_event_id uuid) TO anon;
GRANT ALL ON FUNCTION public.event_end_date(p_event_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.event_end_date(p_event_id uuid) TO service_role;


--
-- Name: FUNCTION expire_held_notifications(p_profile_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.expire_held_notifications(p_profile_id uuid) TO anon;
GRANT ALL ON FUNCTION public.expire_held_notifications(p_profile_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.expire_held_notifications(p_profile_id uuid) TO service_role;


--
-- Name: FUNCTION find_by_phone(p_e164 text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.find_by_phone(p_e164 text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.find_by_phone(p_e164 text[]) TO service_role;
GRANT ALL ON FUNCTION public.find_by_phone(p_e164 text[]) TO authenticated;


--
-- Name: FUNCTION held_notification_counts(p_profile_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.held_notification_counts(p_profile_id uuid) TO anon;
GRANT ALL ON FUNCTION public.held_notification_counts(p_profile_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.held_notification_counts(p_profile_id uuid) TO service_role;


--
-- Name: FUNCTION held_notification_is_stale(p_type text, p_data jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.held_notification_is_stale(p_type text, p_data jsonb) TO anon;
GRANT ALL ON FUNCTION public.held_notification_is_stale(p_type text, p_data jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.held_notification_is_stale(p_type text, p_data jsonb) TO service_role;


--
-- Name: FUNCTION is_conversation_participant(p_conversation_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_conversation_participant(p_conversation_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_conversation_participant(p_conversation_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_conversation_participant(p_conversation_id uuid) TO service_role;


--
-- Name: FUNCTION is_event_main_host(_event_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_event_main_host(_event_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_event_main_host(_event_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_event_main_host(_event_id uuid) TO service_role;


--
-- Name: FUNCTION mark_conversation_delivered(p_conversation_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_conversation_delivered(p_conversation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_conversation_delivered(p_conversation_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.mark_conversation_delivered(p_conversation_id uuid) TO service_role;


--
-- Name: FUNCTION mark_conversation_read(p_conversation_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_conversation_read(p_conversation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_conversation_read(p_conversation_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.mark_conversation_read(p_conversation_id uuid) TO service_role;


--
-- Name: FUNCTION message_conversation(p_message_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.message_conversation(p_message_id uuid) TO anon;
GRANT ALL ON FUNCTION public.message_conversation(p_message_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.message_conversation(p_message_id uuid) TO service_role;


--
-- Name: FUNCTION my_contact_sync(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_contact_sync() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_contact_sync() TO service_role;
GRANT ALL ON FUNCTION public.my_contact_sync() TO authenticated;


--
-- Name: FUNCTION my_festival_applications(p_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_festival_applications(p_event_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_festival_applications(p_event_id uuid) TO anon;
GRANT ALL ON FUNCTION public.my_festival_applications(p_event_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.my_festival_applications(p_event_id uuid) TO service_role;


--
-- Name: FUNCTION my_phone_key(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_phone_key() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_phone_key() TO service_role;
GRANT ALL ON FUNCTION public.my_phone_key() TO authenticated;


--
-- Name: FUNCTION notification_category_is_mutable(p_category text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.notification_category_is_mutable(p_category text) TO anon;
GRANT ALL ON FUNCTION public.notification_category_is_mutable(p_category text) TO authenticated;
GRANT ALL ON FUNCTION public.notification_category_is_mutable(p_category text) TO service_role;


--
-- Name: FUNCTION notify_contact_joins(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notify_contact_joins() FROM PUBLIC;
GRANT ALL ON FUNCTION public.notify_contact_joins() TO service_role;


--
-- Name: FUNCTION notify_new_message(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.notify_new_message() TO anon;
GRANT ALL ON FUNCTION public.notify_new_message() TO authenticated;
GRANT ALL ON FUNCTION public.notify_new_message() TO service_role;


--
-- Name: FUNCTION on_profile_claimed(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.on_profile_claimed() TO anon;
GRANT ALL ON FUNCTION public.on_profile_claimed() TO authenticated;
GRANT ALL ON FUNCTION public.on_profile_claimed() TO service_role;


--
-- Name: FUNCTION open_conversation(p_context_type text, p_context_id uuid, p_participant_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.open_conversation(p_context_type text, p_context_id uuid, p_participant_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.open_conversation(p_context_type text, p_context_id uuid, p_participant_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.open_conversation(p_context_type text, p_context_id uuid, p_participant_ids uuid[]) TO service_role;


--
-- Name: FUNCTION open_direct_conversation(p_from_profile_id uuid, p_to_profile_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.open_direct_conversation(p_from_profile_id uuid, p_to_profile_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.open_direct_conversation(p_from_profile_id uuid, p_to_profile_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.open_direct_conversation(p_from_profile_id uuid, p_to_profile_id uuid) TO service_role;


--
-- Name: FUNCTION owns_festival_event(p_event_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.owns_festival_event(p_event_id uuid) TO anon;
GRANT ALL ON FUNCTION public.owns_festival_event(p_event_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.owns_festival_event(p_event_id uuid) TO service_role;


--
-- Name: FUNCTION phone_key_discoverable_by(p_owner uuid, p_viewer uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.phone_key_discoverable_by(p_owner uuid, p_viewer uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.phone_key_discoverable_by(p_owner uuid, p_viewer uuid) TO service_role;


--
-- Name: FUNCTION phone_key_hash(p_e164 text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.phone_key_hash(p_e164 text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.phone_key_hash(p_e164 text) TO service_role;


--
-- Name: FUNCTION phone_key_pepper(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.phone_key_pepper() FROM PUBLIC;
GRANT ALL ON FUNCTION public.phone_key_pepper() TO service_role;


--
-- Name: FUNCTION profile_actors(p_profile_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.profile_actors(p_profile_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.profile_actors(p_profile_id uuid) TO service_role;


--
-- Name: FUNCTION reject_context_mutation(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.reject_context_mutation() TO anon;
GRANT ALL ON FUNCTION public.reject_context_mutation() TO authenticated;
GRANT ALL ON FUNCTION public.reject_context_mutation() TO service_role;


--
-- Name: FUNCTION reject_profile_claim(p_request_id bigint, p_note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reject_profile_claim(p_request_id bigint, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reject_profile_claim(p_request_id bigint, p_note text) TO service_role;


--
-- Name: FUNCTION remove_phone_key(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.remove_phone_key() FROM PUBLIC;
GRANT ALL ON FUNCTION public.remove_phone_key() TO service_role;
GRANT ALL ON FUNCTION public.remove_phone_key() TO authenticated;


--
-- Name: FUNCTION safe_bigint(txt text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.safe_bigint(txt text) TO anon;
GRANT ALL ON FUNCTION public.safe_bigint(txt text) TO authenticated;
GRANT ALL ON FUNCTION public.safe_bigint(txt text) TO service_role;


--
-- Name: FUNCTION safe_date(txt text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.safe_date(txt text) TO anon;
GRANT ALL ON FUNCTION public.safe_date(txt text) TO authenticated;
GRANT ALL ON FUNCTION public.safe_date(txt text) TO service_role;


--
-- Name: FUNCTION safe_uuid(txt text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.safe_uuid(txt text) TO anon;
GRANT ALL ON FUNCTION public.safe_uuid(txt text) TO authenticated;
GRANT ALL ON FUNCTION public.safe_uuid(txt text) TO service_role;


--
-- Name: FUNCTION set_contact_sync(p_enabled boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_contact_sync(p_enabled boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_contact_sync(p_enabled boolean) TO service_role;
GRANT ALL ON FUNCTION public.set_contact_sync(p_enabled boolean) TO authenticated;


--
-- Name: FUNCTION set_phone_key(p_e164 text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_phone_key(p_e164 text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_phone_key(p_e164 text) TO service_role;
GRANT ALL ON FUNCTION public.set_phone_key(p_e164 text) TO authenticated;


--
-- Name: FUNCTION set_phone_visibility(p_visibility text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_phone_visibility(p_visibility text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_phone_visibility(p_visibility text) TO service_role;
GRANT ALL ON FUNCTION public.set_phone_visibility(p_visibility text) TO authenticated;


--
-- Name: FUNCTION set_profile_claim_pending(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_profile_claim_pending() TO anon;
GRANT ALL ON FUNCTION public.set_profile_claim_pending() TO authenticated;
GRANT ALL ON FUNCTION public.set_profile_claim_pending() TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: FUNCTION sync_contacts(p_e164 text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_contacts(p_e164 text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_contacts(p_e164 text[]) TO service_role;
GRANT ALL ON FUNCTION public.sync_contacts(p_e164 text[]) TO authenticated;


--
-- Name: FUNCTION sync_conversation_participant_key(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_conversation_participant_key() TO anon;
GRANT ALL ON FUNCTION public.sync_conversation_participant_key() TO authenticated;
GRANT ALL ON FUNCTION public.sync_conversation_participant_key() TO service_role;


--
-- Name: FUNCTION sync_profile_email(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_profile_email() TO anon;
GRANT ALL ON FUNCTION public.sync_profile_email() TO authenticated;
GRANT ALL ON FUNCTION public.sync_profile_email() TO service_role;


--
-- Name: FUNCTION total_unread_count(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.total_unread_count() FROM PUBLIC;
GRANT ALL ON FUNCTION public.total_unread_count() TO authenticated;
GRANT ALL ON FUNCTION public.total_unread_count() TO service_role;


--
-- Name: FUNCTION total_unread_count_for(p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.total_unread_count_for(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.total_unread_count_for(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION touch_conversation_last_message(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.touch_conversation_last_message() TO anon;
GRANT ALL ON FUNCTION public.touch_conversation_last_message() TO authenticated;
GRANT ALL ON FUNCTION public.touch_conversation_last_message() TO service_role;


--
-- Name: FUNCTION touch_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.touch_updated_at() TO anon;
GRANT ALL ON FUNCTION public.touch_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.touch_updated_at() TO service_role;


--
-- Name: FUNCTION trigger_push_notify(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trigger_push_notify() TO anon;
GRANT ALL ON FUNCTION public.trigger_push_notify() TO authenticated;
GRANT ALL ON FUNCTION public.trigger_push_notify() TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.profiles TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE accounts_with_email; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.accounts_with_email TO service_role;


--
-- Name: TABLE applications; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.applications TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.applications TO authenticated;
GRANT ALL ON TABLE public.applications TO service_role;


--
-- Name: TABLE approval_codes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.approval_codes TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.approval_codes TO authenticated;
GRANT ALL ON TABLE public.approval_codes TO service_role;


--
-- Name: TABLE artist_availability; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.artist_availability TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.artist_availability TO authenticated;
GRANT ALL ON TABLE public.artist_availability TO service_role;


--
-- Name: TABLE band_availability; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.band_availability TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.band_availability TO authenticated;
GRANT ALL ON TABLE public.band_availability TO service_role;


--
-- Name: TABLE beta_feedback; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.beta_feedback TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.beta_feedback TO authenticated;
GRANT ALL ON TABLE public.beta_feedback TO service_role;


--
-- Name: SEQUENCE beta_feedback_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.beta_feedback_id_seq TO anon;
GRANT ALL ON SEQUENCE public.beta_feedback_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.beta_feedback_id_seq TO service_role;


--
-- Name: TABLE claims; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.claims TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.claims TO authenticated;
GRANT ALL ON TABLE public.claims TO service_role;


--
-- Name: TABLE contact_codes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contact_codes TO service_role;


--
-- Name: SEQUENCE contact_codes_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.contact_codes_id_seq TO service_role;


--
-- Name: TABLE contact_join_notified; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contact_join_notified TO service_role;


--
-- Name: TABLE contact_sync_state; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contact_sync_state TO service_role;


--
-- Name: TABLE conversation_participants; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.conversation_participants TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.conversation_participants TO authenticated;
GRANT ALL ON TABLE public.conversation_participants TO service_role;


--
-- Name: TABLE conversation_read_state; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.conversation_read_state TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.conversation_read_state TO authenticated;
GRANT ALL ON TABLE public.conversation_read_state TO service_role;


--
-- Name: TABLE conversations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.conversations TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.conversations TO authenticated;
GRANT ALL ON TABLE public.conversations TO service_role;


--
-- Name: TABLE event_hosts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.event_hosts TO service_role;
GRANT SELECT ON TABLE public.event_hosts TO anon;
GRANT SELECT,INSERT,DELETE ON TABLE public.event_hosts TO authenticated;


--
-- Name: TABLE events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.events TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.events TO authenticated;
GRANT ALL ON TABLE public.events TO service_role;


--
-- Name: TABLE festival_applications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.festival_applications TO anon;
GRANT ALL ON TABLE public.festival_applications TO authenticated;
GRANT ALL ON TABLE public.festival_applications TO service_role;


--
-- Name: TABLE festival_categories; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.festival_categories TO anon;
GRANT ALL ON TABLE public.festival_categories TO authenticated;
GRANT ALL ON TABLE public.festival_categories TO service_role;


--
-- Name: TABLE festival_departments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.festival_departments TO anon;
GRANT ALL ON TABLE public.festival_departments TO authenticated;
GRANT ALL ON TABLE public.festival_departments TO service_role;


--
-- Name: TABLE festival_event_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.festival_event_settings TO anon;
GRANT ALL ON TABLE public.festival_event_settings TO authenticated;
GRANT ALL ON TABLE public.festival_event_settings TO service_role;


--
-- Name: TABLE follows; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.follows TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.follows TO authenticated;
GRANT ALL ON TABLE public.follows TO service_role;


--
-- Name: TABLE gigs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.gigs TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.gigs TO authenticated;
GRANT ALL ON TABLE public.gigs TO service_role;


--
-- Name: TABLE lineup_members; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.lineup_members TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.lineup_members TO authenticated;
GRANT ALL ON TABLE public.lineup_members TO service_role;


--
-- Name: TABLE message_originals; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.message_originals TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.message_originals TO authenticated;
GRANT ALL ON TABLE public.message_originals TO service_role;


--
-- Name: TABLE message_participant_state; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.message_participant_state TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.message_participant_state TO authenticated;
GRANT ALL ON TABLE public.message_participant_state TO service_role;


--
-- Name: TABLE messages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.messages TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;


--
-- Name: TABLE notification_channel_prefs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notification_channel_prefs TO authenticated;
GRANT ALL ON TABLE public.notification_channel_prefs TO service_role;


--
-- Name: TABLE notification_expiry_policy; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.notification_expiry_policy TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.notification_expiry_policy TO authenticated;
GRANT ALL ON TABLE public.notification_expiry_policy TO service_role;


--
-- Name: TABLE notification_preferences; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.notification_preferences TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.notification_preferences TO authenticated;
GRANT ALL ON TABLE public.notification_preferences TO service_role;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN ON TABLE public.notifications TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;


--
-- Name: COLUMN notifications.read; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(read) ON TABLE public.notifications TO authenticated;


--
-- Name: COLUMN notifications.dismissed_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(dismissed_at) ON TABLE public.notifications TO authenticated;


--
-- Name: COLUMN notifications.responded_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(responded_at) ON TABLE public.notifications TO authenticated;


--
-- Name: TABLE performances; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.performances TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.performances TO authenticated;
GRANT ALL ON TABLE public.performances TO service_role;


--
-- Name: TABLE personal_event_invites; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.personal_event_invites TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.personal_event_invites TO authenticated;
GRANT ALL ON TABLE public.personal_event_invites TO service_role;


--
-- Name: TABLE personal_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.personal_events TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.personal_events TO authenticated;
GRANT ALL ON TABLE public.personal_events TO service_role;


--
-- Name: TABLE phone_key_changes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.phone_key_changes TO service_role;


--
-- Name: SEQUENCE phone_key_changes_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.phone_key_changes_id_seq TO service_role;


--
-- Name: TABLE phone_keys; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.phone_keys TO service_role;


--
-- Name: TABLE placeholder_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.placeholder_profiles TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.placeholder_profiles TO authenticated;
GRANT ALL ON TABLE public.placeholder_profiles TO service_role;


--
-- Name: TABLE profile_assets; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profile_assets TO authenticated;
GRANT ALL ON TABLE public.profile_assets TO service_role;


--
-- Name: TABLE profile_claim_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profile_claim_requests TO service_role;
GRANT SELECT,INSERT ON TABLE public.profile_claim_requests TO authenticated;


--
-- Name: SEQUENCE profile_claim_requests_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.profile_claim_requests_id_seq TO anon;
GRANT ALL ON SEQUENCE public.profile_claim_requests_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.profile_claim_requests_id_seq TO service_role;


--
-- Name: TABLE push_subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.push_subscriptions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.push_subscriptions TO authenticated;


--
-- Name: TABLE shortlist; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.shortlist TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.shortlist TO authenticated;
GRANT ALL ON TABLE public.shortlist TO service_role;


--
-- Name: TABLE slot_offers; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.slot_offers TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.slot_offers TO authenticated;
GRANT ALL ON TABLE public.slot_offers TO service_role;


--
-- Name: TABLE standup_availability; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.standup_availability TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.standup_availability TO authenticated;
GRANT ALL ON TABLE public.standup_availability TO service_role;


--
-- Name: TABLE unclaimed_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.unclaimed_profiles TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.unclaimed_profiles TO authenticated;
GRANT ALL ON TABLE public.unclaimed_profiles TO service_role;


--
-- Name: TABLE usage_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.usage_events TO service_role;
GRANT INSERT ON TABLE public.usage_events TO anon;
GRANT INSERT ON TABLE public.usage_events TO authenticated;


--
-- Name: SEQUENCE usage_events_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.usage_events_id_seq TO anon;
GRANT ALL ON SEQUENCE public.usage_events_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.usage_events_id_seq TO service_role;


--
-- Name: TABLE venue_availability; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.venue_availability TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.venue_availability TO authenticated;
GRANT ALL ON TABLE public.venue_availability TO service_role;


--
-- Name: TABLE venue_enquiries; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.venue_enquiries TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.venue_enquiries TO authenticated;
GRANT ALL ON TABLE public.venue_enquiries TO service_role;


--
-- Name: SEQUENCE venue_enquiries_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.venue_enquiries_id_seq TO anon;
GRANT ALL ON SEQUENCE public.venue_enquiries_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.venue_enquiries_id_seq TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

-- [baseline: skipped — see note at end of file] ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
-- [baseline: skipped — see note at end of file] ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
-- [baseline: skipped — see note at end of file] ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
-- [baseline: skipped — see note at end of file] ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

-- [baseline: skipped — see note at end of file] ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
-- [baseline: skipped — see note at end of file] ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
-- [baseline: skipped — see note at end of file] ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
-- [baseline: skipped — see note at end of file] ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

-- [baseline: skipped — see note at end of file] ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
-- [baseline: skipped — see note at end of file] ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
-- [baseline: skipped — see note at end of file] ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
-- [baseline: skipped — see note at end of file] ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict 1kNGJigBKOvVJtcb7tlkpXEkl5TaUlMKyNiOZkf482vcKMLMZFgCW4gZlU9KiZi


--
-- ⚠ NOTE ON THE COMMENTED-OUT `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin`
-- LINES ABOVE (12 of them), added by hand rather than by pg_dump.
--
-- Applying this file connects as `postgres`, which cannot change default
-- privileges belonging to `supabase_admin` — Postgres rejects it with
-- "permission denied to change default privileges" and, under
-- --single-transaction, takes the whole baseline down with it.
--
-- They are safe to skip: Supabase establishes those exact defaults itself
-- when a project is created, so a fresh project already has them. The
-- equivalent `FOR ROLE postgres` lines are kept, because those we own.
--
