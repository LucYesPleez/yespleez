-- O2 · THE PARTICIPATION FUNNEL BECOMES MEASURABLE.
--
-- gate_shown / intent_resumed are the two ends of the conversion moment the
-- onboarding redesign is built around: a signed-out visitor taps a heart,
-- the ParticipationGate names what an account enables, and after signup the
-- intent completes. Until now that moment was a silent dead tap — literally
-- uncounted.
--
-- · gate_shown       props.action only ('save_event' | 'follow_profile').
--                    ⛔ NEVER an event id, profile id, or name — rule 3.
-- · intent_resumed   props.action + props.done (did the auto-safe act land).
--
-- ⚠ RUN BEFORE PROMOTING THE O2 CODE — the constraint must accept a name
-- before anything sends it (the migrations-first rule, §7 of the 2026-08-12
-- handover). A name the CHECK rejects is silent data loss, not an error the
-- app would surface.
--
-- ⚠ DROP-IF-EXISTS + THE FULL LIST, not an incremental tweak, because there
-- is no migration ledger and A3's version of this constraint may or may not
-- be the live one ("A3 NOT applied", memory 2026-07-25). Restating the whole
-- vocabulary converges production on the client's actual EVENTS table
-- (lib/analytics.js) from either starting point — and quietly repairs
-- 'filtered' rejection if A3 never ran.

ALTER TABLE public.usage_events
  DROP CONSTRAINT IF EXISTS usage_events_name_check;

ALTER TABLE public.usage_events
  ADD CONSTRAINT usage_events_name_check CHECK (name IN (
    -- lifecycle (A1)
    'opened_app',
    'signed_up',
    -- install funnel (A1)
    'install_prompt_shown',
    'install_prompt_accepted',
    'install_prompt_dismissed',
    'installed_pwa',
    -- what people do (A1)
    'created_event',
    'published_event',
    'applied',
    'sent_message',
    'sent_voicey',
    'followed',
    'shared',
    -- the shape of a visit (A2)
    'screen_view',
    'session_end',
    'error',
    -- A3 · what people ASK for
    'filtered',       -- props.surface + the facets; NEVER the query text
    -- O2 · the participation funnel
    'gate_shown',     -- props.action only; never an id or a name
    'intent_resumed'  -- props.action + props.done
  ));
