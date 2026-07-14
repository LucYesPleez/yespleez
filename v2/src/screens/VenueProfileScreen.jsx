import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import AvatarUpload from '../components/AvatarUpload';
import s from './ArtistProfileScreen.module.css';
import PostcodePrompt from '../components/PostcodePrompt';
import CardTagPicker from '../components/CardTagPicker';

const STATE_OPTIONS = ['NSW','VIC','QLD','WA','SA','TAS','ACT','NT','NZ','International'];

// 'Festival Site' / 'Festivals' intentionally not offered this release — see
// HOST_CATEGORIES in profileTaxonomy.js.
const VENUE_TYPES = [
  'Brewery','Pub','Bar','Restaurant','Hall',
  'Theatre','Warehouse','Café','Winery','Distillery','Land','Other',
];

const PERFECT_FOR = [
  'Live Events','Birthday Parties','Corporate Events',
  'Wedding Receptions','Private Functions','Album Launches','Open Mic','Weekly Residency',
];

const ATMOSPHERE_TAGS = [
  'Indoor','Outdoor','Beer Garden','Bushland','Coastal','Rustic',
  'Underground','Intimate','Industrial','Scenic','Community',
  'Late Night','High Energy','Family Friendly',
];

const ENTERTAINMENT = [
  'DJs','Live Bands','Solo Artists','Acoustic Acts','Stand Up Comedy',
  'Comedians','Poetry / Spoken Word','Jazz Acts','Open Mic',
];

const TECH_OPTIONS = [
  'PA SYSTEM','LIGHTING RIG','BACKLINE','STAGE MONITORS',
  'GREEN ROOM','LOAD IN ACCESS','IN-HOUSE ENGINEER','PROJECTOR / SCREEN',
];

const DAYS = ['MON','TUE','WED','THU','FRI','SAT','SUN'];

const ACCENT   = '#00E5A0';
const ACCENT2  = '#00B4D8';
const CYAN     = '#00E5FF';
const CYAN_RGB = '0,229,255';
const SECTION_TITLE_STYLE = { borderImage: `linear-gradient(90deg, ${ACCENT}, ${ACCENT2}) 1` };

