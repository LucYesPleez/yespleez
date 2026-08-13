import { useState, useMemo, useEffect, Fragment } from 'react';
import EnquiryCard from './EnquiryCard';
import { normaliseStatus } from '../lib/enquiryUtils';
import { STATUS_TAB_COLOR } from '../lib/enquiryUtils';

const DIR_TABS = [
  { key: 'INCOMING', color: '#FFD700', rgb: '255,215,0',
    subTabs: ['NEW', 'SEEN', 'SHORTLISTED', 'ACCEPTED', 'DECLINED'] },
  { key: 'OUTGOING', color: '#00B4D8', rgb: '0,180,216',
    subTabs: ['AWAITING', 'INTERESTED', 'ACCEPTED', 'DECLINED'] },
  { key: 'BOOKED',   color: '#00E5A0', rgb: '0,229,160',
    subTabs: [] },
];

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

function EnqTabBtn({ active, color, rgb, onClick, children }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5,
        padding: '5px 14px', borderRadius: 20, cursor: 'pointer',
        transition: 'background .15s, border-color .15s, color .15s',
        background: active ? `rgba(${rgb},.12)` : hov ? `rgba(${rgb},.08)` : 'transparent',
        border: `1.5px solid ${active ? color : hov ? `rgba(${rgb},.6)` : 'rgba(255,255,255,.12)'}`,
        /* ⚠ WHITE INK, COLOUR ON THE EDGE — the rule the status sub-tabs below
           already follow (`active ? '#fff' : muted`) and the enquiry card's
           status chip now follows too. This was the last control still putting
           its colour in the label, so INCOMING read as yellow text on a yellow
           border while the tab directly beneath it read as white on an orange
           underline. The tint and the border say which is selected; the word
           does not have to say it as well.
           ⛔ Inactive stays `--muted`, and the count badge keeps its hue — both
           match the sub-tabs exactly. */
        color: active || hov ? '#fff' : 'var(--muted)',
      }}
    >{children}</button>
  );
}

export default function EnquiryPanel({ enquiries = [], viewerProfile, onRespond, onPlayDemo }) {
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

    return enquiries
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
  }, [enquiries, dirTab, statusTab, search, sticky, sort]);

  const currentDir = DIR_TABS.find(d => d.key === dirTab);

  return (
    <div>
      {/* Direction tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {DIR_TABS.map(({ key, color, rgb, subTabs }) => {
          const cnt = enquiries.filter(e => {
            if (key === 'BOOKED') { const st = (e.status || '').toLowerCase(); return st === 'booked' || st === 'accepted'; }
            return (e.direction || 'incoming').toLowerCase() === key.toLowerCase();
          }).length;
          return (
            <EnqTabBtn key={key} active={dirTab === key} color={color} rgb={rgb}
              onClick={() => { setDirTab(key); setStatusTab(subTabs[0] || ''); }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {key}
                {cnt > 0 && <span style={{ fontSize: 9, fontFamily: "'DM Sans'", fontWeight: 700, background: dirTab === key ? `rgba(${rgb},.22)` : 'rgba(255,255,255,.06)', color: dirTab === key ? color : 'var(--muted)', borderRadius: 8, padding: '1px 5px' }}>{cnt}</span>}
              </span>
            </EnqTabBtn>
          );
        })}
      </div>

      {/* Status sub-tabs */}
      {currentDir && currentDir.subTabs.length > 0 && (
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,.08)', marginBottom: 10 }}>
          {currentDir.subTabs.map(sub => {
            const active = statusTab === sub;
            const subColor = STATUS_TAB_COLOR[sub] || currentDir.color;
            const cnt = enquiries.filter(e =>
              (e.direction || 'incoming').toLowerCase() === dirTab.toLowerCase() &&
              normaliseStatus(e) === sub.toLowerCase()
            ).length;
            return (
              <button key={sub} onClick={() => setStatusTab(sub)}
                style={{
                  flex: 1, background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5,
                  padding: '8px 4px 6px',
                  color: active ? '#fff' : 'var(--muted)',
                  borderBottom: `2px solid ${active ? subColor : 'transparent'}`,
                  transition: 'color .15s, border-color .15s',
                }}>
                {sub}
                {cnt > 0 && (
                  <span style={{
                    marginLeft: 4, fontSize: 9, fontFamily: "'DM Sans'", fontWeight: 700,
                    background: active ? `${subColor}22` : 'rgba(255,255,255,.06)',
                    color: active ? subColor : 'var(--muted)',
                    borderRadius: 8, padding: '1px 5px',
                  }}>{cnt}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', marginBottom: 8 }}>
        <span style={{ fontSize: 14 }}>🔍</span>
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by genre, vibe, act type…"
          style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 13 }}
        />
      </div>

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
            <EnquiryCard key={enq.id} enq={enq} viewerProfile={viewerProfile} onRespond={handleRespond} onPlayDemo={onPlayDemo} />
          ))
      }
      </div>
    </div>
  );
}
