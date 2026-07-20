import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import {
  listMessages, listParticipants, actableProfileIds,
  sendMessage, markConversationRead,
} from '../lib/messaging';
import { useConversationUi } from '../lib/conversationUi';
import { PROFILE_TYPES } from '../lib/profileTypes';

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
  // Destructured deliberately. The context VALUE changes identity whenever a
  // conversation opens or a pill repaints, so depending on `ui` in an effect
  // that also calls patch() creates a restart loop: the patch changes the
  // context, the effect re-runs, cancels its own in-flight load, and patches
  // again — the thread never finishes loading. getState/patch are useCallback
  // -stable, so depend on those instead of the object holding them.
  const { getState, patch } = useConversationUi();

  const [messages, setMessages]    = useState([]);
  const [mine, setMine]            = useState(new Set());
  const [senderProfile, setSender] = useState(null);
  // The FULL sending profile, not just its id — the header must state which
  // identity is talking, and "you are messaging as" is meaningless without a
  // name. This is the answer to "which profile am I messaging from?", which
  // the user should never have to ask.
  const [senderMeta, setSenderMeta] = useState(null);
  const [others, setOthers]        = useState([]);
  const [draft, setDraft]          = useState(() => getState(conversationId).draft || '');
  const [sending, setSending]      = useState(false);
  const [error, setError]          = useState(null);
  const [loading, setLoading]      = useState(true);
  const [pendingNew, setPendingNew] = useState(0);
  const scrollRef = useRef(null);
  const inputRef  = useRef(null);
  const atBottomRef = useRef(true);

  // Restore the draft when the drawer swaps to a different conversation.
  useEffect(() => {
    setDraft(getState(conversationId).draft || '');
  }, [conversationId, getState]);

  // Restore the CARET, not just the text. Without this, reopening drops the
  // cursor to the end, so someone resuming mid-sentence types in the wrong
  // place — the draft looks preserved while the edit position silently is not.
  useEffect(() => {
    const el = inputRef.current;
    const sel = getState(conversationId).selection;
    if (!el || !sel) return;
    try { el.setSelectionRange(sel.start, sel.end); } catch { /* input may not support it */ }
  }, [conversationId, getState]);

  function rememberSelection() {
    const el = inputRef.current;
    if (!el) return;
    patch(conversationId, {
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

      // Both sides yours = note-keeping, so Personal is "you" and the other
      // profile is the recipient. Deterministic, so the header cannot flip
      // between loads. See InboxScreen for the same rule.
      const mineRow = participants.find(p => mineSet.has(p.profile_id) && p.profiles?.type === 'punter')
                   ?? participants.find(p => mineSet.has(p.profile_id));
      setMine(mineSet);
      setSender(mineRow?.profile_id ?? null);
      setSenderMeta(mineRow?.profiles ?? null);

      // The other party is everyone except the profile I am sending AS — not
      // everyone I cannot act as. Messaging between two of your own profiles
      // is legitimate, and the ownership-based version returns nothing for
      // those, which is why the header read "Conversation" with no name.
      const otherParties = participants.filter(p => p.profile_id !== mineRow?.profile_id);
      setOthers(otherParties);

      // Seed the pill so a minimised conversation can name who it is with.
      const head = otherParties[0]?.profiles;
      if (head) patch(conversationId, { profile: { id: head.id, name: head.name, type: head.type } }, true);

      const { messages: rows } = await listMessages(conversationId);
      if (cancelled.current) return;
      setMessages(rows);
      setLoading(false);

      // `C11` — this human's watermark. Monotonic in the database.
      await markConversationRead(conversationId);
      patch(conversationId, { unread: 0 }, true);
    })();

    return () => { cancelled.current = true; };
  }, [session, conversationId, patch]);

  /**
   * REAL-TIME. Subscribes to inserts on THIS conversation only.
   *
   * Dedupes by message id, which matters because the sender receives their own
   * insert back: onSend already appended it optimistically, so without the
   * guard every message you send would appear twice.
   *
   * RLS applies to realtime as it does to reads, so a non-participant receives
   * nothing — the filter below is a narrowing, not the security boundary.
   */
  useEffect(() => {
    if (!session || !conversationId) return undefined;

    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, ({ new: row }) => {
        setMessages(prev => {
          if (prev.some(m => m.id === row.id)) return prev;   // dedupe
          return [...prev, row];
        });

        const isOwn = row.from_user_id === session.user.id;
        if (!isOwn) {
          if (atBottomRef.current) {
            // Reading at the bottom: the watermark should follow.
            markConversationRead(conversationId);
          } else {
            // Scrolled up reading history — do NOT yank them to the bottom.
            // Surface an indicator and let them choose.
            setPendingNew(n => n + 1);
          }
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [session, conversationId]);

  // Restore saved scroll on open; afterwards only follow new messages if the
  // reader is already at the bottom. Forcing scroll while someone reads older
  // messages is the classic chat defect this guards against.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = getState(conversationId).scrollTop;
    if (saved != null && atBottomRef.current === false) { el.scrollTop = saved; return; }
    if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    else if (saved != null) el.scrollTop = saved;
  }, [messages.length, conversationId, getState]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    atBottomRef.current = atBottom;
    patch(conversationId, { scrollTop: el.scrollTop });
    if (atBottom && pendingNew > 0) {
      setPendingNew(0);
      markConversationRead(conversationId);
      patch(conversationId, { unread: 0 }, true);
    }
  }

  function jumpToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setPendingNew(0);
    markConversationRead(conversationId);
    patch(conversationId, { unread: 0 }, true);
  }

  function onDraftChange(value) {
    setDraft(value);
    patch(conversationId, { draft: value });   // silent — no shell re-render
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
    patch(conversationId, { lastPreview: { text: message.body, kind: 'text' } }, true);
    await markConversationRead(conversationId);
  }

  const title       = others.map(o => o.profiles?.name).filter(Boolean).join(', ') || 'Conversation';
  const otherHead   = others[0]?.profiles ?? null;
  const otherMeta   = PROFILE_TYPES[otherHead?.type] ?? {};
  const otherAccent = otherMeta.accent  ?? '#BF5FFF';
  const otherAccent2= otherMeta.accent2 ?? '#00E5FF';
  const otherType   = otherMeta.label ?? otherHead?.type ?? '';
  const otherAvatar = otherHead?.avatar_thumb || otherHead?.avatar || otherMeta.defaultImage;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      {/* HEADER — rendered in BOTH hosts, so the drawer and the full page
          present the same conversation rather than two different ones. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,.07)', flexShrink: 0 }}>
        {compact && (
          <button
            type="button"
            onClick={onMinimise}
            aria-label="Minimise conversation"
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.55)', fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: 0, flexShrink: 0 }}
          >
            ‹
          </button>
        )}

        <span style={{ width: 44, height: 44, borderRadius: 999, flexShrink: 0, padding: 2, background: `linear-gradient(135deg, ${otherAccent}, ${otherAccent2})`, display: 'flex' }}>
          <span style={{ width: '100%', height: '100%', borderRadius: 999, overflow: 'hidden', background: '#0d0d10', display: 'flex', alignItems: 'center', justifyContent: 'center', color: otherAccent, fontFamily: "'Bebas Neue',sans-serif", fontSize: 17 }}>
            {otherAvatar
              ? <img src={otherAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : title.slice(0, 1).toUpperCase()}
          </span>
        </span>

        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', color: '#fff', fontSize: 17, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
            {title}
          </span>
          <span style={{ display: 'block', color: 'rgba(255,255,255,.42)', fontSize: 12, marginTop: 1 }}>
            {otherType}
          </span>

          {/* IDENTITY PILL — the answer to "which profile am I messaging
              from?", always visible while the conversation is open. Two
              conversations with the same recipient are indistinguishable
              without it, and §2.1 makes the sending identity permanent, so
              getting it wrong is not recoverable by switching. */}
          {senderMeta && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, padding: '3px 9px 3px 7px', borderRadius: 999, background: 'rgba(191,95,255,.13)', border: '1px solid rgba(191,95,255,.32)', maxWidth: '100%' }}>
              <span style={{ fontSize: 9.5, letterSpacing: 1, color: 'rgba(255,255,255,.45)', fontFamily: "'Bebas Neue',sans-serif" }}>
                TALKING AS
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: '#D9A6FF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {senderMeta.name}
              </span>
            </span>
          )}
        </span>
      </div>

      {/* Privacy strip. Says PRIVATE, not "secure" — messages are not
          end-to-end encrypted, and claiming otherwise would be a promise the
          system does not keep. What IS guaranteed: C29 (no AI, ever) and C32
          (content never feeds ranking or recommendation). Muted, never a
          warning colour: this is reassurance, not an alert. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', padding: '9px 16px', fontSize: 11.5, color: 'rgba(255,255,255,.34)', background: 'rgba(255,255,255,.025)', borderBottom: '1px solid rgba(255,255,255,.05)', flexShrink: 0 }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" style={{ flexShrink: 0 }}>
          <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        <span>Private — only you and the participants can see these messages.</span>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{ flex: 1, overflowY: 'auto', padding: '22px 18px 8px', minHeight: 0 }}
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

      {/* Arrives only when a message lands while the reader is scrolled up.
          An indicator rather than a forced scroll — see the realtime effect. */}
      {pendingNew > 0 && (
        <button
          type="button"
          onClick={jumpToLatest}
          style={{ position: 'relative', alignSelf: 'center', marginTop: -34, marginBottom: 8, border: 'none', borderRadius: 999, padding: '7px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'linear-gradient(135deg, #00E5FF, #BF5FFF)', color: '#000', boxShadow: '0 4px 14px rgba(0,0,0,.4)' }}
        >
          {pendingNew} new message{pendingNew > 1 ? 's' : ''} ↓
        </button>
      )}

      {error && (
        <div role="alert" style={{ color: 'var(--neon)', fontSize: 12, padding: '4px 16px' }}>{error}</div>
      )}

      <form onSubmit={onSend} style={{ display: 'flex', gap: 10, padding: '14px 16px 18px', borderTop: '1px solid rgba(255,255,255,.06)', flexShrink: 0 }}>
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
          style={{ flex: 1, background: 'rgba(255,255,255,.045)', border: '1px solid rgba(255,255,255,.09)', borderRadius: 999, padding: '14px 18px', color: 'var(--text)', fontSize: 14.5, outline: 'none' }}
        />
        <button
          type="submit"
          disabled={!senderProfile || sending || !draft.trim()}
          aria-label="Send"
          style={{ border: 'none', borderRadius: 999, width: 48, height: 48, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: senderProfile && draft.trim() ? 'pointer' : 'not-allowed', background: senderProfile && draft.trim() ? 'linear-gradient(135deg, #00E5FF, #BF5FFF)' : 'rgba(255,255,255,.07)', color: senderProfile && draft.trim() ? '#0a0a0f' : 'rgba(255,255,255,.3)', boxShadow: senderProfile && draft.trim() ? '0 8px 22px -8px rgba(191,95,255,.75)' : 'none', transition: 'background .25s ease, box-shadow .25s ease' }}
        >
          {sending
            ? '…'
            : (
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" />
              </svg>
            )}
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
    <div style={{ display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start', marginBottom: 14 }}>
      {/* Sent messages carry the canonical YesPleez cyan→purple gradient
          rather than a flat purple. Held at low alpha over the charcoal
          surface so it reads as tinted glass — restrained, not neon. Received
          messages stay near-black so the gradient is what the eye follows. */}
      <div style={{
        maxWidth: '76%',
        borderRadius: isMine ? '20px 20px 6px 20px' : '20px 20px 20px 6px',
        padding: '13px 17px',
        border: isMine ? '1px solid rgba(191,95,255,.34)' : '1px solid rgba(255,255,255,.07)',
        background: isMine
          ? 'linear-gradient(135deg, rgba(0,229,255,.20) 0%, rgba(191,95,255,.40) 100%)'
          : 'rgba(255,255,255,.035)',
        boxShadow: isMine ? '0 6px 22px -10px rgba(191,95,255,.6)' : 'none',
      }}>
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
