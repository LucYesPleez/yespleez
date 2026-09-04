import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import DataProvider from './data/DataProvider';
import SessionProvider from './auth/SessionProvider';
import SignInScreen from './auth/SignInScreen';
import CreateFestivalScreen from './auth/CreateFestivalScreen';
import InviteOnly from './auth/InviteOnlyScreen';
import { useSession } from './auth/useSession';
import { useRepositories } from './data/dataContext';
import { useQuery } from './data/useQuery';
import AppShell from './shell/AppShell';
import CompanionShell from './companion/CompanionShell';
import CompanionHome from './companion/HomeScreen';
import CompanionPeople from './companion/PeopleScreen';
import PeopleScreen from './screens/PeopleScreen';
import CompanionMore from './companion/MoreScreen';
import OverviewScreen from './screens/OverviewScreen';
import ApplicationsScreen from './screens/ApplicationsScreen';
import AnnouncementsScreen from './screens/AnnouncementsScreen';
import FestivalScreen from './screens/FestivalScreen';
import EventEditorScreen from './screens/EventEditorScreen';
import SettingsScreen from './screens/SettingsScreen';
import VolunteerProfileScreen from './screens/VolunteerProfileScreen';
import VolunteerProfileHarness from './screens/VolunteerProfileHarness';
import MessagesScreen from './screens/MessagesScreen';
import { HelpScreen } from './screens/stubs';
import FestivalLandingScreen from './public/FestivalLandingScreen';

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
 * ⭐ THIS APP HAS EXACTLY ONE PUBLIC SURFACE: `/f/:eventId`, the festival
 * landing page (owner, 2026-08-26). It PRESENTS a festival — identity, dates,
 * open categories — and every APPLY on it hands the visitor to Scene's event
 * page. It writes nothing.
 *
 * ⛔ What SURVIVES of the 2026-08-06 ruling is the part that mattered:
 * `/apply/:eventId` stays gone, and there is still exactly ONE public surface
 * writing `festival_applications` — Scene's. A landing page that grows a form
 * is that deleted second apply surface coming back; see config/scene.js and
 * publicLandingRepository. Every OTHER route below is the organiser's
 * workspace and requires a session.
 */
/**
 * ⭐ THE BETA ALLOWLIST — who may use the ORGANISER side at all.
 *
 * Comma-separated emails in VITE_ORGANISER_ALLOWLIST. ⚠ FAIL-CLOSED: if the
 * variable is missing, nobody gets in. The alternative — open when unset —
 * means one forgotten env var on a deploy silently turns a private beta into a
 * public one, and nobody notices until a stranger owns a festival. A closed
 * door that needs a key configured is the failure mode you can see.
 *
 * ⭐ Nothing sits outside this any more. The application link an organiser sends
 * out points at Scene, so no unauthenticated person ever loads this app.
 *
 * ⚠ This is a UI gate only. The database-side lock is a restrictive RLS policy
 * on festival-profile creation — a client check alone is cosmetic.
 */
const ALLOWLIST = (import.meta.env.VITE_ORGANISER_ALLOWLIST ?? '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

function Gate({ children }) {
  const { session, loading, signOut } = useSession();
  if (loading) return null;
  if (!session) return <SignInScreen />;
  if (!ALLOWLIST.includes((session.user?.email ?? '').toLowerCase())) {
    return <InviteOnly email={session.user?.email} onSignOut={signOut} />;
  }
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
            {/* ⭐ THE ONE PUBLIC ROUTE — outside the Gate on purpose, inside
                DataProvider because its reads follow the same repository law
                as everything else. Anonymous by design; see the screen's
                header before adding anything that writes or signs in. */}
            <Route path="/f/:eventId" element={<FestivalLandingScreen />} />

            {/* DEV ONLY — the volunteer editor against fixtures. Outside the
                Gate because the whole point is to see it WITHOUT signing in as
                an allowlisted organiser, and tree-shaken out of the production
                bundle by the guard. ⛔ This is not a second public surface:
                `import.meta.env.DEV` means it does not exist in a build. */}
            {import.meta.env.DEV && (
              <Route path="/dev/volunteer-profile" element={<VolunteerProfileHarness />} />
            )}

            {/* Gate wraps the SHELL, not each screen: AppShell renders the
                Outlet, so the child routes below still resolve normally. */}
            {/* ⭐ THE COMPANION — the same six rooms at mobile density, behind
                the same gate. Its own shell rather than a responsive AppShell:
                a docked inspector and a persistent sidebar have no mobile
                equivalent, and pretending otherwise produces a desktop layout
                squeezed onto a phone. It provides the identical ShellContext,
                so existing screens can move in unchanged as each is made
                mobile. */}
            <Route path="/companion" element={<Gate><CompanionShell /></Gate>}>
              <Route index element={<CompanionHome />} />
              <Route path="people" element={<CompanionPeople />} />
              <Route path="more" element={<CompanionMore />} />
            </Route>

            <Route element={<Gate><AppShell /></Gate>}>
              <Route index element={<Navigate to="/applications" replace />} />
              <Route path="/overview" element={<OverviewScreen />} />
              <Route path="/applications" element={<ApplicationsScreen />} />
              <Route path="/applications/:category" element={<ApplicationsScreen />} />
              <Route path="/people" element={<PeopleScreen />} />
              <Route path="/messages" element={<MessagesScreen />} />
              <Route path="/announcements" element={<AnnouncementsScreen />} />
              <Route path="/festival" element={<FestivalScreen />} />
              {/* Inside Festival, not a seventh destination — the navigation
                  law holds at six and adding one is an architecture decision. */}
              <Route path="/festival/event/:eventId" element={<EventEditorScreen />} />
              <Route path="/settings" element={<SettingsScreen />} />
              {/* ⭐ THE PERSON'S OWN ROLE PROFILE — a route inside Settings, not
                  a seventh room. Reused at every festival, so it is deliberately
                  NOT scoped by the selected event. See the screen's header for
                  who can currently reach it, which is a live question. */}
              <Route path="/settings/volunteer-profile" element={<VolunteerProfileScreen />} />
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
