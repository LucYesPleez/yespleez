// DEV ONLY — the public schedule projection harness.
//
// Route: /#/dev/schedule   (the app uses HashRouter). Not linked from anywhere.
//
// ⭐⭐ WHY THIS EXISTS. The one production event with a schedule keeps its set
// times PRIVATE (`showTimesPublicly: false`), and the event-layout harness does
// not cover set times at all — so the section S3 rebuilds was the one section
// nobody could look at. This renders the projection against the REAL rows.
//
// ⚠ IT READS PRODUCTION, ⛔ and writes nothing. `event_slots` and accepted
// `performances` on a live event are readable by anon under the SEC-2 policies,
// which is exactly what a punter would see — so this shows the public view
// using the public's own permissions rather than a fixture that agrees with me.
//
// ⛔ The FESTIVAL case is a fixture, and has to be: no multi-stage event exists
// yet, and `event_stages` is empty in production. It is labelled as such below
// so nobody reads it as evidence about real data.

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { resolveSchedule } from '../../lib/scheduleModel';
import { groupSlotsIntoDays, indexPerformances } from '../../lib/eventSlots';
import SchedulePortrait from './SchedulePortrait';

/** The only production event that has a schedule (19 slots, 2 days). */
const SOLSTICE = '55512cb8-72e8-446c-9fff-f195d7e002c3';

const FESTIVAL_STAGES = [
  { id: 'm', name: 'MAIN STAGE',   position: 0, accent: '#00E5FF' },
  { id: 's', name: 'SECOND STAGE', position: 1, accent: '#FF3399' },
  { id: 'c', name: 'CHILL ZONE',   position: 2, accent: '#BF5FFF' },
];

/* Real production avatar thumbs, harness-only, so the fixture's SlotCards are
   judged with faces rather than fallbacks. Names are the fixture's. */
const AV = 'https://doqzxvppibuzieajqkxm.supabase.co/storage/v1/object/public/avatars/artist_avatars/';
const FIXTURE_AVATARS = {
  LUCIOUS:  AV + '94a88288-43aa-445b-abb8-7dc895804b51_thumb.jpg',
  FEWRF:    AV + '6758a44e-64fd-4837-999c-838644503142_thumb.jpg',
  ELBOW:    AV + 'e93aaf06-69ac-4083-aa31-8639d2b99e4f_thumb.jpg?v=1786173468827',
  MADDS:    AV + 'c56e9cac-0e57-4929-beb9-48d3afd8b586_thumb.jpg?v=1786662977000',
  KODEX:    AV + '6b50daa7-d42b-4211-8c52-92f6e0f027fe_thumb.jpg',
  SYNAPTIK: AV + 'c942c8f2-5df1-46f9-9bfc-89553f7448ce_thumb.jpg?v=1786329739236',
  NOMAD:    AV + 'fd28d3b5-87c9-4950-b5ff-2934e437f093_thumb.webp?v=1786680226711',
};

function festivalFixture() {
  const times = [['7:00', 'PM'], ['8:00', 'PM'], ['9:00', 'PM'], ['10:00', 'PM'], ['11:00', 'PM']];
  const names = {
    m: ['LUCIOUS', 'FEWRF', 'ELBOW', 'MADDS', 'DADDY LONGLEGS'],
    s: ['KODEX', 'SYNAPTIK', 'SUBSTRATE', 'REKON'],
    c: ['NOMAD', null, 'MOSSY', null, 'KAIJU'],
  };
  const slots = [];
  const claims = {};
  for (const st of ['m', 's', 'c']) {
    times.forEach(([time, ampm], i) => {
      const who = names[st][i];
      if (who === undefined) return;
      const id = `${st}${i}`;
      slots.push({
        id, event_id: 'fixture', day_index: 0, day_name: 'SATURDAY', position: i,
        time, ampm, dur_mins: 60, label: '', label_color: null, pinned: false, stage_id: st,
      });
      /* ⚠ ONE ACT CARRIES A REAL PROFILE ID, deliberately. Every act on the one
         production event with a schedule is hand-typed — `artist_profile_id`
         and `artist_id` are NULL on all 20 — so VIEW PROFILE correctly never
         renders there, and the interaction could not be checked at all. This
         act is MADSPiN BABY's actual profile, so the card has somewhere to go
         and the route can be proven rather than assumed. */
      if (who) claims[id] = {
        status: 'confirmed', name: who,
        profile: FIXTURE_AVATARS[who] ? { avatar_thumb: FIXTURE_AVATARS[who] } : null,
        profile_id: (st === 'm' && i === 0) ? '99488e7a-3fbf-4834-b2f8-8c9815c89429' : null,
        user_id:    (st === 'm' && i === 0) ? '99488e7a-3fbf-4834-b2f8-8c9815c89429' : null,
      };
    });
  }
  return { slots, stages: FESTIVAL_STAGES, claims, eventDate: '2026-10-03' };
}

