# Handover — platform session, 2026-08-07 (evening)

## Project State (2026-08-07)

The platform architecture is complete enough to build against. The implementation
is in a deliberate transition: core architectural decisions are ratified, but
several are not yet realised in code. The monorepo migration is planned and
documented but has not begun. **Read this handover as an execution guide, not as a
statement that the architecture is already implemented.**

---

**Supersedes `handover-festival-thread-2026-08-07.md`** for execution state. That
document is still correct about the Festival Portal's product state; this one
carries what changed after it, across **both repos and the database**.

The decisions from today are in memory. **This file exists for the sequencing** —
what is blocked on what, and why the next step is the next step. That is the part
that does not survive a context boundary.

---

## 1 · Current state

| | |
|---|---|
| **Festival UX** | ✅ Frozen — 9 ratified stages, `YesPleez Festival Portal/docs/FESTIVAL_UX_v1.md` |
| **Companion Home** | ✅ Built and verified against live data, `/#/companion`, Portal `09f42b8` |
| **Shared Event Editor** | ✅ Extracted in Scene, `992fc62`. Scene runs on it |
| **Baseline schema** | ✅ Verified — production reproducible from Git, Scene `e99be46` |
| **M2 participation** | ✅ Verified on the VERIFY project, 14 acceptance tests |
| **Monorepo** | 📄 Plan written, Phase 0 prep done, **not started** |

Both repos are pushed, tagged **`pre-monorepo-2026-08-07`**, and mirrored offline.
Nothing exists only on this machine.

---

## 2 · Immediate blockers, in order — and why each precedes the next

**1. Release Scene `v2-react` → `main`.**
`main..v2-react` is **11 commits**, including the festival apply flow. Everything
below is blocked by this, for two separate reasons: the monorepo cutover would
otherwise be the first build from a new root *and* ship 11 commits of product
work — if it breaks you cannot tell which payload did it. And end-to-end applicant
testing is impossible while production runs a build that cannot take a festival
application.

**2. Resolve PR #2** (`fix/autoclaim-scope-and-applications-profile`).
It touches `events.js`, `index.html`, `profiles.js` — three of the 17 legacy v1
files at the repo root. Merged *after* the legacy tree moves it conflicts, and the
reflex resolution (`git add -A`) silently restores legacy v1 to the repo root,
disarming the main defence against a wrong-but-successful build.

**3. Decide repository visibility.**
Scene is PUBLIC, the Portal PRIVATE; a monorepo forces one.
⭐ **Recommend private, before any push.** Going private is reversible; publishing
the Portal's 48 commits is not — GitHub serves unreachable commits by SHA forever.
⭐ **Nothing new is exposed either way**: the anon key is already in Scene's public
`state.js`, the allowlist email in four tracked Scene files since `38841c1`. It is
a publishing decision, not a security remediation.

**4. Complete Phase 0 monorepo preparation.**
Steps 0.5–0.11 of the plan. Includes populating **Scene's Preview environment
variables**, which are currently empty — so `v2-react.yespleez.pages.dev` does not
boot and production is the only test surface. Biggest risk multiplier in the plan.

**5. Begin Phase 1 migration.**

---

## 3 · Production state

- **The verify project is correct.** `opdgflctitruzgfuobyg`, free org "YesPleez
  Verify", holds baseline + D2 + M2 + M2a and passes 14 behavioural tests.
- ~~**Production has NOT received M2.** No participation tables, no
  `accept_festival_applications`.~~
- ~~⚠ **Accepting an application fails in the live beta today.** `decide()` routes
  every acceptance through an RPC that does not exist there.~~

  ⛔ **BOTH CLAIMS ABOVE ARE FALSE. Corrected 2026-08-08 by direct object audit
  of production.** All three tables, all five triggers, both read policies,
  `accept_festival_applications` and `notify_festival_outcome` are PRESENT —
  as are F2's two follows indexes. **M2 is in production. Do not re-apply it:**
  `CREATE POLICY` and `CREATE TRIGGER` have no `IF NOT EXISTS`, and the SQL
  editor runs one transaction, so a re-run aborts the lot.

  ⚠⚠ **THE LESSON MATTERS MORE THAN THE FACT.** `project_participation_model`
  said "BUILT AND LIVE ON PRODUCTION" on the same day this said the opposite,
  and the memory was right. A handover records what was true when it was
  written; production is a live system that other sessions change.
  **Probe the database before acting on any claim about its state** — the audit
  is a single read-only query and it settles the question in seconds.
- ⚠ **End-to-end applicant testing is still blocked** by production being 11
  commits behind — `VITE_SCENE_URL` now points at `yespleez.pages.dev`, which is
  the right destination running the wrong build.

