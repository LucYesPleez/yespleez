/**
 * One inline SVG set for the whole shell.
 *
 * Inline rather than an icon dependency: the shell needs ~20 glyphs, they are
 * all single-stroke, and a package would be the first thing the Scene app and
 * this one disagreed about. `currentColor` throughout so an icon inherits
 * whatever the row it sits in is doing.
 */

const PATHS = {
  dashboard:     <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  music:         <><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /><path d="M9 18V5l12-2v13" /></>,
  volunteer:     <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  market_stall:  <><path d="M3 9h18l-1.5-4.5h-15L3 9Z" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" /></>,
  food_vendor:   <><path d="M4 8h16" /><path d="M5 8a7 7 0 0 0 14 0" /><path d="M6 15h12" /><path d="M7 15v5h10v-5" /></>,
  workshop:      <><path d="M4 19h16" /><path d="M7 19V9l5-4 5 4v10" /><path d="M10.5 19v-5h3v5" /></>,
  performance_artist: <><circle cx="12" cy="6" r="2.5" /><path d="M6 21l3-9h6l3 9" /><path d="M8 13h8" /></>,
  decor:         <><path d="M12 3v18" /><path d="M4 8l8-5 8 5" /><path d="M4 8v8l8 5 8-5V8" /></>,
  media:         <><rect x="3" y="6" width="18" height="13" rx="2.5" /><circle cx="12" cy="12.5" r="3.5" /><path d="M8 6l1.5-2h5L16 6" /></>,
  theme_camp:    <><path d="M12 3 3 20h18L12 3Z" /><path d="M12 10v10" /></>,
  messages:      <><path d="M4 5h16v11H9l-5 4V5Z" /></>,
  announcements: <><path d="M4 10v4h4l6 4V6l-6 4H4Z" /><path d="M17 9a4 4 0 0 1 0 6" /></>,
  profile:       <><circle cx="12" cy="9" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /><circle cx="12" cy="12" r="9" /></>,
  settings:      <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></>,
  search:        <><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5 21 21" /></>,
  filter:        <><path d="M3 5h18M6 12h12M10 19h4" /></>,
  export:        <><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /><path d="M4 19h16" /></>,
  bell:          <><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" /><path d="M10 19a2 2 0 0 0 4 0" /></>,
  external:      <><path d="M14 4h6v6" /><path d="m20 4-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  chevron:       <path d="m6 9 6 6 6-6" />,
  close:         <path d="M6 6 18 18M18 6 6 18" />,
  location:      <><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></>,
  calendar:      <><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  clock:         <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  star:          <path d="m12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8L12 4Z" />,
  check:         <path d="m5 13 4 4L19 7" />,
  cross:         <path d="M7 7 17 17M17 7 7 17" />,
  plus:          <path d="M12 5v14M5 12h14" />,
  dots:          <><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></>,
  inbox:         <><path d="M3 13h5l1.5 3h5L16 13h5" /><path d="M4.5 6h15l1.5 7v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5l1.5-7Z" /></>,
  help:          <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.6 2.6 0 1 1 3.4 2.5c-.6.2-.9.7-.9 1.3v.4" /><circle cx="12" cy="17" r=".6" fill="currentColor" /></>,
  notes:         <><path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" /><path d="M8 11h8M8 15h5" /></>,
  spotify:       <><circle cx="12" cy="12" r="9" /><path d="M7.5 9.5c3-.8 6.3-.5 8.8 1M8 13c2.4-.6 5-.4 7 .9M8.7 16c1.9-.4 3.9-.3 5.5.7" /></>,
  soundcloud:    <><path d="M4 16v-4M7 16v-6M10 16V8M13 16V7" /><path d="M16 16h3.5a2.5 2.5 0 0 0 0-5c-.3 0-.6 0-.8.1A4 4 0 0 0 16 8.5V16Z" /></>,
  instagram:     <><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17" cy="7" r=".8" fill="currentColor" /></>,
  youtube:       <><rect x="2.5" y="6" width="19" height="12" rx="3.5" /><path d="m10.5 9.5 4.5 2.5-4.5 2.5v-5Z" /></>,
  sort:          <><path d="M7 4v16M7 20l-3-3M7 20l3-3" /><path d="M17 20V4M17 4l-3 3M17 4l3 3" /></>,
  columns:       <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></>,
};

export default function Icon({ name, size = 18, strokeWidth = 1.6, className }) {
  const d = PATHS[name];
  // An unknown name renders nothing rather than throwing — a missing glyph is
  // a cosmetic gap, not a reason to take a screen down.
  if (!d) return null;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {d}
    </svg>
  );
}
