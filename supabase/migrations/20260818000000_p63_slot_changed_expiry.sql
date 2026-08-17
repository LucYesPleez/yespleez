-- P6.3 · classify the `slot_changed` notification for expiry.
--
-- ⭐ WHY THIS MIGRATION EXISTS AT ALL. `notification_expiry_policy` must account
-- for EVERY type in `lib/notifMeta`, and `expiryPolicy.test.js` fails the build
-- when one is neither classified nor deliberately retained. Adding a notification
-- type is therefore never a one-file change, which is the point: an unclassified
-- notification never expires and nothing says so.
--
-- ⭐ `event`, matching its two siblings exactly:
--     slot_offer    'a response window that closes with the event'
--     slot_removed  'expires with the event'
--   A changed set time is meaningless once the event has passed, and it carries an
--   event_id, so the event-bound policy applies without a new category.
--
-- ⚠ NOT a response window. `slot_offer` opens one because the artist may accept or
-- decline; a CHANGE asks for nothing. Ratified 2026-08-18: moving a set time
-- notifies, and ⛔ requires NO re-acceptance. Acknowledgement is a separate
-- system (P6.4, `slot_acknowledgements`) and ⛔ nothing here depends on it.
--
-- ⛔ IDEMPOTENT. This table is written by more than one migration and re-running a
-- corrected script must be safe.

-- ⛔⛔ THE COLUMN LIST IS `(type, policy, note)`, MATCHING N4. `policy` is
-- CONSTRAINED to ('never','event','enquiry'); it is the CLASSIFICATION, ⛔ not a
-- description. Writing `(type, category, policy)` puts the prose in `policy` and
-- fails with 23514 — this migration did exactly that on its first run.
insert into public.notification_expiry_policy (type, policy, note) values
  -- ⛔⛔ NO SEMICOLON IN THE NOTE. `expiryPolicy.test.js` reads the statement up
  -- to its terminating `;`, so one inside the string truncates the tuple and the
  -- classification silently vanishes. The same trap is documented in N4's own
  -- comment, and this migration walked into that one too.
  ('slot_changed', 'event', 'P6.3: expires with the event, a moved set time is meaningless afterwards')
on conflict (type) do nothing;

-- ⚠ FAILURE IS LOUD, SUCCESS IS SILENT — the Supabase SQL editor does not display
-- RAISE NOTICE, so a passing run shows only "Success. No rows returned".
do $$
begin
  if not exists (select 1 from public.notification_expiry_policy where type = 'slot_changed') then
    raise exception 'P6.3 FAILED: slot_changed was not classified';
  end if;
end $$;
