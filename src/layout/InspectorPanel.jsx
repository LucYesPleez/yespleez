import { useState } from 'react';
import Icon from '../components/Icon';
import InspectorTabs from './InspectorTabs';
import Placeholder from '../components/Placeholder';
import s from './InspectorPanel.module.css';

const TABS = [
  { key: 'profile',     label: 'Profile' },
  { key: 'application', label: 'Application' },
  { key: 'media',       label: 'Media' },
  { key: 'notes',       label: 'Notes' },
  { key: 'activity',    label: 'Activity' },
];

/**
 * The right-hand dock — where reviewing actually happens.
 *
 * Holds only the tab it is showing. No selection state, no data: the shell's
 * job is to prove the geometry works, and every tab body is a Placeholder
 * that future work replaces one at a time without touching this file.
 *
 * The panel keeps its width when nothing is selected. A dock that appears and
 * disappears makes the table reflow on every click, which is the single most
 * disorienting thing a three-pane workspace can do.
 */
export default function InspectorPanel({ selection, onClose }) {
  const [tab, setTab] = useState('profile');

  return (
    <div className={s.wrap}>
      <aside className={s.panel} aria-label="Applicant inspector">
        <div className={s.grip} aria-hidden="true" />

        <div className={s.header}>
          <span className={s.heading}>Applicant</span>
          {selection && (
            <button className={s.closeBtn} type="button" onClick={onClose} aria-label="Close inspector">
              <Icon name="close" size={16} />
            </button>
          )}
        </div>

        {!selection ? (
          <div className={s.empty}>
            <span className={s.emptyTitle}>Nothing selected</span>
            <span className={s.emptyBody}>
              Choose an application from the list to review it here.
            </span>
          </div>
        ) : (
          <>
            <div className={s.identity}>
              <div className={s.avatar} />
              <div>
                <div className={s.name}>{selection.name}</div>
                <div className={s.sub}>{selection.location}</div>
              </div>
            </div>

            <div className={s.actions}>
              <button className={s.action} type="button">
                <Icon name="messages" size={14} /> Message
              </button>
              <button className={`${s.action} ${s.shortlist}`} type="button">
                <Icon name="star" size={14} /> Shortlist
              </button>
              <button className={`${s.action} ${s.accept}`} type="button">
                <Icon name="check" size={14} /> Accept
              </button>
              <button className={`${s.action} ${s.reject}`} type="button">
                <Icon name="cross" size={14} /> Decline
              </button>
            </div>

            <InspectorTabs tabs={TABS} active={tab} onChange={setTab} />

            <div className={s.content} role="tabpanel">
              <Placeholder
                title={TABS.find(t => t.key === tab)?.label}
                lines={tab === 'notes' || tab === 'activity' ? 3 : 5}
              />
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
