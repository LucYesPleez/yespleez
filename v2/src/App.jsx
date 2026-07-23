import { useState, useEffect, useRef, createContext, useContext } from 'react';
import { HashRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from './lib/supabase';
import { clearActingProfileCache } from './lib/actingProfile';

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
import InboxScreen from './screens/InboxScreen';
import ConversationScreen from './screens/ConversationScreen';
import AccessRequiredScreen from './screens/AccessRequiredScreen';
import { ShareTargetProvider } from './lib/shareTarget';
import { ConversationUiProvider } from './lib/conversationUi';
import ConversationDock from './components/ConversationDock';
import { totalUnread } from './lib/messaging';
import {
  conversationNotificationTypes, isConversationActivity, KNOWN_CONVERSATION_TYPES,
} from './lib/conversationNotifications';
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
import BetaFeedbackScreen from './screens/BetaFeedbackScreen';

export const SessionCtx = createContext(null);
export function useSession() { return useContext(SessionCtx); }

export const PlayerCtx = createContext(null);
export function usePlayer() { return useContext(PlayerCtx); }

function tabFromPath(pathname) {
  if (pathname.startsWith('/messages'))  return 'messages';
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
  const [messagesBadge, setMessagesBadge] = useState(0);
  const pollRef = useRef(null);
  const activeTab = tabFromPath(location.pathname);

  useEffect(() => {
    if (!session) return;

    // Navigation architecture: conversation activity NEVER increments the
    // bell. It updates the MESSAGES badge only. The excluded types are read
    // from the policy table rather than hardcoded, so voice notes, images and
    // attachments join the rule by being categorised — see
    // lib/conversationNotifications.js.
    let conversationTypes = KNOWN_CONVERSATION_TYPES;

    async function fetchUnread() {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        // R5: the badge deliberately does NOT scope to a profile. It
        // aggregates across every profile the account owns, so an artist
        // browsing as Personal still sees an urgent venue enquiry.
        .eq('to_user_id', session.user.id)
        // NP1: a muted notification is written and kept, but never counted.
        // Preferences govern delivery, never existence.
        .is('suppressed_at', null)
        .eq('read', false)
        .not('type', 'in', `(${conversationTypes.join(',')})`);
      setUnreadCount(count || 0);
    }

    // §5.6 — ONE counting rule for messages, shared by every surface. The nav
    // badge calls the same function the inbox and each thread call, so they
    // cannot disagree.
    async function fetchMessages() {
      const { count } = await totalUnread();
      setMessagesBadge(count || 0);
    }

    (async () => {
      conversationTypes = await conversationNotificationTypes();
      fetchUnread();
      fetchMessages();
    })();

    // Realtime. An inserted row bumps exactly one badge, never both.
    const channel = supabase
      .channel('notif-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `to_user_id=eq.${session.user.id}` }, ({ new: row }) => {
        if (isConversationActivity(row, conversationTypes)) fetchMessages();
        else setUnreadCount(c => c + 1);
      })
      .subscribe();

    // DEF-2 — reading a conversation advances the watermark, which is a write
    // with no realtime event. Without this the badge would hold a stale count
    // until the 60s poll, so the user reads everything and the number stays.
    const onRead = () => fetchMessages();
    window.addEventListener('yp:messages-read', onRead);

    // The mirror of the above, for messages ARRIVING. The badge's own
    // subscription watches `notifications`, which is written by a second
    // trigger on a second table and reaches this client on a second socket —
    // so it lags the message it describes, and lags badly on a phone waking a
    // backgrounded connection. ConversationDock hears the message itself and
    // says so directly, which is the shortest path there is.
    const onReceived = () => fetchMessages();
    window.addEventListener('yp:message-received', onReceived);

    // Fallback poll every 60s
    pollRef.current = setInterval(() => { fetchUnread(); fetchMessages(); }, 60000);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('yp:messages-read', onRead);
      window.removeEventListener('yp:message-received', onReceived);
      clearInterval(pollRef.current);
    };
  }, [session]);

  function handleTabPress(tabId) {
    if (tabId === 'industry') {
      setIndustryOpen(true);
      return;
    }
    setIndustryOpen(false);
    const paths = {
      'whats-on': '/', 'discover': '/discover', 'my-scene': '/my-scene',
      'messages': '/messages',
    };
    navigate(paths[tabId] || '/');
  }

  return (
    <PlayerCtx.Provider value={{ player, setPlayer }}>
      <ShareTargetProvider>
      {/* Messaging is APP-SHELL state, not screen state. The dock is mounted
          once, above the router, so a conversation survives navigation and
          "minimise" never means "unmount and lose the draft". */}
      <ConversationUiProvider>
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
        <Route path="/messages"               element={<InboxScreen />} />
        <Route path="/messages/:id"           element={<ConversationScreen />} />
        <Route path="/access-required"        element={<AccessRequiredScreen />} />
        <Route path="/beta-feedback"          element={<BetaFeedbackScreen />} />
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
        messagesBadge={messagesBadge}
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
      <ConversationDock />
      </ConversationUiProvider>
      </ShareTargetProvider>
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
    clearActingProfileCache();  // M6: a cached profile id must not outlive its session
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
