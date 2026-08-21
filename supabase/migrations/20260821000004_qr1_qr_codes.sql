-- QR1 · SAVED QR CODES — the user's library, ⛔ not the QR itself.
--
-- ⭐⭐ READ THIS BEFORE CHANGING ANYTHING HERE.
--
-- A scan does NOT touch this table. The printed address is
--
--     https://yespleez.com/#/q/{destination_type}/{destination_id}
--
-- and `lib/qrDestinations.resolveDestination()` turns that into an in-app route
-- with no database round trip at all. That is deliberate and it is the whole
-- architecture: a QR is a printed object that can never be corrected, so
-- ⛔ NOTHING a person can delete may be able to break one. Drop this table
-- entirely and every code already on a wall keeps working; only the library
-- screen goes empty.
--
-- What this table IS: "the QR codes I have made", so a venue does not
-- regenerate the same poster every time, and so the set of printed artefacts is
-- knowable. The brief's rule stated as schema: store the QR IDENTITY and its
-- DESTINATION; the PNG and the PDF are exports, ⛔ never the canonical object,
-- and neither is stored.
--
-- ── ⭐ THE IDENTITY CONTRACT (CLAUDE.md) ────────────────────────────────
--
--   1. the row names its ACTOR      owner_profile_id, not null, stamped at write
--   2. the row names the HUMAN      created_by_user_id, for audit and nothing else
--   3. authorization goes through the seam, and only the seam — can_act_as()
--
-- ⛔ `created_by_user_id` IS NEVER CONSULTED FOR PERMISSION. Every policy below
-- tests `can_act_as(owner_profile_id)` and nothing else. A venue that changes
-- hands keeps its QR library, because the library belongs to the PROFILE.
--
-- ── ⚠ destination_id HAS NO FOREIGN KEY, AND CANNOT ─────────────────────
--
-- It points at `events` for event/set-times and at `profiles` for
-- venue/whats-on/artist/festival. One column, two tables, so no FK expresses
-- it, and ⛔ splitting into `event_id` / `profile_id` would be a second
-- destination model that drifts from `lib/qrDestinations.js`.
--
-- The consequence is honest and handled in the client: a saved QR whose event
-- was deleted renders as a dead destination and says so, per the rendering
-- contract (Absent ≠ Withheld ≠ Unknown). ⛔ It is NOT silently hidden — the
-- user may have that code printed, and needs to know it now goes nowhere.
--
-- ── ⛔ NO SCAN TRACKING HERE ────────────────────────────────────────────
--
-- The brief asks that analytics be POSSIBLE later, and asks equally that V1 not
-- build tracking to prove it. There is no scan table, no counter, and no
-- last_scanned_at. The seam is `?s={qr_code_id}` on the destination URL
-- (documented in lib/qrDestinations.js), which nothing writes and nothing
-- reads. Adding a scan record later is a new table plus a privacy answer that
-- satisfies the analytics ruling on masked event ids — ⛔ not a column here.

