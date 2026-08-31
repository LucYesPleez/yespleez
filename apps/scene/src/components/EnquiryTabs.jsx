import { useState } from 'react';
import { STATUS_TAB_COLOR } from '../lib/enquiryUtils';

/**
 * ⭐⭐ THE ENQUIRIES CHROME — ONE SET OF TABS FOR EVERY PROFILE TYPE.
 *
 * Owner, 2026-08-14: "the whole enquiries needs to match host and venues on
 * the front end… theyre sposed to look the same and have the correct backend
 * wired."
 *
 * ⚠ THIS IS AN EXTRACTION, NOT A REDESIGN. Every style below is lifted
 * verbatim from EnquiryPanel, which venue and host already render. Nothing
 * about their surface may move as a result of this file existing — that is the
 * test of whether the extraction was done honestly.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────
 *
 * Venue and host rendered EnquiryPanel; artist, band and stand-up hand-rolled
 * the same three tabs inline. The two drifted exactly as copies do:
 *
 *   · the direction pills coloured their LABEL on the artist and their BORDER
 *     on the venue — the white-ink fix was made once, in the shared component,
 *     and the three dashboards that never adopted it never got it;
 *   · the sub-headings said NEW / CONSIDERING / ACCEPTED / HISTORY on one side
 *     and NEW / SEEN / SHORTLISTED / ACCEPTED / DECLINED on the other;
 *   · the enquiry calendar chip existed on two surfaces out of five.
 *
 * ⛔ A FOURTH COPY IS THE FAILURE MODE. If a surface needs a tab this file
 * does not offer, add it here rather than re-implementing the row — the drift
 * above is what re-implementing looks like a year later.
 *
 * ⚠ CHROME ONLY. It owns the tabs, the sub-tabs and the search field; it owns
 * NO rows and knows nothing about where they came from. That is deliberate:
 * an artist reading an OFFER and a venue triaging an ASK are different reading
 * tasks with different cards, and forcing one card would delete the offer
 * triage design (OpportunityCard → BookingInvitation) to make the code match.
 */

/**
 * The four directions, their colours, and the sub-tabs each one offers.
 *
 * ⭐⭐ HISTORY IS CANONICAL — every profile type has one (owner, 2026-08-31).
 *
 * BOOKED is what is coming up; everything already done moves one tab across,
 * ⛔ never one level down. It began as UPCOMING / PAST sub-tabs under the
 * performer surfaces' BOOKED, which put twelve played gigs beneath one
 * upcoming one, and it was briefly a performer-only opt-in on the theory that
 * only a performer surface has a played/not-played axis. ⛔ THAT WAS WRONG: a
 * booked NIGHT is as past-or-future as a booked GIG, and a venue looking at
 * last month's confirmed bookings is asking the same question the act is.
 *
 * ⚠ WHAT "PAST" MEANS IS THE SURFACE'S ANSWER, not this file's — a performer
 * reads it off the lineup-derived gig, a venue off the enquiry's date. This
 * file renders chrome and reads no row, which is why it can afford to be the
 * one place the tab is DECLARED.
 *
 * ⚠ `#888` is the same grey `STATUS_TAB_COLOR.HISTORY` already uses. Past is
 * not a live state and must not compete with BOOKED's green for the eye.
 */
export const DIR_TABS = [
  { key: 'INCOMING', color: '#FFD700', rgb: '255,215,0',
    subTabs: ['NEW', 'SEEN', 'SHORTLISTED', 'ACCEPTED', 'DECLINED'] },
  { key: 'OUTGOING', color: '#00B4D8', rgb: '0,180,216',
    subTabs: ['AWAITING', 'INTERESTED', 'ACCEPTED', 'DECLINED'] },
  { key: 'BOOKED',   color: '#00E5A0', rgb: '0,229,160',
    subTabs: [] },
  { key: 'HISTORY',  color: '#888',    rgb: '136,136,136',
    subTabs: [] },
];

/**
 * ⚠ WHITE INK, COLOUR ON THE EDGE — the rule the status sub-tabs already
 * follow and the enquiry card's status chip follows too. Putting the colour in
 * the label made INCOMING read as yellow text on a yellow border while the tab
 * directly beneath it read as white on an orange underline.
 * ⛔ Inactive stays `--muted`, and the count badge keeps its hue.
 */
function EnqTabBtn({ active, color, rgb, onClick, children }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5,
        padding: '5px 14px', borderRadius: 20, cursor: 'pointer',
        transition: 'background .15s, border-color .15s, color .15s',
        background: active ? `rgba(${rgb},.12)` : hov ? `rgba(${rgb},.08)` : 'transparent',
        border: `1.5px solid ${active ? color : hov ? `rgba(${rgb},.6)` : 'rgba(255,255,255,.12)'}`,
        color: active || hov ? '#fff' : 'var(--muted)',
      }}
    >{children}</button>
  );
}

/**
 * INCOMING / OUTGOING / BOOKED / HISTORY.
 * @param counts  { INCOMING: n, … } — the caller counts, because only the
 *                caller knows what its rows are.
 */
export function EnquiryDirectionTabs({ dirTab, onChange, counts = {} }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
      {DIR_TABS.map(({ key, color, rgb, subTabs }) => {
        const cnt = counts[key] || 0;
        return (
          <EnqTabBtn key={key} active={dirTab === key} color={color} rgb={rgb}
            onClick={() => onChange(key, subTabs[0] || '')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {key}
              {cnt > 0 && (
                <span style={{ fontSize: 9, fontFamily: "'DM Sans'", fontWeight: 700, background: dirTab === key ? `rgba(${rgb},.22)` : 'rgba(255,255,255,.06)', color: dirTab === key ? color : 'var(--muted)', borderRadius: 8, padding: '1px 5px' }}>{cnt}</span>
              )}
            </span>
          </EnqTabBtn>
        );
      })}
    </div>
  );
}

/**
 * The status sub-tabs beneath whichever direction is selected.
 * @param subTabs   labels to render — normally DIR_TABS' own, but BOOKED
 *                  supplies its own pair on the performer surface (see below).
 * @param dirColor  fallback underline colour for a label with no entry in
 *                  STATUS_TAB_COLOR.
 * @param counts    { LABEL: n }
 */
export function EnquiryStatusTabs({ subTabs = [], statusTab, onChange, dirColor, counts = {} }) {
  if (!subTabs.length) return null;
  return (
    <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,.08)', marginBottom: 10 }}>
      {subTabs.map(sub => {
        const active   = statusTab === sub;
        const subColor = STATUS_TAB_COLOR[sub] || dirColor;
        const cnt      = counts[sub] || 0;
        return (
          <button key={sub} onClick={() => onChange(sub)}
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
  );
}

/** One search field, one placeholder voice. */
export function EnquirySearch({ value, onChange, placeholder = 'Search by genre, vibe, act type…' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', marginBottom: 8 }}>
      <span style={{ fontSize: 14 }}>🔍</span>
      <input
        type="text" value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 13 }}
      />
    </div>
  );
}
