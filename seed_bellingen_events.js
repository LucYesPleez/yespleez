(async () => {
  if (!currentUser || !currentUser.id || !currentSession || !currentSession.access_token) {
    console.error("Not logged in — sign in to YesPleez first then re-run.");
    return;
  }

  const hostId = currentUser.id;
  const token  = currentSession.access_token;

  const events = [
    {
      name: "Gospel Sunday with Harry James Angus",
      config: { date: "2026-06-14", venue: "", town: "Bellingen", genres: "Live Music, Gospel", lineup: "Harry James Angus", description: "Gospel-inspired live performance", is_public: true, applications_open: false, _accent: "#FFE066", days: [] }
    },
    {
      name: "Travellin North with a Song",
      config: { date: "2026-06-15", venue: "Bellingen Memorial Hall", town: "Bellingen", genres: "Choral Music, Classical", lineup: "Sydney Male Choir, Akabella Community Choir", description: "Choral concert", is_public: true, applications_open: false, _accent: "#FF3399", days: [] }
    },
    {
      name: "Laura Targett – The Road to Tpot Album Launch",
      config: { date: "2026-06-20", venue: "Bellingen Memorial Hall", town: "Bellingen", genres: "Live Music, Album Launch", lineup: "Laura Targett, Conor McDonald, Emiliano Beltzer, Matt Ledgar, Shay O'Sheehan", description: "Album launch performance featuring Laura Targett and full band", is_public: true, applications_open: false, _accent: "#FF8C42", days: [] }
    },
    {
      name: "Jazz in the Old Supper Room feat. OhMaSoul",
      config: { date: "2026-06-20", venue: "The Old Supper Room", town: "Bellingen", genres: "Jazz, Soul", lineup: "OhMaSoul, Jemimah Hiscox, James Brinkhoff", description: "Jazz, soul and groove performance", is_public: true, applications_open: false, _accent: "#9D4EDD", days: [] }
    },
    {
      name: "Alexandr Misko – International Guitar Sensation",
      config: { date: "2026-06-24", venue: "", town: "Bellingen", genres: "Live Music, Acoustic", lineup: "Alexandr Misko", description: "International fingerstyle guitar performance", is_public: true, applications_open: false, _accent: "#00E5FF", days: [] }
    },
    {
      name: "NOSTALGIA Music Concert",
      config: { date: "2026-07-26", venue: "", town: "Bellingen", genres: "Live Music", lineup: "", description: "Live music concert", is_public: true, applications_open: false, _accent: "#9D4EDD", days: [] }
    },
    {
      name: "Beyond Jazz Weekender",
      config: { date: "2026-08-14", venue: "Multiple Venues", town: "Bellingen", genres: "Jazz Festival, Jazz", lineup: "Jazz Doof, Jazz Social", description: "Multi-day jazz festival — 14 and 15 August", is_public: true, applications_open: false, _accent: "#FFB830", days: [] }
    },
    {
      name: "Kevin Morby – Little Wide Open Tour",
      config: { date: "2026-11-13", venue: "", town: "Bellingen", genres: "Live Music, Indie Folk", lineup: "Kevin Morby", description: "Australian tour appearance", is_public: true, applications_open: false, _accent: "#00E5FF", days: [] }
    }
  ];

  let ok = 0, fail = 0;
  for (const ev of events) {
    try {
      await sbRest("events", {
        method: "POST",
        body: JSON.stringify({ name: ev.name, config: ev.config, host_id: hostId, status: "live", is_public: true, applications_open: false, host_controls: {} })
      }, token);
      console.log("inserted: " + ev.name);
      ok++;
    } catch(e) {
      console.error("failed: " + ev.name, e.message);
      fail++;
    }
  }
  console.log("Done — " + ok + " inserted, " + fail + " failed. Refresh the app.");
})();
