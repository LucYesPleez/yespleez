# The Contacts / Find People page — design capture
**2026-07-26 · Owner sketch recorded, NOT built · Supersedes the MY CONTACTS panel inside Messages**

## 1 · The sketch, as given

```
Find People
────────────────────
Search people...
────────────────────
Pinned
  Federal Hotel · Deliverance · John · Emily · …
────────────────────
Your Contacts
  Federal Hotel · Sarah Jones · Luke Brown · …
────────────────────
Find Friends ●2
  Find by phone number
  Sync Contacts
  Invite Friends
  Share YesPleez
```

**The badge rule, owner's words:** *"The red badge only appears on Find Friends. Not the whole
page. That tells the user exactly where the new discovery happened."*

That is the strongest idea in the sketch and it should survive any other change. A badge on a
tab says "something, somewhere". A badge on the row that caused it says *what happened and
where to go*, and it clears when the user has actually looked at the thing it refers to.

---

## 2 · What already exists

| Sketch element | Status |
|---|---|
| Find by phone number | ✅ built, live — search + one result row + MESSAGE |
| Sync Contacts | ✅ built, live — picker, primer, codes, delete, corroboration line |
| Invite Friends | ⬜ designed only (share link, never platform SMS — Phone Discovery §6) |
| Share YesPleez | ⬜ not designed. Distinct from Invite: a generic app share with no personal invite code |
| `●2` badge on Find Friends | ⬜ needs CJ1 (unrun migration) — counts unread `contact_joined` |

## 3 · ⚠ What does NOT exist, and is bigger than it looks

### Pinned — a whole feature, not a section
Nothing in the product pins anything. Open questions: **manual or automatic?** Manual needs a
store (`pinned_profiles`), a pin/unpin affordance, an ordering, and a limit. Automatic
(most-messaged, most-recent) needs none of that but is not really "pinned" — it is "frequent",
and calling it Pinned would mislead.

The sketch mixes venues (Federal Hotel) with people (John, Emily), so whatever this is, it pins
**profiles of any type**, not just Messenger identities.

### "Your Contacts" — what populates it?
Two very different readings:
- **(a) Address-book matches** — people from your phone who are on YesPleez. Today these are
  **transient**: `sync_contacts` returns them, nothing persists them. A durable list means
  storing matches on the device beside the name map, or re-syncing to show the page (which on
  Android reopens the OS picker every time — unacceptable).
- **(b) People you have messaged** — derivable today from conversations, no new storage.

The sketch listing Federal Hotel under BOTH Pinned and Your Contacts suggests (b) or a merge,
since a venue is unlikely to be in a phone's address book under that name.

### "Search people…" — broader than phone search
Phone search is exact-match on a number. This reads like name search over profiles, which is a
**different capability** and already partly exists in Discover. Needs deciding: does this search
your contacts only, or everyone on YesPleez?

---

## 4 · Where it lives

The bottom nav is five tabs and **sacred** — this cannot become a sixth. Options: a route under
Messages (`/messages/find`, as the original design had it), or reached from the Messages header
where FIND FRIENDS already sits. The latter is one tap from where people already are.

## 5 · Recommended defaults, so this can be built without another round trip

1. **Pinned = manual**, a `pinned_profiles` table keyed by (owner profile, target profile), any
   profile type, capped at ~12, drag-free ordering by pinned-at. Automatic "frequent" is a
   different feature and should not borrow this name.
2. **Your Contacts = (a) address-book matches, persisted on the device** beside the name map in
   IndexedDB — it is already the right store, already device-only, and already cleared when
   codes are deleted. This keeps the privacy story intact: the server never holds a contact list.
3. **Search people… = your contacts first, then everyone**, one field, grouped results. Exact
   phone-number entry keeps its current behaviour and skips straight to the number lookup.
4. **Badge counts unread `contact_joined` regardless of suppression**, so "In Messages only"
   still lights the row. Clearing happens when the section is opened, not when the app is.

**None of these are decided.** They are the cheapest defensible answers, recorded so the build
can start from something rather than nothing.
