import { useState, useEffect, useRef, createContext, useContext } from 'react';
import { HashRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from './lib/supabase';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 3 * 60 * 1000,  // data stays fresh 3 min — no refetch on back nav
      gcTime:    10 * 60 * 1000, // keep in cache 10 min after unmount
      retry: 1,
    },
  },
});
import AuthScreen from './screens/AuthScreen';
import BottomNav from './components/BottomNav';
import MiniPlayer from './components/MiniPlayer';
import WhatsOnScreen from './screens/WhatsOnScreen';
import DiscoverScreen from './screens/DiscoverScreen';
import MySceneScreen from './screens/MySceneScreen';
import EventScreen from './screens/EventScreen';
import CreateEventScreen from './screens/CreateEventScreen';
import ApplicationsScreen from './screens/ApplicationsScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import IndustryPanel from './components/IndustryPanel';
import GlobalHeader from './components/GlobalHeader';
import RoleSelectorScreen from './screens/RoleSelectorScreen';
import ErrorBoundary from './components/ErrorBoundary';
import ArtistDashboard from './screens/ArtistDashboard';
import VenueDashboard from './screens/VenueDashboard';
import HostDashboard from './screens/HostDashboard';
import PerformerDashboard from './screens/PerformerDashboard';
import ProfileScreen from './screens/ProfileScreen';
import ProfileEditScreen from './screens/ProfileEditScreen';
import HostProfileScreen from './screens/HostProfileScreen';
import ArtistProfileScreen from './screens/ArtistProfileScreen';
import BandProfileScreen from './screens/BandProfileScreen';
import StandupProfileScreen from './screens/StandupProfileScreen';
import VenueProfileScreen from './screens/VenueProfileScreen';

export const SessionCtx = createContext(null);
export function useSession() { return useContext(SessionCtx); }

export const PlayerCtx = createContext(null);
export function usePlayer() { return useContext(PlayerCtx); }

function tabFromPath(pathname) {
  if (pathname.startsWith('/discover'))  return 'discover';
  if (pathname.startsWith('/my-scene'))  return 'my-scene';
  if (pathname.startsWith('/industry'))  return 'industry';
  if (pathname.startsWith('/profile'))   return 'discover';
  if (pathname.startsWith('/event'))     return 'whats-on';
  return 'whats-on';
}

