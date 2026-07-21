import { useState, useEffect, useRef, Fragment } from 'react';
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
/**
 * Messages from one sender within this window are treated as a single burst:
 * tightened together, and stamped once at the end.
 *
 * Five minutes is long enough to group a rapid exchange and short enough that
 * a reply an hour later still reads as a new turn.
 */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * How long a thread must be quiet before the next message earns a time marker.
 *
 * Twenty minutes is the point where "when was this?" becomes a real question.
 * Below it the conversation is still one sitting and a marker is clutter.
 */
const DORMANT_MS = 20 * 60 * 1000;

const dayKey = iso => new Date(iso).toDateString();
const withinWindow = (a, b) => (new Date(b) - new Date(a)) < GROUP_WINDOW_MS;
const timeOf = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function dayLabel(iso) {
  const today = new Date();
  const yest  = new Date(); yest.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today)) return 'Today';
  if (dayKey(iso) === dayKey(yest))  return 'Yesterday';
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Centred marker carrying WHEN. Quiet — it orients, it does not announce.
 *
 * This is where time lives now. Per-message timestamps were repeated down the
 * edge saying the same thing over and over; a marker states it once for
 * everything beneath it, and an individual message can still be asked directly
 * by tapping it.
 */
function ThreadMarker({ label }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '18px 0 14px' }}>
      <span style={{
        fontSize: 10.5, letterSpacing: .6, color: 'rgba(255,255,255,.38)',
        background: 'rgba(255,255,255,.05)',
        border: '1px solid rgba(255,255,255,.06)',
        borderRadius: 999, padding: '4px 11px',
      }}>
        {label}
      </span>
    </div>
  );
}

/**
 * Header icon button. One definition so Back, Call and Overflow are the same
 * weight and size — mismatched icon buttons are the fastest way to make a
 * premium header look assembled rather than designed.
 */
