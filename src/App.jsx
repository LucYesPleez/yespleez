import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import FestivalLayout from './layout/FestivalLayout';
import DashboardScreen from './screens/DashboardScreen';
import ApplicationsScreen from './screens/ApplicationsScreen';
import {
  MessagesScreen,
  AnnouncementsScreen,
  FestivalProfileScreen,
  SettingsScreen,
  HelpScreen,
} from './screens/stubs';

/**
 * Routing.
 *
 * HashRouter matches the Scene app, so links behave identically across
 * portals and neither needs server-side rewrite rules.
 *
 * Every route renders inside FestivalLayout — the shell is not something a
 * screen opts into. `/applications` and `/applications/:category` share one
 * screen; see ApplicationsScreen for why there are not nine of them.
 */
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<FestivalLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardScreen />} />
          <Route path="/applications" element={<ApplicationsScreen />} />
          <Route path="/applications/:category" element={<ApplicationsScreen />} />
          <Route path="/messages" element={<MessagesScreen />} />
          <Route path="/announcements" element={<AnnouncementsScreen />} />
          <Route path="/profile" element={<FestivalProfileScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/help" element={<HelpScreen />} />
          {/* An unknown path lands on the dashboard rather than a dead end. */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
