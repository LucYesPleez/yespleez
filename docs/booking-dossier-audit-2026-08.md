# Booking dossier & generic application framework — architectural audit

**Date:** 2 Aug 2026 · **Type:** audit only. No code written, no schema changed, no recommendations.
**Question asked:** how much of a professional booking application already exists inside the codebase,
and can the existing architecture evolve into a *generic* application framework rather than a DJ
booking system?

---

## 0. Method, and the limits of this audit

Everything below is grounded in files read directly in this session. Where a fact comes from an
existing audit document rather than from live probing, it is attributed.

**Verified directly this session:** the five profile editor screens' save payloads, the profile type
registry, the taxonomy module, `useProfileForm`, `enquiryUtils`, the enquiry insert path in
`ProfileScreen`, the availability read/write paths, the applications insert paths, the social/media
provider registries, and a repo-wide sweep for booking-commercial fields and technical documents.

**Taken from existing audit docs (not re-probed live):** the live table census, real column lists for
`venue_enquiries` and `applications`, and the RLS/schema-drift findings — from
`docs/live-schema-audit-2026-07.md` (17 Jul, anon-key probe) and `docs/known-issues/*`.

**NOT covered in this pass — stated so it is not mistaken for "audited and found empty":**

- the legacy HTML prototype's own field sets (`bands.js`, `venues.js`, `standup.js`, `profiles.js`)
- YesPleez Studio's profile/booking surface (`C:\Users\L-c\GigImporter`)
- a complete public-display map of every field across every surface (only `ProfileScreen` was
  checked for the booking fields specifically)
- web research into real Australian festival application forms — §11's comparison is built from
  standard Australian practice and is labelled as such, not from sources fetched this session

**One standing caveat that colours every schema claim.** `docs/live-schema-audit-2026-07.md` §1.7b
established that the repo and production have drifted **in both directions**: the repo holds DDL
production never received (the Studio export migration), and production holds DDL the repo has never
seen (five `venue_enquiries` columns added via the dashboard). There is no schema baseline. So
"the migration declares column X" is not proof that production has X, and vice versa.

---

## 1. The profile type registry

`v2/src/lib/profileTypes.js` is the single source of truth for profile identity (10E.1).

`RAW_TYPES` declares **five** industry types in canonical order: `venue`, `host`, `artist`, `band`,
`standup`. Each carries `accent`, `accent2`, `muted`, `emoji`, `label`, `shortLabel`, `pathPrefix`
(avatar storage path), `dashPath` (`/industry/<type>`), `gradient`, `defaultImage`.

Three exported surfaces:

| Export | Purpose |
|---|---|
| `PROFILE_TYPES` | derived map, adds `rgb` / `accent2Rgb` / `mutedRgb` |
| `PROFILE_TYPE_ORDER` | `Object.keys(PROFILE_TYPES)` — canonical ordering for free |
| `profileIdentity(type)` | the one lookup; never guesses, never returns undefined |

Two deliberate non-members, both directly relevant to adding applicant types:

- **`UNKNOWN_PROFILE`** (10F) — neutral grey, `label: 'PROFILE'`, `defaultImage: null`. Introduced
  because the old `|| PROFILE_TYPES.artist` fallback made a typeless row render as a cyan DJ. An
  unrecognised type therefore **degrades to a neutral identity rather than impersonating a DJ**
  (`profileTypes.js:117-144`).
- **`PUNTER_PROFILE`** — a real, complete identity kept *outside* `PROFILE_TYPES` precisely because
  that map "drives role pickers, dashboards, application filters and `PROFILE_TYPE_ORDER` — punter
  belongs to none of them (§A9: a Personal profile does not perform)" (`profileTypes.js:160-199`).

**`PUNTER_PROFILE` is the existing precedent for a profile type that participates in the app without
participating in the booking surfaces.** Any future applicant type that should apply but not perform
inherits a pattern that already exists.

---

## 2. Profile field inventory

Source of truth is each editor's `save()` payload — the object actually upserted into `profiles`.
All five upsert with `onConflict: 'user_id,type'`, so **`(user_id, type)` is the profile's natural
key**: one human may hold one profile of each type.

### 2.1 DJ / Artist — `ArtistProfileScreen.jsx:263-294`

| Internal name | DB column | Notes |
|---|---|---|
| `name`, `label`, `years` | same | `label` = artist label; `years` = years active |
| `location`, `state` (`locState`), `postcode` | same | postcode prompt gates save (`:261`) |
| `sound`, `tagline`, `bio` | same | |
| `mix_link` | `mix_link` | `ensureHttps`; the demo-mix / primary media link |
| `soundcloud`, `mixcloud`, `instagram`, `youtube`, `facebook`, `website` | same | `normalizeSocialValue`, or literal `'N/A'` |
| `contact_email` | same | or `'N/A'` |
| `genre_string` | same | `' · '`-joined genres + subgenres + vibes + role keys |
| `avatar`, `avatar_hero`, `avatar_thumb` | same | three renditions of ONE image |
| `card_pills` | same | up to 5 tags, `' · '`-joined |
| `experience` | same | `EXP_LEVELS` |
| `tech_setup` | same | `' · '`-joined — **artist only** |
| `fee_type`, `fee`, `fee_max`, `fee_local`, `fee_plus_travel`, `fee_negotiable` | same | `fee`/`fee_max` parsed to int; `fee_max` suppressed when negotiable |
| `emergency_name`, `emergency_phone`, `emergency_rel` | same | |
| `age`, `age_private` | same | `'prefer-not-to-say'` sentinel — **artist only** |
| `has_abn`, `abn`, `gst_registered` | same | |

