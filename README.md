# YesPleez Festival Portal

The organiser-facing workspace for festival recruitment. **Production frontend
architecture, no backend**: no Supabase, no API calls, no business logic. Every
piece is a reusable component that future functionality plugs into rather than
replaces.

```bash
npm install
npm run dev      # http://localhost:5180
npm run build
npm run lint
```

---

## What this is, and what it is not

The Festival Portal is **another room inside YesPleez**, not a different
product. Separate repository, separate deployment, same platform: it consumes
the existing authentication, profile system, messaging, notifications and
assets. Only the navigation and the workflow differ.

Two consequences run through the code:

- **No festival-flavoured copies of shared systems.** There is no messaging
  layer here, no notification pipeline, no profile store. Messages and
  Announcements are stubs precisely because the systems behind them exist.
- **The bell and the message count are global.** Never portal-scoped. A user
  must not miss something because they were in the wrong room. Filtering
  belongs in the lists; a badge is a total.

## Folder structure

```
src/
├── App.jsx                     routing — HashRouter, matching the Scene app
├── main.jsx
│
├── design-system/              every visual primitive; screens import ONLY from here
│   ├── index.js                the barrel — the one import path
│   ├── Icon.jsx                one inline SVG set
│   ├── Button.jsx              primary · secondary · ghost · quiet · intent
│   ├── SectionCard.jsx         the portal's one raised surface
│   ├── StatusBadge.jsx         the applicant-facing status vocabulary
│   ├── EmptyState.jsx          absent is not withheld is not unknown
│   ├── LoadingState.jsx        skeletons shaped like the content they replace
│   └── Skeleton.jsx
│
├── shell/                      the permanent frame
│   ├── AppShell.jsx            the grid; owns the ONLY app state
│   ├── shellContext.js         useShell() — the contract with screens
│   ├── Sidebar.jsx   SidebarItem.jsx
│   ├── TopBar.jsx    FestivalSelector.jsx
│   └── AnnouncementButton.jsx  the portal's one primary action
│
├── applications/               THE PRIMARY WORKSPACE
│   ├── ApplicationsWorkspace.jsx   fixed frame; only rows scroll
│   ├── CategoryNavigation.jsx      categories as TABS, not pages
│   ├── TableToolbar.jsx            selection REPLACES it, never stacks
│   ├── SearchBar.jsx   FilterBar.jsx
│   ├── ApplicationsTable.jsx       single source of truth for a row
│   ├── ApplicationsRow.jsx         six cell renderers, zero category branches
│   └── Pagination.jsx
│
├── inspector/                  the primary detail workspace
│   ├── InspectorPanel.jsx      permanently docked; only the tab body scrolls
│   ├── InspectorTabs.jsx   ProfileHeader.jsx   ActionButtons.jsx
│   └── tabs/
│       ├── registry.jsx        add a tab = one entry here
│       └── ProfileTab.jsx   StubTab.jsx
│
├── overview/                   the lightweight summary
│   ├── StatCard.jsx            a door, not a display
│   └── ActivityPanel.jsx   MessagesPanel.jsx
│
├── config/                     what makes one workspace serve nine categories
│   ├── categories.js           the category registry
│   ├── columns.js              column definitions + responsive priority
│   ├── navigation.js           six destinations
│   └── placeholderRows.js      delete when a data layer exists
│
├── screens/                    compositions, never giant pages
│   ├── OverviewScreen.jsx   ApplicationsScreen.jsx
│   └── StubScreen.jsx   stubs.jsx
│
└── styles/
    ├── tokens.css              COPIED — see "Shared packages"
    └── base.css
```

## Component hierarchy

```
App (HashRouter)
└── AppShell                            owns `selection`, the only state
    ├── Sidebar → SidebarItem x6
    ├── TopBar → FestivalSelector · AnnouncementButton
    ├── main → <Outlet>
    │   ├── OverviewScreen
    │   │   ├── StatCard x6             each links into the workspace
    │   │   └── ActivityPanel + MessagesPanel
    │   ├── ApplicationsScreen
    │   │   └── ApplicationsWorkspace
    │   │       ├── CategoryNavigation   10 tabs, one workspace
    │   │       ├── TableToolbar → SearchBar + FilterBar
    │   │       ├── ApplicationsTable → ApplicationsRow → StatusBadge
    │   │       └── Pagination
    │   └── StubScreen x5
    └── InspectorPanel                  permanently docked
        ├── ProfileHeader · ActionButtons   (fixed)
        ├── InspectorTabs                    (from the registry)
        └── tab body                         (the only part that scrolls)
```

