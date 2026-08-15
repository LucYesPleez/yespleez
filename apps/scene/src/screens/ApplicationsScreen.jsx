import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { writeNotification } from '../lib/writeNotification';
import { resolvePerformerProfileId } from '../lib/actingProfile';
import { profileUrl } from '../lib/profileResolution';
import { fetchApplicantProfiles } from '../lib/applicantProfiles';
import { ensureHttps } from '../lib/socialLinks';
import { normaliseStatus } from '../lib/enquiryUtils';
import ProfileAvatar from '../components/ProfileAvatar';
import UnclaimedBadge from '../components/UnclaimedBadge';
import s from './ApplicationsScreen.module.css';

/**
 * ⚠⚠ THESE TABS WERE NAMED AFTER A VOCABULARY THE DATA DOES NOT USE.
 *
 * `PENDING`, `TENTATIVE` and `OFFERED` match ZERO production rows, and
 * `REJECTED` matched nothing because every decline is written as `declined`.
 * Four of five tabs were dead.
 *
 * ⭐ The buckets are now the ones `normaliseStatus` actually produces, which is
 * the same set the venue and host dashboards already show. Both vocabularies
 * land in the right tab, and an unrecognised status falls into NEW rather than
 * vanishing.
 */
const STATUS_TABS = ['NEW', 'SEEN', 'SHORTLISTED', 'ACCEPTED', 'DECLINED'];

export default function ApplicationsScreen() {
  const { id: eventId } = useParams();
  const navigate = useNavigate();
  const [apps,      setApps]      = useState([]);
  const [profiles,  setProfiles]  = useState({});
  const [eventName, setEventName] = useState('');
  const [eventOwnerProfileId, setEventOwnerProfileId] = useState(null);  // §A7 subject
  // ⚠ Must be one of STATUS_TABS. It was 'PENDING', which is no longer a tab —
  // the screen would have opened on a tab whose button does not exist.
  const [tab,       setTab]       = useState('NEW');
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;

    async function load() {
      const [{ data: appData }, { data: evData }] = await Promise.all([
        supabase.from('applications').select('*').eq('event_id', eventId).order('created_at', { ascending: false }),
        // owner_profile_id comes along for §A7: an application decision is
        // ABOUT the event's owner, and it is one more column on a query we
        // already make rather than a second round trip.
        supabase.from('events').select('name, owner_profile_id').eq('id', eventId).maybeSingle(),
      ]);
      if (!cancelled) { setEventName(evData?.name || ''); setEventOwnerProfileId(evData?.owner_profile_id || null); }

      if (cancelled) return;
      const rows = appData || [];
      setApps(rows);

      // M6 · applicant profiles resolve by from_profile_id, with the legacy
      // account key only for rows M6c could not resolve. Keyed by
      // applications.id — see lib/applicantProfiles.js.
      const map = await fetchApplicantProfiles(
        supabase, rows, 'id, user_id, name, avatar, sound, genre_string, type, mix_link');
      if (!cancelled) setProfiles(map);
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [eventId]);

  async function respond(appId, status, artistId) {
    await supabase.from('applications').update({ status }).eq('id', appId);
    setApps(prev => prev.map(a => a.id === appId ? { ...a, status } : a));
    if (!artistId) return;
    const evLabel = eventName ? ` for ${eventName}` : '';
    /* ⚠ Keyed on the NORMALISED bucket. Keyed on the raw value this map missed
       every decline (`declined` is what gets written, `rejected` is what it
       listened for), so the applicant was never told. */
    const NOTIF = {
      shortlisted: { type: 'shortlisted',          message: `You've been shortlisted${evLabel}.` },
      declined:    { type: 'application_declined', message: `Your application was unsuccessful${evLabel}.` },
      /* ⚠ Accepting the APPLICATION creates no lineup member and no
         performance, so it may claim neither. See HostDashboard's copy. */
      accepted:    { type: 'booking_confirmed',    message: `Your application was accepted${evLabel}.` },
    };
    const notif = NOTIF[normaliseStatus({ status, direction: 'incoming' })];
    // §A7: about = the event's owner (whose decision this is); to = the
    // artist's performer profile, U4-resolved, null if ambiguous.
    if (notif) await writeNotification({
      toUserId:       artistId,
      toProfileId:    (await resolvePerformerProfileId(artistId)).profileId ?? null,
      aboutProfileId: eventOwnerProfileId,
      type:    notif.type,
      message: notif.message,
      data:    { event_name: eventName, event_id: eventId },
    });
  }

  /* One rule for the list and the tab counts below — they read the same
     function, so a count can no longer disagree with the list it labels. */
  const bucketOf = a => normaliseStatus({ status: a.status, direction: 'incoming' });
  const inTab    = (a, t) => bucketOf(a) === t.toLowerCase();
  const filtered = apps.filter(a => inTab(a, tab));

  return (
    <div className={s.screen}>
      <div className={s.header}>
        <h1 className={s.title}>APPLICATIONS</h1>
        <span className={s.count}>{apps.length}</span>
      </div>

      <div className={s.tabs}>
        {STATUS_TABS.map(t => (
          <button
            key={t}
            className={tab === t ? s.tabActive : s.tab}
            onClick={() => setTab(t)}
          >
            {t}
            <span className={s.tabCount}>{apps.filter(a => inTab(a, t)).length}</span>
          </button>
        ))}
      </div>

      <div className={s.list} style={{ minHeight: '60vh' }}>
        {loading && <p className={s.empty}>Loading…</p>}
        {!loading && filtered.length === 0 && (
          <p className={s.empty}>No {tab.toLowerCase()} applications.</p>
        )}
        {filtered.map(app => {
          const profile = profiles[app.id];
          return (
            <AppCard
              key={app.id}
              app={app}
              profile={profile}
              onAccept={() => respond(app.id, 'shortlisted', app.artist_id)}
              onReject={() => respond(app.id, 'declined', app.artist_id)}
            />
          );
        })}
      </div>
    </div>
  );
}