### 2.2 Band — `BandProfileScreen.jsx:207-236`

Same spine, with: `band_type`, `member_count` (int), `established_year` (int), **`epk_link`**
(written alongside `mix_link` with the same value), `spotify`. Fee block uses **`fee_travel`**, and
has **no** `fee_local`. No `tech_setup`, no `age`.

### 2.3 Comedy / Poetry — `StandupProfileScreen.jsx:215-245`

Same spine, with: `set_length` (int), **`video_link`** (written alongside `mix_link`), `tiktok`,
and `vibe_tags: null` (explicitly nulled). Fee block uses `fee_travel`. No `tech_setup`, no
`fee_local`, no `age`, no `spotify`/`soundcloud`/`youtube`.

### 2.4 Host / Promoter — `HostProfileScreen.jsx:200-210`

**Markedly thinner — 14 fields, no commercial layer at all:** `name`, `years`, `location`, `state`,
`postcode`, `tagline`, `sound`, `bio`, `instagram`, `facebook`, `website`, `contact_email`,
`genre_string`, avatar trio. **No fee, no ABN/GST, no emergency contact, no experience.**

### 2.5 Venue — `VenueProfileScreen.jsx:129` (explicit select, 30 columns)

`avatar`/`avatar_hero`/`avatar_thumb`, `name`, `sound`, `tagline`, `location`, `suburb`, `state`,
`postcode`, `venue_type`, `atmosphere`, `perfect_for`, `established_year`, `bio`, **`stage_dims`**,
**`capacity`**, `genre_string`, `card_pills`, **`tech_features`**, `live_nights`, `has_abn`, `abn`,
`gst_registered`, `contact_email`, `email`, `website`, `instagram`, `facebook`, `tiktok`.

`tech_features` options include `'PA SYSTEM'`, `'LIGHTING RIG'`, `'BACKLINE'`, `'STAGE MONITORS'`
(`VenueProfileScreen.jsx:37`).

### 2.6 Cross-type observations

1. **Every type writes to the same `profiles` table.** There is no per-type table and no per-type
   JSON blob. Type-specific fields are simply columns that only some editors populate — so the
   table is already a sparse union, which is the shape a dossier wants.
2. **`mix_link` is already a generic "primary media link" abstraction.** All three performer types
   write it; `ProfileScreen.jsx:489` comments that the field is labelled *"LINK TO MUSIC OR PRESS
   KIT"* and is *"stored in the DJ-named `mix_link` column"*. Band and comedy additionally write
   `epk_link` / `video_link` with the identical value — **the same URL stored twice under two names.**
3. **The fee vocabulary has drifted:** artist writes `fee_plus_travel`, band and comedy write
   `fee_travel`. `fee_local` exists on artist only. This is exactly the duplicate-field pattern the
   project's own rule says to collapse to one canonical column.
4. **`'N/A'` is a literal string sentinel** written into the column (`useProfileForm.loadNa`). The
   system therefore *already distinguishes "withheld" from "empty"* at the data layer — which is the
   Rendering Contract's R1 (Absent ≠ Withheld ≠ Unknown) made concrete, and a prerequisite the
   dossier's "what's missing" logic would otherwise have to invent.

---

## 3. Booking-related information — what already exists

| Requested item | Status | Evidence |
|---|---|---|
| Booking fee | **EXISTS** — `fee` (int) + `fee_type` | artist/band/standup payloads |
| Fee ranges | **EXISTS** — `fee_max`, suppressed when negotiable | all three performer editors |
| Negotiable | **EXISTS** — `fee_negotiable` (bool) | all three |
| Play for tickets | **PARTIAL** — `fee_type` is the carrier; the value set was not enumerated in this pass | `fee_type` in all three payloads |
| Travel | **EXISTS but drifted** — `fee_plus_travel` (artist) / `fee_travel` (band, standup) | §2.6 |
| Local to event | **PARTIAL** — `fee_local` on artist only; separate `lib/locals.js` concept exists app-wide | artist payload |
| GST | **EXISTS** — `gst_registered` (bool) on artist, band, standup, venue | four editors |
| ABN | **EXISTS** — `has_abn` (bool) + `abn` (text) on artist, band, standup, venue | four editors; venue UI at `VenueProfileScreen.jsx:492-512` |
| Emergency contact | **EXISTS** — `emergency_name`, `emergency_phone`, `emergency_rel` | all three performer editors |
| Experience | **EXISTS** — `experience`, from shared `EXP_LEVELS` | `profileTaxonomy.js:239` |
| Technical setup | **PARTIAL** — `tech_setup` on **artist only**; venue has `tech_features` | artist payload; venue select |
| Stage setup | **VENUE-SIDE ONLY** — `stage_dims` on venue; nothing on the performer side | venue select |
| Setup time | **DOES NOT EXIST** | repo-wide sweep found no field |
| Packdown time | **DOES NOT EXIST** | repo-wide sweep found no field |

