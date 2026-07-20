import { useState, useEffect, useRef } from 'react';
import { useSession } from '../App';
import {
  listMessages, listParticipants, actableProfileIds,
  sendMessage, markConversationRead,
} from '../lib/messaging';
import { useConversationUi } from '../lib/conversationUi';

/**
 * ONE conversation, rendered identically in the DRAWER and in the FULL PAGE.
 *
 * Deliberately shared. Two implementations of a thread would drift, and the
 * drawer is where daily communication happens — so the page must not become
 * the one that gets fixed while the drawer rots.
 *
 * ── DRAFTS AND SCROLL LIVE IN SHELL STATE, NOT HERE ──────────────────
 *
 * A minimised conversation must reopen exactly as it was. If the draft lived in
 * this component's useState it would die on unmount, and "minimise" would
 * quietly mean "discard". So the draft and scroll position are read from and
 * written to `useConversationUi`, which outlives this component.
 *
 * Keystrokes patch with notify=false: the shell must not re-render on every
 * character.
 *
 * ── EXTENSION POINTS, DECLARED NOT BUILT ─────────────────────────────
 *
 * The canonical model calls for voice notes, images, attachments and native
 * YesPleez cards (events, artists, venues, festivals, opportunities, listings,
 * documents) rendered inline instead of plain URLs. The message renderer below
 * dispatches on a `kind` so those land as new branches rather than a rewrite —
 * but only `text` exists today. Nothing here fakes the others.
 */
