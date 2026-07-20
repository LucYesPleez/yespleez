import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../App';
import {
  listConversations, listParticipants, actableProfileIds, unreadCount,
} from '../lib/messaging';
import { PROFILE_TYPES } from '../lib/profileTypes';

/**
 * INBOX — the conversation list.
 *
 * Every read goes through `lib/messaging.js`. This screen issues no Supabase
 * call of its own and asks no ownership question of its own: which profile is
 * "mine" comes from `can_act_as` via `actableProfileIds`, per §A4.
 *
 * ── ARCHIVED STILL COUNTS (owner decision, 20 Jul 2026) ──────────────
 *
 * §2.6 makes `archived` per-participant — so per PROFILE — while §2.5 makes
 * unread per HUMAN. They cannot both be honoured cleanly. The ruling: an
 * archived conversation STILL contributes to unread, because the alternative
 * can silently hide a booking enquiry from someone. Archived threads are moved
 * down the list, never out of the count.
 *
 * ── UNREAD COMES FROM THE DATABASE (§5.6) ────────────────────────────
 *
 * One counting rule, four surfaces. This screen calls
 * `conversation_unread_count` rather than comparing timestamps locally — a
 * surface that counts for itself is a surface that can disagree with the badge.
 */

const HEADING_GRADIENT = 'linear-gradient(135deg, #00E5FF, #BF5FFF)';

/** §C14 — the context records the ORIGIN, so it is a stable label. */
const CONTEXT_LABEL = {
  application: 'APPLICATION',
  invitation:  'INVITATION',
  booking:     'BOOKING',
  event:       'EVENT',
  venue:       'VENUE',
};

function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1)    return 'just now';
  if (mins < 60)   return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)    return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)    return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function InboxScreen() {
  const { session } = useSession();
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) { setLoading(false); return; }
    const cancelled = { current: false };

    (async () => {
      const { conversations } = await listConversations();
      if (cancelled.current) return;

      const ids = conversations.map(c => c.id);
      const { participants } = await listParticipants(ids);
      if (cancelled.current) return;

      // §A4 — ask, never compute. One rpc per DISTINCT profile, not per row.
      const { mine } = await actableProfileIds(participants.map(p => p.profile_id));
      if (cancelled.current) return;

      // §5.6 — the database counts; this screen only displays.
      const counts = await Promise.all(
        ids.map(id => unreadCount(id).then(r => [id, r.count])),
      );
      if (cancelled.current) return;
      const countBy = Object.fromEntries(counts);

      const decorated = conversations.map(c => {
        const mates = participants.filter(p => p.conversation_id === c.id);
        // §2.2 — a conversation is a relationship; show the OTHER party.
        const others = mates.filter(p => !mine.has(p.profile_id));
        // Archived is per-participant, so it is MY participant row that decides.
        const isArchived = mates.some(p => mine.has(p.profile_id) && p.archived_at);
        return { ...c, others, isArchived, unread: countBy[c.id] ?? 0 };
      });

      // Archived sinks, but is never removed — and its unread still counts.
      decorated.sort((a, b) => Number(a.isArchived) - Number(b.isArchived));

      setRows(decorated);
      setLoading(false);
    })();

    return () => { cancelled.current = true; };
  }, [session]);

  return (
    <div style={{ paddingTop: 72, paddingBottom: 90, minHeight: '100dvh', background: 'var(--bg)', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 16px' }}>

        <div style={{ marginBottom: 24 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: 3, background: HEADING_GRADIENT, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', display: 'inline-block' }}>
            MESSAGES
          </div>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,.35)', fontFamily: "'Bebas Neue',sans-serif", fontSize: 14, letterSpacing: 2, padding: '48px 0' }}>
            LOADING…
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div style={{ textAlign: 'center', padding: '64px 0' }}>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, letterSpacing: 2, color: 'rgba(255,255,255,.3)' }}>
              NO CONVERSATIONS YET
            </div>
            {/* §4.3 / C17 — there is no cold DM. Saying so prevents the
                reasonable assumption that a "new message" button is missing. */}
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.2)', marginTop: 6, lineHeight: 1.5 }}>
              Conversations start from an application, invitation or booking —
              not from a blank message.
            </div>
          </div>
        )}

        {!loading && rows.map(c => {
          const other = c.others[0];
          const accent = PROFILE_TYPES[other?.profiles?.type]?.accent ?? 'var(--muted)';
          return (
            <Link
              key={c.id}
              to={`/messages/${c.id}`}
              style={{ display: 'block', textDecoration: 'none', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', marginBottom: 10, background: c.unread > 0 ? 'rgba(255,255,255,.04)' : 'transparent', opacity: c.isArchived ? 0.55 : 1 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 11, letterSpacing: 1.5, color: accent }}>
                  {CONTEXT_LABEL[c.context_type] ?? c.context_type.toUpperCase()}
                </div>
                {c.subject_state && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                    {c.subject_state}
                  </div>
                )}
                {c.isArchived && (
                  <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 1 }}>ARCHIVED</div>
                )}
                <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>
                  {relativeTime(c.last_message_at)}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                <div style={{ color: 'var(--text)', fontSize: 15, fontWeight: c.unread > 0 ? 600 : 400 }}>
                  {other?.profiles?.name ?? 'Unknown'}
                </div>
                {c.unread > 0 && (
                  <div aria-label={`${c.unread} unread`} style={{ marginLeft: 'auto', minWidth: 20, height: 20, borderRadius: 999, background: 'var(--neon)', color: '#000', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>
                    {c.unread}
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
