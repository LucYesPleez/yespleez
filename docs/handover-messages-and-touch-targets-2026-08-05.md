# Messages restructure, SEC-6a, touch targets — handover, 5 Aug 2026

Branch `v2-react`, level with `main` and with origin at **`6747edd`**. **892 tests passing**
(`npm test` in `v2/`), `npm run build` clean, `npm run lint` exit 0.

**Deployed to production.** The live bundle at `https://yespleez.pages.dev` was confirmed to carry
`6747edd` and not the previous `9af7985` — that is `__BUILD_SHA__` doing the job it exists for.

Everything below was verified against the live database or a live browser unless it says otherwise.
Where something is unverified it says so — **those are the parts to check first**.

---

## 1 · What shipped

| Area | Commits | Migration | State |
|---|---|---|---|
| **SEC-6a** notification dismissal | `58e08be` `e5a596b` `c2f54e4` `c51b4ac` | `20260804000000` | ✅ applied + proven |
| Header identity control (ProfileMenu) | `c31051e` | — | ✅ |
| Find Friends panel → one panel, one row each | `78fa5a9` | — | ✅ |
| Contacts rail stripped to the rail | `45dcfd2` `4463792` | — | ✅ 452 → 123 lines |
| **One search at the top of Messages** | `e4f5220` `63c4c4d` `3221bb9` `1b6e8e6` `389abe6` | — | ✅ |
| Messages header avatar removed | `286c40c` | — | ✅ |
| Find Friends → **Find People**, in the account menu | `eb68534` `3ae6195` `bf0d48a` | — | ✅ |
| **Messaging identity selector** | `b566b87` | — | ✅ |
| Identity selector **filters the list** | `f6f1723` | — | ✅ |
| `/me` — one row, one save | `3a147d5` | — | ✅ |
| View Profile **muted** | `34e3e33` | — | ⚠ decision open, §4.3 |
| MESSAGES title back to 42px | `5c5d263` | — | ✅ |
| **44px touch targets** (header, dock, composer) | `e9e2bfd` | — | ⚠ device-unverified, §4.2 |
| Minimised tabs resized, then −20% chrome | `3e5c176` `f7de839` | — | ✅ |
| **A profile picture goes to that profile** | `a32b5bf` | — | ✅ |
| My Scene: 104 controls tagged | `3fdefb6` `6747edd` | — | ⚠ device-unverified |

Also carried to production from the parallel Applications thread: `ec826bb` (M6 read migration) and
`933f14c` (oxlint browser env). See §5.

---

## 2 · The findings that generalise

### 2.1 · A fire-and-forget write hides schema drift forever

`responded_at` **did not exist**. No migration had ever created it; SEC-6a *granted* on it, assuming
it was there. Applying the migration failed at the `GRANT` with `42703` and — the SQL editor running
a script as one transaction — rolled the whole thing back.

The typo is the smaller half. `e5a596b` had already added **eight** client writes to that column, and
`markResponded()` is deliberately fire-and-forget so that a failed receipt cannot look like a failed
accept. Every one of those writes was failing silently, the row re-offering ACCEPT and DECLINE —
**which is precisely the defect `e5a596b` was written to close**. The fix was inert and the only
symptom was the bug.

> Before trusting any fire-and-forget write, verify the column exists. The rollback is the only
> reason this surfaced instead of shipping.

### 2.2 · A pseudo-element hit area cannot be measured the obvious way

`.yp-tap44` (in `index.css`) gives a control a 44px touch target without changing its appearance or
its layout — a transparent `::after` centred on it. Two consequences that will waste time otherwise:

- **`getBoundingClientRect()` still returns the visible box.** That is the point — layout and the
  guided tour's spotlight are undisturbed — but it means the obvious check reads as "the class did
  nothing". Probe `document.elementFromPoint` at the expanded edge, or read the computed `::after`.
- **It is inside `@media (pointer: coarse)`.** No desktop browser matches that, and the in-app
  browser reports a *fine* pointer even at a 375px viewport. Check
  `matchMedia('(pointer: coarse)')` before concluding anything.

`max(100%, 44px)` is load-bearing, not a guard: it means a control **never widens**, which is the
only reason a 74px row can take the utility while sitting 7px from a 22px `×`.

### 2.3 · Invisible padding is the wrong tool when two controls share a chip

The minimised-tab `×` is **not** given `.yp-tap44`, deliberately. A 44px box centred on it reaches
17px each side and swallows the right half of "Reopen conversation" — tapping a tab to reopen it
would sometimes close it. It got a real, visible 22px box instead.

> Measure the gap to the neighbour before adding a hit area. The box grows in every direction.

### 2.4 · A name must never find a stranger's personal profile

`MessengerSearch` queries `profiles` with **`.neq('type', 'punter')`**. That is not tidiness — it is
what makes `WHO CAN FIND ME` mean anything. `find_by_phone` demands a complete E.164 and honours the
visibility setting precisely so personal profiles cannot be browsed; if a first name listed every
match, that setting would be decorative and the user base enumerable.

Phone keys are **HMACs of the E.164**, so there is no fuzzy or partial matching to fall back on —
exact or nothing. That is why there is no country picker in the search bar: anything written with
`+` or `00` identifies its own country, and the only ambiguous case (a local-format overseas number)
is handled by echoing the resolved number and saying so on a miss.

