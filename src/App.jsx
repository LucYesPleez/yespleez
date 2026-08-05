import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import DataProvider from './data/DataProvider';
import SessionProvider from './auth/SessionProvider';
import SignInScreen from './auth/SignInScreen';
import { useSession } from './auth/useSession';
import AppShell from './shell/AppShell';
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
 */
/**
 * The gate.
 *
 * ⚠ Not decoration. RLS scopes applications to the festival owner through
 * `auth.uid()`, so without a session every application query returns zero rows
 * — the dashboard would render an empty table rather than an error, which is
 * the most misleading possible failure.
 *
 * Renders nothing while the session resolves: a sign-in form that flashes for
 * one frame and vanishes reads as a bug to someone who is already signed in.
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
      <Gate>
        <AuthedApp />
      </Gate>
    </SessionProvider>
  );
}

function AuthedApp() {
  return (
    <DataProvider>
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
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
  );
}