function AppCard({ app, profile, onAccept, onReject }) {
  const navigate = useNavigate();
  // The fallback label uses the application id, not the applicant's account
  // id: an orphan row (no profile either way) has no account to name, and
  // showing a slice of someone's user id was never meaningful to a host.
  const name   = profile?.name  || app.artist_name || `Applicant #${app.id?.slice(0, 6)}`;
  const sound  = profile?.sound || profile?.genre_string || '';
  /**
   * ⚠ WAS `status === 'pending'`, which is zero rows — so even once a tab
   * populated, every card rendered with NO accept/decline buttons. Undecided
   * means the row has not been acted on yet, whichever vocabulary spelled it.
   */
  const bucket    = normaliseStatus({ status: app.status, direction: 'incoming' });
  const isPending = bucket === 'new' || bucket === 'seen';
  const mixLink = ensureHttps(app.mix_link || profile?.mix_link);

  return (
    <div className={s.card}>
      {/* Every resolved profile is a real `profiles` row with an id, so the
          old `/profile/<user_id>` fallback is unreachable — and it built the
          legacy URL form M5.1's shim retires. */}
      <div className={s.cardTop} style={{ cursor: 'pointer' }} onClick={() => profile && navigate(profileUrl(profile))}>
        {profile
          ? <ProfileAvatar className={s.avatar} profile={profile} name={name} />
          : <div className={s.avatarPH}>{name[0]?.toUpperCase()}</div>
        }
        <div className={s.cardInfo}>
          {/* Paired with the name rather than trailed on .cardTop, which
              already ends with the .status pill — two trailing badges would
              read as one status group. .cardName truncates, so it yields the
              width. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <p className={s.cardName}>{name}</p>
            <UnclaimedBadge profile={profile} />
          </div>
          {sound && <p className={s.cardSound}>{sound}</p>}
        </div>
        {/* ⭐ The pill shows the NORMALISED bucket, so the DOM carries one
            vocabulary too. Showing the raw value put `tentative` on one card
            and `shortlisted` on the next for the same state, and only three
            raw spellings had any CSS at all. */}
        <span className={s.status} data-status={bucket}>
          {bucket.toUpperCase()}
        </span>
      </div>
      {app.note && <p className={s.note}>"{app.note}"</p>}
      {mixLink && (
        <a href={mixLink} target="_blank" rel="noopener noreferrer"
           style={{ display: 'inline-block', marginTop: 8, fontSize: 12, color: 'var(--neon2)', fontFamily: "'Bebas Neue'", letterSpacing: 1, textDecoration: 'none' }}>
          ▶ PLAY DEMO MIX
        </a>
      )}
      {isPending && (
        <div className={s.actions}>
          <button className={s.btnAccept} onClick={onAccept}>✓ SHORTLIST</button>
          <button className={s.btnReject} onClick={onReject}>✕ DECLINE</button>
        </div>
      )}
    </div>
  );
}
