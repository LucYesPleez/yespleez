import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import s from './ArtistProfileScreen.module.css';
import AvatarUpload from '../components/AvatarUpload';
import { useProfileForm } from '../hooks/useProfileForm';
import ProfileFormShell from '../components/ProfileFormShell';
import SectionBlock from '../components/SectionBlock';
import ProfileAssetsSection from '../components/ProfileAssetsSection';
import SocialSection from '../components/SocialSection';
import { MAIN_GENRES, SUBGENRES, VIBES, VISIBLE_ARTIST_ROLES } from '../lib/profileTaxonomy';
import { normalizeSocialValue, ensureHttps } from '../lib/socialLinks';
import { PROFILE_TYPES } from '../lib/profileTypes';
import { STATE_OPTIONS } from '../lib/auLocations';
import { EXP_LEVELS } from '../lib/profileTaxonomy';

const TECH_OPTIONS = ['DJ DIGITAL','DJ VINYL','DJ HYBRID','LIVE ACT','LIVE + DJ','B2B'];

// MAIN_GENRES + SUBGENRES + VIBES now come from the shared ../lib/profileTaxonomy.

// 2026-07 vibe taxonomy refresh — old stored values are migrated automatically
// on load (no user action, no bulk DB migration). Renamed values become their
// new name; removed values are dropped entirely (not replaced). Minimal/UK/
// Vocals were previously hidden legacy passthroughs — they're now full
// canonical VIBES options again, so no special-casing needed for them.
const VIBE_RENAME_MAP = {
  'Thinky': 'Heady',
  'Staunch': 'Hefty',
  'Sledgy': 'Hefty',
  'Crankin': 'High Energy',
  'Sleazy/Slutty': 'Sleazy',
};
const VIBE_REMOVE_SET = new Set(['Slutty', 'Warm Up', 'Cocktail', 'USA']);

function normalizeVibeToken(tok) {
  if (VIBE_REMOVE_SET.has(tok)) return null;
  return VIBE_RENAME_MAP[tok] || tok;
}

// DJ / Producer / MC roles (2026-07) — same concept as Standup's performance
// roles: stored as tokens inside genre_string alongside genres/subs/vibes.
const ROLE_KEYS = VISIBLE_ARTIST_ROLES.map(r => r.key);

const ACCENT  = '#00E5FF';
const ACCENT2 = '#FF3399';

// ── EXPERIMENTAL — Artist editor only (temporary aesthetic prototype) ──────
// "Glass Pill" selected-chip treatment: frosted/smoked glass fill with a
// faint Artist-accent tint, a 1px accent->accent2 gradient border (via the
// background-origin/clip layering trick, since `border` alone can't carry a
// gradient), and a barely-there inset top highlight. Refinement pass: border
// dimmed ~13% (darkened hex, not alpha, so it reads consistently regardless
// of what's behind it), glass fill darkened ~13% and slightly denser, inner
// tint cut roughly in half, and the outer bloom/glow removed entirely — the
// pill now relies on the edge (border) for colour, not a surrounding glow.
// Applied as an inline style on top of the existing .chipOn class —
// padding/border-radius/font/cursor/transition all stay exactly as defined
// there. Scoped to this file only; no shared component or CSS module touched.
const GLASS_CHIP_ON_STYLE = {
  border: '1px solid transparent',
  backgroundImage: [
    `linear-gradient(135deg, rgba(0,229,255,.045), rgba(255,51,153,.04))`,
    `linear-gradient(rgba(17,19,26,.62), rgba(17,19,26,.62))`,
    `linear-gradient(135deg, #00C7DE, #DE2C85)`,
  ].join(', '),
  backgroundOrigin: 'padding-box, padding-box, border-box',
  backgroundClip: 'padding-box, padding-box, border-box',
  color: '#fff',
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.14)',
};
// Gradient section-heading text, reusing the same canonical Artist gradient
// as the page's own "MY PROFILE" title (font-size untouched — already 13px
// across every profile editor, Artist included, so nothing to match here).
// Divider lines are untouched — see Section below, separate borderImage.
const EXPERIMENTAL_HEADING_STYLE = {
  background: PROFILE_TYPES.artist.gradient,
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
};

function parseProfile(data) {
  const str = data?.genre_string || '';
  const parts = new Set(str.split(' · ').map(x => x.trim()).filter(Boolean));
  const genres = MAIN_GENRES.filter(g => parts.has(g));
  const allSubs = Object.values(SUBGENRES).flat();
  const subs = allSubs.filter(g => parts.has(g));
  const isVibeToken = t => VIBES.includes(t) || VIBE_RENAME_MAP[t] || VIBE_REMOVE_SET.has(t);
  const vibes = [...new Set([...parts].filter(isVibeToken).map(normalizeVibeToken).filter(Boolean))];
  const roles = ROLE_KEYS.filter(r => parts.has(r));
  return { genres, subs, vibes, roles };
}

