import ArtistDashboard from './ArtistDashboard';
import { PROFILE_TYPES } from '../lib/profileTypes';

// headingLine1/2 are this dashboard's own content (how the heading wraps to
// two lines) and stay local. gradient/accent/accentRgb derive from
// PROFILE_TYPES — both used to hand-type these and had drifted: both
// gradients incorrectly ended in Venue's teal (#00B4D8), and Band's accent
// pointed at its accent2 (#FF8C42) instead of its real accent (#FFB830).
const CONFIGS = {
  band: {
    headingLine1:     'BAND /',
    headingLine2:     'MUSO',
    gradient:         PROFILE_TYPES.band.gradient,
    accent:           PROFILE_TYPES.band.accent,
    accentRgb:        PROFILE_TYPES.band.rgb,
    profileType:      'band',
    setupPath:        '/industry/band/setup',
    browseLabel:      'BROWSE OPEN EVENTS →',
    setupPlaceholder: 'Set up your band profile',
  },
  standup: {
    headingLine1:     'STAND UP',
    headingLine2:     '/ POETRY',
    gradient:         PROFILE_TYPES.standup.gradient,
    accent:           PROFILE_TYPES.standup.accent,
    accentRgb:        PROFILE_TYPES.standup.rgb,
    profileType:      'standup',
    setupPath:        '/industry/standup/setup',
    browseLabel:      'BROWSE OPEN CALLS →',
    setupPlaceholder: 'Set up your comedy / poetry profile',
  },
};

export default function PerformerDashboard({ userId, role }) {
  return <ArtistDashboard userId={userId} config={CONFIGS[role] || CONFIGS.band} />;
}
