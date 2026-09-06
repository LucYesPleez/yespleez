import { useState, useEffect, useRef, createContext, useContext } from 'react';
import { HashRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from './lib/supabase';
import { markExplicitSignOut } from './lib/authForensics';
import { reconcilePushState } from './lib/push';
import { clearActingProfileCache } from './lib/actingProfile';
import { initAnalytics, setAnalyticsUser, trackScreenView } from './lib/analytics';
import { startMessaging } from './lib/messagingReliability';
import { prefetchInbox } from './lib/inboxQuery';
import { preloadUiSounds, playMessageArrive, armAudioUnlock, playNotificationSound } from './lib/uiSound';
import { soundForNotification } from './lib/notificationSound';

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
import ResetPasswordScreen from './screens/ResetPasswordScreen';
import StartScreen from './screens/StartScreen';
import BottomNav from './components/BottomNav';
import UpdateBanner from './components/UpdateBanner';
import MiniPlayer from './components/MiniPlayer';
import { advance, rewind, hasNext as hasNextDemo, hasPrev as hasPrevDemo } from './lib/playerQueue';
import WhatsOnScreen from './screens/WhatsOnScreen';
import DiscoverScreen from './screens/DiscoverScreen';
import MySceneScreen from './screens/MySceneScreen';
import PosterWallScreen from './screens/PosterWallScreen';
import EventScreen from './screens/EventScreen';
import SetTimesScreen from './screens/SetTimesScreen';
import QrDestinationScreen from './screens/QrDestinationScreen';
import QrHarness from './screens/QrHarness';
import EventLayoutHarness from './screens/event/EventLayoutHarness';
import StickerHarness from './screens/dev/StickerHarness';
import ScheduleHarness from './screens/event/ScheduleHarness';
import CreateEventScreen from './screens/CreateEventScreen';
import ApplicationsScreen from './screens/ApplicationsScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import CalendarScreen from './screens/CalendarScreen';
import InboxScreen from './screens/InboxScreen';
import ConversationScreen from './screens/ConversationScreen';
import AccessRequiredScreen from './screens/AccessRequiredScreen';
import { ShareTargetProvider } from './lib/shareTarget';
import { ParticipationProvider } from './components/ParticipationGate';
import { InviteSuppressCtx } from './components/AccountInviteSheet';
import PushValuePrompt from './components/PushValuePrompt';
import FirstUseTeach from './components/FirstUseTeach';
import { clearIntent } from './lib/returnIntent';
import { ConversationUiProvider } from './lib/conversationUi';
import ConversationDock from './components/ConversationDock';
import { totalUnread } from './lib/messaging';
import { NOTIFICATIONS_READ_EVENT } from './lib/markNotificationsRead';
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

/**
 * The screen for a path no route claims. ⚠ Deliberately plain and deliberately
 * VISIBLE: its whole job is to turn a broken link into something a person can
 * report, instead of a blank page that reads as a broken app.
 */
function RouteNotFound() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <div style={{ padding: '80px 20px', textAlign: 'center', maxWidth: 420, margin: '0 auto' }}>
      <h1 style={{ fontFamily: "'Bebas Neue'", fontWeight: 400, fontSize: 30, letterSpacing: 2, color: 'var(--text)', margin: 0 }}>
        THERE&rsquo;S NOTHING HERE
      </h1>
      <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginTop: 10 }}>
        That link points at a page this app doesn&rsquo;t have. Nothing is broken
        on your side.
      </p>
      {/* ⭐ The path, because "which link did you press" is the whole question
          when one of these is reported. */}
      <code style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: 10, wordBreak: 'break-all' }}>{pathname}</code>
      <button
        type="button"
        onClick={() => navigate('/')}
        style={{ marginTop: 22, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.16)', borderRadius: 12, color: 'var(--text)', fontFamily: "'Bebas Neue'", fontSize: 15, letterSpacing: 2, padding: '12px 24px', cursor: 'pointer' }}
      >GO TO WHAT&rsquo;S ON</button>
    </div>
  );
}

