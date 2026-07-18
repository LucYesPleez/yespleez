# Architecture — canonical documents

The **canonical, frozen** architecture of YesPleez, and the source of truth cited by `CLAUDE.md`,
`docs/identity-ci-spec.md` and `.github/pull_request_template.md`.

## What is here

| File | Role |
|---|---|
| **`architecture-v1.0.html`** | **CANONICAL** — Architecture Specification v1.0, 10 Jul 2026 |
| **`identity-v1.1.html`** | **CANONICAL** — Identity Architecture v1.1 (Amendment), ratified + frozen 17 Jul 2026 |
| `architecture-v1.0.md` | Reading copy. Not authoritative. |
| `identity-v1.1.md` | Reading copy. Not authoritative. |
| `errata.md` | Known factual errors in the frozen documents. Records; corrects nothing. |
| `render-markdown.js` | Regenerates the `.md` copies from the `.html` sources. |
| `publication-v1.0-draft.md` | **DRAFT — not canonical, not binding.** Proposed Publication Model v1.0. See below. |

**The `.html` files are authoritative.** The `.md` files are mechanically converted reading copies
for diff-review and GitHub navigation. **Where they disagree, the HTML is correct.** Never cite a
`.md`; never hand-edit one — re-run the converter:

```bash
npm i turndown turndown-plugin-gfm     # not a repo dependency; install ad hoc
node docs/architecture/render-markdown.js
```

The conversion is mechanical by design. Nobody should ever retype a frozen document by hand —
that is how paraphrase enters a canonical record.

The two documents are canonical **together**. v1.1 is an amendment under v1.0 §17, not a
replacement: v1.0 remains binding in full except for the clauses v1.1 §A2 lists.

## Drafts

`publication-v1.0-draft.md` is the only hand-authored Markdown permitted in this directory, and it
is permitted only because it is **not canonical**. It proposes a future specification; it governs
nothing, and no implementation may cite it.

It lives here rather than in `docs/` because it is versioned and will be ratified, not a dated
snapshot — but it is deliberately excluded from the canonical table above and carries a refusal
banner as its first lines.

**On ratification it is re-authored as `publication-v1.0.html`** (per the provenance convention: the
canonical form is the frozen HTML artifact), added to the canonical table, and the draft is deleted.
A draft that outlives its ratification is a second source of truth.

**If a draft is abandoned, delete it.** A stale proposal in this directory is worse than no
proposal — it reads as decided to anyone who skims the banner.

## Why this is not in `docs/`

`docs/` holds **dated snapshots** — design reviews, migration plans, verification evidence
(`m3-design-review-2026-07.md`, `m5-verification-evidence-2026-07.md`). They record what was true
in July 2026 and are never revised.

These are the opposite: **versioned, frozen, cited by other files.** Different lifecycle, different
directory. Nothing here is dated in its filename; everything is versioned.

## Provenance

Both documents were authored as Claude artifacts and remain retrievable at their source URLs:

- v1.0 — `https://claude.ai/code/artifact/a71257bf-b384-4b62-8bce-4ba9f9762ef8`
- v1.1 — `https://claude.ai/code/artifact/16703884-032f-4ed2-8478-eea51c8654ed`

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
`R6.1`, `B1`, `B2`, `D1`, and sections `A0`–`A13` are cited from outside this directory. **Never
renumber** — it breaks every citation in the repo and in merged PRs.

## Citation check

Verified 17 Jul 2026: **every rule cited anywhere in this repository exists in v1.1.** `CLAUDE.md`,
the CI spec and the PR template between them cite `R1`, `R2`, `R3`, `R3.1`, `R3.2`, `R5`, `R6.1`
and `§A9` — all present. `R4` (follow split) and `D1` (single owner) are defined in v1.1 and cited
by nothing here; that is fine, not a gap.

## Open questions — not decided

**`booking_interest` does not exist in this repository.** v1.1 §A3 lists it as profile-actionable
and marks it **"✓ already"** carrying the pair; v1.0 §06 specifies it in full, with
`from_profile_id` and `from_user_id`. But the repo has no such table, no such columns anywhere, and
no reference in `v2/` source. Since migrations create no tables (see the CI spec's Tier 2
prerequisite), it may exist in the dashboard schema and simply not be wired to the app — or it may
have been specified and never built. **Settling this needs a look at the live schema**; it cannot be
answered from the repository. Until then the CI spec carries it flagged unverified.
