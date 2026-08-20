// EP-00d · route entry for /event/:id.
//
// Loads the event, handles the three non-page outcomes (demo id, loading, gone),
// then branches: the owner gets the management surface, everyone else gets the
// public page directly. This file no longer knows what either one looks like.
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSession } from '../App';
import { useShareTarget, shareUrl } from '../lib/shareTarget';
import Skeleton from '../components/Skeleton';
import DemoEventNotice from '../components/DemoEventNotice';
import { getDemoEventById } from '../lib/demoEvents';
import { useEventData, EVENT_ID_RE } from './event/useEventData';
import { useEventLike } from './event/useEventLike';
import EventPage from './event/EventPage';
import ApplyButton from './event/ApplyButton';
import FestivalApply from './event/FestivalApply';
import { applicationsBelongToFestival } from '../lib/festivalPortal';
import SchedulePortrait from './event/SchedulePortrait';
import EventHostView from './event/EventHostView';
import { useParticipation } from '../components/ParticipationGate';
import { isEventManager } from '../lib/eventOwnership';
import { getOwnerProfiles } from '../lib/actingProfile';
import s from './EventScreen.module.css';

export default function EventScreen() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const { session } = useSession();
  const requestParticipation = useParticipation();
  const isRealEvent = EVENT_ID_RE.test(id);

  const d = useEventData(id, navigate);
  const { event } = d;

  /**
   * The profiles this account owns, for the management gate below.
   *
   * ⚠⚠ DECLARED HERE, ABOVE EVERY EARLY RETURN. This screen returns early for
   * the loading skeleton and again for a missing event; a `useState` below
   * either one mispairs the whole hook list the moment the condition flips.
   * That exact mistake shipped twice during the onboarding work and neither
   * time did a passing test suite notice.
   *
   * ⛔ An empty list is "not a manager", never "manager by default" — a failed
   * lookup must lose the buttons, not hand them out.
   */
  const [ownedProfileIds, setOwnedProfileIds] = useState([]);
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) { setOwnedProfileIds([]); return undefined; }
    let cancelled = false;
    getOwnerProfiles(uid).then(list => {
      if (!cancelled) setOwnedProfileIds((list || []).map(p => p.id));
    });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  // Resource-driven share (navigation & sharing architecture). This screen
  // declares its own canonical payload; the header's Share button stays
  // generic and needs no knowledge of events. The URL is built from the
  // event id rather than window.location.href, so the link is canonical
  // regardless of how the visitor arrived.
  useShareTarget(event ? {
    type:    'event',
    title:   event.name,
    url:     shareUrl(`/event/${event.id ?? id}`),
    preview: event.blurb || event.description || undefined,
    access:  'public',
  } : null);

  // EP-01: the heart is now REACHED. `toggleLike` was written for this and had
  // no caller — the return value was discarded here and no control rendered it.
  const like = useEventLike({ id, event, userId: session?.user?.id, isRealEvent });

  // Demo ids (e.g. from a bookmarked What's On card) have no Supabase record —
  // explain that instead of the query silently redirecting home. Once real
  // event data uses this same id space (UUIDs), isRealEvent is true and this
  // never fires. An unrecognised non-UUID id (neither real nor a known demo
  // event) still falls back to home, same as before.
  if (!isRealEvent) {
    const demoEvent = getDemoEventById(id);
    if (!demoEvent) { navigate('/'); return null; }
    return <DemoEventNotice event={demoEvent} onClose={() => navigate('/')} />;
  }

  if (d.loading) return (
    <div className={s.screen} style={{ padding: '72px 16px 80px', maxWidth: 680, margin: '0 auto', boxSizing: 'border-box' }}>
      <Skeleton height={280} radius={12} style={{ marginBottom: 16 }} />
      <Skeleton width="70%" height={32} style={{ marginBottom: 10 }} />
      <Skeleton width="45%" height={14} style={{ marginBottom: 24 }} />
      <Skeleton height={14} style={{ marginBottom: 8 }} />
      <Skeleton width="80%" height={14} style={{ marginBottom: 8 }} />
      <Skeleton width="60%" height={14} />
    </div>
  );
  if (!event) return null;

  const common = {
    id, event, cfg: d.cfg,
    poster: d.poster, posterFull: d.posterFull, genres: d.genres, isPast: d.isPast,
    claims: d.claims, days: d.days,
    /* ⭐ The resolved schedule travels with the rest, so the host's
       view-as-punter preview shows the punter's timetable rather than the
       editor's grid. ⛔ Neither surface resolves its own. */
    schedule: d.schedule,
    showTimesPublicly: d.showTimesPublicly,
    totalSlots: d.totalSlots, takenSlots: d.takenSlots, tally: d.tally,
    ownerProfile: d.ownerProfile, venueProfile: d.venueProfile,
  };

  /**
   * ⚠⚠ WAS `session?.user?.id === event.host_id`, which hid the management UI
   * from the owners of 82 of 92 events — every row with a NULL `host_id`. See
   * lib/eventOwnership for the measurement and for why this is a RENDERING
   * gate rather than a permission (RLS re-checks every write behind it).
   */
  if (isEventManager(event, { userId: session?.user?.id, ownedProfileIds })) {
    return (
      <EventHostView
        {...common}
        claimsBySlot={d.claimsBySlot}
        session={session}
        lineupMembers={d.lineupMembers}
      shortlistMembers={d.shortlistMembers}
        perfsByMember={d.perfsByMember}
        memberProfiles={d.memberProfiles}
        lineupPct={d.lineupPct}
        isLocked={d.isLocked}
      />
    );
  }

  // EP-01 · /event/:id now serves the redesigned page. The old markup lives on
  // in EventPublicView, which the host editor still renders — that surface has
  // its own slot grid and chrome and is a separate job.
  //
  // The two features the old public page carried are passed through rather
  // than lost: APPLY TO PLAY, and set times where the organiser has published
  // them. `showTimesPublicly` is the organiser's decision and is honoured here
  // exactly as it was — a bill can be announced with the running order still
  // under wraps.
  // A signed-out visitor cannot apply. This used to also check `!isGuest`,
  // which was redundant even then (a session always cleared the guest flag);
  // with guest-as-a-state deleted, the session IS the whole question.
  const canApply = !!event.applications_open && !!session?.user?.id;

  /**
   * ⛔ ONE APPLICATION PIPELINE. A festival's event hands off to the Festival
   * app rather than offering Scene's own form — Scene writes `applications` and
   * the Portal's dashboard reads `festival_applications`, so showing both would
   * let someone apply into a table no organiser ever opens, silently.
   *
   * ⚠ THIS IS THE SECOND APPLY SURFACE. EventPublicView builds the other one
   * independently, and both must consult the same rule — a fix applied to one
   * of two apply paths is not a fix. festivalPortal.test.js enforces it.
   */
  const applyAction = !canApply ? null
    : applicationsBelongToFestival(d.ownerProfile)
      ? <FestivalApply eventId={id} userId={session.user.id} festivalName={d.ownerProfile?.name} />
      : <ApplyButton eventId={id} userId={session.user.id} ownerProfile={d.ownerProfile} />;

  /* ⭐ THE MIX RAIL SURVIVES THE PROJECTION, because the projection renders the
     app's own `SlotCard` rather than a public card of its own — so the play
     button and its continue-playing list come with it. ⚠ Built from the
     RESOLVED schedule now, ⛔ not from `days`: one source, and it stays right
     for a multi-stage bill where `days[].slots` would flatten the stages. */
  const allMixSlots = (d.schedule?.days || []).flatMap(day =>
    (day.stages || []).flatMap(stage => (stage.slots || [])
      .filter(e => e.claim?.mix_link && e.claim?.status === 'confirmed')
      .map(e => ({ url: e.claim.mix_link, artistName: e.claim.name }))));

  return (
    <EventPage
      event={event}
      ownerProfile={d.ownerProfile}
      coHostProfiles={d.coHostProfiles}
      venueProfile={d.venueProfile}
      lineupMembers={d.lineupMembers}
      shortlistMembers={d.shortlistMembers}
      memberProfiles={d.memberProfiles}
      favourited={like.liked}
      onToggleFavourite={session?.user?.id
        ? like.toggleLike
        : () => requestParticipation('save_event', { context: { eventId: id } })}
      /**
       * ⭐ O2 — the event page heart is THE prime conversion point (owner),
       * so for a signed-out reader it renders and opens the ParticipationGate
       * instead of being absent. R3 ("no dead controls") still holds: the
       * control is live for everyone, it just does the right thing per state.
       * Send-to-chat stays session-only — a guest has no conversations, and
       * messaging is not in O2's scope.
       */
      canFavourite={true}
      canSend={!!session?.user?.id}
      applyAction={applyAction}
      /**
       * ⭐⭐ S3 · SAME CARDS, SAME INTERACTION, NEW DATA SOURCE. The public
       * timetable is a PROJECTION of the resolved schedule that renders the
       * app's own `SlotCard` — ⛔ not a public card, ⛔ not a read-only one.
       * The host's operations are absent because no handlers are passed, which
       * is a different thing from the card being inert: it still expands, the
       * mix still plays, and VIEW PROFILE still reaches the artist.
       *
       * ⚠ `d.schedule` is resolved ONCE in `useEventData` — ⛔ this screen does
       * not group rows for itself. The host editor keeps `DaySlots` and the
       * `[{name, slots}]` shape it has always taken, untouched.
       *
       * ⚠ The gate is unchanged: published set times AND at least one slot. An
       * organiser may announce a bill with the running order still withheld.
       */
      setTimes={d.showTimesPublicly && d.totalSlots > 0
        ? <SchedulePortrait resolved={d.schedule} allMixSlots={allMixSlots} />
        : null}
    />
  );
}