function Shell({ session, onSignOut }) {
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
        // SEC-6a: same reasoning one step further on — a dismissed row is
        // kept and never counted. The user has already cleared it, and a badge
        // still claiming otherwise is what "dismiss" exists to stop.
        .is('dismissed_at', null)
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
        else {
          /**
           * ⭐ THE NOTIFICATION SOUND, for everything that is not a message.
           *
           * ⛔⛔ THE `else` IS LOAD-BEARING. Conversation activity already makes
           * a sound down its own path (`yp:message-received` → the arrival
           * shaker), so playing here as well would double every message.
           *
           * ⚠ A type with no class is SILENT — `soundForNotification` returns
           * null and `playNotificationSound` ignores it. Ambient rows are meant
           * to be seen, not heard.
           *
           * ⚠ NOT gated on the badge or on visibility: a suppressed or
           * dismissed row still never reaches here, because it is the INSERT
           * that fires, and both of those are later decisions.
           */
          playNotificationSound(soundForNotification(row?.type));
          setUnreadCount(c => c + 1);
        }
      })
      .subscribe();

    // DEF-2 — reading a conversation advances the watermark, which is a write
    // with no realtime event. Without this the badge would hold a stale count
    // until the 60s poll, so the user reads everything and the number stays.
    const onRead = () => fetchMessages();
    window.addEventListener('yp:messages-read', onRead);

    // DEF-4 — the bell's own version of exactly the same gap. Marking a
    // notification read is an UPDATE, and the subscription above watches
    // INSERT, so nothing here would learn that the number had moved until the
    // 60s poll. It matters more than it did for messages: rows are now marked
    // read as they scroll past, a few at a time, so the badge would spend most
    // of a minute contradicting a list the user is looking at.
    //
    // Re-counts from the database rather than subtracting what was just
    // written — §5.6's rule. The count on screen is always one the database
    // gave us, so it cannot drift from what a reload would show.
    const onNotifsRead = () => fetchUnread();
    window.addEventListener(NOTIFICATIONS_READ_EVENT, onNotifsRead);

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
      window.removeEventListener(NOTIFICATIONS_READ_EVENT, onNotifsRead);
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

  /**
   * ⚠⚠ A DELIVERED NOTIFICATION OUTLIVES THE THING IT ANNOUNCED.
   *
   * The badge above is the Badging API, and it was already correct: both
   * counts start at 0, so opening the app clears it. But the service worker
   * also calls `showNotification`, and a toast nobody dismissed does not go
   * anywhere — it sits in the OS notification centre, and Windows puts its own
   * count on the taskbar icon. Measured 2026-08-25: the database reported ZERO
   * unread of either kind while the icon showed 3.
   *
   * ⭐ So being in the app is what dismisses them. If the window is visible the
   * person is here; a notification saying "come and look" has done its job and
   * is now just an unread count that no amount of reading can clear.
   *
   * ⛔ ONLY WHILE VISIBLE. Closing them from a backgrounded tab would delete
   * the announcement before it had been seen, which is the opposite failure and
   * a worse one — the notification is the only thing that reaches someone who
   * is not looking.
   *
   * ⚠ Not gated on `session`: toasts delivered before a sign-out are exactly
   * the ones with nobody left to read them.
   */
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return undefined;

    async function dismissDelivered() {
      if (document.visibilityState !== 'visible') return;
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg?.getNotifications) return;
        const live = await reg.getNotifications();
        live.forEach(n => n.close());
      } catch { /* cosmetic — never let this break app start */ }
    }

    dismissDelivered();
    document.addEventListener('visibilitychange', dismissDelivered);
    // `focus` as well as visibilitychange: a desktop PWA that is already
    // visible but behind another window fires only focus when it comes
    // forward, and that is the moment the user has actually arrived.
    window.addEventListener('focus', dismissDelivered);
    return () => {
      document.removeEventListener('visibilitychange', dismissDelivered);
      window.removeEventListener('focus', dismissDelivered);
    };
  }, []);

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
      {/* ⭐ ONE INVITE SHEET AT A TIME. My Scene and Messages hold theirs up
          for the whole signed-out visit, so opening the Industry panel — which
          carries its own invite — stacked two of them. Wraps the gate as well
          as the routes, so nothing can slip out from under the rule. */}
      <InviteSuppressCtx.Provider value={industryOpen}>
      {/* O2 · the participation gate serves every heart and follow control in
          the app — screens, cards, and the dock alike — so it wraps them all.
          Needs the router (returnIntent captures the live route), which Shell
          is already under. */}
      <ParticipationProvider>
      {/* Messaging is APP-SHELL state, not screen state. The dock is mounted
          once, above the router, so a conversation survives navigation and
          "minimise" never means "unmount and lose the draft". */}
      <ConversationUiProvider>
      {/* ⛔ NO TOP BAR ON /auth OR /role-select (owner, 2026-08-16: "top of
          screen banner does not need to be there").

          On /auth it was actively wrong, not merely surplus. The header carries
          its own YESPLEEZ wordmark and it overlaid AuthScreen's logo tag — the
          screen is vertically centred at 100dvh, so its own mark sits directly
          under the bar — printing the brand twice, one on top of the other. It
          also offered a SIGN IN control on the sign in screen.

          ⚠ Removing it costs no route out. AuthScreen's exit is its own
          KEEP BROWSING button, which calls leave() — history back, or What's On
          for a cold load. That is the O1 mechanism and it never used the
          header's chevron. */}
      {!['/role-select', '/auth'].includes(location.pathname) && (
        <GlobalHeader
          unreadCount={unreadCount}
          /* ⭐ The header now carries the identity control, so it needs who
             you are and how to sign you out — both were already in Shell's
             props and simply never reached it. */
          session={session}
          onSignOut={onSignOut}
        />
      )}
      <ErrorBoundary>
      <Routes>
        <Route path="/"          element={<WhatsOnScreen />} />
        <Route path="/discover"  element={<DiscoverScreen />} />
        <Route path="/my-scene"  element={<MySceneScreen />} />
        <Route path="/poster-wall" element={<PosterWallScreen />} />
        <Route path="/event/:id"              element={<EventScreen />} />
        {/* ⭐⭐ QR1 · the Set Times QR's destination. A separate printed object
            from the Event QR — see screens/SetTimesScreen for why this is a
            route and not a scroll position. PUBLIC: a poster is read by
            strangers, and the organiser's publish gate still decides what it
            shows. */}
        <Route path="/event/:id/set-times"    element={<SetTimesScreen />} />
        {/* ⭐⭐ QR1 · where every scanned YesPleez code lands. ⛔ PERMANENT —
            addresses of this shape are printed on paper. Types may be added;
            none may be renamed or removed. lib/qrDestinations owns the map. */}
        <Route path="/q/:type/:id"            element={<QrDestinationScreen />} />
        {/* /auth is a routed surface, not the app's front door. It is an
            INTERRUPTION in an existing journey: every SIGN IN affordance
            navigates here and AuthScreen sends the visitor back where they
            came from once a session exists. The old shape — AuthScreen
            rendered ABOVE the router as a wall — is gone, and
            routeAccess.test.js keeps it gone. */}
        <Route path="/auth"                   element={<AuthScreen />} />
        {/* ⭐ WHERE A RESET LINK LANDS. Signed OUT is its normal state — the
            whole point is that the person cannot sign in — so this route must
            never sit behind a session gate. lib/passwordRecovery puts the
            browser here before the router reads the hash. */}
        <Route path="/reset-password"         element={<ResetPasswordScreen />} />
        {/* O3 · the one post-signup question. Reached ONLY as the destination
            postAuthDestination picks for a fresh signup with no returnIntent
            — never on sign-in, and never when an intent is waiting. */}
        <Route path="/start"                  element={<StartScreen />} />
        {/* DEV ONLY — Event Page layout harness. Tree-shaken out of the
            production bundle by the import.meta.env.DEV guard. */}
        {import.meta.env.DEV && (
          <Route path="/dev/event-layout"     element={<EventLayoutHarness />} />
        )}
        {/* DEV ONLY — the sticker effects harness. Same DEV guard, same
            reason: the effects have to be judged on real artwork against real
            backgrounds, not from pixel statistics. */}
        {import.meta.env.DEV && (
          <Route path="/dev/stickers"         element={<StickerHarness />} />
        )}
        {/* DEV ONLY — the public schedule projection (S3), against the real
            Solstice rows. The event-layout harness above does not cover set
            times, and the one event that has a schedule keeps it private. */}
        {import.meta.env.DEV && (
          <Route path="/dev/schedule"         element={<ScheduleHarness />} />
        )}
        {/* DEV ONLY — the QR surfaces, which otherwise only exist behind a
            venue or host dashboard. Same reason ScheduleHarness exists. */}
        {import.meta.env.DEV && (
          <Route path="/dev/qr"               element={<QrHarness />} />
        )}
        <Route path="/create-event"           element={<CreateEventScreen />} />
        <Route path="/event/:id/applications" element={<ApplicationsScreen />} />
        <Route path="/notifications"          element={<NotificationsScreen />} />
        <Route path="/calendar"               element={<CalendarScreen />} />
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
        <Route path="/role-select"       element={<RoleSelectorScreen session={session} />} />
        <Route path="/profile/:id"       element={<ProfileScreen />} />
        <Route path="/profile-edit"      element={<ProfileEditScreen />} />
        {/* The Messenger identity (avatar + display name). Reached from the
            name in My Scene and the avatar in Messages — both land here. */}
        <Route path="/me"                element={<MessengerIdentityScreen />} />
        {/**
          * ⛔⛔ NOTHING MATCHED — SAY SO, ⛔ never render nothing.
          *
          * ⚠⚠ There was no catch-all at all, so ANY wrong link produced a
          * blank page: header, watermark, bottom nav, and no content. A real
          * one shipped — InviteSheet's VIEW OUTGOING ENQUIRIES pointed at
          * `/venue` instead of `/industry/venue` — and it looked like a broken
          * screen rather than a broken link, which is why it went unreported.
          *
          * ⛔ NOT a silent redirect to What's On: that hides the next one
          * exactly as well. A reader who sees this can say what they pressed.
          */}
        <Route path="*" element={<RouteNotFound />} />
      </Routes>
      </ErrorBoundary>
      <BottomNav
        activeTab={industryOpen ? 'industry' : activeTab}
        onTabPress={handleTabPress}
        messagesBadge={messagesBadge}
      />

      {/* ⚠ Mounted once, at the root, and OUTSIDE the routes. A tab left open
          for hours is exactly the case this exists for, so it must not unmount
          and restart its check every time someone changes screen. */}
      <UpdateBanner />

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
            hasNext={hasNextDemo(player)}
            hasPrev={hasPrevDemo(player)}
            onClose={() => setPlayer(null)}
            /* ⭐ The queue's arithmetic lives in lib/playerQueue.js, where
               "forward and back are exact inverses" is a tested property
               rather than a claim. ⚠ `advance` returns null when the queue is
               empty, which is the same outcome as a single mix finishing:
               close the player. */
            onFinish={() => setPlayer(advance(player))}
            onNext={() => { if (hasNextDemo(player)) setPlayer(advance(player)); }}
            onPrev={() => setPlayer(rewind(player))}
          />
        </div>
      )}

      {/* Industry bottom-sheet panel — v1 style */}
      <IndustryPanel
        open={industryOpen}
        onClose={() => setIndustryOpen(false)}
        /* `mode` is the auth tab to open on — CREATE FREE ACCOUNT must not
           land on a sign-in form. Ignored for every other destination. */
        onNavigate={(path, mode) => {
          setIndustryOpen(false);
          navigate(path, mode ? { state: { mode } } : undefined);
        }}
        session={session}
      />
      {/* ⚠ BOUNDED, and this is not optional.
          The dock is mounted ABOVE the router so it survives navigation — which
          also means an error inside it unmounts the ENTIRE app, router and all.
          That is not theoretical: it renders as a blank splash with `#root`
          empty, which reads as "the site is down" rather than "messaging
          broke". Bounded, a dock failure costs the dock and nothing else. */}
      {/* O4 · offered only when something just happened that a notification
          would answer — see lib/pushPrompt. Mounted once, above the router,
          so the moment can be announced from anywhere. */}
      <PushValuePrompt />
      {/* O4 · one sentence, the first time a concept becomes true. ⛔ Not a
          tour — see lib/firstUseTeach. */}
      <FirstUseTeach />
      <ErrorBoundary>
        <ConversationDock />
      </ErrorBoundary>
      </ConversationUiProvider>
      </ParticipationProvider>
      </InviteSuppressCtx.Provider>
      </ShareTargetProvider>
    </PlayerCtx.Provider>
  );
}

