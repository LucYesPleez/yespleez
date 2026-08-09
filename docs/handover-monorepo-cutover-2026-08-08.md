# Handover — the monorepo cutover, 2026-08-08

## Project State

The platform architecture is no longer a design. **Scene runs in production from the
monorepo**, three shared packages exist, and the Event Editor has been proven with two
independent consumers. What remains is one deployment (Festival's own Pages project) and
then product work.

**Supersedes `handover-platform-2026-08-07.md` for execution state.** That document is
still right about the Festival product and the decisions behind it, and ⛔ **wrong about
M2** — see §4.

Decisions live in memory. **This file is the sequencing** — what is blocked on what, and
what will bite you.

---

## 1 · Where everything is

| | |
|---|---|
| **Production** | `main` = `v2-react` = **`28a8602`**, built from `apps/scene/` |
| **Layout** | `apps/scene` · `apps/festival` · `packages/{event-editor,event-presentation,requirements}` |
| **Tests** | 865 Scene · 40 requirements · 14 presentation · 9 editor = **928** |
| **Festival Portal** | LIVE, still built from the **separate Portal repo** — not cut over |
| **Rollback** | the `yespleez-festival-portal` Pages project, untouched |
| **Backups** | `origin` + `backup` (OneDrive mirrors) on every branch |
| **Cloudflare baselines** | `OneDrive\repo-backups\cf-*-before.json` + `cloudflare-env-and-config-2026-08-08.txt` |

⚠ **There is no `v2/`.** Root `.claude/launch.json` names both dev servers: `scene` (5173),
`festival` (5180).

---

## 2 · Tomorrow's first task, and then stop

**Create the new Festival Pages project. Verify it. Then move to product.**

1. New project **`yespleez-festival`**
2. Bind `LucYesPleez/yespleez`
3. Production branch **`main`**
4. Root directory **`apps/festival`**
5. The pinned vite config is already shipped (`28a8602`)
6. Clean build
7. Verify its `pages.dev` by content
8. **Browser: Festival auth, then the shared Event Editor**
9. **load → edit → save on a real festival event**
10. Only then make it the production target

⛔⛔ **Do not delete, rebind or rename `yespleez-festival-portal`. It is the rollback.**
⚠ Needs a fresh **Edit-scoped** Cloudflare token — the cutover one was deleted.

**⚠ ONE DECISION NOT MADE:** the live Portal owns `yespleez-festival-portal.pages.dev`. If
the new project must answer on that hostname, the old one has to release it first — **the
single moment the rollback closes.** Decide deliberately: new hostname and keep both, or
plan the handover.

---

## 3 · Open, and none of it blocks the above

- **⚠⚠ Cover uploads overwrite each other — DATA LOSS.** Several covers added before an
  event is saved all write to `event_covers/<uuid>/new/cover.webp`. They look distinct in
  the editor (separate CDN cache entries per `?v=`) and two of three are gone afterwards.
  Task chip live. Highest product priority of the open items.
- **Festival's editor has never been rendered in a browser** — build/lint/test evidence
  only. Step 8 above closes this.
- **Invite tokens.** `festival_profile_creation_is_invite_only` makes self-creating a
  festival **impossible for everyone**, so onboarding an organiser is still the owner
  running an INSERT. This is what stops Festival being a product other people can use.
- **Draft events are readable by `anon`** — a broad `USING (true)` policy sits beside the
  narrower live-only one. Task chip live.
- **Scene's preview branch filter is `["*"]`** — every branch builds. Harmless noise now
  that `root_dir` matches, but it is not the include-list anyone believes it is.

---

## 4 · Corrections to earlier documents — read these

- **M2 IS IN PRODUCTION.** The previous handover said it was not, and that accepting an
  application failed. A direct object audit found all three tables, five triggers, two
  policies and both functions present, plus F2's indexes. `project_participation_model`
  said so correctly on the same day the handover denied it. ⭐ **A handover records what was
  true when written; production is a live system other sessions change.**
- **There is no migration ledger.** `supabase_migrations.schema_migrations` does not exist —
  this project has never used the CLI runner. **Nothing anywhere records what has been
  applied.** Audit the objects.
- **The plan's step 3.4 said BrowserRouter. It is a HashRouter.** A path URL falls through
  to Home; that is not a routing bug. Fixed in the plan (`953e0f5`).
- **Festival could never be cut over by a `root_dir` PATCH** — its Pages project is bound to
  a different repo. The plan assumed otherwise. Caught before any build ran.

---

## 5 · Traps that cost real time today

- **⚠⚠ THE STALE EDGE FIRED THREE TIMES.** The first fetch after a deploy returns content
  **missing every marker, at the same hashed filename** the next fetches serve correctly.
  **One fetch is never evidence. Loop until several agree.**
- **⛔ The Scene build is NOT deterministic** — `__BUILD_TIME__` stamps the clock in, so two
  builds of identical code differ in hash. **Compare content with the ISO timestamp
  neutralised, or compare byte size. Never compare hashes.**
- **`git grep` needs `--untracked`** or it silently scans nothing in a new package — it
  reported a boundary "clean" that wasn't.
- **A 404 from PostgREST can mean "wrong signature", not "absent"** — an RPC probed with the
  wrong argument names looks missing. Call it with its real parameters.
  Missing table = `404 PGRST205`; exists but unreadable = `401 42501`.
- **Scene's Vite binds 5173**, not 5174. Before any bulk move or delete, **enumerate the
  process, not the port**.
- **A stray `package.json` containing CSS in `%TEMP%`** breaks every build run under that
  tree, with 39 opaque PostCSS errors naming an innocent file. ⭐ **When a build fails right
  after a structural change, reproduce it WITHOUT the change before debugging the change.**

---

## 6 · The rule that produced the packages

**Never invent a package. Extract one only when the dependency graph reveals a coherent
domain.** Today that rule found two nobody had designed — `event-presentation` (the hero
ladder, which is display, not editing) and `requirements` (asked-for vs held, which is
neither events nor Scene). Both were discovered by removing a dependency and finding
something cohesive underneath.

**The packages directory is a record of what has been extracted, not a plan of what will
be.**

And the acceptance rule the editor now satisfies:

> Festival renders the identical Event Editor **without the package learning what Festival
> is.**

Its whole surface is `ed · editId · userId · categories · labelProfileType · components ·
adornments · actions`. No save, no publish, no session, no client, no router, no mode.