**The single most consequential finding in this section: none of these fields are rendered on the
public profile.** A grep of `ProfileScreen.jsx` for `fee`, `abn`, `gst`, `emergency`, `tech_setup`,
`experience` returns only venue `stage_dims` / `tech_features` and the `mix_link` comment. Every
commercial and logistical field an artist has already entered is **stored and never shown to
anyone** — including to a venue considering booking them.

That is not a defect for the current product, but it is the decisive fact for the dossier vision:
**the data collection substrate largely exists; the disclosure layer does not exist at all.**

---

## 4. Media

| Item | Storage | Rendering | Upload | Validation |
|---|---|---|---|---|
| Profile image | `avatar`, `avatar_hero`, `avatar_thumb` — three renditions of one image; bucket path from `PROFILE_TYPES[type].pathPrefix` | avatar across every card/screen | `AvatarUpload.jsx` + `ImageCropperModal.jsx` + `lib/uploadImage.js` | crop; EXIF orientation handled (`imageOrientation`) |
| **Gallery** | **DOES NOT EXIST for profiles** | — | — | — |
| SoundCloud | `soundcloud` column | player via `demoMixProviders` | link entry | `socialLinks.js` domain normalisation |
| Mixcloud | `mixcloud` column | player via `demoMixProviders` (`:144-151`, widget feed URL) | link entry | as above |
| Spotify | `spotify` (band only) | link only — **no embedded player** | link entry | domain `open.spotify.com` |
| Instagram / Facebook / TikTok | columns per type | `ProfileSocialLinks` row | link entry | domain normalisation |
| YouTube | `youtube` (artist, band) | link; explicitly **not** playable as audio (`demoMixProviders.js:196` notes a YouTube URL is an HTML page, not an audio file) | link entry | domain |
| Website | `website` | link row | link entry | `ensureHttps` |
| Demo mix | `mix_link` (+ `epk_link` / `video_link` aliases) | `MiniPlayer` / `TourDemos` | link or **direct upload** | `demoMixProviders` has three providers: `soundcloud`, `mixcloud`, `upload` |

`socialLinks.js:17-26` registers ten providers: instagram, facebook, tiktok, soundcloud, spotify,
mixcloud, youtube, beatport, bandcamp, linkedin — each `{domain, pathPrefix?}`. **Adding a provider
is a one-line data change**, a genuine reusable abstraction.

**Embedded players exist for SoundCloud and Mixcloud only.** There is a `gallery` concept in the
codebase but it belongs to the **event page** (`screens/event/heroMedia.js`, `EventHero.jsx`), not to
profiles. `docs/profile-completion-11B-2026-07.md:81` independently records "no gallery exists on any
type; only the audio player."

---

## 5. Technical documents

Swept the current React app, the legacy prototype JS at repo root, all migrations, and all docs for:
stage plot, stageplot, tech/technical rider, hospitality rider, press kit, EPK, insurance, public
liability, certificate of currency, working with children, logo assets, promo/press photos.

| Document | Verdict |
|---|---|
| Press Kit | **PARTIAL, as a URL only.** `epk_link` exists on band; `mix_link`'s own label is "LINK TO MUSIC OR PRESS KIT". There is no press-kit *object* — just a link field. |
| Stage Plot | **DOES NOT EXIST.** The phrase appears exactly once in the entire repo — as prose in `docs/architecture/conversation-workspace-v1.0.md:81`, describing what gets lost inside a long conversation. Not a feature. |
| Technical Rider | **DOES NOT EXIST.** (`AudioSendSheet.jsx:10` uses "rider" in its ordinary English sense, unrelated.) |
| Hospitality Rider | **DOES NOT EXIST.** |
| Insurance | **DOES NOT EXIST.** |
| Public Liability | **DOES NOT EXIST.** |
| Logos | **DOES NOT EXIST** as an artist-supplied asset. |
| Promotional photos | **DOES NOT EXIST** (no gallery — §4). |

**Adjacent capability that is NOT profile-scoped:** a complete file-attachment stack exists for
*messaging* — `lib/messageFiles.js`, `FileMessage.jsx`, the M12 file-storage migration, four separate
buckets. It is scoped to conversations, not profiles, and per memory the buckets must never be
merged. `docs/architecture/conversation-workspace-v1.0.md:101` explicitly lists **"a personal asset
library — that is a future milestone and is out of scope"** among the workspace's non-goals. The
document store a dossier needs is therefore already named and already deferred.

---

## 6. Venue enquiry flow

### 6.1 One table, five names

