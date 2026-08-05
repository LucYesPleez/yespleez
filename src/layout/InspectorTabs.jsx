import s from './InspectorTabs.module.css';

/**
 * Controlled tab strip. Presentation only — it owns no state, so the panel
 * (or later, a route) decides what is selected and nothing has to be kept in
 * sync in two places.
 */
export default function InspectorTabs({ tabs, active, onChange }) {
  return (
    <div className={s.tabs} role="tablist">
      {tabs.map(tab => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={tab.key === active}
          className={[s.tab, tab.key === active && s.active].filter(Boolean).join(' ')}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
