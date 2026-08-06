# Deployment

**Host:** Cloudflare Pages, project `yespleez-festival-portal`, auto-deploying
from `master` on `LucYesPleez/YesPleez-Festival-Portal`.
Build `npm run build`, output `dist`. No redirect rules — the app uses a
HashRouter precisely so deploys need none.

## Build-time configuration: `.env.production` — a decision, not an accident

Vite build-time configuration lives in the **committed** `.env.production`:

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ORGANISER_ALLOWLIST`

**These are intentionally public client-side values only.** The anon key ships
to every browser by design; Supabase RLS is the protection, not the key. The
allowlist feeds a UX gate whose real enforcement is the restrictive RLS policy
on festival-profile creation.

⛔ **Never place a secret in this file.** It is committed and compiled into a
public bundle. Server secrets belong elsewhere — Functions/server-side
configuration — and the moment a genuinely secret build value is needed, this
mechanism must be revisited rather than stretched.

## Why `.env.production` and not the dashboard? (full history — read before "fixing")

Two experiments, opposite results:

**2026-08-06, observational:** the three `VITE_*` variables entered during
*project setup* were visible in the panel's Production scope, yet four
consecutive successful builds produced bundles in which `import.meta.env` had
none of the values. `.env.production` delivered every time, same pipeline. (A
sentinel test attempted that night is void — the sentinel was never actually
created, discovered only afterwards.)

**2026-08-07, controlled:** a sentinel variable
(`VITE_DASHBOARD_PROBE=reached-the-build`) added via **Settings → Variables and
secrets → Add**, existence verified by screenshot before the push, **WAS baked
into the deployed bundle**. The panel does feed Vite builds.

**So the panel works, and why the original three never reached a build is
unrecoverable** — they were deleted before the controlled run. Leading
hypotheses: an entry error (typo/whitespace in hand-typed names or values), or
a difference between variables created in the *project-setup flow* versus the
*Settings panel*.

**Current decision: `.env.production` stays.** Both mechanisms are now known to
work; this one is committed, reviewable, host-portable, and survived the whole
saga. Migrating back to dashboard variables is legitimate — if doing so, add
them via **Settings → Add** (not the setup flow), then verify with the sentinel
method before deleting this file: reference the variable in code, push a real
change, grep the deployed bundle for its value.

The dashboard variables were removed after the experiment so there is exactly
one apparent source of truth. If you find values in the dashboard panel again,
they are dead config — the build does not read them.

## Beta access

The organiser side is gated by `VITE_ORGANISER_ALLOWLIST` (comma-separated
emails, **fail-closed** when unset) plus the restrictive RLS policy
`festival_profile_creation_is_invite_only` on `public.profiles`. The public
apply route `/#/apply/:eventId` is deliberately outside the gate.