function buildGenreString(genres, subs, vibes, roles) {
  return [...new Set([...roles, ...genres, ...subs, ...vibes])].join(' · ');
}

function Section({ title, children }) {
  return (
    <SectionBlock title={title} accent={ACCENT} accent2={ACCENT2} className={s.section} titleClassName={s.sectionTitle} titleStyle={EXPERIMENTAL_HEADING_STYLE}>
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

export default function ArtistProfileScreen() {
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

  const [page,      setPage]      = useState(1);
  const [loading,   setLoading]   = useState(true);

  // Page 1 fields
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
  const [selRoles,   setSelRoles]   = useState([]);

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
  const [contactEmail,   setContactEmail]   = useState('');

  useEffect(() => {
    if (!userId) return;
    supabase.from('profiles').select('*').eq('user_id', userId).eq('type', 'artist').maybeSingle()
      .then(({ data, error }) => {
        if (error) { setSaveErr('Failed to load profile. Please refresh.'); setLoading(false); return; }
        if (data) {
          setAvatarUrl(data.avatar || '');
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
          loadNa(data.soundcloud, setSoundcloud, 'soundcloud', naSet);
          loadNa(data.mixcloud,   setMixcloud,   'mixcloud',   naSet);
          loadNa(data.instagram,  setInstagram,  'instagram',  naSet);
          loadNa(data.youtube,    setYoutube,    'youtube',    naSet);
          loadNa(data.facebook,   setFacebook,   'facebook',   naSet);
          loadNa(data.website,    setWebsite,    'website',    naSet);
          loadNa(data.contact_email, setContactEmail, 'contactEmail', naSet);
          setNaFields(naSet);
          const parsed = parseProfile(data);
          setSelGenres(parsed.genres);
          setSelSubs(parsed.subs);
          setSelVibes(parsed.vibes);
          setSelRoles(parsed.roles);
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
          if (data.abn) setAbn(data.abn);
          if (data.gst_registered !== undefined) setGstReg(!!data.gst_registered);
          if (data.has_abn !== undefined && data.has_abn !== null) setHasAbn(!!data.has_abn);
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

  function toggleRole(r)   { setSelRoles(prev   => prev.includes(r)   ? prev.filter(x => x !== r)   : [...prev, r]);   setIsDirty(true); }
  function toggleGenre(g)  { setSelGenres(prev => prev.includes(g)   ? prev.filter(x => x !== g)   : [...prev, g]);   setIsDirty(true); }
  function toggleSub(sub)  { setSelSubs(prev   => prev.includes(sub) ? prev.filter(x => x !== sub) : [...prev, sub]); setIsDirty(true); }
  function toggleVibe(v)   { setSelVibes(prev  => prev.includes(v)   ? prev.filter(x => x !== v)   : [...prev, v]);   setIsDirty(true); }
  function toggleTech(t)   { setTechSetup(prev => prev.includes(t)   ? prev.filter(x => x !== t)   : [...prev, t]);   setIsDirty(true); }
  function toggleTag(t) {
    setSelTags(prev => {
      if (prev.includes(t)) return prev.filter(x => x !== t);
      if (prev.length >= 5) return prev;
      return [...prev, t];
    });
    setIsDirty(true);
  }

  function save(skipPostcodeCheck = false) {
    if (!userId || saving) return;
    if (!skipPostcodeCheck && !postcode && !location) { setShowPostcodePrompt(true); return; }
    const genre_string = buildGenreString(selGenres, selSubs, selVibes, selRoles);
    const payload = {
      user_id: userId, type: 'artist',
      name, label, years, location, state: locState, postcode,
      sound, tagline, bio,
      mix_link: ensureHttps(mixLink),
      soundcloud: naFields.has('soundcloud') ? 'N/A' : normalizeSocialValue('soundcloud', soundcloud),
      mixcloud:   naFields.has('mixcloud')   ? 'N/A' : normalizeSocialValue('mixcloud', mixcloud),
      instagram:  naFields.has('instagram')  ? 'N/A' : normalizeSocialValue('instagram', instagram),
      youtube:    naFields.has('youtube')    ? 'N/A' : normalizeSocialValue('youtube', youtube),
      facebook:   naFields.has('facebook')   ? 'N/A' : normalizeSocialValue('facebook', facebook),
      website:    naFields.has('website')    ? 'N/A' : normalizeSocialValue('website', website),
      contact_email: naFields.has('contactEmail') ? 'N/A' : contactEmail,
      genre_string, avatar: avatarHero || avatarUrl,
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
      has_abn:         hasAbn,
      abn:             abn,
      gst_registered:  gstReg,
    };
    runSave(async () => {
      const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'user_id,type' });
      if (error) throw error;
    }, '/industry/artist', 1200);
  }

  const availSubs = selGenres.flatMap(g => SUBGENRES[g] || []);
  const tagPool   = [...new Set([...selGenres, ...selSubs, ...selVibes])];

  if (loading) return <div className={s.loading}>LOADING…</div>;

  return (
    <div className={s.screen}>
      {/* Header — always visible */}
      <div className={s.header}>
        <div className={s.headerText}>
          <div className={s.h1} style={{ background: PROFILE_TYPES.artist.gradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>MY PROFILE</div>
          <div className={s.h1Sub}>Fill this in once · travels with you across every event</div>
        </div>
      </div>

      {page === 1 && (
        <AvatarUpload
          userId={userId} bucket="avatars" pathPrefix="artist_avatars"
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

        {/* ── PAGE 1 ── */}
        {page === 1 && (
          <>
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

            {/* WHAT DO YOU DO? */}
            <Section title="WHAT DO YOU DO?">
              <div className={s.pills}>
                {VISIBLE_ARTIST_ROLES.map(({ key, label }) => {
                  const on = selRoles.includes(key);
                  return (
                    <button key={key} type="button"
                      className={on ? s.chipOn : s.chip}
                      style={on ? GLASS_CHIP_ON_STYLE : undefined}
                      onClick={() => toggleRole(key)}>
                      {label}
                    </button>
                  );
                })}
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
                  <button key={g} type="button" className={selGenres.includes(g) ? s.chipOn : s.chip} style={selGenres.includes(g) ? GLASS_CHIP_ON_STYLE : undefined} onClick={() => toggleGenre(g)}>{g}</button>
                ))}
              </div>
              {availSubs.length > 0 && (
                <>
                  <div className={s.subLabel} style={{ ...EXPERIMENTAL_HEADING_STYLE, borderImage: `linear-gradient(90deg, ${ACCENT}, ${ACCENT2}) 1` }}>SUB GENRES</div>
                  <div className={s.chips}>
                    {availSubs.map(sub => (
                      <button key={sub} type="button" className={selSubs.includes(sub) ? s.chipOn : s.chip} style={selSubs.includes(sub) ? GLASS_CHIP_ON_STYLE : undefined} onClick={() => toggleSub(sub)}>{sub}</button>
                    ))}
                  </div>
                </>
              )}
            </Section>

            {/* VIBES */}
            <Section title="VIBES">
              <div className={s.chips}>
                {VIBES.map(v => (
                  <button key={v} type="button" className={selVibes.includes(v) ? s.chipOn : s.chip} style={selVibes.includes(v) ? GLASS_CHIP_ON_STYLE : undefined} onClick={() => toggleVibe(v)}>{v}</button>
                ))}
              </div>
            </Section>

            {/* YOUR 5 CARD TAGS — EXPERIMENTAL: Glass Pill treatment (Artist editor
                only). This is a selection UI (actively picking your 5 tags), so per
                the Glow-Pill-vs-Glass-Pill rule it stays on the same quiet Glass
                Pill treatment as every other selector on this page, not Glow Pill —
                Glow Pill is reserved for read-only display of the final result
                elsewhere in the app (public profile, cards, applications, etc). */}
            {tagPool.length > 0 && (
              <Section title="YOUR 5 CARD TAGS">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {tagPool.map(t => {
                    const on = selTags.includes(t);
                    const disabled = !on && selTags.length >= 5;
                    return (
                      <button key={t} type="button" disabled={disabled} onClick={() => toggleTag(t)}
                        className={on ? s.chipOn : s.chip}
                        style={{ ...(on ? GLASS_CHIP_ON_STYLE : {}), opacity: disabled ? 0.35 : 1 }}
                      >{t}</button>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>Pick the tags that best represent your sound — shown on your slot card and discovery profile.</p>
                  <span style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5, color: selTags.length >= 5 ? PROFILE_TYPES.artist.accent : 'var(--muted)', marginLeft: 'auto' }}>
                    {selTags.length} / 5 selected
                  </span>
                </div>
              </Section>
            )}

            {/* YOUR DEMO MIX */}
            <Section title="YOUR DEMO MIX">
              <p className={s.sectionHint}>This is what promoters listen to first — it's your audition. Keep it current and make it count. We suggest around 20 minutes.</p>
              <SocialSection
                links={[{ icon: 'headphones', key: 'mixLink', value: mixLink, onChange: e => setMixLink(e.target.value), placeholder: 'SoundCloud / Mixcloud / YouTube link', noNa: true }]}
                naFields={naFields}
                onToggleNa={toggleNa}
                inputClass={s.input}
                rowClass={s.socialRow}
                iconClass={s.socialIcon}
              />
            </Section>

            <button type="button" className={s.moreBtn} style={{ background: 'linear-gradient(90deg, #00E5FF, #FF3399)', color: '#fff' }} onClick={() => setPage(2)}>MORE DETAILS →</button>
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
                    style={expLevel === lv ? GLASS_CHIP_ON_STYLE : undefined}
                    onClick={() => { setExpLevel(lv); setIsDirty(true); }}
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
                    style={techSetup.includes(t) ? GLASS_CHIP_ON_STYLE : undefined}
                    onClick={() => toggleTech(t)}
                  >{t}</button>
                ))}
              </div>
            </Section>

            {/* SET FEE */}
            <Section title="SET FEE">
              <div className={s.feeRow}>
                <button type="button" className={feeType === 'tickets' ? s.feeBtnOn : s.feeBtn} onClick={() => { setFeeType('tickets'); setIsDirty(true); }}>
                  🎟 PLAY FOR TICKETS
                </button>
                <button type="button" className={feeType === 'paid' ? s.feeBtnOn : s.feeBtn} onClick={() => { setFeeType('paid'); setIsDirty(true); }}>
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

            {/* ABN / GST — directly under SET FEE: both are what you charge and
                how you invoice it, so they read as one commercial block. */}
            <Section title="ABN / GST">
              <div className={s.feeRow}>
                <button type="button" className={hasAbn === true ? s.feeBtnOn : s.feeBtn} onClick={() => { setHasAbn(true); setIsDirty(true); }}>YES I HAVE AN ABN</button>
                <button type="button" className={hasAbn === false ? s.feeBtnOn : s.feeBtn} style={hasAbn === false ? { background: 'rgba(255,184,48,.15)', borderColor: '#FFB830', color: '#FFB830' } : {}} onClick={() => { setHasAbn(false); setIsDirty(true); }}>NO ABN</button>
              </div>
              {hasAbn === true && (
                <>
                  <Field label="ABN"><input className={s.input} value={abn} onChange={e => setAbn(e.target.value)} placeholder="e.g. 12 345 678 901" autoComplete="off" /></Field>
                  <div className={s.feeRow}>
                    <button type="button" className={gstReg === true ? s.feeBtnOn : s.feeBtn} onClick={() => { setGstReg(true); setIsDirty(true); }}>GST REGISTERED</button>
                    <button type="button" className={gstReg === false ? s.feeBtnOn : s.feeBtn} style={gstReg === false ? { background: 'rgba(255,184,48,.15)', borderColor: '#FFB830', color: '#FFB830' } : {}} onClick={() => { setGstReg(false); setIsDirty(true); }}>NOT GST REGISTERED</button>
                  </div>
                </>
              )}
            </Section>

            {/* PA1 — reusable professional documents. Part of the profile, so
                it lives here rather than on the dashboard. */}
            <Section>
              <ProfileAssetsSection
                userId={userId} profileType="artist"
                accent={ACCENT} accent2={ACCENT2}
                titleClassName={s.sectionTitle} titleStyle={EXPERIMENTAL_HEADING_STYLE}
              />
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

            {/* SOCIALS + LINKS */}
            <Section title="SOCIALS + LINKS">
              <SocialSection
                links={[
                  { icon: 'sc', key: 'soundcloud', value: soundcloud, onChange: e => setSoundcloud(e.target.value), placeholder: '@handle or link' },
                  { icon: 'mc', key: 'mixcloud',   value: mixcloud,   onChange: e => setMixcloud(e.target.value),   placeholder: '@handle or link' },
                  { icon: 'ig', key: 'instagram',  value: instagram,  onChange: e => setInstagram(e.target.value),  placeholder: '@handle or link' },
                  { icon: 'yt', key: 'youtube',    value: youtube,    onChange: e => setYoutube(e.target.value),    placeholder: '@handle or link' },
                  { icon: 'fb', key: 'facebook',   value: facebook,   onChange: e => setFacebook(e.target.value),   placeholder: '@handle or link' },
                  { icon: 'email', key: 'contactEmail', value: contactEmail, onChange: e => setContactEmail(e.target.value), placeholder: 'Booking email', type: 'email' },
                ]}
                naFields={naFields}
                onToggleNa={toggleNa}
                inputClass={s.input}
                rowClass={s.socialRow}
                iconClass={s.socialIcon}
              />
            </Section>


            {saveErr && <p className={s.error}>{saveErr}</p>}

            <div className={s.page2Nav}>
              <button type="button" className={s.backNavBtn} onClick={() => setPage(1)}>←</button>
              <button type="submit" className={s.saveBtn} disabled={saving || saved} style={{ flex: 1, background: 'linear-gradient(90deg, #00E5FF, #FF3399)', color: '#fff' }}>
                {saving ? 'SAVING…' : saved ? '✓ SAVED!' : 'SAVE PROFILE →'}
              </button>
            </div>
          </>
        )}

      </ProfileFormShell>
    </div>
  );
}
