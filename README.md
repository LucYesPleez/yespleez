# YesPleez Festival Portal

The organiser-facing workspace for festival recruitment. **Production frontend
architecture, no backend**: no Supabase, no API calls, no business logic. Every
piece is a reusable component that future functionality plugs into rather than
replaces.

```bash
npm install
npm run dev      # http://localhost:5180
npm run build
npm run lint     # oxlint --deny no-undef must stay clean
```

---

## What this is, and what it is not

The Festival Portal is **another room inside YesPleez**, not a different
product. Separate repository, separate deployment, same platform: it consumes
the existing authentication, profile system, messaging, notifications and
assets. Only the navigation and the workflow differ.

Two consequences run through the code:

- **No festival-flavoured copies of shared systems.** There is no messaging
  layer here, no notification pipeline, no profile store. Messages is still a
  stub *on purpose* — see "What is deliberately not built".
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
│   ├── Form.jsx                Field · TextInput · Textarea · Select · Toggle · Row
│   ├── Chip.jsx                Chip · ChipGroup — multi-select you can see at a glance
│   ├── ListRow.jsx             team, categories, sent history, threads
│   ├── Popover.jsx             anchored menus; Escape restores focus
│   ├── Menu.jsx                MenuItem (tick, closes) · MenuCheckItem (box, accumulates)
│   ├── Callout.jsx             a consequence stated beside the control that causes it
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
│   ├── CategoryNavigation.jsx      categories as TABS, not pages; fade cue on overflow
│   ├── TableToolbar.jsx            selection REPLACES it, never stacks
│   ├── SearchBar.jsx   FilterBar.jsx
│   ├── ApplicationsTable.jsx       single source of truth for a row
│   ├── ApplicationsRow.jsx         six cell renderers, zero category branches
│   ├── columnClass.js              ONE class source for <th> and <td>
│   ├── useRowNavigation.js         arrows / j / k move the selection
│   └── Pagination.jsx
│
├── inspector/                  the primary detail workspace
│   ├── InspectorPanel.jsx      permanently docked, resizable; only the tab body scrolls
│   ├── useInspectorWidth.js    drag + keyboard resize, clamped and persisted
│   ├── InspectorTabs.jsx   ProfileHeader.jsx   ActionButtons.jsx
│   └── tabs/
│       ├── registry.jsx        add a tab = one entry here
│       └── ProfileTab.jsx   StubTab.jsx
│
├── announcements/              broadcast, not conversation
│   ├── AudiencePicker.jsx      the live recipient count
│   ├── recipientCount.js
│   └── SentHistory.jsx         no edit, no delete — only View
│
├── overview/                   the lightweight summary
│   ├── StatCard.jsx            a door, not a display
│   └── ActivityPanel.jsx   MessagesPanel.jsx
│
├── config/                     what makes one workspace serve nine categories
│   ├── categories.js           the category registry
│   ├── columns.js              column definitions + responsive priority
│   ├── filters.js              filter and sort definitions
│   ├── navigation.js           six destinations
│   └── placeholderRows.js      delete when a data layer exists
│
├── screens/                    compositions, never giant pages
│   ├── OverviewScreen.jsx      ApplicationsScreen.jsx   AnnouncementsScreen.jsx
│   ├── FestivalScreen.jsx      SettingsScreen.jsx
│   └── StubScreen.jsx   stubs.jsx        (Messages · Help only)
│
└── styles/
    ├── tokens.css              COPIED — see "Shared packages"
    └── base.css
```

## Component hierarchy

```
App (HashRouter)
└── AppShell                            owns `selection`, the only app state
    ├── Sidebar → SidebarItem x6
    ├── TopBar → FestivalSelector · AnnouncementButton
    ├── main → <Outlet>
    │   ├── OverviewScreen         StatCard x6 + ActivityPanel + MessagesPanel
    │   ├── ApplicationsScreen     → ApplicationsWorkspace
    │   │       ├── CategoryNavigation   10 tabs, one workspace
    │   │       ├── TableToolbar → SearchBar + FilterBar (+ Sort / Columns popovers)
    │   │       ├── ApplicationsTable → ApplicationsRow → StatusBadge
    │   │       └── Pagination
    │   ├── AnnouncementsScreen    Compose + AudiencePicker + SentHistory
    │   ├── FestivalScreen         Identity · Dates · Media · Categories
    │   ├── SettingsScreen         Team · Applications · Notifications · Data · Danger
    │   └── StubScreen x2          Messages · Help
    └── InspectorPanel                  permanently docked, resizable
        ├── ProfileHeader · ActionButtons   (fixed — never scroll away)
        ├── InspectorTabs                    (from the registry)
        └── tab body                         (the only part that scrolls)
