import { useState, useEffect } from 'react';
import { STATE_OPTIONS } from '../lib/auLocations';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import s from './HostProfileScreen.module.css';
import AvatarUpload from '../components/AvatarUpload';
import { useProfileForm } from '../hooks/useProfileForm';
import ProfileFormShell from '../components/ProfileFormShell';
import SectionBlock from '../components/SectionBlock';
import ProfileAssetsSection from '../components/ProfileAssetsSection';
import RequirementChecklist, { toggleRequirement } from '@yespleez/requirements/checklist';
import SocialSection from '../components/SocialSection';
import { HOST_GENRES, ALL_GENRES, SUBGENRES, HOST_CATEGORIES, VISIBLE_HOST_CATEGORIES } from '../lib/profileTaxonomy';
import { PROFILE_TYPES } from '../lib/profileTypes';
import { normalizeSocialValue } from '../lib/socialLinks';


// Keys only, for the genre-filter/parse logic below — labels come from
// VISIBLE_HOST_CATEGORIES at render time. Parsing uses the FULL category list
// (not just the visible ones) so a profile that already has a disabled
// category (e.g. Festivals) embedded in its stored genre_string still
// round-trips correctly instead of being silently stripped on next save.
const HOST_CATS = HOST_CATEGORIES.map(c => c.key);

// MAIN_GENRES / HOST_GENRES / ALL_GENRES / SUBGENRES / HOST_CATEGORIES now
// come from the shared ../lib/profileTaxonomy.

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

// Genre options available for a given category selection. Falls back to every
// genre (ALL_GENRES) both when nothing is selected AND when every selected
// category is a non-genre one (HOST_GENRES has no bucket for it, e.g.
// Festivals) — otherwise picking only a non-genre category would leave the
// genre picker empty instead of just "unfiltered".
function genresForCats(cats) {
  const fromCats = [...new Set(cats.flatMap(c => HOST_GENRES[c] || []))];
  return cats.length === 0 || fromCats.length === 0 ? ALL_GENRES : fromCats;
}

// Host identity comes from PROFILE_TYPES — the sole source of truth since 10E.1.
// These were hand-typed copies of the same three values; identical today, but a
// private copy is exactly how Host's own pink drifted to #FF3399 in 8+ files
// before 10E.1 corrected it. Same values, one owner.
const ACCENT  = PROFILE_TYPES.host.accent;   // #FF2D78
const ACCENT2 = PROFILE_TYPES.host.accent2;  // #00E5FF
const GRAD    = PROFILE_TYPES.host.gradient; // linear-gradient(90deg, #FF2D78, #00E5FF)

