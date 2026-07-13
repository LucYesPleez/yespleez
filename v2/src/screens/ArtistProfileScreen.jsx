import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import s from './ArtistProfileScreen.module.css';
import PostcodePrompt from '../components/PostcodePrompt';
import CardTagPicker from '../components/CardTagPicker';
import AvatarUpload from '../components/AvatarUpload';

const STATE_OPTIONS = ['NSW','VIC','QLD','WA','SA','TAS','ACT','NT','NZ','International'];
const EXP_LEVELS   = ['EMERGING','DEVELOPING','ESTABLISHED','TOURING'];
const TECH_OPTIONS = ['DJ DIGITAL','DJ VINYL','DJ HYBRID','LIVE ACT','LIVE + DJ','B2B'];

const MAIN_GENRES = [
  'Techno','House','Drum & Bass','Breaks','Trance','Psytrance',
  'Progressive Psy','Dubstep / Bass','Hard Dance / Hardcore',
  'Ambient / Downtempo','Electronica','Funk / Soul / Disco',
  'Hip-Hop','Reggae / Dancehall','World / Global','Experimental','Multi Genre',
];

const SUBGENRES = {
  'Techno':                ['Peak Time','Hard Techno','Schranz','Industrial','Melodic Techno','Atmospheric','Raw / Hypnotic','Minimal','Deep Tech','Detroit','Acid','Rave'],
  'House':                 ['Tech House','Deep House','Afro House','Organic House','UK Garage','2-Step','Progressive House','Melodic House','Jackin House','Funky / Groove','Electro House','Soulful'],
  'Drum & Bass':           ['Liquid','Rollers','Neurofunk','Jump Up','Dark / Atmospheric','Jungle','Techstep','Minimal DnB'],
  'Breaks':                ['Psy Breaks','Nu Skool Breaks','Electro Breaks','Florida Breaks','Acid Breaks','Big Beat','Breakbeat'],
  'Psytrance':             ['Full On','Goa','Dark Psy','Forest Psy','Hi-Tech','Twilight','Psybient','Suomi'],
  'Progressive Psy':       ['Night Prog','Psyprog','Prog Trance','Minimal Psy','Chunk'],
  'Dubstep / Bass':        ['Dubstep','UK Dubstep','Brostep','Riddim','Bass House','UK Bass','Future Bass','Trap','Footwork','Halftime','80 BPM','Glitch Hop','Leftfield','Grime'],
  'Hard Dance / Hardcore': ['Hard Techno','Hardstyle','Hardcore','Gabber','Happy Hardcore','UK Hardcore'],
};

const VIBES = [
  'Fun','Funky','Groove','Wobbly','Thinky','Bouncy','Uplifting','Clubby',
  'Bangers','Staunch','Crankin','Chunks','Sinister','Techy','Melodic','Hypnotic',
  'Deep','Dark','Dank','Organic','Shanti','Warm Up','Wonky','Sleazy/Slutty',
  'Cocktail','Classy','Minimal','Experimental','USA','UK','Vocals','Glitchy','Sledgy',
];

function parseProfile(data) {
  const str = data?.genre_string || '';
  const parts = new Set(str.split(' · ').map(x => x.trim()).filter(Boolean));
  const genres = MAIN_GENRES.filter(g => parts.has(g));
  const allSubs = Object.values(SUBGENRES).flat();
  const subs = allSubs.filter(g => parts.has(g));
  const vibes = VIBES.filter(v => parts.has(v));
  return { genres, subs, vibes };
}

function buildGenreString(genres, subs, vibes) {
  return [...new Set([...genres, ...subs, ...vibes])].join(' · ');
}

