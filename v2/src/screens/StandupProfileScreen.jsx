import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import s from './ArtistProfileScreen.module.css';
import AvatarUpload from '../components/AvatarUpload';
import { useProfileForm } from '../hooks/useProfileForm';
import ProfileFormShell from '../components/ProfileFormShell';
import SectionBlock from '../components/SectionBlock';
import SocialSection from '../components/SocialSection';
import { VISIBLE_PERFORMANCE_ROLES, SHARED_PERFORMANCE_TAGS, ROLE_TAGS } from '../lib/profileTaxonomy';
import { PROFILE_TYPES } from '../lib/profileTypes';
import { normalizeSocialValue, ensureHttps } from '../lib/socialLinks';

const STATE_OPTIONS = ['NSW','VIC','QLD','WA','SA','TAS','ACT','NT','NZ','International'];
const EXP_LEVELS   = ['EMERGING','DEVELOPING','ESTABLISHED','TOURING'];

// PERFORMANCE_ROLES / SHARED_PERFORMANCE_TAGS / ROLE_TAGS now come from the
// shared ../lib/profileTaxonomy (2026-07 refresh) — no comedy/poetry-specific
// logic lives in this screen, so a future role is a data change there, not here.
const ROLE_KEYS = VISIBLE_PERFORMANCE_ROLES.map(r => r.key);
const ALL_ROLE_TAGS = [...new Set(Object.values(ROLE_TAGS).flat())];

// Tags available for the currently-selected role(s) — shared tags always show;
// role-specific tags are the union of the selected roles' lists (no
// duplicates). If no role is selected yet (e.g. a profile from before this
// role concept existed), fall back to every role's tags combined so an
// existing selection isn't hidden — same fallback Host uses for "no category
// selected yet" (see HostProfileScreen's genresForCats/ALL_GENRES).
function tagsForRoles(roles) {
  const fromRoles = [...new Set(roles.flatMap(r => ROLE_TAGS[r] || []))];
  const roleTags = roles.length === 0 || fromRoles.length === 0 ? ALL_ROLE_TAGS : fromRoles;
  return [...SHARED_PERFORMANCE_TAGS, ...roleTags.filter(t => !SHARED_PERFORMANCE_TAGS.includes(t))];
}

// Comedy / Poetry identity comes from PROFILE_TYPES — the sole source of truth
// since 10E.1. These were hand-typed copies of the same three values; identical
// today, but a private copy is exactly how Host's pink drifted to #FF3399 in 8+
// files before 10E.1. This is the last of the five editors to migrate
// (Artist 10E.2A, Band 10E.3, Host 10E.4, Venue 10E.5). Same values, one owner.
const COL  = PROFILE_TYPES.standup.accent;   // #FF88AA
const COL2 = PROFILE_TYPES.standup.accent2;  // #BF5FFF
const GRAD = PROFILE_TYPES.standup.gradient; // linear-gradient(90deg, #FF88AA, #BF5FFF)

// ── EXPERIMENTAL — Standup editor only (temporary aesthetic prototype) ─────
// Same "Glass Pill" treatment as the Artist editor, re-tuned to the Standup
// accent pair (COL/COL2) — see ArtistProfileScreen.jsx for the full
// rationale. Scoped to this file only.
const GLASS_CHIP_ON_STYLE = {
  border: '1px solid transparent',
  backgroundImage: [
    `linear-gradient(135deg, rgba(255,136,170,.045), rgba(191,95,255,.04))`,
    `linear-gradient(rgba(17,19,26,.62), rgba(17,19,26,.62))`,
    `linear-gradient(135deg, #DE7694, #A653DE)`,
  ].join(', '),
  backgroundOrigin: 'padding-box, padding-box, border-box',
  backgroundClip: 'padding-box, padding-box, border-box',
  color: '#fff',
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.14)',
};
const EXPERIMENTAL_HEADING_STYLE = {
  background: GRAD,
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
};