export default function ScheduleHarness() {
  const [live, setLive] = useState(null);
  const [err, setErr] = useState('');
  const [which, setWhich] = useState('solstice');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [slotsRes, perfRes] = await Promise.all([
        supabase.from('event_slots')
          .select('id, event_id, day_index, day_name, position, legacy_key, time, ampm, dur_mins, label, label_color, pinned, stage_id')
          .eq('event_id', SOLSTICE).order('day_index').order('position'),
        supabase.from('performances')
          .select('id, lineup_member_id, event_id, slot_uuid, status')
          .eq('event_id', SOLSTICE),
      ]);
      if (cancelled) return;
      if (slotsRes.error) { setErr(slotsRes.error.message); return; }

      const memberIds = [...new Set((perfRes.data || []).map(p => p.lineup_member_id).filter(Boolean))];
      const memRes = memberIds.length
        ? await supabase.from('lineup_members')
            .select('id, artist_id, artist_profile_id, artist_name, genre, sound, card_pills, status')
            .in('id', memberIds)
        : { data: [] };
      if (cancelled) return;

      const memberMap = {};
      (memRes.data || []).forEach(m => { if (m.status === 'on_bill') memberMap[m.id] = m; });
      const { primary } = indexPerformances(perfRes.data || [], memberMap);

      setLive({ slots: slotsRes.data || [], stages: [], claims: primary, eventDate: '2026-06-20' });
    })();
    return () => { cancelled = true; };
  }, []);

  const source = which === 'festival' ? festivalFixture() : live;
  const resolved = source ? resolveSchedule(source) : null;

  return (
    <div style={{ padding: '80px 16px 60px', maxWidth: 520, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        {[['solstice', 'SOLSTICE (LIVE DATA)'], ['festival', 'FESTIVAL (FIXTURE)']].map(([k, label]) => (
          <button key={k} onClick={() => setWhich(k)}
            style={{
              fontFamily: "'Bebas Neue',sans-serif", fontSize: 11, letterSpacing: 1.4,
              padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
              border: '1px solid ' + (which === k ? '#fff' : 'rgba(255,255,255,.12)'),
              background: which === k ? '#fff' : 'none',
              color: which === k ? '#0a0a14' : 'rgba(255,255,255,.5)',
            }}>{label}</button>
        ))}
      </div>

      {err && <div style={{ color: '#FF8C8C', fontSize: 13, marginBottom: 12 }}>{err}</div>}
      {!source && !err && <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 13 }}>Loading production rows…</div>}

      {resolved && (
        <>
          <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: 'rgba(255,255,255,.3)', marginBottom: 14 }}>
            {resolved.slotCount} slots · {resolved.days.length} day(s) ·{' '}
            {resolved.isMultiStage ? `${resolved.stageCount} stages` : 'single stage'}
            {resolved.unstagedOnStagedEvent > 0 && ` · ⚠ ${resolved.unstagedOnStagedEvent} unstaged`}
          </div>
          <SchedulePortrait resolved={resolved} />

          {/* ⚠ Proof the host path is untouched: the same rows through the OLD
              grouping, which DaySlots still consumes. If this stops matching
              the projection's day/slot counts, the two readers have diverged. */}
          <div style={{ marginTop: 26, fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: 'rgba(255,255,255,.25)' }}>
            groupSlotsIntoDays (host path): {groupSlotsIntoDays(source.slots).map(d => `${d.name || d.dayIndex}:${d.slots.length}`).join(' · ')}
          </div>
        </>
      )}
    </div>
  );
}