```

## Navigation

Six destinations: **Overview · Applications · Messages · Announcements ·
Festival · Settings**.

Application categories are deliberately **not** sidebar entries. Nine category
pages would make the sidebar the place you choose your work and the table a
consequence of it. Inverting that — one workspace, categories as tabs — is
what makes the table the primary surface. Switching category does not unmount
the table, toolbar, pagination or inspector, so moving between them costs
nothing and loses nothing.

| Path | Screen |
|---|---|
| `/applications` | The workspace, all categories |
| `/applications/:category` | The same workspace, one category |
| `/overview` | Lightweight summary |
| `/announcements` `/festival` `/settings` | Real screens |
| `/messages` `/help` | Stubs |

## Architecture decisions

**The Applications workspace is the product.** Overview is a summary whose
every figure is a door into it. Two places to review applications would mean
two places to fix every bug.

**One table, nine categories, zero branches.** A category supplies a column
set, a count and a noun. `ApplicationsRow` knows six cell renderers and has
never heard of "cuisine". Adding a category is one entry in
`config/categories.js`.

**The inspector is permanently docked, resizable, and keeps its width when
empty.** A dock that appears and disappears reflows the table on every click.
Only the tab body scrolls; identity and the four decision buttons stay fixed
and never move between applications — a reviewer builds muscle memory in the
first ten rows.

**Inspector tabs come from a registry.** Adding one is a data entry plus a
file. A tab receives only `{ selection }`.

**Selection replaces the toolbar; it does not stack a second bar.** Same
height, same position, different contents — ticking a checkbox never pushes
the table down mid-scan.

**Two selections that must never look alike.** Selected-for-review is a brand
tint with a left marker. Ticked-for-bulk is a checkbox. Confusing them makes
"accept 40" a guess.

**`null` never renders as `0`.** A badge means "N things await your decision".
A count inside a category tab is a different idea and does show zero.

**Absent, blank and unknown are three different things.** A column a category
never asks for renders nothing; one asked and left empty renders a dimmed
dash.

**Say the consequence beside the button, not in a dialog after the click.**
A confirmation dialog asks "are you sure?" of someone who has already decided.
That is what `Callout` is for.

**When a number cannot be known, refuse rather than guess.** Narrowing an
announcement audience by status has no counts to sum yet, so the figure shows
an em dash and the send button disables. An approximate recipient count is
worse than none.

## ⚠ CONTAINER QUERIES, NOT MEDIA QUERIES

**Every responsive bug found in this codebase has been the same bug.** In a
shell where panes resize independently, `@media` almost always measures the
wrong box.

At a 1680px window with the inspector at 620px, the workspace is ~828px. A
viewport query held six stat cards across it, kept ten category tabs from
collapsing, and once overrode the resize variable so a dragged pane snapped
back to a fixed width.

Two containers are declared:

| Container | Declared on | Queried by |
|---|---|---|
| `pane` | `.workspace` and every screen `.page` | table columns, category tabs, filter bar, form rows, stats grid |
| `inspector` | `.panel` | the decision-button row |

Only two `@media` rules remain, both genuinely about the screen: hiding the
dock below 1180px, and re-declaring the grid below 1024px.

**Treat a new `@media` rule inside a pane as suspect by default.**

## Interaction

| | |
|---|---|
| `↑` `↓` `j` `k` | Move the selection; the inspector follows |
| `Home` `End` | Jump to first / last |
| `Esc` | Clear the selection, or close a popover |
| `/` | Focus search |
| Drag the inspector edge | Resize, 320–620px, persisted |
| `←` `→` on the grip | Keyboard resize · `Home` resets |

`S` / `A` / `D` for shortlist, accept and decline are deliberately **not**
bound. Those are decisions that reach a real person, and a decision shortcut
wired before there is an undo path is how someone declines an applicant with a
stray keypress.

## What is deliberately not built

**Messages.** The only screen held back on principle. It consumes the
platform's existing conversation system, and building UI for it before that
contract is settled risks inventing a second message model — the one thing the
portal architecture exists to prevent.

Also absent: data access, filtering, search, sorting and paging behaviour,
bulk action behaviour, and any mobile layout. The shell is a CSS grid with
named areas; a mobile layout re-declares `grid-template-areas` and moves
nothing else.

## Shared packages (future)

This repository **must not modify the Scene app**. Today that means one thing
is duplicated rather than shared:

| Duplicated | Where | Becomes |
|---|---|---|
| Design tokens, fonts, `.glow-pill` | `src/styles/` | `@yespleez/tokens` |
| `Icon`, `StatusBadge`, `Skeleton`, `EmptyState`, `Form`, `Popover` | `src/design-system/` | `@yespleez/ui` candidates |

Until `@yespleez/tokens` exists, a token change in the Scene app must be
mirrored here **by hand**. That is the known cost of the repository split,
recorded so it is a decision rather than a surprise.

Do not invent a token name. An undefined CSS custom property does not fall
back and does not warn — it silently drops the declaration.

## Verifying changes

`vite build` passing does **not** prove the running app works — during this
build the dev server served a stale transform while the build was green and
the browser was blank. Restart Vite (and clear `node_modules/.vite`) if the
browser disagrees with the build.

Screenshots find things measurement does not: an empty applicant column that
every DOM assertion had passed was caught in one glance. Measurement finds
things screenshots do not: the container-query bug was invisible until the
numbers were compared. Use both.
