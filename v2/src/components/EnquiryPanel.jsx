import { useState, useMemo } from 'react';
import EnquiryCard from './EnquiryCard';
import { normaliseStatus } from '../lib/enquiryUtils';
import { STATUS_TAB_COLOR } from '../lib/enquiryUtils';

const DIR_TABS = [
  { key: 'INCOMING', color: '#FFD700', rgb: '255,215,0',
    subTabs: ['NEW', 'SEEN', 'SHORTLISTED', 'ACCEPTED', 'DECLINED'] },
  { key: 'OUTGOING', color: '#00B4D8', rgb: '0,180,216',
    subTabs: ['AWAITING', 'INTERESTED', 'ACCEPTED', 'DECLINED'] },
  { key: 'BOOKED',   color: '#00E5A0', rgb: '0,229,160',
    subTabs: [] },
];

function EnqTabBtn({ active, color, rgb, onClick, children }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5,
        padding: '5px 14px', borderRadius: 20, cursor: 'pointer',
        transition: 'background .15s, border-color .15s, color .15s',
        background: active ? `rgba(${rgb},.12)` : hov ? `rgba(${rgb},.08)` : 'transparent',
        border: `1.5px solid ${active ? color : hov ? `rgba(${rgb},.6)` : 'rgba(255,255,255,.12)'}`,
        color: active || hov ? color : 'var(--muted)',
      }}
    >{children}</button>
  );
}

export default function EnquiryPanel({ enquiries = [], onRespond, onPlayDemo }) {
  const [dirTab,    setDirTab]    = useState('INCOMING');
  const [statusTab, setStatusTab] = useState('NEW');
  const [search,    setSearch]    = useState('');

  const filtered = useMemo(() => {
    return enquiries
      .filter(e => {
        if (dirTab === 'BOOKED') {
          const st = (e.status || '').toLowerCase();
          return st === 'booked' || st === 'accepted';
        }
        const dir = (e.direction || 'incoming').toLowerCase();
        if (dir !== dirTab.toLowerCase()) return false;
        return normaliseStatus(e) === statusTab.toLowerCase();
      })
      .filter(e => !search || JSON.stringify(e).toLowerCase().includes(search.toLowerCase()));
  }, [enquiries, dirTab, statusTab, search]);

  const currentDir = DIR_TABS.find(d => d.key === dirTab);

  return (
    <div>
      {/* Direction tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {DIR_TABS.map(({ key, color, rgb, subTabs }) => {
          const cnt = enquiries.filter(e => {
            if (key === 'BOOKED') { const st = (e.status || '').toLowerCase(); return st === 'booked' || st === 'accepted'; }
            return (e.direction || 'incoming').toLowerCase() === key.toLowerCase();
          }).length;
          return (
            <EnqTabBtn key={key} active={dirTab === key} color={color} rgb={rgb}
              onClick={() => { setDirTab(key); setStatusTab(subTabs[0] || ''); }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {key}
                {cnt > 0 && <span style={{ fontSize: 9, fontFamily: "'DM Sans'", fontWeight: 700, background: dirTab === key ? `rgba(${rgb},.22)` : 'rgba(255,255,255,.06)', color: dirTab === key ? color : 'var(--muted)', borderRadius: 8, padding: '1px 5px' }}>{cnt}</span>}
              </span>
            </EnqTabBtn>
          );
        })}
      </div>

      {/* Status sub-tabs */}
      {currentDir && currentDir.subTabs.length > 0 && (
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,.08)', marginBottom: 10 }}>
          {currentDir.subTabs.map(sub => {
            const active = statusTab === sub;
            const subColor = STATUS_TAB_COLOR[sub] || currentDir.color;
            const cnt = enquiries.filter(e =>
              (e.direction || 'incoming').toLowerCase() === dirTab.toLowerCase() &&
              normaliseStatus(e) === sub.toLowerCase()
            ).length;
            return (
              <button key={sub} onClick={() => setStatusTab(sub)}
                style={{
                  flex: 1, background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5,
                  padding: '8px 4px 6px',
                  color: active ? '#fff' : 'var(--muted)',
                  borderBottom: `2px solid ${active ? subColor : 'transparent'}`,
                  transition: 'color .15s, border-color .15s',
                }}>
                {sub}
                {cnt > 0 && (
                  <span style={{
                    marginLeft: 4, fontSize: 9, fontFamily: "'DM Sans'", fontWeight: 700,
                    background: active ? `${subColor}22` : 'rgba(255,255,255,.06)',
                    color: active ? subColor : 'var(--muted)',
                    borderRadius: 8, padding: '1px 5px',
                  }}>{cnt}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', marginBottom: 12 }}>
        <span style={{ fontSize: 14 }}>🔍</span>
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by genre, vibe, act type…"
          style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 13 }}
        />
      </div>

      {/* Cards */}
      {filtered.length === 0
        ? <p style={{ fontSize: 13, color: 'var(--muted)', padding: '12px 0' }}>
            No {dirTab === 'BOOKED' ? 'booked' : statusTab.toLowerCase()} enquiries{search ? ' matching your search' : ''}.
          </p>
        : filtered.map(enq => (
            <EnquiryCard key={enq.id} enq={enq} onRespond={onRespond} onPlayDemo={onPlayDemo} />
          ))
      }
    </div>
  );
}
