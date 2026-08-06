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

## Why not the dashboard's "Variables and secrets"?

Controlled experiment, 2026-08-06: with correctly named `VITE_*` variables
visible in the panel's **Production** scope (type Plaintext), four consecutive
successful builds produced bundles in which `import.meta.env` had none of the
values, while the same names supplied via `.env.production` baked in every
time, same commit, same pipeline. Their presence in the panel is documented by
dashboard screenshots taken between those builds.

⚠ A cleaner sentinel test (a variable set *only* in the panel, then grepped for
in the bundle) was designed but **never actually ran** — the sentinel was never
created in the dashboard, which was only discovered afterwards. The evidence
above is observational, not the controlled version.

**What this shows:** the configuration used — that panel, Production scope,
Plaintext type — did not supply Vite's build across four attempts.
**What it does not show:** that Cloudflare Pages has no supported
build-variable mechanism. If one is identified later, migrate freely — but run
the sentinel test for real first: add `VITE_DASHBOARD_PROBE=reached-the-build`
in the candidate location ONLY, **verify it exists there**, push a real source
change, and grep the deployed bundle for the literal. Only a positive grep
justifies deleting this file.

The dashboard variables were removed after the experiment so there is exactly
one apparent source of truth. If you find values in the dashboard panel again,
they are dead config — the build does not read them.

## Beta access

The organiser side is gated by `VITE_ORGANISER_ALLOWLIST` (comma-separated
emails, **fail-closed** when unset) plus the restrictive RLS policy
`festival_profile_creation_is_invite_only` on `public.profiles`. The public
apply route `/#/apply/:eventId` is deliberately outside the gate.
