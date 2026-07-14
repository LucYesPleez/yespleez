# Festival support — product strategy (2026-07)

**Status: intentional launch decision. Read this before re-enabling anything festival-related.**

## The decision

Festival support is hidden in the main YesPleez release. This is a **product
decision, not a technical limitation** — the underlying data model and code
already support it; it is deliberately not exposed to users this release.

## Why

Festival Edition will be a separate, dedicated product with substantially
more capability than anything the core app offers today:

- Multi-stage scheduling
- Stage management
- Volunteer management
- Artist liaison
- Operations dashboards
- Accreditation
- Crew coordination
- Festival-specific workflows

If festival organisers encounter festival features in the core app before
Festival Edition exists, they will reasonably assume what they see *is* the
platform's full festival capability, and may dismiss YesPleez before Festival
Edition ever ships. Under-promising here is deliberate.

Until Festival Edition exists, the core app focuses exclusively on:

- Venues
- Promoters
- DJs
- Bands
- Comedians
- Community events
- Local discovery

## The architecture (what does NOT change when Festival Edition ships)

Festival organisers remain **Host profiles** — there is no separate Festival
profile type, and Festival Edition will not introduce one. A festival is
(and will remain) an event category owned by a Host profile, the same way
`profiles.type = 'host'` already works for every other promoter today.

Festival Edition reuses the same Host identity and data model. It unlocks
additional festival-specific capability *for existing Host profiles* rather
than migrating anyone to a new profile type or a new identity.

## How the hiding actually works (so it isn't rediscovered as "missing code")

The taxonomy already exists — it's just flagged off:

- `v2/src/lib/profileTaxonomy.js` — `HOST_CATEGORIES` includes a `Festivals`
  entry with `enabled: false`. `VISIBLE_HOST_CATEGORIES` (the filtered list)
  is what every user-facing picker renders from. **Re-enabling Festival
  Edition's core taxonomy is flipping that one flag to `enabled: true`** —
  not adding a new entity type, not a schema migration, not a structural
  refactor.
- Parsing (`HOST_CATS`, `parseGenreString`/`buildGenreString` in
  `HostProfileScreen.jsx`) always uses the *full* category list, not just
  the visible one — a Host profile that already has `Festivals` embedded in
  its stored `genre_string` (e.g. imported via Studio) round-trips correctly
  today. Nothing needs to change there when the flag flips either.
- `CreateEventScreen.jsx`'s category chip, `WhatsOnScreen.jsx`'s Discover
  filter, and `eventBadges.js`'s auto-detection all omit/skip Festival the
  same way — by not including it in the list they render from, not by
  deleting festival-handling code paths.
- `VenueProfileScreen.jsx`'s "Festival Site" venue type and "Festivals"
  perfect-for tag are commented out of their option arrays for the same
  reason.
- Demo/sample content was also de-festivalled (the featured demo event,
  a demo genre tag, a sample "following" entry) so the app's own onboarding
  experience doesn't set festival expectations either.

**When Festival Edition is ready:** flip `HOST_CATEGORIES`'s `Festivals`
entry to `enabled: true`, re-add "Festival" to the category chip / Discover
filter / venue-type and perfect-for pickers, and build the dedicated
Festival Edition capability (stage management, volunteer management, artist
liaison, ops dashboards, accreditation, crew coordination) on top of the
existing Host profile — not a new profile type.

## Studio (internal tool) — not in scope for this restriction

This hiding applies to the customer-facing main app only. YesPleez Studio
(the internal moderation/import tool) already resolves a festival's
organiser as a `host` entity (see `docs/review-queue.md`'s 2026-07-14
amendment) — that's an internal data-modeling decision, independent of what
the main app chooses to expose to users, and is not affected by this
document.
