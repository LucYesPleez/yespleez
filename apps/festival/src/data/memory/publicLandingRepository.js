/**
 * LANDING PAGE — in-memory fixture.
 *
 * Same contract as the Supabase implementation, so the public landing screen
 * renders without a network (and before any festival event is live — anon
 * only sees `status = 'live'`, so a draft-only database renders nothing real).
 *
 * Values mirror the production demo festival as of 2026-08-26, with one
 * addition: a music closing date, so the "applications close" rendering is
 * exercised. The poster URL is a real public storage object; a fixture that
 * invented a URL would render the fallback hero and quietly stop exercising
 * the media path.
 */
export const publicLandingRepository = {
  async getLanding(eventId) {
    if (!eventId) return { found: false };
    return {
      found: true,
      event: {
        id: eventId,
        name: 'Echo Valley Festival 2026',
        applications_open: true,
        owner_profile_id: 'fixture-festival-profile',
        lat: null,
        lng: null,
        config: {
          poster:
            'https://doqzxvppibuzieajqkxm.supabase.co/storage/v1/object/public/posters/event_posters/imported/creatures-of-the-swamp-1785300192753.webp',
        },
      },
      profile: {
        id: 'fixture-festival-profile',
        name: 'Echo Valley Festival',
        tagline: 'An immersive celebration of music, art and community in the Australian bush.',
        bio: 'Echo Valley Festival is a fictional event created to demonstrate the YesPleez Festival Portal.\n\nThe festival showcases how organisers can recruit volunteers, artists, market stalls, workshops and crew through a single application platform. Applicants create reusable YesPleez profiles, apply in minutes and build a verified reputation that grows with every event.\n\nThis demo contains sample data only.',
        location: 'Mid North Coast, NSW, Australia',
        website: 'https://www.echofestival.demo',
        avatar: null,
        avatar_hero: null,
        avatar_thumb: null,
      },
      settings: { starts_on: '2026-11-12', ends_on: '2026-11-15' },
      categories: [
        { key: 'music', state: 'open', opens_at: null, closes_at: '2026-10-02', intent: 'open_call' },
        { key: 'volunteer', state: 'open', opens_at: null, closes_at: null, intent: 'open_call' },
      ],
      departments: [
        { name: 'Front Gate' },
        { name: 'Volunteer HQ' },
        { name: 'Artist Services' },
        { name: 'Site Crew' },
        { name: 'Build Crew' },
        { name: 'Pack-down Crew' },
      ],
    };
  },
};