const ghostBtn = {
  width: 34, height: 34, flexShrink: 0, borderRadius: 999,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(255,255,255,.05)',
  border: '1px solid rgba(255,255,255,.08)',
  color: 'rgba(255,255,255,.72)',
  cursor: 'pointer', padding: 0,
};

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
  // Which message is currently showing its time. One at a time: revealing
  // every tapped message would slowly rebuild the timestamp column this
  // replaced.
  const [revealedId, setRevealedId] = useState(null);
  // profile_id -> profile, so a received bubble can show its speaker. Keyed by
  // the ATTRIBUTION id (from_profile_id), never the human — §A3.
  const [profilesById, setProfilesById] = useState({});
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

      // Every participant, so a received bubble can show who said it without
      // re-fetching per message.
      setProfilesById(Object.fromEntries(
        participants.filter(p => p.profiles).map(p => [p.profile_id, p.profiles]),
      ));

      // Seed the pill so a minimised conversation can name AND show who it is
      // with — the tab carries the avatar too, so it is recognisable at a
      // glance rather than by reading.
      const head = otherParties[0]?.profiles;
      if (head) {
        patch(conversationId, {
          profile: {
            id: head.id, name: head.name, type: head.type,
            avatar: head.avatar_thumb || head.avatar || null,
          },
        }, true);
      }

      const { messages: rows } = await listMessages(conversationId);
      if (cancelled.current) return;
      setMessages(rows);
      setLoading(false);

      // `C11` — this human's watermark. Monotonic in the database.
      await markConversationRead(conversationId);
      patch(conversationId, { unread: 0 }, true);
      // DEF-2 — tell the app shell the watermark moved. Advancing read state
      // is a WRITE that emits no realtime event, so the nav badge (which
      // refreshes on notification inserts or a 60s poll) would otherwise show
      // a stale count until the poll caught up. A window event rather than a
      // prop chain because the badge lives ABOVE this provider in the tree.
      window.dispatchEvent(new CustomEvent('yp:messages-read'));
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

  /**
   * PRESENCE — the layout supports three states and invents none of them.
   *
   *   null                              → no presence; the row closes up
   *   { online: true,  label: 'Active now' }
   *   { online: false, label: 'Last seen 2h ago' }
   *
   * There is no presence system in YesPleez, so this is null. It is a named
   * slot rather than commented-out markup: when presence ships it assigns
   * here and the header already handles it. Rendering a green dot today would
   * be asserting something we do not know.
   */
  const presence = null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      {/* HEADER — rendered in BOTH hosts, so the drawer and the full page
          present the same conversation rather than two different ones.

          NO borderBottom. A hard rule is what made this read as a toolbar
          bolted on top of the conversation; the surface should feel like one
          continuous environment. Separation comes from a faint downward wash
          instead, which reads as depth rather than as a divider. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 13,
        padding: '18px 18px 16px', flexShrink: 0,
        background: 'linear-gradient(180deg, rgba(255,255,255,.035) 0%, rgba(255,255,255,0) 100%)',
      }}>
        {compact && (
          <button
            type="button"
            onClick={onMinimise}
            aria-label="Minimise conversation"
            style={{ ...ghostBtn, marginLeft: -4 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
        )}

        {/* Avatar — unchanged size. It is the visual anchor. */}
        <span style={{ width: 44, height: 44, borderRadius: 999, flexShrink: 0, padding: 2, background: `linear-gradient(135deg, ${otherAccent}, ${otherAccent2})`, display: 'flex', boxShadow: `0 4px 16px -6px ${otherAccent}80` }}>
          <span style={{ width: '100%', height: '100%', borderRadius: 999, overflow: 'hidden', background: '#0d0d10', display: 'flex', alignItems: 'center', justifyContent: 'center', color: otherAccent, fontFamily: "'Bebas Neue',sans-serif", fontSize: 17 }}>
            {otherAvatar
              ? <img src={otherAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : title.slice(0, 1).toUpperCase()}
          </span>
        </span>

        <span style={{ minWidth: 0, flex: 1 }}>
          {/* PRIMARY. Lifted to 19px/650 and tightened, so the name wins the
              composition outright instead of competing with the row below. */}
          <span style={{ display: 'block', color: '#fff', fontSize: 19, fontWeight: 650, letterSpacing: '-.2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.15 }}>
            {title}
          </span>

          {/* SECONDARY ROW — type pill and presence share one line. Presence
              is absent today and the row simply closes up; it does not reserve
              empty space for a feature that does not exist. */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, minWidth: 0 }}>
            <span style={{
              flexShrink: 0, fontFamily: "'Bebas Neue',sans-serif", fontSize: 10,
              letterSpacing: 1.2, lineHeight: 1, padding: '4px 8px', borderRadius: 999,
              color: otherAccent,
              background: `${otherAccent}1F`,
              border: `1px solid ${otherAccent}3D`,
            }}>
              {String(otherType).toUpperCase()}
            </span>

            {presence && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0, fontSize: 11.5, color: 'rgba(255,255,255,.42)' }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, flexShrink: 0, background: presence.online ? '#00E5A0' : 'rgba(255,255,255,.28)' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{presence.label}</span>
              </span>
            )}
          </span>

          {/* TALKING AS — kept, but demoted to a single quiet line. It was a
              third bordered pill stacked under two others, which made the
              header feel like a stack of chips; the sender identity has to be
              unmissable, not loud. A tinted swatch carries the meaning and the
              name does the rest. §2.1 makes this permanent for the life of the
              conversation, so it must never be ambiguous. */}
          {/* Hidden when you are speaking as Personal — that is the default,
              and stating it on every conversation is noise that buries the
              cases where the identity actually matters. */}
          {senderMeta && senderMeta.type !== 'punter' && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, minWidth: 0 }}>
              <span style={{ width: 5, height: 5, borderRadius: 999, flexShrink: 0, background: 'linear-gradient(135deg, #00E5FF, #BF5FFF)' }} />
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,.38)', flexShrink: 0 }}>as</span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: '#CFA4FF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {senderMeta.name}
              </span>
            </span>
          )}
        </span>

        {/* Reserved affordances. Neither calling nor an overflow menu exists,
            so these are visibly disabled rather than wired to nothing — the
            same treatment QR and Info were given. A dead control that looks
            live is worse than one that admits it is not ready. */}
        <button type="button" disabled aria-label="Call — not available yet" title="Calling is not available yet" style={{ ...ghostBtn, opacity: .32, cursor: 'not-allowed' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
          </svg>
        </button>

        <button type="button" disabled aria-label="More — not available yet" title="No conversation actions yet" style={{ ...ghostBtn, opacity: .32, cursor: 'not-allowed' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
          </svg>
        </button>
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
        className="yp-noscrollbar"
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

        {!loading && messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const day  = dayKey(m.created_at);

          // A new day gets a marker. Without one a thread spanning weeks
          // reads as a single undifferentiated column.
          const newDay = !prev || dayKey(prev.created_at) !== day;

          // ...and so does a thread waking up after being quiet. Between the
          // two, time is simply not mentioned.
          const dormant = prev && (new Date(m.created_at) - new Date(prev.created_at)) >= DORMANT_MS;

          const markerLabel = newDay
            ? `${dayLabel(m.created_at)} · ${timeOf(m.created_at)}`
            : dormant ? timeOf(m.created_at) : null;

          // Consecutive messages from the same sender inside GROUP_WINDOW are
          // one burst, not separate exchanges. Grouping is what turns a list
          // back into a conversation.
          const sameAsPrev = !newDay && prev
            && prev.from_profile_id === m.from_profile_id
            && withinWindow(prev.created_at, m.created_at);

          const sameAsNext = next
            && dayKey(next.created_at) === day
            && next.from_profile_id === m.from_profile_id
            && withinWindow(m.created_at, next.created_at);

          return (
            <Fragment key={m.id}>
              {markerLabel && <ThreadMarker label={markerLabel} />}
              <MessageBubble
                message={m}
                isMine={mine.has(m.from_profile_id)}
                grouped={Boolean(sameAsPrev)}
                // Drives shape and spacing only — where a burst ends. Time is
                // no longer tied to it.
                endsBurst={!sameAsNext}
                speaker={profilesById[m.from_profile_id]}
                revealed={revealedId === m.id}
                onToggleTime={() => setRevealedId(id => (id === m.id ? null : m.id))}
              />
            </Fragment>
          );
        })}
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

      {/* No borderTop. M2 removed the header's hard rule because it read as a
          bolted-on toolbar; the identical line was still here, so the surface
          was continuous at the top and abruptly segmented at the bottom.
          Separation is now an upward wash — the mirror of the header's. */}
      <form onSubmit={onSend} style={{
        display: 'flex', alignItems: 'center', gap: 9,
        padding: '12px 16px 16px', flexShrink: 0,
        background: 'linear-gradient(0deg, rgba(255,255,255,.035) 0%, rgba(255,255,255,0) 100%)',
      }}>
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
          // 13px padding puts the field at 46px, matching the send button
          // exactly — they were 46 and 48, which is the kind of 2px mismatch
          // you feel as imbalance without being able to name it.
          style={{ flex: 1, minWidth: 0, height: 46, boxSizing: 'border-box', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.10)', borderRadius: 999, padding: '0 18px', color: 'var(--text)', fontSize: 14.5, outline: 'none' }}
        />
        <button
          type="submit"
          disabled={!senderProfile || sending || !draft.trim()}
          aria-label="Send"
          style={{ border: 'none', borderRadius: 999, width: 46, height: 46, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: senderProfile && draft.trim() ? 'pointer' : 'not-allowed', background: senderProfile && draft.trim() ? 'linear-gradient(135deg, #00E5FF, #BF5FFF)' : 'rgba(255,255,255,.07)', color: senderProfile && draft.trim() ? '#0a0a0f' : 'rgba(255,255,255,.3)', boxShadow: senderProfile && draft.trim() ? '0 8px 22px -8px rgba(191,95,255,.75)' : 'none', transition: 'background .25s ease, box-shadow .25s ease' }}
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
function MessageBubble({ message, isMine, grouped = false, endsBurst = true, speaker, revealed = false, onToggleTime }) {
  const kind = message.kind ?? 'text';

  // Avatar on RECEIVED messages only — you know who you are. Rendered once per
  // burst, on the last message, so a run of five gets one avatar rather than
  // five. Mid-burst messages get a same-width spacer so every bubble in the
  // run stays on the same left edge; without it the run would stagger.
  const meta   = PROFILE_TYPES[speaker?.type] ?? {};
  const accent = meta.accent ?? '#BF5FFF';
  const avatar = speaker?.avatar_thumb || speaker?.avatar || meta.defaultImage;
  const AVATAR = 26;

  // The tail corner belongs to the LAST bubble of a burst. Mid-burst bubbles
  // keep square-ish inner corners so a run reads as one block.
  const tail = endsBurst ? 6 : 20;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-end',
      gap: 8,
      justifyContent: isMine ? 'flex-end' : 'flex-start',
      // 3px inside a burst, 14px between turns. The gap is what separates
      // "one person talking" from "two people exchanging".
      marginBottom: endsBurst ? 14 : 3,
      marginTop: grouped ? 0 : 2,
    }}>
      {!isMine && (
        endsBurst ? (
          <span title={speaker?.name} style={{ width: AVATAR, height: AVATAR, borderRadius: 999, flexShrink: 0, padding: 1.5, background: `linear-gradient(135deg, ${accent}, ${meta.accent2 ?? '#00E5FF'})`, display: 'flex' }}>
            <span style={{ width: '100%', height: '100%', borderRadius: 999, overflow: 'hidden', background: '#0d0d10', display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent, fontFamily: "'Bebas Neue',sans-serif", fontSize: 11 }}>
              {avatar
                ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : (speaker?.name ?? '?').slice(0, 1).toUpperCase()}
            </span>
          </span>
        ) : (
          <span aria-hidden="true" style={{ width: AVATAR, flexShrink: 0 }} />
        )
      )}
      {/* Sent messages carry the canonical cyan→purple gradient, held at low
          alpha so it reads as tinted glass rather than neon.

          RECEIVED were rgba(255,255,255,.035) — all but invisible on this
          surface, which left the other participant quieter than you in their
          own conversation. Lifted to .085 with a .12 border: legible and
          clearly present, still nowhere near bright, and still visibly the
          calmer of the two so the gradient keeps the lead. */}
      <div
        onClick={onToggleTime}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleTime?.(); } }}
        aria-label={revealed ? undefined : 'Show time'}
        style={{
        cursor: 'pointer',
        maxWidth: '76%',
        borderRadius: isMine
          ? `20px 20px ${tail}px 20px`
          : `20px 20px 20px ${tail}px`,
        padding: '12px 16px',
        border: isMine ? '1px solid rgba(191,95,255,.34)' : '1px solid rgba(255,255,255,.12)',
        background: isMine
          ? 'linear-gradient(135deg, rgba(0,229,255,.20) 0%, rgba(191,95,255,.40) 100%)'
          : 'rgba(255,255,255,.085)',
        // No glow. A halo on every sent message is decoration repeated dozens
        // of times down a thread — the gradient already distinguishes it, and
        // the glow was competing with the text sitting on top of it.
        boxShadow: 'none',
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
        {/* Time on demand. Tapping a message asks it directly; otherwise the
            thread markers carry when, and the bubbles carry only what. */}
        {revealed && message.created_at && (
          <div style={{ fontSize: 10, color: isMine ? 'rgba(255,255,255,.5)' : 'rgba(255,255,255,.38)', marginTop: 5, textAlign: 'right' }}>
            {timeOf(message.created_at)}
          </div>
        )}
      </div>
    </div>
  );
}
