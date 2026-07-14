import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import s from './ArtistProfileScreen.module.css';
import AvatarUpload from '../components/AvatarUpload';
import { useProfileForm } from '../hooks/useProfileForm';
import ProfileFormShell from '../components/ProfileFormShell';
import SectionBlock from '../components/SectionBlock';
import SocialSection from '../components/SocialSection';
import { BAND_GENRES, BAND_SUBGENRES, BAND_VIBES } from '../lib/profileTaxonomy';

const STATE_OPTIONS = ['NSW','VIC','QLD','WA','SA','TAS','ACT','NT','NZ','International'];
const EXP_LEVELS   = ['EMERGING','DEVELOPING','ESTABLISHED','TOURING'];

// BAND_GENRES + BAND_SUBGENRES + BAND_VIBES now come from the shared
// ../lib/profileTaxonomy (2026-07 refresh). No rename map — old stored values
// that aren't in the new lists are simply dropped, none were declared renamed.

const COL  = '#FFB830';
const COL2 = '#FF8C42';
const GRAD = `linear-gradient(90deg, ${COL} 0%, ${COL2} 100%)`;

function Section({ title, children }) {
  return (
    <SectionBlock title={title} accent={COL} accent2={COL2} className={s.section} titleClassName={s.sectionTitle}>
      {children}
    </SectionBlock>
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

export default function BandProfileScreen() {
  const { session } = useSession();
  const userId = session?.user?.id;

  const {
    avatarUrl, setAvatarUrl,
    avatarHero, setAvatarHero,
    avatarThumb, setAvatarThumb,
    handleAvatarUpload, handleAvatarRemove,
    naFields, setNaFields, toggleNa, loadNa,
    isDirty: _isDirty, setIsDirty,
    markDirty, blocker,
    showPostcodePrompt, setShowPostcodePrompt,
    saving, saved, saveErr, setSaveErr,
    runSave,
  } = useProfileForm();

  const [page,    setPage]    = useState(1);
  const [loading, setLoading] = useState(true);

  // Page 1
  const [name,        setName]        = useState('');
  const [bandType,    setBandType]    = useState('');
  const [members,     setMembers]     = useState('');
  const [established, setEstablished] = useState('');
  const [location,    setLocation]    = useState('');
  const [locState,    setLocState]    = useState('');
  const [postcode,    setPostcode]    = useState('');
  const [tagline,     setTagline]     = useState('');
  const [epkLink,     setEpkLink]     = useState('');
  const [selGenres,   setSelGenres]   = useState([]);
  const [selSubs,     setSelSubs]     = useState([]);
  const [selVibes,    setSelVibes]    = useState([]);
  const [selTags,     setSelTags]     = useState([]);

  // Page 2
  const [bio,           setBio]           = useState('');
  const [expLevel,      setExpLevel]      = useState('');
  const [feeType,       setFeeType]       = useState('');
  const [feeAmount,     setFeeAmount]     = useState('');
  const [feeMax,        setFeeMax]        = useState('');
  const [feeNegotiable, setFeeNegotiable] = useState(false);
  const [feeTravel,     setFeeTravel]     = useState(false);
  const [emergName,     setEmergName]     = useState('');
  const [emergPhone,    setEmergPhone]    = useState('');
  const [emergRel,      setEmergRel]      = useState('');
  const [hasAbn,        setHasAbn]        = useState(false);
  const [abn,           setAbn]           = useState('');
  const [gstReg,        setGstReg]        = useState(false);
  const [spotify,       setSpotify]       = useState('');
  const [soundcloud,    setSoundcloud]    = useState('');
  const [youtube,       setYoutube]       = useState('');
  const [instagram,     setInstagram]     = useState('');
  const [facebook,      setFacebook]      = useState('');
  const [contactEmail,  setContactEmail]  = useState('');
  const [website,       setWebsite]       = useState('');

  useEffect(() => {
    if (!userId) return;
    supabase.from('profiles').select('*').eq('user_id', userId).eq('type', 'band').maybeSingle()
      .then(({ data, error }) => {
        if (error) { setSaveErr('Failed to load profile. Please refresh.'); setLoading(false); return; }
        if (data) {
          setAvatarUrl(data.avatar || '');
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
          if (data.experience)    setExpLevel(data.experience);
          if (data.fee_type)      setFeeType(data.fee_type);
          if (data.fee)           setFeeAmount(String(data.fee));
          if (data.fee_max)       setFeeMax(String(data.fee_max));
          setFeeNegotiable(!!data.fee_negotiable);
          setFeeTravel(!!data.fee_travel);
          setEmergName(data.emergency_name || '');
          setEmergPhone(data.emergency_phone || '');
          setEmergRel(data.emergency_rel || '');
          setHasAbn(!!data.has_abn);
          setAbn(data.abn || '');
          setGstReg(!!data.gst_registered);
          const naSet = new Set();
          loadNa(data.spotify,       setSpotify,      'spotify',      naSet);
          loadNa(data.soundcloud,    setSoundcloud,   'soundcloud',   naSet);
          loadNa(data.youtube,       setYoutube,      'youtube',      naSet);
          loadNa(data.instagram,     setInstagram,    'instagram',    naSet);
          loadNa(data.facebook,      setFacebook,     'facebook',     naSet);
          loadNa(data.contact_email, setContactEmail, 'contactEmail', naSet);
          loadNa(data.website,       setWebsite,      'website',      naSet);
          setNaFields(naSet);
          const str = data.genre_string || '';
          const parts = new Set(str.split(/,\s*|\s+·\s+/).map(x => x.trim()).filter(Boolean));
          setSelGenres(BAND_GENRES.filter(g => parts.has(g)));
          setSelSubs(BAND_SUBGENRES.filter(g => parts.has(g)));
          setSelVibes(BAND_VIBES.filter(v => parts.has(v)));
          if (data.card_pills) setSelTags(data.card_pills.split(' · ').filter(Boolean));
        }
        setLoading(false);
      });
  }, [userId]);

  // card_pills is its own stored column, separate from genre_string — prune it
  // against the current genre/subgenre/vibe pool so a taxonomy refresh (values
  // renamed or removed) doesn't leave an obsolete tag stuck in card_pills.
  useEffect(() => {
    const pool = new Set([...selGenres, ...selSubs, ...selVibes]);
    setSelTags(prev => prev.filter(t => pool.has(t)));
  }, [selGenres, selSubs, selVibes]);

  function toggleGenre(g) { setSelGenres(p => p.includes(g) ? p.filter(x => x !== g) : [...p, g]); setIsDirty(true); }
  function toggleSub(sub) { setSelSubs(p   => p.includes(sub) ? p.filter(x => x !== sub) : [...p, sub]); setIsDirty(true); }
  function toggleVibe(v)  { setSelVibes(p  => p.includes(v) ? p.filter(x => x !== v) : [...p, v]); setIsDirty(true); }
  function toggleTag(t)   { setSelTags(p => p.includes(t) ? p.filter(x => x !== t) : p.length >= 5 ? p : [...p, t]); setIsDirty(true); }

  function save(skipPostcodeCheck = false) {
    if (!userId || saving) return;
    if (!skipPostcodeCheck && !postcode && !location) { setShowPostcodePrompt(true); return; }
    const genre_string = [...new Set([...selGenres, ...selSubs, ...selVibes])].join(' · ');
    const card_pills   = selTags.join(' · ');
    const payload = {
      user_id: userId, type: 'band',
      name, band_type: bandType,
      member_count: members ? parseInt(members) : null,
      established_year: established ? parseInt(established) : null,
      location, state: locState, postcode,
      tagline, bio,
      mix_link: epkLink, epk_link: epkLink,
      genre_string, card_pills, avatar: avatarHero || avatarUrl,
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
    runSave(async () => {
      const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'user_id,type' });
      if (error) throw error;
    }, '/industry/band', 1200);
  }

  if (loading) return <div className={s.loading}>LOADING…</div>;

  return (
    <div className={s.screen}>
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
        <AvatarUpload
          userId={userId} bucket="avatars" pathPrefix="band_avatars"
          avatar={avatarUrl}
          ringClass={s.avatarRing}
          onUpload={handleAvatarUpload}
          onRemove={handleAvatarRemove}
        />
      )}

      <ProfileFormShell
        blocker={blocker}
        showPostcodePrompt={showPostcodePrompt}
        onPostcodeSave={() => setShowPostcodePrompt(false)}
        onPostcodeDismiss={() => { setShowPostcodePrompt(false); save(true); }}
        onSubmit={e => { e.preventDefault(); if (page === 2) save(); }}
        onFormChange={markDirty}
      >

        {page === 1 && (
          <>
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
              <div className={s.subLabel}>SUBGENRE</div>
              <div className={s.chips}>
                {BAND_SUBGENRES.map(g => (
                  <button key={g} type="button"
                    className={selSubs.includes(g) ? s.chipOn : s.chip}
                    style={selSubs.includes(g) ? { background: `rgba(255,140,66,.15)`, borderColor: COL, color: COL } : {}}
                    onClick={() => toggleSub(g)}>
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

            {/* YOUR 5 CARD TAGS */}
            {(selGenres.length > 0 || selSubs.length > 0 || selVibes.length > 0) && (() => {
              const tagPool = [...new Set([...selGenres, ...selSubs, ...selVibes])];
              return (
                <Section title="YOUR 5 CARD TAGS">
                  <p className={s.sectionHint}>Pick up to 5 tags that show on your slot card and discovery profile.</p>
                  <div className={s.chips}>
                    {tagPool.map(t => (
                      <button key={t} type="button"
                        className={selTags.includes(t) ? s.chipOn : s.chip}
                        style={selTags.includes(t) ? { background: `rgba(255,140,66,.15)`, borderColor: COL, color: COL } : {}}
                        onClick={() => toggleTag(t)}
                        disabled={!selTags.includes(t) && selTags.length >= 5}
                      >{t}</button>
                    ))}
                  </div>
                  <div className={s.charCount}>{selTags.length} / 5 selected</div>
                </Section>
              );
            })()}

            {/* EPK / PROMO LINK */}
            <Section title="EPK / PROMO LINK">
              <Field label="LINK TO MUSIC OR PRESS KIT">
                <input className={s.input} value={epkLink} onChange={e => setEpkLink(e.target.value)} placeholder="Spotify, Bandcamp, Soundcloud, or EPK URL" autoCapitalize="none" />
              </Field>
            </Section>

            <button type="button" className={s.moreBtn} style={{ background: GRAD, color: '#fff' }} onClick={() => setPage(2)}>
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
                    onClick={() => { setExpLevel(expLevel === lv ? '' : lv); setIsDirty(true); }}>
                    {lv}
                  </button>
                ))}
              </div>
            </Section>

            {/* SET FEE */}
            <Section title="SET FEE">
              <div className={s.feeRow}>
                <button type="button" className={feeType === 'exposure' ? s.feeBtnOn : s.feeBtn} onClick={() => { setFeeType('exposure'); setIsDirty(true); }}>EXPOSURE / FREE</button>
                <button type="button" className={feeType === 'paid'     ? s.feeBtnOn : s.feeBtn} onClick={() => { setFeeType('paid'); setIsDirty(true); }}>PAID GIG</button>
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
                <button type="button" className={hasAbn ? s.feeBtnOn : s.feeBtn} onClick={() => { setHasAbn(true); setIsDirty(true); }}>YES I HAVE AN ABN</button>
                <button type="button" className={!hasAbn ? s.feeBtnOn : s.feeBtn} style={!hasAbn ? { background: 'rgba(255,184,48,.15)', borderColor: '#FFB830', color: '#FFB830' } : {}} onClick={() => { setHasAbn(false); setGstReg(false); setIsDirty(true); }}>NO ABN</button>
              </div>
              {hasAbn && (
                <>
                  <Field label="ABN">
                    <input className={s.input} value={abn} onChange={e => setAbn(e.target.value)} placeholder="e.g. 12 345 678 901" inputMode="numeric" />
                  </Field>
                  <div className={s.feeRow}>
                    <button type="button" className={gstReg ? s.feeBtnOn : s.feeBtn} onClick={() => { setGstReg(true); setIsDirty(true); }}>GST REGISTERED</button>
                    <button type="button" className={!gstReg ? s.feeBtnOn : s.feeBtn} style={!gstReg ? { background: 'rgba(255,184,48,.15)', borderColor: '#FFB830', color: '#FFB830' } : {}} onClick={() => { setGstReg(false); setIsDirty(true); }}>NOT GST REG.</button>
                  </div>
                </>
              )}
            </Section>

            {/* SOCIALS + LINKS */}
            <Section title="SOCIALS + LINKS">
              <SocialSection
                links={[
                  { icon: 'spotify', key: 'spotify',      value: spotify,       onChange: e => setSpotify(e.target.value),      placeholder: 'Spotify artist URL',  type: 'url' },
                  { icon: 'sc',      key: 'soundcloud',   value: soundcloud,    onChange: e => setSoundcloud(e.target.value),   placeholder: 'soundcloud.com/...',   type: 'url' },
                  { icon: 'yt',      key: 'youtube',      value: youtube,       onChange: e => setYoutube(e.target.value),      placeholder: 'YouTube channel URL',  type: 'url' },
                  { icon: 'ig',      key: 'instagram',    value: instagram,     onChange: e => setInstagram(e.target.value),    placeholder: '@handle or URL' },
                  { icon: 'fb',      key: 'facebook',     value: facebook,      onChange: e => setFacebook(e.target.value),     placeholder: 'facebook.com/...',     type: 'url' },
                  { icon: 'email',   key: 'contactEmail', value: contactEmail,  onChange: e => setContactEmail(e.target.value), placeholder: 'Booking email',        type: 'email' },
                  { icon: 'web',     key: 'website',      value: website,       onChange: e => setWebsite(e.target.value),      placeholder: 'https://yourband.com', type: 'url' },
                ]}
                naFields={naFields}
                onToggleNa={toggleNa}
                inputClass={s.input}
                rowClass={s.socialRow}
                iconClass={s.socialIcon}
              />
            </Section>

            {saveErr && <div className={s.error}>{saveErr}</div>}
            <div className={s.page2Nav}>
              <button type="button" className={s.backNavBtn} onClick={() => setPage(1)}>←</button>
              <button type="submit" className={s.saveBtn} style={{ flex: 1, background: GRAD, color: '#fff' }} disabled={saving || saved}>
                {saved ? '✓ SAVED' : saving ? 'SAVING…' : 'SAVE PROFILE'}
              </button>
            </div>
          </>
        )}

      </ProfileFormShell>
    </div>
  );
}
