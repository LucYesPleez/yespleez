import { useState, useMemo, useEffect, Fragment } from 'react';
import EnquiryCard from './EnquiryCard';
import { normaliseStatus, isFadedDecline, DECLINE_FADE_DAYS } from '../lib/enquiryUtils';
import { DIR_TABS, EnquiryDirectionTabs, EnquiryStatusTabs, EnquirySearch } from './EnquiryTabs';

/* ⚠ DIR_TABS AND THE THREE CONTROLS NOW LIVE IN components/EnquiryTabs.jsx,
   unchanged. They moved the moment a THIRD surface needed them (artist, band
   and stand-up, which had hand-rolled their own and drifted). ⛔ Do not
   re-declare them here — that is precisely how the drift started. */

/**
 * The two orders an enquiry list can be read in. Labels say WHICH DATE, not
 * which direction — "newest" and "soonest" would both be true of one option
 * and neither tells you what is being sorted.
 *
 * ⚠ "APPLIED" / "REQUESTED" READ AS TWO KINDS OF APPLICATION, not as two
 * different DATES — "requested" in particular could mean the date they asked
 * for or an application they'd asked to be considered for. EVENT DATE /
 * ENQUIRY DATE name the two dates directly. `key` values are unchanged, so
 * `sort === 'applied' | 'requested'` elsewhere still works — this only
 * renames what the reader sees. Ordered EVENT DATE first: it's the date the
 * night actually falls on and the more common way to plan around it.
 */
const SORTS = [
  { key: 'requested', label: 'EVENT DATE',   hint: 'The date they want to play, soonest first' },
  { key: 'applied',   label: 'ENQUIRY DATE', hint: 'When the enquiry arrived, newest first' },
];

/**
 * ⚠ `viewerUserId` IS OPTIONAL AND ITS ABSENCE IS THE POINT. It exists so the
 * accepted-enquiry event picker can find the events this account hosts
 * (`events.host_id` — how the venue dashboard already loads its own). A screen
 * that must never offer event creation simply does not pass it, so the
 * capability is absent rather than merely hidden — the same discipline the
 * availability calendar uses for its private `markers`.
 */
