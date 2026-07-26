import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../App';
import { supabase } from '../lib/supabase';
import { useConversationUi } from '../lib/conversationUi';
import HandIcon from '../components/HandIcon';
import PhoneNumberSettings from '../components/PhoneNumberSettings';
import {
  listConversations, listParticipants, actableProfileIds, unreadCount, latestMessages,
} from '../lib/messaging';
import { PROFILE_TYPES } from '../lib/profileTypes';

const inboxKey = userId => ['inbox', userId];

/**
 * The fetch waterfall this screen has always run: conversations →
 * participants → which are mine → one unread count per conversation →
 * latest message per conversation → decorate. Unchanged logic, just no
 * longer re-run from a cold `useState([])` on every mount — `useQuery`
 * below serves cached data immediately and revalidates in the background.
 */
async function fetchInboxRows() {
  const { conversations } = await listConversations();
  const ids = conversations.map(c => c.id);

  const { participants } = await listParticipants(ids);

  // §A4 — ask, never compute. One rpc per DISTINCT profile, not per row.
  const { mine } = await actableProfileIds(participants.map(p => p.profile_id));

  // §5.6 — the database counts; this screen only displays.
  const counts = await Promise.all(
    ids.map(id => unreadCount(id).then(r => [id, r.count])),
  );
  const countBy = Object.fromEntries(counts);

  const { byConversation: latest } = await latestMessages(ids);

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
    const last = latest[c.id];
    return {
      ...c, others, asProfile, isArchived,
      unread: countBy[c.id] ?? 0,
      // "You:" when the last word was yours — otherwise a preview reads as
      // though the other person said it, which is actively misleading when
      // you are waiting on a reply.
      preview: last
        ? { text: last.body, mine: mine.has(last.from_profile_id), kind: last.kind }
        : null,
    };
  });

  // Archived sinks, but is never removed — and its unread still counts.
  decorated.sort((a, b) => Number(a.isArchived) - Number(b.isArchived));
  return decorated;
}

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

/**
 * ONE colour for every context label — the brand gold.
 *
 * A colour per context (cyan application, green booking, and so on) meant the
 * reader had to learn five codes to gain nothing the word beside it did not
 * already say. Worse, each hex already carries a status or identity meaning
 * elsewhere in the app, so five of them here multiplied the collisions.
 *
 * One colour says the useful thing — "this thread came from a workflow, not a
 * DM" — and the WORD says which workflow. Adding a context later needs no
 * palette decision.
 */
