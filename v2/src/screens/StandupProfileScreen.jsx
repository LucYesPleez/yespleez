import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import s from './ArtistProfileScreen.module.css';
import AvatarUpload from '../components/AvatarUpload';
import { useProfileForm } from '../hooks/useProfileForm';
import ProfileFormShell from '../components/ProfileFormShell';
import SectionBlock from '../components/SectionBlock';
import SocialSection from '../components/SocialSection';

const STATE_OPTIONS = ['NSW','VIC','QLD','WA','SA','TAS','ACT','NT','NZ','International'];
const EXP_LEVELS   = ['EMERGING','DEVELOPING','ESTABLISHED','TOURING'];

const STANDUP_VIBES = [
  'Dark','Observational','Political','Storytelling','Absurdist','Clean','Adult',
  'Improv','Roast','Self-Deprecating','Surreal','Deadpan','Physical','Character',
  'Topical','Experimental','Feminist','LGBTQ+','Cultural','Feel Good',
];

const COL  = '#FF88AA';
const COL2 = '#BF5FFF';
const GRAD = `linear-gradient(90deg, ${COL} 0%, ${COL2} 100%)`;

function Section({ title, children }) {
  return (
    <SectionBlock title={title} accent={COL} accent2={COL2} className={s.section} titleClassName={s.sectionTitle} titleStyle={{ color: COL, fontSize: 15 }}>
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

export default function StandupProfileScreen() {
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

  const [loading,  setLoading]  = useState(true);
  const [page,     setPage]     = useState(1);

  // Page 1
  const [name,      setName]      = useState('');
  const [actType,   setActType]   = useState('');
  const [setLength, setSetLength] = useState('');
  const [location,  setLocation]  = useState('');
  const [locState,  setLocState]  = useState('');
  const [postcode,  setPostcode]  = useState('');
  const [tagline,   setTagline]   = useState('');
  const [videoLink, setVideoLink] = useState('');
  const [selVibes,  setSelVibes]  = useState([]);

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
  const [instagram,     setInstagram]     = useState('');
  const [tiktok,        setTiktok]        = useState('');
  const [facebook,      setFacebook]      = useState('');
  const [contactEmail,  setContactEmail]  = useState('');
  const [website,       setWebsite]       = useState('');

  useEffect(() => {
    if (!userId) return;
    supabase.from('profiles').select('*').eq('user_id', userId).eq('type', 'standup').maybeSingle()
      .then(({ data, error }) => {
        if (error) { setSaveErr('Failed to load profile. Please refresh.'); setLoading(false); return; }
        if (data) {
          setAvatarUrl(data.avatar || '');
          setAvatarHero(data.avatar_hero || '');
          setAvatarThumb(data.avatar_thumb || '');
          setName(data.name || '');
          setActType(data.act_type || '');
          setSetLength(data.set_length ? String(data.set_length) : '');
          setLocation(data.location || '');
          setLocState(data.state || '');
          setPostcode(data.postcode || '');
          setTagline(data.tagline || '');
          setVideoLink(data.mix_link || data.video_link || '');
          setBio(data.bio || '');
          if (data.experience)   setExpLevel(data.experience);
          if (data.fee_type)     setFeeType(data.fee_type);
          if (data.fee)          setFeeAmount(String(data.fee));
          if (data.fee_max)      setFeeMax(String(data.fee_max));
          setFeeNegotiable(!!data.fee_negotiable);
          setFeeTravel(!!data.fee_travel);
          setEmergName(data.emergency_name  || '');
          setEmergPhone(data.emergency_phone || '');
          setEmergRel(data.emergency_rel   || '');
          setHasAbn(!!data.has_abn);
          setAbn(data.abn || '');
          setGstReg(!!data.gst_registered);
          const naSet = new Set();
          loadNa(data.instagram,     setInstagram,    'instagram',    naSet);
          loadNa(data.tiktok,        setTiktok,       'tiktok',       naSet);
          loadNa(data.facebook,      setFacebook,     'facebook',     naSet);
          loadNa(data.contact_email, setContactEmail, 'contactEmail', naSet);
          loadNa(data.website,       setWebsite,      'website',      naSet);
          setNaFields(naSet);
          const vibes = new Set((data.vibe_tags || '').split(',').map(v => v.trim()).filter(Boolean));
          setSelVibes(STANDUP_VIBES.filter(v => vibes.has(v)));
        }
        setLoading(false);
      });
  }, [userId]);

  function toggleVibe(v) {
    setSelVibes(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);
    setIsDirty(true);
  }

  function save(skipPostcodeCheck = false) {
    if (!userId || saving) return;
    if (!skipPostcodeCheck && !postcode && !location) { setShowPostcodePrompt(true); return; }
    const payload = {
      user_id: userId, type: 'standup',
      name, act_type: actType,
      set_length:      setLength ? parseInt(setLength) : null,
      location, state: locState, postcode,
      tagline, bio,
      mix_link:        videoLink,
      video_link:      videoLink,
      vibe_tags:       selVibes.join(', '),
      avatar: avatarHero || avatarUrl,
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
      instagram:     naFields.has('instagram')    ? 'N/A' : instagram,
      tiktok:        naFields.has('tiktok')       ? 'N/A' : tiktok,
      facebook:      naFields.has('facebook')     ? 'N/A' : facebook,
      contact_email: naFields.has('contactEmail') ? 'N/A' : contactEmail,
      website:       naFields.has('website')      ? 'N/A' : website,
    };
    runSave(async () => {
      const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'user_id,type' });
      if (error) throw error;
    }, '/industry/standup', 1200);
  }

  if (loading) return <div className={s.loading}>LOADING…</div>;

  return (
    <div className={s.screen}>
      {/* Header */}
      <div className={s.header}>
        <div className={s.headerText}>
          <div className={s.h1} style={{ background: GRAD, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', lineHeight: 1.1 }}>
            SPOKEN<br />PROFILE
          </div>
          <div className={s.h1Sub}>Fill this in once · travels with you across every event</div>
        </div>
      </div>

      {page === 1 && (
        <AvatarUpload
          userId={userId} bucket="avatars" pathPrefix="standup_avatars"
          avatar={avatarUrl}
          ringClass={`${s.avatarRing} ${s.avatarRingStandup}`}
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
              <Field label="YOUR NAME / ACT NAME">
                <input className={s.input} value={name} onChange={e => setName(e.target.value)} placeholder="Your name or stage name" autoComplete="off" />
              </Field>
              <Field label="ACT TYPE">
                <input className={s.input} value={actType} onChange={e => setActType(e.target.value)} placeholder="e.g. Stand-Up Comedy, Spoken Word, Slam Poetry, Improv" autoComplete="off" />
              </Field>
              <div className={s.row}>
                <Field label="SET LENGTH (MINS)">
                  <input className={s.input} type="number" min="1" value={setLength} onChange={e => setSetLength(e.target.value)} placeholder="e.g. 20" />
                </Field>
              </div>
              <Field label="TOWN / SUBURB">
                <input className={s.input} value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Sydney" autoComplete="off" />
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
                    <input className={s.input} value={postcode} onChange={e => setPostcode(e.target.value)} placeholder="e.g. 2000" inputMode="numeric" />
                  </Field>
                </div>
              </div>
            </Section>

            {/* YOUR STYLE */}
            <Section title="YOUR STYLE">
              <Field label="TAGLINE">
                <input className={s.input} value={tagline} onChange={e => setTagline(e.target.value)} placeholder="One line that captures your act" maxLength={120} autoComplete="off" />
              </Field>
              <div className={s.subLabel} style={{ color: COL, borderBottom: '1px solid transparent', borderImage: 'linear-gradient(90deg, #FF88AA, #BF5FFF) 1' }}>STYLE TAGS</div>
              <div className={s.chips}>
                {STANDUP_VIBES.map(v => {
                  const on = selVibes.includes(v);
                  return (
                    <button key={v} type="button"
                      onClick={() => toggleVibe(v)}
                      style={{
                        background: on ? 'rgba(0,229,160,.22)' : 'rgba(0,229,160,.06)',
                        border: `1px solid rgba(0,229,160,${on ? '.5' : '.2'})`,
                        color: '#FF88AA',
                        borderRadius: 20,
                        padding: '6px 14px',
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: 12,
                        cursor: 'pointer',
                        transition: 'all .15s',
                      }}
                      onMouseEnter={e => { if (!on) { e.currentTarget.style.background = 'rgba(0,229,160,.22)'; e.currentTarget.style.borderColor = 'rgba(0,229,160,.5)'; } }}
                      onMouseLeave={e => { if (!on) { e.currentTarget.style.background = 'rgba(0,229,160,.06)'; e.currentTarget.style.borderColor = 'rgba(0,229,160,.2)'; } }}>
                      {v}
                    </button>
                  );
                })}
              </div>
            </Section>

            {/* VIDEO LINK */}
            <Section title="VIDEO / SHOWREEL">
              <Field label="LINK TO YOUR BEST SET OR SHOWREEL">
                <input className={s.input} value={videoLink} onChange={e => setVideoLink(e.target.value)} placeholder="YouTube, Vimeo, or social link" autoCapitalize="none" />
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
                placeholder="Tell bookers about yourself. Background, credits, what makes your act unique." />
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
                <button type="button" className={feeType === 'minimum' ? s.feeBtnOn : s.feeBtn} onClick={() => { setFeeType('minimum'); setIsDirty(true); }}>DOOR / MINIMUM</button>
                <button type="button" className={feeType === 'paid'    ? s.feeBtnOn : s.feeBtn} onClick={() => { setFeeType('paid');    setIsDirty(true); }}>PAID GIG</button>
              </div>
              {feeType === 'paid' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1.5, fontFamily: "'Bebas Neue'", marginBottom: 6 }}>FROM $</div>
                    <input className={s.input} type="text" inputMode="numeric" value={feeAmount} onChange={e => setFeeAmount(e.target.value)} placeholder="e.g. 200" />
                  </div>
                  <div style={{ flex: 1, opacity: feeNegotiable ? 1 : 0.35 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1.5, fontFamily: "'Bebas Neue'", marginBottom: 6 }}>TO $</div>
                    <input className={s.input} type="text" inputMode="numeric" value={feeMax} onChange={e => setFeeMax(e.target.value)} placeholder="e.g. 500" disabled={!feeNegotiable} />
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                <label className={s.checkLabel}>
                  <input type="checkbox" checked={feeNegotiable} onChange={e => { setFeeNegotiable(e.target.checked); setIsDirty(true); }} />
                  Fee is negotiable
                </label>
                <label className={s.checkLabel}>
                  <input type="checkbox" checked={feeTravel} onChange={e => { setFeeTravel(e.target.checked); setIsDirty(true); }} />
                  Fee includes travel costs
                </label>
              </div>
            </Section>

            {/* EMERGENCY CONTACT */}
            <Section title="EMERGENCY CONTACT">
              <Field label="NAME"><input className={s.input} value={emergName} onChange={e => setEmergName(e.target.value)} placeholder="Contact name" autoComplete="off" /></Field>
              <Field label="PHONE"><input className={s.input} value={emergPhone} onChange={e => setEmergPhone(e.target.value)} placeholder="Phone number" type="tel" /></Field>
              <Field label="RELATIONSHIP"><input className={s.input} value={emergRel} onChange={e => setEmergRel(e.target.value)} placeholder="e.g. Agent, Partner" autoComplete="off" /></Field>
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
                  { icon: 'ig',    key: 'instagram',    value: instagram,    onChange: e => setInstagram(e.target.value),    placeholder: '@handle or URL' },
                  { icon: 'tt',    key: 'tiktok',       value: tiktok,       onChange: e => setTiktok(e.target.value),       placeholder: '@handle or URL' },
                  { icon: 'fb',    key: 'facebook',     value: facebook,     onChange: e => setFacebook(e.target.value),     placeholder: 'facebook.com/…' },
                  { icon: 'email', key: 'contactEmail', value: contactEmail, onChange: e => setContactEmail(e.target.value), placeholder: 'Booking email',       type: 'email' },
                  { icon: 'web',   key: 'website',      value: website,      onChange: e => setWebsite(e.target.value),      placeholder: 'https://yoursite.com', type: 'url' },
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
