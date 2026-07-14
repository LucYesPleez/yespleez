// Key order is the shared canonical role ordering for V2 (Venue first —
// reflects the platform's primary discovery flow). Object.keys/entries/values
// preserve insertion order, so anything that iterates PROFILE_TYPES directly
// (e.g. ProfileCard.jsx's TYPE_STYLES) inherits this order for free.
export const PROFILE_TYPES = {
  venue: {
    accent:     '#00E5A0',
    accent2:    '#00B4D8',
    rgb:        '0,229,160',
    emoji:      '📍',
    label:      'VENUE',
    pathPrefix: 'venue_avatars',
    dashPath:   '/industry/venue',
    gradient:   'linear-gradient(135deg, #00E5A0, #00B4D8)',
  },
  host: {
    accent:     '#FF2D78',
    accent2:    '#00E5FF',
    rgb:        '255,45,120',
    emoji:      '🎛️',
    label:      'HOST',
    pathPrefix: 'host_avatars',
    dashPath:   '/industry/host',
    gradient:   'linear-gradient(90deg, #FF2D78, #00E5FF)',
  },
  artist: {
    accent:     '#00E5FF',
    accent2:    '#FF3399',
    rgb:        '0,229,255',
    emoji:      '🎧',
    label:      'DJ / PRODUCER',
    pathPrefix: 'artist_avatars',
    dashPath:   '/industry/artist',
    gradient:   'linear-gradient(90deg, #00E5FF, #FF3399)',
  },
  band: {
    accent:     '#FFB830',
    accent2:    '#FF8C42',
    rgb:        '255,184,48',
    emoji:      '🎸',
    label:      'BAND',
    pathPrefix: 'band_avatars',
    dashPath:   '/industry/band',
    gradient:   'linear-gradient(90deg, #FFB830, #FF8C42)',
  },
  standup: {
    accent:     '#FF88AA',
    accent2:    '#BF5FFF',
    rgb:        '255,136,170',
    emoji:      '🎤',
    label:      'SPOKEN WORD',
    pathPrefix: 'standup_avatars',
    dashPath:   '/industry/standup',
    gradient:   'linear-gradient(90deg, #FF88AA, #BF5FFF)',
  },
};

// Canonical ordered list of type keys — reuse this instead of writing another
// hardcoded venue/host/artist/band/standup array (see FollowingSection.jsx).
export const PROFILE_TYPE_ORDER = Object.keys(PROFILE_TYPES);
