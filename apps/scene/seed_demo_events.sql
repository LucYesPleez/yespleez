-- YesPleez demo events seed
-- Run this in the Supabase SQL editor at:
-- https://supabase.com/dashboard/project/doqzxvppibuzieajqkxm/editor
--
-- Uses the first user in auth.users as host_id so RLS is satisfied.
-- Delete these later with: DELETE FROM events WHERE name LIKE '[DEMO]%';

DO $$
DECLARE
  hid uuid := (SELECT id FROM auth.users LIMIT 1);
BEGIN

INSERT INTO events (host_id, name, config) VALUES
(hid, '[DEMO] Tuesday Residency – Jess Ray', '{"date":"2026-07-01","venue":"The Vanguard, Newtown","genres":"Live Music,Singer-Songwriter,Acoustic","state":"NSW","location":"Newtown"}'),
(hid, '[DEMO] Deep House Tuesdays', '{"date":"2026-07-01","venue":"Lounge Bar, Melbourne","genres":"DJ,Electronic,House,Deep House","state":"VIC","location":"Melbourne CBD"}'),
(hid, '[DEMO] Stand-Up Showcase', '{"date":"2026-07-01","venue":"Comedy Store, Sydney","genres":"Comedy,Stand-Up","state":"NSW","location":"Moore Park"}'),
(hid, '[DEMO] Open Mic Night', '{"date":"2026-07-02","venue":"The Chippo Hotel, Sydney","genres":"Live Music,Open Mic","state":"NSW","location":"Chippendale"}'),
(hid, '[DEMO] Friday Night Laughs', '{"date":"2026-07-03","venue":"Comedy Republic, Melbourne","genres":"Comedy,Stand-Up","state":"VIC","location":"Melbourne CBD"}'),
(hid, '[DEMO] House Sessions', '{"date":"2026-07-03","venue":"Midnight Club, Melbourne","genres":"DJ,Electronic,House","state":"VIC","location":"Fitzroy"}'),
(hid, '[DEMO] Akmal – My Family and Other Animals', '{"date":"2026-07-04","venue":"Bellingen Memorial Hall","genres":"Comedy,Stand-Up","state":"NSW","location":"Bellingen"}'),
(hid, '[DEMO] Proper Massive', '{"date":"2026-07-05","venue":"Bellingen Memorial Hall","genres":"DJ,Drum & Bass,Electronic","state":"NSW","location":"Bellingen"}'),
(hid, '[DEMO] Rowdy Roots Roundup', '{"date":"2026-07-06","venue":"Bellingen Memorial Hall","genres":"Live Music,Roots,Folk","state":"NSW","location":"Bellingen"}'),
(hid, '[DEMO] Carriageworks Night Market', '{"date":"2026-07-08","venue":"Carriageworks, Sydney","genres":"Live Music,Electronic,Festival","state":"NSW","location":"Eveleigh"}'),
(hid, '[DEMO] Dune Rats', '{"date":"2026-07-09","venue":"Manning Bar, Sydney","genres":"Live Music,Rock","state":"NSW","location":"Camperdown"}'),
(hid, '[DEMO] Folk Collective', '{"date":"2026-07-11","venue":"Newtown Social Club, Sydney","genres":"Live Music,Folk,Acoustic","state":"NSW","location":"Newtown"}'),
(hid, '[DEMO] Spoken Word Night', '{"date":"2026-07-13","venue":"Red Rattler Theatre, Sydney","genres":"Spoken Word,Poetry","state":"NSW","location":"Marrickville"}'),
(hid, '[DEMO] Bellingen Winter Solstice Festival', '{"date":"2026-07-04","venue":"Bellingen Showground, NSW","genres":"Festival,Folk,World Music,Electronic,Acoustic","state":"NSW","location":"Bellingen","featured":true}'),
(hid, '[DEMO] Darkroom Sessions', '{"date":"2026-07-10","venue":"The Burdekin, Sydney","genres":"DJ,Techno,Dark Electronic","state":"NSW","location":"Darlinghurst"}'),
(hid, '[DEMO] Bass Kitchen Vol. 5', '{"date":"2026-07-12","venue":"Ding Dong Lounge, Melbourne","genres":"DJ,Drum & Bass,Bass","state":"VIC","location":"Melbourne CBD"}'),
(hid, '[DEMO] Comedy Gala Brisbane', '{"date":"2026-07-05","venue":"Brisbane Powerhouse","genres":"Comedy,Stand-Up,Festival","state":"QLD","location":"New Farm"}'),
(hid, '[DEMO] Jazz in the Park', '{"date":"2026-07-06","venue":"Centennial Park, Sydney","genres":"Live Music,Jazz","state":"NSW","location":"Centennial Park"}');

END $$;
