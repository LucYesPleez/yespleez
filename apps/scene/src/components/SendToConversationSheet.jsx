import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  listConversations, listParticipants, actableProfileIds, sendMessage,
} from '../lib/messaging';

/**
 * SEND TO — pick a conversation, send the thing you were looking at.
 *
 * The missing half of sharing. The share sheet has always offered "copy link"
 * and the phone's own menu, which send people OUT of the app to bring
 * something back in. This keeps it inside.
 *
 * ── ⚠⚠ IT SENDS AS YOU-IN-THAT-THREAD, NOT AS "YOU" ──────────────────
 *
 * A person can be several acts, and a conversation is between two PROFILES,
 * fixed at creation (§2.1). So the sender is not a choice this sheet offers —
 * it is whichever of your profiles is already in that thread. Asking would be
 * worse than useless: picking a profile that is not a participant produces a
 * message the policy rejects, and picking a different one mid-thread would
 * make you appear to be two people in one conversation.
 *
 * ⭐ Same derivation the inbox uses to decide whose name to show, and for the
 * same reason: a Personal profile is treated as "you" when both parties are
 * yours, so the thread does not render swapped.
 *
 * ── ⛔ NO NEW CONVERSATIONS FROM HERE ─────────────────────────────────
 *
 * You may only send into a thread that already exists. Starting one is a
 * different act with different consequences — §4.3 makes creation automatic
 * from workflow acts, and the client is granted no INSERT on `conversations`
 * at all. A "share to someone new" flow is a product decision, not a row in
 * this list.
 */
