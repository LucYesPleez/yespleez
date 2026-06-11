// ─────────────────────────────────────────────────────────────
//  Bellingen Events Seed Script
//  Paste this entire file into the browser console while logged
//  into YesPleez as a host. Run once only.
// ─────────────────────────────────────────────────────────────

(async () => {
  if (!currentUser?.id || !currentSession?.access_token) {
    console.error('Not logged in — sign in to YesPleez first then re-run.');
    return;
  }

  const hostId = currentUser.id;

  const events = [
    {
      name: 'Laura Targett – The Road to Tpot Album Launch',
      config: {
        date: '2026-06-20',
        venue: 'Bellingen Memorial Hall',
        town: 'Bellingen',
        genres: 'Live Music, Album Launch',
        lineup: 'Laura Targett, Conor McDonald, Emiliano Beltzer, Matt Ledgar, Shay O\'Sheehan',
        description: 'Album launch performance featuring Laura Targett and full band',
        applications_open: false,
        is_public: true,
        _accent: '#FF8C42',
        days: []
      }
    },
    {
      name: 'Jazz in the Old Supper Room feat. OhMaSoul',
      config: {
        date: '2026-06-20',
        venue: 'The Old Supper Room',
        town: 'Bellingen',
        genres: 'Jazz, Soul',
        lineup: 'OhMaSoul, Jemimah Hiscox, James Brinkhoff',
        description: 'Jazz, soul and groove performance',
        applications_open: false,
        is_public: true,
        _accent: '#9D4EDD',
        days: []
      }
    },
    {
      name: 'Alexandr Misko – International Guitar Sensation',
      config: {
        date: '2026-06-24',
        venue: '',
        town: 'Bellingen',
        genres: 'Live Music, Acoustic',
        lineup: 'Alexandr Misko',
        description: 'International fingerstyle guitar performance',
        applications_open: false,
        is_public: true,
        _accent: '#00E5FF',
        days: []
      }
    },
    {
      name: 'Gospel Sunday with Harry James Angus',
      config: {
        date: '2026-06-14',
        venue: '',
        town: 'Bellingen',
        genres: 'Live Music, Gospel',
        lineup: 'Harry James Angus',
        description: 'Gospel-inspired live performance',
        applications_open: false,
        is_public: true,
        _accent: '#FFE066',
        days: []
      }
    },
    {
      name: 'Travellin\' North with a Song',
      config: {
        date: '2026-06-15',
        venue: 'Bellingen Memorial Hall',
        town: 'Bellingen',
        genres: 'Choral Music, Classical',
        lineup: 'Sydney Male Choir, Akabella Community Choir',
        description: 'Choral concert',
        applications_open: false,
        is_public: true,
        _accent: '#FF3399',
        days: []
      }
    },
    {
      name: 'NOSTALGIA Music Concert',
      config: {
        date: '2026-07-26',
        venue: '',
        town: 'Bellingen',
        genres: 'Live Music',
        lineup: '',
        description: 'Live music concert',
        applications_open: false,
        is_public: true,
        _accent: '#9D4EDD',
        days: []
      }
    },
    {
      name: 'Beyond Jazz Weekender',
      config: {
        date: '2026-08-14',
        venue: 'Multiple Venues',
        town: 'Bellingen',
        genres: 'Jazz Festival, Jazz',
        lineup: 'Jazz Doof, Jazz Social',
        description: 'Multi-day jazz festival — 14 & 15 August',
        applications_open: false,
        is_public: true,
        _accent: '#FFB830',
        days: []
      }
    },
    {
      name: 'Kevin Morby – Little Wide Open Tour',
      config: {
        date: '2026-11-13',
        venue: '',
        town: 'Bellingen',
        genres: 'Live Music, Indie Folk',
        lineup: 'Kevin Morby',
        description: 'Australian tour appearance',
        applications_open: false,
        is_public: true,
        _accent: '#00E5FF',
        days: []
      }
    }
  ];

  let inserted = 0;
  let failed = 0;

  for (const ev of events) {
    try {
      const payload = {
        name: ev.name,
        config: ev.config,
        host_id: hostId,
        status: 'live',
        is_public: true,
        applications_open: false,
        host_controls: {}
      };
      await sbRest('events', {
        method: 'POST',
        body: JSON.stringify(payload)
      }, currentSession.access_token);
      console.log(`✓ Inserted: ${ev.name}`);
      inserted++;
    } catch (e) {
      console.error(`✗ Failed: ${ev.name}`, e.message);
      failed++;
    }
  }

  console.log(`\n--- Done: ${inserted} inserted, ${failed} failed ---`);
  if (inserted > 0) console.log('Refresh the app to see the events in What\'s Happenin\'.');
})();
