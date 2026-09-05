import { useState, useEffect } from 'react';
import { STATE_OPTIONS } from '../lib/auLocations';
import { EXP_LEVELS } from '../lib/profileTaxonomy';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import s from './ArtistProfileScreen.module.css';
import AvatarUpload from '../components/AvatarUpload';
import { useProfileForm } from '../hooks/useProfileForm';
import ProfileFormShell from '../components/ProfileFormShell';
import SectionBlock from '../components/SectionBlock';
import ProfileAssetsSection from '../components/ProfileAssetsSection';
import SocialSection from '../components/SocialSection';
import ClaimSuggestion from '../components/ClaimSuggestion';
import { BAND_GENRES, BAND_SUBGENRES, BAND_VIBES, BAND_ROLES, VISIBLE_BAND_ROLES } from '../lib/profileTaxonomy';
import { PROFILE_TYPES } from '../lib/profileTypes';
import { BLURB_SECTION_TITLE } from '../lib/profileBlurbFields';
import BlurbFields from '../components/BlurbFields';
import DemoMixField from '../components/DemoMixField';
import { demoMixFieldFor } from '../lib/demoMixField';
import { normalizeSocialValue, ensureHttps } from '../lib/socialLinks';


// BAND_GENRES + BAND_SUBGENRES + BAND_VIBES now come from the shared
// ../lib/profileTaxonomy (2026-07 refresh). Migrated automatically on load,
// no user action required: a renamed value becomes its new name, anything
// else no longer in the lists is dropped.
const SUBGENRE_RENAME_MAP = {
  'Alternative': 'Alt Rock',
  'Progressive': 'Prog Rock',
};
function normalizeSubgenre(tok) {
  return SUBGENRE_RENAME_MAP[tok] || tok;
}

// Band identity comes from PROFILE_TYPES — the sole source of truth since 10E.1.
// These were hand-typed copies of the same three values; identical today, but a
// private copy is exactly how Host's pink drifted to #FF3399 in 8+ files before
// 10E.1, and how this screen's sibling (ArtistProfileScreen) inherited a stale
// 4-stop gradient until 10E.2A. Same values, one owner.
const COL  = PROFILE_TYPES.band.accent;   // #FFB830
const COL2 = PROFILE_TYPES.band.accent2;  // #FF8C42
const GRAD = PROFILE_TYPES.band.gradient; // linear-gradient(90deg, #FFB830, #FF8C42)