export default function ConversationView({ conversationId, compact = false, onMinimise }) {
  const { session } = useSession();
  const ui = useConversationUi();

  const [messages, setMessages]    = useState([]);
  const [mine, setMine]            = useState(new Set());
  const [senderProfile, setSender] = useState(null);
  const [others, setOthers]        = useState([]);
  const [draft, setDraft]          = useState(() => ui.getState(conversationId).draft || '');
  const [sending, setSending]      = useState(false);
  const [error, setError]          = useState(null);
  const [loading, setLoading]      = useState(true);
  const scrollRef = useRef(null);
  const inputRef  = useRef(null);

  // Restore the draft when the drawer swaps to a different conversation.
  useEffect(() => {
    setDraft(ui.getState(conversationId).draft || '');
  }, [conversationId, ui]);

  // Restore the CARET, not just the text. Without this, reopening drops the
  // cursor to the end, so someone resuming mid-sentence types in the wrong
  // place — the draft looks preserved while the edit position silently is not.
  useEffect(() => {
    const el = inputRef.current;
    const sel = ui.getState(conversationId).selection;
    if (!el || !sel) return;
    try { el.setSelectionRange(sel.start, sel.end); } catch { /* input may not support it */ }
  }, [conversationId, ui]);

  function rememberSelection() {
    const el = inputRef.current;
    if (!el) return;
    ui.patch(conversationId, {
      selection: { start: el.selectionStart, end: el.selectionEnd },
    });
  }

  useEffect(() => {
    if (!session || !conversationId) { setLoading(false); return undefined; }
    const cancelled = { current: false };

    (async () => {
      const { participants } = await listParticipants(conversationId);
      if (cancelled.current) return;

      // §A4 — ownership is asked, never computed in the client.
      const { mine: mineSet } = await actableProfileIds(participants.map(p => p.profile_id));
      if (cancelled.current) return;

      setMine(mineSet);
      setSender(participants.find(p => mineSet.has(p.profile_id))?.profile_id ?? null);

      const otherParties = participants.filter(p => !mineSet.has(p.profile_id));
      setOthers(otherParties);

      // Seed the pill so a minimised conversation can name who it is with.
      const head = otherParties[0]?.profiles;
      if (head) ui.patch(conversationId, { profile: { id: head.id, name: head.name, type: head.type } }, true);

      const { messages: rows } = await listMessages(conversationId);
      if (cancelled.current) return;
      setMessages(rows);
      setLoading(false);

      // `C11` — this human's watermark. Monotonic in the database.
      await markConversationRead(conversationId);
      ui.patch(conversationId, { unread: 0 }, true);
    })();

    return () => { cancelled.current = true; };
  }, [session, conversationId, ui]);

  // Restore scroll, or stick to the bottom on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = ui.getState(conversationId).scrollTop;
    el.scrollTop = saved ?? el.scrollHeight;
  }, [messages.length, conversationId, ui]);

  function onScroll() {
    const el = scrollRef.current;
    if (el) ui.patch(conversationId, { scrollTop: el.scrollTop });
  }

  function onDraftChange(value) {
    setDraft(value);
    ui.patch(conversationId, { draft: value });   // silent — no shell re-render
  }

  async function onSend(e) {
    e.preventDefault();
    if (!draft.trim() || !senderProfile || sending) return;
    setSending(true);
    setError(null);

    const { message, error: sendError } = await sendMessage({
      conversationId,
      fromProfileId: senderProfile,   // ATTRIBUTION only; the human comes from the session
      body:          draft,
    });

    if (sendError) {
      setError(sendError.message ?? 'Could not send.');
      setSending(false);
      return;
    }

    setMessages(prev => [...prev, message]);
    onDraftChange('');
    setSending(false);
    ui.patch(conversationId, { lastPreview: { text: message.body, kind: 'text' } }, true);
    await markConversationRead(conversationId);
  }

  const title = others.map(o => o.profiles?.name).filter(Boolean).join(', ') || 'Conversation';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      {compact && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 16, letterSpacing: 1.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title.toUpperCase()}
          </div>
          <button
            type="button"
            onClick={onMinimise}
            aria-label="Minimise conversation"
            style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border)', borderRadius: 999, color: 'var(--muted)', fontFamily: "'Bebas Neue',sans-serif", fontSize: 11, letterSpacing: 1.5, padding: '5px 12px', cursor: 'pointer' }}
          >
            MINIMISE
          </button>
        </div>
      )}

      {/* Privacy line. Says PRIVATE, not "secure" — messages are not
          end-to-end encrypted, and claiming otherwise would be a promise the
          system does not keep. What IS guaranteed: C29 (no AI, ever) and C32
          (content never feeds ranking or recommendation). */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 16px', fontSize: 11, color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
        <span aria-hidden="true">🔒</span>
        <span>Private — only you and the participants in this conversation can see these messages.</span>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', minHeight: 0 }}
      >
        {loading && (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,.35)', fontFamily: "'Bebas Neue',sans-serif", fontSize: 13, letterSpacing: 2, padding: '32px 0' }}>
            LOADING…
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px 0', fontSize: 13, color: 'rgba(255,255,255,.25)' }}>
            No messages yet. Say something.
          </div>
        )}

        {!loading && messages.map(m => (
          <MessageBubble key={m.id} message={m} isMine={mine.has(m.from_profile_id)} />
        ))}
      </div>

      {error && (
        <div role="alert" style={{ color: 'var(--neon)', fontSize: 12, padding: '4px 16px' }}>{error}</div>
      )}

      <form onSubmit={onSend} style={{ display: 'flex', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
        <input
          ref={inputRef}
          value={draft}
          onChange={e => { onDraftChange(e.target.value); rememberSelection(); }}
          onSelect={rememberSelection}
          onKeyUp={rememberSelection}
          onBlur={rememberSelection}
          disabled={!senderProfile || sending}
          placeholder={senderProfile ? 'Type a message…' : 'You cannot write in this conversation'}
          aria-label="Message"
          style={{ flex: 1, background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 999, padding: '11px 16px', color: 'var(--text)', fontSize: 14, outline: 'none' }}
        />
        <button
          type="submit"
          disabled={!senderProfile || sending || !draft.trim()}
          style={{ border: 'none', borderRadius: 999, padding: '11px 18px', fontFamily: "'Bebas Neue',sans-serif", fontSize: 14, letterSpacing: 1.5, cursor: senderProfile && draft.trim() ? 'pointer' : 'not-allowed', background: senderProfile && draft.trim() ? 'linear-gradient(135deg, #00E5FF, #BF5FFF)' : 'rgba(255,255,255,.08)', color: senderProfile && draft.trim() ? '#000' : 'var(--muted)' }}
        >
          {sending ? '…' : 'SEND'}
        </button>
      </form>
    </div>
  );
}

/**
 * Dispatches on message kind so voice notes, images, attachments and native
 * YesPleez cards land as branches rather than a rewrite. Only `text` exists —
 * the others are declared, not built, and nothing here pretends otherwise.
 */
function MessageBubble({ message, isMine }) {
  const kind = message.kind ?? 'text';

  return (
    <div style={{ display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
      <div style={{ maxWidth: '78%', border: '1px solid var(--border)', borderRadius: 14, padding: '10px 13px', background: isMine ? 'rgba(191,95,255,.14)' : 'rgba(255,255,255,.03)' }}>
        {kind === 'text' ? (
          <div style={{ color: 'var(--text)', fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {message.body}
          </div>
        ) : (
          // Unknown kind from a newer client. Show something honest rather
          // than an empty bubble.
          <div style={{ color: 'var(--muted)', fontSize: 13, fontStyle: 'italic' }}>
            Unsupported message type — update the app to view this.
          </div>
        )}
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, textAlign: 'right' }}>
          {message.created_at ? new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
        </div>
      </div>
    </div>
  );
}
