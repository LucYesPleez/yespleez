import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import s from './ArtistProfileScreen.module.css';
import AvatarUpload from '../components/AvatarUpload';
import PostcodePrompt from '../components/PostcodePrompt';

const STATE_OPTIONS = ['NSW','VIC','QLD','WA','SA','TAS','ACT','NT','NZ','International'];
const EXP_LEVELS   = ['EMERGING','DEVELOPING','ESTABLISHED','TOURING'];

const BAND_GENRES = [
  'Rock','Pop','Hip Hop','Electronic','Jazz','Blues','Folk',
  'Country','R&B / Soul','Funk','Reggae','Metal','Punk',
  'Latin','World','Classical','Experimental',
];
const BAND_VIBES = [
  'Indie','Alt Rock','Hard Rock','Classic Rock','Grunge','Psychedelic','Prog Rock',
  'Garage','Post-Punk','Emo','Trap','Drill','Lo-Fi','Boom Bap','House','Techno',
  'Drum & Bass','Ambient','Deep House','Synth Pop','Acoustic','Unplugged',
  'High Energy','Dance Floor','Chill','Laid Back','Late Night','All Ages',
  'Feel Good','Emotional','Dark','Party','Soulful','Groovy','Cinematic','Storytelling',
];

// accent
const COL  = '#FFB830';
const COL2 = '#FF8C42';
const GRAD = `linear-gradient(90deg, ${COL} 0%, ${COL2} 100%)`;

