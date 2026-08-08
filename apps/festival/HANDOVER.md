# Handover — Festival Portal

**Date:** 2026-08-05 · **Repo:** `…\YesPleez App\YesPleez Festival Portal`
**HEAD:** `51c7a59` · working tree clean · **no git remote yet**

Read `README.md` first — it is current and covers architecture, decisions and
the container-query law. This file covers only *where things stand* and *what
to do next*.

---

## State

The frontend is complete. Six destinations, five of them real screens, one
honest stub (Help). 103 source files. `oxlint --deny no-undef` clean,
`vite build` clean, no runtime console errors.

There is **no backend**. `src/data/` holds three repositories behind an
interface — `FestivalRepository`, `CategoryRepository`,
`ApplicationRepository` — injected through `DataProvider`. They are in-memory.
Connecting a real backend means writing a second implementation of those three
contracts and swapping them in `DataProvider.jsx`. **No screen, component or
hook should change.**

```
51c7a59  Data layer: repositories behind an interface
5bf8f4a  Messages + README rewrite
273fcb7  Container-query fixes
919a991  Popover / Menu
d731f5d  Inspector resize + keyboard navigation
e6d78c4  Announcements
f9ccd93  Form + list primitives; Settings + Festival
a7a4c63  Permanent architecture
31c1b50  Application shell
```

## The one decision that shapes what comes next

The owner ruled (correctly) that there are **two goals, not one**:

1. **Permanent unified applications engine** — waits for V2.5, which waits for
   V2 to stabilise. This is the platform-wide work.
2. **Accept applications for the upcoming festival** — does *not* wait. Much
   smaller: festival profile → categories → application form → dashboard →
   review → accept/decline → message.

The Portal was built for (2) while being shaped for (1). The repository
interface speaks the **ratified unified vocabulary** (`data/types.js`), so the
Festival MVP can ship on its own tables without that temporary shape reaching
the UI.

**The cost of that, stated plainly:** applications taken on a Festival-MVP
schema must migrate into the unified model later. Bounded and accepted, but
real — do not let anyone rediscover it in V2.5.

## Next task

Write a Supabase implementation of the three repositories, and the minimum
schema behind it:

- `profiles.type = 'festival'` — a festival is a PROFILE in the shared system,
  never a bespoke `festivals` table. That is what makes it followable,
  messageable and claimable for free.
- editions (one auto-created; UI reveals them only at the second)
- categories, with `decisionMode` per category
- applications, in the shape `data/types.js` describes

Then swap them in `DataProvider.jsx`. Nothing else should need touching — if
it does, the interface was wrong and that is worth stopping over.

## Do not

- **Do not edit the Scene app from this repo.** Read-only. Shared code becomes
  a future `@yespleez/tokens` / `@yespleez/ui` package, never a cross-repo
  edit.
- **Do not import a repository directly.** Only `DataProvider` may. One direct
  import permanently couples a screen to in-memory data and will not fail
  until someone tries to swap it.
- **Do not add an `@media` rule inside a pane.** Every responsive bug found
  here has been the same bug. Use `@container pane` or `@container inspector`.
- **Do not build a conversation view.** Messages is a thread list on purpose;
  the conversation belongs to the platform's shared system.
- **Do not bind S/A/D to decisions** until there is an undo path.
- **Do not trust a green `vite build`.** It passed while the dev server served
  a stale transform and the browser was blank. Restart Vite and clear
  `node_modules/.vite` if the browser disagrees.

## Loose ends

| | |
|---|---|
| **No git remote** | Three days of work exists on one disk. Highest-priority housekeeping. |
| **Help screen** | Still a stub. Trivial, low value. |
| **Mobile layout** | Deliberately not built. Grid uses named areas; a media query re-declares `grid-template-areas` and moves nothing else. Breakpoints at 1180px (dock hides) and 1024px (sidebar leaves) are the seams. |
| **Bulk actions / filters / sort** | UI complete, behaviour not wired. They record choices; the repository query already accepts them. |
| **`placeholderRows.js` / `placeholderThreads.js`** | Delete when real data lands. Only the repositories and MessagesScreen import them. |

## Elsewhere in the platform (not this repo)

- **Scene app** `…\YesPleez Scene App\YesPleez`, branch `v2-react`. M6 read
  migration (`ec826bb`) and the oxlint config fix (`933f14c`) are **pushed**.
- **M6 still needs manual verification** with a real host account: open an
  event's Applications tab, then UNASSIGN a lineup member and confirm only
  that profile's application changes status.
- **Open bug, spawned as a task:** `ContactSyncSettings.jsx` references
  `infoDotStyle` (344), `explainStyle` (350), `limitStyle` (377) — none
  defined. Real `ReferenceError`s; `vite build` passes them.
- **Specification:** `…\Claude Cowork\festival-applications-spec-v1.md` (v1.6,
  20/20 decisions ratified) and `festival-portal-estimation-v1.md`.