`docs/booking-vocabulary-2026-07.md` §D1: a single `venue_enquiries` row is displayed as **Enquiry**
(venue dashboard), **Offer** (artist stat tile), **Enquiries** (artist section header), **Booking
invitation** (`OpportunityCard`), **Invitation** (`BookingInvitation`), **Invite** (`InviteSheet`).
Choosing one artist-facing word is an open, deliberately-deferred product decision.

### 6.2 Real columns

From `known-issues/venue-enquiries-schema-drift.md` + `live-schema-audit` §1.7b:

`id` (bigint), `created_at`, `venue_user_id`, `applicant_user_id`, **`applicant_type`** (default
`'artist'`), `date_requested` (NOT NULL, no default), `note`, `status` (default `'pending'`),
`venue_profile_id`, `applicant_profile_id`, plus five columns added via the dashboard with no
migration: `headliner`, `slot_role`, `set_duration` (int), `extras` (text[]), `respond_by` (date).

Migration `20260717000000` additionally declares `event_id`, `proposed_time`, `proposed_fee`, and
`initiated_by` (`TEXT NOT NULL DEFAULT 'applicant'`, CHECK IN `('venue','applicant')`). That
migration self-documents as manual-apply; **whether production has these four columns was not
verified in this pass.**

### 6.3 The applicant → venue path (works)

`ProfileScreen.openEnquiry()` → date picked from the venue's public availability calendar →
profile picker (`.neq('type','punter').neq('type','venue')` — so a host may enquire) →
`sendEnquiry()` inserts exactly nine columns (`ProfileScreen.jsx:292-305`):

```
venue_user_id, applicant_user_id, applicant_type, venue_profile_id,
applicant_profile_id, date_requested, note, initiated_by: 'applicant', status: 'pending'
```

**Exactly what transfers from applicant to venue today: two profile ids, an applicant type string,
a date, and one free-text note.** No fee, no experience, no technical information, no media — and
no snapshot of any profile field. The venue receives a *pointer*, and can open the public profile,
which itself shows none of the booking fields (§3).

**`sendEnquiry` writes no notification.** There is no `writeNotification` call in the function, and
no trigger on `venue_enquiries` was found in the migrations that touch it. The venue learns of an
enquiry only by opening its dashboard.

### 6.4 The venue → applicant path (broken live)

`known-issues/venue-enquiries-schema-drift.md` documents a three-gate failure chain:

1. **PGRST204** — `InviteSheet` writes eight phantom columns (`applicant_name`, `event_id`,
   `event_name`, `message`, `proposed_date`, `proposed_time`, `proposed_fee`, `direction`).
2. **23502** — `date_requested` is NOT NULL and is never sent.
3. **42501** — the only INSERT policy is `Users can insert own enquiries`,
   `WITH CHECK (auth.uid() = applicant_user_id)`. A venue-initiated insert names the *artist* as
   applicant, so **the check can never pass. Venue-initiated invites have never been insertable, by
   policy design.** The one exception is a venue inviting its own artist profile — which the UI
   blocks at `ProfileScreen.jsx:177`.

The read path is broken too: `ArtistDashboard.jsx:192,214` filter `.eq('direction','outgoing')` on a
column that has never existed → `42703`. Everywhere else reads `(e.direction || 'incoming')`, whose
fallback silently makes every row read as incoming, which is why the missing column never surfaced.

Unlike `sendEnquiry`, `InviteSheet.jsx:139` **does** write a notification, carrying
`{event_id, event_name, host_id, proposed_date, proposed_fee}`.

### 6.5 Status model — `lib/enquiryUtils.js`

Direction is **viewer-relative and deliberately not stored**; `initiated_by` is absolute and the UI
derives direction (`deriveDirection`, `withDirection`). Two maps translate raw status → display tab
per direction, covering `pending, new, viewed, seen, tentative, shortlisted, offered, accepted,
confirmed, booked, declined, rejected`, with an unrecognised status falling into the first tab so it
can never disappear. `booking-vocabulary` §D2 records a live contradiction: `ApplicationCard:38`
maps `accepted` → "OFFERED" while `HostDashboard:702` maps the same value → "ACCEPTED".

### 6.6 The other pipeline — `applications`

A second, separate table. Inserts are equally thin:

- `event/ApplyButton.jsx:54-60` — `{event_id, artist_id, from_profile_id, status:'pending', note}`
- `ArtistDashboard.jsx:301-303` — `{event_id, artist_id, from_profile_id, status:'pending'}`

`live-schema-audit` §1.7 records `applications` as still carrying drift (`artist_name` does not
exist; code writing it breaks) and as **not** having received the identity pair — though the m6c
backfill migration post-dates that audit, so `from_profile_id`'s live presence is unconfirmed here.
D12 flags an unverified risk that `EnquiryCard`'s vocabulary (`seen`/`booked`/`interested`/
`shortlisted`) is being written into `applications.status`, which no reader of that table understands.

---

## 7. Venue availability flow

**Four availability tables exist in the database** — `venue_availability`, `artist_availability`,
`band_availability`, `standup_availability` (`live-schema-audit` §1.1).

