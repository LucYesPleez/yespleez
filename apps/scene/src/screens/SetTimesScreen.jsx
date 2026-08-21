import { useParams, useNavigate, Link } from 'react-router-dom';
import { useShareTarget, shareUrl } from '../lib/shareTarget';
import Skeleton from '../components/Skeleton';
import { useEventData, EVENT_ID_RE } from './event/useEventData';
import SchedulePortrait from './event/SchedulePortrait';
import { formatDisplayDate } from '../lib/dates';

/**
 * `/event/:id/set-times` — THE RUNNING ORDER, ON ITS OWN.
 *
 * ⭐⭐ WHY THIS IS A ROUTE AND NOT A SCROLL POSITION. It is the destination of
 * the Set Times QR, which is a different printed object from the Event QR: one
 * is taped by the door on the night and answers "what is on now", the other is
 * on the poster three weeks out and answers "what is this". A person standing
 * in the room at 9pm should get the timetable, not a hero image and a scroll.
 *
 * ⛔ IT DUPLICATES NOTHING. The schedule is resolved once by `useEventData`
 * (S2/S3) and drawn by the same `SchedulePortrait` the event page uses, with
 * the same interactive `SlotCard`s. This screen is a frame around it: who,
 * when, and a way back to the full event page.
 *
 * ── ⚠ THE GATE IS THE ORGANISER'S, AND IT IS HONOURED HERE ────────────
 *
 * Set times are public only when `showTimesPublicly` is set AND slots exist. A
 * bill may be announced with the running order still under wraps, and this
 * route must not become a way around that.
 *
 * ⭐ WHAT IT SHOWS INSTEAD IS THE WHOLE POINT OF THE RENDERING CONTRACT:
 * withheld and absent are different, and both are said out loud. A code printed
 * on Tuesday for a running order published on Friday must explain itself in
 * between, ⛔ never show a blank page or bounce the reader home.
 */
export default function SetTimesScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isRealEvent = EVENT_ID_RE.test(id);
  const d = useEventData(isRealEvent ? id : null, navigate);
  const { event } = d;

  useShareTarget(event ? {
    type: 'event',
    title: `${event.name} set times`,
    url: shareUrl(`/event/${event.id ?? id}/set-times`),
    access: 'public',
    qr: { type: 'set-times', id: event.id ?? id },
  } : null);

  if (!isRealEvent) { navigate('/'); return null; }

  if (d.loading) {
    return (
      <div style={{ padding: '72px 16px 80px', maxWidth: 680, margin: '0 auto' }}>
        <Skeleton width="60%" height={30} style={{ marginBottom: 10 }} />
        <Skeleton width="40%" height={14} style={{ marginBottom: 28 }} />
        <Skeleton height={92} radius={12} style={{ marginBottom: 10 }} />
        <Skeleton height={92} radius={12} style={{ marginBottom: 10 }} />
        <Skeleton height={92} radius={12} />
      </div>
    );
  }
  if (!event) return null;

  const published = d.showTimesPublicly && d.totalSlots > 0;
  const dateLine = [
    event.config?.date ? formatDisplayDate(event.config.date) : null,
    d.venueProfile?.name || event.config?.venue || null,
  ].filter(Boolean).join(' · ');

  return (
    <div style={{ padding: '68px 16px 96px', maxWidth: 680, margin: '0 auto', boxSizing: 'border-box' }}>
      <header style={{ marginBottom: 20 }}>
        <div style={{
          fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: 3,
          color: 'var(--muted)', marginBottom: 4,
        }}>
          SET TIMES
        </div>
        {/* ⚠ font-weight 400: Bebas Neue has one weight and an h1 faux-bolds it
            out of step with every other title in the app. */}
        <h1 style={{
          fontFamily: "'Bebas Neue', sans-serif", fontWeight: 400, fontSize: 34,
          letterSpacing: 1, lineHeight: 1.02, margin: 0, textWrap: 'balance',
        }}>
          {event.name}
        </h1>
        {dateLine && (
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>{dateLine}</div>
        )}
      </header>

      {published ? (
        <SchedulePortrait resolved={d.schedule} />
      ) : (
        <div style={{
          border: '1px solid var(--border)', borderRadius: 14, padding: '26px 20px',
          background: 'rgba(255,255,255,.03)', textAlign: 'center',
        }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 19, letterSpacing: 1.6, marginBottom: 8 }}>
            {d.totalSlots > 0 ? 'NOT PUBLISHED YET' : 'NO RUNNING ORDER YET'}
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.65, margin: 0 }}>
            {d.totalSlots > 0
              ? 'The organiser has not published the running order yet. This code will show it as soon as they do, so it is worth checking again closer to the night.'
              : 'Set times for this event have not been put together yet. This code will show them once they are.'}
          </p>
        </div>
      )}

      <div style={{ marginTop: 26, textAlign: 'center' }}>
        <Link
          to={`/event/${id}`}
          style={{
            display: 'inline-block', padding: '11px 22px', borderRadius: 10,
            border: '1px solid var(--border)', background: 'rgba(255,255,255,.06)',
            color: 'var(--text)', textDecoration: 'none',
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: 1.8,
          }}
        >
          FULL EVENT PAGE
        </Link>
      </div>
    </div>
  );
}
