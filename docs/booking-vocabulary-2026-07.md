# Booking vocabulary — audit & decisions (Phase 10H)

**Date:** 17 Jul 2026 · **Type:** copy consistency. No schema, no API, no behaviour change.

10H's brief was to standardise booking/opportunity/profile terminology. The audit found that **the vocabulary drift is real but almost entirely a set of product decisions**, not mechanical errors — one word is not obviously "right" over another; a person has to choose the brand voice. Per the phase rules ("do not rename concepts that require product decisions; if wording is ambiguous, document it"), this pass **fixed the two outright grammar bugs and documented the rest as decisions D1–D8** below.

The root cause of most drift is one structural fact: **a single table, `venue_enquiries`, is the object behind Enquiry, Invite, Invitation, Offer and Opportunity.** The same row is named differently by screen and by viewer. Some of that is deliberate (it *is* an enquiry from the venue's side and an offer from the artist's); some is genuine sprawl (the artist side alone uses five words).

---

## Fixed in this pass

Two generated-string grammar bugs — broken English, not a word choice, so unambiguous to fix. Both reuse the app's existing empty-state voice; no new wording introduced.

| # | Was | Produced | Now |
|---|---|---|---|
| **G1** | `ArtistDashboard.jsx:510` — `` No ${outStatusTab.toLowerCase()} applications yet `` | *"No **being considered** applications yet"*, *"No **not selected** applications yet"* | Per-tab `OUT_EMPTY` map, mirroring the file's existing `IN_EMPTY`. |
| **G2** | `EnquiryPanel.jsx:125` — `` No ${statusTab.toLowerCase()} enquiries `` | *"No **awaiting** enquiries"*, *"No **interested** enquiries"* | `No enquiries match your search` / `No enquiries here yet` — the active tab is already highlighted above the list. |

Files changed: `v2/src/screens/ArtistDashboard.jsx`, `v2/src/components/EnquiryPanel.jsx`.

**Both are behind auth** (industry dashboards) — verify by opening the outgoing-applications tabs and an empty enquiry sub-tab. See the checklist.

---

## Decisions required (D1–D8)

Each is a real inconsistency the audit confirmed. For each: the competing terms, where they appear, and the **most-established form** as a starting point — but the choice is a product/brand call, deliberately not made here. Numbers in brackets are representative sites, not exhaustive.

### D1 — What is a `venue_enquiries` row called? *(the big one)*

The same object is shown under **five nouns**, and the split is partly by viewer, partly by sprawl:

| Viewer / surface | Word used | Sites |
|---|---|---|
| Venue's own dashboard | **ENQUIRY** | `VenueDashboard:223,257`, `EnquiryPanel:125` |
| Artist's stat tile | **OFFER** | `ArtistDashboard:420` |
| Artist's section header | **ENQUIRIES** | `ArtistDashboard:430` |
| The card | **Booking invitation** | `OpportunityCard:72` (component is `OpportunityCard`) |
| The sheet | **INVITATION** | `BookingInvitation:120,210` |
| The compose sheet | **INVITE** | `InviteSheet:201,183,120` |

**Two questions, separable:**
- **(a)** Is the viewer-relative split intentional? A defensible model: from the venue it's an *enquiry*, from the artist a venue-initiated one is an *offer*. This mirrors the `initiated_by` / `deriveDirection` work already in the code. If kept, **document it as a rule** so it stops reading as an accident.
- **(b)** Even granting (a), the **artist side alone uses OFFER + Invitation + Booking invitation + invite + Opportunity** for one object. That is sprawl, not direction. Pick **one** artist-facing word.

**Most-established:** "Enquiry" is the dominant venue-side word and matches the table name. "Offer" is the dominant artist-side stat word. If (a) is accepted, the minimal fix is: **venue side = Enquiry, artist side = Offer**, and retire "Invitation"/"Opportunity"/"Booking invitation" as artist-facing synonyms. Not done here — it renames a concept.

### D2 — "Confirmed" vs "Booked" vs "Accepted"

The single DB state (`confirmed`/`accepted`/`booked`) renders as all three:

- **BOOKED** — `EventScreen:1512` slot chip, `EventScreen:1557` `BOOK ARTIST`, `ArtistDashboard:60,437` tabs, `EnquiryCard:194` `CONFIRM BOOKED ✓`, notifications "You're booked!"
- **CONFIRMED** — `EventScreen:700` lineup badge, `ApplicationsScreen:10` tab, `ApplicationCard:38`, notification "confirmed your booking"
- **ACCEPTED** — `EventScreen:1526` `ACCEPTED BY ARTIST`, `HostDashboard:702`, `EnquiryPanel:8,10` tabs

Worse, a direct contradiction: **`ApplicationCard:38` maps raw status `accepted` → "OFFERED"** while **`HostDashboard:702` maps the same `accepted` → "ACCEPTED"**. That one is arguably a bug, not just a synonym — the same status reads as two different lifecycle stages on two host surfaces. Worth confirming which is intended before standardising the rest.

**Most-established:** "BOOKED" is the most frequent user-facing form for the final state. Decision: pick one of {Booked, Confirmed} as *the* word for "the gig is locked", and reserve "Accepted" for the *act* of a party saying yes (a step before Booked). Then `ApplicationCard`'s `accepted → OFFERED` needs reconciling either way.

### D3 — The generic word for a performer, host/venue-facing

