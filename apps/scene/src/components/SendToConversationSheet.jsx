import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const [rows, setRows]       = useState(null);   // null = still loading
  const [query, setQuery]     = useState('');
  const [sendingTo, setSending] = useState(null);
  const [error, setError]     = useState('');
  const [sentTo, setSentTo]   = useState(new Set());

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
    setSending(row.id);
    setError('');
    const { body, kind, payload } = buildMessage();
    const { error: err } = await sendMessage({
      conversationId: row.id,
      fromProfileId: row.sendAs,
      body, kind, payload,
    });
    setSending(null);
    if (err) { setError(err.message || 'That could not be sent.'); return; }
    // ⭐ The row is marked sent rather than the sheet closing. Sharing one
    // event with three people is one trip, not three — and closing on the
    // first send is what makes that feel like three.
    setSentTo(prev => new Set(prev).add(row.id));
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
                  padding: '10px 8px', border: 'none', background: 'none',
                  color: 'inherit', textAlign: 'left', cursor: done ? 'default' : 'pointer',
                  borderRadius: 10, opacity: row.archived && !done ? .62 : 1,
                }}
              >
                {row.avatar
                  ? <img src={row.avatar} alt="" style={{ width: 36, height: 36, borderRadius: 999, objectFit: 'cover', flexShrink: 0 }} />
                  : <span style={{ width: 36, height: 36, borderRadius: 999, background: 'rgba(255,255,255,.10)', flexShrink: 0 }} />}
                <span style={{ flex: 1, minWidth: 0, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
