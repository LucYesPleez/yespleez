// §§ 3–5 · The Summary Card
//
// Spec: docs/event-page-layout-spec.md §§ 3–5
//
// ONE card, three divided bands — merged 2026-08-01 from three separate cards
// to the owner's mockup:
//
//   ┌──────────────────────────────────────┐
//   │ 👥 320 Going    │  🎟 Get Tickets    │   band 1 · status
//   ├──────────────────────────────────────┤
//   │ Day into night. Two stages. …        │   band 2 · description
//   ├──────────────────────────────────────┤
//   │ Share │ Add to My Scene │ Website    │   band 3 · utilities
//   └──────────────────────────────────────┘
//
// It sits directly beneath the genre chips, and nothing comes between the
// status band and the description.
//
// ── Why the bands' conditions live here ──────────────────────────────
// Each band still owns its own render rule, but the CARD has to know which of
// them survived: a divider belongs to the band below it, so a hidden band must
// take its divider with it or the card shows a rule with nothing under it.
// React elements are truthy even when the component returns null, so the card
// cannot ask its children — it evaluates the same predicates itself and passes
// the answer down.

import EventDescription from './EventDescription';
import EventQuickActions from './EventQuickActions';
import { TicketIcon } from './eventIcons';
import s from './EventSummary.module.css';

function PeopleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M22 20v-2a4 4 0 0 0-3-3.87" />
    </svg>
  );
}

export default function EventSummaryCard({
  ticketUrl = null,
  attending = null,
  description = '',
  onShare = null,
  onSendToChat = null,
  onAddToScene = null,
  websiteUrl = null,
  sticky = true,
  /* A festival's APPLY, which joins the utility row rather than standing as a
     band of its own. See EventQuickActions' `extra`. */
  extraAction = null,
}) {
  // A count of zero is not an achievement (R3). Absent and zero both show
  // nothing rather than "0 going".
  const showAttendance = typeof attending === 'number' && attending > 0;
  const showTickets = !!ticketUrl;
  const showStatus = showAttendance || showTickets;

  const body = typeof description === 'string' ? description.trim() : '';
  const showDescription = !!body;

  const showActions = !!(onShare || onSendToChat || onAddToScene || websiteUrl || extraAction);

  // R1 · absent. No band survived, so there is no card.
  if (!showStatus && !showDescription && !showActions) return null;

  return (
    <div className={s.summaryCard + (sticky ? ' ' + s.decisionSticky : '')}>
      {showStatus && (
        <div className={`${s.band} ${s.statusRow}`}>
          {showAttendance && (
            <div className={`${s.statusCell} ${s.attendance}`}>
              <PeopleIcon />
              <span><span className={s.attendanceCount}>{attending}</span> going</span>
            </div>
          )}
          {showTickets && (
            <a className={`${s.statusCell} ${s.ticketCell}`}
              href={ticketUrl} target="_blank" rel="noopener noreferrer">
              <TicketIcon size={16} />
              GET TICKETS
            </a>
          )}
        </div>
      )}

      {showDescription && (
        <div className={`${s.band} ${s.descriptionBand}`}>
          <EventDescription text={body} />
        </div>
      )}

      {showActions && (
        <div className={s.band}>
          <EventQuickActions
            onShare={onShare}
            onSendToChat={onSendToChat}
            onAddToScene={onAddToScene}
            websiteUrl={websiteUrl}
            extra={extraAction}
          />
        </div>
      )}
    </div>
  );
}
