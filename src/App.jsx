import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import DataProvider from './data/DataProvider';
import SessionProvider from './auth/SessionProvider';
import SignInScreen from './auth/SignInScreen';
import { useSession } from './auth/useSession';
import AppShell from './shell/AppShell';
import ApplyScreen from './apply/ApplyScreen';
import OverviewScreen from './screens/OverviewScreen';
import ApplicationsScreen from './screens/ApplicationsScreen';
import AnnouncementsScreen from './screens/AnnouncementsScreen';
import FestivalScreen from './screens/FestivalScreen';
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
