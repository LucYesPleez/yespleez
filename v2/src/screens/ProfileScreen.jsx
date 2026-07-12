import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { writeNotification } from '../lib/writeNotification';
import { useSession, usePlayer } from '../App';
import EventCard from '../components/EventCard';
import { getEventBadges } from '../lib/eventBadges';
import s from './ProfileScreen.module.css';
import ClaimDialog from '../components/ClaimDialog';
import { resolveProfileRoute, profileUrl } from '../lib/profileResolution';
import PastEventsSearch, { filterPastEvents } from '../components/PastEventsSearch';

const TYPE_ACCENTS = {
  host:    { col: '#FF2D78',      rgb: '255,45,120',  label: 'HOST',                grad2: '#BF5FFF' },
  artist:  { col: '#00E5FF',      rgb: '0,229,255',   label: 'DJ / PRODUCER',       grad2: '#BF5FFF' },
  band:    { col: '#FF8C42',      rgb: '255,140,66',  label: 'BAND',                grad2: '#FF5500' },
  standup: { col: '#FF88AA',      rgb: '255,136,170', label: 'SPOKEN WORD',         grad2: '#BF5FFF' },
  venue:   { col: '#00E5A0',      rgb: '0,229,160',   label: 'VENUE',               grad2: '#00E5FF' },
};

const OLD_CATS = new Set(['ELECTRONIC','BANDS','SPOKEN','SPOKEN WORD','RAVE','FESTIVAL']);

const PLACEHOLDER_HERO = {
  artist:  '/defaultdj.png',
  band:    '/defaultband.png',
  standup: '/defaultmic.png',
  venue:   '/defaultvenueblur.png',
  host:    '/defaultpromoter.jpg',
};

