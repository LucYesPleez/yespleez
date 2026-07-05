import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import s from './HostProfileScreen.module.css';
import ImageUploadButton from '../components/ImageUploadButton';
import PostcodePrompt from '../components/PostcodePrompt';

const STATE_OPTIONS = ['NSW','VIC','QLD','WA','SA','TAS','ACT','NT','NZ','International'];

const HOST_CATS = ['ELECTRONIC','BANDS','SPOKEN WORD'];

const MAIN_GENRES = [
  'Techno','House','Drum & Bass','Breaks','Trance','Psytrance',
  'Progressive Psy','Dubstep / Bass','Hard Dance / Hardcore',
  'Ambient / Downtempo','Electronica','Funk / Soul / Disco',
  'Hip-Hop','Reggae / Dancehall','World / Global','Experimental','Multi Genre',
];

const HOST_GENRES = {
  'ELECTRONIC': MAIN_GENRES,
  'BANDS': ['Rock','Pop','Indie','Alternative','Metal','Punk','Jazz','Blues','Soul / RnB','Country','Folk / Acoustic','Reggae','Hip-Hop','Funk','Latin','World Music','Classic Rock','Covers / Top 40','Original','Multi Genre','Other'],
  'SPOKEN WORD': ['Stand-up Comedy','Storytelling','Poetry / Spoken Word','Improv','Panel Discussion','Debate','Cabaret','Variety / Mixed Bill','Quiz / Trivia','Lecture / Talk','Open Mic','Multi Genre','Other'],
};

const ALL_GENRES = [...new Set([...MAIN_GENRES, ...HOST_GENRES.BANDS, ...HOST_GENRES['SPOKEN WORD']])];

const SUBGENRES = {
  'Techno':             ['Peak Time','Hard Techno','Schranz','Industrial','Melodic Techno','Atmospheric','Raw / Hypnotic','Minimal','Deep Tech','Detroit','Acid','Rave'],
  'House':              ['Tech House','Deep House','Afro House','Organic House','UK Garage','2-Step','Progressive House','Melodic House','Jackin House','Funky / Groove','Electro House','Soulful'],
  'Drum & Bass':        ['Liquid','Rollers','Neurofunk','Jump Up','Dark / Atmospheric','Jungle','Techstep','Minimal DnB'],
  'Breaks':             ['Psy Breaks','Nu Skool Breaks','Electro Breaks','Florida Breaks','Acid Breaks','Big Beat','Breakbeat'],
  'Psytrance':          ['Full On','Goa','Dark Psy','Forest Psy','Hi-Tech','Twilight','Psybient','Suomi'],
  'Progressive Psy':    ['Night Prog','Psyprog','Prog Trance','Minimal Psy','Chunk'],
  'Dubstep / Bass':     ['Dubstep','UK Dubstep','Brostep','Riddim','Bass House','UK Bass','Future Bass','Trap','Footwork','Halftime','80 BPM','Glitch Hop','Leftfield','Grime'],
  'Hard Dance / Hardcore': ['Hard Techno','Hardstyle','Hardcore','Gabber','Happy Hardcore','UK Hardcore'],
};

const VIBES = [
  'Fun','Funky','Groove','Wobbly','Thinky','Bouncy','Uplifting','Clubby',
  'Bangers','Staunch','Crankin','Chunks','Sinister','Techy','Melodic','Hypnotic',
  'Deep','Dark','Dank','Organic','Shanti','Warm Up','Wonky','Classy',
  'Experimental','Underground','Glitchy','Versatile','Sledgy',
];

function parseGenreString(str) {
  const parts = new Set((str || '').split(' · ').map(s => s.trim()).filter(Boolean));
  const cats   = HOST_CATS.filter(c => parts.has(c));
  const genres = ALL_GENRES.filter(g => parts.has(g));
  const allSubs = Object.values(SUBGENRES).flat();
  const subs   = allSubs.filter(g => parts.has(g));
  const vibes  = VIBES.filter(v => parts.has(v));
  return { cats, genres, subs, vibes };
}

function buildGenreString(cats, genres, subs, vibes) {
  return [...new Set([...cats, ...genres, ...subs, ...vibes])].join(' · ');
}