function Section({ title, children }) {
  return (
    <SectionBlock title={title} accent={COL} accent2={COL2} className={s.section} titleClassName={s.sectionTitle} titleStyle={{ ...EXPERIMENTAL_HEADING_STYLE, fontSize: 15 }}>
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
  const [setLength, setSetLength] = useState('');
  const [location,  setLocation]  = useState('');
  const [locState,  setLocState]  = useState('');
  const [postcode,  setPostcode]  = useState('');
  const [tagline,   setTagline]   = useState('');
  const [videoLink, setVideoLink] = useState('');
  const [selRoles,     setSelRoles]     = useState([]);
  const [selStyleTags, setSelStyleTags] = useState([]);
  const [selTags,      setSelTags]      = useState([]);

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
          // Roles + style tags live in genre_string (like Host's categories +
          // genres). Legacy vibe_tags (comma-separated, pre-refresh) is also
          // read here so an existing profile's old tags migrate in
          // automatically: anything that still exists in the new taxonomy is
          // kept, anything that doesn't (no rename was specified) is dropped.
          const parts = new Set((data.genre_string || '').split(' · ').map(x => x.trim()).filter(Boolean));
          const legacyTags = new Set((data.vibe_tags || '').split(',').map(x => x.trim()).filter(Boolean));
          setSelRoles(ROLE_KEYS.filter(r => parts.has(r)));
          setSelStyleTags([...SHARED_PERFORMANCE_TAGS, ...ALL_ROLE_TAGS].filter(t => parts.has(t) || legacyTags.has(t)));
          if (data.card_pills) setSelTags(data.card_pills.split(' · ').filter(Boolean));
        }
        setLoading(false);
      });
  }, [userId]);

  function toggleRole(r) { setSelRoles(p => p.includes(r) ? p.filter(x => x !== r) : [...p, r]); setIsDirty(true); }
  function toggleStyleTag(t) { setSelStyleTags(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]); setIsDirty(true); }
  function toggleTag(t) {
    setSelTags(p => p.includes(t) ? p.filter(x => x !== t) : p.length >= 5 ? p : [...p, t]);
    setIsDirty(true);
  }

  // Dropping a role prunes any style tags that are no longer available for
  // the remaining role selection (mirrors Host's category->genre pruning).
  useEffect(() => {
    const pool = new Set(tagsForRoles(selRoles));
    setSelStyleTags(prev => prev.filter(t => pool.has(t)));
  }, [selRoles]);

  // "Your Style Tags" (card_pills) is its own stored column — prune it against
  // the current style-tag pool so a tag that fell out of Step 2 doesn't stay
  // stuck as a public tag.
  useEffect(() => {
    const pool = new Set(selStyleTags);
    setSelTags(prev => prev.filter(t => pool.has(t)));
  }, [selStyleTags]);

  function save(skipPostcodeCheck = false) {
    if (!userId || saving) return;
    if (!skipPostcodeCheck && !postcode && !location) { setShowPostcodePrompt(true); return; }
    const genre_string = [...new Set([...selRoles, ...selStyleTags])].join(' · ');
    const payload = {
      user_id: userId, type: 'standup',
      name,
      set_length:      setLength ? parseInt(setLength) : null,
      location, state: locState, postcode,
      tagline, bio,
      mix_link:        ensureHttps(videoLink),
      video_link:      ensureHttps(videoLink),
      genre_string,
      card_pills:      selTags.join(' · '),
      vibe_tags:       null,
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
      instagram:     naFields.has('instagram')    ? 'N/A' : normalizeSocialValue('instagram', instagram),
      tiktok:        naFields.has('tiktok')       ? 'N/A' : normalizeSocialValue('tiktok', tiktok),
      facebook:      naFields.has('facebook')     ? 'N/A' : normalizeSocialValue('facebook', facebook),
      contact_email: naFields.has('contactEmail') ? 'N/A' : contactEmail,
      website:       naFields.has('website')      ? 'N/A' : normalizeSocialValue('website', website),
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
          {/* 10E.6 — filter: .h1 is shared from ArtistProfileScreen.module.css and
              bakes in an Artist-cyan drop-shadow. Overriding `background` alone left
              a pink heading glowing cyan. Third and last instance of this exact
              leftover: Band (10E.3) and Venue (10E.5) were the other two files that
              borrow this stylesheet. lineHeight stays — that's this heading's own. */}
          <div className={s.h1} style={{ background: GRAD, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', lineHeight: 1.1, filter: `drop-shadow(0 0 8px rgba(${PROFILE_TYPES.standup.rgb},.2))` }}>
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

            {/* WHAT DO YOU PERFORM? */}
            <Section title="WHAT DO YOU PERFORM?">
              <div className={s.pills}>
                {VISIBLE_PERFORMANCE_ROLES.map(({ key, label }) => {
                  const on = selRoles.includes(key);
                  return (
                    <button key={key} type="button"
                      className={on ? s.catBtnOn : s.catBtn}
                      style={on ? GLASS_CHIP_ON_STYLE : undefined}
                      onClick={() => toggleRole(key)}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </Section>

            {/* PERFORMANCE STYLE */}
            <Section title="PERFORMANCE STYLE">
              <p className={s.sectionHint}>Select up to 5 tags that best describe your performance style. These help organisers quickly understand what audiences can expect.</p>
              <div className={s.chips}>
                {tagsForRoles(selRoles).map(t => {
                  const on = selStyleTags.includes(t);
                  return (
                    <button key={t} type="button"
                      className={on ? s.chipOn : s.chip}
                      style={on ? GLASS_CHIP_ON_STYLE : undefined}
                      onClick={() => toggleStyleTag(t)}>
                      {t}
                    </button>
                  );
                })}
              </div>
            </Section>

            {/* YOUR STYLE TAGS */}
            {selStyleTags.length > 0 && (
              <Section title="YOUR STYLE TAGS">
                <p className={s.sectionHint}>Choose up to five tags that best represent your performance. These appear throughout YesPleez to help organisers quickly understand your style.</p>
                <div className={s.chips}>
                  {selStyleTags.map(t => {
                    const on = selTags.includes(t);
                    return (
                      <button key={t} type="button"
                        className={on ? s.chipOn : s.chip}
                        style={on ? GLASS_CHIP_ON_STYLE : undefined}
                        onClick={() => toggleTag(t)}
                        disabled={!on && selTags.length >= 5}>
                        {t}
                      </button>
                    );
                  })}
                </div>
                <div className={s.charCount}>{selTags.length} / 5 selected</div>
              </Section>
            )}

            {/* YOUR STYLE */}
            <Section title="YOUR STYLE">
              <Field label="TAGLINE">
                <input className={s.input} value={tagline} onChange={e => setTagline(e.target.value)} placeholder="One line that captures your act" maxLength={120} autoComplete="off" />
              </Field>
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
                    style={expLevel === lv ? GLASS_CHIP_ON_STYLE : undefined}
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
                  { icon: 'web',   key: 'website',      value: website,      onChange: e => setWebsite(e.target.value),      placeholder: 'yoursite.com' },
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
