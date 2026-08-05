import s from './InspectorTabs.module.css';

/**
 * Controlled tab strip, rendered from the registry.
 *
 * Owns no state. The panel decides what is selected, so there is never a
 * second copy of "which tab is open" to keep in sync — and a future version
 * that puts the tab in the URL changes only the panel.
 */
export default function InspectorTabs({ tabs, active, onChange }) {
  return (
    <div className={s.tabs} role="tablist" aria-label="Applicant detail">
      {tabs.map(tab => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          id={`inspector-tab-${tab.key}`}
          aria-selected={tab.key === active}
          aria-controls={`inspector-panel-${tab.key}`}
          className={[s.tab, tab.key === active && s.active].filter(Boolean).join(' ')}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
