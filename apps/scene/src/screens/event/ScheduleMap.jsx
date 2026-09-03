// § 7 · SET TIMES — THE ZOOMED-OUT MAP.
//
// ⭐⭐ WHY THIS EXISTS (owner, 2026-08-31): "I just dont want the set times
// section to be empty when people land on the event."
//
// ⚠⚠ THE PEEK COULD NOT ANSWER THAT, AND THE REASON IS STRUCTURAL. Collapsed,
// SET TIMES showed a 500px window onto ONE stage of a merged 15-minute grid.
// Every stage shares one time axis, so the top of a stage that opens at 4:00 PM
// is six hours of nothing — and a reader landing on the event page saw a blank
// box on a festival with 38 sets. Anchoring that window better (which was done
// first) stops it being blank, but it still shows four cards of one room and
// says nothing about the shape of the day. A window cannot show its own scale.
//
// ⭐⭐ SO THE COLLAPSED STATE IS A MAP, ⛔ NOT A WINDOW. Every stage, the whole
// day, scaled to fit — no scrolling, nothing below the fold, nothing to swipe
// to. It cannot be empty, because "empty" would mean the day has no sets in it.
//
//   ── THE SHAPE ────────────────────────────────────────────────
//     MAIN     SECOND    CHILL         ← stage names
//   10a ▓▓▓▓   ·······   ·······
//   12p ▓▓▓▓   ▓▓▓▓▓▓    ·······       ← time gutter, then one column per stage
//    2p ▓▓▓▓   ▓▓▓▓▓▓    ▓▓▓▓▓▓▓
//    4p ·····  ·······   ▓▓▓▓▓▓▓
//
// ⭐⭐ LENGTH ON THE PAGE IS LENGTH IN THE ROOM, exactly as the full schedule
// reads — this is the SAME `slotGrid` projection at a smaller scale, ⛔ not a
// second scheduling model. A 90 minute set is genuinely taller than an hour one
// here too, so the map and the thing it maps agree by construction.
//
// ⛔⛔ IT DOES NOT DECIDE WHAT A SLOT SAYS. Draft reads as open, unconfirmed
// reads as PENDING, only a confirmed act is named — and those rules are read
// from `slotOccupant` in slotUtils, the same function `SlotCard` reads. ⛔ Never
// re-derive them here; that is how a map leaks a name the card is hiding.
//
// ⛔ Single-stage events do NOT get this. A pub gig's collapsed state is the
// peek — real cards with artwork, and with one column there is no leading gap
// to be blank in. A one-column map would be a worse read of the same four acts.

import { useMemo } from 'react';
import { slotGrid } from '../../lib/schedulePortrait';
import { slotStates, PLAYING, PLAYED } from '../../lib/scheduleNow';
import { stripEmoji, slotOccupant } from './slotUtils';
import s from './ScheduleMap.module.css';

/**
 * ⭐ THE MAP'S HEIGHT BUDGET. The whole day has to land inside it, so the row
 * height is derived from the day's length rather than set — a five-hour pub
 * night and a fifteen-hour festival both fit, at different densities.
 *
 * ⚠ `MIN_ROW` is the floor at which a 15-minute interval is still a visible
 * band; below it the map stops being readable and simply gets shorter instead.
 *
 * ⚠⚠ `MAX_ROW` IS SET BY THE SHORTEST SET, ⛔ not by taste. It was 11px, which
 * looked right on a festival day and turned the 20-minute demo night into a row
 * of unlabelled bars: 20 minutes is 1.33 rows, so every block came out under
 * `TEXT_MIN_PX` and the map read as a barcode. At 16 a 20-minute set clears the
 * text floor, which is the whole difference between a map and a pattern.
 */
const MAX_H = 396;
const MIN_ROW = 4;
const MAX_ROW = 16;

/** Below this a block cannot hold a line of text, so it draws as a bar only. */
const TEXT_MIN_PX = 14;

/* Hour ticks thin out as the day gets denser — an hour label every 12px is a
   solid grey column, ⛔ not an axis. */
function tickStep(rowH) {
  const perHour = rowH * 4;
  if (perHour >= 40) return 1;
  if (perHour >= 24) return 2;
  return 3;
}