const GH = ({ children }) => (
  <span style={{ display: 'inline-block', background: `linear-gradient(135deg, ${ACCENT} 40%, ${ACCENT2} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
    {children}
  </span>
);

export default function VenueProfileScreen() {
  const { session } = useSession();
  const userId = session?.user?.id;
  const navigate = useNavigate();

  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [showPostcodePrompt, setShowPostcodePrompt] = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [saveErr,  setSaveErr]  = useState('');
  const [isDirty,  setIsDirty]  = useState(false);

  // Form state
  const [avatarUrl,   setAvatarUrl]   = useState('');
  const [avatarHero,  setAvatarHero]  = useState('');
  const [avatarThumb, setAvatarThumb] = useState('');
  const [name,        setName]        = useState('');
  const [sound,       setSound]       = useState('');
  const [tagline,     setTagline]     = useState('');
  const [address,     setAddress]     = useState('');
  const [suburb,      setSuburb]      = useState('');
  const [state,       setState_]      = useState('');
  const [postcode,    setPostcode]    = useState('');
  const [venueType,   setVenueType]   = useState(new Set());
  const [atmosphere,  setAtmosphere]  = useState(new Set());
  const [perfectFor,  setPerfectFor]  = useState(new Set());
  const [established, setEstablished] = useState('');
  const [bio,         setBio]         = useState('');
  const [stageDims,   setStageDims]   = useState('');
  const [entertain,   setEntertain]   = useState(new Set());
  const [tech,        setTech]        = useState(new Set());
  const [days,        setDays]        = useState(new Set());
  const [naFields,    setNaFields]    = useState(new Set());
  const [hasAbn,      setHasAbn]      = useState(null);
  const [abn,         setAbn]         = useState('');
  const [gst,         setGst]         = useState(null);
  const [email,       setEmail]       = useState('');
  const [website,     setWebsite]     = useState('');
  const [instagram,   setInstagram]   = useState('');
  const [facebook,    setFacebook]    = useState('');
  const [tiktok,      setTiktok]      = useState('');
  const [capacity,    setCapacity]    = useState('');
  const [cardPills,   setCardPills]   = useState([]);

  const years = useMemo(
    () => Array.from({ length: new Date().getFullYear() - 1899 }, (_, i) => new Date().getFullYear() - i),
    [],
  );

  useEffect(() => {
    if (!userId) return;
    supabase.from('profiles')
      .select('avatar, avatar_hero, avatar_thumb, name, sound, tagline, location, suburb, state, postcode, venue_type, atmosphere, perfect_for, established_year, bio, stage_dims, capacity, genre_string, card_pills, tech_features, live_nights, has_abn, abn, gst_registered, contact_email, email, website, instagram, facebook, tiktok')
      .eq('user_id', userId).eq('type', 'venue').maybeSingle()
      .then(({ data: p, error }) => {
        if (error) { setSaveErr('Failed to load profile. Please refresh.'); setLoading(false); return; }
        if (p) {
          setAvatarUrl(p.avatar || '');
          setAvatarHero(p.avatar_hero || '');
          setAvatarThumb(p.avatar_thumb || '');
          setName(p.name || '');
          setSound(p.sound || '');
          setTagline(p.tagline || '');
          setAddress(p.location || '');
          setSuburb(p.suburb || '');
          setState_(p.state || '');
          setPostcode(p.postcode || '');
          setVenueType(new Set((p.venue_type || '').split(',').map(x => x.trim()).filter(Boolean)));
          setAtmosphere(new Set((p.atmosphere || '').split(',').map(x => x.trim()).filter(Boolean)));
          setPerfectFor(new Set((p.perfect_for || '').split(',').map(x => x.trim()).filter(Boolean)));
          setEstablished(p.established_year ? String(p.established_year) : '');
          setBio(p.bio || '');
          setStageDims(p.stage_dims || '');
          setCapacity(p.capacity ? String(p.capacity) : '');
          setEntertain(new Set((p.genre_string || '').split(',').map(x => x.trim()).filter(Boolean)));
          setCardPills(p.card_pills ? p.card_pills.split(' · ').filter(Boolean) : []);
          setTech(new Set((p.tech_features || '').split(',').map(x => x.trim()).filter(Boolean)));
          setDays(new Set((p.live_nights || '').split(',').map(x => x.trim()).filter(Boolean)));
          setHasAbn(p.has_abn ?? null);
          setAbn(p.abn || '');
          setGst(p.gst_registered ?? null);
          const naSet = new Set();
          const loadNa = (val, setFn, key) => { if (val === 'N/A') { naSet.add(key); setFn(''); } else { setFn(val || ''); } };
          loadNa(p.contact_email || p.email, setEmail, 'email');
          loadNa(p.website, setWebsite, 'website');
          loadNa(p.instagram, setInstagram, 'instagram');
          loadNa(p.facebook, setFacebook, 'facebook');
          loadNa(p.tiktok, setTiktok, 'tiktok');
          setNaFields(naSet);
        }
        setLoading(false);
      });
  }, [userId]);

  // Guard browser tab close / refresh when dirty
  useEffect(() => {
    if (!isDirty) return;
    const handler = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // useBlocker requires a data router — not available with <HashRouter>. beforeunload above handles the browser close case.
  const blocker = null;

  function toggleNa(field) {
    setNaFields(prev => {
      const next = new Set(prev);
      if (next.has(field)) { next.delete(field); } else { next.add(field); }
      return next;
    });
    setIsDirty(true);
  }

  function toggleSet(set, setFn, val) {
    const next = new Set(set);
    next.has(val) ? next.delete(val) : next.add(val);
    setFn(next);
    setIsDirty(true);
  }

  async function save(skipPostcodeCheck = false) {
    if (!name.trim()) { setSaveErr('Please enter a venue name'); return; }
    if (!skipPostcodeCheck && !postcode && !suburb && !address) { setShowPostcodePrompt(true); return; }
    setSaving(true); setSaveErr('');
    try {
      const payload = {
        user_id:          userId,
        type:             'venue',
        name:             name.trim(),
        sound:            sound.trim(),
        tagline:          tagline.trim(),
        location:         address.trim(),
        suburb:           suburb.trim(),
        state:            state,
        postcode:         postcode,
        venue_type:       [...venueType].join(', '),
        atmosphere:       [...atmosphere].join(', '),
        perfect_for:      [...perfectFor].join(', '),
        established_year: established ? parseInt(established) : null,
        genre_string:     [...entertain].join(', '),
        card_pills:       cardPills.join(' · '),
        bio:              bio.trim(),
        stage_dims:       stageDims.trim(),
        tech_features:    [...tech].join(', '),
        live_nights:      [...days].join(', '),
        capacity:         capacity ? parseInt(capacity) : null,
        has_abn:          hasAbn,
        abn:              abn.trim(),
        gst_registered:   gst,
        contact_email:    naFields.has('email')     ? 'N/A' : email.trim(),
        website:          naFields.has('website')   ? 'N/A' : website.trim(),
        instagram:        naFields.has('instagram') ? 'N/A' : instagram.trim(),
        facebook:         naFields.has('facebook')  ? 'N/A' : facebook.trim(),
        tiktok:           naFields.has('tiktok')    ? 'N/A' : tiktok.trim(),
        avatar:           avatarHero || avatarUrl || null,
        avatar_hero:      avatarHero || null,
        avatar_thumb:     avatarThumb || null,
        updated_at:       new Date().toISOString(),
      };
      const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'user_id,type' });
      if (error) { setSaveErr('Save failed: ' + error.message); return; }
      setSaved(true);
      setIsDirty(false);
      setTimeout(() => { setSaved(false); navigate('/industry/venue'); }, 800);
    } catch (e) {
      setSaveErr('Save failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className={s.screen}><p className={s.loading}>LOADING…</p></div>;

  return (
    <div className={s.screen}>
      {/* Unsaved changes blocker */}
      {blocker?.state === 'blocked' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.82)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: '#181825', borderRadius: 16, padding: 24, maxWidth: 320, width: '100%', border: '1px solid rgba(255,255,255,.1)' }}>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 20, letterSpacing: 2, marginBottom: 10 }}>UNSAVED CHANGES</div>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,.55)', marginBottom: 20, lineHeight: 1.6 }}>You have unsaved changes. Leave without saving?</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => blocker.reset()} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid rgba(255,255,255,.15)', background: 'none', color: 'rgba(255,255,255,.6)', fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, cursor: 'pointer' }}>STAY</button>
              <button type="button" onClick={() => blocker.proceed()} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', background: '#FF3B5C', color: '#fff', fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, cursor: 'pointer' }}>LEAVE</button>
            </div>
          </div>
        </div>
      )}

      {showPostcodePrompt && <PostcodePrompt onSave={() => setShowPostcodePrompt(false)} onDismiss={() => { setShowPostcodePrompt(false); save(true); }} />}

      {/* Header */}
      <div className={s.header}>
        <div className={s.headerText}>
          <div className={s.h1} style={{ background: `linear-gradient(135deg,${ACCENT},${ACCENT2})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>YOUR<br/>VENUE</div>
        </div>
      </div>

      {/* Avatar */}
      <AvatarUpload
        userId={userId} bucket="avatars" pathPrefix="venue_avatars"
        avatar={avatarUrl}
        ringClass={`${s.avatarRing} ${s.avatarRingVenue}`}
        onUpload={({ avatar_hero, avatar_thumb }) => { setAvatarHero(avatar_hero); setAvatarThumb(avatar_thumb); setAvatarUrl(avatar_hero); setIsDirty(true); }}
        onRemove={() => { setAvatarUrl(''); setAvatarHero(''); setAvatarThumb(''); setIsDirty(true); }}
      />

      <form onSubmit={e => { e.preventDefault(); save(); }} onChange={() => setIsDirty(true)}>

        {/* Venue Name */}
        <div className={s.section}>
          <div className={s.sectionTitle} style={SECTION_TITLE_STYLE}><GH>VENUE NAME</GH></div>
          <div className={s.field}>
            <input className={s.input} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. The Metro Theatre" />
          </div>
        </div>

        {/* Vibe + Tagline */}
        <div className={s.section}>
          <div className={s.sectionTitle} style={SECTION_TITLE_STYLE}><GH>LISTING INFO</GH></div>
          <div className={s.field}>
            <label className={s.fieldLabel}>YOUR VIBE <span className={s.fieldHint}>shows on your listing · 50 chars</span></label>
            <input className={s.input} value={sound} onChange={e => setSound(e.target.value.slice(0,50))} placeholder="e.g. Underground warehouse techno venue" maxLength={50} />
            <div className={s.charCount}>{sound.length} / 50</div>
          </div>
          <div className={s.field}>
            <label className={s.fieldLabel}>TAGLINE <span className={s.fieldHint}>100 chars</span></label>
            <textarea className={s.textarea} rows={2} value={tagline} onChange={e => setTagline(e.target.value.slice(0,100))} placeholder="Sydney's most iconic live music room. Three floors, two stages, one vibe." maxLength={100} style={{ minHeight: 56 }} />
            <div className={s.charCount}>{tagline.length} / 100</div>
          </div>
        </div>

        {/* Location */}
        <div className={s.section}>
          <div className={s.sectionTitle} style={SECTION_TITLE_STYLE}><GH>LOCATION</GH></div>
          <div className={s.row}>
            <div className={s.field} style={{ flex: 2 }}>
              <div className={s.fieldLabel}>ADDRESS</div>
              <input className={s.input} value={address} onChange={e => setAddress(e.target.value)} placeholder="e.g. 123 Main St" />
            </div>
            <div className={s.field} style={{ flex: 1 }}>
              <div className={s.fieldLabel}>SUBURB / TOWN</div>
              <input className={s.input} value={suburb} onChange={e => setSuburb(e.target.value)} placeholder="e.g. Bellingen" />
            </div>
          </div>
          <div className={s.row}>
            <div className={s.field} style={{ flex: 1 }}>
              <div className={s.fieldLabel}>STATE</div>
              <select className={s.select} value={state} onChange={e => setState_(e.target.value)}>
                <option value="">—</option>
                {STATE_OPTIONS.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className={s.field} style={{ flex: 1 }}>
              <div className={s.fieldLabel}>POSTCODE</div>
              <input className={s.input} value={postcode} onChange={e => setPostcode(e.target.value.replace(/\D/g,'').slice(0,4))} placeholder="e.g. 2454" inputMode="numeric" />
            </div>
          </div>
        </div>

        {/* Venue Type + Est + Capacity */}
        <div className={s.section}>
          <div className={s.sectionTitle} style={SECTION_TITLE_STYLE}><GH>VENUE DETAILS</GH></div>
          <div className={s.field}>
            <label className={s.fieldLabel}>VENUE TYPE</label>
            <div className={s.chips}>
              {VENUE_TYPES.map(t => (
                <button key={t} type="button"
                  className={venueType.has(t) ? s.chipOn : s.chip}
                  style={venueType.has(t) ? { background: `rgba(${CYAN_RGB},.15)`, borderColor: CYAN, color: CYAN } : { background: `rgba(${CYAN_RGB},.06)`, borderColor: `rgba(${CYAN_RGB},.2)` }}
                  onClick={() => toggleSet(venueType, setVenueType, t)}>{t}</button>
              ))}
            </div>
          </div>
          <div className={s.row}>
            <div className={s.field} style={{ flex: 1 }}>
              <label className={s.fieldLabel}>ESTABLISHED</label>
              <select className={s.select} value={established} onChange={e => setEstablished(e.target.value)}>
                <option value="">Year</option>
                {years.map(y => <option key={y}>{y}</option>)}
              </select>
            </div>
            <div className={s.field} style={{ flex: 1 }}>
              <label className={s.fieldLabel}>CAPACITY</label>
              <input className={s.input} value={capacity} onChange={e => setCapacity(e.target.value.replace(/\D/g,''))} placeholder="e.g. 500" inputMode="numeric" />
            </div>
          </div>
        </div>

        {/* Atmosphere */}
        <div className={s.section}>
          <div className={s.sectionTitle} style={SECTION_TITLE_STYLE}><GH>ATMOSPHERE</GH></div>
          <div className={s.chips}>
            {ATMOSPHERE_TAGS.map(t => (
              <button key={t} type="button"
                className={atmosphere.has(t) ? s.chipOn : s.chip}
                style={atmosphere.has(t) ? { background: `rgba(${CYAN_RGB},.15)`, borderColor: CYAN, color: CYAN } : { background: `rgba(${CYAN_RGB},.06)`, borderColor: `rgba(${CYAN_RGB},.2)` }}
                onClick={() => toggleSet(atmosphere, setAtmosphere, t)}>{t}</button>
            ))}
          </div>
        </div>

        {/* Perfect For */}
        <div className={s.section}>
          <div className={s.sectionTitle} style={SECTION_TITLE_STYLE}><GH>PERFECT FOR</GH></div>
          <div className={s.chips}>
            {PERFECT_FOR.map(t => (
              <button key={t} type="button"
                className={perfectFor.has(t) ? s.chipOn : s.chip}
                style={perfectFor.has(t) ? { background: `rgba(${CYAN_RGB},.15)`, borderColor: CYAN, color: CYAN } : { background: `rgba(${CYAN_RGB},.06)`, borderColor: `rgba(${CYAN_RGB},.2)` }}
                onClick={() => toggleSet(perfectFor, setPerfectFor, t)}>{t}</button>
            ))}
          </div>
        </div>

        {/* Entertainment we book */}
        <div className={s.section}>
          <div className={s.sectionTitle} style={SECTION_TITLE_STYLE}><GH>ENTERTAINMENT WE BOOK</GH></div>
          <div className={s.chips}>
            {ENTERTAINMENT.map(e => (
              <button key={e} type="button" className={entertain.has(e) ? s.chipOn : s.chip}
                style={entertain.has(e) ? { background: `rgba(${CYAN_RGB},.15)`, borderColor: CYAN, color: CYAN } : { background: `rgba(${CYAN_RGB},.06)`, borderColor: `rgba(${CYAN_RGB},.2)` }}
                onClick={() => toggleSet(entertain, setEntertain, e)}>{e}</button>
            ))}
          </div>
        </div>

        {/* Your 5 tags */}
        {(() => {
          const tagPool = [...new Set([...entertain, ...atmosphere, ...perfectFor])];
          if (!tagPool.length) return null;
          return (
            <div className={s.section}>
              <div className={s.sectionTitle} style={SECTION_TITLE_STYLE}><GH>YOUR 5 TAGS</GH></div>
              <CardTagPicker
                tagPool={tagPool}
                selected={cardPills}
                onChange={pills => { setCardPills(pills); setIsDirty(true); }}
                accent="#00E5FF"
                hint="Pick the tags that best describe your venue — shown on your profile card."
              />
            </div>
          );
        })()}

        {/* About */}
        <div className={s.section}>
          <div className={s.sectionTitle} style={SECTION_TITLE_STYLE}><GH>ABOUT THE VENUE</GH></div>
          <div className={s.field}>
            <textarea className={s.textarea} rows={5} value={bio} onChange={e => setBio(e.target.value.slice(0,500))} placeholder="Tell artists and promoters what makes your venue special — history, sound system, stage setup, crowd, and the kind of nights you run." maxLength={500} style={{ minHeight: 110 }} />
            <div className={s.charCount}>{bio.length} / 500</div>
          </div>
        </div>

        {/* Stage & Tech */}
        <div className={s.section}>
          <div className={s.sectionTitle} style={SECTION_TITLE_STYLE}><GH>STAGE & TECH</GH></div>
          <div className={s.chips} style={{ marginBottom: 12 }}>
            {TECH_OPTIONS.map(t => (
              <button key={t} type="button" className={tech.has(t) ? s.chipOn : s.chip}
                style={tech.has(t) ? { background: `rgba(${CYAN_RGB},.15)`, borderColor: CYAN, color: CYAN, borderRadius: 6, fontFamily: "'Bebas Neue'", letterSpacing: 1.5 } : { background: `rgba(${CYAN_RGB},.06)`, borderColor: `rgba(${CYAN_RGB},.2)`, borderRadius: 6, fontFamily: "'Bebas Neue'", letterSpacing: 1.5 }}
                onClick={() => toggleSet(tech, setTech, t)}>{t}</button>
            ))}
          </div>
          <div className={s.field}>
            <label className={s.fieldLabel}>STAGE DIMENSIONS <span className={s.fieldHint}>(optional)</span></label>
            <input className={s.input} value={stageDims} onChange={e => setStageDims(e.target.value)} placeholder="e.g. 8m x 5m" />
          </div>
        </div>

        {/* Live nights */}
        <div className={s.section}>
          <div className={s.sectionTitle} style={SECTION_TITLE_STYLE}><GH>TYPICAL LIVE MUSIC NIGHTS</GH></div>
          <div className={s.pills}>
            {DAYS.map(d => (
              <button key={d} type="button"
                className={days.has(d) ? s.catBtnOn : s.catBtn}
                style={days.has(d) ? { background: `rgba(${CYAN_RGB},.15)`, borderColor: CYAN, color: CYAN, borderRadius: 6 } : { background: `rgba(${CYAN_RGB},.06)`, borderColor: `rgba(${CYAN_RGB},.2)`, borderRadius: 6 }}
                onClick={() => toggleSet(days, setDays, d)}>{d}</button>
            ))}
          </div>
        </div>

        {/* ABN / GST */}
        <div className={s.section}>
          <div className={s.sectionTitle} style={SECTION_TITLE_STYLE}><GH>ABN / GST</GH></div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            {[{ label: 'YES I HAVE AN ABN', val: true, active: '#00E5A0', activeBg: 'rgba(0,229,160,.15)' }, { label: 'NO ABN', val: false, active: '#FFB830', activeBg: 'rgba(255,184,48,.08)' }].map(({ label, val, active, activeBg }) => (
              <button key={label} type="button" onClick={() => { setHasAbn(val); setIsDirty(true); }}
                style={{ flex: 1, fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, padding: '10px 14px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${hasAbn === val ? active : 'var(--border)'}`, background: hasAbn === val ? activeBg : 'var(--card2)', color: hasAbn === val ? active : 'var(--muted)' }}>{label}</button>
            ))}
          </div>
          {hasAbn && (
            <>
              <div className={s.field}>
                <label className={s.fieldLabel}>ABN</label>
                <input className={s.input} value={abn} onChange={e => setAbn(e.target.value)} placeholder="e.g. 12 345 678 901" />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {[{ label: 'GST REGISTERED', val: true, active: '#00E5A0', activeBg: 'rgba(0,229,160,.15)' }, { label: 'NOT GST REGISTERED', val: false, active: '#FFB830', activeBg: 'rgba(255,184,48,.08)' }].map(({ label, val, active, activeBg }) => (
                  <button key={label} type="button" onClick={() => { setGst(val); setIsDirty(true); }}
                    style={{ flex: 1, fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.2, padding: '10px 8px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${gst === val ? active : 'var(--border)'}`, background: gst === val ? activeBg : 'var(--card2)', color: gst === val ? active : 'var(--muted)' }}>{label}</button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Socials */}
        <div className={s.section}>
          <div className={s.sectionTitle} style={SECTION_TITLE_STYLE}><GH>SOCIALS + LINKS</GH></div>
          {[
            { key: 'email',     svg: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e8e8f0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>, val: email, set: setEmail, placeholder: 'Booking / enquiry email', type: 'email' },
            { key: 'website',   svg: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e8e8f0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>, val: website, set: setWebsite, placeholder: 'Website URL', type: 'url' },
            { key: 'instagram', svg: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><defs><linearGradient id="ig" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stopColor="#f09433"/><stop offset="25%" stopColor="#e6683c"/><stop offset="50%" stopColor="#dc2743"/><stop offset="75%" stopColor="#cc2366"/><stop offset="100%" stopColor="#bc1888"/></linearGradient></defs><rect x="2" y="2" width="20" height="20" rx="5" stroke="url(#ig)"/><circle cx="12" cy="12" r="5" stroke="url(#ig)"/><circle cx="17.5" cy="6.5" r="1" fill="#dc2743"/></svg>, val: instagram, set: setInstagram, placeholder: '@yourhandle', type: 'text' },
            { key: 'tiktok',    svg: <svg width="20" height="20" viewBox="0 0 24 24" fill="#e8e8f0"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.17 8.17 0 0 0 4.78 1.52V6.74a4.85 4.85 0 0 1-1.01-.05z"/></svg>, val: tiktok, set: setTiktok, placeholder: '@tiktokhandle', type: 'text' },
            { key: 'facebook',  svg: <svg width="20" height="20" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>, val: facebook, set: setFacebook, placeholder: 'Facebook URL', type: 'url' },
          ].map(({ key, svg, val, set, placeholder, type }) => {
            const na = naFields.has(key);
            return (
              <div key={key} className={s.socialRow}>
                <div className={s.socialIcon} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, flexShrink: 0 }}>{svg}</div>
                <input className={s.input} type={type} value={val} onChange={e => set(e.target.value)} placeholder={placeholder} disabled={na} style={{ opacity: na ? 0.4 : 1 }} />
                <button type="button" onClick={() => toggleNa(key)} style={{ flexShrink: 0, alignSelf: 'stretch', padding: '0 10px', background: na ? 'rgba(255,255,255,.06)' : 'var(--card2)', border: `1px solid ${na ? 'var(--muted)' : 'var(--border)'}`, borderRadius: 8, color: na ? 'var(--muted)' : 'rgba(255,255,255,.4)', fontFamily: "'Bebas Neue', sans-serif", fontSize: 11, letterSpacing: 1, cursor: 'pointer', whiteSpace: 'nowrap' }}>N/A</button>
              </div>
            );
          })}
        </div>

        {/* Save */}
        <div className={s.section}>
          {saveErr && <p style={{ color: '#FF5555', fontSize: 13, marginBottom: 10 }}>{saveErr}</p>}
          <button
            type="submit"
            className={s.saveBtn}
            style={{ width: '100%', background: `linear-gradient(135deg,${ACCENT},${ACCENT2})`, color: '#fff' }}
            disabled={saving}
          >
            {saved ? 'SAVED ✓' : saving ? 'SAVING…' : 'SAVE VENUE PROFILE →'}
          </button>
        </div>

      </form>
    </div>
  );
}
