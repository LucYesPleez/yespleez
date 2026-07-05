import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import EventCard from '../components/EventCard';
import MiniPlayer from '../components/MiniPlayer';
import s from './ProfileScreen.module.css';

const TYPE_ACCENTS = {
  host:    { col: '#FF3399',      rgb: '255,51,153',  label: 'HOST / PROMOTER',     grad2: '#BF5FFF' },
  artist:  { col: 'var(--neon2)', rgb: '0,229,255',   label: 'DJ / PRODUCER',       grad2: '#BF5FFF' },
  band:    { col: '#FF8C42',      rgb: '255,140,66',  label: 'BAND / MUSO',         grad2: '#FF5500' },
  standup: { col: '#FF88AA',      rgb: '255,136,170', label: 'STAND-UP / COMEDY',   grad2: '#BF5FFF' },
  venue:   { col: '#00E5A0',      rgb: '0,229,160',   label: 'VENUE',               grad2: '#00E5FF' },
};

const OLD_CATS = new Set(['ELECTRONIC','BANDS','SPOKEN','SPOKEN WORD','RAVE','FESTIVAL']);

export default function ProfileScreen() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const { session } = useSession();
  const [searchParams] = useSearchParams();
  const typeFilter = searchParams.get('type');
  const [genreExpanded, setGenreExpanded] = useState(false);
  const [followed,    setFollowed]    = useState(false);
  const [followBusy,  setFollowBusy]  = useState(false);
  const [playerOpen,  setPlayerOpen]  = useState(false);
  const [availOpen,     setAvailOpen]     = useState(false);
  const [availDates,    setAvailDates]    = useState(null);
  const [eventDates,    setEventDates]    = useState(new Set());
  const [availMonth,    setAvailMonth]    = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [showPast,      setShowPast]      = useState(false);
  const [showAllUp,     setShowAllUp]     = useState(false);
  const [showAllPast,   setShowAllPast]   = useState(false);
  const [pickerDate,    setPickerDate]    = useState(null);
  const [pickerProfs,   setPickerProfs]   = useState([]);
  const [enquiryProf,   setEnquiryProf]   = useState(null);
  const [enquiryNote,   setEnquiryNote]   = useState('');
  const [enquirySending,setEnquirySending]= useState(false);
  const [enquiryLoading,setEnquiryLoading]= useState(false);

  const { data, isLoading: loading } = useQuery({
    queryKey: ['profile', id, typeFilter],
    queryFn: async () => {
      let q = supabase.from('profiles').select('*').eq('user_id', id);
      if (typeFilter) q = q.eq('type', typeFilter);
      else q = q.neq('type', 'punter');
      const pRes = await q.limit(1);
      const profile = pRes.data?.[0] || null;

      let events = [];
      if (profile?.type === 'venue') {
        // Venue events linked via host_id — fetch live + completed for past gigs
        const eRes = await supabase.from('events').select('id,name,config').eq('host_id', id).in('status', ['live','completed']).order('created_at', { ascending: false }).limit(100);
        events = eRes.data || [];
      } else {
        // Artist/band/etc appearances via claims table
        const claimsRes = await supabase.from('claims').select('event_id').eq('user_id', id);
        const eventIds = [...new Set((claimsRes.data || []).map(c => c.event_id).filter(Boolean))];
        if (eventIds.length) {
          const eRes = await supabase.from('events').select('id,name,config').in('id', eventIds).order('id', { ascending: true }).limit(10);
          events = eRes.data || [];
        }
      }
      return { profile, events };
    },
    enabled: !!id,
  });

  const profile = data?.profile || null;
  const events  = data?.events  || [];

  // Load follow state once profile is known
  useEffect(() => {
    if (!id || !session?.user?.id) return;
    supabase.from('follows').select('id').eq('user_id', session.user.id).eq('entity_id', id).maybeSingle()
      .then(({ data: fol }) => setFollowed(!!fol));
  }, [id, session?.user?.id]);

  async function openEnquiry(dateStr) {
    if (!session?.user?.id) return;
    setEnquiryLoading(true);
    const { data: profs } = await supabase.from('profiles')
      .select('user_id, type, name, avatar, location, genre_string, sound')
      .eq('user_id', session.user.id)
      .neq('type', 'punter').neq('type', 'venue');
    if (!profs?.length) return;
    const TYPE_LABEL = { artist: 'DJ / PRODUCER', host: 'PROMOTER', band: 'BAND', standup: 'STAND-UP' };
    const mapped = profs.map(p => ({ ...p, label: TYPE_LABEL[p.type] || p.type.toUpperCase() }));
    setEnquiryLoading(false);
    setPickerDate(dateStr);
    if (mapped.length === 1) { setEnquiryProf(mapped[0]); setPickerProfs([]); }
    else { setPickerProfs(mapped); setEnquiryProf(null); }
  }

  async function sendEnquiry() {
    if (!enquiryProf || !pickerDate || enquirySending) return;
    setEnquirySending(true);
    const { error } = await supabase.from('venue_enquiries').insert({
      venue_user_id:     id,
      applicant_user_id: session.user.id,
      applicant_type:    enquiryProf.type,
      date_requested:    pickerDate,
      note:              enquiryNote.trim() || null,
      status:            'pending',
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
    setFollowBusy(true);
    if (followed) {
      await supabase.from('follows').delete().eq('user_id', session.user.id).eq('entity_id', id);
      setFollowed(false);
    } else {
      await supabase.from('follows').insert({ user_id: session.user.id, entity_id: id, entity_type: 'profile', entity_name: profile.name });
      setFollowed(true);
    }
    setFollowBusy(false);
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
  const label   = isVenue ? ta.label : (profile.band_type || profile.act_type || ta.label);
  const loc     = [profile.location, profile.state].filter(Boolean).join(', ');
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
  const socials = [
    !na(profile.instagram) && { href: `https://instagram.com/${igHandle(profile.instagram)}`, col: '#E1306C', icon: 'instagram' },
    !na(profile.facebook)  && { href: fbUrl(profile.facebook), col: '#1877F2', icon: 'facebook' },
    !na(profile.youtube)   && { href: profile.youtube?.startsWith('http') ? profile.youtube : 'https://'+profile.youtube, col: '#FF0000', icon: 'youtube' },
    !na(profile.soundcloud) && { href: profile.soundcloud.startsWith('http') ? profile.soundcloud : 'https://'+profile.soundcloud, col: '#FF5500', icon: 'soundcloud' },
    !na(profile.mixcloud)  && { href: profile.mixcloud.startsWith('http') ? profile.mixcloud : 'https://'+profile.mixcloud, col: '#52aad8', icon: 'mixcloud' },
    !na(profile.website)   && { href: profile.website?.startsWith('http') ? profile.website : 'https://'+profile.website, col: 'var(--neon2)', icon: 'globe' },
  ].filter(Boolean);

  return (
    <div className={s.screen}>
      {/* Fixed blurred background */}
      <div
        className={s.heroBg}
        style={profile.avatar
          ? { backgroundImage: `url(${profile.avatar})`, filter: 'blur(28px)' }
          : { background: `linear-gradient(135deg, rgba(255,45,120,.9) 0%, rgba(180,0,200,.7) 40%, rgba(0,229,255,.8) 100%)` }
        }
      />

      {/* Actual hero photo */}
      {profile.avatar && (
        <div className={s.heroImg} style={{ backgroundImage: `url(${profile.avatar})` }} />
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
            {loc && (
              <span className={s.location}>
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: 2 }}>
                  <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
                {loc}
              </span>
            )}
            {(profile.years || profile.established_year) && <span className={s.est}>EST. {profile.years || profile.established_year}</span>}
          </div>
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
                        setPlayerOpen(v => !v);
                      } else {
                        window.open(mixLink, '_blank', 'noopener');
                      }
                    }}>
                    <span dangerouslySetInnerHTML={{ __html: seededWaveSvg(profile.name || '', rgb) }} />
                    <span style={{ position: 'relative', zIndex: 1 }}>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style={{ verticalAlign: 'middle', marginRight: 6 }}><polygon points="6,3 20,12 6,21"/></svg>
                      {playerOpen ? 'CLOSE PLAYER' : 'PLAY DEMO MIX'}
                    </span>
                  </button>
                  {playerOpen && (mixLink.includes('soundcloud.com') || mixLink.includes('mixcloud.com')) && (
                    <MiniPlayer url={mixLink} artistName={profile.name} onClose={() => setPlayerOpen(false)} />
                  )}
                </>
              : <div className={s.mixPlaceholder}>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: 5, opacity: .5 }}>
                    <path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
                  </svg>
                  DEMO MIX COMING SOON
                </div>
          )}

          {/* Sound */}
          {profile.sound && (
            <div className={s.glassCard} style={{ '--card-col': col, '--card-grad2': grad2 }}>
              <div className={s.glassCardInner}>{profile.sound}</div>
            </div>
          )}

          {/* Genre */}
          {genres.length > 0 && (
            <div className={s.glassCard} style={{ '--card-col': col, '--card-grad2': grad2, cursor: genres.length > 5 ? 'pointer' : 'default' }} onClick={() => genres.length > 5 && setGenreExpanded(e => !e)}>
              <div className={s.cardLabel} style={{ color: col }}>GENRE</div>
              <div className={s.genrePills}>
                {visibleGenres.map(g => <span key={g} className={s.genrePill}>{g}</span>)}
                {!genreExpanded && genres.length > 5 && (
                  <span className={s.genreMore}>+{genres.length - 5} more</span>
                )}
              </div>
            </div>
          )}

          {/* Bio */}
          {profile.bio && (
            <div className={s.glassCard} style={{ '--card-col': col, '--card-grad2': grad2 }}>
              <div className={s.cardLabel} style={{ color: col }}>ABOUT</div>
              <div className={s.bioText}>{profile.bio}</div>
            </div>
          )}

          {/* Venue-specific info — collapsible dropdown */}
          {isVenue && <VenueInfoDropdown profile={profile} col={col} rgb={rgb} grad2={grad2} />}

          {/* Follow row */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className={s.followBtn}
              style={followed
                ? { borderColor: col, color: '#0a0a0f', background: col, flex: 1 }
                : { borderColor: `rgba(${rgb},.35)`, color: col, flex: 1 }}
              onClick={toggleFollow}
              disabled={followBusy || !session}
            >
              {followed ? '✓ FOLLOWING' : '+ FOLLOW'}
            </button>
            {isVenue && (
              <button
                className={s.followBtn}
                style={{ borderColor: `rgba(${rgb},.35)`, color: col, flex: 1 }}
                onClick={async () => {
                  setAvailOpen(true);
                  if (!availDates) {
                    const today = new Date().toISOString().split('T')[0];
                    const [availRes, evRes] = await Promise.all([
                      supabase.from('venue_availability').select('available_date').eq('user_id', id).gte('available_date', today).order('available_date'),
                      supabase.from('events').select('config').eq('host_id', id).eq('status', 'live'),
                    ]);
                    setAvailDates(new Set((availRes.data || []).map(r => r.available_date)));
                    const evDays = new Set((evRes.data || []).map(e => e.config?.date).filter(Boolean));
                    setEventDates(evDays);
                  }
                }}
              >
                CHECK AVAILABILITY
              </button>
            )}
          </div>

          {/* Social icons */}
          {socials.length > 0 && (
            <div className={s.socials}>
              {socials.map((sc, i) => (
                <a key={i} href={sc.href} target="_blank" rel="noopener noreferrer" className={s.socialIcon} style={{ color: sc.col }}>
                  <SocialSvg icon={sc.icon} />
                </a>
              ))}
            </div>
          )}

          {/* Events */}
          {(() => {
            const todayStr = new Date().toISOString().split('T')[0];
            const upcoming = events.filter(ev => (ev.config?.date || '9999') >= todayStr).sort((a, b) => (a.config?.date || '').localeCompare(b.config?.date || ''));
            const past     = events.filter(ev => (ev.config?.date || '9999') <  todayStr).sort((a, b) => (b.config?.date || '').localeCompare(a.config?.date || ''));
            const list     = showPast ? past : upcoming;
            const showAll  = showPast ? showAllPast : showAllUp;
            const setAll   = showPast ? setShowAllPast : setShowAllUp;
            if (!upcoming.length && !past.length) return null;
            return (
              <div className={s.eventsSection}>
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setShowPast(false); setShowAllUp(false); }} style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, padding: '4px 12px', borderRadius: 16, cursor: 'pointer', border: `1px solid ${!showPast ? col : 'var(--border)'}`, background: !showPast ? `rgba(${rgb},.15)` : 'none', color: !showPast ? col : 'var(--muted)' }}>UPCOMING GIGS</button>
                    {past.length > 0 && <button onClick={() => { setShowPast(true); setShowAllPast(false); }} style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, padding: '4px 12px', borderRadius: 16, cursor: 'pointer', border: `1px solid ${showPast ? col : 'var(--border)'}`, background: showPast ? `rgba(${rgb},.15)` : 'none', color: showPast ? col : 'var(--muted)' }}>PAST GIGS</button>}
                  </div>
                  {list.length > 0 && (
                    <button onClick={() => setAll(v => !v)} style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1, color: col, background: 'none', border: `1px solid rgba(${rgb},.35)`, borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>{showAll ? 'SEE LESS' : 'SEE ALL'}</button>
                  )}
                </div>
                {list.length === 0
                  ? <p style={{ fontSize: 13, color: 'var(--muted)' }}>No {showPast ? 'past' : 'upcoming'} gigs.</p>
                  : <div style={showAll ? { display: 'flex', flexDirection: 'column', gap: 6 } : { maxHeight: 980, overflowY: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {list.map(ev => <EventCard key={ev.id} event={ev} />)}
                    </div>
                }
              </div>
            );
          })()}
        </div>
      </div>

      {/* Availability modal */}
      {availOpen && (
        <div onClick={() => setAvailOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#0f0f1a', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, padding: '24px 20px 100px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <span style={{ fontFamily: "'Bebas Neue'", fontSize: 22, letterSpacing: 2, color: '#00E5A0' }}>VENUE AVAILABILITY</span>
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

      {/* Profile picker sheet */}
      {pickerDate && pickerProfs.length > 0 && (
        <div onClick={() => { setPickerDate(null); setPickerProfs([]); }} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#13131f', borderRadius: '20px 20px 0 0', padding: '24px 20px 36px', maxWidth: 520, width: '100%', margin: '0 auto', maxHeight: '85dvh', overflowY: 'auto' }}>
            <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.2)', borderRadius: 2, margin: '0 auto 20px' }} />
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 2, color: '#00E5A0', marginBottom: 4 }}>ENQUIRING ABOUT</div>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 1, marginBottom: 4 }}>{new Date(pickerDate + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>Who are you enquiring as?</div>
            {pickerProfs.map((p, i) => {
              const tc = { artist: { col: 'var(--neon2)', rgb: '0,229,255' }, host: { col: '#FF3399', rgb: '255,51,153' }, band: { col: '#FF8C42', rgb: '255,140,66' }, standup: { col: '#FF88AA', rgb: '255,136,170' } }[p.type] || { col: '#00E5A0', rgb: '0,229,160' };
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
        <div onClick={() => { setEnquiryProf(null); setEnquiryNote(''); }} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#13131f', borderRadius: '20px 20px 0 0', padding: '24px 20px 36px', maxWidth: 520, width: '100%', margin: '0 auto', maxHeight: '85dvh', overflowY: 'auto' }}>
            <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.2)', borderRadius: 2, margin: '0 auto 20px' }} />
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 2, color: '#00E5A0', marginBottom: 4 }}>ENQUIRE ABOUT THIS DATE</div>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 20, letterSpacing: 1, marginBottom: 16 }}>{new Date(pickerDate + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()}</div>
            {/* Profile preview */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(0,229,160,.25)', borderRadius: 12, padding: 12, marginBottom: 16 }}>
              {enquiryProf.avatar
                ? <img src={enquiryProf.avatar} style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', border: '2px solid #00E5A0', flexShrink: 0 }} alt={enquiryProf.name} />
                : <div style={{ width: 48, height: 48, borderRadius: 8, background: 'rgba(0,229,160,.12)', border: '2px solid rgba(0,229,160,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 20 }}>🎵</div>
              }
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 17, letterSpacing: 1 }}>{enquiryProf.name}</div>
                {enquiryProf.location && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{enquiryProf.location}</div>}
                {enquiryProf.genre_string && <div style={{ fontSize: 11, color: '#00E5A0', marginTop: 2 }}>{enquiryProf.genre_string.split(' · ').slice(0,3).join(' · ')}</div>}
              </div>
            </div>
            <textarea
              value={enquiryNote}
              onChange={e => setEnquiryNote(e.target.value)}
              placeholder="Add a message — anything extra the venue should know…"
              style={{ width: '100%', minHeight: 90, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(0,229,160,.35)', borderRadius: 12, color: '#e8e8f0', fontSize: 14, padding: 12, resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
            <button
              onClick={sendEnquiry}
              disabled={enquirySending}
              style={{ marginTop: 12, width: '100%', background: 'linear-gradient(135deg,#00E5A0,#00B4D8)', color: '#0a0a14', fontFamily: "'Bebas Neue'", fontSize: 17, letterSpacing: 2, padding: 16, border: 'none', borderRadius: 12, cursor: 'pointer', opacity: enquirySending ? .6 : 1 }}
            >{enquirySending ? 'SENDING…' : 'SEND ENQUIRY →'}</button>
            <button onClick={() => { setEnquiryProf(null); setEnquiryNote(''); }} style={{ marginTop: 8, width: '100%', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer', padding: 8 }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function VenueInfoDropdown({ profile, col, rgb, grad2 }) {
  const [open, setOpen] = useState(false);
  const entertain = profile.genre_string ? profile.genre_string.split(/\s*·\s*|,\s*/).map(g => g.trim()).filter(Boolean) : [];
  const tech      = Array.isArray(profile.tech_features) ? profile.tech_features : (profile.tech_features ? String(profile.tech_features).split(',').map(t => t.trim()) : []);
  const nights    = Array.isArray(profile.live_nights)   ? profile.live_nights   : (profile.live_nights   ? String(profile.live_nights).split(',').map(d => d.trim())   : []);
  const hasInfo   = profile.venue_type || profile.capacity || entertain.length || tech.length || nights.length || profile.stage_dims;
  if (!hasInfo) return null;

  const rowStyle  = { display: 'flex', gap: 8, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.05)' };
  const labelStyle = { fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: 'var(--muted)', minWidth: 90, paddingTop: 3, flexShrink: 0 };

  return (
    <div className={s.glassCard} style={{ '--card-col': col, '--card-grad2': grad2, padding: 0, marginBottom: 12, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', background: 'none', border: 'none', fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 2, color: col, padding: '14px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <span>VENUE INFO</span>
        <span style={{ fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </button>
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
          {entertain.length > 0 && (
            <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
              <div style={labelStyle}>WE BOOK</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', flex: 1, lineHeight: 1.6 }}>{entertain.join(', ')}</div>
            </div>
          )}
          {tech.length > 0 && (
            <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
              <div style={labelStyle}>STAGE & TECH</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>{tech.join(', ')}</div>
                {profile.stage_dims && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}><span style={{ fontFamily: "'Bebas Neue'", letterSpacing: 1.5, fontSize: 11 }}>STAGE</span> — {profile.stage_dims}</div>}
              </div>
            </div>
          )}
          {nights.length > 0 && (
            <div style={{ ...rowStyle, alignItems: 'flex-start', borderBottom: 'none' }}>
              <div style={labelStyle}>LIVE NIGHTS</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', flex: 1, lineHeight: 1.6 }}>{nights.join(', ')}</div>
            </div>
          )}
        </div>
      )}
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
    default:          return <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>;
  }
}
