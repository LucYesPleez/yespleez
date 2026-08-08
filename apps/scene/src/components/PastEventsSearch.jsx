import s from './PastEventsSearch.module.css';

// Communal Past Events filter/search — the same lightweight substring-match
// pattern already used elsewhere in the app (ArtistDashboard's enquiry
// search: JSON.stringify(item).toLowerCase().includes(query)), extracted so
// every Past Events surface shares one filtering implementation instead of
// each screen growing its own.
export function filterPastEvents(events, query) {
  const q = query.trim().toLowerCase();
  if (!q) return events;
  return events.filter(ev => JSON.stringify(ev).toLowerCase().includes(q));
}

export default function PastEventsSearch({ query, onChange, placeholder = 'Search past events…' }) {
  return (
    <input
      className={s.searchBar}
      placeholder={placeholder}
      value={query}
      onChange={e => onChange(e.target.value)}
    />
  );
}