// ── EXPERIMENTAL — Band editor only (temporary aesthetic prototype) ────────
// Same "Glass Pill" treatment as the Artist editor, re-tuned to the Band
// accent pair (COL/COL2) — see ArtistProfileScreen.jsx for the full rationale.
// Scoped to this file only.
const GLASS_CHIP_ON_STYLE = {
  border: '1px solid transparent',
  backgroundImage: [
    `linear-gradient(135deg, rgba(${PROFILE_TYPES.band.rgb},.045), rgba(${PROFILE_TYPES.band.accent2Rgb},.04))`,
    `linear-gradient(rgba(17,19,26,.62), rgba(17,19,26,.62))`,
    `linear-gradient(135deg, #DEA02A, #DE7A39)`,
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
    <SectionBlock title={title} accent={COL} accent2={COL2} className={s.section} titleClassName={s.sectionTitle} titleStyle={EXPERIMENTAL_HEADING_STYLE}>
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
  /* ⛔ NO `bandType` STATE ANY MORE. The free-text BAND TYPE field it backed is
     replaced by ACT TYPE chips; the `band_type` COLUMN is untouched in the
     database and simply no longer read or written here. */
  const [members,     setMembers]     = useState('');
  const [established, setEstablished] = useState('');
  const [location,    setLocation]    = useState('');
  const [locState,    setLocState]    = useState('');
  const [postcode,    setPostcode]    = useState('');
  /* ⛔⛔ `sound` WAS MISSING ENTIRELY UNTIL 2026-09, AND THAT WAS A REAL BUG,
     not a missing nicety. The editor showed one box under a heading reading
     YOUR SOUND, and that box wrote `tagline` — a column read by exactly two
     surfaces. Meanwhile `sound` is what portrait cards, application cards,
     enquiry cards, the invite sheet, the fill-slot modal and `lineup_members`
     all read, so every band fell through to
     `genreLabels(genre_string).slice(0,3)` on every surface a promoter uses to
     decide a booking. ⛔ No data was migrated to fix it: existing taglines stay
     taglines, and `sound` starts empty until the band writes one. */
  const [sound,       setSound]       = useState('');
  const [tagline,     setTagline]     = useState('');
  const [epkLink,     setEpkLink]     = useState('');
  const [selGenres,   setSelGenres]   = useState([]);
  const [selSubs,     setSelSubs]     = useState([]);
  const [selVibes,    setSelVibes]    = useState([]);
  /* Selected ACT TYPE keys (BAND_ROLES). ⛔ Kept separate from selGenres/
     selSubs/selVibes even though all four share genre_string: the card-tag
     pool below is built from the sound lists only, and an act type is identity,
     ⛔ not a sound descriptor. */
  const [selActs,     setSelActs]     = useState([]);
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
  const [bandcamp,      setBandcamp]      = useState('');
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
          /* ⚠ `data.band_type` is deliberately NOT read. A profile that holds
             one still loads fine — the value is simply left where it is. */
          setMembers(data.member_count ? String(data.member_count) : '');
          setEstablished(data.established_year ? String(data.established_year) : '');
          setLocation(data.location || '');
          setLocState(data.state || '');
          setPostcode(data.postcode || '');
          setSound(data.sound || '');
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
          loadNa(data.bandcamp,      setBandcamp,     'bandcamp',     naSet);
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
          const isSubToken = t => BAND_SUBGENRES.includes(t) || SUBGENRE_RENAME_MAP[t];
          setSelSubs([...new Set([...parts].filter(isSubToken).map(normalizeSubgenre))]);
          setSelVibes(BAND_VIBES.filter(v => parts.has(v)));
          /* ⭐ ACT TYPE is stored as role KEYS inside genre_string, the same
             mechanism ARTIST_ROLES and PERFORMANCE_ROLES already use. ⚠ Read
             from the same `parts` set the genres come from — one parse, so the
             two can never disagree about what the column said. */
          setSelActs(BAND_ROLES.filter(r => parts.has(r.key)).map(r => r.key));
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
  /* Multi-select, like every other chip row here — "solo or duo, depending" is
     an ordinary answer for a working musician. */
  function toggleAct(k)   { setSelActs(p   => p.includes(k) ? p.filter(x => x !== k) : [...p, k]); setIsDirty(true); }
  function toggleTag(t)   { setSelTags(p => p.includes(t) ? p.filter(x => x !== t) : p.length >= 5 ? p : [...p, t]); setIsDirty(true); }

  function save(skipPostcodeCheck = false) {
    if (!userId || saving) return;
    if (!skipPostcodeCheck && !postcode && !location) { setShowPostcodePrompt(true); return; }
    /* ⭐ ACT-TYPE KEYS RIDE IN genre_string, alongside genres/subgenres/vibes,
       exactly as ARTIST_ROLES and PERFORMANCE_ROLES do. ⛔ They are dropped
       from genre OUTPUT by `genreLabels` (see ALL_ROLE_KEYS) so `solo` can
       never print as a genre — the `dj_prod` leak. */
    const genre_string = [...new Set([...selActs, ...selGenres, ...selSubs, ...selVibes])].join(' · ');
    const card_pills   = selTags.join(' · ');
    const payload = {
      user_id: userId, type: 'band',
      /* ⛔⛔ `band_type` IS NO LONGER WRITTEN (2026-09). It was a free-text box
         asking the act-type question in prose; ACT TYPE chips replace it. The
         COLUMN stays and existing values are left exactly as they are — the one
         populated row in production holds "Jazz / Blues", a genre, and ⛔ must
         not be interpreted as an act type or migrated into these keys. */
      name,
      member_count: members ? parseInt(members) : null,
      established_year: established ? parseInt(established) : null,
      location, state: locState, postcode,
      sound, tagline, bio,
      mix_link: ensureHttps(epkLink), epk_link: ensureHttps(epkLink),
      genre_string, card_pills, avatar: avatarHero || avatarUrl,
      avatar_hero: avatarHero || null, avatar_thumb: avatarThumb || null,
      experience:      expLevel,
      fee_type:        feeType,
      fee:             feeAmount ? parseInt(feeAmount) : null,
      // ⚠ `feeNegotiable &&` — the negation discarded the max in the only
      // state that produces one. See ArtistProfileScreen.
      fee_max:         (feeNegotiable && feeMax) ? parseInt(feeMax) : null,
      fee_negotiable:  feeNegotiable,
      fee_travel:      feeTravel,
      emergency_name:  emergName,
      emergency_phone: emergPhone,
      emergency_rel:   emergRel,
      has_abn:         hasAbn,
      abn,
      gst_registered:  gstReg,
      spotify:       naFields.has('spotify')      ? 'N/A' : normalizeSocialValue('spotify', spotify),
      // ⚠ NEEDS MIGRATION S1 (20260814000000) — see ArtistProfileScreen. Until
      // that column exists this line 400s the entire save, not just itself.
      bandcamp:      naFields.has('bandcamp')     ? 'N/A' : normalizeSocialValue('bandcamp', bandcamp),
      soundcloud:    naFields.has('soundcloud')   ? 'N/A' : normalizeSocialValue('soundcloud', soundcloud),
      youtube:       naFields.has('youtube')      ? 'N/A' : normalizeSocialValue('youtube', youtube),
      instagram:     naFields.has('instagram')    ? 'N/A' : normalizeSocialValue('instagram', instagram),
      facebook:      naFields.has('facebook')     ? 'N/A' : normalizeSocialValue('facebook', facebook),
      contact_email: naFields.has('contactEmail') ? 'N/A' : contactEmail,
      website:       naFields.has('website')      ? 'N/A' : ensureHttps(website),
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
          {/* filter: .h1 (shared from ArtistProfileScreen.module.css) bakes in an
              Artist-cyan drop-shadow. Overriding `background` alone left an orange
              heading wearing a cyan halo — the same class of leftover the Artist
              heading itself had until 10E.2A. */}
          <div className={s.h1} style={{ background: GRAD, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', filter: `drop-shadow(0 0 8px rgba(${PROFILE_TYPES.band.rgb},.2))` }}>
            YOUR<br />MUSO<br />PROFILE
          </div>
          <div className={s.h1Sub}>Fill this in once · travels with you across every event</div>
        </div>
      </div>

      {page === 1 && (
        <AvatarUpload
          userId={userId} bucket="avatars" pathPrefix="band_avatars"
          avatar={avatarUrl}
          ringClass={`${s.avatarRing} ${s.avatarRingBand}`}
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
                {/* Imported bands already exist here unclaimed, with their
                    gigs and followers attached. Suggests only. */}
                <ClaimSuggestion name={name} type="band" />
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

            {/* ── ACT TYPE ─────────────────────────────────────────────────
                ⭐⭐ "WHAT KIND OF ACT AM I BOOKING?" — the promoter's first
                question, and the one a free-text BAND TYPE box was asking in
                prose. ⛔ NOT a genre question: genre, subgenre and vibes sit
                below in YOUR SOUND and are untouched.

                ⚠ POSITIONED SECOND, directly after WHO YOU ARE and BEFORE
                YOUR SOUND, mirroring the DJ editor's "WHAT DO YOU DO?" — an act
                type is what you ARE, not how you sound. ⛔ Deliberately not
                placed where the DJ's TECHNICAL SETUP sits: that section is
                twelfth and, unlike this, is displayed nowhere. */}
            <Section title="ACT TYPE">
              <div className={s.chips}>
                {VISIBLE_BAND_ROLES.map(({ key, label }) => (
                  <button key={key} type="button"
                    className={selActs.includes(key) ? s.chipOn : s.chip}
                    style={selActs.includes(key) ? GLASS_CHIP_ON_STYLE : undefined}
                    onClick={() => toggleAct(key)}
                  >{label}</button>
                ))}
              </div>
            </Section>

            {/* YOUR SOUND & STYLE — canonical, see lib/profileBlurbFields.js */}
            <Section title={BLURB_SECTION_TITLE}>
              <BlurbFields
                s={s} type="band"
                sound={sound} onSoundChange={setSound}
                tagline={tagline} onTaglineChange={setTagline}
              />
            </Section>

            {/* ⚠ UNTITLED ON PURPOSE (owner, 2026-09). This block used to be headed
                YOUR SOUND because it carried the tagline; that moved to the canonical
                section above and the heading went with it. ⛔ Do not give it one back:
                the GENRE / SUBGENRE / VIBE subLabels inside already say what each
                group is, and an outer heading only repeats the first of them. */}
            <Section>
              <div className={s.subLabel} style={{ ...EXPERIMENTAL_HEADING_STYLE, borderImage: `linear-gradient(90deg, ${COL}, ${COL2}) 1` }}>GENRE</div>
              <div className={s.chips}>
                {BAND_GENRES.map(g => (
                  <button key={g} type="button"
                    className={selGenres.includes(g) ? s.chipOn : s.chip}
                    style={selGenres.includes(g) ? GLASS_CHIP_ON_STYLE : undefined}
                    onClick={() => toggleGenre(g)}>
                    {g}
                  </button>
                ))}
              </div>
              <div className={s.subLabel} style={{ ...EXPERIMENTAL_HEADING_STYLE, borderImage: `linear-gradient(90deg, ${COL}, ${COL2}) 1` }}>SUBGENRE</div>
              <div className={s.chips}>
                {BAND_SUBGENRES.map(g => (
                  <button key={g} type="button"
                    className={selSubs.includes(g) ? s.chipOn : s.chip}
                    style={selSubs.includes(g) ? GLASS_CHIP_ON_STYLE : undefined}
                    onClick={() => toggleSub(g)}>
                    {g}
                  </button>
                ))}
              </div>
              <div className={s.subLabel} style={{ ...EXPERIMENTAL_HEADING_STYLE, borderImage: `linear-gradient(90deg, ${COL}, ${COL2}) 1` }}>VIBES</div>
              <div className={s.chips}>
                {BAND_VIBES.map(v => (
                  <button key={v} type="button"
                    className={selVibes.includes(v) ? s.chipOn : s.chip}
                    style={selVibes.includes(v) ? GLASS_CHIP_ON_STYLE : undefined}
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
                        style={selTags.includes(t) ? GLASS_CHIP_ON_STYLE : undefined}
                        onClick={() => toggleTag(t)}
                        disabled={!selTags.includes(t) && selTags.length >= 5}
                      >{t}</button>
                    ))}
                  </div>
                  <div className={s.charCount}>{selTags.length} / 5 selected</div>
                </Section>
              );
            })()}

            {/* ⚠ WAS "EPK / PROMO LINK", AND THAT NAME WAS THE PROBLEM. It invited
                Spotify, Bandcamp and press kits, none of which the player can open,
                while writing the same `mix_link` the play button reads. A band's
                demo is a mixtape; it is now asked for as one. ⛔ The `epk_link`
                column is still written exactly as before — see lib/demoMixField.js. */}
            <Section title={demoMixFieldFor('band').title}>
              <DemoMixField
                s={s} type="band"
                value={epkLink} onChange={e => setEpkLink(e.target.value)}
                naFields={naFields} onToggleNa={toggleNa}
              />
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
                <button type="button" className={feeType === 'exposure' ? s.feeBtnOn : s.feeBtn} onClick={() => { setFeeType('exposure'); setIsDirty(true); }}>EXPOSURE / FREE</button>
                <button type="button" className={feeType === 'paid'     ? s.feeBtnOn : s.feeBtn} onClick={() => { setFeeType('paid'); setIsDirty(true); }}>PAID GIG</button>
              </div>
              {feeType === 'paid' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1.5, fontFamily: "'Bebas Neue'", marginBottom: 6 }}>FROM $</div>
                    <input className={s.input} type="text" inputMode="numeric" value={feeAmount} onChange={e => setFeeAmount(e.target.value)} placeholder="e.g. 600" />
                  </div>
                  {/* ⚠ TOUCHING `TO $` TICKS NEGOTIABLE — see ArtistProfileScreen
                      for why, and why this is not a disabled input. */}
                  <div style={{ flex: 1, opacity: feeNegotiable ? 1 : 0.35 }}>
                    {/* ⚠ (OPTIONAL) ON THE LABEL — see ArtistProfileScreen. */}
                    <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1.5, fontFamily: "'Bebas Neue'", marginBottom: 6 }}>
                      TO $ <span style={{ opacity: 0.6 }}>(OPTIONAL)</span>
                    </div>
                    <input className={s.input} type="text" inputMode="numeric" value={feeMax}
                      onFocus={() => { if (!feeNegotiable) { setFeeNegotiable(true); setIsDirty(true); } }}
                      onChange={e => { setFeeMax(e.target.value); setIsDirty(true); }}
                      placeholder="e.g. 1200" />
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

            {/* ABN / GST — directly under SET FEE: both are what you charge and
                how you invoice it, so they read as one commercial block. */}
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

            {/* PA1 — reusable professional documents. Part of the profile, so
                it lives here rather than on the dashboard. */}
            <Section>
              <ProfileAssetsSection
                userId={userId} profileType="band"
                accent={COL} accent2={COL2}
                titleClassName={s.sectionTitle} titleStyle={EXPERIMENTAL_HEADING_STYLE}
              />
            </Section>

            {/* EMERGENCY CONTACT */}
            <Section title="EMERGENCY CONTACT">
              <Field label="NAME"><input className={s.input} value={emergName} onChange={e => setEmergName(e.target.value)} placeholder="Contact name" autoComplete="off" /></Field>
              <Field label="PHONE"><input className={s.input} value={emergPhone} onChange={e => setEmergPhone(e.target.value)} placeholder="Phone number" type="tel" /></Field>
              <Field label="RELATIONSHIP"><input className={s.input} value={emergRel} onChange={e => setEmergRel(e.target.value)} placeholder="e.g. Manager, Partner" /></Field>
            </Section>

            {/* SOCIALS + LINKS */}
            <Section title="SOCIALS + LINKS">
              <SocialSection
                links={[
                  /* ⚠ NOT "@handle or link" like its neighbours. Spotify has
                     no handle: the only thing that resolves is the artist URL,
                     whose `artist/<id>` path IS the stored value. Asking for a
                     handle invites an ID pasted bare, which rebuilds as
                     open.spotify.com/<id> and 404s. */
                  { icon: 'spotify', key: 'spotify',      value: spotify,       onChange: e => setSpotify(e.target.value),      placeholder: 'open.spotify.com/artist/…' },
                  { icon: 'bc',      key: 'bandcamp',     value: bandcamp,      onChange: e => setBandcamp(e.target.value),     placeholder: 'yourband.bandcamp.com' },
                  { icon: 'sc',      key: 'soundcloud',   value: soundcloud,    onChange: e => setSoundcloud(e.target.value),   placeholder: '@handle or link' },
                  { icon: 'yt',      key: 'youtube',      value: youtube,       onChange: e => setYoutube(e.target.value),      placeholder: '@handle or link' },
                  { icon: 'ig',      key: 'instagram',    value: instagram,     onChange: e => setInstagram(e.target.value),    placeholder: '@handle or link' },
                  { icon: 'fb',      key: 'facebook',     value: facebook,      onChange: e => setFacebook(e.target.value),     placeholder: '@handle or link' },
                  { icon: 'email',   key: 'contactEmail', value: contactEmail,  onChange: e => setContactEmail(e.target.value), placeholder: 'Booking email',        type: 'email' },
                  { icon: 'web',     key: 'website',      value: website,       onChange: e => setWebsite(e.target.value),      placeholder: 'yourband.com' },
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
