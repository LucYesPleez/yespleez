import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useSession } from '../App';
import {
  listMessages, listParticipants, actableProfileIds,
  sendMessage, markConversationRead,
} from '../lib/messaging';

/**
 * CONVERSATION — one thread, and the composer.
 *
 * ── WHO IS SPEAKING (§A3) ────────────────────────────────────────────
 *
 * A message carries attribution (the profile) and audit (the human). This
 * screen chooses only the first, and it does not choose it freely: the sender
 * profile is the participant profile the caller can act as, answered by
 * `can_act_as`. The human is added by `sendMessage` from the session and is
 * never touched here.
 *
 * If no participant profile answers true, the composer is disabled rather than
 * hidden — a thread you can read but not write is a real state (§4.4
 * `restricted`, or a profile you no longer own), and silently removing the box
 * would read as a bug.
 *
 * ── SENDING IS ONE INSERT ────────────────────────────────────────────
 *
 * `last_message_at`, notifications, per-human fan-out and preference
 * suppression are all triggers. This screen must NOT write a notification —
 * see the header of `lib/messaging.js`.
 *
 * ── MARKING READ (`C11`) ─────────────────────────────────────────────
 *
 * Read state is per HUMAN. Opening the thread advances this human's watermark
 * only; a colleague acting as the same profile still sees it unread.
 */

const HEADING_GRADIENT = 'linear-gradient(135deg, #00E5FF, #BF5FFF)';

function timeOf(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ConversationScreen() {
  const { id } = useParams();
  const { session } = useSession();

  const [messages, setMessages]   = useState([]);
  const [mine, setMine]           = useState(new Set());
  const [senderProfile, setSender] = useState(null);
  const [others, setOthers]       = useState([]);
  const [draft, setDraft]         = useState('');
  const [sending, setSending]     = useState(false);
  const [error, setError]         = useState(null);
  const [loading, setLoading]     = useState(true);
  const endRef = useRef(null);

  useEffect(() => {
    if (!session || !id) { setLoading(false); return; }
    const cancelled = { current: false };

    (async () => {
      const { participants } = await listParticipants(id);
      if (cancelled.current) return;

      // §A4 — ownership is asked, never computed here.
      const { mine: mineSet } = await actableProfileIds(participants.map(p => p.profile_id));
      if (cancelled.current) return;

      setMine(mineSet);
      setSender(participants.find(p => mineSet.has(p.profile_id))?.profile_id ?? null);
      setOthers(participants.filter(p => !mineSet.has(p.profile_id)));

      const { messages: rows } = await listMessages(id);
      if (cancelled.current) return;
      setMessages(rows);
      setLoading(false);

      // `C11` — this human's watermark, monotonic in the database.
      await markConversationRead(id);
    })();

    return () => { cancelled.current = true; };
  }, [session, id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  async function onSend(e) {
    e.preventDefault();
    if (!draft.trim() || !senderProfile || sending) return;
    setSending(true);
    setError(null);

    const { message, error: sendError } = await sendMessage({
      conversationId: id,
      fromProfileId:  senderProfile,   // ATTRIBUTION only — the human is the session's
      body:           draft,
    });

    if (sendError) {
      setError(sendError.message ?? 'Could not send.');
      setSending(false);
      return;
    }

    setMessages(prev => [...prev, message]);
    setDraft('');
    setSending(false);
    // Our own message is not unread to us (M8d excludes from_user_id), but the
    // watermark still moves so the thread does not re-open as unread later.
    await markConversationRead(id);
  }

  const title = others.map(o => o.profiles?.name).filter(Boolean).join(', ') || 'CONVERSATION';

  return (
    <div style={{ paddingTop: 72, paddingBottom: 120, minHeight: '100dvh', background: 'var(--bg)', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 16px' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <Link to="/messages" style={{ textDecoration: 'none', color: 'var(--muted)', fontFamily: "'Bebas Neue',sans-serif", fontSize: 13, letterSpacing: 1.5 }}>
            ← BACK
          </Link>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: 2, background: HEADING_GRADIENT, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            {title.toUpperCase()}
          </div>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,.35)', fontFamily: "'Bebas Neue',sans-serif", fontSize: 14, letterSpacing: 2, padding: '48px 0' }}>
            LOADING…
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 0', fontSize: 13, color: 'rgba(255,255,255,.25)' }}>
            No messages yet. Say something.
          </div>
        )}

        {!loading && messages.map(m => {
          const isMine = mine.has(m.from_profile_id);
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
              <div style={{ maxWidth: '78%', border: '1px solid var(--border)', borderRadius: 14, padding: '10px 13px', background: isMine ? 'rgba(0,229,255,.08)' : 'rgba(255,255,255,.03)' }}>
                <div style={{ color: 'var(--text)', fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {m.body}
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, textAlign: 'right' }}>
                  {timeOf(m.created_at)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />

        {error && (
          <div role="alert" style={{ color: 'var(--neon)', fontSize: 12, margin: '8px 0' }}>{error}</div>
        )}

        {!loading && (
          <form onSubmit={onSend} style={{ position: 'sticky', bottom: 90, marginTop: 16, display: 'flex', gap: 8, background: 'var(--bg)', paddingTop: 8 }}>
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              disabled={!senderProfile || sending}
              placeholder={senderProfile ? 'Write a message…' : 'You cannot write in this conversation'}
              aria-label="Message"
              style={{ flex: 1, background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 999, padding: '11px 16px', color: 'var(--text)', fontSize: 14, outline: 'none' }}
            />
            <button
              type="submit"
              disabled={!senderProfile || sending || !draft.trim()}
              style={{ border: 'none', borderRadius: 999, padding: '11px 20px', fontFamily: "'Bebas Neue',sans-serif", fontSize: 14, letterSpacing: 1.5, cursor: senderProfile && draft.trim() ? 'pointer' : 'not-allowed', background: senderProfile && draft.trim() ? HEADING_GRADIENT : 'rgba(255,255,255,.08)', color: senderProfile && draft.trim() ? '#000' : 'var(--muted)' }}
            >
              {sending ? '…' : 'SEND'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