---

## 3 · Traps found the hard way

- **Vite's watcher silently dropped three writes.** The dev server served modules where one edited
  line had updated and another had not. Full page reloads did **not** clear it; only a fresh content
  change did. If an edit appears not to take for no reason, fetch the module
  (`fetch('/src/…?t='+Date.now())`) and read what is actually being served.
- **`prosecdef = false` on the claim functions is SAFE**, despite SEC-6a's own note saying to fix it
  first. `approve_profile_claim()` has EXECUTE revoked from `anon, authenticated` (`c1:289`), no
  client code calls it, and the REVOKE names only those two roles — so delivery runs as
  `service_role` and keeps UPDATE on `to_user_id`. ⛔ Do **not** add `SECURITY DEFINER`; revisit only
  if claim completion becomes user-initiated, and then it needs the SEC-1 INSERT `with_check` fix
  with it.
- **A thread between two of your own profiles counts as Personal.** `fetchInboxRows` treats Personal
  as "you" when both participants are yours, so Personal → Dusky Waters appears under *All profiles*,
  not under Dusky Waters. The identity filter follows that rule so the list and the row label cannot
  describe different things.

---

## 4 · Open — check these first

### 4.1 · `responded_at` has never been tested end to end ⚠

The one part of SEC-6a nobody has exercised. **Answer a slot offer, reload, confirm ACCEPT/DECLINE do
not come back.** It needs a human because it commits a real booking decision.

If they *do* come back, the fix is inert — and it will be silent, because `markResponded()` swallows
its own error by design. Check the network tab, not the console.

### 4.2 · The touch targets have never been felt on a phone ⚠

Everything is behind `@media (pointer: coarse)`. The geometry was proven by temporarily mirroring the
rule without the media gate; **the gating itself is verified structurally, not by experience.** This
deploy is the first chance to use them on a real device.

### 4.3 · Is this a social network? — owner decision open

`View Profile` is **commented out** of the account menu, line intact, at the owner's request ("i dont
really want to have it as a socials network, or do i? at least mute it while i figure it out").

⛔ The route and the page are untouched. `/profile/:id?type=punter` still resolves and every link to
it still works — search results, shared invite links, a contact tapping through. Only the account
menu's own "here is your public self" is gone. Restoring it is uncommenting one line in
`ProfileMenu.jsx`.

### 4.4 · Two My Scene controls still need a design change, not padding

Left alone by agreement — both are too small **and** too crowded for a hit area:

| Control | Size | Gap | Why padding fails |
|---|---|---|---|
| Spotlight dots ×5 | **7×7** | 7px | 44px needs 18.5px each side; even 24px overlaps |
| Card view / List view | 28×20 | **0px** | adjacent segments of one control |

The dots are below even WCAG 2.2 AA's 24×24 minimum. The usual fix is a ~24px *button* around a 7px
visible dot, plus a wider gap.

---

## 5 · Two threads share this working tree ⚠

The Applications/Festival thread commits to the same folder and the same `v2-react` branch. On
5 Aug its `ec826bb` landed stacked on this thread's SEC-6a commits, and both went to production in
today's deploy — that thread may not have expected its work live yet.

Nothing was lost, but only because the edits happened not to overlap. **Before `git rebase`,
`checkout` or `branch -f`, run `git log`/`git status` and look for commits you did not make.** A
`git worktree` per thread is the fix if both run for days; a second *clone* is not, since branches do
not sync between clones without a round trip through GitHub.

---

## 6 · Known defects, not fixed

| Defect | Where | Impact |
|---|---|---|
| **Mark-read-on-fetch** | `NotifPanel.jsx:41` | Opening the panel fetches `.limit(60)` and marks **all** of them read while showing 10. ~30 notifications are marked read having never been on screen, and the badge only counts unread — so they can never call for attention again. **Now live.** |
| Duplicate React keys | notification list | ~25 `"Encountered two children with the same key"` — "duplicated and/or omitted" is exactly what makes a list feel like it loses rows |
| `ConversationDock` session crash | `ConversationDock.jsx:83` | `Cannot destructure property 'session' of 'useSession(...)' as it is null` after a hot reload. Cleared on a full refresh, so most likely an HMR artefact — but if the dock ever blanks in production, that is the shape of it |
| One unnamed button on My Scene | — | Was 29 before `6747edd` named the event hearts; one remains |

---

## 7 · Where the code is

| Thing | File |
|---|---|
| Touch-target utility | `v2/src/index.css` — `.yp-tap44` |
| Search + the punter boundary | `v2/src/components/MessengerSearch.jsx` |
| Identity selector | `v2/src/components/MessagingIdentity.jsx` |
| Identity filter | `v2/src/screens/InboxScreen.jsx` — `visibleRows` |
| Face → profile | `v2/src/components/ProfileLink.jsx` |
| Find People sheet | `v2/src/components/ProfileMenu.jsx` + `findPeopleRowStyles.js` |
| Contacts rail (the one place a face is **not** a link) | `v2/src/components/MessengerContactsSection.jsx` |