export default function ArtistProfileScreen() {
  const { session } = useSession();
  const userId = session?.user?.id;
  const navigate = useNavigate();

  const [page,      setPage]      = useState(1);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [showPostcodePrompt, setShowPostcodePrompt] = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [saveErr,   setSaveErr]   = useState('');
  const [profileId, setProfileId] = useState(null);

  // Page 1 fields
  const [avatar,     setAvatar]     = useState('');
  const [avatarHero, setAvatarHero] = useState('');
  const [avatarThumb,setAvatarThumb]= useState('');
  const [name,       setName]       = useState('');
  const [label,      setLabel]      = useState('');
  const [years,      setYears]      = useState('');
  const [location,   setLocation]   = useState('');
  const [locState,   setLocState]   = useState('');
  const [postcode,   setPostcode]   = useState('');
  const [sound,      setSound]      = useState('');
  const [tagline,    setTagline]    = useState('');
  const [mixLink,    setMixLink]    = useState('');
  const [selGenres,  setSelGenres]  = useState([]);
  const [selSubs,    setSelSubs]    = useState([]);
  const [selVibes,   setSelVibes]   = useState([]);
  const [selTags,    setSelTags]    = useState([]);

  // Page 2 fields
  const [bio,            setBio]            = useState('');
  const [expLevel,       setExpLevel]       = useState('');
  const [age,            setAge]            = useState('');
  const [agePrivate,     setAgePrivate]     = useState(false);
  const [ageNone,        setAgeNone]        = useState(false);
  const [techSetup,      setTechSetup]      = useState([]);
  const [feeType,        setFeeType]        = useState('');
  const [feeAmount,      setFeeAmount]      = useState('');
  const [feeMax,         setFeeMax]         = useState('');
  const [feeLocal,       setFeeLocal]       = useState(false);
  const [feeTravelLocal, setFeeTravelLocal] = useState(false);
  const [feeNegotiable,  setFeeNegotiable]  = useState(false);
  const [emergName,      setEmergName]      = useState('');
  const [emergPhone,     setEmergPhone]     = useState('');
  const [emergRel,       setEmergRel]       = useState('');
  const [hasAbn,         setHasAbn]         = useState(null);
  const [abn,            setAbn]            = useState('');
  const [gstReg,         setGstReg]         = useState(null);
  const [soundcloud,     setSoundcloud]     = useState('');
  const [mixcloud,       setMixcloud]       = useState('');
  const [instagram,      setInstagram]      = useState('');
  const [youtube,        setYoutube]        = useState('');
  const [facebook,       setFacebook]       = useState('');
  const [website,        setWebsite]        = useState('');
  const [naFields,       setNaFields]       = useState(new Set());

  function toggleNa(field) {
    setNaFields(prev => {
      const next = new Set(prev);
      if (next.has(field)) { next.delete(field); } else { next.add(field); }
      return next;
    });
  }

  useEffect(() => {
    if (!userId) return;
    supabase.from('profiles').select('*').eq('user_id', userId).eq('type', 'artist').maybeSingle()
      .then(({ data }) => {
        if (data) {
          setProfileId(data.id);
          setAvatar(data.avatar || '');
          setAvatarHero(data.avatar_hero || '');
          setAvatarThumb(data.avatar_thumb || '');
          setName(data.name || '');
          setLabel(data.label || '');
          setYears(data.years || '');
          setLocation(data.location || '');
          setLocState(data.state || '');
          setPostcode(data.postcode || '');
          setSound(data.sound || '');
          setTagline(data.tagline || '');
          setMixLink(data.mix_link || '');
          setBio(data.bio || '');
          const naSet = new Set();
          const loadNa = (val, setter, key) => {
            if (val === 'N/A') { naSet.add(key); setter(''); }
            else setter(val || '');
          };
          loadNa(data.soundcloud, setSoundcloud, 'soundcloud');
          loadNa(data.mixcloud,   setMixcloud,   'mixcloud');
          loadNa(data.instagram,  setInstagram,  'instagram');
          loadNa(data.youtube,    setYoutube,    'youtube');
          loadNa(data.facebook,   setFacebook,   'facebook');
          loadNa(data.website,    setWebsite,    'website');
          setNaFields(naSet);
          const parsed = parseProfile(data);
          setSelGenres(parsed.genres);
          setSelSubs(parsed.subs);
          setSelVibes(parsed.vibes);
          if (data.card_pills)    setSelTags(data.card_pills.split(' · ').filter(Boolean));
          if (data.experience)    setExpLevel(data.experience);
          if (data.tech_setup)    setTechSetup(data.tech_setup.split(' · ').filter(Boolean));
          if (data.fee_type)      setFeeType(data.fee_type);
          if (data.fee)           setFeeAmount(String(data.fee));
          if (data.fee_max)       setFeeMax(String(data.fee_max));
          setFeeLocal(!!data.fee_local);
          setFeeTravelLocal(!!data.fee_plus_travel);
          setFeeNegotiable(!!data.fee_negotiable);
          setEmergName(data.emergency_name || '');
          setEmergPhone(data.emergency_phone || '');
          setEmergRel(data.emergency_rel || '');
          setAgePrivate(!!data.age_private);
          if (data.age === 'prefer-not-to-say') { setAgeNone(true); }
          else if (data.age) { setAge(data.age); }
          if (data.abn)           setAbn(data.abn);
          if (data.gst_registered !== undefined) setGstReg(!!data.gst_registered);
        }
        setLoading(false);
      });
  }, [userId]);

  useEffect(() => {
    const validSubs = selGenres.flatMap(g => SUBGENRES[g] || []);
    setSelSubs(prev => prev.filter(sub => validSubs.includes(sub)));
  }, [selGenres]);

  useEffect(() => {
    const pool = new Set([...selGenres, ...selSubs, ...selVibes]);
    setSelTags(prev => prev.filter(t => pool.has(t)));
  }, [selGenres, selSubs, selVibes]);

  function toggleGenre(g)  { setSelGenres(prev => prev.includes(g)   ? prev.filter(x => x !== g)   : [...prev, g]); }
  function toggleSub(sub)  { setSelSubs(prev   => prev.includes(sub) ? prev.filter(x => x !== sub) : [...prev, sub]); }
  function toggleVibe(v)   { setSelVibes(prev  => prev.includes(v)   ? prev.filter(x => x !== v)   : [...prev, v]); }
  function toggleTech(t)   { setTechSetup(prev => prev.includes(t)   ? prev.filter(x => x !== t)   : [...prev, t]); }
  function toggleTag(t) {
    setSelTags(prev => {
      if (prev.includes(t)) return prev.filter(x => x !== t);
      if (prev.length >= 5) return prev;
      return [...prev, t];
    });
  }

  async function save(skipPostcodeCheck = false) {
    if (!userId || saving) return;
    if (!skipPostcodeCheck && !postcode && !location) { setShowPostcodePrompt(true); return; }
    setSaving(true);
    setSaveErr('');
    const genre_string = buildGenreString(selGenres, selSubs, selVibes);
    const payload = {
      user_id: userId, type: 'artist',
      name, label, years, location, state: locState, postcode,
      sound, tagline, bio,
      mix_link: mixLink,
      soundcloud: naFields.has('soundcloud') ? 'N/A' : soundcloud,
      mixcloud:   naFields.has('mixcloud')   ? 'N/A' : mixcloud,
      instagram:  naFields.has('instagram')  ? 'N/A' : instagram,
      youtube:    naFields.has('youtube')    ? 'N/A' : youtube,
      facebook:   naFields.has('facebook')   ? 'N/A' : facebook,
      website:    naFields.has('website')    ? 'N/A' : website,
      genre_string, avatar: avatarHero || avatar,
      avatar_hero: avatarHero || null, avatar_thumb: avatarThumb || null,
      card_pills:      selTags.join(' · '),
      experience:      expLevel,
      tech_setup:      techSetup.join(' · '),
      fee_type:        feeType,
      fee:             feeAmount ? parseInt(feeAmount) : null,
      fee_max:         (!feeNegotiable && feeMax) ? parseInt(feeMax) : null,
      fee_local:       feeLocal,
      fee_plus_travel: feeTravelLocal,
      fee_negotiable:  feeNegotiable,
      emergency_name:  emergName,
      emergency_phone: emergPhone,
      emergency_rel:   emergRel,
      age:             ageNone ? 'prefer-not-to-say' : (age || ''),
      age_private:     agePrivate,
      abn:             abn,
      gst_registered:  gstReg,
    };
    if (profileId) payload.id = profileId;
    const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'user_id,type' });
    if (error) {
      setSaveErr('Save failed — ' + (error.message || 'unknown error'));
    } else {
      setSaved(true);
      setTimeout(() => { setSaved(false); navigate('/industry/artist'); }, 1200);
    }
    setSaving(false);
  }

  const availSubs = selGenres.flatMap(g => SUBGENRES[g] || []);
  const tagPool   = [...new Set([...selGenres, ...selSubs, ...selVibes])];

  if (loading) return <div className={s.loading}>LOADING…</div>;

  return (
    <div className={s.screen}>
      {showPostcodePrompt && <PostcodePrompt onSave={() => setShowPostcodePrompt(false)} onDismiss={() => { setShowPostcodePrompt(false); save(true); }} />}
      {/* Header — always visible */}
      <div className={s.header}>
        <div className={s.headerText}>
          <div className={s.h1}>MY PROFILE</div>
          <div className={s.h1Sub}>Fill this in once · travels with you across every event</div>
        </div>
      </div>

      {/* ── PAGE 1 ── */}
      {page === 1 && (
        <>
          {/* Avatar */}
          <AvatarUpload
            userId={userId} bucket="avatars" pathPrefix="artist_avatars"
            avatar={avatar}
            ringClass={s.avatarRing}
            onUpload={({ avatar_hero, avatar_thumb }) => { setAvatarHero(avatar_hero); setAvatarThumb(avatar_thumb); setAvatar(avatar_hero); }}
            onRemove={() => { setAvatar(''); setAvatarHero(''); setAvatarThumb(''); }}
          />

          {/* WHO YOU ARE */}
          <Section title="WHO YOU ARE">
            <Field label={<>DJ / ARTIST NAME <span className={s.fieldHint}>25 chars max</span></>}>
              <input className={s.input} value={name} onChange={e => setName(e.target.value)} placeholder="What you perform as" maxLength={25} autoComplete="off" />
            </Field>
            <div className={s.row}>
              <div style={{ flex: 1 }}>
                <Field label={<>LABEL / AFFILIATE <span className={s.fieldHint}>(optional)</span></>}>
                  <input className={s.input} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Tresor, independent" autoComplete="off" />
                </Field>
              </div>
              <div style={{ width: 110 }}>
                <Field label="EST. YEAR">
                  <input className={s.input} type="number" value={years} onChange={e => setYears(e.target.value)} placeholder="e.g. 2018" min="1900" max="2099" />
                </Field>
              </div>
            </div>
            <div className={s.row}>
              <div style={{ flex: 2 }}>
                <Field label="TOWN / SUBURB">
                  <input className={s.input} value={location} onChange={e => setLocation(e.target.value)} placeholder="Start typing your city…" autoComplete="off" />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="STATE">
                  <select className={s.select} value={locState} onChange={e => setLocState(e.target.value)}>
                    <option value="">—</option>
                    {STATE_OPTIONS.map(st => <option key={st} value={st}>{st}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="POSTCODE">
                  <input className={s.input} value={postcode} onChange={e => setPostcode(e.target.value.replace(/\D/g,''))} placeholder="e.g. 2010" maxLength={4} inputMode="numeric" />
                </Field>
              </div>
            </div>
          </Section>

          {/* YOUR SOUND */}
          <Section title={<>YOUR SOUND <span className={s.sectionHintInline}>shows on your slot card · 35 chars</span></>}>
            <input className={s.input} value={sound} onChange={e => setSound(e.target.value)} placeholder="e.g. UK Garage Mashups & Dark Electronics" maxLength={35} autoComplete="off" />
            <div className={s.charCount}>{sound.length} / 35</div>
          </Section>

          {/* TAGLINE */}
          <Section title={<>TAGLINE <span className={s.sectionHintInline}>shows on your profile tile · 120 chars</span></>}>
            <textarea className={s.textarea} value={tagline} onChange={e => setTagline(e.target.value)} placeholder="Peak-time techno from Sydney. Builds slow, hits hard." maxLength={120} rows={2} />
            <div className={s.charCount}>{tagline.length} / 120</div>
          </Section>

          {/* GENRES */}
          <Section title="GENRES">
            <div className={s.chips}>
              {MAIN_GENRES.map(g => (
                <button key={g} type="button" className={selGenres.includes(g) ? s.chipOn : s.chip} onClick={() => toggleGenre(g)}>{g}</button>
              ))}
            </div>
            {availSubs.length > 0 && (
              <>
                <div className={s.subLabel}>SUB GENRES</div>
                <div className={s.chips}>
                  {availSubs.map(sub => (
                    <button key={sub} type="button" className={selSubs.includes(sub) ? s.chipOn : s.chip} onClick={() => toggleSub(sub)}>{sub}</button>
                  ))}
                </div>
              </>
            )}
          </Section>

          {/* VIBES */}
          <Section title="VIBES">
            <div className={s.chips}>
              {VIBES.map(v => (
                <button key={v} type="button" className={selVibes.includes(v) ? s.chipOn : s.chip} onClick={() => toggleVibe(v)}>{v}</button>
              ))}
            </div>
          </Section>

          {/* YOUR 5 CARD TAGS */}
          {tagPool.length > 0 && (
            <Section title="YOUR 5 CARD TAGS">
              <CardTagPicker
                tagPool={tagPool}
                selected={selTags}
                onChange={setSelTags}
                hint="Pick the tags that best represent your sound — shown on your slot card and discovery profile."
              />
            </Section>
          )}

          {/* YOUR DEMO MIX */}
          <Section title="YOUR DEMO MIX">
            <p className={s.sectionHint}>This is what promoters listen to first — it's your audition. Keep it current and make it count. We suggest around 20 minutes.</p>
            <SocialRow icon="headphones">
              <input className={s.input} type="url" value={mixLink} onChange={e => setMixLink(e.target.value)} placeholder="SoundCloud / Mixcloud / YouTube link" />
            </SocialRow>
          </Section>

          <button className={s.moreBtn} style={{ background: 'linear-gradient(90deg, #00E5FF, #FF3399)', color: '#fff' }} onClick={() => setPage(2)}>MORE DETAILS →</button>
        </>
      )}

      {/* ── PAGE 2 ── */}
      {page === 2 && (
        <>
          {/* FULL BIO */}
          <Section title="FULL BIO">
            <textarea className={s.textarea} value={bio} onChange={e => setBio(e.target.value)}
              placeholder="Tell promoters what you're about. Background, sound, experience, and what you can bring to the event."
              maxLength={500} rows={5} />
            <div className={s.charCount}>{bio.length} / 500</div>
          </Section>

          {/* EXPERIENCE LEVEL */}
          <Section title="EXPERIENCE LEVEL">
            <div className={s.pills}>
              {EXP_LEVELS.map(lv => (
                <button key={lv} type="button"
                  className={expLevel === lv ? s.chipOn : s.chip}
                  onClick={() => setExpLevel(lv)}
                >{lv}</button>
              ))}
            </div>
          </Section>

          {/* AGE */}
          <Section title="AGE">
            <div className={s.row} style={{ alignItems: 'center', gap: 12 }}>
              <input className={s.input} style={{ maxWidth: 100 }} type="number" value={age}
                onChange={e => setAge(e.target.value)} placeholder="e.g. 28" min="18" max="99"
                disabled={ageNone} />
              <label className={s.checkLabel}>
                <input type="checkbox" checked={agePrivate} onChange={e => setAgePrivate(e.target.checked)} />
                Promoters only
              </label>
              <label className={s.checkLabel}>
                <input type="checkbox" checked={ageNone} onChange={e => { setAgeNone(e.target.checked); if (e.target.checked) setAge(''); }} />
                Prefer not to say
              </label>
            </div>
          </Section>

          {/* TECHNICAL SETUP */}
          <Section title="TECHNICAL SETUP">
            <div className={s.pills}>
              {TECH_OPTIONS.map(t => (
                <button key={t} type="button"
                  className={techSetup.includes(t) ? s.chipOn : s.chip}
                  onClick={() => toggleTech(t)}
                >{t}</button>
              ))}
            </div>
          </Section>

          {/* SET FEE */}
          <Section title="SET FEE">
            <div className={s.feeRow}>
              <button type="button" className={feeType === 'tickets' ? s.feeBtnOn : s.feeBtn} onClick={() => setFeeType('tickets')}>
                🎟 PLAY FOR TICKETS
              </button>
              <button type="button" className={feeType === 'paid' ? s.feeBtnOn : s.feeBtn} onClick={() => setFeeType('paid')}>
                💰 I CHARGE A FEE
              </button>
            </div>
            {feeType === 'paid' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1.5, fontFamily: "'Bebas Neue'", marginBottom: 6 }}>FROM $</div>
                  <input className={s.input} type="text" inputMode="numeric" value={feeAmount} onChange={e => setFeeAmount(e.target.value)} placeholder="e.g. 300" />
                </div>
                <div style={{ flex: 1, opacity: feeNegotiable ? 1 : 0.35 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1.5, fontFamily: "'Bebas Neue'", marginBottom: 6 }}>TO $</div>
                  <input className={s.input} type="text" inputMode="numeric" value={feeMax} onChange={e => setFeeMax(e.target.value)} placeholder="e.g. 800" disabled={!feeNegotiable} />
                </div>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
              <label className={s.checkLabel}><input type="checkbox" checked={feeLocal} onChange={e => setFeeLocal(e.target.checked)} /> I'm local to the event</label>
              <label className={s.checkLabel}><input type="checkbox" checked={feeTravelLocal} onChange={e => setFeeTravelLocal(e.target.checked)} /> Fee + travel</label>
              <label className={s.checkLabel}><input type="checkbox" checked={feeNegotiable} onChange={e => setFeeNegotiable(e.target.checked)} /> Negotiable</label>
            </div>
            <p className={s.sectionHint} style={{ marginTop: 8 }}>This helps promoters budget their lineups.</p>
          </Section>

          {/* EMERGENCY CONTACT */}
          <Section title="EMERGENCY CONTACT">
            <div className={s.row}>
              <div style={{ flex: 1 }}>
                <Field label="NAME"><input className={s.input} value={emergName} onChange={e => setEmergName(e.target.value)} placeholder="Contact name" autoComplete="off" /></Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="PHONE"><input className={s.input} type="tel" value={emergPhone} onChange={e => setEmergPhone(e.target.value)} placeholder="Mobile number" /></Field>
              </div>
            </div>
            <Field label="RELATIONSHIP"><input className={s.input} value={emergRel} onChange={e => setEmergRel(e.target.value)} placeholder="e.g. Partner, Mum" autoComplete="off" /></Field>
          </Section>

          {/* ABN / GST */}
          <Section title="ABN / GST">
            <div className={s.feeRow}>
              <button type="button" className={hasAbn === true ? s.feeBtnOn : s.feeBtn} onClick={() => setHasAbn(true)}>YES I HAVE AN ABN</button>
              <button type="button" className={hasAbn === false ? s.feeBtnOn : s.feeBtn} style={hasAbn === false ? { background: 'rgba(255,184,48,.15)', borderColor: '#FFB830', color: '#FFB830' } : {}} onClick={() => setHasAbn(false)}>NO ABN</button>
            </div>
            {hasAbn === true && (
              <>
                <Field label="ABN"><input className={s.input} value={abn} onChange={e => setAbn(e.target.value)} placeholder="e.g. 12 345 678 901" autoComplete="off" /></Field>
                <div className={s.feeRow}>
                  <button type="button" className={gstReg === true ? s.feeBtnOn : s.feeBtn} onClick={() => setGstReg(true)}>GST REGISTERED</button>
                  <button type="button" className={gstReg === false ? s.feeBtnOn : s.feeBtn} style={gstReg === false ? { background: 'rgba(255,184,48,.15)', borderColor: '#FFB830', color: '#FFB830' } : {}} onClick={() => setGstReg(false)}>NOT GST REGISTERED</button>
                </div>
              </>
            )}
          </Section>

          {/* SOCIALS + LINKS */}
          <Section title="SOCIALS + LINKS">
            <SocialRow icon="sc" na={naFields.has('soundcloud')} onNa={() => toggleNa('soundcloud')}><input className={s.input} type="url" value={soundcloud} onChange={e => setSoundcloud(e.target.value)} placeholder="SoundCloud" disabled={naFields.has('soundcloud')} style={{ opacity: naFields.has('soundcloud') ? 0.4 : 1 }} /></SocialRow>
            <SocialRow icon="mc" na={naFields.has('mixcloud')} onNa={() => toggleNa('mixcloud')}><input className={s.input} type="url" value={mixcloud} onChange={e => setMixcloud(e.target.value)} placeholder="Mixcloud" disabled={naFields.has('mixcloud')} style={{ opacity: naFields.has('mixcloud') ? 0.4 : 1 }} /></SocialRow>
            <SocialRow icon="ig" na={naFields.has('instagram')} onNa={() => toggleNa('instagram')}><input className={s.input} value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="@yourhandle" disabled={naFields.has('instagram')} style={{ opacity: naFields.has('instagram') ? 0.4 : 1 }} /></SocialRow>
            <SocialRow icon="yt" na={naFields.has('youtube')} onNa={() => toggleNa('youtube')}><input className={s.input} type="url" value={youtube} onChange={e => setYoutube(e.target.value)} placeholder="YouTube" disabled={naFields.has('youtube')} style={{ opacity: naFields.has('youtube') ? 0.4 : 1 }} /></SocialRow>
            <SocialRow icon="fb" na={naFields.has('facebook')} onNa={() => toggleNa('facebook')}><input className={s.input} type="url" value={facebook} onChange={e => setFacebook(e.target.value)} placeholder="https://facebook.com/…" disabled={naFields.has('facebook')} style={{ opacity: naFields.has('facebook') ? 0.4 : 1 }} /></SocialRow>
          </Section>

          {saveErr && <p className={s.error}>{saveErr}</p>}

          <div className={s.page2Nav}>
            <button className={s.backNavBtn} onClick={() => setPage(1)}>←</button>
            <button className={s.saveBtn} onClick={() => save()} disabled={saving} style={{ flex: 1, background: 'linear-gradient(90deg, #00E5FF, #FF3399)', color: '#fff' }}>
              {saving ? 'SAVING…' : saved ? '✓ SAVED!' : 'SAVE PROFILE →'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className={s.section}>
      {title && <div className={s.sectionTitle} style={{ borderImage: 'linear-gradient(90deg, #00E5FF, #FF3399) 1' }}>{title}</div>}
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className={s.field}>
      <label className={s.fieldLabel}>{label}</label>
      {children}
    </div>
  );
}

const SC_SVG = <svg viewBox="0 0 24 24" width="18" height="18" fill="#FF5500"><path d="M1.175 12.225c-.015 0-.029.002-.044.003l-.233-2.164.233-2.093c.016 0 .03.003.044.003.574 0 1.04-.466 1.04-1.04 0-.574-.466-1.04-1.04-1.04-.574 0-1.04.466-1.04 1.04v5.29c0 .574.466 1.04 1.04 1.04s1.04-.466 1.04-1.04-.466-1.039-1.04-1.039zm3.608 1.593c-.574 0-1.04-.466-1.04-1.04V8.087c0-.574.466-1.04 1.04-1.04s1.04.466 1.04 1.04v4.691c0 .574-.466 1.04-1.04 1.04zm3.617.742c-.574 0-1.04-.466-1.04-1.04V6.694c0-.574.466-1.04 1.04-1.04s1.04.466 1.04 1.04v6.826c0 .574-.466 1.04-1.04 1.04zm3.617-.371c-.574 0-1.04-.466-1.04-1.04V5.65c0-.574.466-1.04 1.04-1.04s1.04.466 1.04 1.04v7.5c0 .574-.466 1.04-1.04 1.04zm4.658.37h-1.041V4.606c.289-.151.617-.237.963-.237 1.161 0 2.102.941 2.102 2.102 0 .258-.048.504-.133.733A2.62 2.62 0 0 1 19.5 7c1.105 0 2 .895 2 2s-.895 2-2 2h-.325v3.559z"/></svg>;
const MC_SVG = <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#52AAD8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="10" height="16" x="12" y="4" rx="2"/><path d="M8 6H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h4"/><circle cx="17" cy="15" r="1"/><path d="M5.5 20H8"/></svg>;
const IG_SVG = <svg viewBox="0 0 24 24" width="18" height="18" fill="#E1306C"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>;
const YT_SVG = <svg viewBox="0 0 24 24" width="18" height="18" fill="#FF0000"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>;
const FB_SVG = <svg viewBox="0 0 24 24" width="18" height="18" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>;
const HEADPHONES_SVG = <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--neon2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>;

function SocialRow({ icon, children, na, onNa }) {
  const icons = { sc: SC_SVG, mc: MC_SVG, ig: IG_SVG, yt: YT_SVG, fb: FB_SVG, headphones: HEADPHONES_SVG };
  return (
    <div className={s.socialRow}>
      <div className={s.socialIcon}>{icons[icon]}</div>
      {children}
      {onNa && (
        <button
          type="button"
          onClick={onNa}
          style={{
            flexShrink: 0,
            alignSelf: 'stretch',
            padding: '0 10px',
            background: na ? 'rgba(255,255,255,.06)' : 'var(--card2)',
            border: `1px solid ${na ? 'var(--muted)' : 'var(--border)'}`,
            borderRadius: 8,
            color: na ? 'var(--muted)' : 'rgba(255,255,255,.4)',
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 11,
            letterSpacing: 1.5,
            cursor: 'pointer',
          }}
        >
          N/A
        </button>
      )}
    </div>
  );
}

function NaRow({ na, onToggle, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: na ? 0.45 : 1 }}>
      <div style={{ flex: 1, pointerEvents: na ? 'none' : 'auto' }}>{children}</div>
      <button
        type="button"
        onClick={onToggle}
        style={{
          flexShrink: 0,
          height: 44,
          padding: '0 10px',
          background: na ? 'rgba(255,255,255,.06)' : 'var(--card2,#1a1a2e)',
          border: `1px solid ${na ? 'var(--muted)' : 'var(--border)'}`,
          borderRadius: 8,
          color: na ? 'var(--muted)' : 'var(--text)',
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 11,
          letterSpacing: 1.5,
          cursor: 'pointer',
        }}
      >
        N/A
      </button>
    </div>
  );
}