// ── EXPERIMENTAL — Host editor only (temporary aesthetic prototype) ────────
// Same "Glass Pill" treatment as the Artist editor, re-tuned to the Host
// accent pair (ACCENT/ACCENT2) — see ArtistProfileScreen.jsx for the full
// rationale. Scoped to this file only.
const GLASS_CHIP_ON_STYLE = {
  border: '1px solid transparent',
  backgroundImage: [
    `linear-gradient(135deg, rgba(255,45,120,.045), rgba(0,229,255,.04))`,
    `linear-gradient(rgba(17,19,26,.62), rgba(17,19,26,.62))`,
    `linear-gradient(135deg, #DE2768, #00C7DE)`,
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

export default function HostProfileScreen() {
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

  const [loading, setLoading] = useState(true);

  const [name,         setName]         = useState('');
  const [years,        setYears]        = useState('');
  const [location,     setLocation]     = useState('');
  const [state,        setState]        = useState('');
  const [postcode,     setPostcode]     = useState('');
  const [tagline,      setTagline]      = useState('');
  const [sound,        setSound]        = useState('');
  const [bio,          setBio]          = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [instagram,    setInstagram]    = useState('');
  const [facebook,     setFacebook]     = useState('');
  const [website,      setWebsite]      = useState('');
  const [selCats,   setSelCats]   = useState([]);
  const [selGenres, setSelGenres] = useState([]);
  const [selSubs,   setSelSubs]   = useState([]);
  const [selVibes,  setSelVibes]  = useState([]);
  /**
   * P6 — STANDING requirements: what an act must already have before it may
   * ask this host about a date.
   *
   * ⚠⚠ DORMANT ON PURPOSE. Nothing evaluates these yet — there is no
   * artist → host availability enquiry to gate (the only enquiry path in the
   * app is artist → VENUE, ProfileScreen.sendEnquiry). A host can set them
   * today and they persist; they begin to bite the day that flow is built.
   *
   * ⛔ Do NOT wire them into the venue-initiated invitation path to "make them
   * do something". That direction is never gated — see P6's migration comment.
   */
  const [requiredItems, setRequiredItems] = useState([]);

  useEffect(() => {
    if (!userId) return;
    supabase.from('profiles').select('*').eq('user_id', userId).eq('type', 'host').maybeSingle()
      .then(({ data, error }) => {
        if (error) { setSaveErr('Failed to load profile. Please refresh.'); setLoading(false); return; }
        if (data) {
          setAvatarUrl(data.avatar || '');
          setAvatarHero(data.avatar_hero || '');
          setAvatarThumb(data.avatar_thumb || '');
          setName(data.name || '');
          setYears(data.years || '');
          setLocation(data.location || '');
          setState(data.state || '');
          setPostcode(data.postcode || '');
          setTagline(data.tagline || '');
          setSound(data.sound || '');
          setBio(data.bio || '');
          const naSet = new Set();
          loadNa(data.instagram,                   setInstagram,    'instagram',    naSet);
          loadNa(data.facebook,                    setFacebook,     'facebook',     naSet);
          loadNa(data.website,                     setWebsite,      'website',      naSet);
          loadNa(data.contact_email || data.email, setContactEmail, 'contactEmail', naSet);
          setNaFields(naSet);
          // NULL and '{}' both mean "no requirements" — an empty array either way.
          setRequiredItems(data.required_items || []);
          const parsed = parseGenreString(data.genre_string);
          setSelCats(parsed.cats);
          setSelGenres(parsed.genres);
          setSelSubs(parsed.subs);
          setSelVibes(parsed.vibes);
        }
        setLoading(false);
      });
  }, [userId]);

  // When categories change, drop genre selections no longer in available set.
  // Falls back to ALL_GENRES not just when nothing is selected but also when
  // every selected category is a non-genre one (e.g. Festivals) — otherwise a
  // host who only ticks "Festivals" would see their genre picker go empty and
  // silently lose any genres they'd already chosen.
  useEffect(() => {
    setSelGenres(prev => prev.filter(g => genresForCats(selCats).includes(g)));
  }, [selCats]);

  // When main genres change, drop subgenre selections with no parent
  useEffect(() => {
    const validSubs = selGenres.flatMap(g => SUBGENRES[g] || []);
    setSelSubs(prev => prev.filter(s => validSubs.includes(s)));
  }, [selGenres]);

  function toggleCat(cat)  { setSelCats(prev   => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]); setIsDirty(true); }
  function toggleGenre(g)  { setSelGenres(prev  => prev.includes(g)   ? prev.filter(x => x !== g)   : [...prev, g]);   setIsDirty(true); }
  function toggleSub(sub)  { setSelSubs(prev    => prev.includes(sub) ? prev.filter(x => x !== sub) : [...prev, sub]); setIsDirty(true); }
  function toggleVibe(v)   { setSelVibes(prev   => prev.includes(v)   ? prev.filter(x => x !== v)   : [...prev, v]);   setIsDirty(true); }

  function save(skipPostcodeCheck = false) {
    if (!userId || saving) return;
    if (!skipPostcodeCheck && !postcode && !location) { setShowPostcodePrompt(true); return; }
    const genre_string = buildGenreString(selCats, selGenres, selSubs, selVibes);
    const payload = {
      user_id: userId, type: 'host',
      name, years, location, state, postcode,
      tagline, sound, bio,
      instagram:     naFields.has('instagram')    ? 'N/A' : normalizeSocialValue('instagram', instagram),
      facebook:      naFields.has('facebook')     ? 'N/A' : normalizeSocialValue('facebook', facebook),
      website:       naFields.has('website')      ? 'N/A' : normalizeSocialValue('website', website),
      contact_email: naFields.has('contactEmail') ? 'N/A' : contactEmail,
      genre_string, avatar: avatarHero || avatarUrl,
      avatar_hero: avatarHero || null, avatar_thumb: avatarThumb || null,
      // P6 — always an array, never null, so clearing the last tick clears it.
      required_items: requiredItems,
    };
    runSave(async () => {
      const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'user_id,type' });
      if (error) throw error;
    }, '/industry/host', 1200);
  }

  const availableGenres = genresForCats(selCats);

  const availSubs = selGenres.flatMap(g => SUBGENRES[g] || []);

  if (loading) return <div className={s.loading}>LOADING…</div>;

  return (
    <div className={s.screen}>
      {/* Header */}
      <div className={s.header}>
        <div className={s.headerText}>
          {/* 10E.4: this heading had no inline override, so it rendered .h1's
              hand-typed `135deg` gradient instead of the canonical 90deg token —
              Host was the last editor still doing this (Artist was fixed at
              10E.2A, Band at 10E.3; Standup and Venue already override). Colours
              were already right post-10E.1; the ANGLE was the drift, and Host's
              own borders/section styles below already use 90deg. */}
          <div className={s.h1} style={{ background: GRAD, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>YOUR<br/>HOST<br/>PROFILE</div>
        </div>
      </div>

      <AvatarUpload
        userId={userId} bucket="avatars" pathPrefix="host_avatars"
        avatar={avatarUrl}
        ringClass={s.avatarRing}
        onUpload={handleAvatarUpload}
        onRemove={handleAvatarRemove}
      />

      <ProfileFormShell
        blocker={blocker}
        showPostcodePrompt={showPostcodePrompt}
        onPostcodeSave={() => setShowPostcodePrompt(false)}
        onPostcodeDismiss={() => { setShowPostcodePrompt(false); save(true); }}
        onSubmit={e => { e.preventDefault(); save(); }}
        onFormChange={markDirty}
      >

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
              <Field label="TOWN / SUBURB">
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
              <Field label="POSTCODE">
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
            {VISIBLE_HOST_CATEGORIES.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={selCats.includes(key) ? s.catBtnOn : s.catBtn}
                style={selCats.includes(key) ? GLASS_CHIP_ON_STYLE : undefined}
                onClick={() => toggleCat(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </Section>

        {/* GENRES YOU BOOK */}
        <Section title="GENRES YOU BOOK">
          <div className={s.chips}>
            {availableGenres.map(g => (
              <button key={g} type="button" className={selGenres.includes(g) ? s.chipOn : s.chip} style={selGenres.includes(g) ? GLASS_CHIP_ON_STYLE : undefined} onClick={() => toggleGenre(g)}>
                {g}
              </button>
            ))}
          </div>

          {availSubs.length > 0 && (
            <>
              <div className={s.subLabel} style={{ ...EXPERIMENTAL_HEADING_STYLE, borderImage: `linear-gradient(90deg, ${ACCENT}, ${ACCENT2}) 1` }}>SUB GENRES</div>
              <div className={s.chips}>
                {availSubs.map(sub => (
                  <button key={sub} type="button" className={selSubs.includes(sub) ? s.chipOn : s.chip} style={selSubs.includes(sub) ? GLASS_CHIP_ON_STYLE : undefined} onClick={() => toggleSub(sub)}>
                    {sub}
                  </button>
                ))}
              </div>
            </>
          )}
        </Section>

        {/* VIBES */}
        <Section title="VIBES">
          <div className={s.chips}>
            {VIBES.map(v => (
              <button key={v} type="button" className={selVibes.includes(v) ? s.chipOn : s.chip} style={selVibes.includes(v) ? GLASS_CHIP_ON_STYLE : undefined} onClick={() => toggleVibe(v)}>
                {v}
              </button>
            ))}
          </div>
        </Section>

        {/* PA1 — reusable professional documents. Host has no fee/ABN/emergency
            block, so the shared ordering reduces to: assets before contact. */}
        <Section>
          <ProfileAssetsSection
            userId={userId} profileType="host"
            accent={ACCENT} accent2={ACCENT2}
            titleClassName={s.sectionTitle} titleStyle={EXPERIMENTAL_HEADING_STYLE}
          />
        </Section>

        {/* P6 — STANDING requirements for availability enquiries.
            In the EDITOR, not the dashboard, for the same reason as assets
            (owner, 2026-08-02): a minimum bar for who may approach you is part
            of who you are.

            ⚠ The copy says "will be able to", not "can", because it is TRUE:
            there is no artist → host enquiry flow yet, so ticking a box here
            changes nothing today. Promising a gate that does not exist would
            be worse than an empty section — a host would believe they were
            filtering and they would not be. */}
        <Section title="ENQUIRY REQUIREMENTS">
          <RequirementChecklist
            selected={requiredItems}
            onToggle={key => { setRequiredItems(p => toggleRequirement(p, key)); setIsDirty(true); }}
            intro={<>
              Tick what an act must already have before they can ask you about a date.
              Everything ticked is mandatory. Saved now and applied to host enquiries
              once that flow arrives — it doesn&rsquo;t affect anything you receive today.
            </>}
          />
        </Section>

        {/* CONTACT + SOCIALS */}
        <Section title="CONTACT + SOCIALS">
          <SocialSection
            links={[
              { icon: 'ig',    key: 'instagram',    value: instagram,    onChange: e => setInstagram(e.target.value),    placeholder: '@handle or link' },
              { icon: 'fb',    key: 'facebook',     value: facebook,     onChange: e => setFacebook(e.target.value),     placeholder: '@handle or link' },
              { icon: 'web',   key: 'website',      value: website,      onChange: e => setWebsite(e.target.value),      placeholder: 'Website' },
              { icon: 'email', key: 'contactEmail', value: contactEmail, onChange: e => setContactEmail(e.target.value), placeholder: 'Booking contact email',  type: 'email' },
            ]}
            naFields={naFields}
            onToggleNa={toggleNa}
            inputClass={s.input}
            rowClass={s.socialRow}
            iconClass={s.socialIcon}
          />
        </Section>

        {saveErr && <p className={s.error}>{saveErr}</p>}

        <button type="submit" className={s.saveBtn} disabled={saving}>
          {saving ? 'SAVING…' : saved ? '✓ SAVED!' : 'SAVE HOST PROFILE →'}
        </button>

      </ProfileFormShell>
    </div>
  );
}
