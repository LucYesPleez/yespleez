/**
 * Shell placeholder threads.
 *
 * ⚠ Same status as `placeholderRows.js` — not mock data, not a fixture. They
 * exist so the list's real behaviour is reviewable: unread weighting, preview
 * truncation, how a long applicant name sits beside a timestamp.
 *
 * Delete when the messaging system is wired. Only MessagesScreen imports it.
 */
export const PLACEHOLDER_THREADS = [
  { id: 't1', name: 'Solar Wave',      category: 'Music',       unread: 2, when: '10:24 AM',
    preview: 'Hi! Just checking if there’s an update on our application?' },
  { id: 't2', name: 'Willow Markets',  category: 'Market Stalls', unread: 1, when: 'Yesterday',
    preview: 'Our public liability certificate expires in March — is that a problem?' },
  { id: 't3', name: 'Forest Dwellers', category: 'Music',       unread: 0, when: 'Yesterday',
    preview: 'Thanks for considering our application. Looking forward to hearing back.' },
  { id: 't4', name: 'Kai Flame',       category: 'Performance', unread: 0, when: '2 days ago',
    preview: 'Sending through the updated stage plot now.' },
  { id: 't5', name: 'Ruby Sun',        category: 'Volunteers',  unread: 0, when: '4 days ago',
    preview: 'I can do the whole weekend, not just Saturday.' },
];
