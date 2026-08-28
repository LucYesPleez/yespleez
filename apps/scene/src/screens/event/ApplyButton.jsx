// EP-00 · extracted verbatim from EventScreen.jsx. Public-view only.
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { getPerformerProfiles } from '../../lib/actingProfile';
import { track, EVENTS } from '../../lib/analytics';
import { writeNotification } from '../../lib/writeNotification';
import { announcePushWorthIt } from '../../lib/pushPrompt';
import { listAssets } from '../../lib/profileAssetStore';
import { resolveAskCategory } from '../../lib/askCategoryResolver';
import { genreLabels } from '../../lib/profileTaxonomy';
import { evaluate, columnsFor, snapshotEvaluation } from '@yespleez/requirements';
/**
 * ⭐ The verdict display moved to the requirements package once a second
 * surface needed it: a venue's standing requirements are shown on the venue
 * profile, and that screen cannot import an event screen's component. Markup
 * unchanged — `title` and `editPath` are props because this component is not
 * allowed to know whose requirements it is reporting.
 */
import { RequirementsVerdict } from '@yespleez/requirements/checklist';
import UnclaimedNotice from '../../components/UnclaimedNotice';
import s from '../EventScreen.module.css';

export default function ApplyButton({ eventId, userId, ownerProfile }) {
  const [note,          setNote]          = useState('');
  const [open,          setOpen]          = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [checked,       setChecked]       = useState(false);
  const [performers,    setPerformers]    = useState([]);
  const [perfLoaded,    setPerfLoaded]    = useState(false);
  const [actingId,      setActingId]      = useState(null);
  // profileId → status, for THIS event. Replaces a single account-level
  // `status`: the old check was `.eq('artist_id', userId)`, so once any one of
  // your acts had applied, every other act's event page said APPLICATION
  // PENDING and offered no way to apply. One human, several acts, several
  // applications — the schema has always allowed it; only this check didn't.
  const [appliedBy,     setAppliedBy]     = useState({});
  // P5 · the opportunity's declared requirements, and this applicant's standing
  // against them. `opportunity` also carries what the host notification needs.
  const [opportunity,   setOpportunity]   = useState(null);
  const [evaluation,    setEvaluation]    = useState(null);
  const [evaluating,    setEvaluating]    = useState(false);

  // Runs once the performer list is known — the applications are looked up BY
  // those profile ids, so there is nothing to ask before then.
  useEffect(() => {
    if (!userId || !eventId) { setChecked(true); return; }
    if (!perfLoaded) return;
    if (!performers.length) { setAppliedBy({}); setChecked(true); return; }
    supabase.from('applications')
      .select('from_profile_id, status')
      .eq('event_id', eventId)
      .in('from_profile_id', performers.map(p => p.id))
      .then(({ data }) => {
        const map = {};
        (data || []).forEach(r => { if (r.from_profile_id) map[r.from_profile_id] = r.status; });
        setAppliedBy(map);
        setChecked(true);
      });
  }, [eventId, userId, perfLoaded, performers]);

  // `required_items` is a column, not part of `config` — requirements are never
  // rendered on the public event page, so this deliberately does not go through
  // eventViewModel. host_id / owner_profile_id / name are read in the same trip
  // for the submission notification.
  useEffect(() => {
    if (!eventId) return;
    supabase.from('events').select('required_items, host_id, owner_profile_id, name').eq('id', eventId).maybeSingle()
      .then(({ data }) => setOpportunity(data || null));
  }, [eventId]);

  /**
   * Evaluate the ACTING profile against the requirements — re-run whenever the
   * applicant switches profile, because the answer is a property of the pair.
   * Their band may have a press kit their solo act does not.
   *
   * Only the columns the requirements actually reference are fetched
   * (`columnsFor`), so an opportunity asking for a bio does not pull a
   * commercial record. `id` is included because assets resolve by profile id.
   */
  useEffect(() => {
    const required = opportunity?.required_items || [];
    if (!required.length || !actingId) { setEvaluation(null); return; }
    let cancelled = false;
    setEvaluating(true);
    (async () => {
      const cols = [...new Set(['id', ...columnsFor(required)])].join(', ');
      const [{ data: prof }, assets] = await Promise.all([
        supabase.from('profiles').select(cols).eq('id', actingId).maybeSingle(),
        listAssets(actingId).catch(() => []),
      ]);
      if (cancelled) return;
      setEvaluation(evaluate(required, { profile: prof || {}, assets: assets || [] }));
      setEvaluating(false);
    })();
    return () => { cancelled = true; };
  }, [opportunity, actingId]);

  useEffect(() => {
    if (!userId) return;
    // M6: the acting profile comes from the one seam (actingProfile.js).
    // Auto-select ONLY when there is exactly one eligible profile; with
    // several the user chooses, because guessing the sender is precisely
    // what B2 cost us on every pre-M6 application row.
    getPerformerProfiles(userId).then(list => {
      setPerformers(list);
      setActingId(list.length === 1 ? list[0].id : null);
      setPerfLoaded(true);
    });
  }, [userId]);

  if (!checked) return null;
  if (!userId)  return null;

  const statusColour = st => ({ accepted: 'var(--green)', pending: 'var(--gold)', rejected: 'var(--muted)' }[st] || 'var(--muted)');
  // Every act has already applied — there is nothing left to offer, so state
  // each one's standing. Named per profile rather than as one bare
  // "APPLICATION PENDING": with several acts, which one it referred to was
  // exactly the ambiguity that made the old account-level check misleading.
  const remaining = performers.filter(p => !appliedBy[p.id]);
  if (performers.length > 0 && remaining.length === 0) {
    return (
      <div style={{ marginBottom: 16 }}>
        {performers.map(p => (
          <p key={p.id} style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, color: statusColour(appliedBy[p.id]) }}>
            {performers.length > 1 ? `${p.name || '(unnamed)'} — ` : ''}APPLICATION {String(appliedBy[p.id]).toUpperCase()}
          </p>
        ))}
      </div>
    );
  }

  async function submit() {
    // R6.1: never write an application that cannot name its sender.
    if (!actingId) return;
    // Every ticked requirement blocks, field or file (2026-08-03 override —
    // see requirements.js). The button is already disabled in this case;
    // re-checking here keeps the rule in the write path rather than only in
    // the styling.
    if (evaluation && !evaluation.canSubmit) return;
    setLoading(true);
    const { data: inserted, error } = await supabase.from('applications').insert({
      event_id: eventId,
      artist_id: userId,
      from_profile_id: actingId,
      status: 'pending',
      note,
      // NULL when the opportunity declared nothing — see the P5 migration.
      // A verdict, never a copy of the profile.
      requirements_snapshot: evaluation
        ? snapshotEvaluation(evaluation, opportunity?.required_items)
        : null,
      /**
       * P12 — what this application is asking FOR, frozen at creation.
       *
       * ⭐ Resolved from the ACTING profile's role, not from the event. The
       * event's own category (`CATEGORY_BADGES`) is a different vocabulary
       * describing a different subject, and translating between them is
       * explicitly out of bounds — see the Ask Category design.
       *
       * ⛔ NULL is a real answer and is stored as one. `needsChoice` cannot
       * fire here today: only performer profiles reach this button, and every
       * performer role maps to exactly one category.
       */
      ask_category: resolveAskCategory(performers.find(p => p.id === actingId)).category,
    }).select('id').maybeSingle();
    setLoading(false);
    if (!error) {
      // Record it against the profile that applied, not the account — the
      // other acts must stay applyable.
      setAppliedBy(m => ({ ...m, [actingId]: 'pending' }));
      setOpen(false);
      /**
       * Tell the host. `new_application` has had a UI label (notifMeta) and an
       * N4 expiry policy since Phase 13 and NOTHING HAS EVER WRITTEN ONE — the
       * same silence `sendEnquiry` had: a host learned of an application only
       * by opening their dashboard.
       *
       * §A7: `about` = the applicant's profile (whose act this is), `to` = the
       * host. A held row (unclaimed owner, to_user_id null) is correct and
       * writeNotification keeps it — that is N1, and the whole point of N3.
       */
      await writeNotification({
        toUserId:       opportunity?.host_id ?? null,
        toProfileId:    opportunity?.owner_profile_id ?? null,
        aboutProfileId: actingId,
        type:    'new_application',
        message: `New application for ${opportunity?.name || 'your event'}.`,
        data:    { event_id: eventId, application_id: inserted?.id ?? null },
      });
      // A1 · a genuine application. Accepting a slot OFFER (ArtistDashboard,
      // notifActions) also inserts into `applications`, but that is the host
      // asking and the artist agreeing — a different act, deliberately not
      // counted here.
      track(EVENTS.APPLIED, { has_note: !!(note && note.trim()) });
      /**
       * ⭐ O4 · FROM THIS SECOND THEY ARE WAITING FOR SOMEONE ELSE, which is
       * the first moment in the product where a notification answers a
       * question they are already asking. This announces the moment and
       * forgets — ⛔ it must not learn whether push is supported, permitted or
       * already asked; that policy lives in lib/pushPrompt, once.
       */
      announcePushWorthIt('application');
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {!open ? (
        <button className={s.applyBtn} onClick={() => {
          setOpen(true);
          // AV5: intent, before any application row exists. The funnel's
          // opened→applied conversion lives on this one line.
          track(EVENTS.APPLICATION_STARTED, { event_id: eventId });
        }}>APPLY TO PLAY</button>
      ) : (
        <div className={s.applyForm}>
          <p style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 2, marginBottom: 8 }}>YOUR APPLICATION</p>
          {/* M6 · acting profile. One eligible profile is stated; several
              are chosen from. Nothing is pre-selected when it is ambiguous —
              a default here would be a guess wearing a confirmation. */}
          {/* `remaining` — acts that have NOT already applied. An act with an
              application in flight is shown, but disabled and labelled, rather
              than hidden: silently dropping it reads as a missing profile. */}
          {remaining.length === 1 && performers.length === 1 && (
            <p style={{ fontSize: 12, color: 'var(--neon2)', marginBottom: 8, fontFamily: "'Bebas Neue'", letterSpacing: 1 }}>
              {/* ⛔⛔ `genreLabels`, ⛔ never the raw column — role keys live in
                  `genre_string`, and this is the line telling an artist who
                  they are about to apply AS. ⚠ Sliced to three; it printed the
                  whole list into a one-line label. */}
              APPLYING AS: {performers[0].name} · {performers[0].sound || genreLabels(performers[0].genre_string).slice(0, 3).join(' · ')}
            </p>
          )}
          {performers.length > 1 && (
            <div style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, fontFamily: "'Bebas Neue'", letterSpacing: 1 }}>APPLYING AS</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {performers.map(p => {
                  const already = appliedBy[p.id];
                  const on = p.id === actingId;
                  return (
                    <button key={p.id} type="button" disabled={!!already}
                      onClick={() => !already && setActingId(p.id)}
                      style={{
                        padding: '6px 12px', borderRadius: 8, cursor: already ? 'default' : 'pointer',
                        fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1,
                        border: `1px solid ${on ? 'var(--neon2)' : 'var(--border)'}`,
                        background: on ? 'rgba(0,229,255,.12)' : 'none',
                        color: on ? 'var(--neon2)' : 'var(--muted)',
                        opacity: already ? .45 : 1,
                      }}>
                      {p.name || '(unnamed)'}{already ? ' · APPLIED' : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {performers.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
              You need an artist, band or comedy profile before you can apply.
            </p>
          )}
          {/* Above the note, not below it: what the host asks for should be
              read before the applicant decides what to write. Absent entirely
              when nothing was declared — never an empty card or "0/0" (R3). */}
          {evaluating && !evaluation && (
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>Checking what this host asks for…</p>
          )}
          {/* The editor for the profile they are APPLYING AS — resolved from
              that profile's own type, not the account's, so a comedian
              switching to their band profile gets the band editor. */}
          {evaluation && (
            <RequirementsVerdict
              evaluation={evaluation}
              title="WHAT THIS HOST ASKS FOR"
              editPath={(() => {
                const t = performers.find(p => p.id === actingId)?.type;
                return t ? `/industry/${t}/setup` : null;
              })()}
            />
          )}
          <textarea value={note} onChange={e => setNote(e.target.value)}
            placeholder="Add a note for the host (optional)…" rows={3}
            style={{ width: '100%', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: '10px 12px', fontSize: 13, outline: 'none', resize: 'none', marginBottom: 10 }} />
          {/* N2 · immediately above SEND, the last thing read before acting.
              APPLY TO PLAY is gated on `!isHost && userId && applications_open`
              and never on the owner's claim state, so an event imported for an
              organiser who has never joined is applyable — and said nothing. */}
          <UnclaimedNotice profile={ownerProfile} context="apply" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setOpen(false)}
              style={{ flex: 1, background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, padding: 10, borderRadius: 8 }}>CANCEL</button>
            {/* Every unmet requirement now blocks, a missing press kit
                included (2026-08-03 override). The label still names the
                profile gap rather than saying "blocked" — the fix is one
                screen away and the button should say where. */}
            <button onClick={submit} disabled={loading || !actingId || (evaluation && !evaluation.canSubmit)} className={s.applyBtn}
              style={{ flex: 2, opacity: actingId && !(evaluation && !evaluation.canSubmit) ? 1 : .5 }}>
              {loading ? '…'
                : performers.length > 1 && !actingId ? 'CHOOSE A PROFILE'
                : evaluation && !evaluation.canSubmit ? 'COMPLETE YOUR PROFILE FIRST'
                : 'SEND APPLICATION'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