export default function EnquiryPanel({ enquiries = [], viewerProfile, viewerUserId, onRespond, onPlayDemo, onClear }) {
  const [dirTab,    setDirTab]    = useState('INCOMING');
  const [statusTab, setStatusTab] = useState('NEW');
  const [search,    setSearch]    = useState('');

  /**
   * Cards pinned to the tab you are currently looking at.
   *
   * Opening a NEW enquiry auto-marks it 'seen' (EnquiryCard does this the
   * moment MORE INFO is tapped). That re-filtered the list underneath the
   * user: the card left the NEW tab for SEEN mid-gesture, so the panel you
   * had just opened vanished and had to be found and reopened somewhere else.
   * The status change is right; making it rearrange the list while you are
   * reading is not.
   *
   * So a card that transitions to 'seen' stays put until you leave the tab.
   * The tab COUNTS still move immediately — the badge is the honest record;
   * this only holds the row in place while it is being read.
   *
   * Deliberately 'seen' only. Shortlist / accept / decline are things you
   * chose, and the card leaving is the feedback that it worked.
   */
  const [sticky, setSticky] = useState(() => new Set());
  useEffect(() => { setSticky(new Set()); }, [dirTab, statusTab]);

  async function handleRespond(id, status) {
    if (status === 'seen') setSticky(s => new Set(s).add(id));
    await onRespond?.(id, status);
  }

  /**
   * ── ORDER · WHEN THEY ASKED vs WHEN THEY WANT ────────────────────────
   *
   * Two different questions, and a list can only answer one at a time:
   *
   *   APPLIED    newest first. The inbox reading — what has just come in.
   *   REQUESTED  soonest first. The diary reading — what is coming up, which
   *              is the order you actually book a season in.
   *
   * ⚠ THE DIRECTIONS ARE OPPOSITE ON PURPOSE. Newest-first is right for
   * arrivals because the recent ones are the live conversation; soonest-first
   * is right for gig dates because a date next week needs answering before one
   * in November. Sorting both the same way would make one of them useless.
   *
   * ⛔ UNDATED ROWS SINK, they are never treated as the epoch. An enquiry with
   * no requested date has not asked for the beginning of time — it has not
   * said. Sorting a null as 0 would pile every open-ended enquiry at the top
   * of the diary view, which is the opposite of what it is for. They fall to
   * the bottom and hold their arrival order among themselves.
   */
  const [sort, setSort] = useState('applied');

  /**
   * ⭐ THE 30-DAY FADE, APPLIED ONCE AND BEFORE EVERYTHING (owner, 2026-08-14).
   *
   * A rejections list is useful for a while and then it is only a monument.
   * Same rule the performer surface uses — the helper lives in enquiryUtils so
   * the two cannot keep different clocks.
   *
   * ⚠ AHEAD OF THE COUNTS, not just the list. A tab badge that counts rows the
   * list will not render is how you get an empty tab with a number on it.
   *
   * ⛔ ONLY SETTLED DECLINES FADE. An ask still waiting stays however long it
   * has been waiting: that it has waited is information, not clutter.
   */
  const visible = useMemo(() => enquiries.filter(e => !isFadedDecline(e)), [enquiries]);

  const filtered = useMemo(() => {
    const appliedAt   = e => new Date(e.created_at || 0).getTime();
    const requestedOn = e => e.date_requested || e.preferred_date || null;

    const byApplied = (a, b) => appliedAt(b) - appliedAt(a);
    const byRequested = (a, b) => {
      const da = requestedOn(a), db = requestedOn(b);
      if (!da && !db) return byApplied(a, b);
      if (!da) return 1;
      if (!db) return -1;
      return new Date(da) - new Date(db);
    };

    return visible
      .filter(e => {
        if (dirTab === 'BOOKED') {
          const st = (e.status || '').toLowerCase();
          return st === 'booked' || st === 'accepted';
        }
        const dir = (e.direction || 'incoming').toLowerCase();
        if (dir !== dirTab.toLowerCase()) return false;
        // Pinned rows stay visible in the tab they were opened in, even once
        // their status no longer matches it.
        return normaliseStatus(e) === statusTab.toLowerCase() || sticky.has(e.id);
      })
      .filter(e => !search || JSON.stringify(e).toLowerCase().includes(search.toLowerCase()))
      // Safe to sort in place: `.filter` already handed us a new array, so the
      // `enquiries` prop is never reordered under its owner.
      .sort(sort === 'requested' ? byRequested : byApplied);
  }, [visible, dirTab, statusTab, search, sticky, sort]);

  const currentDir = DIR_TABS.find(d => d.key === dirTab);

  /* ⚠ THE CALLER COUNTS, because only the caller knows what its rows are —
     EnquiryTabs renders chrome and reads no row. Both tallies are unchanged
     from the inline versions they replaced: BOOKED counts by STATUS (a booked
     row is booked whichever way it was asked), the other two by DIRECTION. */
  const dirCounts = useMemo(() => {
    const out = {};
    for (const { key } of DIR_TABS) {
      out[key] = visible.filter(e => {
        if (key === 'BOOKED') { const st = (e.status || '').toLowerCase(); return st === 'booked' || st === 'accepted'; }
        return (e.direction || 'incoming').toLowerCase() === key.toLowerCase();
      }).length;
    }
    return out;
  }, [visible]);

  const statusCounts = useMemo(() => {
    const out = {};
    for (const sub of currentDir?.subTabs || []) {
      out[sub] = visible.filter(e =>
        (e.direction || 'incoming').toLowerCase() === dirTab.toLowerCase() &&
        normaliseStatus(e) === sub.toLowerCase()
      ).length;
    }
    return out;
  }, [visible, currentDir, dirTab]);

  return (
    <div>
      <EnquiryDirectionTabs
        dirTab={dirTab}
        onChange={(key, firstSub) => { setDirTab(key); setStatusTab(firstSub); }}
        counts={dirCounts}
      />

      <EnquiryStatusTabs
        subTabs={currentDir?.subTabs}
        statusTab={statusTab}
        onChange={setStatusTab}
        dirColor={currentDir?.color}
        counts={statusCounts}
      />

      <EnquirySearch value={search} onChange={setSearch} />

      {/* ⭐ CLEAR ALL — only in DECLINED, only when there is something to
          sweep, and only when the surface supplied a way to clear. An
          always-present sweep above a list you might still be reading is an
          accident waiting to be tapped.

          ⚠ SWEEPS WHAT THIS TAB SHOWS, nothing more: the declined rows in the
          CURRENT direction. A button that also cleared the other direction's
          declines would be tidying a list you are not looking at.

          ⚠ SAYS WHAT SURVIVES. Clearing hides the row from YOUR list; the
          other side's record is untouched, and a label reading as deletion
          would claim otherwise. */}
      {onClear && statusTab === 'DECLINED' && filtered.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.35)' }}>
            Declines older than {DECLINE_FADE_DAYS} days clear themselves.
          </span>
          <button type="button" onClick={() => onClear(filtered)}
            style={{ marginLeft: 'auto', fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,.2)', background: 'transparent', color: 'rgba(255,255,255,.7)', cursor: 'pointer' }}>
            CLEAR ALL ({filtered.length})
          </button>
        </div>
      )}

      {/* ── SORT · A PREFERENCE, NOT A FILTER ────────────────────────────
          ⛔ NO PILL. A bordered pill put this at the same rank as INCOMING /
          OUTGOING / BOOKED, and in the dir tabs' yellow it read as a fourth
          filter that had been selected. It is neither: it does not change
          WHICH enquiries you see, only the order they arrive in. Pills and
          the yellow stay reserved for genuinely selected filter states
          (owner, 2026-08-13).

          ⚠ CONSTANT `--neon2`, NOT THE ACTIVE TAB'S HUE. Borrowing the dir
          colour was the thing that made it look like part of the filter set.
          A fixed accent says "this control belongs to a different family".

          Underline rather than fill, for the same reason the status sub-tabs
          use one: it marks a choice without claiming weight. */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: 'var(--muted)', marginRight: 14 }}>SORT BY</span>
        {SORTS.map(({ key, label, hint }, i) => {
          const active = sort === key;
          return (
            <Fragment key={key}>
              {i > 0 && (
                <span aria-hidden="true" style={{ color: 'rgba(255,255,255,.18)', margin: '0 12px', fontSize: 11, lineHeight: 1 }}>·</span>
              )}
              <button onClick={() => setSort(key)} title={hint}
                aria-pressed={active}
                style={{
                  fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5,
                  background: 'none', border: 'none', cursor: 'pointer',
                  // The gap between word and rule is what stops it reading as
                  // an underlined link.
                  padding: '2px 1px 4px',
                  borderBottom: `1.5px solid ${active ? 'var(--neon2)' : 'transparent'}`,
                  color: active ? '#fff' : 'var(--muted)',
                  transition: 'color .15s, border-color .15s',
                  whiteSpace: 'nowrap',
                }}
              >{label}</button>
            </Fragment>
          );
        })}
      </div>

      {/* Cards */}
      <div>
      {filtered.length === 0
        ? <p style={{ fontSize: 13, color: 'var(--muted)', padding: '12px 0' }}>
            {/* 10H: was `No ${statusTab.toLowerCase()} enquiries`, which read
                "No awaiting enquiries" / "No interested enquiries" for the
                OUTGOING sub-tabs. The active tab is already highlighted above,
                so the empty state needn't force the tab name into an
                adjective slot. */}
            No enquiries{search ? ' match your search' : ' here yet'}.
          </p>
        : filtered.map(enq => (
            <EnquiryCard key={enq.id} enq={enq} viewerProfile={viewerProfile} viewerUserId={viewerUserId} onRespond={handleRespond} onPlayDemo={onPlayDemo} onClear={onClear} />
          ))
      }
      </div>
    </div>
  );
}
