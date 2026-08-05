-- ============================================================
-- SEC-6a · DISMISSAL, NOT DELETION — a notification leaves the
--          inbox without leaving the database.
-- Closes backlog S39. Supersedes its premise; see below.
-- ============================================================
--
-- WHAT WAS WRONG
--
-- `notifications` has SELECT, INSERT and UPDATE policies and no DELETE
-- policy, so a recipient cannot remove a notification from their own
-- inbox at all. S39 recorded that as "users can't delete their own
-- notifications" and the obvious reading is that a DELETE policy is
-- missing.
--
-- ── S39's PREMISE IS SUPERSEDED (owner decision, 2026-08-04) ─────
--
-- The requirement is that a user can remove a notification FROM VIEW.
-- It is not that the record must be destroyed. Those are different
-- things, and this subsystem has already chosen between them once:
--
--   "A held notification is an asset; a suppressed one is a deleted
--    fact."                                        — N1, Phase 13.2 Q1
--
-- Every mechanism here is built on that grain. Held state is the
-- ABSENCE of a delivery identity rather than a flag (N1). A muted
-- notification is still WRITTEN and merely uncounted (NP1) — the
-- preference governs delivery, never existence. `suppressed_at`,
-- `read` and `channel` already give a vocabulary for "this row exists
-- and is not being shown". Dismissal is one more word in that
-- vocabulary, not a new idea.
--
-- ── WHY THIS MATTERS MORE SINCE SEC-1 ───────────────────────────
--
-- The INSERT policy is `auth.role() = 'authenticated'` with nothing
-- tying the row to its writer, so any signed-in user can address a
-- notification to anyone, with arbitrary `type`, `message` and `data`.
-- That is confirmed, not theoretical.
--
-- A forged row is therefore EVIDENCE. The natural reaction to a
-- suspicious notification is to get rid of it, and a DELETE policy
-- would hand the victim a button that destroys the only record of the
-- attack — leaving abuse investigation with nothing to read. Dismissal
-- keeps the row and removes the annoyance, which is what was actually
-- wanted.
--
-- ⚠ This migration does NOT fix SEC-1. Constraining the INSERT is a
-- separate change that must be preceded by an audit of all
-- `writeNotification` call sites: most ignore the function's return
-- value, so a tightened policy would fail SILENTLY at the point of
-- write. Do not fold the two together.
--
-- ── STILL NO DELETE POLICY, DELIBERATELY ────────────────────────
--
-- None is added here. RLS is enabled on the table, so the absence of a
-- DELETE policy denies deletion to every ordinary role — that is the
-- intended end state, not an oversight to be corrected later.
--
-- ── HELD ROWS ARE UNAFFECTED ────────────────────────────────────
--
-- Held rows carry to_user_id IS NULL. Every policy on this table keys
-- on `auth.uid() = to_user_id`, and SQL equality never matches NULL,
-- so no held row can be dismissed by anyone — including the eventual
-- claimant, until N3 delivery populates to_user_id. That is correct:
-- an undelivered asset is not yet anyone's to clear.
-- ============================================================


-- ── 1 · THE COLUMN ──────────────────────────────────────────────
-- Nullable timestamptz, matching `suppressed_at`'s shape. NULL means
-- "in the inbox"; a timestamp means "the recipient cleared it, at this
-- moment". A timestamp rather than a boolean because when it happened
-- is the interesting part for abuse investigation, and a boolean can
-- never be widened into one.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

COMMENT ON COLUMN public.notifications.dismissed_at IS
  'When the recipient removed this from their inbox. NULL = visible. '
  'The row is never deleted: see SEC-6a and N1 — a dismissed '
  'notification is hidden, not a deleted fact.';


-- ── 2 · READ PATH SUPPORT ───────────────────────────────────────
-- Every reader filters `to_user_id = <uuid>` (the N1 reader contract,
-- asserted statically in v2/src/lib/notificationReaders.test.js) and
-- will now also filter `dismissed_at IS NULL`. A partial index matching
-- that exact shape keeps the badge query cheap as dismissed rows
-- accumulate, since they accumulate forever by design.
CREATE INDEX IF NOT EXISTS notifications_inbox_idx
  ON public.notifications (to_user_id)
  WHERE dismissed_at IS NULL;