**Only two are used.** `ProfileScreen.jsx:253-257` states it plainly: *"Artist/Band/Comedy all share
one account-keyed table (`artist_availability`, by `user_id`)."* `HostDashboard.jsx:367` also passes
`table="artist_availability"`. So `band_availability` and `standup_availability` are dead schema, and
`artist_availability` is in practice **the performer availability table for four profile types**.

| Path | Mechanism |
|---|---|
| Performer edit | `AvailabilitySection.jsx:32-34` — tap toggles: `delete` on `(user_id, available_date)`, else `upsert` with `onConflict: 'user_id,available_date'` |
| Venue edit | `VenueDashboard.jsx:117-120` — same toggle, but upserts `{user_id, available_date, profile_id}` |
| Performer public read | `ProfileScreen.jsx:263-264` — by `user_id`, `>= today` |
| Venue public read | `ProfileScreen.jsx:870` — by **`profile_id`**, `>= today`, plus a live-event overlay from `events.config.date` |

Note the key asymmetry: **venue availability is keyed on `profile_id`, performer availability on
`user_id`.** The performer table is account-keyed, so two performer profiles owned by the same human
share one availability set.

**Enquiry creation from a date** — the two directions differ:

- Venue profile → viewer taps an available date → `openEnquiry(dateStr)` → picks which of their own
  profiles to enquire as → optional note → `sendEnquiry()` (§6.3). **Works. No notification.**
- Performer profile → a viewer who owns a venue taps a date → the `InviteSheet` flow with the date
  prefilled (`ProfileScreen.jsx:882-899`). **This is the broken path of §6.4.** If the performer has
  published no availability, the button opens the enquiry sheet directly so no enquiry path is lost.

Not found anywhere: recurring availability, blackout ranges, capacity-per-date, timezone handling,
or any double-booking check.

---

## 8. Where the profile is already treated as reusable identity

This is the strongest part of the existing architecture.

| Surface | Mechanism | By reference or by copy? |
|---|---|---|
| Enquiries | `venue_profile_id` + `applicant_profile_id` dual-write (M1/M2) | **By reference.** Nine columns, zero copied profile data (§6.3) |
| Applications | `from_profile_id` alongside `artist_id` | **By reference** + a free-text `note` |
| Messaging | Conversations are between **profiles**; `actingProfile.js`, `MessageAsSheet`, `can_act_as`; `from_user_id` is audit-only and never displayed | **By reference**, explicitly ratified |
| Events | `events.owner_profile_id` (M14a), `venue_profile_id` | **By reference** |
| Lineups | `lineup_members.artist_profile_id` alongside `artist_id` | **By reference** — though `lineup_members.artist_name` also exists, i.e. a copied display string |
| Follows | `target_profile_id` (M2) | **By reference** |
| Availability | performer table keyed on `user_id`; venue on `profile_id` | **By reference** (weaker on the performer side — account-keyed, not profile-keyed) |
| Claims | `placeholder_profiles` / `claim_status` — a profile is a durable identity that pre-exists its owner and can be claimed later | Profiles are durable identities, independent of any user account |
| Identity resolution | `resolveProfileId.js`, `profileResolution.js`, `can_act_as()` (m6a) | One predicate for ownership |

**The architectural conclusion: the identity migration (M1–M6, M14) has already converted this system
from user-keyed to profile-keyed.** Objects belong to profiles; profiles are referenced, not copied.
A booking dossier is a *read* over that identity — the hard structural work of making the profile the
unit of reference is largely done.

The two residual copy-by-value spots found: `lineup_members.artist_name` and the enquiry `note`.

---

## 9. Current booking dossier capability

Estimates are of *what a dossier needs*, not of code quality. "Stored" without "disclosed" is
counted at partial credit, because a dossier's purpose is controlled disclosure.

```
Identity                    ████████████████████  95%   name, type, location, bio, tagline,
                                                        genres/roles, avatar, contact email,
                                                        durable profile ids, claims
Media                       ███████████░░░░░░░░░  55%   links + 2 embedded players + demo-mix
                                                        upload; NO gallery, NO Spotify/YouTube
                                                        player, press kit is a URL only
Technical                   ███░░░░░░░░░░░░░░░░░  15%   tech_setup (artist only) + set_length
                                                        + venue-side stage_dims/tech_features;
                                                        NO stage plot, rider, setup/packdown
Finance                     ██████████████░░░░░░  70%   fee, fee_max, negotiable, travel, local,
                                                        ABN, GST — all stored, NONE disclosed;
                                                        no invoicing, no payment terms
Legal / compliance          ░░░░░░░░░░░░░░░░░░░░   0%   no insurance, PLI, WWCC, contracts
Availability                ███████████████░░░░░  75%   real calendar both sides, public,
                                                        enquiry-creating; no recurrence,
                                                        no blackouts, no timezone
Booking workflow            ████████░░░░░░░░░░░░  40%   two pipelines, full status lifecycle,
                                                        direction model — but venue-initiated
                                                        invites are structurally blocked by RLS
                                                        and applicant→venue sends no notification
Disclosure / requirements   ░░░░░░░░░░░░░░░░░░░░   0%   nothing computes what is missing;
                             engine                     nothing requests only the gap
```

