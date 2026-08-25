import {
  listConversations, listParticipants, actableProfileIds, unreadCount, latestMessages,
} from './messaging';

/**
 * THE INBOX QUERY — the key, the fetch, and the app-open warm-up.
 *
 * Extracted from InboxScreen so App can warm the cache without importing a
 * screen. The screen still owns every pixel; this module owns only the read.
 *
 * ── WHY WARM IT AT ALL ───────────────────────────────────────────────
 *
 * The fetch is a five-step waterfall (conversations → participants → which are
 * mine → an unread count each → latest message each), so the FIRST visit to
 * Messages is the one that shows LOADING… the longest — and it is also the
 * visit where the user has no idea whether the app has any messages in it. A
 * cold empty screen on a first tap reads as "there is nothing here", which is
 * a lie the cache tells only once but tells to everyone.
 *
 * Every visit after that is already instant: the QueryClient default is
 * staleTime 3min / gcTime 10min, so navigating away and back renders from
 * cache. Warming at app open simply moves the first paint into the window
 * where the user is looking at something else.
 *
 * ⛔ THE WARM-UP IS NOT A SUBSCRIPTION. It fills the cache once per app open
 * and then gets out of the way — the screen's own useQuery revalidates, and
 * realtime keeps it honest while the screen is mounted. Polling here would
 * make every signed-in session pay for a screen nobody opened.
 */

/** ⚠ Keyed by user, so a sign-out/sign-in never serves the previous inbox. */
export const inboxKey = userId => ['inbox', userId];

/**
 * The fetch waterfall this screen has always run: conversations →
 * participants → which are mine → one unread count per conversation →
 * latest message per conversation → decorate. Unchanged logic, just no
 * longer re-run from a cold `useState([])` on every mount — the screen's
 * `useQuery` serves cached data immediately and revalidates in the background.
 */
export async function fetchInboxRows() {
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
 * Warm the inbox cache at app open. Returns true when a prefetch was actually
 * issued, so the caller (and its test) can tell "warmed" from "declined".
 *
 * DECLINES, deliberately, when:
 *   · there is no signed-in user — an anonymous visitor has no inbox, and
 *     asking for one is a guaranteed empty round trip on the slowest part of
 *     a first load (discovery is anonymous; participation is identified);
 *   · the key already holds data — a sign-in that follows a warm session, or
 *     StrictMode's second effect, must not refetch the waterfall.
 *
 * ⛔ NEVER let this throw into the caller. It runs beside analytics and the
 * outbox flush in App's open effect, where a rejection would surface as a
 * broken app start over a cache that simply stayed cold. `prefetchQuery`
 * already swallows fetch errors; the try/catch guards the cache lookup too.
 */
export function prefetchInbox(queryClient, userId) {
  if (!queryClient || !userId) return false;
  try {
    const key = inboxKey(userId);
    if (queryClient.getQueryData(key) !== undefined) return false;
    void queryClient.prefetchQuery({ queryKey: key, queryFn: fetchInboxRows });
    return true;
  } catch {
    return false;
  }
}
