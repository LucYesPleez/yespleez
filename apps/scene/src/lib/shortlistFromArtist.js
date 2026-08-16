/**
 * AN ARTIST YOU FOUND, ADDED TO THE SHORTLIST — the second entry point.
 *
 * ⭐⭐ THE FUNNEL HAS TWO WAYS IN (ratified 2026-08-16):
 *
 *     application ──→ PIPELINE ⇄ SHORTLIST ──→ LINEUP ⇄ SET TIMES
 *                                   ↑
 *     direct artist ────────────────┘
 *
 * Until now only the first existed. An artist you discovered, played last
 * month, or were recommended could not be put on the list of people you are
 * thinking about — there was nowhere to put them but the bill.
 *
 * ⛔⛔ IT DOES NOT FABRICATE AN APPLICATION. An `applications` row means THIS
 * ARTIST ASKED TO PLAY. Writing one on their behalf so they show up in a tab
 * would put words in their mouth and corrupt every count, notification and
 * audit that reads the table. The shortlist is a `lineup_members` row with
 * `status='shortlisted'`, which says exactly what is true: the host has
 * attached this artist to this event, and has not booked them.
 *
 * ⛔ NO NOTIFICATION. Q3: joining a bill is private, and being CONSIDERED is
 * quieter still. Nothing is said to an artist until a decision reaches them.
 *
 * ⛔ NO PERFORMANCE. Being considered is not being booked, and being booked is
 * not being given a time.
 */

/**
 * ⭐⭐ WHO CAN BE ON A BILL — the one definition (2026-08-16).
 *
 * ⛔⛔ A POSITIVE LIST, ⛔ NOT A `neq` CHAIN. The shortlist search shipped
 * excluding only `punter`, so venues, hosts and festivals were all offered as
 * bookable acts — the owner saw Bellingen Shire Council and the Memorial Hall
 * in a list headed ADD ARTIST. An exclusion list is wrong by default: every
 * profile type added later joins bills silently until somebody notices. This is
 * the same trap as `.neq('status','removed')` on `lineup_members`, one table
 * over.
 *
 * ⚠ `festival` IS EXCLUDED. It is an organisation that runs events, not an act
 * that plays them — the same reason `host` and `venue` are out.
 */
export const BOOKABLE_ACT_TYPES = ['artist', 'band', 'standup'];

export function isBookableAct(profile) {
  return BOOKABLE_ACT_TYPES.includes(String(profile?.type || '').toLowerCase());
}

/**
 * Is this artist already attached to this event, in any state?
 *
 * ⚠⚠ ANY STATE — `shortlisted`, `on_bill`, AND `removed`. Adding somebody who
 * is already on the bill must not silently create a second row, and adding
 * somebody previously removed must not either: `lineup_members` has NO
 * uniqueness constraint, so a guard like this is the only thing standing
 * between a double-tap and a duplicate. That is not hypothetical — a missing
 * guard put eight junk rows into production on 2026-08-15.
 *
 * ⭐ Matched on the PROFILE first, then the account. A picked search result
 * always has a profile id; `artist_id` is the legacy key and is null for the
 * many profiles with no user behind them.
 */
export function findArtistOnEvent(profile, members = []) {
  if (!profile) return null;
  return (members || []).find(m =>
    (profile.id && m.artist_profile_id === profile.id) ||
    (profile.user_id && m.artist_id === profile.user_id),
  ) || null;
}

/**
 * @returns {{ok:false, reason:string, existing?:object}}
 *        | {{ok:true, member:object}}
 */
export function planAddArtistToShortlist(profile, eventId, members = []) {
  if (!eventId) return { ok: false, reason: 'no event' };
  /* ⛔ A PICKED RESULT MUST CARRY A PROFILE ID. This entry point exists to
     attach a REAL artist; a nameless or idless pick is the anonymous-row case
     that caused the incident, and it cannot arise from a search result unless
     something upstream is broken. Refused rather than coerced. */
  if (!profile?.id) return { ok: false, reason: 'that artist has no profile to attach' };
  /* ⛔ THE PLANNER REFUSES IT TOO, not just the search that offers it. A picker
     filtering its query is a convenience; this is the rule. Two surfaces now
     call this, and a third would otherwise have to remember. */
  if (!isBookableAct(profile)) {
    return { ok: false, reason: `${profile.name || 'That profile'} is a ${String(profile.type || 'profile').toLowerCase()}, not an act you can put on a bill.` };
  }

  const existing = findArtistOnEvent(profile, members);
  if (existing) {
    return {
      ok: false,
      existing,
      /* ⚠ The message names WHERE they already are, because "already added" on
         an event where they are on the bill reads as a bug rather than as an
         answer. */
      reason: existing.status === 'on_bill'
        ? 'They are already on the lineup for this event.'
        : existing.status === 'shortlisted'
          ? 'They are already on the shortlist for this event.'
          : 'They were on this event before and were removed. Restore them instead of adding a second row.',
    };
  }

  return {
    ok: true,
    member: {
      event_id:          eventId,
      /* ⚠ `artist_id` is the ACCOUNT and is legitimately null — most profiles
         have no user behind them. `artist_profile_id` is the real reference. */
      artist_id:         profile.user_id || null,
      artist_profile_id: profile.id,
      artist_name:       profile.name || null,
      sound:             profile.sound || null,
      genre:             profile.genre_string || null,
      status:            'shortlisted',
    },
  };
}

/**
 * @param db    supabase client
 * @param plan  from planAddArtistToShortlist
 */
export async function addArtistToShortlist(db, plan) {
  if (!plan?.ok) return { ok: false, error: plan?.reason || 'nothing to do', memberId: null };
  const { data, error } = await db.from('lineup_members')
    .insert(plan.member).select('id').single();
  /* ⚠ SURFACED, NEVER SWALLOWED. An INSERT blocked by RLS fails loudly (42501)
     while an UPDATE fails silently — reporting it is what makes a policy
     regression visible instead of looking like a button that does nothing. */
  if (error) return { ok: false, error: error.message, memberId: null };
  return { ok: true, error: null, memberId: data?.id ?? null };
}
