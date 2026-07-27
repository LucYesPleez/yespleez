import { useState, useEffect, useRef, createContext, useContext } from 'react';
import { HashRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from './lib/supabase';
import { markExplicitSignOut } from './lib/authForensics';
import { reconcilePushState } from './lib/push';
import { clearActingProfileCache } from './lib/actingProfile';
import { initAnalytics, setAnalyticsUser, trackScreenView } from './lib/analytics';
import { startMessaging } from './lib/messagingReliability';
import { preloadUiSounds, playMessageArrive, armAudioUnlock } from './lib/uiSound';

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
import MessengerIdentityScreen from './screens/MessengerIdentityScreen';
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

  // A2 · screen views. Mounted here rather than per-screen because every
  // route already passes through this component, and one call site cannot
  // drift out of sync with a screen that forgot to add its own.
  //
  // The path is normalised inside trackScreenView ('/profile/:id'), so no
  // profile or event id ever reaches the analytics table. Runs for guests
  // too — how signed-out visitors browse is half the funnel.
  useEffect(() => {
    trackScreenView(location.pathname);
  }, [location.pathname]);

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
        .not('type', 'in', `(${conversationTypes.join(',')})`)
        // CJ2 — an "In Messages only" notification is badged on FIND FRIENDS
        // and nowhere else. The bell is a different tab; lighting it would
        // make the label a lie. Kept in step with NotificationsScreen's feed,
        // which excludes the same rows for the same reason.
        .neq('channel', 'in_app');
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
    const onReceived = () => {
      fetchMessages();
      // The arrival sound, for the case the OS cannot cover: the app is open,
      // so no push notification is shown and nothing else would make a sound.
      // See playMessageArrive on why this is not — and cannot be — the sound
      // an OS notification makes.
      playMessageArrive();
    };
    window.addEventListener('yp:message-received', onReceived);

    // Fallback poll every 60s
    pollRef.current = setInterval(() => { fetchUnread(); fetchMessages(); }, 60000);

    // MP·5 — mobile browsers throttle/suspend both the realtime socket and
    // this setInterval while the tab is backgrounded, and reopening a PWA
    // from the home screen icon typically RESUMES the same suspended page
    // rather than reloading it — so nothing above re-runs on its own.
    // Result without this: the OS app-icon badge (sourced from this same
    // state) can sit on a stale number for minutes after messages actually
    // arrived, even though the in-app Messages screen shows the true count
    // (it fetches fresh on its own mount). Forcing a refetch the instant
    // the tab becomes visible again is what keeps the OS badge honest.
    const onVisible = () => { if (document.visibilityState === 'visible') { fetchUnread(); fetchMessages(); } };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('yp:messages-read', onRead);
      window.removeEventListener('yp:message-received', onReceived);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(pollRef.current);
    };
  }, [session]);

  // MP·5 — the OS app-icon badge, sourced from the SAME two counts every
  // other surface already agrees on (unreadCount: the bell, messagesBadge:
  // §5.6's one counting rule for messages). No independent tally is taken
  // here — a second badge implementation is exactly how a badge and the
  // in-app UI drift apart and start disagreeing with each other.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('setAppBadge' in navigator)) return;
    const total = unreadCount + messagesBadge;
    if (total > 0) navigator.setAppBadge(total).catch(() => {});
    else navigator.clearAppBadge().catch(() => {});
  }, [unreadCount, messagesBadge]);

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
        {/* The Messenger identity (avatar + display name). Reached from the
            name in My Scene and the avatar in Messages — both land here. */}
        <Route path="/me"                element={<MessengerIdentityScreen />} />
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
      setAnalyticsUser(s?.user?.id ?? null);
      if (s) setIsGuest(false);
    });


    // A1 · started here rather than in main.jsx so it begins exactly once per
    // app instance and can resolve the session first. It is idempotent, which
    // it has to be: StrictMode runs this effect twice in dev, and without the
    // guard every developer session would double every open.
    //
    // Deliberately NOT awaited and NOT gated on `session` — a signed-out
    // visitor browsing as a guest is precisely the "browser only" population
    // this measures, so waiting for a session would make them invisible.
    initAnalytics();

    // Outbox runtime: register the per-kind uploaders, deliver anything a
    // previous session left queued or failed, and flush again whenever
    // reception returns. Idempotent for the same StrictMode reason as above.
    startMessaging();

    // Decode the reaction tick before anyone can trigger it. Without this the
    // FIRST reaction of a session waits on a fetch and lands silently — the
    // one instance where the sound matters most, because it is what tells a
    // user the interaction has a sound at all. Fire-and-forget; a failure
    // means no tick, never a broken app.
    preloadUiSounds();
    // iOS will not play audio from a context that was never unlocked inside a
    // real gesture — see armAudioUnlock. Costs nothing on desktop.
    armAudioUnlock();

    return () => subscription.unsubscribe();
  }, []);

  /**
   * ⚠ RECONCILE PUSH ON EVERY LAUNCH, not only when the notifications screen
   * happens to be opened.
   *
   * Chrome rotates push subscriptions on its own schedule. When it does the
   * stored endpoint dies silently — FCM keeps ACCEPTING sends for it and
   * returning success, so nothing errors and no diagnostic complains. Android
   * notifications stopped for two days that way while every log read
   * "sent: 4, pruned: 0".
   *
   * reconcilePushState already knew how to repair this; it was only ever
   * called from PushNotificationToggle, which lives on a screen nobody opens
   * unless they already suspect something is wrong. Running it at launch means
   * a rotation costs one app open instead of however long it takes someone to
   * notice the silence.
   *
   * ⚠ Keyed on the USER ID, not on mount: at mount `session` is still null
   * while getSession() resolves, so a mount-only version would never fire.
   * This also covers signing in later in the same page life.
   *
   * Safe for anyone who never enabled push — no subscription and no remembered
   * endpoint means nothing to delete and no network call. Fire-and-forget: a
   * failure here must never delay or break the app.
   */
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;
    reconcilePushState(uid).catch(() => {});
  }, [session?.user?.id]);

  if (loading) return null;

  if (!session && !isGuest) {
    return <AuthScreen onGuest={() => { sessionStorage.setItem('yp_guest', '1'); setIsGuest(true); }} />;
  }

  function handleSignOut() {
    sessionStorage.removeItem('yp_guest');
    setIsGuest(false);
    clearActingProfileCache();  // M6: a cached profile id must not outlive its session
    // ⏱ TEMPORARY — marks this SIGNED_OUT as user-initiated. GoTrue emits the
    // same event whether the button was pressed or a refresh was rejected, and
    // this is the app's only signOut call site. Labelling only.
    markExplicitSignOut();
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
