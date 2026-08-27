// § 7 · SET TIMES — the public portrait projection.
//
// ⭐⭐ SAME CARDS, SAME INTERACTION, NEW DATA SOURCE (owner, 2026-08-20).
// This renders `SlotCard` — the card the app already has, with its artist
// imagery, time and duration block, label pill and chevron — and it stays
// INTERACTIVE. ⛔ There is no public card design and no read-only variant.
// ⭐⭐ MULTI-STAGE IS THE STAGE PAGER (owner, 2026-08-20, ratified from the
// harness prototype): each stage is the approved vertical timeline, stages
// swipe sideways as snap pages with the neighbour peeking, and rows align by
// TIME across stages so the peek is the comparison. Single-stage stays the
// full-width vertical list. The time-column grid this replaced is dead.
//
// ⭐⭐ EVERY DAY IS ON THE PAGE, IN ORDER (owner, 2026-08-20). Saturday flows
// straight into Sunday under a day heading — ⛔ the days are NOT tabbed panels.
// The owner's reason is the closing set: a night that ends at 1:00 AM puts its
// final act on the NEXT day's slot list (Solstice's 12:00 AM Lounge Sessions
// is Sunday's row 10), so a tab boundary would hide the end of Saturday night
// behind a click — one act, alone, on its own page. The day buttons are
// QUICK-JUMPS that scroll, ⛔ never filters that hide.
//
// ── THE SHAPE ────────────────────────────────────────────────────────
//
//   day jump buttons (only when there is more than one day)
//   SATURDAY ───────────────
//   full-width SlotCard …
//   SUNDAY ─────────────────
//   full-width SlotCard …
//   …one vertical scroll, the page's own.
//
// ⭐ WHAT THIS COMPONENT ACTUALLY IS: a projection of `resolveSchedule`. It
// decides how days and stages are sectioned. ⛔ It does not group rows, and
// ⛔ it does not decide what a card looks like — SlotCard owns that, including
// what a punter may see (draft = open, unconfirmed = PENDING).
//
// ⛔ Landscape is NOT here (brief §6) — a different projection of the same
// resolved object; `lib/schedulePortrait.js` holds the axis machinery it needs.

import { useRef, useState, useEffect, Fragment } from 'react';
import { scheduleShape } from '../../lib/scheduleModel';
import { slotGrid, stageGaps } from '../../lib/schedulePortrait';
import { useDragScroll } from '../../hooks/useDragScroll';
import { useNowMinute } from '../../hooks/useNowMinute';
import { slotStates, phaseLabel, PLAYING, PLAYED, FINISHED, READY } from '../../lib/scheduleNow';
import FollowHeartBtn from '../../components/FollowHeartBtn';
import SlotCard from './SlotCard';
import { dayDateLabel } from '../../lib/eventDays';
import s from './SchedulePortrait.module.css';
/* ⚠⚠ SlotCard's OWN stylesheet. The grid-cell rules reach INSIDE the card —
   `.timeBlock`, `.slotInfo`, `.slot` — and CSS modules hash per FILE, so a copy
   of those selectors written here compiles to names that match nothing and
   silently does nothing. ⛔ Do not duplicate them; use the ones that live
   beside the card they describe. */
import es from '../EventScreen.module.css';

/**
 * ⭐⭐ A NAMED DAY STILL SHOWS ITS DATE. This used to be `name || date`, so the
 * moment an organiser titled a day "The Jazz Doof" the date DISAPPEARED, and a
 * three-day festival's chips read as three titles with nothing to place them on
 * a calendar. The name answers "what is this day", the date answers "when" —
 * two questions, and the second one is the one an artist checking their set
 * time actually needs.
 *
 * ⚠ Ordinal last, never "Day undefined". A day with neither a name nor a date
 * (a single-day event, or a row loaded before the event row arrived) keeps the
 * old label exactly.
 */
function dayLabel(d) {
  const date = dayDateLabel(d.date);
  if (d.name && date) return `${d.name} · ${date}`;
  return d.name || date || `DAY ${d.dayIndex + 1}`;
}

