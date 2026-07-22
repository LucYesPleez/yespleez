# Architecture — canonical documents

The **canonical, frozen** architecture of YesPleez, and the source of truth cited by `CLAUDE.md`,
`docs/identity-ci-spec.md` and `.github/pull_request_template.md`.

## What is here

| File | Role |
|---|---|
| **`architecture-v1.0.html`** | **CANONICAL** — Architecture Specification v1.0, 10 Jul 2026 |
| **`identity-v1.1.html`** | **CANONICAL** — Identity Architecture v1.1 (Amendment), ratified + frozen 17 Jul 2026. Binding in full except the one cell v1.2 supersedes. |
| **`identity-v1.2.html`** | **CANONICAL** — Identity Architecture v1.2 (Amendment), ratified + frozen 18 Jul 2026 |
| **`identity-v1.3.html`** | **CANONICAL** — Identity Architecture v1.3 (Amendment), ratified + frozen 18 Jul 2026 |
| **`communication-v1.0.md`** | **CANONICAL** — Communication Architecture v1.0, ratified + frozen 20 Jul 2026. **Authored in Markdown, so this file is authoritative** — see "Which artifact is authoritative" below. |
| **`messaging-availability-v1.0.md`** | **CANONICAL** — Messaging Availability Constitution v1.0, ratified + frozen 21 Jul 2026. Governed by `communication-v1.0`. **Authored in Markdown, so this file is authoritative.** |
| **`conversation-workspace-v1.0.md`** | **CANONICAL — amended by v1.1.** Conversation Workspace v1.0, ratified + frozen 22 Jul 2026. The ⋮ menu, conversation indexes, and the three layers above the message stream. Governed by `communication-v1.0` and `messaging-availability-v1.0`. **Authored in Markdown, so this file is authoritative.** |
| **`conversation-workspace-v1.1.md`** | **CANONICAL** — Conversation Workspace v1.1, ratified + frozen 22 Jul 2026. Amends v1.0: messaging availability is exposed as a *Messaging* screen, never a "Block" action. Read WITH v1.0, which remains in force except where amended. **Authored in Markdown, so this file is authoritative.** |
| **`demo-mix-providers-v1.0.md`** | **CANONICAL** — Demo Mix Provider Architecture v1.0, ratified + frozen 22 Jul 2026. Playback arbitration (SHORT/LONG), the provider interface and registry, and the three-layer split. **Authored in Markdown, so this file is authoritative.** |
| `architecture-v1.0.md` | Reading copy. Not authoritative. |
| `identity-v1.1.md` | Reading copy. Not authoritative. |
| `identity-v1.2.md` | Reading copy. Not authoritative. |
| `identity-v1.3.md` | Reading copy. Not authoritative. |
| `errata.md` | Known factual errors in the frozen documents. Records; corrects nothing. |
| `render-markdown.js` | Regenerates the `.md` copies from the `.html` sources. |
| `publication-v1.0-draft.md` | **DRAFT — not canonical, not binding.** Proposed Publication Model v1.0. See below. |

## Which artifact is authoritative

**The authored artifact is authoritative.** That is the rule; HTML is not special in itself.

- **`architecture-v1.0`, `identity-v1.1`, `identity-v1.2`, `identity-v1.3`** were **authored in
  HTML**. Their `.md` files are mechanically converted reading copies for diff-review and GitHub
  navigation. **Where they disagree, the HTML is correct.** Never cite those `.md` files; never
  hand-edit one — re-run the converter below.
- **`communication-v1.0`** and **`messaging-availability-v1.0`** were **authored in Markdown**. Those
  `.md` files *are* the canonical record. There is no HTML derivative of either, and one must not be
  generated and then treated as canonical: doing so would make the derived artifact authoritative,
  which is the exact failure this rule prevents.

The converter runs **HTML → Markdown only**. It is not a general document pipeline:

```bash
npm i turndown turndown-plugin-gfm     # not a repo dependency; install ad hoc
node docs/architecture/render-markdown.js
```