create table if not exists public.qr_codes (
  id                  uuid primary key default gen_random_uuid(),

  -- AUTHORITY. Any profile type may hold a library; who may create one is
  -- decided by the destination rules in the client and by can_act_as here.
  owner_profile_id    uuid not null references public.profiles(id) on delete cascade,

  -- AUDIT ONLY. ⛔ Never in a policy.
  created_by_user_id  uuid references auth.users(id) on delete set null,

  -- ⚠ THE CHECK IS THE PRINTED CONTRACT. These strings are path segments in
  -- addresses that may already be on posters. ⛔ Never rename one; only ever
  -- ADD. `festival` is listed although the client does not offer it yet.
  destination_type    text not null check (destination_type in
                        ('event','set-times','venue','whats-on','artist','festival')),
  destination_id      uuid not null,

  -- The name at the time of saving, so the library can list a row whose
  -- destination has since been deleted. ⚠ A CACHE, not the truth: the client
  -- prefers the live name wherever it can read one.
  label               text,

  -- 'active' | 'archived'. ⛔ There is no delete-the-artefact concept: a
  -- printed code cannot be recalled, so retiring one archives the record and
  -- keeps it visible under a filter. Same reasoning as notification dismissal.
  status              text not null default 'active' check (status in ('active','archived')),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ⭐ "The same QR should be reusable. Do not force users to create a new one
-- every time they need the same destination." — enforced, not merely intended.
-- Partial, so archiving one and making a fresh one later is still allowed.
create unique index if not exists qr_codes_one_active_per_destination
  on public.qr_codes (owner_profile_id, destination_type, destination_id)
  where status = 'active';

create index if not exists idx_qr_codes_owner on public.qr_codes (owner_profile_id, status);
create index if not exists idx_qr_codes_destination on public.qr_codes (destination_type, destination_id);

alter table public.qr_codes enable row level security;

-- ⭐ Supabase auto-grants ALL to anon on a new table — the explicit reset is
-- the M1 lesson. ⛔ anon gets NOTHING here: the library is private, and the
-- destination it points at is public on its own terms.
revoke all on public.qr_codes from anon, authenticated;
grant select, insert, update, delete on public.qr_codes to authenticated;

drop policy if exists "read own qr codes" on public.qr_codes;
create policy "read own qr codes" on public.qr_codes
  for select to authenticated
  using (public.can_act_as(owner_profile_id));

-- ⛔ ATTRIBUTION MUST ITSELF BE AUTHORIZED. Without the with_check any
-- authenticated client could insert a row claiming to belong to a venue it does
-- not own — forgeable attribution is worse than none.
drop policy if exists "create qr codes for profiles you act as" on public.qr_codes;
create policy "create qr codes for profiles you act as" on public.qr_codes
  for insert to authenticated
  with check (public.can_act_as(owner_profile_id));

-- ⚠ BOTH using AND with_check. `using` alone would let an owner rewrite the row
-- to belong to a profile they do not act as, moving it out of their own reach
-- and into someone else's library.
drop policy if exists "update own qr codes" on public.qr_codes;
create policy "update own qr codes" on public.qr_codes
  for update to authenticated
  using (public.can_act_as(owner_profile_id))
  with check (public.can_act_as(owner_profile_id));

drop policy if exists "delete own qr codes" on public.qr_codes;
create policy "delete own qr codes" on public.qr_codes
  for delete to authenticated
  using (public.can_act_as(owner_profile_id));

comment on table public.qr_codes is
  'Saved QR codes: the user library. A scan resolves /q/{type}/{id} client-side and NEVER reads this table, so deleting a row cannot break a printed code. Exports (PNG/PDF) are generated from the destination and are not stored.';

comment on column public.qr_codes.created_by_user_id is
  'Audit only. Never consulted for permission — every policy tests can_act_as(owner_profile_id).';

comment on column public.qr_codes.destination_id is
  'Points at events.id or profiles.id depending on destination_type. Deliberately no FK: one column, two tables. A dangling destination renders as a dead QR in the client rather than disappearing.';

-- ── VERIFY ──────────────────────────────────────────────────────────
--
-- -- anon is shut out entirely:
-- set role anon;
-- select * from public.qr_codes;                  -- expect 42501
-- reset role;
--
-- -- the four policies exist and all four name can_act_as:
-- select policyname, cmd, qual, with_check from pg_policies
--  where tablename = 'qr_codes';                  -- expect 4 rows, can_act_as in each
--
-- -- ⛔ the forged-attribution check. As a signed-in user, inserting a row for a
-- -- profile you do not act as must be rejected, not accepted-and-hidden:
-- --   insert into qr_codes (owner_profile_id, destination_type, destination_id)
-- --   values ('<someone-elses-profile>', 'venue', '<their-profile>');
-- --   expect 42501
--
-- -- reuse rather than duplication:
-- --   insert the same (owner, type, destination) twice -> expect 23505 on the second
