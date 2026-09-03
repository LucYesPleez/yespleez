-- BA1 · BOOKING AGREEMENTS — the negotiated terms between an accepted enquiry
-- and an event.
--
-- ⭐⭐ READ THIS BEFORE CHANGING ANYTHING HERE.
--
-- The lifecycle this table serves, ratified 2026-08-31:
--
--     ENQUIRY → ACCEPTED → BOOKING AGREEMENT → AGREED → EVENT → SLOT → PAID
--
-- ⛔⛔ ACCEPTED IS NOT AGREED. Accepting an enquiry says "yes, let's do this" —
-- it does NOT agree the fee. The enquiry's `proposed_fee` is the applicant's
-- REQUESTED amount and stays that forever; what the two parties settle on is a
-- row in here. Overwriting `proposed_fee` on acceptance would destroy the one
-- record of what was originally asked for, and the system must be able to
-- answer "what did the artist initially request" long after the fact.
--
-- ⛔⛔ AGREED IS NOT PAID. There is deliberately NO payment column in this
-- migration: nothing in the app records a payment yet, and a column nothing
-- writes reads as "not paid" for every booking that ever was. Payment is its
-- own fact and gets its own migration when there is something to write it.
--
-- ── ⭐⭐ APPEND-ONLY, AND THE STATUS IS DERIVED ──────────────────────────
--
-- ONE table, one row per PROPOSAL, ⛔ never updated in place. There is no
-- `booking_agreements` current-state table beside it, because a current-state
-- row and a history row are two answers to one question and they drift:
--
--     the CURRENT agreement   = the highest `version` for the enquiry
--     SUPERSEDED              = a higher version exists   ← derived, not stored
--     AGREED                  = `accepted_at` is set
--     REJECTED                = `rejected_at` is set
--
-- ⭐ Computing a state is the only way it cannot lie (project_derived_state_
-- philosophy). ⛔ Do not add a `status` column here: it would have to be
-- rewritten on every counter-proposal, which is an UPDATE on a row this table
-- exists to keep immutable, and the update would be the thing that destroys
-- the audit trail.
--
-- ⚠ THE PROPOSER DOES NOT ACCEPT THEIR OWN PROPOSAL. Proposing IS agreeing, on
-- your side. So a version is AGREED when the OTHER party accepts it, which is
-- why `accepted_by_profile_id` is checked against `proposed_by_profile_id`
-- below rather than merely being recorded.
--
-- ── ⚠ THE PARENT IS A bigint ────────────────────────────────────────────
--
-- `venue_enquiries.id` is bigint, not uuid — ids are not uniform in this
-- schema (reference_yespleez_id_types) and assuming uuid here would fail at
-- the FK. This row's own id is a uuid like everything else written since.
--
-- ── TERMS LIVE IN JSONB, AND THAT IS DELIBERATE ─────────────────────────
--
-- Fee and currency are COLUMNS because every agreement has them and because
-- money must be queryable. Everything else — bar split, door split, minimum
-- spend, set time, load-in, soundcheck, equipment, hospitality — is optional,
-- differs per venue, and would be twelve mostly-null columns. They live in
-- `terms` jsonb.
--
-- ⛔⛔ NEVER DERIVE SCHEMA FROM THOSE KEYS. `terms` is a value, not a table:
-- its keys are not columns and a PostgREST select naming one will 42703
-- (feedback_schema_from_catalog_not_json). Read the whole object and pick keys
-- in the client.

