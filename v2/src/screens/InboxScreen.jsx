import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useSession } from '../App';
import { useConversationUi } from '../lib/conversationUi';
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
  const { open: openConversation } = useConversationUi();
  const location = useLocation();
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);

  // A deep link (/messages/:id, e.g. from a notification) redirects here and
  // carries the id as navigation state. Opening it once the route has settled
  // keeps the ONE messaging environment: the list is the home, the dock is the
  // workspace, and an external link lands in both rather than a third place.
  useEffect(() => {
    const wanted = location.state?.openConversation;
    if (wanted) openConversation(wanted);
  }, [location.state, openConversation]);

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
        // Which of MY profiles is in this thread. Without it, three
        // conversations with the same artist render as three identical rows.
        // When BOTH participants are yours the thread is really note-keeping,
        // so Personal is treated as "you" and the industry profile as the
        // recipient. Deterministic, unlike "whichever row came back first" —
        // and it means the same thread never renders swapped between loads.
        const asRow = mates.find(p => mine.has(p.profile_id) && p.profiles?.type === 'punter')
                   ?? mates.find(p => mine.has(p.profile_id));
        const asProfile = asRow?.profiles ?? null;

        // The other party is "everyone except the profile I am sending as" —
        // NOT "everyone I cannot act as". A user can legitimately message
        // between two of their OWN profiles (Personal → Dusky Waters), and the
        // ownership-based version returns an empty set for those, rendering
        // the row as "Unknown".
        const others = mates.filter(p => p.profile_id !== asRow?.profile_id);
        // Archived is per-participant, so it is MY participant row that decides.
        const isArchived = mates.some(p => mine.has(p.profile_id) && p.archived_at);
        return { ...c, others, asProfile, isArchived, unread: countBy[c.id] ?? 0 };
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
            <button
              key={c.id}
              type="button"
              // Opens the DRAWER rather than navigating. Navigation is the
              // context switch the interaction model exists to avoid — the
              // inbox is for search, archive and management, not for reading.
              onClick={() => openConversation(c.id, {
                profile: other?.profiles
                  ? { id: other.profiles.id, name: other.profiles.name, type: other.profiles.type }
                  : null,
              })}
              style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', textDecoration: 'none', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', marginBottom: 10, background: c.unread > 0 ? 'rgba(255,255,255,.04)' : 'transparent', opacity: c.isArchived ? 0.55 : 1 }}
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

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
                <span style={{ width: 46, height: 46, borderRadius: 999, flexShrink: 0, padding: 2, background: `linear-gradient(135deg, ${accent}, ${PROFILE_TYPES[other?.profiles?.type]?.accent2 ?? '#00E5FF'})`, display: 'flex' }}>
                  <span style={{ width: '100%', height: '100%', borderRadius: 999, overflow: 'hidden', background: '#0d0d10', display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent, fontFamily: "'Bebas Neue',sans-serif", fontSize: 17 }}>
                    {(other?.profiles?.avatar_thumb || other?.profiles?.avatar || PROFILE_TYPES[other?.profiles?.type]?.defaultImage)
                      ? <img src={other?.profiles?.avatar_thumb || other?.profiles?.avatar || PROFILE_TYPES[other?.profiles?.type]?.defaultImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : (other?.profiles?.name ?? '?').slice(0, 1).toUpperCase()}
                  </span>
                </span>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: 'var(--text)', fontSize: 16, fontWeight: c.unread > 0 ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {other?.profiles?.name ?? 'Unknown'}
                  </div>
                  {/* WHICH IDENTITY THIS THREAD IS FROM. Three conversations
                      with the same artist are otherwise three identical rows. */}
                  {c.asProfile && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                      <span style={{ fontSize: 9.5, letterSpacing: 1, color: 'rgba(255,255,255,.35)', fontFamily: "'Bebas Neue',sans-serif" }}>
                        YOU ARE
                      </span>
                      <span style={{ fontSize: 12, color: '#D9A6FF', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.asProfile.name}
                      </span>
                    </div>
                  )}
                </div>
                {c.unread > 0 && (
                  <div aria-label={`${c.unread} unread`} style={{ marginLeft: 'auto', minWidth: 20, height: 20, borderRadius: 999, background: 'var(--neon)', color: '#000', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>
                    {c.unread}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
