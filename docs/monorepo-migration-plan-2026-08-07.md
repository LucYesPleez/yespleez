# YesPleez Monorepo Migration — FINAL Execution Plan
*(post-adversarial-review, v2. Supersedes the draft entirely.)*

---

## The safety fact this plan rests on

Cloudflare Pages **never takes a site down because of a failed build**. A failed build leaves the last successful deployment serving. There are only four ways either site actually goes dark:

1. Deleting a Pages project
2. Removing a custom domain from a project
3. A **successful but wrong** build deploying over production
4. A build that is **silently skipped**, so production keeps serving a stale bundle with no error anywhere

This plan never does (1) or (2). It defends (3) by reading all four build-config fields back after every edit and gating production on *content* checks, not the dashboard's green tick. It defends (4) by **not setting build watch paths at all** during the migration.

Everything else is recoverable by a dashboard rollback or a git revert. Nothing in this plan rewrites history.

---

## Two primitives used throughout — read these once

**The purity gate.** The draft's `git show --numstat HEAD | awk 'NF==3 && ($1!=0 || $2!=0)'` is broken twice over: `git show` prints the `Author:` header (3 fields, non-numeric `$1`) so it always matches, and `--numstat` emits `-` for binaries, and `-` != 0. Measured: the Scene move printed **28 lines** on a perfectly pure rename. An operator told "must print nothing" who sees 28 lines learns to ignore the check. Use this instead — verified empty on a pure `git mv`, and verified to catch both a text edit and a binary edit folded into a move:

```bash
purity() { git diff-tree -r -M --name-status --format= HEAD | awk '$1!="R100"'; }
```

**The provenance check.** `v2/vite.config.js` does `CF_PAGES_COMMIT_SHA.slice(0, 7)`. `__BUILD_SHA__` is **seven characters**, not forty. The draft's `SHA=$(git rev-parse HEAD)` + `grep -F "$SHA"` returns `0` on a healthy deployment, every time, on preview *and* production — at the exact moment the operator is deciding whether to hit Rollback. Use:

```bash
SHA=$(git rev-parse --short=7 HEAD)     # --short=7, NOT --short (git auto-lengthens; Cloudflare never does)
livesha() { curl -s "$1/$2" | grep -c -F "\"$SHA\""; }   # quoted: define() emits it JSON-quoted; bare 7-hex collides
```

`__BUILD_SHA__` is consumed at `v2/src/components/GlobalHeader.jsx:84`, eagerly imported, and `dist/assets/` has a single `index-*.js` entry chunk — so it lands in the chunk we grep.

Shell is **Git Bash** throughout (paths contain spaces; `cd /d` is cmd-only):

```bash
A="/c/Users/L-c/Documents/YesPleez App/YesPleez Scene App/YesPleez"
B="/c/Users/L-c/Documents/YesPleez App/YesPleez Festival Portal"
S="/c/Users/L-c/AppData/Local/Temp/claude/C--Users-L-c-Documents-YesPleez-App-Claude-Cowork/scratch-migration"
```

---

# 1. DECISIONS THE OWNER MUST MAKE FIRST

| # | Question | Recommended | Consequence of each option |
|---|---|---|---|
| **D1** | **Flip repo A to private?** | **Yes — and do it in Phase 0, unconditionally, as a *sequence*, not as a strategy verdict.** | The two directions are not symmetric. Going private is reversible any time. Publishing repo B's 48 commits, `docs/FESTIVAL_UX_v1.md`, `DEPLOYMENT.md` and 149 files of an unshipped product to a public repo is **permanently irreversible** — GitHub serves unreachable commits by SHA and crawlers act immediately. Push to a private repo, then take as long as you like deciding whether to go public again. Verified: **no credential is newly exposed** — the anon key is already in A's public `state.js`, the allowlist email in four tracked A files since `38841c1`, the Supabase project ref in five, and B's history contains no `service_role` string ever added or removed. Repo A: 0 forks, 0 stars, 0 watchers, no GitHub Pages site, no branch protection, no Actions workflows. Cost of going private ≈ zero. This is a publishing decision, not a security remediation. |
| **D2** | **Land or close open PR #2 first?** | **Yes — mandatory, before Phase 1.** | `fix/autoclaim-scope-and-applications-profile → main` modifies `events.js`, `index.html`, `profiles.js` — three of the 17 legacy root files. Merged into the post-legacy-move tree it produces `CONFLICT (modify/delete)` on `events.js` and `profiles.js` and **leaves the branch's copies at the repo root**. The reflex resolution (`git add -A`) puts legacy v1 back at the root, disarming the entire defence against failure mode (3). Not optional. |
| **D3** | **Do a normal Scene release *before* touching anything?** | **Yes — mandatory.** | `main..v2-react` is **11 commits**, and local `v2-react` is 4 ahead of `origin/v2-react`. Without this, the cutover deploy ships: the directory move + vite config changes + `.nvmrc` + **11 commits of unreleased product work**, into the first-ever build from a new root directory. If it breaks you cannot tell which payload did it. Worse: `apps/festival/.env.production`'s own header says the festival apply flow *"is on `v2-react` and is NOT on main yet"* — so that deploy would also flip the live Scene↔Portal integration on. **That is a product launch riding inside an infrastructure move.** Release first, verify by the existing ritual, then branch. |
| **D4** | **Portal URL: attempt the API repoint, or new project + 302?** | **New project + 302 redirect.** | `yespleez-festival-portal.pages.dev` **is** the beta's production URL; organisers hold links to it. The dashboard cannot repoint a project at a different repo; the API accepts `source.config` on PATCH but whether the backend re-binds the GitHub webhook is undocumented. New-project + wildcard 302 is deterministic and zero-downtime, and `HashRouter` means fragments survive the redirect, so every handed-out link keeps working. Try the API PATCH on a throwaway if you want the subdomain, but do not gate the migration on it. |
| **D5** | **Cloudflare API token with `Pages:Edit` + account ID?** | **Create one.** | Converts ~8 dashboard clicks into verifiable commands, and — more importantly — it is the only way to **read back** what the dashboard actually contains and diff it. Given finding D-11/G-10 (PATCH replaces nested objects rather than deep-merging), read-back is not optional. |
| **D6** | **Build System version on both projects?** | **Read it before starting.** | Monorepo `root_dir` requires **V2+**. V1 auto-migrates to V3 on **2026-09-15** and may break on its own. A V1 project blocks the migration *and* is about to break regardless. |
| **D7** | **Populate Scene's Preview environment variables now?** | **Yes, first, before anything else.** | Scene's Preview env set is currently empty, so `v2-react.yespleez.pages.dev` does not boot — meaning today production is your only test surface. **Single largest risk multiplier in the plan.** Caveat: this gives you a JS/env test surface, not a **service worker / PWA upgrade-path** test surface (see D12). |
| **D8** | **One production branch or two?** | **Two — but `festival` is an independent branch, not a mirror of `main`.** | The draft specified `festival` as ff-only-from-`main`, which inverts its own goal: Portal-only commits would have to land on Scene's production branch first, so every Portal release rebuilds Scene and no Portal fix can ship without shipping whatever sits on `main`. Instead: **`festival` carries Portal-only commits directly; merge `main` → `festival` only when the Portal needs shared/root changes.** Then `main` never sees a Portal-only commit and Scene never rebuilds for one — with or without watch paths. |
| **D9** | **Move the legacy v1 tree to `legacy-v1/`?** | **Yes.** | 17 tracked `.js` + a 504 KB `index.html` at the repo root. With them gone, a cleared `root_dir` finds nothing to auto-detect and fails loudly. One move-only commit. (Note: this defends the *root* index.html case only — see Residual Risk.) |
| **D10** | **Delete the unanchored `package-lock.json` rule from root `.gitignore`, and the stray root `package-lock.json` + `node_modules/`?** | **Yes — all three, in one commit.** | The rule is unanchored so it matches at every depth. Verified it does **not** currently harm anything (both real lockfiles are already tracked, and gitignore does not affect tracked files) — but it *does* match `packages/*/package-lock.json`, so it is a landmine that fires precisely when Phase 6 lands. Delete the rule entirely; don't anchor it. **And `rm -rf` the repo-root `node_modules/` — it exists today and contains `@dnd-kit`, which is a live Phase 6 defect (see B-1).** |
| **D11** | **Phase 6: `file:` protocol or npm workspaces?** | **Decide at Phase 6, not now. Current recommendation: npm workspaces.** | The draft rejected workspaces on three grounds; review refuted two of them. *Reason 2 (hoisting defeats dedupe) is backwards* — hoisting to a single root `node_modules` is what makes `resolve.dedupe` unnecessary, because `packages/` and `apps/` then walk up to the same directory; the `file:` layout is what **manufactures** the duplicate (B-1). *Reason 3 (gitignored root lockfile)* is a bug being fixed in D10 anyway. Only Reason 1 survives — Cloudflare installs the whole workspace regardless of `root_dir` (`workers-sdk#10941`, closed not-planned), so a Portal dependency change can fail a Scene build. That failure is **loud and rollback-able**. The `file:` failure mode is a **silently dead drag handler**. Trade a loud failure for a silent one, not the reverse. |
| **D12** | **Do you have a phone with YesPleez already installed from before the migration?** | **You need one.** | Service worker registration state is per-origin. `monorepo.yespleez.pages.dev` has zero installed workers; `yespleez.com` has a population registered at `scope:'/'`. Installing fresh on the preview origin proves the manifest is served — it proves **nothing** about the upgrade path. The upgrade path only exists in production. |
| **D13** | **`@vitejs/plugin-react` 5 vs 6 alignment?** | **Do it as step zero of Phase 6, not a later commit.** | Not cosmetic. Installed: Scene `plugin-react 6.0.3` (JSX via Vite 8 **oxc**), Portal `plugin-react 5.2.0` (JSX via **Babel**, `@babel/core` present). Shipping one shared JSX file through two different compilers with no comparison test is a defect generator. Align **before** the shared package exists. |

---

# 2. THE PLAN

## PHASE 0 — Make everything recoverable, and clear the deck (~60 min)

Eight commits currently exist in exactly one place on Earth: your two working clones. Any surgery before this phase destroys work with no copy anywhere.