**Overall: the dossier is roughly half-built as a data store and essentially unbuilt as a workflow.**
The profile already holds most of what an Australian venue booking needs. What is absent is every
mechanism that would make it a *dossier*: no document objects, no disclosure control, no
completeness computation, and no request-what's-missing loop.

---

## 10. Gap analysis

| Section | Already exists | Missing |
|---|---|---|
| Identity | `profiles` keyed `(user_id, type)`; five types in one registry; durable ids; claims; `UNKNOWN_PROFILE` graceful fallback | no applicant types beyond the five; no per-type field relevance mechanism |
| Profile fields | one sparse-union table; `'N/A'` withheld-sentinel; declarative `PROFILE_FIELDS` spec (artist/venue/host, Studio-only) | `PROFILE_FIELDS` doesn't cover band/standup and the app editors don't read it; five hand-rolled editor screens |
| Media | 10-provider social registry; 3 demo-mix providers incl. upload; avatar with crop + EXIF | profile gallery; Spotify/YouTube embeds; any non-audio asset |
| Documents | messaging file-attachment stack (conversation-scoped) | every professional document: press kit object, stage plot, riders, insurance, PLI, logos, promo photos. "Personal asset library" named as a deferred future milestone |
| Finance | fee/range/negotiable/travel/local, ABN, GST on performers; ABN/GST on venue | disclosure of any of it; host has no commercial fields; no invoicing/payment terms; `fee_travel` vs `fee_plus_travel` drift |
| Technical | `tech_setup` (artist only); venue `stage_dims` + `tech_features`; `set_length` | performer stage/technical requirements as structured data; setup time; packdown time; input lists; backline requirements |
| Availability | two-sided calendar, public, enquiry-creating | recurrence, blackouts, timezone, double-booking guard; two dead tables; performer table is account-keyed not profile-keyed |
| Enquiry pipeline | one table, both directions modelled, `initiated_by` absolute, full status lifecycle, `applicant_type` column | venue-initiated insert blocked by RLS; 8 phantom columns; artist incoming-invite read broken; no notification on applicant→venue; five names for one object |
| Applications pipeline | separate table, by-reference, note field | schema drift; status-vocabulary contamination risk (D12); no relationship to the enquiry pipeline |
| Reusable identity | profile-keyed throughout; `can_act_as`; messaging-by-profile; owner resolution | `lineup_members.artist_name` copy; enquiry note is free text |
| Requirements engine | — | **entire concept absent**: no requirement definitions, no completeness computation, no gap request, no per-opportunity field sets |

---

## 11. Festival application comparison

⚠ **Built from standard Australian festival/venue application practice, not from sources fetched this
session.** Treat the "typical form" column as informed baseline, not researched fact.

| Typical field | YesPleez status |
|---|---|
| Act name, contact name, email, phone | **Supported** (`name`, `contact_email`; phone only on venue) |
| Location / home base | **Supported** (`location`, `state`, `postcode`) |
| Bio / blurb (short + long) | **Partial** — one `bio` + one `tagline`; no length variants |
| Genre / style | **Supported** (`genre_string`, roles, vibes, `card_pills`) |
| Years active / experience level | **Supported** (`years`, `experience`) |
| Number of members | **Partial** — `member_count` on band only |
| Set length / number of sets | **Partial** — `set_length` on comedy only; `set_duration` exists on the enquiry row |
| Music links (streaming/socials) | **Supported** (10 providers) |
| Video link / live footage | **Partial** — `video_link` on comedy; `youtube` on artist/band; no player |
| Press photos (hi-res) | **Missing** |
| Logo | **Missing** |
| EPK / press kit | **Partial** — a URL field only |
| Stage plot / input list | **Missing** |
| Technical rider | **Missing** |
| Backline / equipment requirements | **Partial** — `tech_setup` free-ish text on artist only |
| Own PA / lighting | **Missing** on the performer side (venue declares `tech_features`) |
| Setup / soundcheck time | **Missing** |
| Packdown / bump-out time | **Missing** |
| Fee expectation | **Supported** (`fee`, `fee_max`, `fee_type`, `fee_negotiable`) |
| Travel costs / origin | **Partial** (`fee_travel` / `fee_plus_travel`, `fee_local`) |
| Accommodation needs | **Missing** |
| Vehicle / parking / access | **Missing** |
| Crew count / crew names | **Missing** |
| ABN | **Supported** |
| GST registration | **Supported** |
| Bank details | **Missing** (and out of scope for a profile) |
| Public liability insurance + certificate | **Missing** |
| Working with children check | **Missing** |
| Emergency contact | **Supported** |
| Dietary / hospitality requirements | **Missing** |
| Available dates | **Supported** (calendar) |
| Preferred stage / time slot | **Partial** — `slot_role` on the enquiry row |
| Previous festivals / notable gigs | **Missing** as structured data (event history exists via lineup membership) |
| References | **Missing** |
| Declaration / terms agreement | **Missing** |

