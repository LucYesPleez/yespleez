import { EmptyState } from '../../design-system';
import ProfileTab from './ProfileTab';
import StubTab from './StubTab';

/**
 * THE INSPECTOR TAB REGISTRY.
 *
 * ⭐ This is what makes "add inspector tabs later without redesign" true
 * rather than aspirational. A tab is a data entry: a key, a label, and a
 * component. Adding "Contracts" or "Onboarding" in a year is one entry here
 * and one new file — InspectorPanel, InspectorTabs and every screen stay
 * untouched.
 *
 * Two rules keep it that way:
 *   1. A tab component receives ONLY `{ selection }`. A tab needing anything
 *      else fetches it itself; widening this contract would make every
 *      existing tab a party to the new one's requirements.
 *   2. Tabs render into a scrolling column and own their own sections. The
 *      panel never styles a tab's insides.
 *
 * `available` is optional — a predicate for tabs that only apply to some
 * categories (a Media tab is meaningless for a volunteer). Absent means
 * always shown.
 */
export const INSPECTOR_TABS = [
  {
    key: 'profile',
    label: 'Profile',
    Component: ProfileTab,
  },
  {
    key: 'application',
    label: 'Application',
    Component: () => (
      <StubTab
        title="Submitted answers"
        note="The question set exactly as it was answered, frozen at submission — never re-read from the applicant's live profile."
      />
    ),
  },
  {
    key: 'media',
    label: 'Media',
    Component: () => (
      <StubTab
        title="Files & links"
        note="Press kit, stage plot, rider, photos. Preserved with the application so a decision stays re-readable after the applicant edits their profile."
      />
    ),
  },
  {
    key: 'notes',
    label: 'Notes',
    Component: () => (
      <EmptyState
        icon="notes"
        title="No notes yet"
        body="Notes are visible to your whole team and never to the applicant."
        action="Add a note"
        compact
      />
    ),
  },
  {
    key: 'activity',
    label: 'Activity',
    Component: () => (
      <StubTab
        title="History"
        note="Every status change, decision, note and message, in order. Append-only — nothing here is ever edited or removed."
      />
    ),
  },
];

export function getTab(key) {
  return INSPECTOR_TABS.find(t => t.key === key) || INSPECTOR_TABS[0];
}