export default function SendToConversationSheet({ title, buildMessage, onClose, onSent }) {
  const queryClient = useQueryClient();
  const [rows, setRows]       = useState(null);   // null = still loading
  const [query, setQuery]     = useState('');
  const [sendingTo, setSending] = useState(null);
  const [error, setError]     = useState('');
  const [sentTo, setSentTo]   = useState(new Set());
  /**
   * ⭐ The row most recently sent to, named — so the confirmation can be shown
   * where the finger ISN'T. See the banner below the search box.
   */
  const [lastSent, setLastSent] = useState(null);
  /**
   * ⚠⚠ THE DOUBLE-TAP GUARD, AND IT MUST BE A REF.
   *
   * `disabled={sendingTo === row.id}` reads STATE, and `setSending` does not
   * apply until the next render — so two taps landing in the same frame both
   * pass the check and both send. Each carries its own `client_id`, so the
   * Outbox's duplicate protection cannot collapse them either: that guards
   * against one message being delivered twice, not against two messages being
   * created. The result is two cards in the conversation.
   *
   * ⛔ A ref is not a nicety here. It is set synchronously, so the second tap
   * is refused in the SAME tick rather than one render later.
   */
  const inFlight = useRef(new Set());

  useEffect(() => {
    let live = true;
    (async () => {
      const { conversations } = await listConversations();
      const ids = conversations.map(c => c.id);
      const { participants } = await listParticipants(ids);
      // §A4 — ask, never compute. One rpc per DISTINCT profile.
      const { mine } = await actableProfileIds(participants.map(p => p.profile_id));

      const decorated = conversations.map(c => {
        const mates = participants.filter(p => p.conversation_id === c.id);
        const asRow = mates.find(p => mine.has(p.profile_id) && p.profiles?.type === 'punter')
                   ?? mates.find(p => mine.has(p.profile_id));
        const others = mates.filter(p => p.profile_id !== asRow?.profile_id);
        return {
          id: c.id,
          sendAs: asRow?.profile_id ?? null,
          // Archived threads are still real conversations, so they are listed
          // rather than hidden — they simply sink, exactly as in the inbox.
          archived: mates.some(p => mine.has(p.profile_id) && p.archived_at),
          who: others.map(o => o.profiles?.name).filter(Boolean).join(', '),
          avatar: others[0]?.profiles?.avatar_thumb ?? others[0]?.profiles?.avatar ?? null,
        };
      })
        // ⚠ A thread this person cannot send as is UNSENDABLE, and offering it
        // would produce a row whose tap always fails. Dropped, not disabled:
        // there is nothing the user could do about it.
        .filter(r => r.sendAs && r.who)
        .sort((a, b) => Number(a.archived) - Number(b.archived));

      if (live) setRows(decorated);
    })();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function send(row) {
    // ⛔ Synchronous, before any await — see `inFlight`. A second tap in the
    // same frame is refused here, where state cannot help.
    if (inFlight.current.has(row.id) || sentTo.has(row.id)) return;
    inFlight.current.add(row.id);

    setSending(row.id);
    setError('');
    const { body, kind, payload } = buildMessage();
    const { error: err } = await sendMessage({
      conversationId: row.id,
      fromProfileId: row.sendAs,
      body, kind, payload,
    });
    setSending(null);
    inFlight.current.delete(row.id);
    if (err) { setError(err.message || 'That could not be sent.'); return; }
    // ⭐ The row is marked sent rather than the sheet closing. Sharing one
    // event with three people is one trip, not three — and closing on the
    // first send is what makes that feel like three.
    setSentTo(prev => new Set(prev).add(row.id));
    setLastSent(row.who);

    /**
     * ⭐⭐ TELL THE INBOX. THE SENDER MUST NOT LEARN OF ITS OWN SEND FROM THE
     * SERVER.
     *
     * ⚠ Reported 2026-08-11: share an event from an event page, then tap
     * Messages — the conversation is not at the top and shows no new preview.
     * "I have to click into the chat window or refresh the page."
     *
     * The inbox re-orders on a Postgres realtime INSERT, and that listener
     * lives in InboxScreen's effect — so it only exists WHILE THAT SCREEN IS
     * MOUNTED. Sending from an event page means nothing is listening, the
     * event is missed, and the cached list stays as it was. It looked like a
     * send failure and it was a send that nobody told the list about.
     *
     * ⛔ Do not "fix" this by widening the realtime subscription. A client
     * knows what it just sent; making it wait for a round trip to find out is
     * the actual mistake, and on a phone that socket drops constantly.
     *
     * ⚠ Keyed on the PREFIX, not `['inbox', userId]` — this sheet does not
     * know the viewer's account id, and the sender is by definition the only
     * inbox cached in this browser. Marking it stale is enough: an inbox on
     * screen refetches at once, one that is not refetches when it next mounts,
     * which is exactly the moment the reader looks at it.
     */
    queryClient.invalidateQueries({ queryKey: ['inbox'] });

    /**
     * ⭐ A HAPTIC, BECAUSE THIS FAILED ON A PHONE (owner, 2026-08-11).
     *
     * ⚠ The send queues to the Outbox rather than awaiting the network, so
     * `Sending…` exists for about one frame — there is no motion to notice.
     * Everything visual happens under the thumb that just tapped. A 12ms tick
     * is the one channel a finger cannot cover.
     *
     * ⛔ Guarded, not assumed: `vibrate` is absent on iOS Safari and throws in
     * some embedded webviews. A missing haptic must never cost someone the
     * confirmation the rest of this function provides.
     */
    try { navigator.vibrate?.(12); } catch { /* no haptics here */ }

    onSent?.(row.id);
  }

  const needle = query.trim().toLowerCase();
  const visible = (rows ?? []).filter(r => !needle || r.who.toLowerCase().includes(needle));

  return createPortal(
    <div
      onClick={onClose}
      role="presentation"
      style={{
        position: 'fixed', inset: 0, zIndex: 90,
        background: 'rgba(0,0,0,.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label={`Send ${title ?? 'this'} to a conversation`}
        style={{
          width: '100%', maxWidth: 520,
          // ⚠ THE BOTTOM NAV IS SACRED — the sheet stops above it rather than
          // sliding under it. Constitutional UI rule.
          marginBottom: 'var(--yp-nav-height)',
          maxHeight: '68dvh', display: 'flex', flexDirection: 'column',
          background: 'rgba(18,18,26,.98)',
          borderRadius: '20px 20px 0 0',
          border: '1px solid rgba(255,255,255,.12)',
          borderBottom: 'none',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '14px 16px 10px', flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 10 }}>
            Send to…
          </div>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            style={{
              width: '100%', boxSizing: 'border-box', height: 38, padding: '0 12px',
              borderRadius: 10, border: '1px solid rgba(255,255,255,.14)',
              background: 'rgba(255,255,255,.05)', color: 'var(--text)',
              fontSize: 15, fontFamily: 'inherit', outline: 'none',
            }}
          />
        </div>

        {error && (
          <div role="alert" style={{ margin: '0 16px 8px', fontSize: 12.5, color: '#ff8fb0' }}>
            {error}
          </div>
        )}

        {/**
          * ⭐⭐ THE CONFIRMATION, WHERE THE FINGER IS NOT.
          *
          * ⚠ Reported 2026-08-11: "it didnt say sent. i pressed it a bunch more
          * times". It DID say Sent — as one 12.5px word at the right edge of
          * the row, directly under the thumb that had just tapped it. The only
          * feedback the system gave was in the one place it could not be seen.
          *
          * So the acknowledgement is repeated up here, above the list and
          * beside the search box: a region the hand never covers when reaching
          * for a row. ⭐ It names WHO, because after two sends "Sent" alone no
          * longer answers the question being asked.
          *
          * `aria-live` so a screen reader announces it too — the same problem
          * in a different form, and the same fix.
          */}
        {lastSent && !error && (
          <div
            aria-live="polite"
            style={{
              margin: '0 16px 8px', padding: '7px 10px', borderRadius: 8,
              background: 'rgba(125,233,255,.10)', border: '1px solid rgba(125,233,255,.28)',
              fontSize: 12.5, color: '#7DE9FF',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Sent to {lastSent}
            </span>
          </div>
        )}

        <div style={{ overflowY: 'auto', padding: '0 8px 12px' }}>
          {/* ⚠ THREE DIFFERENT NOTHINGS, AND THEY MUST NOT LOOK ALIKE — the
              rendering contract. Still loading is not "you have none", and
              "you have none" is not "your search matched none". */}
          {rows === null && (
            <p style={emptyStyle}>Loading your conversations…</p>
          )}
          {rows !== null && rows.length === 0 && (
            <p style={emptyStyle}>You have no conversations to send this to yet.</p>
          )}
          {rows !== null && rows.length > 0 && visible.length === 0 && (
            <p style={emptyStyle}>No conversation matches “{query.trim()}”.</p>
          )}

          {visible.map(row => {
            const done = sentTo.has(row.id);
            return (
              <button
                key={row.id}
                type="button"
                disabled={sendingTo === row.id || done}
                onClick={() => void send(row)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '10px 8px', border: 'none',
                  /* ⭐ THE WHOLE ROW CHANGES, not one word at its edge. A tinted
                     row is legible in peripheral vision and survives a thumb
                     resting on the right-hand side of it. */
                  background: done ? 'rgba(125,233,255,.10)' : 'none',
                  color: 'inherit', textAlign: 'left', cursor: done ? 'default' : 'pointer',
                  borderRadius: 10, opacity: row.archived && !done ? .62 : 1,
                  transition: 'background 140ms linear',
                }}
              >
                {/* ⭐ THE TICK SITS ON THE LEFT, OVER THE AVATAR — the far side
                    of the row from where the finger lands. That is the whole
                    point of it: a confirmation the hand cannot cover. */}
                <span style={{ position: 'relative', width: 36, height: 36, flexShrink: 0 }}>
                  {row.avatar
                    ? <img src={row.avatar} alt="" style={{ width: 36, height: 36, borderRadius: 999, objectFit: 'cover', opacity: done ? .35 : 1 }} />
                    : <span style={{ display: 'block', width: 36, height: 36, borderRadius: 999, background: 'rgba(255,255,255,.10)', opacity: done ? .35 : 1 }} />}
                  {done && (
                    <span style={{
                      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: 999, background: 'rgba(125,233,255,.22)', color: '#7DE9FF',
                    }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </span>
                  )}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: done ? '#7DE9FF' : 'inherit' }}>
                  {row.who}
                </span>
                <span style={{ fontSize: 12.5, color: done ? '#7DE9FF' : 'rgba(255,255,255,.45)', flexShrink: 0 }}>
                  {done ? 'Sent' : sendingTo === row.id ? 'Sending…' : 'Send'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const emptyStyle = {
  padding: '18px 12px', margin: 0,
  fontSize: 13.5, color: 'rgba(255,255,255,.5)', textAlign: 'center',
};