### 0.1 [ME] Push the outstanding commits

```bash
cd "$B" && git status --porcelain && git push origin master && git push backup master
cd "$A" && git status --porcelain && git push origin v2-react
```

**Verify:** `git status --porcelain` prints nothing before each push; afterwards both `git rev-list --count origin/master..master` and `git rev-list --count origin/v2-react..v2-react` return `0`.

### 0.2 [ME] Tag the pre-migration state on both repos

```bash
cd "$B" && git tag pre-monorepo && git push origin pre-monorepo && git push backup pre-monorepo
cd "$A" && git tag pre-monorepo && git push origin pre-monorepo
```

**Verify:** `git ls-remote --tags origin | grep pre-monorepo` returns a line in both.

### 0.3 [OWNER→ME] Give repo A a *real* offline mirror

Repo A — the repo with no backup at all — must not be backed up by hardlinks. Measured: `git clone --mirror` on the same volume produces pack files with link count 2, sharing inodes with the source.

**[OWNER] first:** in OneDrive, right-click `repo-backups` → **Always keep on this device**. A dehydrated `.git/objects` is a mirror that cannot be read when you need it.

```bash
git clone --mirror --no-hardlinks "$A" "/c/Users/L-c/OneDrive/repo-backups/yespleez.git"
cd "$A" && git remote add backup "/c/Users/L-c/OneDrive/repo-backups/yespleez.git"
git push backup --all && git push backup --tags
```

**Verify (integrity, not just counts — `rev-list --count` passes on a mirror with missing objects):**
```bash
M="/c/Users/L-c/OneDrive/repo-backups/yespleez.git"
git -C "$M" fsck --full                 # must be clean
git -C "$M" rev-list --count v2-react   # expect 1330
stat -c '%h' "$M"/objects/pack/*.pack    # must be 1, not 2
git -C "/c/Users/L-c/OneDrive/repo-backups/YesPleez-Festival-Portal.git" fsck --full
```

### 0.4 [ME] Repo A housekeeping — **do NOT run `git gc`**

The draft ran plain `git gc` "conservatively". Repo A has **19 dangling commits**. Plain `gc` prunes unreachable objects older than two weeks — so most of those 19 go permanently — and expires `reflogExpireUnreachable` at 30 days, which can *convert* reachable-via-reflog work into unreachable work in the same run. The stated goal was deleting one leftover temp pack file. `gc` is not needed for that.

```bash
cd "$A"
git fsck --no-progress 2>&1 | grep 'dangling commit'    # 19 expected; git show any that look recent
rm -f "$A"/.git/objects/pack/tmp_pack_*
```

**Verify:** `git count-objects -v` no longer lists a `tmp_pack_*`; `git rev-list --count v2-react` still returns `1330`. If you later want a repack: `git gc --no-prune`, and re-run the mirror fsck afterwards.

### 0.5 [OWNER] Flip repo A to private — **now, not at push time**

A public→private flip can break an existing Cloudflare Pages ↔ GitHub App binding depending on how repository access was granted. Doing it immediately before the first migration push makes a broken integration and a broken migration indistinguishable.

```bash
gh repo edit LucYesPleez/yespleez --visibility private --accept-visibility-change-consequences
gh repo view LucYesPleez/yespleez --json visibility
```

**Then prove the Pages binding survived, while `root_dir` is still `v2` and nothing else has changed:**
```bash
cd "$A" && git commit --allow-empty -m "visibility check" && git push origin v2-react
```
**Verify:** a preview build appears in the Cloudflare dashboard for `yespleez` and succeeds. **If it does not, stop and fix the GitHub App installation before anything else.**