export default function ProfileScreen() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const typeFilter = searchParams.get('type');
  const [genreExpanded, setGenreExpanded] = useState(false);
  const [bioExpanded,   setBioExpanded]   = useState(false);
  const [heroLoaded,    setHeroLoaded]    = useState(false);
  const [followed,    setFollowed]    = useState(false);
  const [followBusy,  setFollowBusy]  = useState(false);
  const { player, setPlayer } = usePlayer();
  const [availOpen,     setAvailOpen]     = useState(false);
  const [availDates,    setAvailDates]    = useState(null);
  const [eventDates,    setEventDates]    = useState(new Set());
  const [availMonth,    setAvailMonth]    = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [showPast,      setShowPast]      = useState(false);
  const [showAllUp,     setShowAllUp]     = useState(false);
  const [showAllPast,   setShowAllPast]   = useState(false);
  const [pastGigSearch, setPastGigSearch] = useState('');
  const [gigsView,      setGigsView]      = useState('portrait'); // 'portrait' | 'list'
  const [pickerDate,    setPickerDate]    = useState(null);
  const [pickerProfs,   setPickerProfs]   = useState([]);
  const [enquiryProf,   setEnquiryProf]   = useState(null);
  const [enquiryNote,   setEnquiryNote]   = useState('');
  const [enquirySending,setEnquirySending]= useState(false);
  const [enquiryLoading,setEnquiryLoading]= useState(false);
  const [followPickerProfs, setFollowPickerProfs] = useState([]);
  const [followSelected,    setFollowSelected]    = useState(new Set());
  const [claimOpen,         setClaimOpen]         = useState(false);

  const { data, isLoading: loading } = useQuery({
    queryKey: ['profile', id, typeFilter],
    queryFn: async () => {
      // M5: canonical resolution by profiles.id, with the permanent legacy
      // shim (profiles.user_id) behind it — see lib/profileResolution.js.
      // The placeholder_profiles fallback is retired: staging rows are not
      // publicly navigable (spec S1); every live placeholder was promoted
      // into profiles by M3.
      const preferPerformer = searchParams.get('prefer') === 'performer';
      const { profile: ownedProfile, isLegacyHit } = await resolveProfileRoute(id, { typeFilter, preferPerformer });

      if (!ownedProfile) return { profile: null, events: [], isLegacyHit: false };

      let events = [];
      if (ownedProfile.type === 'venue') {
        // Attribution split (M1/M5): public attribution reads venue_profile_id,
        // never the auth-only host_id.
        const eRes = await supabase.from('events').select('id,name,config').eq('venue_profile_id', ownedProfile.id).in('status', ['live','completed']).order('created_at', { ascending: false }).limit(100);
        events = eRes.data || [];
      } else {
        // Compatibility read until M8: legacy rows key on artist_id (account),
        // newer/unclaimed-linked rows on artist_profile_id. The user_id leg is
        // skipped for unclaimed profiles (no account to match).
        const legs = [`artist_profile_id.eq.${ownedProfile.id}`];
        if (ownedProfile.user_id) legs.push(`artist_id.eq.${ownedProfile.user_id}`);
        const claimsRes = await supabase.from('lineup_members').select('event_id').or(legs.join(',')).neq('status', 'removed');
        const eventIds = [...new Set((claimsRes.data || []).map(c => c.event_id).filter(Boolean))];
        if (eventIds.length) {
          const eRes = await supabase.from('events').select('id,name,config').in('id', eventIds).order('id', { ascending: true }).limit(10);
          events = eRes.data || [];
        }
      }
      return { profile: ownedProfile, events, isLegacyHit };
    },
    enabled: !!id,
    staleTime: 0,
  });

  const profile     = data?.profile || null;
  const events      = data?.events  || [];
  // M5: unclaimed state is a property of the row, not of which table answered.
  const isUnclaimed = !!profile && profile.user_id == null;
  // Legacy entity key for the follows table's mixed keyspace: account id for
  // claimed targets (byte-identical to pre-M5 rows), profile id for unclaimed.
  const legacyEntityId = profile ? (profile.user_id ?? profile.id) : null;

  // M5 legacy redirect shim (permanent): a /profile/<user_id> URL resolves,
  // then pins to the canonical /profile/<profiles.id> URL.
  useEffect(() => {
    if (!data?.isLegacyHit || !data?.profile) return;
    const prefer = searchParams.get('prefer');
    navigate(profileUrl(data.profile) + (prefer ? `&prefer=${prefer}` : ''), { replace: true });
  }, [data?.isLegacyHit, data?.profile?.id]);

  useEffect(() => {
    const heroUrl = profile?.avatar_hero;
    if (!heroUrl) {
      // No separate hero — just show whatever image we have, unblurred
      if (profile?.avatar_thumb || profile?.avatar) setHeroLoaded(true);
      return;
    }
    setHeroLoaded(false);
    const img = new window.Image();
    img.onload = () => setHeroLoaded(true);
    img.src = heroUrl;
  }, [profile?.avatar_hero, profile?.avatar_thumb, profile?.avatar]);

  // Load follow state once profile is known (M5: keyed on the resolved
  // profile, covering both the legacy entity_id keyspace and the canonical
  // target_profile_id)
  useEffect(() => {
    if (!profile?.id || !session?.user?.id) return;
    supabase.from('follows').select('id')
      .eq('user_id', session.user.id)
      .or(`target_profile_id.eq.${profile.id},entity_id.eq.${legacyEntityId}`)
      .limit(1)
      .then(({ data: fol }) => setFollowed(!!(fol && fol.length)));
  }, [profile?.id, session?.user?.id]);

  async function openEnquiry(dateStr) {
    if (!session?.user?.id) return;
    setEnquiryLoading(true);
    const { data: profs } = await supabase.from('profiles')
      .select('id, user_id, type, name, avatar, location, genre_string, sound')
      .eq('user_id', session.user.id)
      .neq('type', 'punter').neq('type', 'venue');
    if (!profs?.length) return;
    const mapped = profs.map(p => ({ ...p, label: TYPE_ACCENTS[p.type]?.label || p.type.toUpperCase() }));
    setEnquiryLoading(false);
    setPickerDate(dateStr);
    if (mapped.length === 1) { setEnquiryProf(mapped[0]); setPickerProfs([]); }
    else { setPickerProfs(mapped); setEnquiryProf(null); }
  }

  async function sendEnquiry() {
    if (!enquiryProf || !pickerDate || enquirySending) return;
    setEnquirySending(true);
    // Dual-write (M2 invariant): both sides are already-resolved profiles rows,
    // so the profile ids are direct assignments, not lookups. The enquiry UI only
    // renders for isVenue && !isUnclaimed, so `profile` is a real claimed venue
    // row. M5: identity values derive from the loaded row, never the route param.
    const { error } = await supabase.from('venue_enquiries').insert({
      venue_user_id:        profile.user_id,
      applicant_user_id:    session.user.id,
      applicant_type:       enquiryProf.type,
      venue_profile_id:     profile?.id ?? null,
      applicant_profile_id: enquiryProf.id ?? null,
      date_requested:       pickerDate,
      note:                 enquiryNote.trim() || null,
      status:               'pending',
    });
    setEnquirySending(false);
    if (!error || error.message?.includes('duplicate') || error.message?.includes('unique')) {
      setEnquiryProf(null); setPickerDate(null); setEnquiryNote('');
    }
  }

  if (loading) return (
    <div className={s.screen}>
      <p className={s.loading}>LOADING…</p>
    </div>
  );

  if (!profile) return (
    <div className={s.screen}>
      <p className={s.loading}>Profile not found.</p>
    </div>
  );

  async function toggleFollow() {
    if (!session?.user?.id || followBusy) return;
    if (followed) {
      setFollowBusy(true);
      // M5: cover both keyspaces — legacy rows keyed by entity_id, canonical
      // rows by target_profile_id.
      await supabase.from('follows').delete()
        .eq('user_id', session.user.id)
        .or(`target_profile_id.eq.${profile.id},entity_id.eq.${legacyEntityId}`);
      setFollowed(false);
      setFollowBusy(false);
      return;
    }
    // Check if user has multiple profiles — if so, show picker
    const { data: profs } = await supabase.from('profiles')
      .select('user_id, type, name, avatar, genre_string, sound')
      .eq('user_id', session.user.id);
    const mapped = (profs || []).map(p => ({ ...p, label: TYPE_ACCENTS[p.type]?.label || p.type.toUpperCase() }));
    if (mapped.length > 1) {
      setFollowPickerProfs(mapped);
      setFollowSelected(new Set());
    } else {
      await doFollow(session.user.id);
    }
  }

  async function doFollow(userIds) {
    setFollowBusy(true);
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    // M5: identity values derive from the loaded profile row, never the route
    // param. Written columns are unchanged (entity_id + dual-written
    // target_profile_id); for claimed targets the values are byte-identical
    // to pre-M5 rows.
    await Promise.all(ids.map(uid =>
      supabase.from('follows').insert({ user_id: uid, entity_id: legacyEntityId, entity_type: 'profile', entity_name: profile.name, target_profile_id: profile.id })
    ));
    // Bust the My Scene cache so the new follow appears immediately
    queryClient.invalidateQueries({ queryKey: ['myScene'] });
    // Notify the profile owner that someone followed them
    if (profile.user_id) await writeNotification(
      profile.user_id,
      'new_follower',
      `Someone followed your profile${profile.name ? ` — ${profile.name}` : ''}.`,
      { follower_id: session.user.id }
    );
    setFollowed(true);
    setFollowBusy(false);
    setFollowPickerProfs([]);
    setFollowSelected(new Set());
  }

  async function share() {
    const url = window.location.href;
    if (navigator.share) { try { await navigator.share({ title: profile.name, url }); } catch (_) {} }
    else { try { await navigator.clipboard.writeText(url); } catch (_) {} }
  }


  const ta      = TYPE_ACCENTS[profile.type] || TYPE_ACCENTS.artist;
  const col     = ta.col;
  const rgb     = ta.rgb;
  const grad2   = ta.grad2;
  const isHost  = profile.type === 'host';
  const isVenue = profile.type === 'venue';
  // M5: always a profiles-shaped row; unclaimed profiles fall back to the
  // generic type imagery (never a real likeness) when they have no avatar.
  const heroUrl = profile.avatar_hero || profile.avatar_thumb || profile.avatar
    || (isUnclaimed ? PLACEHOLDER_HERO[profile.type] : null) || null;
  const label   = isVenue ? ta.label : (profile.band_type || profile.act_type || ta.label);
  const loc     = [profile.suburb || profile.location, profile.state].filter(Boolean).join(', ');
  const mixLink = profile.mix_link || profile.soundcloud || profile.mixcloud || '';

  const tagline = (() => {
    const tl = (profile.tagline || '').trim();
    if (!tl) return '';
    const isOld = tl.split(' · ').every(t => OLD_CATS.has(t.trim().toUpperCase()));
    return isOld ? '' : tl;
  })();

  const genres = profile.genre_string
    ? profile.genre_string.split(/\s*·\s*|,\s*/).map(g => g.trim()).filter(Boolean)
    : [];
  const visibleGenres = genreExpanded ? genres : genres.slice(0, 5);

  const na = v => !v || v === 'N/A';
  const igHandle = v => v.replace(/^@/, '').replace(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/?/i, '').replace(/\/$/, '');
  const fbUrl = v => { const slug = v.replace(/^(?:https?:\/\/)?(?:www\.)?facebook\.com\/?/i, '').replace(/\/$/, ''); return slug.startsWith('http') ? slug : `https://facebook.com/${slug}`; };
  // M5: the placeholder row-shape branch (social_links JSONB) is gone — the
  // resolver only returns profiles rows, whose socials are flat columns
  // (M3's promotion unpacked social_links into them).
  const socials = [
        !na(profile.instagram) && { href: `https://instagram.com/${igHandle(profile.instagram)}`, col: '#E1306C', icon: 'instagram' },
        !na(profile.facebook)  && { href: fbUrl(profile.facebook), col: '#1877F2', icon: 'facebook' },
        !na(profile.youtube)   && { href: profile.youtube?.startsWith('http') ? profile.youtube : 'https://'+profile.youtube, col: '#FF0000', icon: 'youtube' },
        !na(profile.soundcloud) && { href: profile.soundcloud.startsWith('http') ? profile.soundcloud : 'https://'+profile.soundcloud, col: '#FF5500', icon: 'soundcloud' },
        !na(profile.mixcloud)  && { href: profile.mixcloud.startsWith('http') ? profile.mixcloud : 'https://'+profile.mixcloud, col: '#52aad8', icon: 'mixcloud' },
        !na(profile.website)   && { href: profile.website?.startsWith('http') ? profile.website : 'https://'+profile.website, col: 'var(--neon2)', icon: 'globe' },
        !na(profile.contact_email) && { href: `mailto:${profile.contact_email}`, col: '#aaaacc', icon: 'email' },
      ].filter(Boolean);

  return (
    <div className={s.screen}>
      {/* Fixed blurred background */}
      <div
        className={s.heroBg}
        style={heroUrl
          ? { backgroundImage: `url(${heroUrl})`, filter: 'blur(28px)' }
          : { background: `linear-gradient(135deg, rgba(${rgb},.6) 0%, rgba(0,0,0,.85) 55%, rgba(${rgb},.35) 100%)` }
        }
      />

      {/* Hero photo */}
      {heroUrl && (
        <div
          className={s.heroImg}
          style={{
            backgroundImage: `url(${heroUrl})`,
            ...(isUnclaimed && !profile.avatar
              ? { height: '120dvh', transform: 'translateX(-50%) translateY(-20dvh)' }
              : {}),
          }}
        />
      )}

      {/* Gradient fade at top of hero — keeps header icons readable */}
      <div className={s.heroTopFade} />

      {/* Gradient fade at bottom of hero */}
      <div className={s.heroFade} />

      {/* Scrollable content */}
      <div className={s.scroll}>
        {/* Spacer = hero height */}
        <div className={s.heroSpacer} />

        {/* Name + badge row */}
        <div className={s.nameBlock}>
          <div className={s.name}>{profile.name}</div>
          <div className={s.metaRow}>
            <span className={s.badge} style={{ color: col, background: `rgba(${rgb},.15)`, borderColor: `rgba(${rgb},.35)` }}>{label}</span>
            {isUnclaimed && (
              <span style={{ fontSize: 10, border: '1px solid rgba(255,255,255,.2)', borderRadius: 20, padding: '3px 10px', color: 'rgba(255,255,255,.35)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: 1 }}>
                UNCLAIMED
              </span>
            )}
            {loc && (
              <span className={s.location}>
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: 2 }}>
                  <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
                {loc}
              </span>
            )}
            {(profile.years || profile.established_year) && <span className={s.est}>Est. {profile.years || profile.established_year}</span>}
          </div>
          {/* card_pills tags (up to 5), fallback to genres — not shown for venues */}
          {profile.type !== 'venue' && (() => {
            const pillSrc = profile.card_pills
              ? profile.card_pills.split(/\s*·\s*|,\s*/).map(p => p.trim()).filter(Boolean).slice(0, 5)
              : genres.slice(0, 5);
            if (!pillSrc.length) return null;
            return (
              <div className={s.genrePills} style={{ '--pill-col': col, '--pill-rgb': rgb, marginTop: 8 }}>
                {pillSrc.map(p => <span key={p} className={s.genrePill}>{p}</span>)}
              </div>
            );
          })()}
        </div>

        <div className={s.cards}>
          {/* Tagline */}
          {tagline && (
            <div className={s.tagline} style={{ background: `linear-gradient(135deg,${col},${grad2})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              {tagline}
            </div>
          )}

          {/* Demo mix / sound */}
          {!isHost && !isVenue && (
            mixLink
              ? <>
                  <button className={s.mixBtn} style={{ color: col, borderColor: col, background: `rgba(${rgb},.12)` }}
                    onClick={() => {
                      if (mixLink.includes('soundcloud.com') || mixLink.includes('mixcloud.com')) {
                        if (player?.url === mixLink) { setPlayer(null); } else { setPlayer({ url: mixLink, artistName: profile.name }); }
                      } else {
                        window.open(mixLink, '_blank', 'noopener');
                      }
                    }}>
                    <span dangerouslySetInnerHTML={{ __html: seededWaveSvg(profile.name || '', rgb) }} />
                    <span style={{ position: 'relative', zIndex: 1 }}>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style={{ verticalAlign: 'middle', marginRight: 6 }}><polygon points="6,3 20,12 6,21"/></svg>
                      {player?.url === mixLink ? 'CLOSE PLAYER' : 'PLAY DEMO MIX'}
                    </span>
                  </button>
                </>
              : <div className={s.mixPlaceholder}>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: 5, opacity: .5 }}>
                    <path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
                  </svg>
                  DEMO MIX COMING SOON
                </div>
          )}

          {profile.sound && !isVenue && (
            <div className={s.glassCard} style={{ '--card-col': col, '--card-grad2': grad2 }}>
              <div className={s.glassCardInner} style={{ color: col }}>{profile.sound}</div>
            </div>
          )}

          {/* Genre — non-venue */}
          {genres.length > 0 && !isVenue && (
            <div className={s.glassCard} style={{ '--card-col': col, '--card-grad2': grad2, '--pill-col': col, '--pill-rgb': rgb, cursor: genres.length > 5 ? 'pointer' : 'default' }} onClick={() => genres.length > 5 && setGenreExpanded(e => !e)}>
              <div className={s.cardLabel} style={{ color: col }}>GENRE</div>
              <div className={s.genrePills}>
                {visibleGenres.map(g => <span key={g} className={s.genrePill}>{g}</span>)}
                {!genreExpanded && genres.length > 5 && (
                  <span className={s.genreMore}>+{genres.length - 5} more</span>
                )}
              </div>
            </div>
          )}

          {/* Bio - non-venue only */}
          {profile.bio && !isVenue && (
            <div className={s.glassCard} style={{ '--card-col': col, '--card-grad2': grad2 }}>
              <div className={s.cardLabel} style={{ color: col }}>ABOUT</div>
              <div className={s.bioText}>
                {profile.bio.length <= 150
                  ? profile.bio
                  : bioExpanded
                    ? <>{profile.bio} <span onClick={() => setBioExpanded(false)} style={{ color: 'rgba(255,255,255,.45)', cursor: 'pointer', fontStyle: 'italic', fontSize: 12 }}>see less</span></>
                    : <>{profile.bio.slice(0, 150).trimEnd()}… <span onClick={() => setBioExpanded(true)} style={{ color: 'rgba(255,255,255,.45)', cursor: 'pointer', fontStyle: 'italic', fontSize: 12 }}>see more</span></>
                }
              </div>
            </div>
          )}

          {/* Venue: combined Vibe tags + Sound + Venue Info box */}
          {isVenue && (
            <div className={s.glassCard} style={{ '--card-col': col, '--card-grad2': grad2, '--pill-col': col, '--pill-rgb': rgb, padding: 0, overflow: 'hidden' }}>
              {(() => {
                const vibeTags = profile.card_pills
                  ? profile.card_pills.split(' · ').map(t => t.trim()).filter(Boolean).slice(0, 5)
                  : [];
                if (!vibeTags.length) return null;
                return (
                  <div style={{ padding: '14px 16px' }}>
                    <div className={s.cardLabel} style={{ color: col, marginBottom: 8 }}>VIBE</div>
                    <div className={s.genrePills}>
                      {vibeTags.map(t => <span key={t} className={s.genrePill}>{t}</span>)}
                    </div>
                  </div>
                );
              })()}
              {profile.sound && (
                <>
                  <div style={{ height: 1, background: 'rgba(255,255,255,.06)', margin: '0 16px' }} />
                  <div style={{ padding: '12px 16px', textAlign: 'center', fontStyle: 'italic', fontSize: 15, color: 'rgba(232,232,240,.75)', lineHeight: 1.6 }}>{profile.sound}</div>
                </>
              )}
              <VenueInfoDropdown bare profile={profile} col={col} rgb={rgb} grad2={grad2} socials={socials} />
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <span style={{ flex: 1, display: 'inline-block', padding: 1, borderRadius: 12, background: followed ? col : `linear-gradient(135deg, ${col}, ${grad2})` }}>
                <button
                  className={s.followBtn}
                  style={followed
                    ? { borderColor: 'transparent', color: '#0a0a0f', background: col, width: '100%', margin: 0 }
                    : { borderColor: 'transparent', background: 'rgba(19,19,31,.92)', width: '100%', margin: 0 }}
                  onClick={toggleFollow}
                  disabled={followBusy || !session}
                >
                  {followed ? '✓ FOLLOWING' : <span style={{ backgroundImage: `linear-gradient(135deg, ${col}, ${grad2})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>+ FOLLOW</span>}
                </button>
              </span>
              {isVenue && !isUnclaimed && (
                <span style={{ flex: 1, display: 'inline-block', padding: 1, borderRadius: 12, background: `linear-gradient(135deg, ${col}, ${grad2})` }}>
                  <button
                    className={s.followBtn}
                    style={{ borderColor: 'transparent', background: 'rgba(19,19,31,.92)', width: '100%', margin: 0 }}
                  >
                    <span style={{ backgroundImage: `linear-gradient(135deg, ${col}, ${grad2})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>MESSAGE VENUE</span>
                  </button>
                </span>
              )}
            </div>
            {isVenue && !isUnclaimed && (
              <button
                className={s.followBtn}
                style={{ background: `linear-gradient(135deg, ${col}, ${grad2})`, color: '#0a0a14', borderColor: 'transparent', width: '100%' }}
                onClick={async () => {
                  setAvailOpen(true);
                  if (!availDates) {
                    const today = new Date().toISOString().split('T')[0];
                    // M5: availability keys on profile_id, event overlay on the
                    // attribution column — never the route param.
                    const [availRes, evRes] = await Promise.all([
                      supabase.from('venue_availability').select('available_date').eq('profile_id', profile.id).gte('available_date', today).order('available_date'),
                      supabase.from('events').select('config').eq('venue_profile_id', profile.id).eq('status', 'live'),
                    ]);
                    setAvailDates(new Set((availRes.data || []).map(r => r.available_date)));
                    const evDays = new Set((evRes.data || []).map(e => e.config?.date).filter(Boolean));
                    setEventDates(evDays);
                  }
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8, verticalAlign: 'middle', marginTop: -2 }}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>CHECK AVAILABILITY
              </button>
            )}
          </div>

          {/* Claim this profile — unclaimed profiles only (keyed on the row's
              claim state since M5; claiming is spec §7's manual-review flow) */}
          {isUnclaimed && (
            <div style={{ textAlign: 'center', marginTop: -4, marginBottom: 14 }}>
              {profile.claim_status === 'pending'
                ? <span style={{ fontSize: 12, color: 'rgba(255,255,255,.28)', fontFamily: "'DM Sans', sans-serif", letterSpacing: 0.2 }}>Claim under review</span>
                : <button
                    onClick={() => setClaimOpen(true)}
                    style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.32)', fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", letterSpacing: 0.2, textDecoration: 'underline', textDecorationColor: 'rgba(255,255,255,.15)', padding: '6px 2px' }}
                  >
                    Is this you? Claim this profile
                  </button>
              }
            </div>
          )}

          {/* Events sheet */}
          {(() => {
            const todayStr = new Date().toISOString().split('T')[0];
            const upcoming = events.filter(ev => (ev.config?.date || '9999') >= todayStr).sort((a, b) => (a.config?.date || '').localeCompare(b.config?.date || ''));
            const past     = events.filter(ev => (ev.config?.date || '9999') <  todayStr).sort((a, b) => (b.config?.date || '').localeCompare(a.config?.date || ''));
            const list     = showPast ? filterPastEvents(past, pastGigSearch) : upcoming;
            const showAll  = showPast ? showAllPast : showAllUp;
            const setAll   = showPast ? setShowAllPast : setShowAllUp;
            if (!upcoming.length && !past.length) return null;
            return (
              <div style={{ marginTop: 10, position: 'relative', padding: '30px 0 20px', marginLeft: -16, marginRight: -16, paddingLeft: 16, paddingRight: 16, background: 'linear-gradient(to bottom, transparent 0%, rgba(10,10,20,.7) 20%, rgba(10,10,20,.7) 80%, transparent 100%)' }}>
                {/* Tab pills + see all */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setShowPast(false); setShowAllUp(false); }} style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, padding: '4px 12px', borderRadius: 16, cursor: 'pointer', border: `1px solid ${!showPast ? 'rgba(255,255,255,.4)' : 'var(--border)'}`, background: !showPast ? 'rgba(255,255,255,.1)' : 'none', color: !showPast ? '#fff' : 'rgba(255,255,255,.8)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      UPCOMING GIGS
                      <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 10, background: !showPast ? 'rgba(255,255,255,.2)' : 'var(--card2)', color: '#fff', borderRadius: 8, padding: '1px 6px', letterSpacing: 0 }}>{upcoming.length}</span>
                    </button>
                    {past.length > 0 && <button onClick={() => { setShowPast(true); setShowAllPast(false); }} style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, padding: '4px 12px', borderRadius: 16, cursor: 'pointer', border: `1px solid ${showPast ? 'rgba(255,255,255,.4)' : 'var(--border)'}`, background: showPast ? 'rgba(255,255,255,.1)' : 'none', color: showPast ? '#fff' : 'rgba(255,255,255,.8)' }}>PAST GIGS</button>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ display: 'flex', background: 'var(--card2)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                      {[['portrait', '▦'], ['list', '☰']].map(([v, icon]) => (
                        <button key={v} onClick={() => setGigsView(v)} style={{ background: gigsView === v ? 'rgba(255,255,255,.12)' : 'none', border: 'none', color: gigsView === v ? '#fff' : 'var(--muted)', padding: '5px 10px', cursor: 'pointer', fontSize: 13, lineHeight: 1, transition: 'background .15s, color .15s' }}>{icon}</button>
                      ))}
                    </div>
                    {list.length > 0 && (
                      <span
                        onClick={() => setAll(v => !v)}
                        style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, backgroundImage: `linear-gradient(135deg, ${col}, ${grad2})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', opacity: 0.6, transition: 'opacity .15s' }}
                        onMouseEnter={e => e.currentTarget.style.opacity = 1}
                        onMouseLeave={e => e.currentTarget.style.opacity = 0.6}
                      >{showAll ? 'View less' : 'View all >'}</span>
                    )}
                  </div>
                </div>
                {showPast && past.length > 0 && (
                  <PastEventsSearch query={pastGigSearch} onChange={setPastGigSearch} />
                )}
                {list.length === 0
                  ? <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>{showPast && pastGigSearch.trim() ? 'No past gigs match your search.' : `No ${showPast ? 'past' : 'upcoming'} gigs.`}</p>
                  : gigsView === 'portrait'
                  ? <div style={{ display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }}>
                      {list.map(ev => {
                        const cfg = ev.config || {};
                        const poster = cfg.poster || cfg.posterUrl || '';
                        const genreList = (cfg.genres || '').split(',').map(g => g.trim()).filter(Boolean).slice(0, 2);
                        const dateObj = cfg.date ? new Date(cfg.date + 'T12:00:00') : null;
                        const dateStr = dateObj ? dateObj.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
                        const dateDay = dateObj ? dateObj.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase() : '';
                        const dateNum = dateObj ? dateObj.getDate() : '';
                        const dateMon = dateObj ? dateObj.toLocaleDateString('en-AU', { month: 'short' }).toUpperCase() : '';
                        return (
                          <div key={ev.id} onClick={() => navigate(`/event/${ev.id}`)} style={{ position: 'relative', flexShrink: 0, width: 148, borderRadius: 12, overflow: 'hidden', background: '#0e0e18', cursor: 'pointer', display: 'flex', flexDirection: 'column', transition: 'transform .2s' }}
                            onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-3px)'}
                            onMouseLeave={e => e.currentTarget.style.transform = ''}
                          >
                            {/* Image area */}
                            <div style={{ position: 'relative', height: 155, background: poster ? `url(${poster}) center/cover` : 'linear-gradient(135deg,#1a0533,#2d1b69)', flexShrink: 0 }}>
                              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, background: 'linear-gradient(to bottom, transparent, #0e0e18)' }} />
                              {dateObj && <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(4px)', borderRadius: 8, padding: '4.5px 8px', textAlign: 'center', minWidth: 35 }}>
                                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 11, color: 'rgba(255,255,255,.7)', letterSpacing: .5 }}>{dateDay}</div>
                                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 22, color: '#fff', lineHeight: 1 }}>{dateNum}</div>
                                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 11, color: 'rgba(255,255,255,.7)', letterSpacing: .5 }}>{dateMon}</div>
                              </div>}
                              {(() => { const BADGE_STYLES = { 'Live Music': { bg:'#ff2d78', col:'#fff' }, 'DJs': { bg:'var(--neon2)', col:'#000' }, 'Festival': { bg:'#BF5FFF', col:'#fff' }, 'Comedy': { bg:'#FF8C42', col:'#fff' }, 'Spoken Word': { bg:'#FF8C42', col:'#fff' }, 'Open Mic': { bg:'#FFD700', col:'#000' } }; const bs = BADGE_STYLES[cfg.categoryBadge] || { bg:'#fff', col:'#000' }; let badges = cfg.categoryBadge ? [{ label: cfg.categoryBadge, bg: bs.bg, col: bs.col }] : getEventBadges(cfg.genres || '', ev.name || ''); if (cfg.openMicBadge && !badges.find(b => b.label === 'Open Mic')) { badges = [...badges, { label: 'Open Mic', bg: '#FFD700', col: '#000' }]; } return badges.length > 0 && (
                                <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                  {badges.slice(0,1).map(p => <span key={p.label} style={{ fontFamily: "'DM Sans'", fontSize: 9, fontWeight: 700, letterSpacing: .8, padding: '3px 8px', borderRadius: 6, background: p.bg, color: p.col }}>{p.label}</span>)}
                                </div>
                              ); })()}
                            </div>
                            {/* Info area */}
                            <div style={{ padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                              {(() => {
                                const sep = ev.name.match(/ [–\-] /);
                                if (sep) {
                                  const idx = ev.name.indexOf(sep[0]);
                                  const artist = ev.name.slice(0, idx);
                                  const show = ev.name.slice(idx + sep[0].length);
                                  return <>
                                    <div style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1, color: '#fff', lineHeight: 1.2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>{artist}</div>
                                    <div style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1, color: 'rgba(255,255,255,.55)', lineHeight: 1.2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>{show}</div>
                                  </>;
                                }
                                return <div style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1, color: '#fff', lineHeight: 1.2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{ev.name}</div>;
                              })()}
                              <div style={{ fontSize: 9, color: 'rgba(255,255,255,.45)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 3 }}>
                                <svg xmlns='http://www.w3.org/2000/svg' width='9' height='9' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' style={{ flexShrink: 0 }}><path d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z'/><circle cx='12' cy='10' r='3'/></svg>
                                <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{cfg.venueName || cfg.venue || profile.name}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  : <div style={showAll
                      ? { display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }
                      : { display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4, maxHeight: 315, overflowY: 'scroll', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', maskImage: 'linear-gradient(to bottom, black 75%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, black 75%, transparent 100%)' }
                    }>
                      {list.map(ev => <EventCard key={ev.id} event={ev} onClick={() => navigate(`/event/${ev.id}`)} />)}
                    </div>
                }
              </div>
            );
          })()}
        </div>
      </div>

      {/* Availability modal */}
      {availOpen && (
        <div onClick={() => setAvailOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 'var(--yp-safe-bottom)' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#0f0f1a', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, padding: '24px 20px 100px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <span style={{ fontFamily: "'Bebas Neue'", fontSize: 22, letterSpacing: 2, color: col }}>VENUE AVAILABILITY</span>
              <button onClick={() => setAvailOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 24, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Dates this venue is available for hire.</p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <button onClick={() => setAvailMonth(new Date(availMonth.getFullYear(), availMonth.getMonth() - 1, 1))} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>‹</button>
              <span style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2, color: 'var(--text)' }}>{availMonth.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }).toUpperCase()}</span>
              <button onClick={() => setAvailMonth(new Date(availMonth.getFullYear(), availMonth.getMonth() + 1, 1))} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>›</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 4 }}>
              {['S','M','T','W','T','F','S'].map((d, i) => <div key={i} style={{ textAlign: 'center', fontSize: 10, color: 'var(--muted)', fontFamily: "'Bebas Neue'" }}>{d}</div>)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
              {(() => {
                const todayStr = new Date().toISOString().split('T')[0];
                const yr = availMonth.getFullYear(), mo = availMonth.getMonth();
                const firstDay = new Date(yr, mo, 1).getDay();
                const daysInMonth = new Date(yr, mo + 1, 0).getDate();
                const cells = [];
                for (let i = 0; i < firstDay; i++) cells.push(<div key={`e${i}`} />);
                for (let d = 1; d <= daysInMonth; d++) {
                  const ds = `${yr}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                  const isPast  = ds < todayStr;
                  const hasEvent = eventDates.has(ds);
                  const isAvail = !hasEvent && (availDates ? availDates.has(ds) : false);
                  const isToday = ds === todayStr;
                  cells.push(
                    <div key={ds} onClick={() => !isPast && isAvail && openEnquiry(ds)} style={{
                      textAlign: 'center', padding: '7px 2px 4px', borderRadius: 6, fontSize: 13,
                      background: isAvail ? 'rgba(0,229,160,.18)' : 'rgba(255,255,255,.04)',
                      color: isPast ? 'rgba(255,255,255,.2)' : isAvail ? '#00E5A0' : 'var(--text)',
                      border: isAvail ? '1px solid rgba(0,229,160,.5)' : isToday ? '1px solid rgba(255,255,255,.3)' : '1px solid transparent',
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      cursor: isAvail && !isPast ? 'pointer' : 'default',
                    }}>
                      <span>{d}</span>
                      {hasEvent
                        ? <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#FF2D78', marginTop: 2, display: 'block' }} />
                        : <span style={{ height: 7, display: 'block' }} />
                      }
                    </div>
                  );
                }
                return cells;
              })()}
            </div>
            {availDates === null && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>Loading…</p>}
            {enquiryLoading && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>Loading…</p>}
            {availDates !== null && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 14, height: 14, borderRadius: 3, background: 'rgba(0,229,160,.18)', border: '1px solid rgba(0,229,160,.5)', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: "'Bebas Neue'", letterSpacing: 1 }}>TAP DATE TO ENQUIRE</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#FF2D78', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: "'Bebas Neue'", letterSpacing: 1 }}>EVENT BOOKED</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Follow-from picker — multi-select */}
      {followPickerProfs.length > 0 && (
        <div onClick={() => { setFollowPickerProfs([]); setFollowSelected(new Set()); }} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 'var(--yp-safe-bottom)' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#13131f', borderRadius: '20px 20px 0 0', padding: '24px 20px 32px', maxWidth: 520, width: '100%', margin: '0 auto', maxHeight: '85dvh', overflowY: 'auto', scrollbarWidth: 'none' }}>
            <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.2)', borderRadius: 2, margin: '0 auto 20px' }} />
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 22, letterSpacing: 2, marginBottom: 16, background: `linear-gradient(135deg,${col},${grad2})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', display: 'inline-block' }}>FOLLOW {profile.name.toUpperCase()}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>Select which profiles to follow from, you can pick more than one.</div>
            {followPickerProfs.map((p, i) => {
              const tc = { artist: { col: '#00E5FF', rgb: '0,229,255' }, host: { col: '#FF2D78', rgb: '255,45,120' }, band: { col: '#FF8C42', rgb: '255,140,66' }, standup: { col: '#FF88AA', rgb: '255,136,170' }, venue: { col: '#00E5A0', rgb: '0,229,160' }, punter: { col: '#BF5FFF', rgb: '191,95,255' } }[p.type] || { col: '#BF5FFF', rgb: '191,95,255' };
              const key = p.type;
              const checked = followSelected.has(key);
              const toggle = () => setFollowSelected(prev => { const s = new Set(prev); checked ? s.delete(key) : s.add(key); return s; });
              const MySceneSVG = <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16.051 12.616a1 1 0 0 1 1.909.024l.737 1.452a1 1 0 0 0 .737.535l1.634.256a1 1 0 0 1 .588 1.806l-1.172 1.168a1 1 0 0 0-.282.866l.259 1.613a1 1 0 0 1-1.541 1.134l-1.465-.75a1 1 0 0 0-.912 0l-1.465.75a1 1 0 0 1-1.539-1.133l.258-1.613a1 1 0 0 0-.282-.866l-1.156-1.153a1 1 0 0 1 .572-1.822l1.633-.256a1 1 0 0 0 .737-.535z"/><path d="M8 15H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/></svg>;
              return (
                <button key={i} onClick={toggle} style={{ width: '100%', display: 'flex', gap: 12, alignItems: 'center', background: checked ? `rgba(${tc.rgb},.1)` : `rgba(${tc.rgb},.04)`, border: `1px solid ${checked ? tc.col : `rgba(${tc.rgb},.2)`}`, borderRadius: 12, padding: 12, cursor: 'pointer', textAlign: 'left', marginBottom: 8, transition: 'all .15s' }}>
                  {p.avatar
                    ? <img src={p.avatar} style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', border: `1.5px solid rgba(${tc.rgb},.5)`, flexShrink: 0 }} alt={p.name} />
                    : <div style={{ width: 44, height: 44, borderRadius: 8, background: `rgba(${tc.rgb},.12)`, border: `1.5px solid rgba(${tc.rgb},.3)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: tc.col }}>{p.type === 'punter' ? MySceneSVG : '🎵'}</div>
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: tc.col, marginBottom: 2 }}>{p.label}</div>
                    <div style={{ fontFamily: "'Bebas Neue'", fontSize: 16, letterSpacing: .5, color: '#e8e8f0' }}>{p.name}</div>
                    {(p.genre_string || p.sound) && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{(p.genre_string || p.sound).split(' · ').slice(0,3).join(' · ')}</div>}
                  </div>
                  <div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${checked ? tc.col : 'rgba(255,255,255,.2)'}`, background: checked ? tc.col : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
                    {checked && <svg width="12" height="12" viewBox="0 0 12 12"><polyline points="2,6 5,9 10,3" fill="none" stroke="#0a0a14" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                </button>
              );
            })}
            <button
              onClick={() => followSelected.size > 0 && doFollow([...followSelected])}
              disabled={followSelected.size === 0}
              style={{ width: '100%', fontFamily: "'Bebas Neue'", fontSize: 15, letterSpacing: 2, padding: '13px', borderRadius: 12, border: 'none', background: followSelected.size > 0 ? `linear-gradient(135deg,${col},${grad2})` : 'rgba(255,255,255,.08)', color: followSelected.size > 0 ? '#0a0a14' : 'rgba(255,255,255,.3)', cursor: followSelected.size > 0 ? 'pointer' : 'not-allowed', marginTop: 4, transition: 'all .15s' }}
            >FOLLOW{followSelected.size > 1 ? ` FROM ${followSelected.size} PROFILES` : ''}</button>
            <button onClick={() => { setFollowPickerProfs([]); setFollowSelected(new Set()); }} style={{ marginTop: 8, width: '100%', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer', padding: 8 }}>Cancel</button>
          </div>
        </div>
      )}

      {pickerDate && pickerProfs.length > 0 && (
        <div onClick={() => { setPickerDate(null); setPickerProfs([]); }} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 'var(--yp-safe-bottom)' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#13131f', borderRadius: '20px 20px 0 0', padding: '24px 20px 36px', maxWidth: 520, width: '100%', margin: '0 auto', maxHeight: '85dvh', overflowY: 'auto' }}>
            <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.2)', borderRadius: 2, margin: '0 auto 20px' }} />
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 2, color: col, marginBottom: 4 }}>ENQUIRING ABOUT</div>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 1, marginBottom: 4 }}>{new Date(pickerDate + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>Who are you enquiring as?</div>
            {pickerProfs.map((p, i) => {
              const tc = { artist: { col: '#00E5FF', rgb: '0,229,255' }, host: { col: '#FF2D78', rgb: '255,45,120' }, band: { col: '#FF8C42', rgb: '255,140,66' }, standup: { col: '#FF88AA', rgb: '255,136,170' } }[p.type] || { col: '#00E5A0', rgb: '0,229,160' };
              return (
                <button key={i} onClick={() => { setEnquiryProf(p); setPickerProfs([]); }} style={{ width: '100%', display: 'flex', gap: 12, alignItems: 'center', background: `rgba(${tc.rgb},.06)`, border: `1px solid rgba(${tc.rgb},.25)`, borderRadius: 12, padding: 12, cursor: 'pointer', textAlign: 'left', marginBottom: 8 }}>
                  {p.avatar
                    ? <img src={p.avatar} style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', border: `1.5px solid rgba(${tc.rgb},.5)`, flexShrink: 0 }} alt={p.name} />
                    : <div style={{ width: 44, height: 44, borderRadius: 8, background: `rgba(${tc.rgb},.12)`, border: `1.5px solid rgba(${tc.rgb},.3)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 18 }}>🎵</div>
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: tc.col, marginBottom: 2 }}>{p.label}</div>
                    <div style={{ fontFamily: "'Bebas Neue'", fontSize: 16, letterSpacing: .5, color: '#e8e8f0' }}>{p.name}</div>
                    {p.genre_string && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{p.genre_string.split(' · ').slice(0,3).join(' · ')}</div>}
                  </div>
                  <div style={{ color: tc.col, fontSize: 18 }}>›</div>
                </button>
              );
            })}
            <button onClick={() => { setPickerDate(null); setPickerProfs([]); }} style={{ marginTop: 4, width: '100%', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer', padding: 8 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Enquiry sheet */}
      {enquiryProf && pickerDate && (
        <div onClick={() => { setEnquiryProf(null); setEnquiryNote(''); }} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 'var(--yp-safe-bottom)' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#13131f', borderRadius: '20px 20px 0 0', padding: '24px 20px 36px', maxWidth: 520, width: '100%', margin: '0 auto', maxHeight: '85dvh', overflowY: 'auto' }}>
            <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.2)', borderRadius: 2, margin: '0 auto 20px' }} />
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 2, color: col, marginBottom: 4 }}>ENQUIRE ABOUT THIS DATE</div>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 20, letterSpacing: 1, marginBottom: 16 }}>{new Date(pickerDate + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()}</div>
            {/* Profile preview */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'rgba(255,255,255,.05)', border: `1px solid rgba(${rgb},.25)`, borderRadius: 12, padding: 12, marginBottom: 16 }}>
              {enquiryProf.avatar
                ? <img src={enquiryProf.avatar} style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', border: `2px solid ${col}`, flexShrink: 0 }} alt={enquiryProf.name} />
                : <div style={{ width: 48, height: 48, borderRadius: 8, background: `rgba(${rgb},.12)`, border: `2px solid rgba(${rgb},.4)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 20 }}>🎵</div>
              }
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 17, letterSpacing: 1 }}>{enquiryProf.name}</div>
                {enquiryProf.location && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{enquiryProf.location}</div>}
                {enquiryProf.genre_string && <div style={{ fontSize: 11, color: col, marginTop: 2 }}>{enquiryProf.genre_string.split(' · ').slice(0,3).join(' · ')}</div>}
              </div>
            </div>
            <textarea
              value={enquiryNote}
              onChange={e => setEnquiryNote(e.target.value)}
              placeholder="Add a message — anything extra the venue should know…"
              style={{ width: '100%', minHeight: 90, background: 'rgba(255,255,255,.06)', border: `1px solid rgba(${rgb},.35)`, borderRadius: 12, color: '#e8e8f0', fontSize: 14, padding: 12, resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
            <button
              onClick={sendEnquiry}
              disabled={enquirySending}
              style={{ marginTop: 12, width: '100%', background: `linear-gradient(135deg,${col},${grad2})`, color: '#0a0a14', fontFamily: "'Bebas Neue'", fontSize: 17, letterSpacing: 2, padding: 16, border: 'none', borderRadius: 12, cursor: 'pointer', opacity: enquirySending ? .6 : 1 }}
            >{enquirySending ? 'SENDING…' : 'SEND ENQUIRY →'}</button>
            <button onClick={() => { setEnquiryProf(null); setEnquiryNote(''); }} style={{ marginTop: 8, width: '100%', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer', padding: 8 }}>Cancel</button>
          </div>
        </div>
      )}

      <ClaimDialog
        open={claimOpen}
        onClose={() => setClaimOpen(false)}
        profile={profile}
        session={session}
      />
    </div>
  );
}

function VenueInfoDropdown({ profile, col, rgb, grad2, bare = false, socials = [] }) {
  const [open, setOpen] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);
  const entertain  = profile.genre_string  ? profile.genre_string.split(/\s*·\s*|,\s*/).map(g => g.trim()).filter(Boolean) : [];
  const tech       = Array.isArray(profile.tech_features) ? profile.tech_features : (profile.tech_features ? String(profile.tech_features).split(',').map(t => t.trim()) : []);
  const nights     = Array.isArray(profile.live_nights)   ? profile.live_nights   : (profile.live_nights   ? String(profile.live_nights).split(',').map(d => d.trim())   : []);
  const atmosphere = profile.atmosphere  ? profile.atmosphere.split(',').map(t => t.trim()).filter(Boolean) : [];
  const perfectFor = profile.perfect_for ? profile.perfect_for.split(',').map(t => t.trim()).filter(Boolean) : [];
  const hasInfo    = profile.venue_type || profile.capacity || entertain.length || atmosphere.length || perfectFor.length || tech.length || nights.length || profile.stage_dims;
  if (!hasInfo) return null;

  const rowStyle   = { display: 'flex', gap: 8, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.05)' };
  const labelStyle = { fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: 'var(--muted)', minWidth: 90, paddingTop: 3, flexShrink: 0 };

  const inner = (
    <>
      <div style={{ borderTop: '1px solid rgba(255,255,255,.06)' }}>
        <button
          onClick={() => setOpen(o => !o)}
          style={{ width: '100%', background: 'none', border: 'none', padding: '12px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 2, color: col }}>VENUE INFO</span>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 12, color: col }}>{open ? '▲' : '▼'}</span>
        </button>
      </div>
      {open && (
        <div style={{ padding: '0 16px 14px', borderTop: '1px solid rgba(255,255,255,.06)' }}>
          {profile.venue_type && (
            <div style={rowStyle}>
              <div style={labelStyle}>VENUE TYPE</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', flex: 1 }}>{profile.venue_type}</div>
            </div>
          )}
          {profile.capacity && (
            <div style={rowStyle}>
              <div style={labelStyle}>CAPACITY</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', flex: 1 }}>{profile.capacity}</div>
            </div>
          )}
          {atmosphere.length > 0 && (
            <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
              <div style={labelStyle}>ATMOSPHERE</div>
              <div className={s.genrePills} style={{ '--pill-col': col, '--pill-rgb': rgb, flex: 1 }}>
                {atmosphere.map(t => <span key={t} className={s.genrePill}>{t}</span>)}
              </div>
            </div>
          )}
          {entertain.length > 0 && (
            <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
              <div style={labelStyle}>WE BOOK</div>
              <div className={s.genrePills} style={{ '--pill-col': col, '--pill-rgb': rgb, flex: 1 }}>
                {entertain.map(t => <span key={t} className={s.genrePill}>{t}</span>)}
              </div>
            </div>
          )}
          {perfectFor.length > 0 && (
            <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
              <div style={labelStyle}>PERFECT FOR</div>
              <div className={s.genrePills} style={{ '--pill-col': col, '--pill-rgb': rgb, flex: 1 }}>
                {perfectFor.map(t => <span key={t} className={s.genrePill}>{t}</span>)}
              </div>
            </div>
          )}
          {profile.bio && (
            <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
              <div style={labelStyle}>ABOUT</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', flex: 1, lineHeight: 1.6 }}>
                {profile.bio.length <= 150
                  ? profile.bio
                  : bioExpanded
                    ? <>{profile.bio} <span onClick={() => setBioExpanded(false)} style={{ color: 'rgba(255,255,255,.45)', cursor: 'pointer', fontStyle: 'italic', fontSize: 12 }}>see less</span></>
                    : <>{profile.bio.slice(0, 150).trimEnd()}… <span onClick={() => setBioExpanded(true)} style={{ color: 'rgba(255,255,255,.45)', cursor: 'pointer', fontStyle: 'italic', fontSize: 12 }}>see more</span></>
                }
              </div>
            </div>
          )}
          {tech.length > 0 && (
            <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
              <div style={labelStyle}>STAGE & TECH</div>
              <div style={{ flex: 1 }}>
                <div className={s.genrePills} style={{ '--pill-col': col, '--pill-rgb': rgb }}>
                  {tech.map(t => <span key={t} className={s.genrePill}>{t}</span>)}
                </div>
                {profile.stage_dims && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}><span style={{ fontFamily: "'Bebas Neue'", letterSpacing: 1.5, fontSize: 11 }}>STAGE</span> — {profile.stage_dims}</div>}
              </div>
            </div>
          )}
          {nights.length > 0 && (
            <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
              <div style={labelStyle}>LIVE NIGHTS</div>
              <div className={s.genrePills} style={{ '--pill-col': col, '--pill-rgb': rgb, flex: 1 }}>
                {nights.map(t => <span key={t} className={s.genrePill}>{t}</span>)}
              </div>
            </div>
          )}
          {socials.length > 0 && (
            <div style={{ ...rowStyle, alignItems: 'center', borderBottom: 'none' }}>
              <div style={labelStyle}>SOCIALS / LINKS</div>
              <div style={{ display: 'flex', gap: 12, flex: 1 }}>
                {socials.map((sc, i) => (
                  <a key={i} href={sc.href} target="_blank" rel="noopener noreferrer" style={{ color: sc.col, opacity: .85, transition: 'opacity .15s', display: 'flex', alignItems: 'center' }} onMouseEnter={e => e.currentTarget.style.opacity=1} onMouseLeave={e => e.currentTarget.style.opacity='.85'}>
                    <SocialSvg icon={sc.icon} />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );

  if (bare) return inner;

  return (
    <div className={s.glassCard} style={{ '--card-col': col, '--card-grad2': grad2, padding: 0, marginBottom: 12, overflow: 'hidden' }}>
      {inner}
    </div>
  );
}

function seededWaveSvg(name, rgb) {
  let s = name.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0x9e3779b9);
  const rng = () => { s = (s ^ (s << 13)) | 0; s = (s ^ (s >>> 17)) | 0; s = (s ^ (s << 5)) | 0; return (s >>> 0) / 0xffffffff; };
  const N = 32, W = 300, H = 40, bW = (W / N) * 0.55;
  const bars = Array.from({ length: N }, (_, i) => {
    const h = 4 + rng() * (H - 8);
    const x = (i / N) * W + (W / N) * 0.225;
    const y = (H - h) / 2;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bW.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:50%;transform:translateX(-50%);width:38%;height:100%;opacity:.32;mask-image:linear-gradient(to right,black 0%,transparent 35%,transparent 65%,black 100%);-webkit-mask-image:linear-gradient(to right,black 0%,transparent 35%,transparent 65%,black 100%);" fill="rgba(${rgb},1)">${bars}</svg>`;
}

function SocialSvg({ icon }) {
  switch (icon) {
    case 'instagram': return <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg>;
    case 'facebook':  return <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>;
    case 'youtube':   return <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/></svg>;
    case 'soundcloud':return <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 13.5A3.5 3.5 0 0 0 5.5 17h11a3 3 0 0 0 .5-5.965V11a5 5 0 0 0-9.3-2.5"/><path d="M5 11.5v1M7 10v3M9 9.5v4"/></svg>;
    case 'mixcloud':  return <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>;
    case 'email':     return <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>;
    default:          return <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>;
  }
}
