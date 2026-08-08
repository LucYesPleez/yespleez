import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import ArtistDashboard from './ArtistDashboard';
import VenueDashboard from './VenueDashboard';
import PerformerDashboard from './PerformerDashboard';
import HostDashboard from './HostDashboard';
import s from './IndustryScreen.module.css';

export default function IndustryScreen() {
  const { session, isGuest } = useSession();
  const navigate = useNavigate();
  const [activeRole, setActiveRole] = useState(null); // 'artist'|'host'|'venue'|'band'|null
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    if (isGuest || !session) { setLoading(false); return; }

    async function detectRole() {
      const { data } = await supabase
        .from('profiles')
        .select('type')
        .eq('user_id', session.user.id)
        .neq('type', 'punter')
        .limit(1)
        .maybeSingle();
      setActiveRole(data?.type || null);
      setLoading(false);
    }
    detectRole();
  }, [session, isGuest]);

  if (loading) return <div className={s.loading}>Loading…</div>;

  if (isGuest || !session) {
    return (
      <div className={s.gate}>
        <p className={s.gateTitle}>INDUSTRY ACCESS</p>
        <p className={s.gateDesc}>Sign in to access your artist, host, or venue dashboard.</p>
        <button className={s.btnPink} onClick={() => navigate('/', { replace: true })}>
          SIGN IN TO CONTINUE
        </button>
      </div>
    );
  }

  if (activeRole === 'artist')  return <ArtistDashboard   userId={session.user.id} />;
  if (activeRole === 'venue')   return <VenueDashboard    userId={session.user.id} />;
  if (activeRole === 'band')    return <PerformerDashboard userId={session.user.id} role="band" />;
  if (activeRole === 'standup') return <PerformerDashboard userId={session.user.id} role="standup" />;
  if (activeRole === 'host')    return <HostDashboard      userId={session.user.id} />;

  // No profile yet — show role picker
  return (
    <div className={s.noprofile}>
      <h1 className={s.heading}>INDUSTRY</h1>
      <p className={s.sub}>You don't have an industry profile yet.</p>
      <button className={s.btnPink} onClick={() => navigate('/my-scene')}>
        SET UP YOUR PROFILE
      </button>
    </div>
  );
}
