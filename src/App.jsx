import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import DataProvider from './data/DataProvider';
import SessionProvider from './auth/SessionProvider';
import SignInScreen from './auth/SignInScreen';
import CreateFestivalScreen from './auth/CreateFestivalScreen';
import { useSession } from './auth/useSession';
import { useRepositories } from './data/dataContext';
import { useQuery } from './data/useQuery';
import AppShell from './shell/AppShell';
import ApplyScreen from './apply/ApplyScreen';
import OverviewScreen from './screens/OverviewScreen';
import ApplicationsScreen from './screens/ApplicationsScreen';
import AnnouncementsScreen from './screens/AnnouncementsScreen';
import FestivalScreen from './screens/FestivalScreen';
import EventEditorScreen from './screens/EventEditorScreen';
import SettingsScreen from './screens/SettingsScreen';
import MessagesScreen from './screens/MessagesScreen';
import { HelpScreen } from './screens/stubs';

/**
 * Routing.
 *
 * HashRouter matches the Scene app, so links behave identically across
 * portals and neither needs server-side rewrite rules.
 *
 * ⭐ Note what is NOT here: nine category routes. `/applications/:category`
 * is one screen resolving a configuration, which is what keeps the table the
 * single source of truth. The category is in the URL so a view is shareable
 * and survives a reload — that is UI state, not application state.
 *
 * ⭐ `/apply/:eventId` sits OUTSIDE the gate. It is the public face of the
 * whole product — the link a festival sends out — and it must render for
 * someone with no account at all. Everything else is the organiser's
 * workspace and requires a session.
 */
function Gate({ children }) {
  const { session, loading } = useSession();
  if (loading) return null;
  if (!session) return <SignInScreen />;
  return <FestivalGate>{children}</FestivalGate>;
}

/**
 * ⭐ The second gate: signed in, but owning no festival. This is how every NEW
 * organiser arrives, and the answer is onboarding — not the shell rendering
 * over empty repositories, and never an error. Sits inside the auth gate so it
 * only ever asks the question of a real session, and OUTSIDE the shell so no
 * event-scoped query runs before there is anything to scope to.
 */
function FestivalGate({ children }) {
  const { session } = useSession();
  const { festivals } = useRepositories();
  const { data: profile, loading, reload } = useQuery(
    () => festivals.getProfileOrNull(),
    [session?.user?.id],
  );
  if (loading) return null;
  if (!profile) return <CreateFestivalScreen onCreated={reload} />;
  return children;
}

export default function App() {
  return (
    <SessionProvider>
      <DataProvider>
        <HashRouter>
          <Routes>
            <Route path="/apply/:eventId" element={<ApplyScreen />} />

            {/* Gate wraps the SHELL, not each screen: AppShell renders the
                Outlet, so the child routes below still resolve normally. */}
            <Route element={<Gate><AppShell /></Gate>}>
              <Route index element={<Navigate to="/applications" replace />} />
              <Route path="/overview" element={<OverviewScreen />} />
              <Route path="/applications" element={<ApplicationsScreen />} />
              <Route path="/applications/:category" element={<ApplicationsScreen />} />
              <Route path="/messages" element={<MessagesScreen />} />
              <Route path="/announcements" element={<AnnouncementsScreen />} />
              <Route path="/festival" element={<FestivalScreen />} />
              {/* Inside Festival, not a seventh destination — the navigation
                  law holds at six and adding one is an architecture decision. */}
              <Route path="/festival/event/:eventId" element={<EventEditorScreen />} />
              <Route path="/settings" element={<SettingsScreen />} />
              <Route path="/help" element={<HelpScreen />} />
              {/* Applications is the front door, not Overview: the workspace is
                  where the work is, and an unknown path should land in it. */}
              <Route path="*" element={<Navigate to="/applications" replace />} />
            </Route>
          </Routes>
        </HashRouter>
      </DataProvider>
    </SessionProvider>
  );
}
