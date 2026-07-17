<!--
  Delete the identity section below if this PR touches no profiles, attribution or authorization.
  If you are unsure whether it does, it does.
-->

## What & why



---

## Identity contract

*Required for any change that lets a user create, send, modify or publish something **on behalf of a profile**. Derived from Identity Architecture v1.1 — frozen. Answer against the diff, not against intent.*

- [ ] **1. The row names its actor.** A profile column, non-null, populated from the active profile **at the moment of the write**. *(R1, R6.1)*
- [ ] **2. The row names the human.** A user column, for auth, audit and notification delivery. *(R1)*
- [ ] **3. Authorization goes through the seam — and only the seam.** `can_act_as()`. Not inlined. Not the active profile. *(R2, R3, R3.2)*

**Reviewer — the things CI cannot catch:**

- [ ] **The active profile is not load-bearing for permission** anywhere in this diff. It sets attribution and a label. Nothing else. *(R2)*
- [ ] **Attribution is authorized** — the profile column is only writable where `can_act_as(<that profile>)`. Without this, a client can claim to be a venue it does not own. *(R3.2)*
- [ ] **The sender is semantically right**, not merely present. CI proves the column is filled; only you can tell whether it is filled with the correct profile. *(R1)*

<!--
  N/A is a valid answer to any of these — but write *why*, not just "N/A".
  Account-level actions (claims, signup, settings, billing) legitimately have no acting
  profile: you claim a profile AS A PERSON. Say that, and move on.
-->

---

## Guardrails

- [ ] **No new inline `auth.uid()`** in a policy. The debt ledger (`docs/identity-ci-spec.md`) may only shrink. *(R3)*
- [ ] **No new `.neq('type','punter')`.** Personal's discovery filter belongs in `profileResolution.js` alone. *(§A9)*
- [ ] **New table?** Classified in the identity registry as profile-actionable or account-actionable. Silence is the failure mode. *(C5)*
- [ ] **Edited `v2/`, not the retired v1 at the repo root.** Root has files with identical names — `follows.js`, `events.js`, `app.js`.
- [ ] **No M6/M7/M8 work.** The migration is paused at M5.1 and resumes only when the owner says so.

## Architecture

- [ ] This PR **implements** the frozen architecture — it does not revise it.

> Architecture v1.0 + Identity v1.1 are **frozen**. They change only via a versioned amendment, and only if implementation uncovers a **genuine contradiction or unrepresentable state**. If you found one: **stop and raise it.** Do not route around it, and do not fix it in this PR.
