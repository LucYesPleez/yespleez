import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import EventCard from './EventCard';
import PastEventsSearch, { filterPastEvents } from './PastEventsSearch';

const todayStr = () => new Date().toISOString().split('T')[0];

export default function EventsSection({
  tabs = {},            // { UPCOMING: [...], DRAFTS: [...], PAST: [...] } — pre-filtered by dashboard
  loading = false,
  accent = '#00E5A0',
  canCreate = true,
  renderExtraBadges,    // optional: (ev) => jsx — for genre badges etc.
  ownerType,            // M14b: 'host' | 'venue' — which dashboard this is.
                        // Passed to /create-event as ?as= so owner resolution
                        // can skip the picker when the answer is obvious.
                        // A hint, never a permission (identity v1.3 R2).
}) {
  const navigate = useNavigate();
  const tabKeys = Object.keys(tabs);
  const [activeTab, setActiveTab] = useState(tabKeys[0] || 'UPCOMING');
  const [showAll, setShowAll] = useState(false);
  const [pastSearch, setPastSearch] = useState('');

  const today = todayStr();
  const isPastTab = activeTab === 'PAST';
  const events = isPastTab ? filterPastEvents(tabs[activeTab] || [], pastSearch) : (tabs[activeTab] || []);

  return (
    <div id="section-events">
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderBottom: '1px solid var(--border)' }}>
        {tabKeys.map(t => {
          const count = (tabs[t] || []).length;
          const active = activeTab === t;
          return (
            <button key={t}
              onClick={() => { setActiveTab(t); setShowAll(false); }}
              style={{
                flex: 1, background: 'none', border: 'none',
                borderBottom: `2px solid ${active ? accent : 'transparent'}`,
                fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: 1.5,
                color: active ? 'var(--text)' : 'var(--muted)',
                padding: '8px 4px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                transition: 'color .15s, border-bottom-color .15s',
              }}
            >
              {t}
              <span style={{ background: 'var(--card2)', color: 'var(--muted)', borderRadius: 10, fontSize: 10, padding: '1px 6px', fontFamily: "'DM Sans', sans-serif", fontWeight: 700, letterSpacing: 0 }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Past Events communal filter/search — only where there's something to search */}
      {isPastTab && !loading && (tabs.PAST || []).length > 0 && (
        <PastEventsSearch query={pastSearch} onChange={setPastSearch} />
      )}

      {/* Content */}
      <div>
      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>Loading…</p>
      ) : events.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>
          {isPastTab && pastSearch.trim() ? 'No past events match your search.' : `No ${activeTab.toLowerCase()} events.`}
        </p>
      ) : (
        <>
          {events.length > 3 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
              <button
                onClick={() => setShowAll(v => !v)}
                style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: 1, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', opacity: .5, transition: 'opacity .15s, color .15s' }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--text)'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '.5'; e.currentTarget.style.color = 'var(--muted)'; }}
              >{showAll ? 'View less <' : 'View all >'}</button>
            </div>
          )}
          <div style={showAll
            ? { display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }
            : { display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4, maxHeight: 315, overflowY: 'scroll', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', maskImage: 'linear-gradient(to bottom, black 75%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, black 75%, transparent 100%)' }
          }>
            {events.map(ev => {
              const isLive      = ev.status === 'live';
              const isCompleted = ev.status === 'completed' || (isLive && (ev.config?.date || '') < today);
              const cfg         = ev.config || {};
              const appsOpen    = cfg.applications_open === true || ev.applications_open === true;
              const isPublic    = cfg.is_public !== false && ev.is_public !== false;
              const statusLabel = isCompleted ? 'FINISHED' : isLive ? 'LIVE' : 'DRAFT';
              const statusCol   = isLive && !isCompleted ? '#00e676' : 'var(--muted)';
              const statusBg    = isLive && !isCompleted ? 'rgba(0,230,118,.1)' : 'rgba(120,120,160,.1)';
              const statusBdr   = isLive && !isCompleted ? 'rgba(0,230,118,.35)' : 'rgba(120,120,160,.3)';
              return (
                <div key={ev.id}
                  onClick={() => navigate(`/event/${ev.id}`)}
                  style={{ position: 'relative', borderRadius: 12, cursor: 'pointer', transition: 'transform .15s, box-shadow .15s' }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = `0 0 14px ${accent}40`; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
                >
                  <EventCard event={ev} noHover />

                  {/* Top-right: extra badges only */}
                  {renderExtraBadges?.(ev) && (
                    <div style={{ position: 'absolute', top: 12, right: 12 }}>
                      {renderExtraBadges(ev)}
                    </div>
                  )}

                  {/* Bottom-right: apps/public, then live chip above edit */}
                  <div style={{ position: 'absolute', bottom: 12, right: 12, display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {!isCompleted && (
                        <span style={{ fontSize: 9, fontFamily: "'Bebas Neue'", letterSpacing: 1.2, color: isPublic ? '#00B4D8' : 'var(--muted)', background: isPublic ? 'rgba(0,180,216,.08)' : 'rgba(120,120,160,.08)', border: `1px solid ${isPublic ? 'rgba(0,180,216,.25)' : 'rgba(120,120,160,.25)'}`, borderRadius: 4, padding: '2px 6px' }}>{isPublic ? 'PUBLIC' : 'PRIVATE'}</span>
                      )}
                      <span style={{ fontSize: 9, fontFamily: "'Bebas Neue'", letterSpacing: 1.2, color: statusCol, background: statusBg, border: `1px solid ${statusBdr}`, borderRadius: 4, padding: '2px 7px' }}>{statusLabel}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {isLive && !isCompleted && (
                        <span style={{ fontSize: 9, fontFamily: "'Bebas Neue'", letterSpacing: 1.2, color: appsOpen ? '#00e676' : 'var(--muted)', background: appsOpen ? 'rgba(0,230,118,.12)' : 'rgba(120,120,160,.12)', border: `1px solid ${appsOpen ? 'rgba(0,230,118,.4)' : 'rgba(120,120,160,.3)'}`, borderRadius: 4, padding: '2px 6px' }}>{appsOpen ? 'APPS OPEN' : 'APPS CLOSED'}</span>
                      )}
                      {!isCompleted && (
                        <button
                          onClick={e => { e.stopPropagation(); navigate(`/create-event?edit=${ev.id}`); }}
                          style={{ fontSize: 10, fontFamily: "'Bebas Neue'", letterSpacing: 1.5, color: '#fff', background: 'rgba(255,51,153,.1)', border: '1px solid rgba(255,51,153,.35)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', transition: 'all .15s' }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,51,153,.22)'; e.currentTarget.style.borderColor = '#FF69B4'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,51,153,.1)'; e.currentTarget.style.borderColor = 'rgba(255,51,153,.35)'; }}
                        >EDIT →</button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      </div>

      {canCreate && (
        <button
          onClick={() => navigate(ownerType ? `/create-event?as=${ownerType}` : '/create-event')}
          style={{ display: 'block', width: '100%', marginTop: 8, marginBottom: 12, background: 'linear-gradient(135deg, #99204d, #6b2e99)', color: '#fff', fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: 2, padding: 14, borderRadius: 10, border: 'none', cursor: 'pointer', transition: 'opacity .15s' }}
          onMouseEnter={e => e.currentTarget.style.opacity = '.85'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
        >+ CREATE NEW EVENT</button>
      )}
    </div>
  );
}
