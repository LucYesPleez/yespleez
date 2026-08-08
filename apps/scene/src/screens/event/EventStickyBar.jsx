// Sticky Action Bar — MOBILE ONLY.
//
// Spec: docs/event-page-layout-spec.md § Sticky Action Bar
//
// It exists because the CTA scrolls away on mobile. On desktop it does not have
// to, so the Decision block goes sticky within its own column instead and this
// never renders there — solving a mobile constraint with permanent desktop
// chrome is the most common responsive mistake and it costs real reading space.
//
// Two actions maximum, and the secondary must earn its place: a sticky bar plus
// the bottom nav is already ~17% of an 812px screen.
//
// ⚠ R3 · never a disabled primary. With no ticket link the next available
// action is PROMOTED to fill the bar rather than the slot sitting empty or
// greyed out. The bar hides entirely when nothing survives.

import { TicketIcon, HeartIcon, ShareIcon } from './eventIcons';
import s from './EventSections.module.css';

export default function EventStickyBar({
  ticketUrl = null,
  favourited = false,
  onToggleFavourite = null,
  onShare = null,
}) {
  // Promotion order. The first available action takes the primary slot; the
  // Favourite takes the secondary only when it did not already take the first.
  if (ticketUrl) {
    return (
      <div className={s.sticky}>
        <a className={s.stickyPrimary} href={ticketUrl} target="_blank" rel="noopener noreferrer">
          <TicketIcon size={17} /> GET TICKETS
        </a>
        {onToggleFavourite && (
          <button className={s.stickySecondary} onClick={onToggleFavourite} aria-pressed={favourited}>
            <HeartIcon size={15} filled={favourited} /> {favourited ? 'SAVED' : 'SAVE'}
          </button>
        )}
      </div>
    );
  }

  if (onToggleFavourite) {
    return (
      <div className={s.sticky}>
        <button className={`${s.stickyPrimary} ${s.stickySolo}`} onClick={onToggleFavourite} aria-pressed={favourited}>
          <HeartIcon size={17} filled={favourited} /> {favourited ? 'SAVED' : 'SAVE EVENT'}
        </button>
      </div>
    );
  }

  if (onShare) {
    return (
      <div className={s.sticky}>
        <button className={`${s.stickyPrimary} ${s.stickySolo}`} onClick={onShare}>
          <ShareIcon size={17} /> SHARE
        </button>
      </div>
    );
  }

  return null;
}
