// § 3 · Event Summary — Decision
//
// Spec: docs/event-page-layout-spec.md § 3
//
// "Can I get in?" — the ticket action, with attendance as context. Contained,
// and sticky within its column on desktop, which is why the desktop sticky
// bar does not exist: the CTA never scrolls away and never takes viewport to
// stay.
//
// The Favourite moved OUT of this block on 2026-08-01, to sit beside the title
// in Identity — it reads as part of the headline now, not as a second action
// competing with the ticket CTA for the same row.
//
// The emphasis rule this block still enforces: the ticket action is an ACTION,
// not a statistic. The reference concept rendered "Tickets · On Sale" as a
// passive tile beside a headcount while the real CTA sat pinned to the bottom
// of the screen. Here it is the strongest interactive element on the page, and
// attendance is supporting context at lower weight — never a peer tile.

import s from './EventSummary.module.css';

function TicketIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4z" />
      <path d="M13 7v2M13 13v2" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M22 20v-2a4 4 0 0 0-3-3.87" />
    </svg>
  );
}

export default function EventDecision({ ticketUrl = null, attending = null, sticky = true }) {
  const hasTickets = !!ticketUrl;

  // A count of zero is not an achievement (R3). Absent and zero both show
  // nothing rather than "0 going".
  const showAttendance = typeof attending === 'number' && attending > 0;

  // R1 · absent. With no ticket link and no attendance to show, this block has
  // nothing to say — the Favourite living in Identity now means an event with
  // neither can still be favourited without this card existing to hold it.
  if (!hasTickets && !showAttendance) return null;

  return (
    <div className={s.decision + (sticky ? ' ' + s.decisionSticky : '')}>
      {hasTickets && (
        <div className={s.actions}>
          <a className={s.primary} href={ticketUrl} target="_blank" rel="noopener noreferrer">
            <TicketIcon />
            GET TICKETS
          </a>
        </div>
      )}

      {showAttendance && (
        <div className={s.attendance}>
          <PeopleIcon />
          <span><span className={s.attendanceCount}>{attending}</span> going</span>
        </div>
      )}
    </div>
  );
}
