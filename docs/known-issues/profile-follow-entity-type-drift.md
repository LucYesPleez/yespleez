# `follows.entity_type = 'profile'` silently rejected — ProfileScreen follow never succeeds for single-profile accounts

**Severity:** High — the primary "Follow this profile" action from `ProfileScreen.jsx` has likely never worked, for any account, and fails silently (no error shown to the user).
**Status:** Open. Discovered incidentally during M2 dual-write verification (2026-07-11). Out of scope for M2 — not fixed, logged only.
**Not part of the identity migration.** M2 only added a `target_profile_id` column to the existing insert; it did not touch `entity_type` and does not cause this.

## Summary

`ProfileScreen.jsx`'s `doFollow()` inserts into `follows` with `entity_type: 'profile'` (a generic literal, not the profile's actual type such as `'artist'`/`'venue'`). A direct authenticated REST insert reproducing this exact payload (with or without M2's new `target_profile_id` column) fails:

```
23514: new row for relation "follows" violates check constraint "follows_entity_type_check"
```

A live census of the `follows` table (2026-07-11) confirms this is not hypothetical — every existing row has `entity_type` of `'artist'` or `'venue'`; **zero rows have ever had `entity_type = 'profile'`**, across the table's entire history.

## Why this went unnoticed

`doFollow()` does not check the `.error` field on the insert:

```js
await Promise.all(ids.map(uid =>
  supabase.from('follows').insert({ user_id: uid, entity_id: id, entity_type: 'profile', entity_name: profile.name })
));
```

The button optimistically flips to "FOLLOWING" regardless of whether the insert succeeded, so the failure is invisible in the UI — the same "silent no-op" pattern found in the notifications schema-drift bug earlier this sprint (`docs/known-issues/notifications-schema-drift.md`).

## Relationship to the other follow-picker bug

This is **distinct** from the bug logged in `docs/m2-design-review-2026-07.md` §1.6 (the multi-profile follow picker passing `p.type` strings into a `user_id` UUID column). That bug affects only accounts with more than one profile (e.g. Lucious, who owns 5). This bug affects **every** account, including single-profile ones, because `entity_type: 'profile'` is hardcoded on the single path too (`doFollow(session.user.id)`, no picker). Between the two bugs, the ProfileScreen follow button appears to have never successfully recorded a follow for any account, in any configuration.

## Investigation checklist

- [ ] Confirm the check constraint's exact allowed values (`pg_get_constraintdef` via SQL editor — not visible through REST).
- [ ] Decide the correct `entity_type` for a profile follow — likely the profile's own `type` (`artist`/`venue`/`host`/`band`/`standup`), matching how `EventScreen.jsx`'s artist-follow site already does it (`entity_type: 'artist'`), rather than a generic `'profile'` literal.
- [ ] Add `.error` handling to `doFollow()` so future failures surface instead of failing silently.
- [ ] Verify end-to-end once fixed: follow a profile from a single-profile account, confirm the row is created, confirm the follow appears in "My Scene" / following lists.

## Related

Fourth instance of the schema-drift-with-silent-failure pattern found this sprint, after `applications`, `notifications`, and `venue_enquiries`. Reinforces the case (already noted in the `venue_enquiries` doc) for a systematic schema-vs-code audit across every table rather than continuing to find these one at a time.