/**
 * ⭐⭐ THE CHIPS ARE A RAIL, ⛔ NOT A WRAPPING BLOCK (owner, 2026-08-21).
 *
 * ⚠⚠ WHY: wrapped chips push the schedule DOWN THE PAGE as they multiply.
 * Measured at 488px, five fit on a row — so seven stages is two rows, twenty is
 * four, and on a 375px phone seven is already two. A rail is 28px at any count.
 * That is the difference between a festival with 40 stages being cramped and
 * being unusable, and it costs one line of CSS plus the app's own drag hook.
 *
 * ⛔ THE TRADE-OFF IS REAL AND WAS TAKEN DELIBERATELY: a rail hides names off
 * the edge, where wrapping showed every one at once. For three stages wrapping
 * did read better. It loses the moment the chips start shoving the thing they
 * label off the screen — which is the whole job of the control.
 *
 * ⭐ ONE COMPONENT FOR DAYS AND STAGES, because they follow one law: lit by the
 * SCROLL rather than the click, tap to JUMP, ⛔ never a filter that hides.
 */
function ChipRail({ items, activeIndex, onPick }) {
  const drag = useDragScroll();
  const railRef = drag.ref;

  /* ⚠ THE LIT CHIP IS SCROLLED INTO VIEW, and that is what makes a long strip
     usable rather than merely compact — otherwise "where you are" is the one
     chip you cannot see. ⛔ Done by writing `scrollLeft`, NOT by
     `scrollIntoView`: that walks every scrollable ancestor and would drag the
     whole page sideways or bump it vertically while the reader is mid-schedule. */
  useEffect(() => {
    const el = railRef.current;
    const chip = el?.children?.[activeIndex];
    if (!el || !chip) return;
    const box = el.getBoundingClientRect();
    const cb = chip.getBoundingClientRect();
    /* ⚠ Only when it is actually out of view. Re-centring a chip that is
       already visible makes the strip twitch on every scroll tick. */
    if (cb.left < box.left || cb.right > box.right) {
      el.scrollLeft += (cb.left + cb.width / 2) - (box.left + box.width / 2);
    }
  }, [activeIndex, items.length, railRef]);

  return (
    <div
      ref={railRef}
      className={s.days}
      onMouseDown={drag.onMouseDown}
      onMouseUp={drag.onMouseUp}
      onMouseMove={drag.onMouseMove}
      onMouseLeave={drag.onMouseLeave}
    >
      {items.map((it, i) => (
        <button
          key={it.key}
          className={`${s.dayBtn} ${i === activeIndex ? s.dayBtnOn : ''}`}
          aria-current={i === activeIndex ? 'true' : undefined}
          /* The accent carries identity while unlit; the lit chip goes plain so
             "where you are" reads the same for stages as it does for days. */
          style={i !== activeIndex && it.accent ? { color: it.accent } : undefined}
          onClick={() => onPick(i)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/* ⚠ Must match the two enter animations in the stylesheet: the class comes off
   after this, and pulling it early would cut the animation mid-fade. */
const ENTER_MS = 900;

/* Where a day heading counts as "reached": just under the app's fixed header.
   ⚠ Must stay in step with `scroll-margin-top` in the stylesheet, or a jump
   lands on a day whose chip does not light. */
const DAY_REACHED_PX = 96;

export default function SchedulePortrait({ resolved, allMixSlots = [] }) {
  const shape = scheduleShape(resolved);
  /**
   * ⭐⭐ WHERE THE NIGHT IS UP TO (owner, 2026-08-21): the set that is PLAYING
   * swells and takes some vibrancy, the sets that have PLAYED are muted, and
   * everything still to come stays at the page's normal weight.
   *
   * ⭐ THE EMPHASIS MOVING IS THE WHOLE BEHAVIOUR. ⛔ Nothing auto-scrolls: the
   * page does not chase the reader down the running order while they are
   * looking at the late sets. The rules live in `lib/scheduleNow` and the
   * treatment lives in the stylesheet; this only holds the clock.
   */
  const now = useNowMinute();
  const dayRefs = useRef({});
  const days = resolved?.days || [];

  /**
   * ⭐⭐ THE STAGE IS AN EVENT-WIDE CHOICE, ⛔ NOT A PER-DAY ONE. Every day shows
   * the same stages in the same order, so one index positions all of them and
   * the rooms line up under each other down the page.
   *
   * `from` records WHICH day reported the change, so that day is left alone
   * while the others follow it — without it the pager under the hand gets
   * scrolled by its own broadcast and the days fight each other.
   */
  const [stage, setStage] = useState({ index: 0, from: null });
  const stageSync = {
    index: stage.index,
    from: stage.from,
    set: (index, from) => setStage(prev => (
      prev.index === index && prev.from === from ? prev : { index, from })),
  };

  /**
   * ⭐ THE CHIP SAYS WHERE YOU ARE, ⛔ IT NEVER DECIDES WHAT YOU SEE (owner,
   * 2026-08-20 — "the chip for Sunday can be there to let you know you're
   * looking at Sunday, but I don't want that to be the only way to see it").
   * Every day is always on the page; the highlighted chip just tracks the
   * scroll. The last day whose heading has passed the header line is current.
   */
  const [activeDay, setActiveDay] = useState(days[0]?.dayIndex ?? 0);
  /* ⚠ Depends on `resolved?.days`, ⛔ not the `days` const above — that one
     carries a `|| []` fallback which mints a fresh array whenever the schedule
     is absent, so the effect would re-subscribe every render. Same lesson as
     the schedule memo in useEventData. */
  useEffect(() => {
    const list = resolved?.days || [];
    if (list.length < 2) return undefined;
    let raf = 0;
    const measure = () => {
      raf = 0;
      let current = list[0]?.dayIndex ?? 0;
      for (const d of list) {
        const el = dayRefs.current[d.dayIndex];
        if (el && el.getBoundingClientRect().top <= DAY_REACHED_PX) current = d.dayIndex;
      }
      setActiveDay(prev => (prev === current ? prev : current));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    window.addEventListener('scroll', onScroll, { passive: true });
    measure();
    return () => { window.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [resolved?.days]);

  /* R1 · absent. No schedule is not an empty section with nothing in it. */
  if (!shape.hasSchedule) return null;

  return (
    <section className={s.schedule}>
      <div className={s.head}>
        <h2 className={s.heading}>SET TIMES</h2>
        {/* The whole event's count — every day is on this page. */}
        <span className={s.count}>{resolved.slotCount}</span>
      </div>

      {shape.showDayPicker && (
        /* ⭐ A JUMP, ⛔ NOT A FILTER. It scrolls the day's heading into view;
           every other day stays exactly where it was. The lit state comes from
           the SCROLL, not the click — so it stays honest when the reader
           scrolls there themselves. */
        <ChipRail
          items={days.map(d => ({ key: d.dayIndex, label: dayLabel(d) }))}
          activeIndex={days.findIndex(d => d.dayIndex === activeDay)}
          onPick={i => dayRefs.current[days[i]?.dayIndex]
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />
      )}

      {days.map(day => (
        <Fragment key={day.dayIndex}>
          {/* ⚠ The divider only when there is a second day to divide from —
              a single-night gig gets no heading over its own schedule. */}
          {days.length > 1 && (
            <div
              className={s.dayDivider}
              ref={el => { dayRefs.current[day.dayIndex] = el; }}
            >
              <span className={s.dayName}>{dayLabel(day)}</span>
              <div className={s.dayLine} />
            </div>
          )}

          {/* ⭐⭐ TWO LAYOUTS, ONE PER DAY, chosen by the resolver's own shape:
              single-stage = the chronological list; multi-stage = the STAGE
              PAGER (ratified from the harness prototype, owner 2026-08-20).
              Days themselves ALWAYS stack vertically — each day carries its
              own pager, and only STAGES go sideways. */}
          {/* ⭐⭐ ONE LAYOUT, ⛔ NOT TWO (owner, 2026-08-21: "I want this view to
              be the main normal view"). The pager IS set times now. A
              single-stage event is simply a pager with one page — same cards,
              same drag, same live states — so there is no second layout that
              can drift away from this one, and every feature added here lands
              on a pub gig and a festival at the same moment. */}
          <StagePager day={day} allMixSlots={allMixSlots} now={now} sync={stageSync} />
        </Fragment>
      ))}
    </section>
  );
}

/** ⭐ THE CARD, once, for both layouts — `isHost={false}` removes the host
    operations because `SlotCard` renders a control only where its handler
    exists and none are passed. ⛔ NOT read-only: the row expands, the mix
    plays, and VIEW PROFILE reaches the artist when one exists.

    ⭐⭐ THE LIVE STATE IS WORN BY A WRAPPER, ⛔ NOT PASSED INTO `SlotCard`.
    SlotCard is the card every surface renders, host editor included, and it is
    already 1,000 lines deciding what a punter may see. Where the night is up
    to is not its question — a wrapper can swell and mute the finished card
    without a third state entering the one component both paths share. */
function Card({ entry, allMixSlots, state, live, neighbour = false }) {
  /**
   * ⭐⭐ THE HANDOVER BETWEEN STATES IS ANIMATED (owner, 2026-08-21): a set
   * FADES ON as it starts, and as it finishes it fades out completely and
   * snaps back in muted. The change is the moment worth noticing — a card that
   * simply swapped treatment between two renders was a fact you had to catch.
   *
   * ⚠⚠ ONLY ON A REAL CHANGE, ⛔ NEVER ON MOUNT. Open a schedule mid-evening
   * and half the bill is already played; animating those on arrival would fire
   * a dozen fades at once and read as the page breaking. `prev` starts equal to
   * the current state, so the first paint is always silent.
   *
   * ⚠ Keyed on the LIVE state (`live.state`), ⛔ not the css class — the class
   * also flips between `playing` and `playingAside` when you swipe stages, and
   * that is a change of viewpoint, not a change in the night.
   */
  const phase = live?.state;
  const prev = useRef(phase);
  const [enter, setEnter] = useState(null);
  useEffect(() => {
    if (prev.current === phase) return undefined;
    const from = prev.current;
    prev.current = phase;
    if (!from || !phase) return undefined;      // into or out of a running night
    setEnter(phase === PLAYING ? 'enterPlaying' : phase === PLAYED ? 'enterPlayed' : null);
    const t = setTimeout(() => setEnter(null), ENTER_MS);
    return () => clearTimeout(t);
  }, [phase]);

  /* ⚠ `neighbour` rides ALONGSIDE the state class, ⛔ it does not replace one:
     the card either side of the stage is still upcoming or played and keeps
     every treatment that comes with that. The extra class only moves its
     scale halfway. */
  return (
    <div className={`${live ? s.live : ''} ${state ? s[state] : ''} ${neighbour ? s.neighbour : ''} ${enter ? s[enter] : ''}`.trim() || undefined}>
      <SlotCard
        slot={entry.slot}
        claim={entry.claim}
        isHost={false}
        allMixSlots={allMixSlots}
      />
      {live && <SetStrip live={live} claim={entry.claim} />}
    </div>
  );
}

/**
 * ⭐ THE PROFILE A FOLLOW WOULD ATTACH TO, or null.
 *
 * ⚠⚠ NULL IS A REAL ANSWER. Most acts on a bill are HAND-TYPED — a name an
 * organiser wrote, with no account and no profile — and there is nobody there
 * to follow. Per the Rendering Contract that is ABSENT, ⛔ not broken: the
 * offer simply does not appear. ⛔ Never render a follow control that cannot
 * complete.
 *
 * ⚠ `profile_id` is the CANONICAL key and `user_id` the legacy join key;
 * `FollowHeartBtn` needs both and knows what to do with them. ⛔ Do not
 * collapse them here — see the dual-keyspace note in that component.
 */
function followTarget(claim) {
  if (!claim?.profile_id) return null;
  return {
    ...(claim.profile || {}),
    id: claim.profile_id,
    user_id: claim.user_id ?? claim.profile?.user_id ?? null,
  };
}

/**
 * ⭐⭐ THE STRIP ALONG THE BOTTOM OF A CARD (owner, 2026-08-21): a 3px progress
 * bar, the phase in words, and — for a quarter of an hour after the set — the
 * offer to follow the act that just came off.
 *
 * ⚠⚠ IT OVERLAYS, ⛔ it does not stack. Adding a row under the card would change
 * that card's height, and on the pager every stage shares a grid row — so one
 * card growing a label would push its neighbours' rows out of alignment and
 * break the one thing the peek is for. Absolutely positioned inside the
 * wrapper, it costs no layout at all.
 *
 * ⚠ Only rendered while the night is running (the caller passes `live` only
 * then), so ⛔ no bars appear on an event that finished last March.
 */
function SetStrip({ live, claim }) {
  const label = phaseLabel(live.phase);
  const target = live.phase === FINISHED ? followTarget(claim) : null;
  return (
    <>
      {/**
        * ⭐⭐ THE BAR MEASURES ACTIVE PLAYING TIME, SO IT EXISTS ONLY WHILE A SET
        * IS PLAYING (owner, 2026-08-21, correcting the first cut).
        *
        * ⚠⚠ ⛔ NOT at 0% on an upcoming card, ⛔ not at 0% during GETTING READY,
        * ⛔ not at 100% on a finished one, and ⛔ not during the follow window.
        * An empty track on a card that has not started reads as "this set is at
        * zero percent" — which is a claim about a set in progress, and it is
        * false. A track that is absent says the only true thing: there is no
        * playing time to measure yet.
        *
        * ⚠ On a multi-stage night there is one bar PER STAGE that has something
        * on, including stages you are only peeking at — they are each genuinely
        * playing, and the peek must not lie about that.
        */}
      {live.state === PLAYING && (
        <div className={s.track} aria-hidden="true">
          <div className={s.fill} style={{ width: `${Math.round(live.progress * 100)}%` }} />
        </div>
      )}

      {target ? (
        /* ⚠ The press must not reach the card. A card's own click expands it,
           and a follow that also opened the row would read as two things
           happening for one tap. */
        /**
         * ⭐⭐ THE PROFILE PAGE'S FOLLOW BUTTON, CENTRED ON THE CARD (owner,
         * 2026-08-21). ⛔ Not the heart: this is an OFFER made in a fifteen
         * minute window to somebody who may never have seen the artist before,
         * so it has to say what it does. The heart is the right mark where the
         * reader already knows the act; here the words are the point.
         *
         * ⚠ The overlay fills the card and is INERT (`pointer-events: none`) —
         * only the button itself takes the press, so the rest of the card still
         * expands and the artwork behind stays reachable.
         */
        <span
          className={s.followOffer}
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
        >
          {/* ⚠ The gradient EDGE is a 1px parent behind the button, the same
              way ProfileScreen builds it — a gradient cannot be a border-color,
              and border-image loses the radius. */}
          <span className={s.followEdge}>
            <FollowHeartBtn profile={target} variant="label" className={s.followBtn} />
          </span>
        </span>
      ) : label ? (
        <span className={`${s.phase} ${live.phase === READY ? s.phaseReady : ''}`}>{label}</span>
      ) : null}
    </>
  );
}

/* ⛔ `TimelineDay` IS GONE (2026-08-21), and ⛔ do not reintroduce it. It was
   the separate single-stage list, and having two layouts meant every change to
   the schedule had to be made twice or made once and forgotten: the drag, the
   centred peek and the live states all landed on the pager first. A single
   stage now renders through `StagePager`, which drops its own chrome when
   there is only one page — see `single` in there. */

/**
 * MULTI STAGE — THE STAGE PAGER (⭐⭐ ratified from the harness prototype,
 * owner, 2026-08-20: "the festival fixture is how I want the normal set times
 * to be standard if there's multiple stages"). It replaced a sideways grid of
 * time columns, which is dead — ⛔ do not bring it back.
 *
 * Each stage is the SAME vertical timeline single-stage gets — full-width
 * SlotCards, top to bottom. Stages sit side by side as SNAP PAGES at 92%
 * width, CENTRED, so the neighbour peeks at BOTH edges: the app's own
 * part-card idiom doing the "you can swipe" hinting. No arrows, no tutorial.
 *
 * ⚠⚠ THE NUMBER HAS MOVED THREE TIMES AND THE END PAGES ARE WHY. Centring
 * splits the remainder in two, so it is tempting to widen the gap for a fatter
 * double peek — it was briefly 82% for exactly that. But the FIRST and LAST
 * stage have nothing on one side, so their WHOLE remainder lands on the other:
 * 82% put 84px of the next stage on page one, 86% put 64px, and the owner
 * wanted it smaller again both times. At 92% the sliver is a hint rather than
 * a visible card edge. ⛔ Read any change to this number off an END page,
 * never off a middle one.
 *
 * ⭐⭐ A MIDDLE STAGE IS SLICED ON BOTH SIDES (owner, 2026-08-21). Start-aligned
 * pages only ever peeked to the right, so standing on SECOND STAGE of three
 * hid MAIN entirely and the peek answered half the question it exists for.
 * The ends clamp themselves — stage one peeks right only, because to its left
 * there is genuinely nothing.
 *
 * ⭐⭐ ONE CSS GRID, ⛔ NOT THREE INDEPENDENT COLUMNS. Every stage's card for a
 * given time shares a GRID ROW, so rows align across stages and THE PEEK IS
 * THE COMPARISON: the sliver beside MAIN's 9:00 card is what is on next door
 * at 9:00, and a swipe lands you at the same moment of the night. That
 * alignment is the whole answer to "what's on the other stage right now" —
 * ⛔ do not swap this for per-stage scrollers, which lose it.
 *
 * ⚠ A TRUE GAP IS NOT AN OPEN SLOT. A stage with no slot at an axis time
 * holds its row open with a quiet hatched spacer naming the time — that is
 * "the organiser scheduled nothing here", information, not filler. An OPEN
 * SLOT is a real slot with nobody booked and renders as the card saying so.
 *
 * ⭐ Stage chips ride above, under the day chips' own law: lit by the
 * sideways SCROLL (not the click), tap to jump, ⛔ never a filter.
 */
function StagePager({ day, allMixSlots, now, sync }) {
  /* ⚠ ONE MAP FOR THE WHOLE DAY, so every stage answers from the same instant.
     Computed here rather than per cell: `playStates` walks the shared axis to
     work out the midnight rollover, and calling it per card would redo that
     walk for every slot on the page. */
  const states = slotStates(day, now);

  /**
   * ⭐ THE SWELL BELONGS TO THE PAGE YOU ARE ON. A playing set on a stage you
   * are only peeking at keeps its vibrancy but drops the scale — see
   * `.playingAside`. ⛔ It is not downgraded to "upcoming": it IS on now, and
   * saying otherwise in the peek would make the sliver lie.
   *
   * ⚠ Single-stage falls through as active (`activeStage` is 0 and so is its
   * only column), so a pub gig is unaffected by any of this.
   */
  const cellState = (slotId, stageIdx) => {
    const st = states.get(slotId)?.state;
    return st === PLAYING && stageIdx !== activeStage ? 'playingAside' : st;
  };


  /**
   * ⭐⭐ THE PAGER DRAGS WITH THE MOUSE (owner, 2026-08-21), through the app's
   * OWN rail drag — ⛔ not a second implementation. `useDragScroll` already
   * carries the two rules that took real time to get right: 1:1 tracking
   * (`DRAG_SPEED = 1`, moved twice, see the hook) and the capture-phase click
   * swallow, without which letting go of a drag OPENS whichever SlotCard
   * happens to sit under the cursor. A stage page is full of tappable cards,
   * so that second rule is not optional here.
   *
   * ⚠ Its `ref` is a CALLBACK ref that also exposes `.current`, which is why it
   * can replace the plain `useRef` this used to hold.
   */
  const dragScroll = useDragScroll();
  const scrollerRef = dragScroll.ref;
  /* ⭐⭐ ONE STAGE ACROSS THE WHOLE EVENT, ⛔ not one per day. Swiping any day
     moves every day, so the rooms stay stacked under one another and the
     festival reads down a single column. A per-day stage meant page 2 was the
     DJ stage on Friday and the workshops on Sunday. */
  const activeStage = sync.index;
  const dayKey = day.dayIndex;
  /* ⛔⛔ A PAGER MOVED BY THE SYNC MUST NEVER BROADCAST, or the days oscillate:
     a synced pager fires  mid-animation, reports the OLD page, and
     drags the one under the hand back. ⛔ Not a timer — a smooth scroll has no
     fixed duration. */
  const programmatic = useRef(false);
  const takeOver = () => { programmatic.current = false; };
  const stages = (day?.stages || []).filter(Boolean);
  /**
   * ⭐⭐ ONE PAGE DROPS THE PAGER'S CHROME ENTIRELY. A pub gig gets exactly what
   * it had: full-width cards down the page, no chips, no stage heading, no
   * snap and nothing to swipe. ⛔ NOT a narrow column with empty gutters —
   * there is no neighbour to peek at, so the peek would be dead space
   * advertising a swipe that does nothing.
   *
   * ⚠ SINGLE MEANS ONE PAGE, ⛔ not "unnamed". Naming your one room does not
   * earn festival chrome — the same rule `scheduleModel`'s `isMultiStage`
   * already states, restated because the temptation here is to show the name
   * just because there is one.
   */
  const single = stages.length <= 1;
  /* ⭐⭐ THE SAME GEOMETRY AS THE HOST SCHEDULE. A continuous 15-minute grid,
     stages merged by real clock time. ⛔ NOT a row per start time: that gave
     every act the same height whatever its length, ordered the axis by
     first-seen so disjoint stages read out of order, and had to invent a
     "nothing on" cell wherever one stage started at an hour another did not. */
  const grid = slotGrid(day, 15);
  const gaps = stageGaps(grid, { includeTrailing: false });

  /**
   * ⭐⭐ THE TWO CARDS EITHER SIDE OF THE STAGE SIT HALFWAY (owner, 2026-08-22).
   * Playing is full size, its neighbours 95%, everything else 90% — the night
   * reads as a run of sets with a focus, ⛔ not one card and a wall.
   *
   * ⚠ COMPUTED PER STAGE, ON THE ROW, ⛔ not with a CSS sibling selector. Each
   * card sits in its own grid cell wrapper, so `.playing + .upcoming` never
   * matches, and `:has()` would have to reach across two levels to say
   * something this component already knows: which row is playing.
   *
   * ⚠ A ROW neighbour, so it holds across a gap cell — the 10pm slot beside a
   * playing 9pm reads as "up next" whether or not the grid drew a NOTHING ON
   * row between them. ⛔ Do not swap this for DOM adjacency.
   *
   * ⚠ -1 when nothing is playing on that stage, so `rowIdx ± 1` can never
   * accidentally match row 0 before doors.
   *
   * ⛔ MUST STAY BELOW `cellsByStage` — it reads it, and a const referenced
   * above its declaration is a temporal dead zone crash, not a warning.
   */
  const playingRowByStage = stages.map((_st, sIdx) =>
    grid.stages[sIdx].findIndex(c => states.get(c.entry.slot.id)?.state === PLAYING));

  const isNeighbour = (rowIdx, stageIdx) => {
    const playingRow = playingRowByStage[stageIdx];
    return playingRow >= 0 && Math.abs(rowIdx - playingRow) === 1;
  };

  /**
   * ⭐⭐ POSITIONS ARE READ OFF THE HEADING CELLS, ⛔ NOT COMPUTED (2026-08-21).
   * Pages snap to CENTRE now, so a page's resting scrollLeft is no longer
   * `i * (column + gap)` — and at the two ends it is not even that, because
   * the scroller clamps: the first stage cannot centre, it sits against the
   * start. Any formula would therefore disagree with the browser exactly where
   * the disagreement is invisible, on the ends. The heading cells are the snap
   * targets, so their own measured geometry is the truth.
   *
   * ⚠⚠ MEASURED WITH `getBoundingClientRect`, ⛔ NEVER `offsetLeft`. `offsetLeft`
   * is relative to the nearest POSITIONED ancestor, which is not this scroller —
   * it read 152px too far here, and scroll-snap silently corrected the landing
   * afterwards, so the jump looked right while the number was wrong. The chip
   * scroll-spy has no snap to save it and would simply light the wrong stage.
   */
  const headAt = (el, i) => el.querySelectorAll(`.${s.stagePageHead}`)[i] || null;

  /** How far a cell's centre sits from the scroller's centre, in pixels now. */
  const offCentre = (el, cell) => {
    const box = el.getBoundingClientRect();
    const cb = cell.getBoundingClientRect();
    return (cb.left + cb.width / 2) - (box.left + box.width / 2);
  };

  const jumpTo = i => {
    sync.set(i, dayKey);
    const el = scrollerRef.current;
    const head = el && headAt(el, i);
    if (!el || !head) return;
    /* ⚠ Centre the page; the browser clamps this at both ends by itself, which
       is what makes the first and last stage sit flush rather than overscroll. */
    el.scrollTo({ left: el.scrollLeft + offCentre(el, head), behavior: 'smooth' });
  };

  const onScroll = e => {
    const el = e.currentTarget;
    const heads = el.querySelectorAll(`.${s.stagePageHead}`);
    if (!heads.length) return;
    /* The lit chip is whichever stage's centre is nearest the scroller's own
       centre — the same "where you are" reading the day chips use. */
    let best = 0;
    let bestGap = Infinity;
    heads.forEach((h, i) => {
      const gap = Math.abs(offCentre(el, h));
      if (gap < bestGap) { bestGap = gap; best = i; }
    });
    if (programmatic.current) {
      if (best === sync.index) programmatic.current = false;
      return;
    }
    if (best !== sync.index) sync.set(best, dayKey);
  };

  /**
   * ⭐⭐ SNAP IS SUSPENDED FOR THE LENGTH OF A DRAG, AND ⛔ ONLY A DRAG.
   *
   * ⚠⚠ This is the one thing the twelve existing rails never had to solve, and
   * it is not optional: `scroll-snap-type: x mandatory` re-snaps after every
   * write to `scrollLeft`, so the hook's 1:1 tracking gets yanked back to the
   * current page on every mousemove and the pager reads as immovable. Turning
   * snap off for the drag lets the hand move the schedule freely.
   *
   * ⭐ RESTORING IT IS THE RELEASE ANIMATION. The moment `mandatory` comes back
   * the browser settles to the nearest page itself — so letting go anywhere
   * lands on a whole stage, centred, with no easing code of our own and no
   * half-stage resting state to design around.
   */
  const suspendSnap = () => {
    const el = scrollerRef.current;
    if (el) el.style.scrollSnapType = 'none';
  };
  const restoreSnap = () => {
    const el = scrollerRef.current;
    if (el) el.style.scrollSnapType = '';
  };

  useEffect(() => {
    if (sync.from === dayKey) return;
    const el = scrollerRef.current;
    const head = el && headAt(el, sync.index);
    if (!el || !head) return;
    if (Math.abs(offCentre(el, head)) < 2) { programmatic.current = false; return; }
    programmatic.current = true;
    el.scrollTo({ left: el.scrollLeft + offCentre(el, head), behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.index, sync.from, dayKey]);

  const onMouseDown = e => { suspendSnap(); takeOver(); dragScroll.onMouseDown(e); };
  const onMouseUp = e => { dragScroll.onMouseUp(e); restoreSnap(); };
  /* ⚠ Leaving the scroller ends the drag (the hook's own rule), so snap has to
     come back here too — otherwise dragging out of the pager leaves it
     permanently unsnapped and every later swipe rests mid-stage. */
  const onMouseLeave = e => { dragScroll.onMouseLeave(e); restoreSnap(); };

  return (
    <>
      {!single && (
        <ChipRail
          items={stages.map(st => ({ key: st.id ?? 'implicit', label: st.name, accent: st.accent }))}
          activeIndex={activeStage}
          onPick={jumpTo}
        />
      )}

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseMove={dragScroll.onMouseMove}
        onMouseLeave={onMouseLeave}
        className={`${s.pager} ${single ? s.pagerSingle : ''}`}
        style={{
          gridTemplateColumns: single ? '100%' : `repeat(${stages.length}, 92%)`,
          gridTemplateRows: `auto repeat(${grid.rows}, minmax(var(--slot-interval), auto))`,
        }}
      >
        {/* Row 0 — the stage headings, and the snap targets. ⚠ CELLS ARE
            DIRECT GRID CHILDREN, ⛔ never wrapped per stage: a wrapper gives
            each stage its own formatting context and the rows stop sharing
            heights, which silently deletes the time alignment.
            ⚠ Skipped entirely when single: there is nothing to label and
            nothing to snap to, and an empty heading row would open the
            schedule with a blank band. */}
        {single ? null : stages.map(st => (
          <div key={'h' + (st.id ?? 'implicit')} className={s.stagePageHead}>
            <span
              className={s.stageName}
              style={st.accent ? { '--accent': st.accent } : undefined}
            >{st.name}</span>
            <div className={s.stageLine} />
          </div>
        ))}

        {/* ⭐ AN EMPTY STRETCH IS A BLANK CARD, ⛔ not a labelled filler row.
            ⛔ NOT after the last act: once a stage has closed there is nothing
            more to say, and a blank under the close reads as time still to
            fill. A stage that never ran at all keeps its blank. */}
        {gaps.map((runs, i) => runs.map(run => (
          <div
            key={'gap' + i + '-' + run.row}
            aria-hidden="true"
            className={es.stagePageFill}
            style={{ gridColumn: i + 1, gridRow: `${run.row + 1} / span ${run.span}` }}
          />
        )))}

        {stages.map((st, sIdx) => (
          <Fragment key={'c' + (st.id ?? 'implicit')}>
            {grid.stages[sIdx].map((cell, i) => (
              <div
                key={cell.entry.slot.id}
                /* ⭐ Same two degrees of short as the host schedule: under an
                   hour the padding gives way, half an hour or less also drops
                   AM/PM and the length. ⛔ Not a pixel test — change the
                   interval and these still mean "under an hour". */
                className={[
                  es.stagePageCell,
                  /* ⭐ This projection stacks: the card, then its expanded
                     panel, DOWN the page. ⛔ Never sideways over the next
                     stage. The host has a drag grip beside its card and states
                     the opposite. */
                  es.stagePageCellStacked,
                  cell.span < 4 ? es.stagePageCellShort : '',
                  cell.span <= 2 ? es.stagePageCellTiny : '',
                ].filter(Boolean).join(' ')}
                /* ⭐ `+ 1` for the heading row. The span is the set's real
                   length, so a 90 minute act is genuinely taller than an hour
                   one and the running order reads as a shape. */
                style={{
                  gridRow: `${cell.row + 1} / span ${cell.span}`,
                  gridColumn: sIdx + 1,
                  minHeight: `calc(var(--slot-interval) * ${cell.span})`,
                }}
              >
                <Card
                  entry={cell.entry}
                  allMixSlots={allMixSlots}
                  state={cellState(cell.entry.slot.id, sIdx)}
                  neighbour={isNeighbour(i, sIdx)}
                  live={states.get(cell.entry.slot.id)}
                />
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </>
  );
}

/* ⛔ `PAGER_GAP_PX` is gone deliberately. It mirrored the stylesheet's
   column-gap so the pager could COMPUTE where each page rests, and a constant
   that has to agree with a stylesheet is a constant that will one day not.
   Positions are read off the heading cells now — see `jumpTo`. */
