// EP-00d · THE PUBLIC EVENT PAGE.
//
// This is the surface the redesign targets. Given an event and its lineup it
// renders the whole punter experience and needs nothing else — `host` is
// optional, and when it is absent every host conditional below collapses to the
// punter path. That is the boundary EP-00 existed to create: a visual change
// here cannot reach the editor.
//
// `hostChrome` and `overlays` are the two injection points the host view uses
// to keep the shipped DOM order exactly as it was: chrome sits between the
// apply bar and the ticket button, overlays are siblings of .content inside
// .screen. They are null for everyone else.
import ApplyButton from './ApplyButton';
import FestivalApply from './FestivalApply';
import { applicationsBelongToFestival } from '../../lib/festivalPortal';
import DaySlots from './DaySlots';
import { formatDateRange } from '../../lib/dates';
import s from '../EventScreen.module.css';

export default function EventPublicView({
  id, event, cfg, poster, posterFull, genres, isPast,
  claims, days, showTimesPublicly, totalSlots, takenSlots,
  userId, isGuest, ownerProfile,
  host = null, hostChrome = null, overlays = null,
}) {
  // Host state, read once. A punter has none of it, and every conditional
  // below then reduces to its punter branch — which is what makes this
  // component renderable on its own.
  const effectiveIsHost = !!host?.effectiveIsHost;
  const showEditor      = !!host?.showEditor;
  const eventTab        = host?.eventTab ?? null;

  // The shipped conditionals, unchanged. `bodyVisible` is the host editor
  // hiding the punter footer on every tab except SET TIMES.
  const bodyVisible = !effectiveIsHost || !showEditor || eventTab === 'SET_TIMES';
  const daysVisible = (effectiveIsHost || showTimesPublicly) && bodyVisible;

  const allMixSlots = days.flatMap(d => (d.slots || [])
    .filter(sl => claims[sl.id]?.mix_link && claims[sl.id]?.status === 'confirmed')
    .map(sl => ({ url: claims[sl.id].mix_link, artistName: claims[sl.id].name }))
  );

  return (
    <div className={s.screen}>
      {poster && <div className={s.heroBg} style={{ backgroundImage: `url(${posterFull})` }} />}
      <div className={s.heroBgDark} />
      <div className={s.heroBgFade} />

      <div className={s.content}>
        {/* Poster */}
        {poster && (
          <div className={s.posterWrap}>
            <img className={s.poster} src={posterFull} alt={event.name} />
          </div>
        )}

        {/* Header */}
        <header className={s.header}>
          <h1 className={s.eventTitle}>{event.name}</h1>
          {(cfg.date || cfg.venue) && (
            <div className={s.eventMeta}>
              {cfg.date && formatDateRange(cfg.date, cfg.endDate)}
              {cfg.date && cfg.venue && '  ·  '}
              {cfg.venue}
            </div>
          )}
          {genres && <div className={s.eventGenres}>{genres}</div>}
        </header>

        {/* Sync bar */}
        <div className={s.syncBar}>
          <div className={s.syncDot + (!isPast && event.status === 'live' ? ' ' + s.syncDotLive : '')} />
          <span>{isPast ? 'PAST EVENT' : event.status === 'live' ? 'LIVE NOW' : 'NOT LIVE'}</span>
        </div>

        {/* Apply bar — non-host, applications open.
            ⛔ A FESTIVAL'S EVENT NEVER GETS SCENE'S APPLY UI. Scene writes
            `applications`; the Portal reads `festival_applications`. Rendering
            both would let someone apply into a table the organiser's dashboard
            never reads, with no error to show for it. See lib/festivalPortal. */}
        {!effectiveIsHost && !isGuest && event.applications_open && (
          applicationsBelongToFestival(ownerProfile)
            ? <FestivalApply eventId={id} userId={userId} festivalName={ownerProfile?.name} />
            : <ApplyButton eventId={id} userId={userId} ownerProfile={ownerProfile} />
        )}

        {hostChrome}

        {cfg.ticketLink && (
          <a href={cfg.ticketLink} target="_blank" rel="noopener noreferrer" className={s.ticketBtn}>
            🎟 BUY TICKETS
          </a>
        )}

        {/* Coming soon — punter view, set times enabled but not yet announced */}
        {!effectiveIsHost && !showTimesPublicly && totalSlots > 0 && (
          <div style={{ textAlign: 'center', padding: '48px 16px' }}>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 22, letterSpacing: 3, color: 'rgba(255,255,255,.28)', marginBottom: 8 }}>SET TIMES COMING SOON</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.2)' }}>Stay tuned for the lineup.</div>
          </div>
        )}

        {daysVisible && (
          <DaySlots
            eventId={id}
            days={days}
            claims={claims}
            allMixSlots={allMixSlots}
            isHost={effectiveIsHost}
            editable={effectiveIsHost && showEditor}
            isLocked={!!host?.isLocked}
            onFill={host?.onFill}
            onEdit={host?.onEdit}
            onRemove={host?.onRemove}
            onPin={host?.onPin}
          />
        )}

        {bodyVisible && <>
        {/* Tally — only visible when set times are public or host is viewing */}
        {(effectiveIsHost || showTimesPublicly) && totalSlots > 0 && (
          <div className={s.tally}>
            <strong>{takenSlots}</strong> of <strong>{totalSlots}</strong> slots filled
          </div>
        )}

        {/* About */}
        {cfg.bio && (
          <div className={s.infoCard}>
            <div className={s.infoLabel}>ABOUT</div>
            <div className={s.infoText}>{cfg.bio}</div>
          </div>
        )}

        {/* Location */}
        {cfg.location && (
          <div className={s.infoCard}>
            <div className={s.infoLabel}>LOCATION</div>
            <div className={s.infoText}>{cfg.location}</div>
          </div>
        )}
        </>}
      </div>

      {overlays}
    </div>
  );
}
