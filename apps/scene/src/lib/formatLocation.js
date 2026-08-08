// Single shared formatter for displaying a profile/venue/event's location as
// "Suburb, STATE POSTCODE" — consolidates what used to be several separate
// `[a, b].filter(Boolean).join(', ')` call sites (ProfileCard, ProfileScreen,
// DashboardProfileCard, EnquiryCard, ApplicationCard, InviteSheet, and
// HostDashboard's AppCard), each missing postcode and none defending against
// a stray trailing comma already baked into a stored field value (the
// "Bellingen,, NSW" bug — filter(Boolean) alone doesn't catch that, since a
// non-empty string like "Bellingen," is truthy).
//
// Field-name note: artist/band/host/standup profiles store the suburb/town in
// a column literally called `location`; venue profiles have a dedicated
// `suburb` column (with `location` instead holding the street address for
// venues). Passing both `suburb` and `location` here and preferring `suburb`
// handles that inconsistency without needing to know which profile type you're
// formatting.
function clean(val) {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  if (!str || str.toUpperCase() === 'N/A') return '';
  // Strip stray leading/trailing punctuation left over from bad stored data
  // (e.g. a suburb value of "Bellingen," saved before this formatter existed).
  return str.replace(/^[,\s]+|[,\s]+$/g, '');
}

export function formatLocation({ suburb, location, state, postcode } = {}) {
  const town = clean(suburb) || clean(location);
  const st   = clean(state);
  const pc   = clean(postcode);

  const townState = [town, st].filter(Boolean).join(', ');
  if (!townState) return pc; // only postcode (or nothing) available
  return pc ? `${townState} ${pc}` : townState;
}
