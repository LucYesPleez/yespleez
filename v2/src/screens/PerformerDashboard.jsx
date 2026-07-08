import ArtistDashboard from './ArtistDashboard';

const CONFIGS = {
  band: {
    headingLine1:     'BAND /',
    headingLine2:     'MUSO',
    gradient:         'linear-gradient(135deg,#FF4500,#FF8C42,#FFB830,#FFE066)',
    accent:           '#FF8C42',
    accentRgb:        '255,140,66',
    profileType:      'band',
    setupPath:        '/industry/band/setup',
    profilePath:      (id) => `/profile/${id}?type=band`,
    browseLabel:      'BROWSE OPEN EVENTS →',
    setupPlaceholder: 'Set up your band profile',
  },
  standup: {
    headingLine1:     'STAND UP',
    headingLine2:     '/ POETRY',
    gradient:         'linear-gradient(90deg,#FF88AA,#BF5FFF)',
    accent:           '#FF88AA',
    accentRgb:        '255,136,170',
    profileType:      'standup',
    setupPath:        '/industry/standup/setup',
    profilePath:      (id) => `/profile/${id}?type=standup`,
    browseLabel:      'BROWSE OPEN CALLS →',
    setupPlaceholder: 'Set up your comedy / poetry profile',
  },
};

export default function PerformerDashboard({ userId, role }) {
  return <ArtistDashboard userId={userId} config={CONFIGS[role] || CONFIGS.band} />;
}
