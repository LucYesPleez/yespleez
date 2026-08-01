# The YesPleez Rendering Contract

**Status: RATIFIED 2026-08-01. Permanent. Applies to the whole application, not just the Event Page.**

Artist profiles, venues, hosts, messaging, discovery, schedules, lineups, Studio — every surface that renders data it did not author is bound by this.

The problem it solves: YesPleez displays records that arrive from many places at many levels of completeness — hand-created, imported, discovered, merged, partially claimed. Without a contract, every sparse record becomes a one-off rendering decision, and the app ends up looking conditionally designed rather than deliberately designed.

---

## The five rules

### R1 — Absent ≠ Withheld ≠ Unknown

Three different states. They must never be collapsed into one.

| State | Meaning | Behaviour |
|---|---|---|
| **Absent** | We have no data | Hide silently. The reader never learns there was a gap. |
| **Withheld** | Data exists; the owner chose not to publish it | **Must render, and must say so.** Hiding it loses the owner their reveal and misleads the reader. |
| **Unknown** | The field exists but is low-confidence or inferred | Render with a qualifier. Never as fact. |

The distinction is the whole rule. "Hide when empty" alone is not enough and never was — set times already prove it: an unannounced lineup says *"to be announced"*, it does not vanish.

### R2 — Hide a card only when every child disappears

Degrade field by field first. Drop the container last. A card that can render one of its six rows renders, with one row.

Otherwise every imperfect record turns the page into Swiss cheese.

### R3 — Never render placeholders

No label with no value. No zero presented as an achievement. No placeholder image, silhouette, or grey rectangle standing in for content. No disabled primary action.

If there is nothing to say, say nothing.

### R4 — Broken records are errors, not empty states

Load-bearing fields have no empty state. An event with no title or no date is a broken record, not a sparse one. Route it to an error path; do not degrade it into a page.

Sparse is normal and must look finished. Broken is a fault and must be visible as one.

### R5 — Never leave visual holes

When a section hides, everything below it moves up. No reserved heights, no blank rectangles, no orphaned dividers or headings.

The page must always look **intentionally designed**, never **conditionally designed**.

---

## The implementation gate

**Every optional section must define all four states before implementation begins:**

```
• Render condition
• Hidden condition
• Withheld condition
• Unknown condition
```

This is a gate, not a checklist. It forces the product decision before the code. A section that cannot answer all four is not ready to build.

---

## Two clarifications the rules require

**R3 is a public-surface rule.** The owner viewing their own record is a different audience with a different need: for them, an invisible gap is an invisible to-do. Owners see their gaps as prompts —

```
Gallery   No photos uploaded.   [Add Gallery]
Tickets   No ticket link.       [Add Ticket Link]
Venue     No coordinates.       [Add Map]
```

— and this does not violate R3. **The public must never see unfinished work; the owner must always see it.** Do not "fix" an owner-facing empty state by deleting it.

**R5 requires a single declared section order.** Sections must be one ordered sequence that the layout places, not hand-positioned slots. A hand-built two-column layout cannot reflow, and R5 becomes unenforceable the moment a card in the right-hand column hides. Where a layout has two columns, the collapse behaviour (including "one column takes full width when the other empties") is part of the layout's definition, not an afterthought.

---

## What this replaces

Every future "what should this look like when there's no data?" question. The answer is: work the four states, apply the five rules. Do not re-litigate per feature.
