import { useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import s from './BottomNav.module.css';

const TABS = [
  { id: 'my-scene',  label: 'MY SCENE',  path: '/my-scene',  Icon: MySceneIcon },
  { id: 'whats-on', label: "WHAT'S ON",  path: '/',          Icon: CalendarIcon },
  { id: 'discover', label: 'DISCOVER',   path: '/discover',  Icon: SearchIcon },
  { id: 'industry', label: 'INDUSTRY',   path: '/industry',  Icon: IndustryIcon },
];

export default function BottomNav({ activeTab, onTabPress }) {
  const navigate = useNavigate();
  const navRef = useRef(null);

  // Safe-area rule: keep --yp-nav-height in sync with the real rendered
  // height so bottom-docked sheets/modals can clear it via --yp-safe-bottom.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    // getBoundingClientRect (not ResizeObserver's contentRect) so the
    // measurement includes the top border + safe-area-inset padding —
    // the full space the nav actually occupies at the bottom of the screen.
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--yp-nav-height', el.getBoundingClientRect().height + 'px');
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function handlePress(id, path) {
    if (onTabPress) { onTabPress(id); return; }
    navigate(path);
  }

  return (
    <nav ref={navRef} className={s.nav}>
      {TABS.map(({ id, label, path, Icon }) => (
        <button
          key={id}
          className={activeTab === id ? s.tabActive : s.tab}
          onClick={() => handlePress(id, path)}
        >
          <span className={s.iconWrap}><Icon /></span>
          <span className={s.label}>{label}</span>
        </button>
      ))}
    </nav>
  );
}

/* Exact v1 SVGs */
function MySceneIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.051 12.616a1 1 0 0 1 1.909.024l.737 1.452a1 1 0 0 0 .737.535l1.634.256a1 1 0 0 1 .588 1.806l-1.172 1.168a1 1 0 0 0-.282.866l.259 1.613a1 1 0 0 1-1.541 1.134l-1.465-.75a1 1 0 0 0-.912 0l-1.465.75a1 1 0 0 1-1.539-1.133l.258-1.613a1 1 0 0 0-.282-.866l-1.156-1.153a1 1 0 0 1 .572-1.822l1.633-.256a1 1 0 0 0 .737-.535z"/>
      <path d="M8 15H7a4 4 0 0 0-4 4v2"/>
      <circle cx="10" cy="7" r="4"/>
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}
function IndustryIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  );
}
