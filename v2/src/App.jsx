import { useState, useEffect, createContext, useContext } from 'react';
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
  const activeTab = tabFromPath(location.pathname);

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
    <>
      {location.pathname !== '/role-select' && <GlobalHeader />}
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

      {/* Industry bottom-sheet panel — v1 style */}
      <IndustryPanel
        open={industryOpen}
        onClose={() => setIndustryOpen(false)}
        onNavigate={(path) => { setIndustryOpen(false); navigate(path); }}
        session={session}
        isGuest={isGuest}
        onSignOut={onSignOut}
      />
    </>
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