**Roughly: 12 supported, 10 partial, 15 missing.** The supported column is dominated by identity and
finance; the missing column is dominated by technical, legal and logistics — precisely the three
sections a festival needs and a gig listing does not.

---

## 12. Generic application framework assessment

### 12.1 Already generic — reusable abstractions that exist today

| Abstraction | Extension point | Evidence |
|---|---|---|
| `PROFILE_TYPES` registry | add a key to `RAW_TYPES`; order, colours, labels, avatar path, dashboard route all derive | `profileTypes.js:32-115` |
| `UNKNOWN_PROFILE` + `profileIdentity()` | an unrecognised type renders neutrally instead of impersonating a DJ | `profileTypes.js:117-206` |
| `PUNTER_PROFILE` precedent | a type that exists app-wide but is excluded from role pickers, dashboards and **application filters** | `profileTypes.js:160-178` |
| One `profiles` table | sparse union of columns; no per-type table, no per-type blob | all five editors upsert the same table |
| `(user_id, type)` natural key | one human, one profile per type — extends to any new type for free | `onConflict: 'user_id,type'` ×5 |
| Role-within-type pattern | `PERFORMANCE_ROLES` / `ARTIST_ROLES` / `HOST_CATEGORIES` with `enabled` flags, rendered generically | `profileTaxonomy.js:104-134`; the comment states adding a role is "a data change here, not an editor rewrite" |
| `enabled: false` launch gating | a type/category can exist in the model and be hidden from pickers | `HOST_CATEGORIES` FESTIVALS; `festival-edition-strategy` |
| `PROFILE_FIELDS` declarative spec | `{key, label, kind, col}` per type — a real config-driven editor contract | `profileTaxonomy.js:177-232` |
| Social provider registry | `{domain, pathPrefix?}` — one line per provider | `socialLinks.js:17-26` |
| Demo-mix provider registry | pluggable providers incl. direct upload | `demoMixProviders.js` |
| `applicant_type` column | the enquiry row **already records what kind of applicant this is**, defaulting to `'artist'` | `venue_enquiries`; written at `ProfileScreen.jsx:295` |
| `initiated_by` = `'venue' \| 'applicant'` | the generic word is already in the schema and its CHECK constraint | migration `20260717000000` |
| Status lifecycle + unknown-status fallback | generic workflow states; an unrecognised status still lands in a tab | `enquiryUtils.js:22-76` |
| Profile-keyed everything | enquiries, applications, messaging, events, lineups, follows all reference `*_profile_id` | §8 |

### 12.2 Unnecessarily specialized

| Specialization | Class | Consequence for a new applicant type |
|---|---|---|
| Five hand-rolled editor screens, each ~200+ lines of bespoke JSX with its own `save()` | **performer/venue-specific** | adding a type means **writing a screen**, not writing a config — despite `PROFILE_FIELDS` proving the declarative approach was already designed |
| `PROFILE_FIELDS` covers only artist/venue/host and is consumed by **Studio**, not the app | missed abstraction | the one declarative field spec in the system is not used by the thing that renders fields |
| `useProfileForm` abstracts state + save lifecycle only — no fields, no validation, no payload building | missed abstraction | every new type re-implements payload construction |
| Four availability tables, two used, `artist_availability` serving four types | **legacy specialization** | a vendor type would face a schema pattern that says "one table per type" while the code says otherwise |
| Performer availability keyed on `user_id`, venue on `profile_id` | inconsistency | two profiles of one human share availability |
| `mix_link` / `epk_link` / `video_link` — same value, three columns | **DJ-specific naming** | the generic "primary media link" concept exists but is named for DJs |
| `fee_plus_travel` vs `fee_travel`; `fee_local` on artist only | drift | a shared commercial block exists in spirit, not in schema |
| `tech_setup` on artist only | **DJ-specific** | the one performer-side technical field is not available to bands or comedians, let alone vendors |
| Genre taxonomy as the universal classifier (`genre_string` carries genres, subgenres, vibes **and role keys**) | **music-specific** | a vendor or volunteer has no genre; the column that encodes *role* is named for music |
| `applications.artist_id`, `lineup_members.artist_id`/`artist_name`, `venue_enquiries.applicant_type` default `'artist'` | **artist-specific naming** | schema reads as artist-first even where behaviour is generic |
| Host/venue-facing copy says "artist" in ~25 places; `INVITE ARTIST` invites bands and comedians too | **cosmetic but pervasive** | `booking-vocabulary` §D3 already flags this as an unresolved brand decision — the generic-applicant vision forces it |
| The opportunity model: an application terminates in a **lineup slot / performance** at an event | **performer-specific — the deepest one** | there is no structural way to express "we need 3 food vendors" or "20 volunteers"; `lineup_members` and `performances` are the only participation models |
| Industry surfaces gated by profile type; `BOOKABLE_TYPES` allow-list | allow-list by default | a new type is invisible to booking surfaces until explicitly added |
| Dashboards: one screen per type (`ArtistDashboard`, `VenueDashboard`, `HostDashboard`, `PerformerDashboard`) | per-type screens | a new type needs a new dashboard |

### 12.3 Verdict on the framework question