function hourLabel(mins) {
  const m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${h < 12 ? 'a' : 'p'}`;
}

export default function ScheduleMap({ day, now, onPick }) {
  const stages = (day?.stages || []).filter(Boolean);
  const grid = useMemo(() => slotGrid(day, 15), [day]);
  /* ⚠ The SAME state map the cards use, so the map cannot disagree with the
     schedule underneath it about which set is on. */
  const states = useMemo(() => slotStates(day, now), [day, now]);

  if (!grid.rows || !stages.length) return null;

  const rowH = Math.max(MIN_ROW, Math.min(MAX_ROW, MAX_H / grid.rows));
  const step = tickStep(rowH);

  /* ⭐ Ticks are on the HOUR, ⛔ not every Nth row. The grid starts at the first
     act, which is rarely on an hour boundary, so counting rows would label
     10:20, 11:20, 12:20 and read as a clock that is running wrong. */
  const ticks = [];
  const firstHour = Math.ceil(grid.startMins / 60) * 60;
  const endMins = grid.startMins + grid.rows * grid.intervalMins;
  for (let m = firstHour; m < endMins; m += 60 * step) {
    ticks.push({ mins: m, row: Math.round((m - grid.startMins) / grid.intervalMins) + 1 });
  }

  return (
    <div className={s.map}>
      {/* ⚠ The stage names sit OUTSIDE the scrolling grid body so they cannot
          drift out of line with the columns they label. One grid, two rows. */}
      <div
        className={s.body}
        style={{
          gridTemplateColumns: `var(--gutter) repeat(${stages.length}, minmax(58px, 1fr))`,
          gridTemplateRows: `auto repeat(${grid.rows}, ${rowH}px)`,
        }}
      >
        <div className={s.gutterHead} aria-hidden="true" />
        {stages.map(st => (
          <div key={'h' + (st.id ?? 'implicit')} className={s.stageHead} title={st.name}>
            <span className={s.stageDot} style={{ background: st.accent || 'var(--neon)' }} />
            {st.name}
          </div>
        ))}

        {/* The hour axis: a label in the gutter and a hairline across the day. */}
        {ticks.map(t => (
          <div key={'t' + t.mins} className={s.tick} style={{ gridRow: t.row + 1 }}>
            {hourLabel(t.mins)}
          </div>
        ))}
        {ticks.map(t => (
          <div
            key={'r' + t.mins}
            aria-hidden="true"
            className={s.rule}
            style={{ gridRow: t.row + 1, gridColumn: `2 / span ${stages.length}` }}
          />
        ))}

        {stages.map((st, sIdx) => grid.stages[sIdx].map(cell => {
          const { slot, claim } = cell.entry;
          const { isEmpty, name } = slotOccupant(claim);
          const label = slot.label ? stripEmoji(slot.label) : '';
          /* ⭐ THE SAME THREE READINGS THE CARD HAS: an act, an INFO block
             (a labelled slot with no performer — a welcome, a changeover), or
             an open slot. ⛔ An open slot is not blank space: the organiser
             scheduled that time, they just have not filled it. */
          const text = !isEmpty ? name : (label || 'OPEN');
          const st8 = states.get(slot.id)?.state;
          const h = cell.span * rowH;
          const accent = st.accent || 'var(--neon)';
          return (
            <button
              type="button"
              key={slot.id}
              onClick={() => onPick?.(slot.id)}
              title={`${slot.time || ''} ${slot.ampm || ''} · ${text}`.trim()}
              className={[
                s.block,
                isEmpty && !label ? s.blockOpen : '',
                st8 === PLAYED ? s.blockPlayed : '',
                st8 === PLAYING ? s.blockPlaying : '',
              ].filter(Boolean).join(' ')}
              style={{
                gridColumn: sIdx + 2,
                gridRow: `${cell.row + 1} / span ${cell.span}`,
                '--accent': accent,
              }}
            >
              {h >= TEXT_MIN_PX && <span className={s.blockText}>{text}</span>}
            </button>
          );
        }))}
      </div>
    </div>
  );
}