---

## 4 · Key findings

**`VITE_SCENE_URL` was missing from `.env.production`.** Every application link
the beta handed out pointed at `http://localhost:5174`. Fixed (`8381724`); the
file's own comment had predicted this exact failure.

**`accept_festival_applications` is deployed nowhere.** Committed in Scene
(`8c0e4dd`), absent from production. Found by diffing the schema dump against the
code, not by anything failing.

**`events.host_id` is `ON DELETE CASCADE` to `auth.users`.** Deleting an account
tries to delete every event that person created. Participation's `RESTRICT` now
blocks it. ⭐ Participation did not cause this — it **exposed** it. Before M2 the
delete would have silently succeeded, taking `festival_applications` with it.
Backlogged separately as an account-deletion workflow issue.

**A pg_dump baseline on Supabase is insecure without an explicit REVOKE reset.**
pg_dump emits GRANTs and never REVOKEs; Supabase grants ALL on every new table. The
first rebuild gave `anon` TRUNCATE on 46 tables where production allows 4.

**28 of 45 production tables were in no migration.** The four festival tables were
the visible corner of it.

**The polyrepo boundary is now the limiting factor.** The Event Editor extraction
succeeded and immediately hit the wall: the Portal cannot import from the Scene
repo, and Cloudflare builds each app from its own repo root. Every workaround is
either forking or fragile. That is what makes the monorepo the next structural
move rather than a tidy-up.

---

## 5 · First task next session

1. **Release Scene normally** — `v2-react` → `main`, by the usual ritual.
2. **Verify production** — that the festival apply flow is live and an application
   from Scene reaches the Portal.
3. **Then begin the monorepo migration**, Phase 0 onwards.
4. **Resume Festival's integration of the shared Event Editor after the repository
   move** — that is the step the whole extraction was for, and it cannot happen
   before the move.

**Step 4 is an architectural acceptance test, not an integration task.** The
success criterion is *not* "Festival can render the editor". It is:

> Festival renders the identical editor **without the shared package learning what
> Festival is.**

If the package needs `mode: 'scene' | 'festival'`, or starts branching on
application identity at all, that is evidence the boundary was drawn in the wrong
place — treat it as a finding, not a workaround. **The package knows about events,
not about applications.** Festival-specific behaviour belongs in the Festival
wrapper; Scene-specific behaviour belongs in the Scene wrapper. The shared editor
stays oblivious to its host.

This is the first genuine validation of the platform architecture rather than
another implementation milestone.

⛔ Do not apply M2 to production as part of any of the above. It is its own
deliberate deployment window, after the release and the move.

---

## Artefacts

| | |
|---|---|
| Monorepo plan (84KB, every step, rollback, verification) | `Claude Cowork/monorepo-migration-plan-2026-08-07.md` |
| Scene-thread hand-off (backend items + shared-editor spec) | `Claude Cowork/scene-thread-handoff-2026-08-07.md` |
| Frozen Festival UX | `YesPleez Festival Portal/docs/FESTIVAL_UX_v1.md` |
| Baseline migration | Scene `supabase/migrations/00000000000000_baseline.sql` |

## Things that will otherwise be rediscovered the hard way

- **Verify project**: pooler `aws-0-ap-south-1.pooler.supabase.com:5432`, user
  `postgres.opdgflctitruzgfuobyg`. **Production**: `aws-1-ap-southeast-1`, user
  `postgres.doqzxvppibuzieajqkxm`. ⚠ Fleet (`aws-0` vs `aws-1`) is per-project and
  not correlated with age; the wrong one gives `ENOTFOUND tenant/user`. Derive the
  region from the direct host's IPv6 against `ip-ranges.amazonaws.com` — it cannot
  be guessed from the project ref.
- ⛔ `npm install -g supabase` is blocked by Supabase; use `npx supabase@latest`.
  `supabase db dump` needs **Docker**; `pg_dump` does not.
- Password prompts are blind on Windows and paste often fails. Use
  `set "PGPASSWORD=…"` (quoted) with `-w`, then clear it.
- ⭐ Always `--single-transaction -v ON_ERROR_STOP=1`, so a failure leaves an empty
  database rather than a half-built one that diffs confusingly.
- ⚠ **A shell pipeline's exit status is the LAST command's.** `psql … | tail -4 &&
  echo "✓ applied"` prints ✓ on failure. Cost a wrong conclusion today.
- ⚠ The browser tool's console reader returns an **accumulating server-side
  buffer**; it cannot prove "no errors now". Prove health positively — assert the
  DOM rendered and interactions work.
- ⚠ Production's DB password passed through a chat today. Rotate it.