export default function HostProfileScreen() {
  const { session } = useSession();
  const userId = session?.user?.id;
  const navigate = useNavigate();

  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [showPostcodePrompt, setShowPostcodePrompt] = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [saveErr,  setSaveErr]  = useState('');
  const [profileId, setProfileId] = useState(null);

  // Form fields
  const [avatar,   setAvatar]   = useState('');
  const [name,     setName]     = useState('');
  const [years,    setYears]    = useState('');
  const [location, setLocation] = useState('');
  const [state,    setState]    = useState('');
  const [postcode, setPostcode] = useState('');
  const [tagline,  setTagline]  = useState('');
  const [sound,    setSound]    = useState('');
  const [bio,      setBio]      = useState('');
  const [instagram, setInstagram] = useState('');
  const [facebook,  setFacebook]  = useState('');
  const [website,   setWebsite]   = useState('');
  const [email,     setEmail]     = useState('');
  const [naFields,  setNaFields]  = useState(new Set());

  function toggleNa(field) {
    setNaFields(prev => {
      const next = new Set(prev);
      if (next.has(field)) { next.delete(field); } else { next.add(field); }
      return next;
    });
  }

  // Interactive pickers
  const [selCats,   setSelCats]   = useState([]);
  const [selGenres, setSelGenres] = useState([]);
  const [selSubs,   setSelSubs]   = useState([]);
  const [selVibes,  setSelVibes]  = useState([]);

  useEffect(() => {
    if (!userId) return;
    supabase.from('profiles').select('*').eq('user_id', userId).eq('type', 'host').maybeSingle()
      .then(({ data }) => {
        if (data) {
          setProfileId(data.id);
          setAvatar(data.avatar || '');
          setName(data.name || '');
          setYears(data.years || '');
          setLocation(data.location || '');
          setState(data.state || '');
          setPostcode(data.postcode || '');
          setTagline(data.tagline || '');
          setSound(data.sound || '');
          setBio(data.bio || '');
          const naSet = new Set();
          const loadNa = (val, setter, key) => {
            if (val === 'N/A') { naSet.add(key); setter(''); }
            else setter(val || '');
          };
          loadNa(data.instagram, setInstagram, 'instagram');
          loadNa(data.facebook,  setFacebook,  'facebook');
          loadNa(data.website,   setWebsite,   'website');
          loadNa(data.email,     setEmail,     'email');
          setNaFields(naSet);
          const parsed = parseGenreString(data.genre_string);
          setSelCats(parsed.cats);
          setSelGenres(parsed.genres);
          setSelSubs(parsed.subs);
          setSelVibes(parsed.vibes);
        }
        setLoading(false);
      });
  }, [userId]);

  // When categories change, drop genre selections that are no longer in the available set
  useEffect(() => {
    const available = new Set(
      selCats.length === 0 ? ALL_GENRES : selCats.flatMap(c => HOST_GENRES[c] || [])
    );
    setSelGenres(prev => prev.filter(g => available.has(g)));
  }, [selCats]);

  // When main genres change, drop subgenre selections that no longer have a parent
  useEffect(() => {
    const validSubs = selGenres.flatMap(g => SUBGENRES[g] || []);
    setSelSubs(prev => prev.filter(s => validSubs.includes(s)));
  }, [selGenres]);

  function toggleCat(cat) {
    setSelCats(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
  }
  function toggleGenre(g) {
    setSelGenres(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  }
  function toggleSub(s) {
    setSelSubs(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }
  function toggleVibe(v) {
    setSelVibes(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  }

  async function save(skipPostcodeCheck = false) {
    if (!userId || saving) return;
    if (!skipPostcodeCheck && !postcode) { setShowPostcodePrompt(true); return; }
    setSaving(true);
    setSaveErr('');
    const genre_string = buildGenreString(selCats, selGenres, selSubs, selVibes);
    const payload = {
      user_id: userId, type: 'host',
      name, years, location, state, postcode,
      tagline, sound, bio,
      instagram: naFields.has('instagram') ? 'N/A' : instagram,
      facebook:  naFields.has('facebook')  ? 'N/A' : facebook,
      website:   naFields.has('website')   ? 'N/A' : website,
      email:     naFields.has('email')     ? 'N/A' : email,
      genre_string, avatar,
    };
    if (profileId) payload.id = profileId;
    const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'user_id,type' });
    if (error) {
      setSaveErr('Save failed — ' + (error.message || 'unknown error'));
    } else {
      setSaved(true);
      setTimeout(() => { setSaved(false); navigate('/industry/host'); }, 1200);
    }
    setSaving(false);
  }

  const availableGenres = selCats.length === 0
    ? ALL_GENRES
    : [...new Set(selCats.flatMap(c => HOST_GENRES[c] || []))];

  const availSubs = selGenres.flatMap(g => SUBGENRES[g] || []);

  if (loading) return <div className={s.loading}>LOADING…</div>;

  return (
    <div className={s.screen}>
      {showPostcodePrompt && <PostcodePrompt onSave={() => setShowPostcodePrompt(false)} onDismiss={() => { setShowPostcodePrompt(false); save(true); }} />}
      {/* Header */}
      <div className={s.header}>
        <div className={s.headerText}>
          <div className={s.h1}>YOUR<br/>HOST<br/>PROFILE</div>
        </div>
      </div>

      {/* Avatar */}
      <div className={s.avatarBlock}>
        <ImageUploadButton type="avatar" userId={userId} bucket="avatars" pathPrefix="host_avatars" onUpload={url => setAvatar(url)}>
          {({ trigger, statusBadge }) => (
            <div style={{ position: 'relative' }} onClick={trigger}>
              <div className={s.avatarRing}>
                {avatar
                  ? <img src={avatar} alt="avatar" className={s.avatarImg} />
                  : <div className={s.avatarPH}><span className={s.avatarPlus}>+</span>PHOTO</div>
                }
              </div>
              {statusBadge}
            </div>
          )}
        </ImageUploadButton>
        <div className={s.avatarHint}>Tap to upload photo</div>
      </div>

      {/* YOUR DETAILS */}
      <Section title="YOUR DETAILS">
        <div className={s.row}>
          <div style={{ flex: 1 }}>
            <Field label="PROMOTER / COMPANY NAME">
              <input className={s.input} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. YesPleez" autoComplete="off" />
            </Field>
          </div>
          <div style={{ width: 110 }}>
            <Field label="EST. YEAR">
              <input className={s.input} type="number" value={years} onChange={e => setYears(e.target.value)} placeholder="e.g. 2015" min="1900" max="2099" />
            </Field>
          </div>
        </div>
        <div className={s.row}>
          <div style={{ flex: 2 }}>
            <Field label="LOCATION">
              <input className={s.input} value={location} onChange={e => setLocation(e.target.value)} placeholder="Start typing your city…" autoComplete="off" />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="STATE">
              <select className={s.select} value={state} onChange={e => setState(e.target.value)}>
                <option value="">—</option>
                {STATE_OPTIONS.map(st => <option key={st} value={st}>{st}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label={<>POSTCODE <span style={{ color:'#FF2D78', fontSize:9, fontWeight:700, letterSpacing:.5 }}>IMPORTANT</span></>}>
              <input className={s.input} value={postcode} onChange={e => setPostcode(e.target.value.replace(/\D/g,''))} placeholder="e.g. 2010" maxLength={4} inputMode="numeric" />
            </Field>
          </div>
        </div>
      </Section>

      {/* TAGLINE + SOUND */}
      <Section>
        <Field label={<>TAGLINE <span className={s.fieldHint}>(one punchy line)</span></>}>
          <input className={s.input} value={tagline} onChange={e => setTagline(e.target.value)} placeholder="e.g. Sydney's most underground rave collective" maxLength={120} autoComplete="off" />
        </Field>
        <Field label={<>SOUND / VIBE BIO <span className={s.fieldHint}>35 chars</span></>}>
          <input className={s.input} value={sound} onChange={e => setSound(e.target.value)} placeholder="e.g. Deep, dark and uncompromising" maxLength={35} autoComplete="off" />
        </Field>
      </Section>

      {/* ABOUT YOUR EVENTS */}
      <Section title="ABOUT YOUR EVENTS">
        <textarea
          className={s.textarea}
          value={bio}
          onChange={e => setBio(e.target.value)}
          placeholder="What kind of events do you run? What's the vibe? What do you offer your artists?"
          maxLength={400}
          rows={4}
        />
        <div className={s.charCount}>{bio.length} / 400</div>
      </Section>

      {/* WHAT DO YOU HOST */}
      <Section title="WHAT DO YOU HOST?">
        <div className={s.pills}>
          {HOST_CATS.map(cat => {
            const on = selCats.includes(cat);
            return (
              <button
                key={cat}
                type="button"
                className={on ? s.catBtnOn : s.catBtn}
                onClick={() => toggleCat(cat)}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </Section>

      {/* GENRES YOU BOOK */}
      <Section title="GENRES YOU BOOK">
        <div className={s.chips}>
          {availableGenres.map(g => {
            const on = selGenres.includes(g);
            return (
              <button key={g} type="button" className={on ? s.chipOn : s.chip} onClick={() => toggleGenre(g)}>
                {g}
              </button>
            );
          })}
        </div>

        {availSubs.length > 0 && (
          <>
            <div className={s.subLabel}>SUB GENRES</div>
            <div className={s.chips}>
              {availSubs.map(sub => {
                const on = selSubs.includes(sub);
                return (
                  <button key={sub} type="button" className={on ? s.chipOn : s.chip} onClick={() => toggleSub(sub)}>
                    {sub}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </Section>

      {/* VIBES */}
      <Section title="VIBES">
        <div className={s.chips}>
          {VIBES.map(v => {
            const on = selVibes.includes(v);
            return (
              <button key={v} type="button" className={on ? s.chipOn : s.chip} onClick={() => toggleVibe(v)}>
                {v}
              </button>
            );
          })}
        </div>
      </Section>

      {/* CONTACT + SOCIALS */}
      <Section title="CONTACT + SOCIALS">
        <SocialRow icon="ig" na={naFields.has('instagram')} onNa={() => toggleNa('instagram')}>
          <input className={s.input} value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="@yourhandle" disabled={naFields.has('instagram')} style={{ opacity: naFields.has('instagram') ? 0.4 : 1 }} />
        </SocialRow>
        <SocialRow icon="fb" na={naFields.has('facebook')} onNa={() => toggleNa('facebook')}>
          <input className={s.input} type="url" value={facebook} onChange={e => setFacebook(e.target.value)} placeholder="https://facebook.com/…" disabled={naFields.has('facebook')} style={{ opacity: naFields.has('facebook') ? 0.4 : 1 }} />
        </SocialRow>
        <SocialRow icon="web" na={naFields.has('website')} onNa={() => toggleNa('website')}>
          <input className={s.input} type="url" value={website} onChange={e => setWebsite(e.target.value)} placeholder="Website" disabled={naFields.has('website')} style={{ opacity: naFields.has('website') ? 0.4 : 1 }} />
        </SocialRow>
        <SocialRow icon="email" na={naFields.has('email')} onNa={() => toggleNa('email')}>
          <input className={s.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Booking contact email" disabled={naFields.has('email')} style={{ opacity: naFields.has('email') ? 0.4 : 1 }} />
        </SocialRow>
      </Section>

      {saveErr && <p className={s.error}>{saveErr}</p>}

      <button className={s.saveBtn} onClick={() => save()} disabled={saving}>
        {saving ? 'SAVING…' : saved ? '✓ SAVED!' : 'SAVE HOST PROFILE →'}
      </button>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className={s.section}>
      {title && <div className={s.sectionTitle} style={{ borderImage: 'linear-gradient(90deg, #FF2D78, #00E5FF) 1' }}>{title}</div>}
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

const IG_SVG = <svg viewBox="0 0 24 24" width="18" height="18" fill="#E1306C"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>;
const FB_SVG = <svg viewBox="0 0 24 24" width="18" height="18" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>;
const WEB_SVG = <span style={{ fontSize: 16 }}>🌐</span>;
const EMAIL_SVG = <span style={{ fontSize: 16 }}>✉️</span>;

function SocialRow({ icon, children, na, onNa }) {
  const icons = { ig: IG_SVG, fb: FB_SVG, web: WEB_SVG, email: EMAIL_SVG };
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