The conversion is mechanical by design. Nobody should ever retype a frozen document by hand —
that is how paraphrase enters a canonical record.

The four documents are canonical **together**, each an amendment under v1.0 §17 rather than a
replacement:

- **v1.0** remains binding in full except for the clauses **v1.1 §A2** lists **and** the event
  **authorization basis** in §03 that **v1.3 `O-R4`** supersedes. §03's separation principle —
  *"one column never again does both jobs"* — is **preserved**, not reversed (v1.3 `O-R2`).
- **v1.1** remains binding in full except for the single §A12 `U2` cell **v1.2 §B2** supersedes.
  **v1.3 changes nothing in v1.1** — §A3 and §A4 are reconciled, not amended.
- **v1.2** adds §A14 and renumbers nothing.
- **v1.3** adds `O-R1`–`O-R6` and renumbers nothing.

Read together, latest amendment wins on the specific clauses it names, and nowhere else.

## Drafts

`publication-v1.0-draft.md` is the only remaining draft. It is hand-authored Markdown, permitted
because it is **not canonical**. It proposes a future specification; it governs nothing, and no
implementation may cite it.

`communication-v1.0-draft.md` was **ratified 20 Jul 2026** and is now `communication-v1.0.md` in
the canonical table above.

Rule-number prefixes are namespaced per document — `P` for publication, `C`/`D` for communication —
and do not collide with the `R`/`B`/`D`/`A` interface of `identity-v1.1`. A citation must name its
document.

It lives here rather than in `docs/` because it is versioned and will be ratified, not a dated
snapshot — but it is deliberately excluded from the canonical table above and carries a refusal
banner as its first lines.

**On ratification it is re-authored as `publication-v1.0.html`** (per the provenance convention: the
canonical form is the frozen HTML artifact), added to the canonical table, and the draft is deleted.
A draft that outlives its ratification is a second source of truth.

**If a draft is abandoned, delete it.** A stale proposal in this directory is worse than no
proposal — it reads as decided to anyone who skims the banner.

**A proposed amendment to a frozen document is a third case.** It is not a draft of a new
specification; it is a specific, minimal edit to a ratified file that has not yet been approved. The
frozen document it amends **remains canonical and unchanged in full** until ratification — which
means authoring the new versioned `.html`, recording the supersession here, regenerating the reading
copy, and deleting the proposal. `identity-v1.2-proposed.md` followed this path on 18 Jul 2026 and
was deleted on ratification.

**A proposal may not rest on a draft.** A frozen document that cited a non-canonical one would
canonise it by reference, without ratification. Where an amendment is prompted by work in a draft,
its stated authority must be the underlying decision, not the draft.

## Why this is not in `docs/`

`docs/` holds **dated snapshots** — design reviews, migration plans, verification evidence
(`m3-design-review-2026-07.md`, `m5-verification-evidence-2026-07.md`). They record what was true
in July 2026 and are never revised.

These are the opposite: **versioned, frozen, cited by other files.** Different lifecycle, different
directory. Nothing here is dated in its filename; everything is versioned.

## Provenance

v1.0 and v1.1 were authored as Claude artifacts and remain retrievable at their source URLs:

- v1.0 — `https://claude.ai/code/artifact/a71257bf-b384-4b62-8bce-4ba9f9762ef8`
- v1.1 — `https://claude.ai/code/artifact/16703884-032f-4ed2-8478-eea51c8654ed`

**`identity-v1.2.html` and `identity-v1.3.html` have a different provenance and it is recorded here
rather than glossed.** Both were authored in-repo on 18 Jul 2026, not as served artifacts, so there
is no source URL for either and the byte-count reconciliation below does not apply to them. Their
`<head>`, stylesheet and class vocabulary were **copied mechanically** from `identity-v1.1.html`
(the first 275 lines, with only the `<title>` changed) rather than retyped, for the reason stated
above: nobody should hand-retype a canonical document. Only the document bodies are new.