function Shell({ session, isGuest, onSignOut }) {
  const location  = useLocation();
  const navigate  = useNavigate();
  const [industryOpen, setIndustryOpen] = useState(false);
  const [player, setPlayer] = useState(null); // { url, artistName }
  const [unreadCount, setUnreadCount] = useState(0);
  const pollRef = useRef(null);
  const activeTab = tabFromPath(location.pathname);

  useEffect(() => {
    if (!session) return;
    async function fetchUnread() {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', session.user.id)
        .eq('read', false);
      setUnreadCount(count || 0);
    }
    fetchUnread();
    // Realtime subscription for instant badge updates
    const channel = supabase
      .channel('notif-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${session.user.id}` }, () => {
        setUnreadCount(c => c + 1);
      })
      .subscribe();
    // Fallback poll every 60s
    pollRef.current = setInterval(fetchUnread, 60000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollRef.current);
    };
  }, [session]);

  function handleTabPress(tabId) {
    if (tabId === 'industry') {
      setIndustryOpen(true);
      return;
    }
    setIndustryOpen(false);
    const paths = { 'whats-on': '/', 'discover': '/discover', 'my-scene': '/my-scene' };
    navigate(paths[tabId] || '/');
  }

  return (
    <PlayerCtx.Provider value={{ player, setPlayer }}>
      {location.pathname !== '/role-select' && (
        <GlobalHeader
          unreadCount={unreadCount}
          onMarkRead={() => setUnreadCount(0)}
        />
      )}
      <ErrorBoundary>
      <Routes>
        <Route path="/"          element={<WhatsOnScreen />} />
        <Route path="/discover"  element={<DiscoverScreen />} />
        <Route path="/my-scene"  element={<MySceneScreen isGuest={isGuest} onSignOut={onSignOut} />} />
        <Route path="/event/:id"              element={<EventScreen />} />
        <Route path="/create-event"           element={<CreateEventScreen />} />
        <Route path="/event/:id/applications" element={<ApplicationsScreen />} />
        <Route path="/notifications"          element={<NotificationsScreen />} />
        <Route path="/industry/artist"   element={<ArtistDashboard />} />
        <Route path="/industry/venue"    element={<VenueDashboard />} />
        <Route path="/industry/venue/setup"  element={<VenueProfileScreen />} />
        <Route path="/industry/host"        element={<HostDashboard />} />
        <Route path="/industry/host/setup"   element={<HostProfileScreen />} />
        <Route path="/industry/artist/setup"  element={<ArtistProfileScreen />} />
        <Route path="/industry/band/setup"    element={<BandProfileScreen />} />
        <Route path="/industry/standup/setup" element={<StandupProfileScreen />} />
        <Route path="/industry/band"     element={<PerformerDashboard role="band" />} />
        <Route path="/industry/standup"  element={<PerformerDashboard role="standup" />} />
        <Route path="/role-select"       element={<RoleSelectorScreen session={session} onSignOut={onSignOut} />} />
        <Route path="/profile/:id"       element={<ProfileScreen />} />
        <Route path="/profile-edit"      element={<ProfileEditScreen />} />
      </Routes>
      </ErrorBoundary>
      <BottomNav
        activeTab={industryOpen ? 'industry' : activeTab}
        onTabPress={handleTabPress}
      />

      {/* Global mini player — persists across navigation */}
      {player && (
        <div
          ref={el => {
            if (!el) {
              document.body.style.paddingBottom = '';
              document.documentElement.style.setProperty('--yp-player-height', '0px');
              return;
            }
            // Safe-area rule: while the mini player is mounted, it — not the
            // nav — is the effective bottom of the screen; --yp-player-height
            // feeds --yp-safe-bottom (index.css) so bottom-docked sheets stack
            // above it automatically.
            const ro = new ResizeObserver(([e]) => {
              document.body.style.paddingBottom = e.contentRect.height + 'px';
              document.documentElement.style.setProperty('--yp-player-height', e.contentRect.height + 'px');
            });
            ro.observe(el);
            el._ro = ro;
          }}
          style={{ position: 'fixed', bottom: 67, left: '50%', transform: 'translateX(-50%)', width: 'min(100%, 680px)', zIndex: 8000 }}
        >
          <MiniPlayer
            url={player.url}
            artistName={player.artistName}
            hasNext={!!(player?.playlist?.length)}
            onClose={() => setPlayer(null)}
            onFinish={() => {
              if (player?.playlist?.length) {
                const [next, ...rest] = player.playlist;
                setPlayer({ ...next, playlist: rest });
              } else {
                setPlayer(null);
              }
            }}
            onNext={() => {
              if (player?.playlist?.length) {
                const [next, ...rest] = player.playlist;
                setPlayer({ ...next, playlist: rest });
              }
            }}
          />
        </div>
      )}

      {/* Industry bottom-sheet panel — v1 style */}
      <IndustryPanel
        open={industryOpen}
        onClose={() => setIndustryOpen(false)}
        onNavigate={(path) => { setIndustryOpen(false); navigate(path); }}
        session={session}
        isGuest={isGuest}
        onSignOut={onSignOut}
      />
    </PlayerCtx.Provider>
  );
}

export default function App() {
  const [session,  setSession]  = useState(null);
  const [isGuest,  setIsGuest]  = useState(() => sessionStorage.getItem('yp_guest') === '1');
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) setIsGuest(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (loading) return null;

  if (!session && !isGuest) {
    return <AuthScreen onGuest={() => { sessionStorage.setItem('yp_guest', '1'); setIsGuest(true); }} />;
  }

  function handleSignOut() {
    sessionStorage.removeItem('yp_guest');
    setIsGuest(false);
    supabase.auth.signOut();
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SessionCtx.Provider value={{ session, isGuest }}>
        <HashRouter>
          <Shell session={session} isGuest={isGuest} onSignOut={handleSignOut} />
        </HashRouter>
      </SessionCtx.Provider>
    </QueryClientProvider>
  );
}
