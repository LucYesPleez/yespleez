import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { writeNotification } from '../lib/writeNotification';
import s from './ApplicationsScreen.module.css';

const STATUS_TABS = ['PENDING', 'ACCEPTED', 'INVITED', 'REJECTED'];

export default function ApplicationsScreen() {
  const { id: eventId } = useParams();
  const navigate = useNavigate();
  const [apps,      setApps]      = useState([]);
  const [profiles,  setProfiles]  = useState({});
  const [eventName, setEventName] = useState('');
  const [tab,       setTab]       = useState('PENDING');
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;

    async function load() {
      const [{ data: appData }, { data: evData }] = await Promise.all([
        supabase.from('applications').select('*').eq('event_id', eventId).order('created_at', { ascending: false }),
        supabase.from('events').select('name').eq('id', eventId).maybeSingle(),
      ]);
      if (!cancelled) setEventName(evData?.name || '');

      if (cancelled) return;
      const rows = appData || [];
      setApps(rows);

      // Fetch profiles for all applicants
      const ids = [...new Set(rows.map(a => a.artist_id).filter(Boolean))];
      if (ids.length > 0) {
        const { data: profData } = await supabase
          .from('profiles')
          .select('user_id, name, avatar, sound, genre_string, type')
          .in('user_id', ids);
        const map = {};
        (profData || []).forEach(p => { map[p.user_id] = p; });
        if (!cancelled) setProfiles(map);
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [eventId]);

  async function respond(appId, status, artistId, artistName) {
    await supabase.from('applications').update({ status }).eq('id', appId);
    setApps(prev => prev.map(a => a.id === appId ? { ...a, status } : a));
    if (!artistId) return;
    const evLabel = eventName ? ` for ${eventName}` : '';
    const NOTIF = {
      accepted: { type: 'booking_confirmed',    message: `You've been accepted${evLabel}. You're booked!` },
      rejected: { type: 'application_declined', message: `Your application was unsuccessful${evLabel}.` },
    };
    const notif = NOTIF[status];
    if (notif) await writeNotification(artistId, notif.type, notif.message, { event_name: eventName, event_id: eventId });
  }

  const filtered = apps.filter(a => (a.status || 'pending').toUpperCase() === tab);

  return (
    <div className={s.screen}>
      <div className={s.header}>
        <h1 className={s.title}>APPLICATIONS</h1>
        <span className={s.count}>{apps.length}</span>
      </div>

      <div className={s.tabs}>
        {STATUS_TABS.map(t => (
          <button
            key={t}
            className={tab === t ? s.tabActive : s.tab}
            onClick={() => setTab(t)}
          >
            {t}
            <span className={s.tabCount}>
              {apps.filter(a => (a.status || 'pending').toUpperCase() === t).length}
            </span>
          </button>
        ))}
      </div>

      <div className={s.list}>
        {loading && <p className={s.empty}>Loading…</p>}
        {!loading && filtered.length === 0 && (
          <p className={s.empty}>No {tab.toLowerCase()} applications.</p>
        )}
        {filtered.map(app => {
          const profile = profiles[app.artist_id];
          return (
            <AppCard
              key={app.id}
              app={app}
              profile={profile}
              onAccept={() => respond(app.id, 'accepted', app.artist_id, app.artist_name)}
              onReject={() => respond(app.id, 'rejected', app.artist_id, app.artist_name)}
            />
          );
        })}
      </div>
    </div>
  );
}

function AppCard({ app, profile, onAccept, onReject }) {
  const navigate = useNavigate();
  const name   = profile?.name  || `Artist #${app.artist_id?.slice(0, 6)}`;
  const sound  = profile?.sound || profile?.genre_string || '';
  const isPending = (app.status || 'pending') === 'pending';
  const mixLink = app.mix_link || profile?.mix_link;

  return (
    <div className={s.card}>
      <div className={s.cardTop} style={{ cursor: 'pointer' }} onClick={() => profile && navigate(`/profile/${app.artist_id}`)}>
        {profile?.avatar
          ? <img className={s.avatar} src={profile.avatar} alt={name} />
          : <div className={s.avatarPH}>{name[0]?.toUpperCase()}</div>
        }
        <div className={s.cardInfo}>
          <p className={s.cardName}>{name}</p>
          {sound && <p className={s.cardSound}>{sound}</p>}
        </div>
        <span className={s.status} data-status={app.status || 'pending'}>
          {(app.status || 'PENDING').toUpperCase()}
        </span>
      </div>
      {app.note && <p className={s.note}>"{app.note}"</p>}
      {mixLink && (
        <a href={mixLink} target="_blank" rel="noopener noreferrer"
           style={{ display: 'inline-block', marginTop: 8, fontSize: 12, color: 'var(--neon2)', fontFamily: "'Bebas Neue'", letterSpacing: 1, textDecoration: 'none' }}>
          ▶ PLAY DEMO MIX
        </a>
      )}
      {isPending && (
        <div className={s.actions}>
          <button className={s.btnAccept} onClick={onAccept}>✓ ACCEPT</button>
          <button className={s.btnReject} onClick={onReject}>✕ DECLINE</button>
        </div>
      )}
    </div>
  );
}
