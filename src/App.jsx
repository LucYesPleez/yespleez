import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './shell/AppShell';
import OverviewScreen from './screens/OverviewScreen';
import ApplicationsScreen from './screens/ApplicationsScreen';
import {
  MessagesScreen,
  AnnouncementsScreen,
  FestivalScreen,
  SettingsScreen,
  HelpScreen,
} from './screens/stubs';

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
export default function App() {
  return (
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
  );
}
