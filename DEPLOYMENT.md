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
values. A sentinel variable set **only** in the panel
(`VITE_DASHBOARD_PROBE=reached-the-build`) never appeared in the built bundle,
while the same names supplied via `.env.production` baked in every time, same
commit, same pipeline.

**What this proves:** the specific configuration tested — that panel, that
scope, that type — does not supply Vite's build.
**What it does not prove:** that Cloudflare Pages has no supported
build-variable mechanism. If one is identified and verified later, migrating is
fine — verify with the same sentinel experiment before deleting this file.

The dashboard variables were removed after the experiment so there is exactly
one apparent source of truth. If you find values in the dashboard panel again,
they are dead config — the build does not read them.

## Beta access

The organiser side is gated by `VITE_ORGANISER_ALLOWLIST` (comma-separated
emails, **fail-closed** when unset) plus the restrictive RLS policy
`festival_profile_creation_is_invite_only` on `public.profiles`. The public
apply route `/#/apply/:eventId` is deliberately outside the gate.