export default function BandProfileScreen() {
  const { session } = useSession();
  const userId = session?.user?.id;
  const navigate = useNavigate();

  const [page,      setPage]    = useState(1);
  const [loading,   setLoading] = useState(true);
  const [saving,    setSaving]  = useState(false);
  const [showPostcodePrompt, setShowPostcodePrompt] = useState(false);
  const [saved,     setSaved]   = useState(false);
  const [saveErr,   setSaveErr] = useState('');
  const [profileId, setProfileId] = useState(null);

  // Page 1
  const [avatar,     setAvatar]     = useState('');
  const [avatarHero, setAvatarHero] = useState('');
  const [avatarThumb,setAvatarThumb]= useState('');
  const [name,      setName]      = useState('');
  const [bandType,  setBandType]  = useState('');
  const [members,   setMembers]   = useState('');
  const [established, setEstablished] = useState('');
  const [location,  setLocation]  = useState('');
  const [locState,  setLocState]  = useState('');
  const [postcode,  setPostcode]  = useState('');
  const [tagline,   setTagline]   = useState('');
  const [epkLink,   setEpkLink]   = useState('');
  const [selGenres, setSelGenres] = useState([]);
  const [selVibes,  setSelVibes]  = useState([]);

  // Page 2
  const [bio,          setBio]          = useState('');
  const [expLevel,     setExpLevel]     = useState('');
  const [feeType,      setFeeType]      = useState('');
  const [feeAmount,    setFeeAmount]    = useState('');
  const [feeMax,       setFeeMax]       = useState('');
  const [feeNegotiable,setFeeNegotiable]= useState(false);
  const [feeTravel,    setFeeTravel]    = useState(false);
  const [emergName,    setEmergName]    = useState('');
  const [emergPhone,   setEmergPhone]   = useState('');
  const [emergRel,     setEmergRel]     = useState('');
  const [hasAbn,       setHasAbn]       = useState(false);
  const [abn,          setAbn]          = useState('');
  const [gstReg,       setGstReg]       = useState(false);
  const [spotify,      setSpotify]      = useState('');
  const [soundcloud,   setSoundcloud]   = useState('');
  const [youtube,      setYoutube]      = useState('');
  const [instagram,    setInstagram]    = useState('');
  const [facebook,     setFacebook]     = useState('');

  const [contactEmail, setContactEmail] = useState('');
  const [website,      setWebsite]      = useState('');
  const [naFields,     setNaFields]     = useState(new Set());

  function toggleNa(field) {
    setNaFields(prev => {
      const next = new Set(prev);
      if (next.has(field)) { next.delete(field); } else { next.add(field); }
      return next;
    });
  }

  useEffect(() => {
    if (!userId) return;
    supabase.from('profiles').select('*').eq('user_id', userId).eq('type', 'band').maybeSingle()
      .then(({ data }) => {
        if (data) {
          setProfileId(data.id);
          setAvatar(data.avatar || '');
          setAvatarHero(data.avatar_hero || '');
          setAvatarThumb(data.avatar_thumb || '');
          setName(data.name || '');
          setBandType(data.band_type || '');
          setMembers(data.member_count ? String(data.member_count) : '');
          setEstablished(data.established_year ? String(data.established_year) : '');
          setLocation(data.location || '');
          setLocState(data.state || '');
          setPostcode(data.postcode || '');
          setTagline(data.tagline || '');
          setEpkLink(data.mix_link || data.epk_link || '');
          setBio(data.bio || '');
          if (data.experience)     setExpLevel(data.experience);
          if (data.fee_type)       setFeeType(data.fee_type);
          if (data.fee)            setFeeAmount(String(data.fee));
          if (data.fee_max)        setFeeMax(String(data.fee_max));
          setFeeNegotiable(!!data.fee_negotiable);
          setFeeTravel(!!data.fee_travel);
          setEmergName(data.emergency_name || '');
          setEmergPhone(data.emergency_phone || '');
          setEmergRel(data.emergency_rel || '');
          setHasAbn(!!data.has_abn);
          setAbn(data.abn || '');
          setGstReg(!!data.gst_registered);
          const naSet = new Set();
          const loadNa = (val, setter, key) => {
            if (val === 'N/A') { naSet.add(key); setter(''); }
            else setter(val || '');
          };
          loadNa(data.spotify,        setSpotify,       'spotify');
          loadNa(data.soundcloud,     setSoundcloud,    'soundcloud');
          loadNa(data.youtube,        setYoutube,       'youtube');
          loadNa(data.instagram,      setInstagram,     'instagram');
          loadNa(data.facebook,       setFacebook,      'facebook');
          loadNa(data.contact_email,  setContactEmail,  'contactEmail');
          loadNa(data.website,        setWebsite,       'website');
          setNaFields(naSet);
          // genres + vibes from genre_string (comma or · separated)
          const str = data.genre_string || '';
          const parts = new Set(str.split(/,\s*|\s+·\s+/).map(x => x.trim()).filter(Boolean));
          setSelGenres(BAND_GENRES.filter(g => parts.has(g)));
          setSelVibes(BAND_VIBES.filter(v => parts.has(v)));
        }
        setLoading(false);
      });
  }, [userId]);

  function toggleGenre(g) { setSelGenres(p => p.includes(g) ? p.filter(x => x !== g) : [...p, g]); }
  function toggleVibe(v)  { setSelVibes(p  => p.includes(v) ? p.filter(x => x !== v) : [...p, v]); }

  async function save(skipPostcodeCheck = false) {
    if (!userId || saving) return;
    if (!skipPostcodeCheck && !postcode && !location) { setShowPostcodePrompt(true); return; }
    setSaving(true);
    setSaveErr('');
    const genre_string = [...selGenres, ...selVibes].join(' · ');
    const payload = {
      user_id: userId, type: 'band',
      name, band_type: bandType,
      member_count: members ? parseInt(members) : null,
      established_year: established ? parseInt(established) : null,
      location, state: locState, postcode,
      tagline, bio,
      mix_link: epkLink, epk_link: epkLink,
      genre_string, avatar: avatarHero || avatar,
      avatar_hero: avatarHero || null, avatar_thumb: avatarThumb || null,
      experience:      expLevel,
      fee_type:        feeType,
      fee:             feeAmount ? parseInt(feeAmount) : null,
      fee_max:         (!feeNegotiable && feeMax) ? parseInt(feeMax) : null,
      fee_negotiable:  feeNegotiable,
      fee_travel:      feeTravel,
      emergency_name:  emergName,
      emergency_phone: emergPhone,
      emergency_rel:   emergRel,
      has_abn:         hasAbn,
      abn,
      gst_registered:  gstReg,
      spotify:       naFields.has('spotify')      ? 'N/A' : spotify,
      soundcloud:    naFields.has('soundcloud')   ? 'N/A' : soundcloud,
      youtube:       naFields.has('youtube')      ? 'N/A' : youtube,
      instagram:     naFields.has('instagram')    ? 'N/A' : instagram,
      facebook:      naFields.has('facebook')     ? 'N/A' : facebook,
      contact_email: naFields.has('contactEmail') ? 'N/A' : contactEmail,
      website:       naFields.has('website')      ? 'N/A' : website,
    };
    if (profileId) payload.id = profileId;
    const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'user_id,type' });
    if (error) {
      setSaveErr('Save failed — ' + (error.message || 'unknown error'));
    } else {
      setSaved(true);
      setTimeout(() => { setSaved(false); navigate('/industry/band'); }, 1200);
    }
    setSaving(false);
  }

  if (loading) return <div className={s.loading}>LOADING…</div>;


  return (
    <div className={s.screen}>
      {showPostcodePrompt && <PostcodePrompt onSave={() => setShowPostcodePrompt(false)} onDismiss={() => { setShowPostcodePrompt(false); save(true); }} />}

      {/* Header */}
      <div className={s.header}>
        <div className={s.headerText}>
          <div className={s.h1} style={{ background: GRAD, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            YOUR<br />MUSO<br />PROFILE
          </div>
          <div className={s.h1Sub}>Fill this in once · travels with you across every event</div>
        </div>
      </div>


      {page === 1 && (
        <>
          {/* Avatar */}
          <AvatarUpload
            userId={userId} bucket="avatars" pathPrefix="band_avatars"
            avatar={avatar}
            ringClass={s.avatarRing}
            onUpload={({ avatar_hero, avatar_thumb }) => { setAvatarHero(avatar_hero); setAvatarThumb(avatar_thumb); setAvatar(avatar_hero); }}
            onRemove={() => { setAvatar(''); setAvatarHero(''); setAvatarThumb(''); }}
          />

          {/* WHO YOU ARE */}
          <Section title="WHO YOU ARE">
            <Field label="BAND / ACT NAME">
              <input className={s.input} value={name} onChange={e => setName(e.target.value)} placeholder="Your band or act name" />
            </Field>
            <Field label="BAND TYPE">
              <input className={s.input} value={bandType} onChange={e => setBandType(e.target.value)} placeholder="e.g. Rock Band, Duo, Solo Artist, Ensemble" />
            </Field>
            <div className={s.row}>
              <Field label="MEMBERS">
                <input className={s.input} type="number" min="1" value={members} onChange={e => setMembers(e.target.value)} placeholder="e.g. 4" />
              </Field>
              <Field label="EST. YEAR">
                <input className={s.input} type="number" min="1900" max="2099" value={established} onChange={e => setEstablished(e.target.value)} placeholder="e.g. 2018" />
              </Field>
            </div>
            <Field label="TOWN / SUBURB">
              <input className={s.input} value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Melbourne" />
            </Field>
            <div className={s.row}>
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
                  <input className={s.input} value={postcode} onChange={e => setPostcode(e.target.value)} placeholder="e.g. 3000" inputMode="numeric" />
                </Field>
              </div>
            </div>
          </Section>

          {/* YOUR SOUND */}
          <Section title="YOUR SOUND">
            <Field label={<>TAGLINE <span style={{ fontSize:10, fontWeight:400, opacity:.55, letterSpacing:.3 }}>One line that captures your sound</span></>}>
              <input className={s.input} value={tagline} onChange={e => setTagline(e.target.value)} placeholder="e.g. Psychedelic desert blues from the Blue Mountains" maxLength={120} />
            </Field>
            <div className={s.subLabel}>GENRE</div>
            <div className={s.chips}>
              {BAND_GENRES.map(g => (
                <button key={g} type="button"
                  className={selGenres.includes(g) ? s.chipOn : s.chip}
                  style={selGenres.includes(g) ? { background: `rgba(255,140,66,.15)`, borderColor: COL, color: COL } : {}}
                  onClick={() => toggleGenre(g)}>
                  {g}
                </button>
              ))}
            </div>
            <div className={s.subLabel}>VIBES</div>
            <div className={s.chips}>
              {BAND_VIBES.map(v => (
                <button key={v} type="button"
                  className={selVibes.includes(v) ? s.chipOn : s.chip}
                  style={selVibes.includes(v) ? { background: `rgba(255,140,66,.15)`, borderColor: COL, color: COL } : {}}
                  onClick={() => toggleVibe(v)}>
                  {v}
                </button>
              ))}
            </div>
          </Section>

          {/* EPK / PROMO LINK */}
          <Section title="EPK / PROMO LINK">
            <Field label="LINK TO MUSIC OR PRESS KIT">
              <input className={s.input} value={epkLink} onChange={e => setEpkLink(e.target.value)} placeholder="Spotify, Bandcamp, Soundcloud, or EPK URL" autoCapitalize="none" />
            </Field>
          </Section>

          <button className={s.moreBtn} style={{ background: GRAD, color: '#fff' }} onClick={() => setPage(2)}>
            MORE DETAILS →
          </button>
        </>
      )}

      {page === 2 && (
        <>
          {/* FULL BIO */}
          <Section title="FULL BIO">
            <textarea className={s.textarea} rows={5} value={bio} onChange={e => setBio(e.target.value)}
              placeholder="Tell promoters about your band. History, sound, notable gigs, what you bring to an event." />
          </Section>

          {/* EXPERIENCE LEVEL */}
          <Section title="EXPERIENCE LEVEL">
            <div className={s.chips}>
              {EXP_LEVELS.map(lv => (
                <button key={lv} type="button"
                  className={expLevel === lv ? s.chipOn : s.chip}
                  onClick={() => setExpLevel(expLevel === lv ? '' : lv)}>
                  {lv}
                </button>
              ))}
            </div>
          </Section>

          {/* SET FEE */}
          <Section title="SET FEE">
            <div className={s.feeRow}>
              <button type="button" className={feeType === 'exposure' ? s.feeBtnOn : s.feeBtn} onClick={() => setFeeType('exposure')}>EXPOSURE / FREE</button>
              <button type="button" className={feeType === 'paid'     ? s.feeBtnOn : s.feeBtn} onClick={() => setFeeType('paid')}>PAID GIG</button>
            </div>
            {feeType === 'paid' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1.5, fontFamily: "'Bebas Neue'", marginBottom: 6 }}>FROM $</div>
                  <input className={s.input} type="text" inputMode="numeric" value={feeAmount} onChange={e => setFeeAmount(e.target.value)} placeholder="e.g. 600" />
                </div>
                <div style={{ flex: 1, opacity: feeNegotiable ? 1 : 0.35 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1.5, fontFamily: "'Bebas Neue'", marginBottom: 6 }}>TO $</div>
                  <input className={s.input} type="text" inputMode="numeric" value={feeMax} onChange={e => setFeeMax(e.target.value)} placeholder="e.g. 1200" disabled={!feeNegotiable} />
                </div>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              <label className={s.checkLabel}>
                <input type="checkbox" checked={feeNegotiable} onChange={e => setFeeNegotiable(e.target.checked)} />
                Fee is negotiable
              </label>
              <label className={s.checkLabel}>
                <input type="checkbox" checked={feeTravel} onChange={e => setFeeTravel(e.target.checked)} />
                Fee includes travel / rider
              </label>
            </div>
          </Section>

          {/* EMERGENCY CONTACT */}
          <Section title="EMERGENCY CONTACT">
            <Field label="NAME"><input className={s.input} value={emergName} onChange={e => setEmergName(e.target.value)} placeholder="Contact name" autoComplete="off" /></Field>
            <Field label="PHONE"><input className={s.input} value={emergPhone} onChange={e => setEmergPhone(e.target.value)} placeholder="Phone number" type="tel" /></Field>
            <Field label="RELATIONSHIP"><input className={s.input} value={emergRel} onChange={e => setEmergRel(e.target.value)} placeholder="e.g. Manager, Partner" /></Field>
          </Section>

          {/* ABN / GST */}
          <Section title="ABN / GST">
            <div className={s.feeRow}>
              <button type="button" className={hasAbn ? s.feeBtnOn : s.feeBtn} onClick={() => setHasAbn(true)}>YES I HAVE AN ABN</button>
              <button type="button" className={!hasAbn ? s.feeBtnOn : s.feeBtn} style={!hasAbn ? { background: 'rgba(255,184,48,.15)', borderColor: '#FFB830', color: '#FFB830' } : {}} onClick={() => { setHasAbn(false); setGstReg(false); }}>NO ABN</button>
            </div>
            {hasAbn && (
              <>
                <Field label="ABN">
                  <input className={s.input} value={abn} onChange={e => setAbn(e.target.value)} placeholder="e.g. 12 345 678 901" inputMode="numeric" />
                </Field>
                <div className={s.feeRow}>
                  <button type="button" className={gstReg ? s.feeBtnOn : s.feeBtn} onClick={() => setGstReg(true)}>GST REGISTERED</button>
                  <button type="button" className={!gstReg ? s.feeBtnOn : s.feeBtn} style={!gstReg ? { background: 'rgba(255,184,48,.15)', borderColor: '#FFB830', color: '#FFB830' } : {}} onClick={() => setGstReg(false)}>NOT GST REG.</button>
                </div>
              </>
            )}
          </Section>

          {/* SOCIALS + LINKS */}
          <Section title="SOCIALS + LINKS">
            {[
              { icon: 'spotify',  key: 'spotify',      val: spotify,       set: setSpotify,      ph: 'Spotify artist URL' },
              { icon: 'sc',       key: 'soundcloud',   val: soundcloud,    set: setSoundcloud,   ph: 'soundcloud.com/...' },
              { icon: 'yt',       key: 'youtube',      val: youtube,       set: setYoutube,      ph: 'YouTube channel URL' },
              { icon: 'ig',       key: 'instagram',    val: instagram,     set: setInstagram,    ph: '@handle or URL' },
              { icon: 'fb',       key: 'facebook',     val: facebook,      set: setFacebook,     ph: 'facebook.com/...' },
              { icon: 'email',    key: 'contactEmail', val: contactEmail,  set: setContactEmail, ph: 'Booking email' },
              { icon: 'web',      key: 'website',      val: website,       set: setWebsite,      ph: 'https://yourband.com' },
            ].map(({ icon, key, val, set, ph }) => (
              <SocialRow key={key} icon={icon} na={naFields.has(key)} onNa={() => toggleNa(key)}>
                <input className={s.input} value={val} onChange={e => set(e.target.value)} placeholder={ph} autoCapitalize="none" disabled={naFields.has(key)} style={{ opacity: naFields.has(key) ? 0.4 : 1 }} />
              </SocialRow>
            ))}
          </Section>

          {saveErr && <div className={s.error}>{saveErr}</div>}
          <div className={s.page2Nav}>
            <button className={s.backNavBtn} onClick={() => setPage(1)}>←</button>
            <button className={s.saveBtn} style={{ flex: 1, background: GRAD, color: '#fff' }} onClick={() => save()} disabled={saving || saved}>
              {saved ? '✓ SAVED' : saving ? 'SAVING…' : 'SAVE PROFILE'}
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
      <div className={s.sectionTitle} style={{ borderImage: 'linear-gradient(90deg, #FFB830, #FF8C42) 1' }}>{title}</div>
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

const SPOTIFY_SVG = <svg viewBox="0 0 24 24" width="18" height="18" fill="#1DB954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>;
const SC_SVG    = <svg viewBox="0 0 24 24" width="18" height="18" fill="#FF5500"><path d="M1.175 12.225c-.015 0-.029.002-.044.003l-.233-2.164.233-2.093c.016 0 .03.003.044.003.574 0 1.04-.466 1.04-1.04 0-.574-.466-1.04-1.04-1.04-.574 0-1.04.466-1.04 1.04v5.29c0 .574.466 1.04 1.04 1.04s1.04-.466 1.04-1.04-.466-1.039-1.04-1.039zm3.608 1.593c-.574 0-1.04-.466-1.04-1.04V8.087c0-.574.466-1.04 1.04-1.04s1.04.466 1.04 1.04v4.691c0 .574-.466 1.04-1.04 1.04zm3.617.742c-.574 0-1.04-.466-1.04-1.04V6.694c0-.574.466-1.04 1.04-1.04s1.04.466 1.04 1.04v6.826c0 .574-.466 1.04-1.04 1.04zm3.617-.371c-.574 0-1.04-.466-1.04-1.04V5.65c0-.574.466-1.04 1.04-1.04s1.04.466 1.04 1.04v7.5c0 .574-.466 1.04-1.04 1.04zm4.658.37h-1.041V4.606c.289-.151.617-.237.963-.237 1.161 0 2.102.941 2.102 2.102 0 .258-.048.504-.133.733A2.62 2.62 0 0 1 19.5 7c1.105 0 2 .895 2 2s-.895 2-2 2h-.325v3.559z"/></svg>;
const YT_SVG    = <svg viewBox="0 0 24 24" width="18" height="18" fill="#FF0000"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>;
const IG_SVG    = <svg viewBox="0 0 24 24" width="18" height="18" fill="#E1306C"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>;
const FB_SVG    = <svg viewBox="0 0 24 24" width="18" height="18" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>;
const EMAIL_SVG = <span style={{ fontSize: 16 }}>✉️</span>;
const WEB_SVG   = <span style={{ fontSize: 16 }}>🌐</span>;

function SocialRow({ icon, children, na, onNa }) {
  const icons = { spotify: SPOTIFY_SVG, sc: SC_SVG, yt: YT_SVG, ig: IG_SVG, fb: FB_SVG, email: EMAIL_SVG, web: WEB_SVG };
  return (
    <div className={s.socialRow}>
      <div className={s.socialIcon}>{icons[icon]}</div>
      {children}
      {onNa && (
        <button type="button" onClick={onNa} style={{ flexShrink: 0, alignSelf: 'stretch', padding: '0 10px', background: na ? 'rgba(255,255,255,.06)' : 'var(--card2)', border: `1px solid ${na ? 'var(--muted)' : 'var(--border)'}`, borderRadius: 8, color: na ? 'var(--muted)' : 'rgba(255,255,255,.4)', fontFamily: "'Bebas Neue', sans-serif", fontSize: 11, letterSpacing: 1.5, cursor: 'pointer' }}>N/A</button>
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