create table if not exists public.booking_agreement_versions (
  id                      uuid primary key default gen_random_uuid(),

  -- ⚠ bigint, matching venue_enquiries.id. Cascade: an agreement is meaningless
  -- without the enquiry it negotiates, and a deleted enquiry must not leave a
  -- fee record pointing at nothing.
  enquiry_id              bigint not null
                            references public.venue_enquiries(id) on delete cascade,

  -- 1, 2, 3 … in the order they were proposed. ⭐ The reader's own vocabulary
  -- ("v3 — Revised") is this number, so it is stored rather than computed from
  -- created_at ordering, which two proposals in the same second would tie.
  version                 integer not null check (version >= 1),

  -- WHO PROPOSED IT. A profile, ⛔ never an account: one account may hold both
  -- a venue and a DJ act, and "who moved" must name the party, not the human.
  proposed_by_profile_id  uuid not null references public.profiles(id) on delete restrict,

  -- AUDIT ONLY. ⛔ Never consulted for permission.
  proposed_by_user_id     uuid references auth.users(id) on delete set null,

  -- ⭐ THE MONEY IS A COLUMN. numeric, ⛔ not the enquiry's free `text` — that
  -- column holds whatever was typed and cannot be summed, compared or totalled.
  -- An agreement is a commercial record and has to be readable as one.
  -- ⚠ NULLABLE: an exposure/door-deal booking genuinely has no fee, and a 0
  -- would claim someone agreed to nothing rather than to a different structure.
  fee                     numeric(10,2) check (fee is null or fee >= 0),

  -- ⚠ Stated, never assumed. Defaulted to AUD because that is where this runs,
  -- but stored on the row so a booking never has to be guessed at later.
  currency                text not null default 'AUD' check (char_length(currency) = 3),

  -- Optional operational terms. See the header: keys are NOT columns.
  terms                   jsonb not null default '{}'::jsonb,

  -- Free text the proposer attached to THIS version — "can't do 900 but the
  -- bar's been good lately". ⛔ Not a message: the conversation lives in
  -- messaging, and content never leaves it (§C32). This is a note ON the offer.
  note                    text,

  -- ── THE TWO SETTLEMENTS. Both nullable, both write-once in practice. ──
  --
  -- ⚠ ACCEPTANCE IS BY THE OTHER PARTY. Enforced in the policy below, not
  -- merely expected here.
  accepted_at             timestamptz,
  accepted_by_profile_id  uuid references public.profiles(id) on delete set null,

  -- ⚠ REJECTION IS RARELY WRITTEN and that is correct: countering with a new
  -- version is the normal "no". An explicit rejection is for walking away
  -- without a counter, and it is kept so the trail can say which happened.
  rejected_at             timestamptz,
  rejected_by_profile_id  uuid references public.profiles(id) on delete set null,

  created_at              timestamptz not null default now(),

  -- ⛔ A version cannot be both accepted and rejected. The two are answers to
  -- the same question and a row holding both cannot be read.
  constraint booking_agreement_versions_one_outcome
    check (accepted_at is null or rejected_at is null)
);

-- ⭐ THE VERSION NUMBER IS THE IDENTITY. Two clients proposing at once must not
-- both become v4 — one of them loses the race and retries with v5, which is
-- the correct outcome and the only one that keeps the trail readable.
create unique index if not exists booking_agreement_versions_enquiry_version
  on public.booking_agreement_versions (enquiry_id, version);

create index if not exists idx_booking_agreement_versions_enquiry
  on public.booking_agreement_versions (enquiry_id, version desc);

alter table public.booking_agreement_versions enable row level security;

-- ⭐ Supabase auto-grants ALL to anon on a new table — the explicit reset is
-- the M1 lesson. ⛔ anon gets NOTHING: a fee is commercially private and must
-- never sit on a public row (project_event_economics_roadmap).
-- ⛔ NO DELETE for anyone. This table is the audit trail; a party who could
-- delete a version could delete the record of what they offered.
revoke all on public.booking_agreement_versions from anon, authenticated;
grant select, insert, update on public.booking_agreement_versions to authenticated;

-- ── ⚠ AUTHORITY COMES FROM THE PARENT ENQUIRY ──────────────────────────
--
-- Every policy asks "is this account one of the two parties on the enquiry?"
-- via `venue_user_id` / `applicant_user_id`.
--
-- ⛔ NOT can_act_as(profile) alone, deliberately: `profiles.user_id` is NULL
-- for most rows (project_user_id_is_not_an_identity), and an UNCLAIMED venue
-- profile that can_act_as cannot answer for is exactly how a venue was locked
-- out of writing its own event. The enquiry names both ACCOUNTS outright and
-- is the record that already governs this relationship.
create or replace function public.is_enquiry_party(p_enquiry_id bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.venue_enquiries e
    where e.id = p_enquiry_id
      and auth.uid() in (e.venue_user_id, e.applicant_user_id)
  );
$$;

comment on function public.is_enquiry_party(bigint) is
  'Is the caller one of the two accounts on this enquiry? Authority for booking agreements comes from the parent enquiry, not from can_act_as(profile) — profiles.user_id is null for most rows and would lock out unclaimed venue profiles.';

drop policy if exists "read agreements on your own enquiries" on public.booking_agreement_versions;
create policy "read agreements on your own enquiries" on public.booking_agreement_versions
  for select to authenticated
  using (public.is_enquiry_party(enquiry_id));

