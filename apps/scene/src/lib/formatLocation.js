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

/**
 * ⭐⭐ THE TOWN THIS PROFILE SHOWS ON ITS FACE — and the only correct answer to
 * "where does this card say it is from".
 *
 * ⛔⛔ THE ORDER IS `suburb` FIRST. See the note above: a venue keeps its STREET
 * ADDRESS in `location`, so `location || suburb` reads "3/5 Church St" for a
 * venue whose card plainly says Bellingen.
 *
 * ⚠⚠ THAT IS NOT HYPOTHETICAL. LocalsRails wrote its own `location || suburb`
 * and filtered LOCALS on it: at radius 0 every Bellingen venue with a street
 * address — the Brewing Co, the Memorial Hall, the Golf Club — failed to
 * resolve and vanished, leaving the single venue whose `location` happened to
 * be null. A signed-in local saw one venue; signed out, with no filter, the
 * same page showed five. Exported so there is ONE reading of this question and
 * a filter can never disagree with the card it is filtering.
 */
export function displayTown({ suburb, location } = {}) {
  return clean(suburb) || clean(location);
}

export function formatLocation({ suburb, location, state, postcode } = {}) {
  const town = displayTown({ suburb, location });
  const st   = clean(state);
  const pc   = clean(postcode);

  const townState = [town, st].filter(Boolean).join(', ');
  if (!townState) return pc; // only postcode (or nothing) available
  return pc ? `${townState} ${pc}` : townState;
}
