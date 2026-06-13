-- Delete old incomplete Bellingen events first
DELETE FROM events WHERE name IN (
  'Laura Targett – The Road to Tpot Album Launch',
  'Jazz in the Old Supper Room feat. OhMaSoul',
  'Alexandr Misko – International Guitar Sensation',
  'Gospel Sunday with Harry James Angus',
  'Travellin North with a Song',
  'Travellin'' North with a Song',
  'NOSTALGIA Music Concert',
  'Beyond Jazz Weekender',
  'Kevin Morby – Little Wide Open Tour',
  'Mandy Nolan – The Cranky Women''s Comedy Club',
  'Lily Hallawell & DJ Takuto',
  'AstroSpheric 2',
  'Friends of Owl',
  'Dragon Dreaming Festival Launch',
  'Proper Massive',
  'Rowdy Roots Roundup',
  'Thelma Plum – I Don''t Play That Song Anymore Tour',
  'Dorrigo Folk & Bluegrass Festival',
  'Akmal – My Family and Other Criminals'
);

-- Insert all events fresh
WITH host AS (
  SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1
)
INSERT INTO events (name, config, host_id, status, is_public, applications_open, host_controls)
SELECT t.name, t.config::jsonb, (SELECT id FROM host), 'live', true, false, '{}'::jsonb
FROM (VALUES

  ('Mandy Nolan – The Cranky Women''s Comedy Club',
   '{"date":"2026-06-12","venue":"Bellingen Memorial Hall","address":"32 Hyde Street","town":"Bellingen","state":"NSW","postcode":"2454","lat":-30.4521,"lng":152.8990,"genres":"Comedy, Stand-up","lineup":"Mandy Nolan","description":"Stand-up comedy show featuring Mandy Nolan and guest comedians","is_public":true,"applications_open":false,"poster":"https://doqzxvppibuzieajqkxm.supabase.co/storage/v1/object/public/posters/YesPleez%20Calendar%20pics/mandy%20nolan.png","_accent":"#FFE066","days":[]}'),

  ('Lily Hallawell & DJ Takuto',
   '{"date":"2026-06-12","venue":"Bellingen Brewery","town":"Bellingen","state":"NSW","postcode":"2454","lat":-30.4521,"lng":152.8990,"genres":"Live Music, DJ","lineup":"Lily Hallawell, DJ Takuto","description":"Live music performance with DJ support","is_public":true,"applications_open":false,"poster":"https://doqzxvppibuzieajqkxm.supabase.co/storage/v1/object/public/posters/YesPleez%20Calendar%20pics/lily%20hallawell.jpg","_accent":"#FF8C42","days":[]}'),

  ('AstroSpheric 2',
   '{"date":"2026-06-13","venue":"Bellingen Memorial Hall","address":"32 Hyde Street","town":"Bellingen","state":"NSW","postcode":"2454","lat":-30.4521,"lng":152.8990,"genres":"Psytrance, Electronic","lineup":"ETN, Supporting Artists","description":"Psytrance event featuring international and local artists","is_public":true,"applications_open":false,"poster":"https://doqzxvppibuzieajqkxm.supabase.co/storage/v1/object/public/posters/YesPleez%20Calendar%20pics/astropheric2.jpg","_accent":"#9D4EDD","days":[]}'),

  ('Friends of Owl',
   '{"date":"2026-06-14","venue":"Bellingen Brewery","town":"Bellingen","state":"NSW","postcode":"2454","lat":-30.4521,"lng":152.8990,"genres":"Live Music","lineup":"Friends of Owl","description":"Live music performance","is_public":true,"applications_open":false,"poster":"https://doqzxvppibuzieajqkxm.supabase.co/storage/v1/object/public/posters/YesPleez%20Calendar%20pics/friends%20of%20owl.jpg","_accent":"#00E5A0","days":[]}'),

  ('Travellin'' North with a Song',
   '{"date":"2026-06-15","venue":"Bellingen Memorial Hall","address":"32 Hyde Street","town":"Bellingen","state":"NSW","postcode":"2454","lat":-30.4521,"lng":152.8990,"genres":"Choral Music, Classical","lineup":"Sydney Male Choir, Akabella Community Choir","description":"Choral music performance","is_public":true,"applications_open":false,"poster":"https://doqzxvppibuzieajqkxm.supabase.co/storage/v1/object/public/posters/YesPleez%20Calendar%20pics/sydney%20male%20choir.jpg","_accent":"#FF3399","days":[]}'),

  ('Dragon Dreaming Festival Launch',
   '{"date":"2026-06-19","venue":"Bellingen Memorial Hall","address":"32 Hyde Street","town":"Bellingen","state":"NSW","postcode":"2454","lat":-30.4521,"lng":152.8990,"genres":"Festival, Live Music","lineup":"","description":"Launch event for Dragon Dreaming Festival","is_public":true,"applications_open":false,"poster":"https://doqzxvppibuzieajqkxm.supabase.co/storage/v1/object/public/posters/YesPleez%20Calendar%20pics/dragon%20dreaming%20launch.jpg","_accent":"#FFB830","days":[]}'),

  ('Laura Targett – The Road to Tpot Album Launch',
   '{"date":"2026-06-20","venue":"Bellingen Memorial Hall","address":"32 Hyde Street","town":"Bellingen","state":"NSW","postcode":"2454","lat":-30.4521,"lng":152.8990,"genres":"Live Music, Album Launch","lineup":"Laura Targett, Conor McDonald, Emiliano Beltzer, Matt Ledgar, Shay O''Sheehan","description":"Album launch performance featuring Laura Targett and full band","is_public":true,"applications_open":false,"poster":"https://doqzxvppibuzieajqkxm.supabase.co/storage/v1/object/public/posters/YesPleez%20Calendar%20pics/laura%20targett.jpg","_accent":"#FF8C42","days":[]}'),

  ('Alexandr Misko – International Guitar Sensation',
   '{"date":"2026-06-24","venue":"Bellingen Memorial Hall","town":"Bellingen","state":"NSW","postcode":"2454","lat":-30.4521,"lng":152.8990,"genres":"Live Music, Acoustic","lineup":"Alexandr Misko","description":"International fingerstyle guitarist performance","is_public":true,"applications_open":false,"poster":"https://doqzxvppibuzieajqkxm.supabase.co/storage/v1/object/public/posters/YesPleez%20Calendar%20pics/misko.jpg","_accent":"#00E5FF","days":[]}'),

  ('Proper Massive',
   '{"date":"2026-07-04","venue":"Bellingen Memorial Hall","address":"32 Hyde Street","town":"Bellingen","state":"NSW","postcode":"2454","lat":-30.4521,"lng":152.8990,"genres":"Drum & Bass, Electronic","lineup":"","description":"Drum and bass music event","is_public":true,"applications_open":false,"poster":"https://doqzxvppibuzieajqkxm.supabase.co/storage/v1/object/public/posters/YesPleez%20Calendar%20pics/proper%20massive.jpg","_accent":"#00E5FF","days":[]}'),

  ('Rowdy Roots Roundup',
   '{"date":"2026-07-05","venue":"Bellingen Memorial Hall","address":"32 Hyde Street","town":"Bellingen","state":"NSW","postcode":"2454","lat":-30.4521,"lng":152.8990,"genres":"Live Music, Roots","lineup":"","description":"Raw high-energy live music event","is_public":true,"applications_open":false,"poster":"https://doqzxvppibuzieajqkxm.supabase.co/storage/v1/object/public/posters/YesPleez%20Calendar%20pics/rowdy%20roots.jpg","_accent":"#FF8C42","days":[]}'),

  ('Thelma Plum – I Don''t Play That Song Anymore Tour',
   '{"date":"2026-08-05","venue":"Bellingen Memorial Hall","address":"32 Hyde Street","town":"Bellingen","state":"NSW","postcode":"2454","lat":-30.4521,"lng":152.8990,"genres":"Live Music, Indie Folk","lineup":"Thelma Plum","description":"National acoustic tour performance","is_public":true,"applications_open":false,"poster":"https://doqzxvppibuzieajqkxm.supabase.co/storage/v1/object/public/posters/YesPleez%20Calendar%20pics/thelma%20plum.jpg","_accent":"#FF3399","days":[]}'),

  ('Beyond Jazz Weekender',
   '{"date":"2026-08-14","venue":"Multiple Venues","town":"Bellingen","state":"NSW","postcode":"2454","lat":-30.4521,"lng":152.8990,"genres":"Jazz Festival, Jazz","lineup":"Jazz Doof, Jazz Social","description":"Multi-day jazz festival — 14 and 15 August","is_public":true,"applications_open":false,"poster":"https://doqzxvppibuzieajqkxm.supabase.co/storage/v1/object/public/posters/YesPleez%20Calendar%20pics/beyond%20jazz.jpg","_accent":"#FFB830","days":[]}'),

  ('Akmal – My Family and Other Criminals',
   '{"date":"2026-07-03","venue":"Bellingen Memorial Hall","address":"32 Hyde Street","town":"Bellingen","state":"NSW","postcode":"2454","lat":-30.4521,"lng":152.8990,"genres":"Comedy, Stand-up","lineup":"Akmal","description":"Akmal returns, sharing stories and thoughts about people who affected his life — including his uncle, who pretended to be a doctor for many years.","is_public":true,"applications_open":false,"poster":"https://doqzxvppibuzieajqkxm.supabase.co/storage/v1/object/public/posters/YesPleez%20Calendar%20pics/akmal.jpg","_accent":"#FFE066","days":[]}'),

  ('Dorrigo Folk & Bluegrass Festival',
   '{"date":"2026-10-23","venue":"Dorrigo Showgrounds","address":"4180 Waterfall Way","town":"Dorrigo","state":"NSW","postcode":"2453","lat":-30.3410,"lng":152.7144,"genres":"Folk, Bluegrass, Festival","lineup":"","description":"Three-day celebration of local, national and international folk and bluegrass music","is_public":true,"applications_open":false,"poster":"https://doqzxvppibuzieajqkxm.supabase.co/storage/v1/object/public/posters/YesPleez%20Calendar%20pics/dorrigo%20folk.jpg","_accent":"#00E5A0","days":[]}')

) AS t(name, config);
