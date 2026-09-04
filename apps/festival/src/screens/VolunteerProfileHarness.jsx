import DataProvider from '../data/DataProvider';
import VolunteerProfileEditor from '../festival/VolunteerProfileEditor';
import s from './screens.module.css';

/**
 * DEV ONLY — the volunteer role-profile editor, rendered against fixtures.
 *
 * ⭐⭐ WHY THIS EXISTS. Every other route in this app is behind the organiser
 * allowlist AND a real Supabase session, so the editor cannot be looked at
 * without signing in as somebody. A screen whose only proof is a green test
 * suite is a screen nobody has seen — and this repository has already shipped a
 * page that built, linted and passed its tests while being unable to render.
 *
 * ⭐ IT USES THE APP'S OWN SWAP POINT, not a copy of it. `DataProvider` takes
 * injected repositories precisely so the UI renders without a network; this is
 * the first caller to use that, and it uses it exactly as the header describes.
 *
 * ⛔ NOT A PREVIEW OF THE DATA. The fixtures are obviously fictional on
 * purpose. A harness seeded with plausible-looking real data is how a fixture
 * ends up being mistaken for a production read.
 *
 * ⛔ It is tree-shaken out of the production bundle by the `import.meta.env.DEV`
 * guard on its route, the same guard Scene's four harnesses use.
 */

/** A person who has answered some of it, so both the empty and the filled
 *  states of every control are visible at once. */
const FIXTURE = {
  profile: {
    id: 'fixture-punter', name: 'Fixture Person',
    avatar: null, location: 'Bellingen', state: 'NSW',
    contact_email: 'fixture@example.test', emergency_name: null,
    emergency_phone: null, age: '31',
  },
  person: { user_id: 'fixture-user', dob: '1990-04-02', street_address: '12 Hyde St' },
  data: {
    currentProfession: 'Rigger',
    volunteerExperience: 'OTHER_EVENTS',
    experienceDescription: 'Front gate at two bush doofs, 2024 and 2025.',
    skills: 'Rigging, truck licence, basic first aid',
    capabilities: ['BUILDING_CARPENTRY', 'WHITE_CARD'],
  },
};

/**
 * ⚠ The writes RESOLVE and change nothing. A harness whose Save throws teaches
 * you the button is broken; one that silently pretends to persist teaches you
 * it works. This does neither — it logs, so what was about to be written is
 * visible in the console and obviously went nowhere.
 */
const fixtureRepositories = {
  roleProfiles: {
    async getPersonProfile() { return FIXTURE.profile; },
    async getPersonPrivate() { return FIXTURE.person; },
    async getRoleProfile() { return { id: 'fixture-role', data: FIXTURE.data }; },
    async savePersonPrivate(details) { console.info('[harness] person_private <-', details); },
    async saveRoleProfile(profileId, data) { console.info('[harness] festival_role_profiles <-', profileId, data); },
  },
};

export default function VolunteerProfileHarness() {
  return (
    <DataProvider repositories={fixtureRepositories}>
      <div className={s.page}>
        <header className={s.pageHead}>
          <div>
            <h1 className={s.pageTitle}>Volunteer profile — harness</h1>
            <p className={s.pageSubtitle}>
              Fixtures, not your account. Saving writes nothing and logs what it would have sent.
            </p>
          </div>
        </header>
        <VolunteerProfileEditor />
      </div>
    </DataProvider>
  );
}