**One modification was made to the served bytes, and only one.** claude.ai injects a 9,540-byte
`<!-- frame-runtime -->` script block when serving an artifact — host scaffolding added at serve
time, never authored, referencing a `/_runtime/` path that does not exist outside claude.ai. That
comment-delimited block, and nothing else, was removed. It was byte-identical in both files
(sha256 `f623e7b70d51aa2f…`), which is itself evidence it is scaffolding rather than content.

Byte counts, verified 17 Jul 2026 (`committed == served − wrapper`, byte-exact):

| File | Served | Removed | Committed | sha256 (committed) |
|---|---:|---:|---:|---|
| `identity-v1.1.html` | 73,439 | 9,540 | 63,899 | `88acd5cbfac517f9c2257a5ff974a2e2a369db748521eb98c44c4b5ceec35ac4` |
| `architecture-v1.0.html` | 80,840 | 9,540 | 71,300 | `327c442c6ed63db6641182635e02832f1918f895fb03a1bc80b68b5581968ac0` |

Everything authored — title, styles, table of contents, SVG diagrams, every word of prose — is
untouched. If absolute byte-fidelity to the served response is ever needed, re-fetch the URLs.

## The rules for this directory

**1. Filenames carry the version. Files are immutable once ratified.**
`identity-v1.1.html` is never edited after ratification. An amendment is a **new file**
(`identity-v1.2.html`); the superseded file stays in place, and this README records that it was
superseded.

This follows from the freeze. Other documents cite v1.1 *by rule number*. Editing it in place would
silently change what an existing citation means — every merged PR that ticked `*(R3.2)*` would now
point at different text. Superseded versions stay readable so old citations stay resolvable.

**2. Amendment procedure** (restated from `CLAUDE.md`; that file remains the operative statement):

> Work against these documents is **implementation only**. They change *only* via a versioned
> amendment (v1.2+), and *only* if implementation uncovers a **genuine contradiction or an
> unrepresentable state**. Preference, taste and optimisation do not reopen them. If you believe
> you have found a contradiction: **stop and surface it.** Do not route around it.

**3. Errors are recorded, not fixed.** A known error goes in `errata.md`. It stays in the frozen
text until a versioned amendment supersedes it. See `errata.md` E1.

**4. Rule numbers are the citation interface.** `R1`, `R2`, `R3`, `R3.1`, `R3.2`, `R4`, `R5`, `R6`,
`R6.1`, `B1`, `B2`, `D1`, sections `A0`–`A14`, and v1.2's own `B0`–`B7` are cited from outside this
directory. **Never renumber** — it breaks every citation in the repo and in merged PRs.

Note the collision hazard: v1.1 uses `B1`/`B2` for its blocker findings, and v1.2 uses `B0`–`B7` for
its section numbers. **A citation must name its document** — "v1.1 `B2`" and "v1.2 §B2" are
different things.

## Citation check

Verified 17 Jul 2026: **every rule cited anywhere in this repository exists in v1.1.** `CLAUDE.md`,
the CI spec and the PR template between them cite `R1`, `R2`, `R3`, `R3.1`, `R3.2`, `R5`, `R6.1`
and `§A9` — all present. `R4` (follow split) and `D1` (single owner) are defined in v1.1 and cited
by nothing here; that is fine, not a gap.

Re-verified 18 Jul 2026 for v1.2: **`U2` is cited nowhere outside this directory** — not in
`CLAUDE.md`, the CI spec, or the PR template. v1.2 renumbers nothing, so ratification broke no
citation anywhere in the repository.

## Open questions — not decided

**`booking_interest` does not exist in this repository.** v1.1 §A3 lists it as profile-actionable
and marks it **"✓ already"** carrying the pair; v1.0 §06 specifies it in full, with
`from_profile_id` and `from_user_id`. But the repo has no such table, no such columns anywhere, and
no reference in `v2/` source. Since migrations create no tables (see the CI spec's Tier 2
prerequisite), it may exist in the dashboard schema and simply not be wired to the app — or it may
have been specified and never built. **Settling this needs a look at the live schema**; it cannot be
answered from the repository. Until then the CI spec carries it flagged unverified.