-- ⛔ ATTRIBUTION MUST ITSELF BE AUTHORIZED. Without the can_act_as check a
-- party could propose in the OTHER side's name — forgeable attribution is
-- worse than none, and this trail's whole value is who moved.
drop policy if exists "propose on your own enquiries" on public.booking_agreement_versions;
create policy "propose on your own enquiries" on public.booking_agreement_versions
  for insert to authenticated
  with check (
    public.is_enquiry_party(enquiry_id)
    and public.can_act_as(proposed_by_profile_id)
    -- ⛔ A PROPOSAL IS NOT BORN SETTLED. Accepting is a separate act by the
    -- other party; inserting a row already marked accepted would let one side
    -- agree with itself.
    and accepted_at is null
    and rejected_at is null
  );

-- ── ⛔⛔ THE ONLY LEGAL UPDATE IS SETTLING A VERSION YOU DID NOT PROPOSE ──
--
-- `using` finds rows the caller may touch: an unsettled version proposed by
-- the OTHER party. `with check` constrains what they may leave behind. The two
-- together mean a version's terms can never be edited after the fact — the row
-- is immutable except for its outcome.
--
-- ⚠ Postgres cannot compare to the pre-image inside with_check, so the terms
-- are protected by `using` finding only unsettled rows plus the client never
-- sending them; the belt-and-braces trigger below makes it structural.
drop policy if exists "settle the other party's proposal" on public.booking_agreement_versions;
create policy "settle the other party's proposal" on public.booking_agreement_versions
  for update to authenticated
  using (
    public.is_enquiry_party(enquiry_id)
    and accepted_at is null
    and rejected_at is null
    -- ⛔ NOT YOUR OWN. Proposing already IS agreeing on your side; a party that
    -- could accept its own proposal would make "AGREED" mean nothing.
    and not public.can_act_as(proposed_by_profile_id)
  )
  with check (public.is_enquiry_party(enquiry_id));

-- ⛔⛔ THE TERMS ARE IMMUTABLE. A policy cannot see the old row's values, so
-- the guarantee that v2 still says what v2 said is enforced here or nowhere.
-- Without this, "do not destroy historical values" is a convention the client
-- happens to follow rather than a property of the data.
create or replace function public.booking_agreement_versions_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.enquiry_id is distinct from old.enquiry_id
     or new.version is distinct from old.version
     or new.proposed_by_profile_id is distinct from old.proposed_by_profile_id
     or new.fee is distinct from old.fee
     or new.currency is distinct from old.currency
     or new.terms is distinct from old.terms
     or new.note is distinct from old.note
     or new.created_at is distinct from old.created_at then
    raise exception 'A booking agreement version is immutable: counter with a new version instead of editing v%', old.version;
  end if;
  return new;
end;
$$;

drop trigger if exists booking_agreement_versions_no_rewrite on public.booking_agreement_versions;
create trigger booking_agreement_versions_no_rewrite
  before update on public.booking_agreement_versions
  for each row execute function public.booking_agreement_versions_immutable();

comment on table public.booking_agreement_versions is
  'Append-only negotiation trail between an accepted enquiry and an event. One row per proposal; never edited (trigger-enforced). Status is DERIVED: current = highest version, superseded = a higher version exists, agreed = accepted_at set. Accepted is not paid — there is no payment column here on purpose.';

comment on column public.booking_agreement_versions.fee is
  'The fee THIS version proposes. Null is legitimate (exposure / door deal) and is not zero. The enquiry''s own proposed_fee is the applicant''s REQUESTED amount and is never overwritten by this.';

comment on column public.booking_agreement_versions.terms is
  'Optional operational terms (bar_split, door_split, min_spend, set_time, set_duration, load_in, soundcheck, equipment, hospitality, other). A VALUE, not a schema: never select a key as a column.';

-- ── VERIFY ──────────────────────────────────────────────────────────
--
-- -- anon is shut out entirely (expect: permission denied):
-- set role anon; select * from public.booking_agreement_versions limit 1;
--
-- -- a version cannot be rewritten (expect: the immutability exception):
-- update public.booking_agreement_versions set fee = 1 where version = 1;
--
-- -- ⭐ RUN A CONTROL. A probe that returns the same answer for pass and fail
-- -- measures nothing (feedback_service_role_needs_both_headers): confirm the
-- -- select above SUCCEEDS as an authenticated party to the enquiry before
-- -- believing the anon refusal means anything.
