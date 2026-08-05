# YesPleez Festival Portal — Application Shell

The organiser-facing workspace for festival recruitment. **Shell only**: no
backend, no Supabase, no API calls, no business logic. Every part is a
component that later functionality drops into without restructuring anything.

```bash
npm install
npm run dev      # http://localhost:5180
npm run build
npm run lint
```

---

## What this is, and what it is not

The Festival Portal is **another room inside YesPleez**, not a different
product. It is a separate repository and a separate deployment, but the same
platform: it consumes the existing authentication, profile system, messaging,
notifications and assets. Only the navigation and the workflow differ.

Two consequences run through the code:

- **No festival-flavoured copies of shared systems.** There is no messaging
  layer here, no notification pipeline, no profile store. The Messages and
  Announcements routes are stubs precisely because the systems behind them
  already exist elsewhere.
- **The bell and the message count are global.** They are not portal-scoped.
  A user must never miss something because they were in the wrong room.

## Folder structure

```
src/
├── main.jsx                    entry
├── App.jsx                     routing (HashRouter, matching the Scene app)
│
├── styles/
│   ├── tokens.css              ⚠ COPIED design tokens — see "Shared packages"
│   └── base.css                reset, type, .fp-panel, .glow-pill, scrollbar law
│
├── config/
│   ├── navigation.js           sidebar structure + badge counts (data, not markup)
│   └── placeholderRows.js      ⚠ delete when a data layer exists
│
├── layout/                     the shell
│   ├── FestivalLayout.jsx      the grid; owns the ONLY state in the app
│   ├── useInspector.js         the shell's contract with its screens
│   ├── FestivalSidebar.jsx
│   ├── FestivalSidebarItem.jsx
│   ├── FestivalTopbar.jsx
│   ├── FestivalSelector.jsx
│   ├── InspectorPanel.jsx
│   └── InspectorTabs.jsx
│
├── components/                 reusable, presentational, no data access
│   ├── Icon.jsx                one inline SVG set
│   ├── Placeholder.jsx         skeleton bars, deliberately not lorem ipsum
│   ├── StatCard.jsx
│   ├── StatusBadge.jsx
│   ├── ApplicationsToolbar.jsx
│   ├── ApplicationsTable.jsx
│   ├── ApplicationsRow.jsx
│   ├── Pagination.jsx
│   ├── ActivityCard.jsx
│   └── MessagesCard.jsx
│
└── screens/                    compositions, never giant pages
    ├── DashboardScreen.jsx
    ├── ApplicationsScreen.jsx  one route serves all nine categories
    ├── StatsRow.jsx
    ├── ApplicationsWorkspace.jsx
    ├── StubScreen.jsx
    └── stubs.jsx               Messages · Announcements · Profile · Settings
```

## Component hierarchy

```
App (HashRouter)
└── FestivalLayout                      ← owns `selection`, the only state
    ├── FestivalSidebar
    │   └── FestivalSidebarItem ×15     ← nav + 9 categories, badge-aware
    ├── FestivalTopbar
    │   └── FestivalSelector            ← festival, dates, location, status
    ├── main → <Outlet>
    │   ├── DashboardScreen
    │   │   ├── StatsRow → StatCard ×6
    │   │   ├── ApplicationsWorkspace
    │   │   │   ├── ApplicationsToolbar
    │   │   │   ├── ApplicationsTable → ApplicationsRow → StatusBadge
    │   │   │   └── Pagination
    │   │   └── ActivityCard + MessagesCard
    │   ├── ApplicationsScreen           ← StatsRow + ApplicationsWorkspace
    │   └── StubScreen ×5
    └── InspectorPanel
        ├── InspectorTabs                ← Profile · Application · Media · Notes · Activity
        └── Placeholder
```

## Routes

| Path | Screen |
|---|---|
| `/dashboard` | Dashboard |
| `/applications` | All applications |
| `/applications/:category` | One category — `music`, `volunteer`, `market_stall`, `food_vendor`, `workshop`, `performance_artist`, `decor`, `media`, `theme_camp` |
| `/messages` · `/announcements` · `/profile` · `/settings` · `/help` | Stubs |

Category keys match the platform's ratified role keys: `food_vendor` is
separate from `market_stall`, and the non-music performance role is
`performance_artist` — never `performer`, which would collide with Scene's
music artists.

## Decisions worth knowing

**One route serves nine categories.** Nine near-identical screens would be
nine places to fix the same bug. The category is a URL parameter.

**The shell owns one piece of state.** `FestivalLayout` tracks what the
inspector is showing, and nothing else. Filters, sorting, paging and selection
sets belong to screens or to a data layer that does not exist yet.

**The inspector keeps its width when nothing is selected.** A dock that
appears and disappears makes the table reflow on every click, which is the
most disorienting thing a three-pane workspace can do.

**Placeholders are skeleton bars, not sample prose.** A shell full of
plausible fake text gets screenshotted and evaluated as a finished product.

**`null` never renders as `0`.** A badge means "N things await your decision";
the absence of a badge is itself the signal.

**Real `<table>`, `table-layout: fixed`, sticky header.** The header and rows
must agree on column widths at any row count. Virtualisation drops into
`ApplicationsTable` without any row or screen changing.

## Desktop-first, mobile later

The shell is a CSS grid with named areas (`sidebar` / `topbar` / `main`). A
mobile layout re-declares `grid-template-areas` in a media query and moves
nothing else. Below 1180px the inspector hides and below 1024px the sidebar
leaves the grid — those breakpoints are seams, not a mobile implementation.
The portal-level tab set (Explore · Apps · Messages · Me) is a separate,
mobile-first concern and is not built.

## Shared packages (future)

This repository **must not modify the Scene app**. Today that means one thing
is duplicated rather than shared:

| Duplicated | Where | Becomes |
|---|---|---|
| Design tokens, fonts, `.glow-pill` | `src/styles/tokens.css`, `base.css` | `@yespleez/tokens` |
| `Icon`, `StatusBadge`, `Placeholder` | `src/components/` | `@yespleez/ui` (candidates, not yet duplicated in Scene) |

Until `@yespleez/tokens` exists, a token change in the Scene app has to be
mirrored here **by hand**. That is the known cost of the repository split and
it is recorded here so it is a decision rather than a surprise.

⛔ Do not invent a token name. An undefined CSS custom property does not fall
back and does not warn — it silently drops the declaration.

## Status

Builds clean, lints clean (`oxlint --deny no-undef`), no runtime console
errors. Verified at 1680×1050: sidebar 232px, topbar 72px, inspector 380px,
main 1068px, six stat cards, eight placeholder rows, no horizontal overflow.

**Not built:** any data access, filtering, search, sorting, paging, bulk
actions, inspector resize drag, mobile layout.
