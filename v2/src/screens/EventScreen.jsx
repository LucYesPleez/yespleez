// EP-00d · route entry for /event/:id.
//
// Loads the event, handles the three non-page outcomes (demo id, loading, gone),
// then branches: the owner gets the management surface, everyone else gets the
// public page directly. This file no longer knows what either one looks like.
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
import DaySlots from './event/DaySlots';
import EventHostView from './event/EventHostView';
import s from './EventScreen.module.css';

export default function EventScreen() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const { session, isGuest } = useSession();
  const isRealEvent = EVENT_ID_RE.test(id);

  const d = useEventData(id, navigate);
  const { event } = d;

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
    showTimesPublicly: d.showTimesPublicly,
    totalSlots: d.totalSlots, takenSlots: d.takenSlots,
    ownerProfile: d.ownerProfile, venueProfile: d.venueProfile, isGuest,
  };

  if (session?.user?.id === event.host_id) {
    return (
      <EventHostView
        {...common}
        session={session}
        lineupMembers={d.lineupMembers}
        memberPerfMap={d.memberPerfMap}
        memberProfiles={d.memberProfiles}
        lineupPct={d.lineupPct}
        isLocked={d.isLocked}
        draftCount={d.draftCount}
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
  const canApply = !isGuest && !!event.applications_open && !!session?.user?.id;

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

  // Mixes attached to confirmed slots, for the set-times player. Lifted from
  // EventPublicView, where it was computed for exactly this.
  const allMixSlots = d.days.flatMap(day => (day.slots || [])
    .filter(sl => d.claims[sl.id]?.mix_link && d.claims[sl.id]?.status === 'confirmed')
    .map(sl => ({ url: d.claims[sl.id].mix_link, artistName: d.claims[sl.id].name })));

  return (
    <EventPage
      event={event}
      ownerProfile={d.ownerProfile}
      coHostProfiles={d.coHostProfiles}
      venueProfile={d.venueProfile}
      lineupMembers={d.lineupMembers}
      memberProfiles={d.memberProfiles}
      favourited={like.liked}
      onToggleFavourite={like.toggleLike}
      canFavourite={!!session?.user?.id && !isGuest}
      applyAction={applyAction}
      setTimes={d.showTimesPublicly && d.totalSlots > 0
        ? <DaySlots
            eventId={id}
            days={d.days}
            claims={d.claims}
            allMixSlots={allMixSlots}
            isHost={false}
            editable={false}
          />
        : null}
    />
  );
}
