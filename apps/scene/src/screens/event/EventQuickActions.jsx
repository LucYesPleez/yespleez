// § 5 · Quick Actions
//
// Spec: docs/event-page-layout-spec.md § 5
//
// Utilities, evenly weighted, NO PRIMARY among them. These are post-decision
// actions — people share an event after deciding it matters.
//
// This renders the CONTENT of the summary card's third band, not a card of its
// own: EventSummaryCard supplies the border, the fill and the divider above.
// Rendering it standalone gives an unbordered row, which is intentional.

import { ShareIcon, SendIcon, SceneIcon, GlobeIcon } from './eventIcons';
import s from './EventSections.module.css';

export default function EventQuickActions({
  onShare = null,
  onSendToChat = null,
  onAddToScene = null,
  websiteUrl = null,
  /**
   * ⭐ `extra` — a festival's APPLY (owner, 2026-08-26), which renders itself
   * with this row's own `.quickAction` class so it cannot drift from the
   * others. ⚠ It may render a FRAGMENT whose second child is a full-width
   * disclosure panel; `.quickActions` wraps so that panel takes its own line
   * beneath the row. ⛔ Do not wrap this in a div — it would become one flex
   * cell containing both, and the panel would be squeezed into the row.
   */
  extra = null,
}) {
  // Share never depends on event data — there is always something to share.
  const actions = [];

  if (onShare) actions.push({ key: 'share', label: 'SHARE', Icon: ShareIcon, onClick: onShare });

  /**
   * SEND — into a YesPleez conversation, as an event card.
   *
   * ⭐ A SEPARATE ACTION FROM SHARE, NOT A ROW INSIDE IT. They are different
   * acts with different destinations: SHARE sends people OUT of the app with a
   * link, this one keeps it in and arrives as something the recipient can act
   * on. Folding it into SHARE would bury the in-app path behind the one that
   * leaves.
   *
   * ⚠ Absent, not disabled, when the caller has nobody to send to — a signed-
   * out reader has no conversations, and a control that admits it is dead is
   * still a dead control (R3).
   */
  if (onSendToChat) {
    actions.push({ key: 'send', label: 'SEND', Icon: SendIcon, onClick: onSendToChat });
  }

  // "MY SCENE", not "ADD TO MY SCENE" — the long form measured 108px in a
  // 108px cell, fitting with zero margin, so any font fallback or a narrower
  // column would have clipped it. The "add" is carried by the icon, which is
  // already a plus; spelling it in the label too would say it twice.
  if (onAddToScene) {
    actions.push({ key: 'scene', label: 'MY SCENE', Icon: SceneIcon, onClick: onAddToScene });
  }

  // A genuine event or organiser URL only. A discovery provenance URL belongs
  // in § 11, where it is labelled as a source rather than offered as the
  // event's own site.
  if (websiteUrl) actions.push({ key: 'web', label: 'WEBSITE', Icon: GlobeIcon, href: websiteUrl });

  if (!actions.length && !extra) return null;

  return (
    <div className={`${s.quickActions} ${extra ? s.quickActionsWithPanel : ''}`}>
      {/* size 15 matches the icons in the status row above. */}
      {actions.map(({ key, label, Icon, onClick, href }) =>
        href ? (
          <a key={key} className={s.quickAction} href={href} target="_blank" rel="noopener noreferrer">
            <Icon size={15} /> {label}
          </a>
        ) : (
          <button key={key} className={s.quickAction} onClick={onClick}>
            <Icon size={15} /> {label}
          </button>
        )
      )}
      {extra}
    </div>
  );
}