const CONTEXT_COLOR = '#FFB830';

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
  const { open: openConversation, openId } = useConversationUi();
  const location = useLocation();
  const queryClient = useQueryClient();
  const userId = session?.user?.id;
  const [discoveryOpen, setDiscoveryOpen] = useState(false);

  // Cache-first, revalidate-in-background — this is the fix for the mount
  // cost. `staleTime`/`gcTime` come from the QueryClient default in App.jsx
  // (3min/10min), so navigating away and back renders the list instantly
  // from cache while a fresh fetch runs quietly behind it, instead of
  // blanking to LOADING… every single time.
  const { data: rows = [], isLoading: loading } = useQuery({
    queryKey: inboxKey(userId),
    queryFn: fetchInboxRows,
    enabled: !!userId,
  });

  /**
   * DEF-1 — the list stays LIVE while the dock is open.
   *
   * MSG-UX-5 made the inbox a long-lived mounted view: opening a conversation
   * overlays it rather than unmounting it. That removed the accidental remount
   * that used to refresh this list, so ordering, previews and unread counts
   * could drift indefinitely while the user worked in the dock.
   *
   * The fix is a subscription, not a refetch trigger. One channel covers every
   * conversation the caller participates in — RLS scopes realtime exactly as it
   * scopes reads, so no per-conversation filter is needed and none is used.
   *
   * Rows are updated IN PLACE. The list is never refetched, so an insert costs
   * one unread RPC for the affected conversation and nothing else.
   *
   * §5.6 — the unread count is re-read from the DATABASE rather than
   * incremented locally. Incrementing here would be a second counting rule,
   * and the whole point of that clause is that the four surfaces cannot
   * disagree. One targeted RPC is cheaper than being wrong.
   */
  useEffect(() => {
    if (!userId) return undefined;
    const key = inboxKey(userId);

    const channel = supabase
      .channel('inbox-live')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
      }, async ({ new: row }) => {
        const cid = row.conversation_id;

        // ⚠ A message in a conversation this list has never seen used to be
        // DROPPED, on the reasoning that inventing a placeholder row would mean
        // guessing participants we had not read.
        //
        // That reasoning was right and the conclusion was wrong. The first
        // message from someone new bumped the nav badge and changed nothing on
        // screen — "apparently a new message, but I cannot see who it is from",
        // and the only way to find it was to navigate away and back.
        //
        // Refetching is not guessing. It costs one round trip on an event that
        // fires when a stranger opens a conversation with you, and it is
        // self-limiting: once the row exists the conversation is `known` and
        // this path is not taken again.
        let known = false;
        queryClient.setQueryData(key, prev => {
          const list = prev ?? [];
          known = list.some(c => c.id === cid);
          if (!known) return list;
          return list
            .map(c => c.id === cid
              ? { ...c, last_message_at: row.created_at,
                  // Same shape the initial load writes, or a live message
                  // would update the timestamp and leave a stale preview.
                  // `mine` keys on the human here because the profile set is
                  // not in scope in this handler; it agrees in every real case.
                  preview: { text: row.body, mine: row.from_user_id === userId, kind: row.kind } }
              : c)
            // Re-sort on every insert so ordering is correct immediately
            // rather than at the next load. Archived still sinks (UX-4).
            .sort((a, b) => (Number(a.isArchived) - Number(b.isArchived))
              || (new Date(b.last_message_at ?? 0) - new Date(a.last_message_at ?? 0)));
        });
        if (!known) {
          // Refetch, which reads the participants properly rather than
          // inventing them. Old rows stay on screen while it runs — this is
          // the same stale-while-revalidate path a remount uses, not a
          // blocking reload.
          queryClient.invalidateQueries({ queryKey: key });
          return;
        }

        const { count } = await unreadCount(cid);
        queryClient.setQueryData(key, prev =>
          (prev ?? []).map(c => (c.id === cid ? { ...c, unread: count } : c)));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, queryClient]);

  /**
   * The other half of DEF-1: opening a conversation clears its unread here too.
   *
   * ConversationView advances the read watermark server-side, but that is a
   * write with no realtime event this list subscribes to, so without this the
   * row would keep showing a stale count until the next load — the same class
   * of staleness, just in the opposite direction.
   *
   * Mirrors what the dock already does to shell state rather than refetching,
   * so the two cannot disagree about a conversation the user is looking at.
   */
  useEffect(() => {
    if (!openId || !userId) return;
    queryClient.setQueryData(inboxKey(userId), prev =>
      (prev ?? []).map(c => (c.id === openId ? { ...c, unread: 0 } : c)));
  }, [openId, userId, queryClient]);

  // A deep link (/messages/:id, e.g. from a notification) redirects here and
  // carries the id as navigation state. Opening it once the route has settled
  // keeps the ONE messaging environment: the list is the home, the dock is the
  // workspace, and an external link lands in both rather than a third place.
  useEffect(() => {
    const wanted = location.state?.openConversation;
    if (wanted) openConversation(wanted);
  }, [location.state, openConversation]);

  return (
    <div style={{ paddingTop: 72, paddingBottom: 90, minHeight: '100dvh', background: 'var(--bg)', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 16px' }}>

        <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: 3, background: HEADING_GRADIENT, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', display: 'inline-block' }}>
            MESSAGES
          </div>
          {/* P1 · "find me by number" lives here for the same reason
              notification preferences live on the notifications screen (NP1):
              the app has no settings section, and this is where someone comes
              when they want to be reachable. */}
          <button
            type="button"
            onClick={() => setDiscoveryOpen(o => !o)}
            aria-expanded={discoveryOpen}
            style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border)', borderRadius: 999, color: 'var(--muted)', fontFamily: "'Bebas Neue', sans-serif", fontSize: 12, letterSpacing: 1.5, padding: '5px 12px', cursor: 'pointer' }}
          >
            {discoveryOpen ? 'DONE' : 'FIND ME'}
          </button>
        </div>

        {discoveryOpen && <PhoneNumberSettings session={session} />}

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
                  ? {
                      id: other.profiles.id,
                      name: other.profiles.name,
                      type: other.profiles.type,
                      // Seeded here as well as in ConversationView, so a tab
                      // minimised immediately shows the avatar rather than an
                      // initial until the conversation finishes loading.
                      avatar: other.profiles.avatar_thumb || other.profiles.avatar || null,
                    }
                  : null,
              })}
              // Parity with the conversation surface: 18px radius and the same
              // rgba(255,255,255,.09) border language, rather than the older
              // 14px / var(--border) pairing. An unread row is lifted slightly
              // instead of being a different colour — weight, not hue.
              // A LIST, not a stack of cards. Boxing every conversation made
              // eight rows read as eight objects; a hairline divider separates
              // them without drawing eight rectangles, and the page gets much
              // denser for free.
              style={{
                display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', textDecoration: 'none',
                border: 'none',
                borderBottom: '1px solid rgba(255,255,255,.055)',
                borderRadius: 10,
                padding: '13px 12px',
                marginBottom: 0,
                background: c.unread > 0 ? 'rgba(191,95,255,.055)' : 'transparent',
                // Glow kept but pulled back ~40% (.35 → .21) and the ring
                // dropped: with no border to sit on, a tight ring read as an
                // outline. What is left is a soft bloom behind the row.
                boxShadow: c.unread > 0 ? '0 0 18px rgba(191,95,255,.21)' : 'none',
                opacity: c.isArchived ? 0.55 : 1,
              }}
            >
              {/* ONE band. The context label and timestamp used to sit in a
                  second row above the avatar, which is what made every entry
                  two-storey. Time now rides beside the name, and the context
                  label moves down next to the identity where it costs no
                  height. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 46, height: 46, borderRadius: 999, flexShrink: 0, padding: 2, background: `linear-gradient(135deg, ${accent}, ${PROFILE_TYPES[other?.profiles?.type]?.accent2 ?? '#00E5FF'})`, display: 'flex' }}>
                  <span style={{ width: '100%', height: '100%', borderRadius: 999, overflow: 'hidden', background: '#0d0d10', display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent, fontFamily: "'Bebas Neue',sans-serif", fontSize: 17 }}>
                    {(other?.profiles?.avatar_thumb || other?.profiles?.avatar || PROFILE_TYPES[other?.profiles?.type]?.defaultImage)
                      ? <img src={other?.profiles?.avatar_thumb || other?.profiles?.avatar || PROFILE_TYPES[other?.profiles?.type]?.defaultImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : (other?.profiles?.name ?? '?').slice(0, 1).toUpperCase()}
                  </span>
                </span>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <div style={{ minWidth: 0, flexShrink: 1, color: 'var(--text)', fontSize: 16, fontWeight: c.unread > 0 ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {other?.profiles?.name ?? 'Unknown'}
                    </div>

                    {/* WHY this conversation exists, beside the name like a
                        subtitle. `direct` is omitted: it is the default case,
                        so it appeared on most rows and told the reader nothing.
                        A booking or an application is genuinely useful context
                        — it says what the thread is FOR. */}
                    {/* Context and identity, plain text beside the name. No
                        pill: a chip is a container, and containers imply
                        something you can act on. These are just qualifiers on
                        the name — WHY the conversation exists and WHO you are
                        in it. Neutral rather than the profile accent, so a
                        booking reads the same whoever it is with. */}
                    {/* Identity stays beside the name — it qualifies WHO you
                        are talking as, so it belongs to the name. */}
                    {c.asProfile && c.asProfile.type !== 'punter' && (
                      <span style={{ flexShrink: 0, fontSize: 11, color: 'rgba(255,255,255,.4)' }}>
                        as <span style={{ color: '#D9A6FF', fontWeight: 600 }}>{c.asProfile.name}</span>
                      </span>
                    )}

                    {/* Context rides the NAME line, right-aligned. One item per
                        line rather than a two-line column beside a one-line
                        name — that column was what stretched the row and left
                        a gap under the name. */}
                    {c.context_type !== 'direct' && (
                      <span style={{ marginLeft: 'auto', flexShrink: 0, fontFamily: "'Bebas Neue',sans-serif", fontSize: 13, letterSpacing: 1.4, color: CONTEXT_COLOR }}>
                        {CONTEXT_LABEL[c.context_type] ?? String(c.context_type).toUpperCase()}
                      </span>
                    )}
                  </div>

                  {/* Preview and timestamp share the second line: what was said
                      and when it was said belong together. The preview
                      truncates; the time never does. */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 3 }}>
                    <div style={{ minWidth: 0, flex: 1, fontSize: 13, lineHeight: 1.35, color: c.unread > 0 ? 'rgba(255,255,255,.78)' : 'rgba(255,255,255,.42)', fontWeight: c.unread > 0 ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.preview?.mine && (
                        <span style={{ color: 'rgba(255,255,255,.34)' }}>You: </span>
                      )}
                      {/* No word, deliberately — the mark is meant to be read
                          on its own rather than always introduced by name.
                          `aria-label` still gives screen readers something,
                          it's just not painted on screen. */}
                      {c.preview?.kind === 'hand' ? (
                        <span role="img" aria-label="Acknowledged" style={{ display: 'inline-flex', verticalAlign: 'middle' }}>
                          <HandIcon size={14} />
                        </span>
                      ) : (c.preview?.text ?? '')}
                    </div>
                    <span style={{ flexShrink: 0, fontSize: 11, color: c.unread > 0 ? '#D9A6FF' : 'rgba(255,255,255,.35)' }}>
                      {relativeTime(c.last_message_at)}
                    </span>
                  </div>

                  {/* IDENTITY, only when it is not the obvious one.
                      Speaking as your Personal profile is the default — saying
                      so on every row is noise, and it buried the cases that
                      matter. When you ARE talking as Beat Cave or a festival,
                      that is genuinely load-bearing: §2.1 fixes it for the life
                      of the conversation, so a second thread with the same
                      person is otherwise indistinguishable.

                      With a punter identity and a direct context, this line
                      disappears entirely and the row loses a whole storey. */}
                  {/* Identity moved up beside the name, so this line now
                      exists only for the archived state — which is rare, and
                      the one thing that genuinely wants its own line because
                      it describes the row rather than the conversation. */}
                  {c.isArchived && (
                    <div style={{ marginTop: 3, fontSize: 9.5, letterSpacing: 1, color: 'rgba(255,255,255,.3)' }}>
                      ARCHIVED
                    </div>
                  )}
                </div>

                {c.unread > 0 && (
                  <div aria-label={`${c.unread} unread`} style={{ alignSelf: 'flex-start', minWidth: 20, height: 20, borderRadius: 999, background: 'var(--neon)', color: '#000', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>
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