-- ── 3 · MAKE THE PRESERVED RECORD WORTH PRESERVING ──────────────
--
-- ⚠ This is the half that makes §2's forensic argument true rather
-- than merely stated.
--
-- The UPDATE policy is `USING (auth.uid() = to_user_id)` with no
-- WITH CHECK — which Postgres satisfies by reusing USING, so a
-- recipient cannot reassign a row to someone else. Correct as far as
-- it goes. But RLS cannot restrict WHICH COLUMNS an UPDATE touches, so
-- today a recipient may rewrite `message`, `type` or `data` on their
-- own notification. A record anyone can rewrite is not evidence.
--
-- Column-level privileges are the only mechanism that can express
-- this. Verified against the client before revoking: the sole column
-- any client write sets today is `read`
--   NotifPanel.jsx:41,61 · NotificationsScreen.jsx:68 · contactJoins.js:78
--
-- ⚠ CORRECTED 2026-08-05 · `responded_at` DID NOT EXIST.
--
-- This note originally read "granted although NOTHING WRITES IT YET",
-- and granted the column on the assumption it was already there. It was
-- not: no migration in this repository has ever created it. Applying
-- this file unamended fails at the GRANT with
--
--   ERROR: 42703: column "responded_at" of relation "notifications"
--          does not exist
--
-- and, because the SQL editor runs the script as ONE transaction, takes
-- the whole migration down with it. Confirmed against the live database.
--
-- ⭐ WHY THIS WAS INVISIBLE, AND WHY THAT MATTERS MORE THAN THE TYPO.
--
-- `markResponded()` is deliberately fire-and-forget (notifActions.js:57)
-- so that failing to stamp a receipt cannot present as the accept or
-- decline having failed. Correct — but it means the 42703 from EIGHT
-- client call sites (NotifPanel.jsx:198,206,214,222 ·
-- NotificationsScreen.jsx:176,184,192,200) is swallowed in silence. The
-- row offers ACCEPT and DECLINE again, which is indistinguishable from
-- the bug e5a596b set out to FIX, with no error anywhere to say why.
--
-- So the column is created here rather than merely granted. Without it
-- e5a596b is inert: the replayable-response defect it names stays open,
-- and the only symptom is the one it was supposed to remove.
-- ⚠ INTERACTION WITH N3 · CHECK BEFORE APPLYING.
-- `deliver_held_notifications()` (n3_claim_delivery) sets `to_user_id`,
-- which is deliberately NOT granted below — delivery is a system act,
-- never a client one. If that function still runs with INVOKER rights
-- it will now fail on privileges as well as on RLS. It is already
-- recorded as unable to match a held row under invoker rights, so this
-- changes a broken path's failure mode rather than breaking a working
-- one — but the fix is the same either way: make it SECURITY DEFINER,
-- with `search_path` pinned, as `apply_notification_preferences`
-- already is. Confirm before applying:
--
--   SELECT proname, prosecdef FROM pg_proc
--    WHERE proname IN ('deliver_held_notifications','on_profile_claimed');
--
-- prosecdef = false on either means fix that first.
--
-- ── RESOLVED · BOTH ARE `false`, AND THAT IS SAFE TODAY ─────────
--
-- Checked against the live database, 2026-08-05: `prosecdef = false` on
-- BOTH functions. Applied anyway, deliberately, and SECURITY DEFINER is
-- NOT added. The check above was written as a precaution without
-- establishing WHO invokes the function. Traced, it does not bite:
--
--   · `approve_profile_claim()` is not callable by authenticated users.
--     c1_profile_claim_requests.sql:289 —
--       REVOKE EXECUTE ON FUNCTION public.approve_profile_claim(bigint)
--         FROM PUBLIC, anon, authenticated;
--
--   · `deliver_held_notifications()` therefore executes only through the
--     SQL editor or Studio's `service_role` — it runs solely via the N3
--     trigger inside `approve_profile_claim()`, and no client code calls
--     either function (grep of v2/src returns comments and tests only).
--     The REVOKE below names `anon, authenticated`; `service_role` keeps
--     UPDATE on every column, `to_user_id` included. The privilege
--     failure this note feared needs the invoker to be a revoked role.
--
--   · Claim completion has NOT moved into the application. That is
--     enforced by the database, not promised by the client — see the
--     REVOKE EXECUTE above.
--
-- ⚠ REVISIT SECURITY DEFINER ONLY IF CLAIM COMPLETION BECOMES
--    USER-INITIATED. On that day `deliver_held_notifications()` begins
--    running as `authenticated`, and it will then need SECURITY DEFINER
--    with `search_path` pinned AND the SEC-1 INSERT `with_check` fix
--    TOGETHER — which is exactly the pairing n3_claim_delivery.sql:128
--    deferred to a dedicated pass. Adding it now would do half of that:
--    expand privilege without the INSERT constraint meant to accompany
--    it. n3:131 says revisit "BEFORE moving claim completion into the
--    app"; that move has not happened, so the trigger has not fired.
-- The column the GRANT below depends on. Same shape as `dismissed_at`
-- and `suppressed_at`: nullable timestamptz, NULL meaning "unanswered".
-- A timestamp rather than a boolean for the same reason — when a person
-- answered is the interesting part, and a boolean never widens into one.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS responded_at timestamptz;

COMMENT ON COLUMN public.notifications.responded_at IS
  'When the recipient answered an actionable notification. NULL = still '
  'awaiting a response, and the row shows its ACCEPT/DECLINE buttons. '
  'Stamped by markResponded() AFTER the underlying action commits, so a '
  'failure here re-offers the buttons rather than losing the action.';

REVOKE UPDATE ON public.notifications FROM anon, authenticated;

GRANT UPDATE (read, dismissed_at, responded_at)
  ON public.notifications TO authenticated;


-- ── VERIFY ──────────────────────────────────────────────────────
-- Expect: the column present, and `authenticated` holding UPDATE on
-- exactly three columns and no others.
--
--   SELECT column_name, privilege_type
--     FROM information_schema.column_privileges
--    WHERE table_name = 'notifications'
--      AND grantee = 'authenticated'
--      AND privilege_type = 'UPDATE'
--    ORDER BY column_name;
--
-- Expect no DELETE policy, now or later:
--
--   SELECT policyname, cmd FROM pg_policies
--    WHERE tablename = 'notifications' AND cmd = 'DELETE';