export default function App() {
  const [session,  setSession]  = useState(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setAnalyticsUser(s?.user?.id ?? null);
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
   * WARM THE INBOX as soon as there is a session to warm it for.
   *
   * Messages is the slowest first paint in the app — a five-step waterfall
   * (conversations → participants → which are mine → an unread count each →
   * latest message each) — and the first tap is the one visit with nothing in
   * cache, so it is the visit that shows LOADING… longest. Worse, a cold
   * Messages screen reads as "you have no messages", which is a lie the app
   * tells exactly once, to everyone, on the tap where they are deciding
   * whether this part of the app has anything in it.
   *
   * Own effect, keyed on the USER — not folded into the open effect above,
   * which runs once with `[]` deps before `getSession()` has resolved. This one
   * fires the moment a session appears, whether that is a restored session at
   * launch or a fresh sign-in, and again if the user switches account.
   *
   * ⛔ NOT gated on the route, and ⛔ not a subscription: it fills the cache
   * once and stops. prefetchInbox declines when there is no user or when the
   * key already holds data, so a guest pays nothing and StrictMode's second
   * pass is free. Everything after the first visit was already instant from
   * staleTime; this only moves the first one out of the user's way.
   */
  useEffect(() => {
    prefetchInbox(queryClient, session?.user?.id);
  }, [session?.user?.id]);

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

  /**
   * ⭐⭐ THERE IS NO AUTH WALL, AND THERE MUST NEVER BE ONE AGAIN (owner,
   * 2026-08-12). Discovery is anonymous; participation is identified.
   *
   * The router mounts unconditionally — a QR scan, a shared link, a cold
   * visit all land on real content with no session. Authentication is a
   * property of route/action access (lib/routeAccess.js declares which), not
   * the application's boot condition. "Guest" is not a state: `!session` is
   * the whole fact, and the old `yp_guest` sessionStorage flag is deleted —
   * routeAccess.test.js fails the suite if either concept returns.
   */

  function handleSignOut() {
    clearActingProfileCache();  // M6: a cached profile id must not outlive its session
    clearIntent();              // O2: a pending intent must not outlive it either
    // ⏱ TEMPORARY — marks this SIGNED_OUT as user-initiated. GoTrue emits the
    // same event whether the button was pressed or a refresh was rejected, and
    // this is the app's only signOut call site. Labelling only.
    markExplicitSignOut();
    supabase.auth.signOut();
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SessionCtx.Provider value={{ session }}>
        <HashRouter>
          <Shell session={session} onSignOut={handleSignOut} />
        </HashRouter>
      </SessionCtx.Provider>
    </QueryClientProvider>
  );
}