**The identity and data layers are already generic enough to extend; the workflow and presentation
layers are not.**

- **Storage** — one table, sparse union, natural key `(user_id, type)`, everything referenced by
  profile id. A `vendor` or `volunteer` row would store cleanly today.
- **Type registry** — one file, with a proven graceful-unknown path and a proven
  "exists-but-excluded-from-booking" precedent (`PUNTER_PROFILE`) and a proven
  "exists-but-hidden-by-flag" precedent (`FESTIVALS`).
- **Pipeline schema** — `applicant_type` and `initiated_by` are already the generic vocabulary. The
  status lifecycle is generic workflow state apart from the word "booked".
- **Editors** — the blocker. Five bespoke screens; the declarative spec that would fix this exists
  but is wired to Studio, not the app.
- **Opportunity model** — the deepest specialization. Every application path terminates in a
  performance slot. Nothing in the schema expresses non-performing participation.
- **Surfacing** — allow-lists and per-type dashboards mean a new type is invisible by default rather
  than generic by default.

The honest summary: **this is not a DJ booking system wearing generic clothes — it is a
profile-keyed identity platform with a performer-shaped booking workflow bolted to it.** The
identity work already done (M1–M6, M14) is exactly the work a generic application framework needs
and would otherwise have to do first. What has not been done is generalising *the thing being
applied to*.

---

## 13. Missing capabilities before YesPleez could replace a festival application

Grouped as requested. No solutions proposed — these are gaps only.

### Core

1. **A requirements/completeness engine.** Nothing anywhere computes "what does this opportunity
   require, what does this profile have, what is the difference." This is the entire premise of the
   vision and none of it exists.
2. **A disclosure layer.** Every commercial and logistical field already collected is invisible to
   everyone. A dossier is controlled disclosure; today there is no mechanism to show a venue
   anything beyond the public profile.
3. **Document objects.** Stage plot, technical rider, hospitality rider, insurance/PLI certificate,
   press kit as an object, logo, hi-res promo photos. None exist; a profile-scoped asset store does
   not exist (only conversation-scoped attachments).
4. **A non-performer participation model.** Every application terminates in a lineup slot. Vendors,
   volunteers, crew, media and sponsors have no structural representation.
5. **Fixing the venue-initiated enquiry path.** It is blocked by RLS by design and requires a
   business-rule decision, not just a schema fix. Until then only one direction of the pipeline works.
6. **Notification on applicant→venue enquiry.** Currently silent.
7. **Per-type field relevance.** No mechanism shows/hides fields by profile type inside a shared
   component — required before one profile can serve many roles.
8. **Legal/compliance fields.** Insurance, public liability with coverage amount, WWCC, declarations.
9. **Performer-side technical structure.** `tech_setup` exists for one type as an unstructured
   string; setup and packdown times do not exist at all.

### Nice to have

10. Profile gallery (multi-image) and hi-res photo handling.
11. Spotify and YouTube embedded players.
12. Collapsing `mix_link`/`epk_link`/`video_link` into one canonical media link.
13. Collapsing `fee_travel`/`fee_plus_travel`, and extending `fee_local` beyond artist.
14. Commercial fields for host profiles (currently none).
15. Availability: recurrence, blackout ranges, timezone, double-booking guard.
16. Retiring `band_availability` / `standup_availability`; moving performer availability to
    `profile_id`.
17. Resolving `booking-vocabulary` D1 (one artist-facing word) and D3 (the generic term for an
    applicant) — the generic vision makes both unavoidable.
18. Structured gig history / references.
19. Bio length variants (short blurb vs long bio) as festivals request both.

### Future

20. A declarative editor: making the app render from `PROFILE_FIELDS`-style config rather than five
    bespoke screens — the prerequisite for adding applicant types as data.
21. Accommodation, vehicle/parking, crew manifest, accreditation categories.
22. Contracts, agreements, invoicing, payment terms.
23. Festival Edition's named scope — multi-stage scheduling, stage management, volunteer management,
    artist liaison, ops dashboards, accreditation, crew coordination — which
    `festival-edition-strategy-2026-07.md` already reserves as a separate product built on Host
    profiles.
24. A schema baseline. Repo and production have drifted bidirectionally and there is no source of
    truth; every estimate above inherits that uncertainty.

---

## 14. Four things worth knowing before designing anything

1. **The data substrate is further along than the workflow.** Fee, ABN, GST, emergency contact and
   experience already exist on performer profiles and have never been shown to anyone. The dossier's
   first problem is disclosure, not collection.
2. **The identity migration already did the hard part.** Objects belong to profiles, profiles are
   referenced not copied, and `can_act_as` resolves authority. A reusable dossier is a natural read
   over that model.
3. **The genericity blocker is the opportunity, not the profile.** A profile can already be almost
   anything; an *opportunity* can only be a performance slot.
4. **Two decisions are already on the table and this vision forces both:**
   `booking-vocabulary` D3 (what is the generic word for an applicant?) and the venue-initiated
   enquiry business rule (may a venue create an enquiry naming another party as applicant?).
