import { useState } from 'react';
import { Button, EmptyState } from '../design-system';
import { INSPECTOR_TABS, getTab } from './tabs/registry';
import InspectorTabs from './InspectorTabs';
import ProfileHeader from './ProfileHeader';
import ActionButtons from './ActionButtons';
import { useInspectorWidth } from './useInspectorWidth';
import s from './InspectorPanel.module.css';

/**
 * THE PRIMARY DETAIL WORKSPACE — permanently docked, never a drawer.
 *
 * Structure, top to bottom:
 *   eyebrow · ProfileHeader · ActionButtons · InspectorTabs · tab body
 *
 * Only the tab body scrolls. Identity and the decision row are fixed, so a
 * reviewer can never scroll away from whose application they are about to
 * accept — and the four decision buttons never move between applications.
 *
 * ⭐ The panel KEEPS ITS WIDTH when nothing is selected. A dock that appears
 * and disappears makes the table reflow on every click, which is the most
 * disorienting thing a three-pane workspace can do. Empty is a designed
 * state, not an absent one.
 *
 * ⭐ Tabs come from the registry. Adding one later touches `tabs/registry.jsx`
 * and nothing in this file.
 */
export default function InspectorPanel({ selection, onClose }) {
  const [tabKey, setTabKey] = useState('profile');
  const tab = getTab(tabKey);
  const TabBody = tab.Component;
  const resize = useInspectorWidth();

  return (
    <aside className={s.panel} aria-label="Applicant inspector">
      {/* A separator, not decoration — so it is reachable by keyboard and
          announces its range. A drag handle nobody can tab to is not a
          control. */}
      <button
        type="button"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector"
        aria-valuenow={resize.width}
        aria-valuemin={resize.min}
        aria-valuemax={resize.max}
        className={`${s.grip} ${resize.dragging ? s.gripping : ''}`}
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.reset}
        onKeyDown={resize.onKeyDown}
      />

      <div className={s.head}>
        <span className={s.eyebrow}>{selection ? 'Applicant' : 'Inspector'}</span>
        {selection && (
          <Button variant="ghost" size="sm" icon="close" onClick={onClose} aria-label="Clear selection" />
        )}
      </div>

      {!selection ? (
        <EmptyState
          icon="inbox"
          title="Nothing selected"
          body="Choose an application from the table to review it here."
        />
      ) : (
        <>
          <div className={s.identity}>
            <ProfileHeader selection={selection} />
          </div>

          <div className={s.actions}>
            <ActionButtons />
          </div>

          <InspectorTabs tabs={INSPECTOR_TABS} active={tab.key} onChange={setTabKey} />

          <div
            className={s.content}
            role="tabpanel"
            id={`inspector-panel-${tab.key}`}
            aria-labelledby={`inspector-tab-${tab.key}`}
          >
            <TabBody selection={selection} />
          </div>
        </>
      )}
    </aside>
  );
}
