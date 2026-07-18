# Unclaimed-host model — architecture assessment

**18 Jul 2026 · assessment, not a specification.** Prepared during M6 at the owner's request, to be
reviewed before Studio implementation begins. Nothing here is implemented and nothing is canonical.

**Question.** When YesPleez Studio imports an event for a venue nobody has claimed, who owns it?

---

## The proposed model

1. Studio is a catalog publisher, not the host.
2. Events belong to the Venue profile.
3. Unclaimed Venue profiles have `user_id = NULL`.
4. `can_act_as()` correctly returns false for them.
5. Nobody can act as that Venue until it is claimed.
6. Claiming the Venue immediately grants management of existing imported events, with no ownership
   migration.

**Points 1, 3, 4 and 5 hold exactly as stated.** Point 4 is not merely compatible with the
implementation — it is what `can_act_as()` does by construction: M6a returns false when
`user_id IS NULL`, and that branch exists precisely so an unclaimed profile can be referenced
without being actable. Point 1 is consistent with the publication model's §P8, which already forbids
Operations tooling from becoming a publisher in its own right.

**Points 2 and 6 conflict with the live schema.** They are the right intent; they are not currently
true, and cannot become true without a change nobody has scheduled.

---

## The conflict

`events` carries **`host_id`** — a *user* id — plus `venue_profile_id`. There is **no
`host_profile_id`** (verified against live schema, 18 Jul 2026).

So ownership of an event is expressed on the **host axis, by account**, and `venue_profile_id`
identifies *where the event happens*, not who owns it. This is not incidental: live RLS keys off it
directly, e.g. the applications policies read

```
EXISTS (SELECT 1 FROM events WHERE events.id = applications.event_id
        AND events.host_id = auth.uid())
```

Three consequences follow.

**C1 · "Events belong to the Venue profile" changes the ownership axis.** Every policy and read that
governs an event today resolves `host_id`. Declaring the venue the owner does not reassign a
column — it introduces a *second* ownership axis, so an event could be owned by a host account and
by a venue profile simultaneously, with no rule saying which wins. That is the fault v1.0 §03
outlaws: *"one column never again does both jobs"*, arrived at from the opposite direction.

**C2 · An imported event has no host account, so nothing can manage it.** Studio is not the host
(point 1) and the venue is unclaimed, so `host_id` would be `NULL`. Every existing policy resolves
`host_id = auth.uid()`, and `NULL` matches no one. The event is unmanageable — correct for now, but
it stays unmanageable after claiming, which brings us to the real problem.

**C3 · Point 6 does not hold. Claiming the venue would grant nothing.** Claiming sets `user_id` on
the *venue profile* (v1.0 §07 — attach is three fields, atomic). No policy consults
`venue_profile_id`, so `can_act_as(venue_profile_id)` flipping to true changes no permission
anywhere. The new owner would see their venue and still be unable to manage the events imported for
it — the exact ownership migration point 6 exists to avoid.

**C3 is the finding that matters.** The desired property is sound and worth keeping; the mechanism
to deliver it does not exist yet.

---

## What would make the model true

Give events the identity pair v1.1 §A3 already prescribes, rather than inventing venue-ownership:

- **`events.host_profile_id`** — the profile that owns the event. `host_id` stays as the human
  (split, not moved — the §A6 pattern, for the same reason: existing reads depend on it).
- **Studio imports set `host_profile_id` to the unclaimed venue profile.** The venue *is* the host
  of its own imported listings, which is true in the world as well as in the schema.
- **Policies resolve `can_act_as(host_profile_id)`** instead of `host_id = auth.uid()`.

Then point 6 becomes automatic rather than aspirational: claiming the venue sets `user_id`,
`can_act_as(venue_profile)` flips to true, and every event whose `host_profile_id` is that profile
becomes manageable **in the same instant, with no data migration at all**. Attribution was recorded
against a stable profile id from the moment of import; claiming only supplies the human.

That is the identity architecture working as designed — v1.1's whole point is that
`profile.id` is stable across claiming while `user_id` is not.

**One ownership axis, not two.** A venue hosting its own event and a promoter hosting an event at
that venue are then the same shape: `host_profile_id` names the owner, `venue_profile_id` names the
place. Nothing needs to know whether the host happens to be a venue.

---

## Interaction with other documents

**Identity v1.0 §02 / §07** — an unclaimed profile carrying imported events is exactly what §02
describes, and claiming remains three fields with no merge. **No conflict.**

**Identity v1.1 §A3** — the pair on profile-actionable tables. This proposal is that rule applied to
`events`, not an exception to it. Note §A3 already lists events as carrying the pair *"via §03
split"*; the live schema shows that split produced `host_id` + `venue_profile_id`, which is a
host/place split rather than a profile/user pair. **Worth reconciling deliberately**, since a reader
of §A3 would reasonably expect `host_profile_id` to exist already.

**Identity v1.2 §A14** — unaffected; this is identity, governed here.

**Publication model (draft) §P8** — Operations tooling must never re-publish. A Studio-imported
event for an unclaimed venue starts unpublished and the venue's future owner controls its stage.
**Consistent**, and worth stating explicitly when Studio import is specified, because "imported"
must not imply "listed".

**Communication architecture (draft) §4.5, `C17`** — no cold DM; reachability derives from workflow
or a declared opening. An unclaimed venue has no owner to message and no Personal profile behind it,
so it is unreachable until claimed. **Consistent**, no change needed.

---

## Recommendation

**Yes — this should be settled as a canonical rule before Studio implementation, but not as
"events belong to the Venue profile".** That phrasing introduces a second ownership axis and would
have to be unpicked later.

The rule worth ratifying is narrower and follows from v1.1 rather than amending it:

> An event is owned by a **profile** (`host_profile_id`), never by an account. A Studio import sets
> that profile to the venue's — claimed or not. Claiming a profile grants management of everything
> already attributed to it, because attribution was never account-based to begin with.

Settling it first matters because it is a **schema and policy change to `events`**, which is M6/M7
territory. Discovering it after Studio has imported a few hundred events means backfilling ownership
onto rows whose correct owner has to be re-derived — the same class of problem `U4` has just cost
us on twelve application rows.

**Sequencing note.** The policy half of this cannot land before R3.2 does, since both rewrite event
and application policies onto `can_act_as`. The schema half (`host_profile_id`, populated on import)
is additive and could land earlier — which is enough for Studio to import correctly, with the policy
cutover following.