Host/venue copy says **"artist"** almost everywhere (~25 sites: `FillSlotModal:94-134`, `EventScreen:690,742,1537,1557,1566`, `HostDashboard:389,458,487,518`, `InviteSheet:201`, notification fallbacks `'An artist'`). But since the brand passes, the `artist` **type** displays as "DJ / PROD." — so a host looking at a band's application still reads "artist", and "INVITE ARTIST" is the button used to invite a band or a comedian.

This is the tension flagged (and deliberately deferred) during 10E.3. The generic term could be **act**, **performer**, **artist**, or **talent**. "act" already survives in one placeholder (`EnquiryPanel:116` "act type"); "performer" exists only as a URL param; "talent" nowhere.

**This is a pure brand-voice decision and a wide change (~25 strings).** Not made here. If chosen, it should be a dedicated pass with owner sign-off, because it changes the product's voice toward every non-DJ performer. Outlier to note alongside it: `VenueDashboard:301` `BROWSE ENTERTAINMENT →` — every other browse CTA is "BROWSE OPEN EVENTS/CALLS", but a venue genuinely browses *performers*, not events, so "ENTERTAINMENT" may be correct-but-lonely rather than wrong.

### D4 — Type-label spellings across surfaces

One type, several spellings — several of them **deliberately owned locally**, so this needs care, not a sweep:

| Type | Canonical (`PROFILE_TYPES`) | Also appears as |
|---|---|---|
| artist | `DJ / PROD.` | `DJ / Producer` (DiscoverScreen filter), `DJ` (WhatsOn), `DJ / PRODUCER` (ArtistDashboard heading), "artist" (setup copy) |
| standup | `COMEDY / POETRY` | `Comedy / Poetry` (Discover), `COMEDY` (badge/WhatsOn), `STAND UP / POETRY` (dashboard heading), "MUSO" is band's |
| band | `BAND` | `BAND / MUSO` (dashboard heading), `BAND / LIVE` (WhatsOn) |

The roadmap memory records dashboard heading text as *"owned locally per dashboard (not identity)"* and DiscoverScreen's filter as deliberately re-cased. So **some of this is intentional and must not be flattened.** The genuine question: should the *badge/label* surfaces (which already use `PROFILE_TYPES`) and the *category* surfaces (WhatsOn/Discover, hand-maintained) converge, or do event categories ("Live Music", "Spoken Word", "DJs") legitimately differ from profile types? Likely the latter — an event category ≠ a profile type. Recommend: **leave, but decide explicitly** whether WhatsOn/CreateEvent categories are a separate taxonomy (they read like one).

### D5 — Response-verb sets differ across triage surfaces

The same host-triage concept offers different buttons:

- `ApplicationsScreen` + `ApplicationCard`: **SHORTLIST / DECLINE / ASSIGN SLOT**
- `HostDashboard` AppCard: **ACCEPT / TENTATIVE / DECLINE**
- `EventScreen` pipeline: **SHORTLIST / DECLINE**

"SHORTLIST" and "TENTATIVE" are two buttons that write the **same** `tentative` status. Pick one verb for "provisionally interested" across all three surfaces. Most-established: **SHORTLIST** (used on two of three).

### D6 — Symbol/glyph convention on action buttons

Cosmetic but real: `ACCEPT ✓` (most places) vs `✓ ACCEPT` (`NotifPanel:211,217`); `DECLINE ✗` vs `✕ DECLINE` (NotifPanel uses a different glyph too — `✕` not `✗`); `SHORTLIST ✓` vs `SHORTLIST ★` (`EnquiryCard`) vs `✓ SHORTLIST` (`ApplicationsScreen`).

**Dominant convention: `VERB ✓` / `VERB ✗` (symbol after, these two glyphs).** NotifPanel is the lone outlier on placement and glyph. This is low-risk to standardise but still a micro-design call (which glyph, which side) — flagged rather than imposed, since it touches a working surface with no functional bug.

### D7 — Empty-state casing

Same element type, two casing systems: `EventScreen:689` `NO ONE ON THE BILL YET` (ALL-CAPS) vs `ArtistDashboard:47` `Nothing new right now.` (sentence case) vs `NotifPanel:100-101` which stacks both (`ALL CLEAR` above `No notifications yet.`). Pick one register for empty-state body copy. Most-established by count: **sentence case** for the descriptive line (ALL-CAPS reserved for the Bebas headline above it, as NotifPanel already does).

### D8 — `application_declined` notification badge

`notifMeta.jsx:40` labels it **`DECLINED`** while its siblings keep the noun (`SLOT DECLINED`, `INVITE DECLINED`). Parallel form would be `APPLICATION DECLINED`. Left unchanged because the *body* deliberately softens to "was unsuccessful" / "passed on your application" — so the badge/body divergence may be intentional tone, not an oversight. Confirm intent, then either make the badge parallel or leave it.

---

## Remaining inconsistencies not raised to a decision

Minor, mechanical, safe to batch whenever D5–D7 are actioned — listed so they aren't rediscovered:
- `MySceneScreen:856` "Unknown Artist" and `ApplicationsScreen:122` `Artist #{n}` fallbacks share D3's "artist" question.
- The `DiscoverScreen:165` / `MySceneScreen:478` subtitle "Your gigs · Your artists · Your world" also carries "artists" (D3).

## Confirmation

- **Behaviour:** unchanged. The two edits change only the text of empty-state lines; every filter, status write and query is untouched.
- **Build:** passes.
- **Lint:** 122 warnings before and after — zero introduced.
- **Scope held:** no concept renamed, no new vocabulary introduced, no schema/API/workflow change. Everything requiring a word choice is documented above, not decided.