## Navigation

Six destinations: **Overview · Applications · Messages · Announcements ·
Festival · Settings**.

Application categories are deliberately **not** sidebar entries. Nine category
pages would make the sidebar the place you choose your work and the table a
consequence of it. Inverting that — one workspace, categories as tabs — is
what makes the table the primary surface of the product. Switching category
does not unmount the table, the toolbar, the pagination or the inspector, so
moving between them costs nothing and loses nothing.

| Path | Screen |
|---|---|
| `/applications` | The workspace, all categories |
| `/applications/:category` | The same workspace, one category |
| `/overview` | Lightweight summary |
| `/messages` `/announcements` `/festival` `/settings` `/help` | Stubs |

## Architecture decisions

**The Applications workspace is the product.** Overview is a summary whose
every figure is a door into it. Two places to review applications would mean
two places to fix every bug.

**One table, nine categories, zero branches.** A category supplies a column
set, a count and a noun. `ApplicationsRow` knows six cell renderers and has
never heard of "cuisine". Adding a category is one entry in
`config/categories.js` — no route, no screen, no component.

**The inspector is permanently docked and keeps its width when empty.** A dock
that appears and disappears reflows the table on every click. Only the tab
body scrolls; identity and the four decision buttons stay fixed, and those
buttons never move between applications — a reviewer builds muscle memory in
the first ten rows and a shifted button eventually mis-fires a real decision.

**Inspector tabs come from a registry.** Adding one is a data entry plus a
file. A tab receives only `{ selection }`; widening that contract would make
every existing tab a party to the new one's requirements.

**Selection replaces the toolbar; it does not stack a second bar.** Same
height, same position, different contents — so ticking a checkbox never
pushes the table down and loses your place mid-scan.

**Two selections that must never look alike.** Selected-for-review (the
inspector is showing it) is a brand tint with a left marker. Ticked-for-bulk
is a checkbox. Confusing them makes "accept 40" a guess.

**`null` never renders as `0`.** A badge means "N things await your decision",
so zero is the absence of a badge. A count inside a category tab is a
different idea — how many exist — and does show zero.

**Absent, blank and unknown are three different things.** A column a category
never asks for renders nothing; one asked and left empty renders a dimmed
dash. A reviewer must be able to tell "we didn't ask" from "they didn't
answer".

**No business logic anywhere.** SearchBar holds its input value, the workspace
holds which rows are ticked, the panel holds which tab is open. Nothing
filters, sorts, pages or fetches.

## Desktop-first, mobile later

The shell is a CSS grid with named areas (`sidebar` / `topbar` / `body`). A
mobile layout re-declares `grid-template-areas` in a media query and moves
nothing else. Below 1180px the inspector hides; below 1024px the sidebar
leaves the grid. Those breakpoints are seams, not a mobile implementation.

Table columns hide by `priority` from `config/columns.js` — `applicant` and
`status` carry no priority and never hide, because "who" and "where are we up
to" are the two questions a reviewer always needs answered.

## Shared packages (future)

This repository **must not modify the Scene app**. Today that means one thing
is duplicated rather than shared:

| Duplicated | Where | Becomes |
|---|---|---|
| Design tokens, fonts, `.glow-pill` | `src/styles/` | `@yespleez/tokens` |
| `Icon`, `StatusBadge`, `Skeleton`, `EmptyState` | `src/design-system/` | `@yespleez/ui` candidates |

Until `@yespleez/tokens` exists, a token change in the Scene app must be
mirrored here **by hand**. That is the known cost of the repository split,
recorded so it is a decision rather than a surprise.

Do not invent a token name. An undefined CSS custom property does not fall
back and does not warn — it silently drops the declaration.

## Status

Builds clean, lints clean (`oxlint --deny no-undef`, zero warnings).

Verified in-browser at 1680x1050: six sidebar destinations, ten category tabs,
inspector docked at 380px. Switching category changes the column set
(Volunteers shows Skills/Availability where All shows Category/Country),
updates the count and pagination total, and **preserves the inspector
selection** — the workspace never unmounts. Ticking rows replaces the toolbar
with a 60px selection bar at the same height. Rows missing a category's
fields render dimmed dashes rather than blanks.

**Not built:** data access, filtering, search, sorting, paging, bulk action
behaviour, inspector resize drag, mobile layout.