*(Your `gh` token scopes are `gist, read:org, repo, workflow` — sufficient for `repo edit --visibility` and `repo archive`, and notably **without `delete_repo`**. Leave it that way; it is an accidental but real safety net for this plan's never-delete posture.)*

### 0.6 [OWNER] Land or close PR #2 (D2)

```bash
gh pr view 2 --json state,mergeable
# merge or close, then:
cd "$A" && git fetch origin && git rev-parse main origin/main   # note where main now is
```

### 0.7 [OWNER] Populate Scene's Preview environment variables (D7)

Copy the Production set into Preview. Trigger a preview build of `v2-react`.

**Verify:** `https://v2-react.yespleez.pages.dev` loads and a signed-in session works. **Do not start Phase 1 until this is true.**

### 0.8 [OWNER] Export every environment variable, both projects, both environments — plus three additions

Dashboard: **Workers & Pages → (project) → Settings → Variables and secrets.** Production and Preview are separate sets. Save to `C:\Users\L-c\OneDrive\repo-backups\cloudflare-env-2026-08-07.txt`, **outside git**.

Three additions to the draft:

1. **Record whether each variable is typed as a secret.** Encrypted Pages variables cannot be read back from the dashboard *or* the API. "Read values from the dashboard" is not guaranteed to complete.
2. **Record `NODE_VERSION` explicitly** (present or absent, and its value) on both projects, and the Node version printed in the first lines of each project's most recent successful build log. Both apps depend on `vite ^8.1.0` (needs Node ≥20.19/22.12) while Cloudflare's build-image defaults are 18.17.1 (v2) / 22.16.0 (v3) — so **something is already overriding it** and you do not yet know what.
3. **Recover `VITE_VAPID_PUBLIC_KEY` from the live bundle — a third, free recovery path.** It is `VITE_`-prefixed, so it is baked into production. This is the only path that still works if the dashboard variable is secret-typed:

```bash
ASSET=$(curl -s https://yespleez.com/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
curl -s "https://yespleez.com/$ASSET" | grep -oE '[A-Za-z0-9_-]{80,90}' | sort -u | head
```

**Why non-negotiable:** if the VAPID key is lost from both known places, push can only be restored by regenerating the keypair, which **invalidates every existing push subscription**.

**Verify:** the file contains `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`, `VITE_FESTIVAL_PORTAL_URL` for Scene Production. Diff against `"$A/v2/.env.local"` and reconcile any difference **now**.

### 0.9 [OWNER/ME] Snapshot the full project JSON of both projects — this is the PATCH baseline

The Cloudflare Pages API **replaces** nested config objects rather than deep-merging them. A `--data '{"build_config":{...three keys...}}'` PATCH silently drops `build_caching`, `web_analytics_tag`, `web_analytics_token`.

```bash
for P in yespleez yespleez-festival-portal; do
  curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/pages/projects/$P" \
    -H "Authorization: Bearer $CF_API_TOKEN" > "$S/cf-$P-before.json"
done
node -e "const p=require('$S/cf-yespleez-before.json').result;console.log(JSON.stringify(p.build_config,null,2))"
```

**Verify:** you have `build_config` (all keys), `source.config.production_branch`, and `deployment_configs` for both projects saved to disk. Also confirm the **Build output directory box currently says `dist`, not `v2/dist`** — the Scene project already builds successfully from `v2/`, so what is in that box today is the ground truth for the `root_dir`-relative question. Cloudflare's docs are ambiguous and third-party writeups disagree. Read it; do not infer it.

### 0.10 [ME] **Do the normal Scene release** (D3) — with `root_dir` still `v2`

```bash
cd "$A"
git fetch origin
git rev-parse main origin/main          # MUST be equal — fail loudly if not
git checkout main && git merge --ff-only v2-react && git push origin main
```

**Verify** by the existing ritual, plus the corrected provenance check against production:
```bash
SHA=$(git rev-parse --short=7 HEAD)
ASSET=$(curl -s https://yespleez.com/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
curl -s "https://yespleez.com/$ASSET" | grep -c -F "\"$SHA\""   # expect >=1
```
**[OWNER]** This release turns the Scene↔Portal apply flow on. Exercise it in the browser before continuing. **Let it sit for at least a few hours.** If something is wrong with it, you want to know that now, not tangled up with a directory move.

### 0.11 [ME] Delete `node_modules` and `dist` in `v2/` **before** the move

The draft rebuilt `node_modules` *after* the `git mv`. On Windows, renaming ~tens of thousands of files while Vite holds handles into `v2/node_modules` will fail or half-complete — and your standing rule is never to stop the owner's dev server. Both directories are gitignored (`v2/.gitignore:11:dist` confirmed), so deleting them costs nothing and makes the rename small, fast and lock-free.

```bash
# [OWNER] confirm the Scene dev server is not running, or coordinate a window
rm -rf "$A/v2/node_modules" "$A/v2/dist"
```

---

## PHASE 1 — Move Scene into `apps/scene/` (branch only; production untouched)

### 1.1 [ME] The move, as its own commit with zero content edits

```bash
cd "$A"
git checkout main                       # main, not v2-react — they are now identical
git checkout -b monorepo
mkdir -p apps
git mv v2 apps/scene
git commit -m "Move v2/ to apps/scene/"
```

⚠ **The move must be its own commit.** Git does not store renames; it re-derives them by content similarity at read time. Fold even one line of edit in and files can score below the threshold and be recorded permanently as delete + add — blame and `--follow` gone for good.

### 1.2 [ME] Verify the move is a *pure* rename

```bash
cd "$A"
purity                                  # MUST print nothing
git blame -L 1,2 -- apps/scene/src/lib/supabase.js
#   expect: ac4f0c3c v2/src/lib/supabase.js  (LucYesPleez 2026-07-05)
git log --follow --oneline -- apps/scene/src/lib/supabase.js | wc -l   # expect 4, not 1
```

⚠ Known and measured: **`git log --follow` on a *directory* does not work** (returns 1 commit). `--follow` is single-file only. Not a failure of the migration.

### 1.3 [ME] Reinstall and build

```bash
cd "$A/apps/scene" && npm ci && npm run lint && npm test && npm run build
ls "$A/apps/scene/dist/index.html"
git ls-files apps/scene/package-lock.json    # must print the path
```

`apps/scene/.env.local` rode along with the `git mv` (gitignored, untracked, git is indifferent) — local dev keeps working. The `test` script's `--import ./test/resolve-hook.mjs` is cwd-relative and only works from `apps/scene` — that is exactly how it works today.

**Verify:** `npm ci` completes (log says `npm clean-install`, not `npm install` — that confirms the lockfile is present inside the new `root_dir`), oxlint clean, tests pass, `dist/index.html` exists.

### 1.4 [ME] Retire the legacy v1 tree — separate move-only commit (D9)

```bash
cd "$A"
mkdir -p legacy-v1
git mv index.html app.js audio.js auth.js bands.js calendar.js events.js follows.js \
       navigation.js notifications.js personal_cal.js postcodes.js profiles.js search.js \
       seed_bellingen_events.js standup.js state.js venues.js \
       hand-logo.png hand-outline.png icon.png splash.png legacy-v1/
git commit -m "Retire the v1 app to legacy-v1/"
purity                                  # MUST print nothing
git ls-files index.html events.js profiles.js   # MUST print nothing (PR #2 regression guard)
```

---

## PHASE 2 — Absorb the Portal as `apps/festival/`

**Strategy: re-root + `git merge --allow-unrelated-histories`.** Measured against alternatives on your real repos, and independently reproduced in review:

| Strategy | Commits | blame crosses | `--follow -- apps/festival/src/App.jsx` | Verdict |
|---|---|---|---|---|
| `git subtree add` | 1380 | ✅ | **0** | rejected |
| `merge -s ours` + `read-tree --prefix` | 1380 | ✅ | **0** | rejected |
| **re-root + `--allow-unrelated-histories`** | **1381** | ✅ | **14** | **✅ chosen** |
| `git filter-repo` | — | — | — | unavailable: no Python interpreter on this machine |

### 2.1 [ME] Re-root repo B in a throwaway clone

```bash
mkdir -p "$S"
rm -rf "$S/portal-reroot"
git clone "$B" "$S/portal-reroot"
cd "$S/portal-reroot"
git checkout master && git checkout -b reroot
mkdir -p apps/festival
for f in $(git ls-tree --name-only HEAD); do git mv "$f" apps/festival/; done
git commit -m "Re-root the Portal under apps/festival/"
```

*(Scratchpad, not `/c/temp` — `/c/temp` is not guaranteed to exist, and an `rm -rf` against a path you did not create should not be in a plan.)*

**Verify:**
```bash
purity                                              # must print nothing
git ls-files | wc -l                                # expect 149
git ls-files apps/festival/.env.production apps/festival/.gitignore apps/festival/package-lock.json
```
The loop correctly relocates dotfiles (`.env.production`, `.gitignore`, `.oxlintrc.json`, `.claude/`) — B's root tree is 14 entries, none containing spaces, so the unquoted expansion is safe. Verified: no filename collision with repo A's root at all.

### 2.2 [ME] Merge

```bash
cd "$A" && git checkout monorepo
git remote add portal "$S/portal-reroot"
git fetch portal
git merge --allow-unrelated-histories --no-ff -m "Absorb the Festival Portal as apps/festival/" portal/reroot
git remote remove portal
```

⛔ **Never `--squash` at any step.** It discards every parent link — exactly the failure you are avoiding.

### 2.3 [ME] Verify the merge — with a *working* env check

```bash
cd "$A"
git rev-list --count HEAD                                            # expect 1381
git log --follow --oneline -- apps/festival/src/App.jsx | wc -l      # expect 14, NOT 0
git log --follow --oneline -- apps/festival/src/data/supabase/applicationRepository.js | wc -l  # expect 7
git blame -L 1,3 -- apps/festival/src/data/supabase/client.js        # expect cb2d3228, original path

# THE CRITICAL ENV CHECK — corrected:
git ls-files --error-unmatch apps/festival/.env.production           # must exit 0
git check-ignore --no-index -v apps/festival/.env.production         # must print NOTHING and exit 1
```

⚠ The draft's `git check-ignore` without `--no-index` was a **tautology**. `check-ignore` consults the index by default and never reports a tracked path as ignored — verified: `v2/package-lock.json` is tracked *and* matched by `.gitignore:2`, yet plain `check-ignore` exits 1 silently while `--no-index` correctly reports the match. Without `--no-index` this check passes even if someone later adds `.env*` to the root `.gitignore` — the precise regression it exists to catch.

**Do not ever add `.env*`, `.env.*` or `**/.env*` to the monorepo root `.gitignore`.** The monorepo root `.gitignore` (inherited from A) is `node_modules/`, `package-lock.json`, `supabase/.temp/` — no `.env` wildcard, so `.env.production` survives. `apps/festival/.gitignore` (`node_modules / dist / .env / .env.local / .DS_Store / *.local`) travels with the files and keeps behaving as today. Move this check into a pre-push hook or the release checklist; a one-time migration check does not protect a permanent invariant.

### 2.4 [ME] Prove the Portal still builds in place — **from a clean clone**

```bash
rm -rf "$S/portal-clean" && git clone "$A" "$S/portal-clean" && cd "$S/portal-clean" && git checkout monorepo
cd apps/festival && npm ci && npm run lint && npm run build
ls dist/index.html
grep -rlF "$(grep '^VITE_SCENE_URL=' .env.production | cut -d= -f2- | tr -d '\r')" dist/assets/ | head
```

*Why a clean clone, not `$A`:* `apps/festival/.env.local` (176 bytes) overlaps `.env.production` on three of four keys. Vite loads `.env` → `.env.local` → `.env.[mode]` → `.env.[mode].local`, later winning, so `.env.production` does take precedence during `vite build` and the check passes in `$A` too — but the value greped (`VITE_SCENE_URL`) is the **only one not in `.env.local`**, so in `$A` it proves the file is read and proves nothing about precedence. The clean clone is the actual CI condition.

⚠ **This is the load-bearing invariant of the whole migration.** Vite's config sets no `root` and no `envDir`. If the build is ever hoisted to run from the monorepo root, all four `VITE_*` values become `undefined`: the Supabase client gets no URL/key, `VITE_ORGANISER_ALLOWLIST` is documented **fail-closed** so nobody can log in, and `VITE_SCENE_URL` falls back to `http://localhost:5174` so every application link the live beta hands out points at the organiser's machine — valid-looking and dead. **It fails silently.**

⚠ Also: **nobody should ever create `.env.production.local`.** It silently outranks everything and is swallowed by the Portal's `*.local` ignore rule.

Note: `apps/festival`'s `npm test` is `node --test src/companion/priorities.test.mjs` — one hard-coded file. Do not read "tests pass" as coverage.

### 2.5 [ME] Pin `root` and `envDir` explicitly — **separate commit, and NOT part of the cutover deploy**

`apps/festival/vite.config.js`:
```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
export default defineConfig({ root: here, envDir: here, plugins: [react()], server: { port: 5180 } });
```

Same for `apps/scene/vite.config.js` — add `root: here` + `envDir: here` and **leave `define`, `resolve.dedupe`, `server.allowedHosts`, `server.host` and the `preview` block exactly as they are.** Verified this is a genuine no-op-plus-guard for Scene: `v2/vite.config.js` already reads `package.json` via `new URL('./package.json', import.meta.url)`, so it is already path-independent, and `root: here` resolves to the directory it already used — `build.outDir` and `publicDir` do not move.

⚠ **Hold this commit off the cutover.** It goes to `main` as its own deploy *after* Phase 3.5 has been verified, so the cutover diff is only the directory move.

**Verify:** re-run 2.4 in the clean clone after applying.

### 2.6 [ME] Hygiene commit (D10) — all three items together

```bash
cd "$A"
rm -f package-lock.json          # the stray untracked 3.5 KB dnd-kit-only file
rm -rf node_modules              # <-- NEW: the repo-root node_modules containing @dnd-kit, turndown, @mixmark-io
# Edit root .gitignore: DELETE the `package-lock.json` line entirely.
git add .gitignore && git commit -m "Root gitignore no longer swallows lockfiles at every depth"
git status --porcelain           # must be empty
```

**The `node_modules` deletion is not cosmetic.** After Phase 1 the repo root is the monorepo root, i.e. an ancestor of `packages/`. Vite defaults to `resolve.preserveSymlinks: false`, so a file inside a linked package is identified by its **real** path and every bare import in it walks up from `packages/` — never reaching `apps/scene/node_modules`. Measured on a scaffold: `import.meta.resolve` from `packages/pkg` returned the **root** copy while the same specifier from `apps/app` returned the app copy. With `@dnd-kit` sitting at the repo root, `useSortable` in the shared editor would bind to a different instance than `DndContext`, and **poster-tab reorder silently does nothing** — no error, no warning. It works on Cloudflare (fresh clone, no root `node_modules`) and breaks locally: the worst polarity, because you debug the app you cannot reproduce.

Then, in a further commit, fix the path references that now point at `v2/` — none break a build, all break navigation:
- `.github/pull_request_template.md:39`
- `CLAUDE.md` — 3 places, including the line-9 directory table and line 197
- `docs/active-profile-ux-review-2026-07.md` — dozens of `../v2/src/screens/...` → `../apps/scene/src/...`
- `apps/scene/scripts/generate-venue-maps.mjs` — comments referencing `v2/.env.local`
- A `docs/` note recording that Pages `root_dir` is `apps/scene` / `apps/festival`
- **The release ritual (see 3.6)**

```bash
git grep -n -- 'v2/' -- ':!apps/' ':!legacy-v1/'    # returns exactly 5 files; parses correctly despite the double --
```

Add a root `.claude/launch.json` with both dev servers (Scene 5173, Portal 5180).

### 2.7 [OWNER] Node version — resolve the contradiction before pinning anything

Do **not** write `.nvmrc` yet. Cloudflare's docs do not state where `.nvmrc` is read from in a monorepo, and something is already overriding the image default on both projects (0.8 recorded what).

- If 0.8 found **`NODE_VERSION` set**: that is the mechanism. Carry it forward as an explicit, commented exception to Phase 4.2's "no environment variables".
- If 0.8 found an **existing `.nvmrc`** in `v2/`: it rides along with the `git mv` and stays correct.
- If neither: the project is on Build System v3 and inheriting 22.16.0.

Then add `"engines": { "node": ">=20.19" }` to both `package.json` files (documentation, not enforcement).

⚠ Do **not** pin your local `v24.18.0` unless a build log shows it. Pinning a version the build image does not have converts a working build into a broken one.

**Verify:** the first preview build after this change logs the same Node version it logged before, and succeeds. Only add `.nvmrc` as belt-and-braces *after* a build log proves it is read from `root_dir`.

---

## PHASE 3 — Scene cutover (the moment production is at risk)

### 3.1 [ME] Push the branch

```bash
cd "$A" && git push -u origin monorepo
```
Repo A is already private (0.5) and the Pages binding is already proven (0.5).

**Verify:** `git ls-remote origin monorepo` returns the SHA; a preview build starts.

### 3.2 [OWNER] Point the Scene Pages project at the new directory — full-object PATCH with read-back diff

**Dashboard: Workers & Pages → yespleez → Settings → Build → Build configuration**
- **Root directory:** `v2` → **`apps/scene`**
- **Build command:** `npm run build` — **unchanged. Never blank.**
- **Build output directory:** **`dist`** — `root_dir` is a `cd`; the output directory resolves *inside* it. Cross-check against 0.9: if the box says `dist` today with root `v2`, it stays `dist`.
- **Build watch paths: LEAVE AT DEFAULT. Do not set them.** (See "What the review changed", finding 3/6.)

Or via API, mutating the saved object rather than replacing it:
```bash
node -e "const j=require('$S/cf-yespleez-before.json').result.build_config; j.root_dir='apps/scene'; \
  console.log(JSON.stringify({build_config:j}))" > "$S/patch.json"
curl -s -X PATCH "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/pages/projects/yespleez" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" --data @"$S/patch.json"
curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/pages/projects/yespleez" \
  -H "Authorization: Bearer $CF_API_TOKEN" > "$S/cf-yespleez-after.json"
diff <(node -e "console.log(JSON.stringify(require('$S/cf-yespleez-before.json').result.build_config,null,2))") \
     <(node -e "console.log(JSON.stringify(require('$S/cf-yespleez-after.json').result.build_config,null,2))")
# The ONLY difference must be root_dir. Also diff deployment_configs — that is where env vars live.
```

⚠ **The dangerous wrong values are `.`, `/`, `apps`, and an empty build command** — any of those publishes the *source tree*. `apps/scene/index.html` ends with `<script type="module" src="/src/main.jsx">`, so Pages serves HTTP 200, correct headers, and a **white screen** on `yespleez.com` from a "successful" deployment. Moving v1 to `legacy-v1/` does not defend this case. Conversely, `apps/scene/dist` (the mistake the draft feared most) resolves to `apps/scene/apps/scene/dist`, which does not exist — Pages **fails loudly** and production stays up. That one is the safe error.

⚠ **Build config is project-level, not per-environment.** The moment you save, preview builds of `main` (which still has `v2/`) will fail. Expected and harmless. **Do not push anything to `main` between 3.2 and 3.5.**

### 3.3 [OWNER] Give branch `monorepo` a preview deployment — by include-list, not "All branches"

**Settings → Builds & deployments → Preview deployments:** add `monorepo` to the **custom include list**. Do not select *All branches*.

*Why:* the free plan is **500 builds/month, one concurrent build**. Two projects watching one repo already doubles consumption; "All branches" multiplies it and makes them queue. Hitting the cap removes your ability to ship a fix — converting a cosmetic problem into an outage you cannot end. It also stops `festival` (Phase 4.1) from creating a confusing `festival.yespleez.pages.dev` **Scene** preview built from `apps/scene`.

### 3.4 [ME] Verify the Scene preview **by content, not by status code**

```bash
cd "$A"; SHA=$(git rev-parse --short=7 HEAD); URL=https://monorepo.yespleez.pages.dev

ASSET=$(curl -s "$URL/" | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1); echo "asset=$ASSET"

# 1. WHICH commit deployed (7-char, quoted)
curl -s "$URL/$ASSET" | grep -c -F "\"$SHA\""                                        # expect >=1

# 2. Env vars reached the bundle
curl -s "$URL/$ASSET" | grep -c -F 'doqzxvppibuzieajqkxm.supabase.co'                 # expect >=1

# 3. SPA deep-link fallback (BrowserRouter; NO _redirects file exists, and none must be added)
curl -s "$URL/event/00000000-0000-0000-0000-000000000000" | grep -c -F '<div id="root"'   # expect 1

# 4. PWA assets at the origin root (base unset; everything hardcoded to /)
for p in /favicon.svg /manifest.json /apple-touch-icon.png /sw.js; do
  echo -n "$p "; curl -s -o /dev/null -w '%{http_code}\n' "$URL$p"; done

# 5. Repeat 1 three times — different edge nodes can serve different deployments during propagation
for i in 1 2 3; do curl -s "$URL/$ASSET" | grep -c -F "\"$SHA\""; sleep 3; done
```

⚠ Use `grep -F` throughout — dots in URLs and hashes are regex wildcards otherwise.
⚠ Missing assets on Pages can return **HTTP 200 with fallback HTML**, not 404. Never verify by status code alone; that is why check 4 is paired with check 3's `<div id="root">` grep.

**[OWNER]** In a browser at the preview URL: sign in, open a profile, open the event editor, upload an image, install the PWA and confirm the service worker registers without a `SecurityError`. **This proves the manifest is served. It does not prove the upgrade path** — see 3.6.

### 3.5 [ME] Ship Scene to production

```bash
cd "$A"
git fetch origin
git rev-parse main origin/main          # MUST be equal — fail loudly if they differ
git checkout main && git merge --ff-only monorepo && git push origin main
```

**Verify:** re-run the entire 3.4 block against **both** `https://yespleez.com` and `https://yespleez.pages.dev`, with `SHA` = the new `main` HEAD (7-char). All five checks must pass on both hosts.

### 3.6 [ME] **Restore the release ritual — do not skip this**

`main` has now fast-forwarded past the move; `v2-react` still points at the old `v2/` layout and would break the ratified ritual. Measured: the next `git merge --ff-only v2-react` returns `fatal: Not possible to fast-forward, aborting.`, and a non-ff merge produces `CONFLICT (file location)` on **every new file** added under `v2-react`'s old paths.

```bash
cd "$A"
git checkout v2-react && git merge --ff-only main && git push origin v2-react
git branch -D docs/expand-readme 2>/dev/null   # 1330-commit-stale, local-only; or ff it too
git checkout main
```
Then amend the release-ritual line in `CLAUDE.md` (the paths are now `apps/scene/`) in its own commit.

**Verify:** `git rev-parse main v2-react` returns the same SHA.

### 3.7 [OWNER] The service-worker upgrade path — the one thing preview cannot test (D12)

On a device that **already had YesPleez installed before the migration**, open the app cold — no hard refresh, no reinstall. Confirm the ⓘ build stamp reads the new 7-char SHA and the SW build string is unchanged.

*Why this is safe by construction, and why you still check:* `v2/public/sw.js` (526 lines) is well built for this — navigations are network-first, only content-hashed `/assets/*` are cached indefinitely, cross-origin is never intercepted. The migration does not touch `sw.js`, so `SW_BUILD` needs no bump. But registration state is per-origin, and the upgrade path exists only in production.

### 3.8 [ME] Ship 2.5 (vite `root`/`envDir`) as its own deploy

```bash
cd "$A" && git checkout main && git cherry-pick <2.5-sha> && git push origin main
```
**Verify:** 3.4 checks 1 and 2 against `yespleez.com` with the new SHA.

---

## PHASE 4 — Portal cutover, zero downtime

The existing project stays alive and serving throughout. Nothing is deleted.

### 4.0 [OWNER] Prove what is actually configuring the live Portal — **before creating anything**

`apps/festival/.env.production`'s header claims the dashboard panel *"did not deliver these to the build (verified by probing the deployed bundle)"*. That is the **opposite** of documented Vite behaviour — `loadEnv` applies prefixed `process.env` values *after* parsing env files, so a dashboard variable should win. Unexplained behaviour is not a foundation, and it can reappear differently on a new project built on a newer image.

```bash
OLD=https://yespleez-festival-portal.pages.dev
ASSET=$(curl -s "$OLD/" | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
cd "$A"
while IFS='=' read -r k v; do
  case "$k" in VITE_*) v=$(echo "$v" | tr -d '\r')
    printf '%-32s %s\n' "$k" "$(curl -s "$OLD/$ASSET" | grep -c -F "$v")";; esac
done < apps/festival/.env.production
```

**Every count must be ≥1.** If any value is **absent** from the live bundle, then `.env.production` is *not* what is running, and the new project will deploy a differently-configured app while every local check and every 4.3 check passes. **Stop and resolve that before 4.2.**

### 4.0b [OWNER] *(Optional, D4)* Try the API repoint on a throwaway

If it works you keep `yespleez-festival-portal.pages.dev` and skip 4.4 entirely.

```bash
# Create a THROWAWAY Pages project in the dashboard connected to LucYesPleez/YesPleez-Festival-Portal, then:
curl -X PATCH ".../pages/projects/THROWAWAY" -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"source":{"type":"github","config":{"owner":"LucYesPleez","repo_name":"yespleez","production_branch":"festival"}}}'
# Push a commit to `festival`. Does the throwaway build?
```
If yes → run the same PATCH against `yespleez-festival-portal` and skip to 4.3. If no → continue. **Delete the throwaway either way** (max 5 Pages projects per repo).

### 4.1 [ME] Create the Portal's production branch (D8)

```bash
cd "$A" && git checkout -b festival main && git push -u origin festival
```

**Write the ritual down** in `CLAUDE.md` and `DEPLOYMENT.md` in the same commit:
> `festival` is the Portal's production branch and carries Portal-only commits **directly**. When the Portal needs shared or root changes: `git checkout festival && git merge main && git push`. Never the reverse — a Portal-only commit must never reach `main`.

### 4.2 [OWNER] Create the new Pages project

**Workers & Pages → Create → Pages → Connect to Git**
- Repository: `LucYesPleez/yespleez`
- Project name: `yespleez-festival` *(confirm availability first)*
- Production branch: **`festival`**
- Build command: `npm run build`
- Build output directory: **`dist`**
- Root directory: **`apps/festival`**
- Preview deployments: **custom include list** (empty for now), not *All branches*
- **Build watch paths: leave at default.**
- **Environment variables: `NODE_VERSION` only, if and only if 0.8 found it set on the old project.** Everything else: none. The committed `.env.production` is the single source of truth, deliberately (see `DEPLOYMENT.md`); adding dashboard `VITE_*` variables would reintroduce two apparent sources of truth — the exact condition the 2026-08-06/07 investigation was run to eliminate. `NODE_VERSION` is not `VITE_`-prefixed and does not reach the bundle, so it is not a second source of truth for anything.

⚠ **Do not touch `yespleez-festival-portal`.** It keeps building from repo B and keeps serving.

**Verify:** the first build log reports the same Node version as the old project's last successful build, and says `npm clean-install`.

### 4.3 [ME] Verify the new Portal deployment by content

```bash
NEW=https://yespleez-festival.pages.dev
cd "$A"
SCENE_URL=$(grep '^VITE_SCENE_URL='          apps/festival/.env.production | cut -d= -f2- | tr -d '\r')
ALLOW=$(    grep '^VITE_ORGANISER_ALLOWLIST=' apps/festival/.env.production | cut -d= -f2- | tr -d '\r')
ASSET=$(curl -s "$NEW/" | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)

curl -s "$NEW/$ASSET" | grep -c -F 'doqzxvppibuzieajqkxm.supabase.co'  # expect >=1
curl -s "$NEW/$ASSET" | grep -c -F "$SCENE_URL"                        # expect >=1
curl -s "$NEW/$ASSET" | grep -c -F "$ALLOW"                            # expect >=1
curl -s "$NEW/$ASSET" | grep -c -F 'localhost:5174'                    # expect 0  <-- the sentinel
```

The sentinel is the technique `DEPLOYMENT.md` already prescribes: with `VITE_SCENE_URL` set, Rollup constant-folds `"https://…" || 'http://localhost:5174'` and drops the fallback. A non-zero count means the env var did **not** reach the bundle.

**[OWNER] The authoritative check, which cannot be scripted:** sign in at `$NEW` with the allowlisted email. `VITE_ORGANISER_ALLOWLIST` is documented **fail-closed**, so a successful sign-in *is* the proof it reached the bundle — a bundle missing the variable and a bundle with an empty allowlist are indistinguishable from outside. Then open an application and copy the Scene link it hands out; confirm it points at `yespleez.com`, not localhost.

No `_redirects` is needed and none must be added: the app uses `HashRouter` (`src/App.jsx:1,95`) precisely so deploys need no redirect rules. **Do not "fix" this during the move.**

### 4.4 [ME] Redirect the old URL — the last commit repo B will ever receive

Only after 4.3 passes and both URLs serve the same app.

```bash
cd "$B" && git checkout master
printf '/*  https://yespleez-festival.pages.dev/:splat  302\n' > public/_redirects
git add public/_redirects
git commit -m "The Portal now lives in the monorepo; send everything there"
git push origin master && git push backup master
```

Verified against Cloudflare's docs (this is a well-known Pages gotcha and it does **not** apply): *"Redirects are always followed, regardless of whether or not an asset matches the incoming request."* So the rule fires for `/` even though the old deployment still contains `index.html` — which is exactly the path HashRouter users hit. Splats and absolute-URL destinations are both supported, and browsers preserve the URL fragment across a 3xx whose `Location` carries none. `…/#/apply/abc` lands on `…yespleez-festival.pages.dev/#/apply/abc`. 302 not 301, so the decision stays reversible in browser caches.

**Verify:**
```bash
curl -sI "https://yespleez-festival-portal.pages.dev/" | grep -iE '^(HTTP|location)'
#   expect: HTTP/2 302  +  location: https://yespleez-festival.pages.dev/
```
Then in a real browser, paste an actual application link with its `#/…` fragment.

⛔ **Never delete the `yespleez-festival-portal` Pages project.** Deletion releases the `.pages.dev` subdomain into the global pool, and recreating under the same name is widely reported to fail with error `8000000`. Project deletion can itself fail on projects with 100+ deployments, leaving a half-dismantled project. No upside, permanent downside.

### 4.5 [OWNER] Update Scene's pointer at the Portal

`VITE_FESTIVAL_PORTAL_URL` is consumed by Scene's source but exists **only** as a Cloudflare dashboard variable — not in `.env.local`, not committed anywhere. Update it in **both** Scene environments to `https://yespleez-festival.pages.dev`.

Then — **do not use "Retry deployment"**. Whether a retry re-reads current variables or replays the deployment's captured config is not reliably documented. Instead:
```bash
cd "$A" && git checkout main && git commit --allow-empty -m "Rebuild for VITE_FESTIVAL_PORTAL_URL" && git push origin main
```

**Verify:**
```bash
curl -s "https://yespleez.com/$(curl -s https://yespleez.com/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)" \
  | grep -c -F 'yespleez-festival.pages.dev'    # expect >=1
```

*Ordering note: between 4.4 and 4.5 Scene points at the old Portal URL, which now 302s to the new one. There is no broken window at all.*

### 4.6 [ME] Retire repo B — **archive only after the same week-long soak, and know what it costs**

⚠ **`gh repo archive` makes the repo read-only, which kills 4.4's documented rollback.** The redirect revert is `git push origin master` — rejected on an archived repo. Archiving is therefore not a neutral act; it converts the redirect from reversible to reversible-after-an-extra-step.

**Hold 4.6 for one week**, then:
```bash
gh repo archive LucYesPleez/YesPleez-Festival-Portal
gh repo view LucYesPleez/YesPleez-Festival-Portal --json isArchived
```
**If the redirect ever needs reverting after this: `gh repo unarchive LucYesPleez/YesPleez-Festival-Portal` first.**

**The OneDrive mirror at `…\repo-backups\YesPleez-Festival-Portal.git`: leave it exactly where it is.** Do not repoint it, do not `git remote set-url` it. *Correction to the draft: it is **not** "frozen at the last pre-merge commit" — 4.4 pushes the redirect commit to it. The real anchor is the `pre-monorepo` tag pushed in 0.2. That tag is your independent snapshot of Portal-as-it-was.*

Keep the local working clone at `$B` until the monorepo has been deploying cleanly for a week, then delete it.

---

## PHASE 5 — Stop, and hold

**Do not start Phase 6 in the same session, or the same week.**

Everything to here is a pure relocation: no dependency graph changed, no build tooling changed, both apps remain self-contained packages isolated by `root_dir` — empirically the exact shape Scene already builds in today. Phase 6 is the first step that changes how the apps resolve modules. Do not couple it to the step that must not break.

**Optional, after the soak, as a standalone change:** add build watch paths. Use `apps/scene/**`, `packages/**`, `supabase/**` (double-star), and **validate by pushing a commit that touches only `apps/scene/src/lib/supabase.js` and confirming a build actually runs.** Never validate a watch path by observing a skip.

---

## PHASE 6 — `packages/event-core` + `packages/event-editor` (a later, separate project)

### 6.-1 [ME] Prerequisite: align `@vitejs/plugin-react` (D13)

Bring the Portal to `^6.0.2`. Own commit, own preview verification. v5 compiles JSX through **Babel**; v6 delegates to Vite 8's **oxc**. Do not ship one shared JSX file through two compilers.

### 6.0 The wiring mechanism (D11)

**Recommendation: npm workspaces** — a root `package.json` with `"workspaces": ["apps/*","packages/*"]` and a tracked root `package-lock.json` (unblocked by 2.6). Single hoisted `node_modules` means `packages/` and `apps/` walk up to the same directory, so the duplicate-instance class does not exist.

Known cost, accepted knowingly: Cloudflare installs the entire workspace regardless of `root_dir` (`workers-sdk#10941`, closed not planned), so a Portal dependency change can fail a Scene build. **That failure is loud and rollback-able.**

**If you nonetheless choose `file:`**, you are choosing a mask over an elimination, and you must add all of:
- `resolve.dedupe: ['react','react-dom','@dnd-kit/core','@dnd-kit/sortable','@dnd-kit/utilities']` — **every** bare specifier the packages import, not just three
- `optimizeDeps: { include: ['react','react-dom','react-dom/client','@dnd-kit/core','@dnd-kit/sortable','@dnd-kit/utilities'] }` — the missing half. `exclude` is already the default for a linked package outside `node_modules`, so the draft's `exclude` line is redundant; without `include`, **dev** gets two React copies and `Invalid hook call` while `vite build` is clean — the classic asymmetry.
- `server: { fs: { allow: ['./', '../../packages'] } }` — **not `'../..'`.** Scene sets `server.host: true` and `allowedHosts: ['.trycloudflare.com','.loca.lt']` for device testing, so `'../..'` exposes the entire repo — including the *committed* `apps/festival/.env.production` — over a public tunnel. Vite's default `fs.deny` probably blocks `.env*`; "probably" is not good enough behind a public tunnel.
- **A check whose success is the evidence**, in both `vite.config.js`:
```js
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
for (const p of ['react','react-dom','@dnd-kit/core','@dnd-kit/sortable','@dnd-kit/utilities']) {
  const a = req.resolve(p);
  const b = createRequire(new URL('../../packages/event-editor/src/index.js', import.meta.url)).resolve(p);
  if (a !== b) throw new Error(`Duplicate ${p}:\n  app: ${a}\n  pkg: ${b}`);
}
```

⛔ **Do not reach for `resolve.preserveSymlinks: true` as the fix.** It is the obvious instinct and it silently disables the JSX transform. Both installed plugin-react copies define `defaultExcludeRE = /\/node_modules\//`; with `preserveSymlinks` every package file's id contains `/node_modules/`, so raw JSX reaches the bundler → `Failed to parse source … contains invalid JS syntax`. If you ever take this route you must also pass `react({ exclude: [/node_modules\/(?!@yespleez)/] })` in **both** apps.

⚠ **`npm ci` silently ignores a change to a linked package's own dependencies.** Measured: adding `"clsx"` to `packages/pkg/package.json` and re-running `npm ci` in the consuming app gave **exit 0, "added 20 packages", no warning, clsx not installed** — the sync guard only inspects the consuming package's own manifest. If you use `file:`, add a pre-release assertion that diffs `packages/*/package.json` dependency keys against what each app's lockfile recorded for the link entry. Workspaces make this class impossible.

⚠ **Disable build caching on both projects for the `file:` rollout**, or bump `packages/*/package.json` `version` on every change. The dependency is a symlink and its *contents* are not in the lockfile hash — a cached copy of the old package can be linked into a fresh app bundle. Successful build, stale shared code, invisible to every content grep.

**Verified so you can stop worrying:** CSS Modules imported from an out-of-tree linked package **do** build under Vite 8 (class hashed, emitted into the app's CSS bundle, no config, no build step). `npm ci` **does** resolve `file:../../packages/…` from a subdirectory root (`"link": true` in the lockfile, junction reproduced, exit 0). `packages/event-editor` needs **no** build step and should not get one — a publishing-style build adds a stale-artifact failure mode for zero benefit since both consumers are Vite. Only "does Cloudflare clone the whole repo before `cd`ing into `root_dir`" remains genuinely preview-only.

### 6.1 What moves, what stays, what gets injected

**→ `packages/event-core/src/`** (zero-dependency): `heroMedia.js`, `eventBadges.js`, `profileAssets.js`, `imageUtils.js`, **and `ImageCropperModal.jsx` + `.module.css`** (pure, no uploads; also consumed by `lib/messageImages.js`).

**→ `packages/event-editor/src/`:** `eventEditorModel.js`, `useEventEditorState.js`, `EventEditorForm.jsx`, `eventEditorModel.test.mjs`, a **new** `eventEditorForm.module.css` split out of `CreateEventScreen.module.css`, and a **new** `reset.css` (see below).

**⛔ `ImageUploadButton.jsx` stays in each app** — the draft's seam analysis missed it. It imports `{ uploadAvatar, uploadPoster, uploadCover }` from `../lib/uploadImage`, and `uploadImage.js:1` is `import { supabase } from './supabase'`. Moving it either fails the build (specifier points out of the package) or drags Scene's Supabase singleton, `authDiagnostics`, `authForensics` and the `posters` bucket path convention into a package the Portal consumes — the third door §6.1 claims to be closing. Compounding: it has two other Scene consumers (`AvatarUpload.jsx`), so moving it would make Scene's **avatar and cover upload** depend on `@yespleez/event-editor`. If you do move it later, inject **all three** upload functions as props, not just `uploadPoster`.

**Stays in the host, injected as props:**

| Stays | Why | Injected as |
|---|---|---|
| `lib/supabase.js` (+ `authDiagnostics`, `authForensics`) | Module-level singleton reading `import.meta.env`; documented `captureBootState()`-before-`createClient()` ordering; Portal has its own at `src/data/supabase/client.js` | never imported by the package |
| `lib/uploadImage.js` | Hardcodes the `posters` bucket and `event_posters/{userId}/…` — and in this codebase the storage path **is** the authorization input to RLS. The Portal's owning entity is a festival *profile*, not a user | `uploadPoster(file, ctx) => url` prop |
| `components/CoHostPicker.jsx` | Queries `profiles` filtered to `type in ('host','venue')` and writes `event_hosts` rows immediately, behind RLS gated on `is_event_main_host()` | `coHostSlot` render-prop |
| `lib/profileTypes.js` | Header reads "⭐ SCENE'S OWN ROLES"; **33 Scene importers**. Form needs one thing: `PROFILE_TYPES[p.type]?.shortLabel` (line 459) | `labelForProfileType(type)` prop |
| `lib/requirements.js` | Form uses only `requestableBySection()` + `requirementLabel()`; file also carries `COMPLETION_KEYS`, `evaluate()`, `completionFor()` with 9 importers | two function props |
| `lib/analytics.js` | Only `CreateEventScreen.jsx:7` imports it; pulling it in re-opens the Supabase door | stays; host fires `track()` |
| `screens/CreateEventScreen.jsx` | Route, session, load, save, delete | the host |

**Narrow `session` → `userId`.** Read at exactly three sites (578, 646, 688). The package's public API must not depend on Supabase's session object shape.

### 6.2 Order of commits

1. **[ME] Move-only.** `git mv` into `packages/{event-core,event-editor}/src/`. Nothing else. `purity` → empty; `git log --follow -- packages/event-editor/src/EventEditorForm.jsx`. ⚠ **`main` must never point at this commit — the tree does not build.** The whole series lands on `main` as one push.
2. **[ME] Import paths.** Rewrite the ~60 Scene import sites. Build green again here.
3. **[ME] CSS split** + the automated guard. Extract the ~59 referenced classes into `packages/event-editor/src/eventEditorForm.module.css`; leave `.screen`, `.content`, `.pageTitle`, `.pageSubtitle` in Scene; drop the ~6 dead classes.
4. **[ME] Seam.** `uploadPoster`, `coHostSlot`, `labelForProfileType`, `requestableBySection`, `requirementLabel`, `userId` as props.
5. **[ME] Wiring.** Workspaces (or `file:` + the full mitigation set), peer deps, vite config, regenerate lockfile(s).
6. **[ME] Scene-only consumption.** Portal untouched. Preview → verify → `main`. **This proves the plumbing with one app at risk.**
7. **[ME] Portal consumption.** Only after (6) has been live and stable. Add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` to `apps/festival/package.json` (it has none today).

### 6.3 The CSS split needs a *check*, not a review

Confirmed in a built bundle: a class left behind becomes `className: styles.missingClass` → `undefined` → React drops the attribute → element renders unstyled → **no console warning, no build error**. `EventEditorForm.jsx` references ~59 real classes (68 `s.X` matches minus `s.map/filter/push/slice/reduce/indexOf/length`); the source CSS defines 65. Review is a weak control for 65 items.

Good news, verified: `CreateEventScreen.module.css` is 679 lines / 89 rule blocks with **zero** `@media`, zero `:global`, zero `composes`, zero descendant or compound selectors, zero duplicate selector blocks. Nothing depends on source order, and CSS Modules hash per file so two output files cannot collide. **There is no cascade hazard** — only a completeness hazard. So:

```js
// packages/event-editor/src/classNames.test.mjs — runs in Node, no bundler
const used = new Set([...jsx.matchAll(/\bs\.([A-Za-z0-9_]+)/g)].map(m => m[1]));
const defined = new Set([...css.matchAll(/^\.([A-Za-z0-9_-]+)/gm)].map(m => m[1]));
for (const c of used) assert(defined.has(c), `missing class: ${c}`);   // also finds dead classes for free
```

### 6.4 The real style contract is the element reset, not the eight tokens

The draft declared a token contract for `--border --card --card2 --dark --muted --neon --neon2 --text`. That is the smaller half. The two apps' global resets differ concretely:

- Scene `index.css`: `*,*::before,*::after { box-sizing; margin:0; padding:0; -webkit-tap-highlight-color }`, `button { cursor; border:none; font-family:inherit }`, **`input, textarea, select { font-family: inherit }`**
- Portal `styles/base.css`: `*,*::before,*::after { box-sizing }` **only — no margin/padding reset**; `input, select { font-family: inherit }` — **no `textarea`**

The shared editor uses `<textarea>`. In the Portal it renders in the UA monospace default while everything around it is DM Sans, and every `<p>`, `<label>`, `<h*>` inside the shared form gains browser default margins. Neither is a token; a `tokens.contract.css` catches neither.

**Fix: `packages/event-editor/src/reset.css`, imported by the package's own entry, restating those three rules scoped to the editor root.** The package becomes self-sufficient instead of depending on either host's globals. If you also want a token contract file, `"exports"` must name it — verified: `import.meta.resolve('@yp/pkg/src/w.module.css')` → `ERR_PACKAGE_PATH_NOT_EXPORTED`. Add `"./*": "./src/*"`, or keep the two packages strictly separate so `event-core` consumers never pull editor CSS through a shared barrel.

### 6.5 `--yp-safe-bottom` — fix the use site, not the token

The draft says "add `--yp-safe-bottom` to the Portal's `tokens.css`". Doing that mechanically **reproduces the failure it fixes**: in Scene it is `calc(var(--yp-nav-height) + var(--yp-player-height))`, and both operands are rewritten at runtime by `BottomNav.jsx:35` and `App.jsx:306,315` via `setProperty`. Copied into the Portal it is a `calc()` over two undefined custom properties — parses fine, then the consuming `padding-bottom: var(--yp-safe-bottom)` becomes invalid at computed-value time and is **dropped**.

**Fix, and it removes the contract entirely:** change `EventEditorForm.jsx:917` from `paddingBottom:'var(--yp-safe-bottom)'` to `paddingBottom:'var(--yp-safe-bottom, 0px)'`. Correct in both apps, no token to declare, no drift to police.

### 6.6 Three defects to fix as part of this, not after

- **`setTimesNeeded` has no config round-trip.** `emptyEventForm()` defaults it `true`; `toConfig()` reads it; `fromConfig()` never returns it and `hydrate()` never sets it. An event saved with set times OFF (`days: []`) reloads with `setTimesNeeded: true`, and the next save writes `days: [{name:'', slots:[]}]` — a round trip turns "no running order" into a phantom Day 1. Only form field with no round trip, and it is in the file **both apps would share**. Fix before it propagates.
- **Tests going quiet — three of them, not one.** Scene's `npm test` globs `src/**/*.test.js` (64 files). `heroMedia.js`, `eventBadges.js` and `profileAssets.js` each have a co-located `.test.js`, so moving the sources moves **three currently-running suites out of the suite** — a regression the draft did not spot. Plus `eventEditorModel.test.mjs` (the only `.test.mjs` in the repo) never ran in the first place. The packages cannot simply `node --test` these: `useEventEditorState.js:4` imports `'./heroMedia'` **extensionless**, which plain Node rejects — that is what `v2/test/resolve-hook.mjs` exists for, and it lives in the app. **Fix:** move `resolve-hook.mjs` to a shared `packages/test-harness` (or duplicate it), give each package a `test` script globbing `.mjs` **and** `.js`, and add a repo-root `npm test` that runs all four.

---

# 3. ROLLBACK

| Step | Live-site risk | Rollback |
|---|---|---|
| 0.1–0.4 backups, tags, fsck | none | Tags: `git tag -d pre-monorepo && git push origin :refs/tags/pre-monorepo`. Mirror: `rm -rf` it, derived data. |
| **0.5 visibility flip** | Pages↔GitHub binding | `gh repo edit --visibility public`. The 0.5 empty-commit build check is the detector; do it here, not after B's commits are in. |
| 0.6 PR #2 | none | Standard PR revert. |
| 0.7 Preview env vars | none | Delete them. No production effect. |
| **0.10 Scene pre-release** | **`yespleez.com`** | ① **[OWNER] Cloudflare instant rollback** — Deployments → last known-good → Rollback. Seconds, no build. Do this *first*, diagnose after. ② `git revert` on `main` and push. |
| 0.11 delete node_modules | none | `npm ci`. |
| 1.1–1.4 branch work | none — nothing has left the machine | `git checkout main && git branch -D monorepo` |
| 2.1–2.6 merge | none | `git reset --hard <sha-before-merge>` (from reflog), or delete the branch. Repo B untouched throughout. |
| 2.7 Node pin | first preview build after | `git rm apps/*/.nvmrc && git commit` — returns to the dashboard default. |
| 3.1 push branch | none technically | `git push origin :monorepo`. ⚠ Repo B's commits are now on the remote — if repo A were public this would be irreversible. It is private (0.5), so it is not. |
| **3.2 build config change** | Latent — breaks preview builds immediately, production only on the next push to `main` | Set `root_dir` back to `v2`. Instant, no build. Diff `cf-*-after.json` against `cf-*-before.json` to catch anything the PATCH erased. |
| **3.5 Scene cutover** | **`yespleez.com`** | ① **Cloudflare instant rollback** (first, always). ② `git revert -m 1 <merge-sha>` on `main` and push, **then set `root_dir` back to `v2`** — order matters, the revert restores `v2/`. ③ Only if nothing else has landed: `git reset --hard <old-main> && git push --force-with-lease origin main`. ⛔ **Never rewrite history to fix a broken production.** `CLAUDE.md`, docs, handovers and memory cite commits by hash throughout. This entire migration is additive; preserve that. |
| 3.6 v2-react ff | none | It is a fast-forward; `git reset --hard <old>` locally if wrong. |
| 3.8 vite root/envDir | `yespleez.com` | Cloudflare rollback, then `git revert`. Shipping it separately is *why* this rollback is one thing. |
| 4.2 new Pages project | **none** — the old Portal URL is still live and untouched | Delete the *new* project. Nothing has changed for any organiser. |
| **4.4 the 302 redirect** | **`yespleez-festival-portal.pages.dev`** | `git revert HEAD && git push origin master` in repo B. The old project rebuilds and serves the app directly again. **This is why the redirect is last and why the old project is never deleted.** ⚠ **After 4.6, `gh repo unarchive` first** — an archived repo rejects the push. ⚠ Also: once 4.4 is live the old project can no longer act as a serving fallback; the git revert is the only way back. |
| 4.5 Scene pointer | `yespleez.com` links to the Portal | Revert the dashboard variable, push another empty commit. Between 4.4 and 4.5 there is no broken window — the old URL 302s. |
| 4.6 archive repo B | none directly | `gh repo unarchive`. Held a week precisely so 4.4's rollback stays one step. |
| 6.x | `yespleez.com` and the Portal | Every commit series ships preview-first; Scene-only consumption (6.2 step 6) proves the plumbing with one app at risk. Cloudflare rollback + `git revert` as above. |

---

# 4. WHAT THE ADVERSARIAL REVIEW CHANGED

**Broken verifications — the plan was checking things that could not pass, or could not fail.**

1. **The provenance check returned 0 on every healthy deployment.** `vite.config.js:30-31` does `CF_PAGES_COMMIT_SHA.slice(0,7)`; the plan asserted a 40-char SHA and greped for it. Repeated three times in step 5, so the operator saw `0 0 0` at the exact moment of deciding whether to hit Rollback on `yespleez.com`. **Now:** `--short=7` (not `--short` — git auto-lengthens, Cloudflare never does) and grep the JSON-quoted form.
2. **The purity gate printed 28 lines on a pure rename.** `git show` emits the `Author:` header; `--numstat` emits `-` for binaries. **Now:** `git diff-tree -r -M --name-status --format= HEAD | awk '$1!="R100"'`, verified empty on a clean `git mv` and verified to catch both text and binary edits folded into a move. Applied in all five places.
3. **`git check-ignore` on a tracked path is a tautology.** It consults the index and never reports a tracked file as ignored — so the "critical env check" would keep passing even if someone added `.env*` to the root `.gitignore`, the exact regression it guards. **Now:** `--no-index`, paired with `git ls-files --error-unmatch`, and moved into the release checklist rather than left as a one-time check.

**Silent-failure mechanisms the plan introduced.**

4. **Build watch paths.** `apps/scene/*` may not match `apps/scene/src/**` if `*` is segment-bounded (undocumented, and neither reviewer could verify it). Result: production silently stops updating while builds report green-because-skipped — and the "bypassed by 20+ commit pushes" note makes it *intermittent*, so it looks flaky rather than misconfigured. **Now: watch paths are removed from Phases 3 and 4 entirely**, deferred to a standalone post-soak change validated by proving a build *runs*, using `**`. In Phase 6 they become an outright correctness hazard (a shared-package fix skipped on both projects) — so the guidance there is to leave them off.
5. **A repo-root `node_modules` containing `@dnd-kit` already exists** and, after Phase 1, is an ancestor of `packages/`. Vite's default `preserveSymlinks: false` means package files resolve bare imports from the root copy — measured directly. The plan's dedupe list covered `@dnd-kit/core` but not `sortable`/`utilities`, so `useSortable` would bind to a different instance than `DndContext` and **poster reorder silently does nothing**, locally only. **Now:** deleted in 2.6, plus a full dedupe list and a resolution-equality assertion that fails the build.
6. **`preserveSymlinks: true` — the obvious fix for (5) — silently disables the JSX transform.** Both plugin-react copies exclude `/node_modules/`. **Now:** documented as a trap, with the `exclude` regex required if ever taken.
7. **`npm ci` silently ignores a linked package's own new dependencies** — measured: exit 0, no warning, package not installed. **Now:** an argument for workspaces, plus a pre-release assertion if `file:` is kept.
8. **A class left behind in the CSS split becomes `undefined` with no warning anywhere.** ~59 referenced vs 65 defined; human review is a weak control for 65 items. **Now:** an automated subset assertion in the package's own tests.
9. **`--yp-safe-bottom` copied into the Portal reproduces its own failure** — the Scene definition is a `calc()` over two runtime-injected properties. **Now:** fix the use site with `var(--yp-safe-bottom, 0px)` and delete the contract.

**Payload and sequencing.**

10. **The cutover carried 11 unreleased commits and a product launch.** `main..v2-react` = 11, and `.env.production`'s own comment says the festival apply flow "is NOT on main yet" — so the migration deploy would have flipped the live Scene↔Portal integration on, inside the first-ever build from a new root directory. **Now: 0.10 does a normal release first**, `monorepo` branches from that `main`, and the vite `root`/`envDir` change is split into its own post-cutover deploy (3.8). The cutover diff is now one screen.
11. **Open PR #2 resurrects the legacy root files.** Merged post-move it leaves `events.js` and `profiles.js` **at the repo root** (rename detection followed `index.html` but not the others), disarming the entire failure-mode-(3) defence. The plan never mentioned it. **Now:** D2 makes landing/closing it a gate, with a `git ls-files` regression check in 1.4.
12. **The ratified release ritual stops working after 3.5.** `git merge --ff-only v2-react` returns `fatal: Not possible to fast-forward`, and non-ff merges produce `CONFLICT (file location)` on every *new* file. **Now:** step 3.6 ff's `v2-react` to `main` and updates `CLAUDE.md`.
13. **The two-branch model inverted its own goal.** `festival` as ff-only-from-`main` meant every Portal release had to route through Scene's production branch. **Now:** `festival` is independent; `main` → `festival` only for shared changes.
14. **Visibility flip moved from 3.1 to Phase 0**, with an empty-commit build check between the flip and the migration push — so a broken GitHub App binding is never confused with a broken migration. And the recommendation is sharpened from "decide Q1" to "go private as a *sequence*": going private is reversible, publishing B's commits is not, so the irreversible step leaves the critical path entirely.
15. **`git gc` deleted for no benefit.** Repo A has 19 dangling commits; plain `gc` prunes unreachable objects at two weeks and expires unreachable reflog entries at 30 days. The stated goal was one temp pack file. **Now:** delete the file, stop.
16. **`git clone --mirror` produced hardlinks** — link count 2, inodes shared with the repo it was backing up, inside a directory a sync client rewrites. **Now:** `--no-hardlinks`, OneDrive pinned to "always keep on this device", and `git fsck --full` added to verification (`rev-list --count` passes on a mirror with missing objects).
17. **`gh repo archive` (4.6) destroyed 4.4's documented rollback** — archived repos reject pushes. **Now:** 4.6 held for a week and the `unarchive` prerequisite stated.
18. **`git mv v2` under a running dev server** would fail or half-complete on Windows on ~tens of thousands of `node_modules` files. **Now:** delete `node_modules`/`dist` in 0.11, *before* the move, not 1.3 after it.
19. **Partial `build_config` PATCH** replaces the nested object, dropping `build_caching` and analytics keys — and the read-back only checked the three keys it wrote. **Now:** GET → mutate one key → PATCH the whole object → GET → diff, with `deployment_configs` diffed too.
20. **Unexplained `.env.production` behaviour was treated as a foundation.** Its header claims dashboard variables "did not deliver" — the opposite of Vite's documented `loadEnv` precedence. **Now:** 4.0 greps the *live* bundle for all four values before creating the new project. If any is absent, `.env.production` is not what is running.
21. **Node delivery contradicted itself** — 2.7 pinned `.nvmrc` on an undocumented assumption while 4.2 said "environment variables: none", which would drop a `NODE_VERSION` override. Neither project can be on a v2 default (both need Node ≥20.19 for Vite 8), so something is already overriding it. **Now:** 0.8 records the mechanism; `NODE_VERSION` carries forward as an explicit exception; `.nvmrc` only after a build log proves it is read.
22. **Service worker / PWA has no preview test surface.** Registration state is per-origin; a fresh install on the preview origin proves the manifest is served and nothing about the *upgrade* path. **Now:** step 3.7, on a device that already had the app installed. (Credit where due: `sw.js` is network-first for navigations and only caches content-hashed assets, so the classic "SW pins the old build forever" failure is genuinely defused — `SW_BUILD` needs no bump.)
23. **`ImageUploadButton` breaks the Supabase seam.** It moves into the package per §6.1 but imports `../lib/uploadImage`, which imports Scene's Supabase singleton — the third door §6.1 claims to close. It also has two other Scene consumers, so moving it makes Scene's avatar/cover upload depend on the editor package. **Now:** it stays in each app; `ImageCropperModal` and `imageUtils` go to `event-core`.
24. **The style contract is the element reset, not the tokens.** Portal's `base.css` has no margin/padding reset and does not include `textarea` in the font-family rule — the shared editor's `<textarea>` would render in UA monospace and every label/paragraph would gain default margins, in the Portal only. **Now:** the package ships its own scoped `reset.css`.
25. **Three test suites go quiet, not one.** `heroMedia`, `eventBadges` and `profileAssets` each have a co-located `.test.js` inside Scene's `src/**/*.test.js` glob. **Now:** flagged alongside the `.test.mjs`, with the `resolve-hook.mjs` extensionless-import problem and a repo-root `npm test`.
26. **The workspaces rejection was two-thirds wrong.** Hoisting *prevents* the duplicate-React problem rather than causing it, and the gitignored-lockfile objection is a bug being fixed anyway. **Now:** D11 flips the recommendation to workspaces, with the surviving cost (Cloudflare installs the whole workspace) stated honestly as a loud failure traded against a silent one.
27. Smaller corrections adopted: `/c/temp` → scratchpad; `git fetch` + `main == origin/main` check before every ff; "Retry deployment" → empty commit; `optimizeDeps.exclude` is redundant, `include` is the missing half; `server.fs.allow: ['../..']` exposes the committed `.env.production` over Scene's public tunnels; `"exports": {".": …}` blocks the token-contract import; the Portal mirror is *not* frozen pre-merge (4.4 pushes to it) — the `pre-monorepo` tag is the real anchor; `festival` needs a written update ritual; preview "All branches" burns a 500/month build cap; plugin-react 5 vs 6 is Babel vs oxc and must be aligned first.

**Raised, but does not apply — with the reason.**

- **`apps/scene/dist` as the output directory is the *safe* mistake, not the dangerous one.** The draft called it "the single most likely thing to get wrong, producing a successful build with an empty deployment". With `root_dir=apps/scene` it resolves to `apps/scene/apps/scene/dist`, which does not exist — Pages fails loudly and production stays up. The genuinely dangerous values are `.`, `/`, `apps`, and an **empty build command**, all of which publish the source tree: HTTP 200, a valid `index.html` requesting `/src/main.jsx` that 404s, and a white screen on `yespleez.com`. The plan's threat model was pointed at the wrong field. Corrected in 3.2, and `legacy-v1/` is now described as defending only the *root* `index.html` case.
- **The unanchored `package-lock.json` gitignore rule is not currently causing dependency drift.** Both real lockfiles (`v2/package-lock.json`, the Portal's) are **tracked** — gitignore does not affect already-tracked files — so `npm ci` has a lockfile inside both `root_dir`s today and the migration really is dependency-neutral. The rule still must go, because it *does* match `packages/*/package-lock.json` and fires exactly when Phase 6 lands.
- **The CSS split has no cascade hazard.** Zero `@media`, `:global`, `composes`, descendant selectors or duplicate blocks across 89 rules; CSS Modules hash per file. "Must be reviewed by a human" was right for the wrong reason — the risk is completeness (a class left behind), which is why it is now an automated check.
- **CSS Modules and `npm ci` both work from a linked out-of-tree package.** The draft listed `file:` resolution as unverifiable; the npm half is now verified (`"link": true`, junction reproduced, exit 0) and CSS Modules compile from package source with no build step. Only "does Cloudflare clone the whole repo before `cd`ing into `root_dir`" is genuinely preview-only.
- **The 4.4 `_redirects` rule does fire despite the old deployment containing `index.html`.** Static-asset-beats-redirect is a real Pages gotcha that would have made the whole redirect a no-op for `/` — the exact path HashRouter users hit. Cloudflare's docs are explicit that redirects are always followed. Sound as written.
- **The 3.2 → 3.5 window is genuinely safe.** With `root_dir=apps/scene` saved and `main` still containing `v2/`, any production build fails and the last deployment keeps serving.
- **`.env.local` does not shadow `.env.production`** during `vite build` — Vite's load order puts `.env.[mode]` after `.env.local`. The check was still weakened (the greped value is the one key *not* in `.env.local`), so 2.4 now runs in a clean clone.
- **CRLF, MAX_PATH, filename collisions, and the dotfile re-root loop are all non-issues on this machine** — byte-verified: this Git Bash's `grep` strips CR before `cut` sees it; longest path after the move is ~198 of 260; B's root tree is 14 entries with no spaces and no collision with A's. `tr -d '\r'` added anyway as free insurance if the plan is ever run elsewhere.
- **The repo-visibility reasoning was correct.** The anon key is already in A's public `state.js`, the allowlist email in four tracked files since `38841c1`, the project ref in five including the baseline migration; B's history contains no `service_role` string ever added or removed. Genuinely a strategy call, not a security one. Cost of going private is zero: no forks, stars, watchers, Pages site, branch protection or Actions workflows.
- **Commit counts, history preservation and the merge strategy all reproduce exactly** in an independent end-to-end dry run: 1381 commits, `--follow` on `apps/festival/src/App.jsx` = 14, on `apps/scene/src/lib/supabase.js` = 4, blame reports `ac4f0c3c v2/src/lib/supabase.js`, merge conflict-free, `.env.production` tracked and not ignored.
- **2.5's `root`/`envDir` pinning is a genuine no-op-plus-guard for Scene** — `v2/vite.config.js` already resolves paths from `import.meta.url`, so `root: here` is the directory it already used and `build.outDir`/`publicDir` do not move.
- **Move-only commits, never `--squash`, never deleting the old Pages project, never rewriting history, `resolve.dedupe` existing because duplicate React was already a problem, the dependency-range divergence between the two apps, and the Q7 two-package split** — all confirmed correct, with the reasoning given being the right reasoning.

---

# 5. RESIDUAL RISK

After every mitigation above, these remain. None is a reason not to proceed; all are reasons to have the rollback open in another tab.

1. **Cloudflare's watch-path glob semantics are still unverified.** The plan sidesteps this by not using watch paths — but that means every push to `main` rebuilds Scene and every push to `festival` rebuilds the Portal, against a **500 builds/month, one concurrent build** cap. If you approach the cap you lose the ability to ship a fix, which turns a cosmetic problem into an outage you cannot end. Watch your build count during the migration week.

2. **Whether Cloudflare clones the whole repo before `cd`ing into `root_dir` is provable only by a real deploy.** The npm and Vite halves of Phase 6's `file:` mechanism are now locally verified; this half is not. It is why 6.2 step 6 ships Scene-only first.

3. **`root_dir`-relative output directory is confirmed only by the current dashboard value, not by documentation.** Cloudflare's docs are ambiguous and third-party writeups disagree. The current Scene project builds successfully from `v2/` with whatever is in that box, so it is empirical ground truth — but if the box turns out to say something unexpected, stop and re-derive rather than assuming.

4. **A "successful but wrong" build can still white-screen production.** `apps/scene/index.html` requests `/src/main.jsx`, so a cleared build command or a destination of `.`/`/`/`apps` publishes the source tree at HTTP 200 with correct headers. `legacy-v1/` does not defend this. The only defences are the config read-back diff and treating the 3.4 content checks — not the dashboard tick — as the gate.

5. **The `.env.production` anomaly is mitigated, not explained.** 4.0 proves what is configuring the live bundle *today*; it does not explain why the dashboard panel apparently lost to the file, which contradicts Vite's documented precedence. A new project on a newer build image may behave differently. The 4.3 sentinel (`localhost:5174` count = 0) and the fail-closed sign-in are your detectors.

6. **Secret-typed environment variables may be unrecoverable.** Encrypted Pages variables cannot be read back from the dashboard or the API. The VAPID key now has a third recovery path (the live bundle), but any *other* secret-typed variable you cannot read is a variable you cannot restore. Find out in 0.8, not later.

7. **The service worker upgrade path is verified once, manually, on one device.** It cannot be automated and it cannot be tested before the production deploy. If it goes wrong, symptoms are a stale bundle and dead push notifications on installed devices — while the page renders normally for everyone else.

8. **After 4.4, the old Portal project can no longer serve as a fallback.** The wildcard redirect means the git revert in repo B is the only way back, and after 4.6 that revert needs an `unarchive` first. This is why 4.6 is held a week.

9. **`git merge --allow-unrelated-histories` is a one-way door in practice.** The rollback is `git reset --hard` on an unpushed branch, which is clean — but once `main` has moved past it and other work has landed, unwinding the merge is a history rewrite, and this codebase cites commits by hash throughout `CLAUDE.md`, docs, handovers and memory notes. Treat 3.5 as the point of no easy return.

10. **Git integration is a one-way door on Cloudflare's side too.** "If you deploy using the Git integration, you cannot switch to Direct Upload later." Wrangler direct-upload is not an escape hatch for a misconfigured project.

11. **Phase 6's shared-code failures are the quiet kind.** A duplicate `@dnd-kit` instance, a missing CSS class, an unstyled `<textarea>`, a dropped `padding-bottom`, a stale cached package — none of them error, none of them warn, and several appear in only one of the two apps. Every mitigation in 6.0–6.6 exists to convert one of those into something that fails loudly. Assume you missed one; ship Scene-only first and let it sit.

12. **The Portal's `npm test` is a single hard-coded file** (`node --test src/companion/priorities.test.mjs`). Nothing in this plan changes that. Do not read a green Portal test run as evidence of anything beyond that one file.