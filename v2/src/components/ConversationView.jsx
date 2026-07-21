import { useState, useEffect, useRef, Fragment } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import {
  listMessages, listParticipants, actableProfileIds,
  sendMessage, markConversationRead,
} from '../lib/messaging';
import { sendVoiceNote } from '../lib/voiceNotes';
import { sendHand } from '../lib/hands';
import { listHands, toggleHand } from '../lib/messageState';
import Composer from './Composer';
import { useConversationUi } from '../lib/conversationUi';
import { PROFILE_TYPES } from '../lib/profileTypes';
import { renderMessage, isBareKind } from '../lib/messageKinds';
import HandIcon from './HandIcon';

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
 * Centred DATE marker. Quiet — it orients, it does not announce.
 *
 * Days only. Every bubble carries its own clock, so a marker that also carried
 * a time repeated what was already on screen, and the old dormant-gap marker
 * was nothing BUT a time. What a bubble cannot say is which day 18:10 was, and
 * that is all this is for now.
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
/**
 * BUBBLE FILLS OVER THE WALLPAPER.
 *
 * Both are translucent so the image reads through them — that is the point of
 * having a wallpaper at all.
 *
 * ⚠ THE SENT FILL REPLACES THE BRAND GRADIENT, as specified. It is worth
 * knowing what that costs: the cyan→purple gradient was the only thing
 * distinguishing sent from received at a glance, and both are now dark
 * translucent panels differing by about 10% alpha. On a flat background that
 * reads; over a photograph with this much texture, two near-identical
 * translucent panels are much harder to tell apart than they are on a mockup.
 *
 * Swapping the one constant below back to the gradient is the whole change:
 *   linear-gradient(135deg, rgba(0,229,255,.20) 0%, rgba(191,95,255,.40) 100%)
 */
const SENT_BUBBLE     = 'rgba(0,0,0,.55)';
const RECEIVED_BUBBLE = 'rgba(255,255,255,.10)';

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
  // profile_id -> profile, so a received bubble can show its speaker. Keyed by
  // the ATTRIBUTION id (from_profile_id), never the human — §A3.
  const [profilesById, setProfilesById] = useState({});
  // message_id -> [profile_id], every Yes on every message in view. A Set of
  // MY handed message ids would be simpler, but would make "did anyone say
  // yes" unanswerable when group threads arrive (`DA1`).
  const [handsByMessage, setHandsByMessage] = useState(new Map());
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

      // Every Yes on the thread, in one query rather than one per message.
      // Loaded AFTER the messages are on screen: a reaction is decoration on
      // something already readable, and blocking the thread behind it would
      // trade the important render for the ornamental one.
      const { byMessage } = await listHands(rows.map(r => r.id));
      if (!cancelled.current) setHandsByMessage(byMessage);

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

  /**
   * What happens to EVERY message once it exists, whatever kind it is.
   *
   * Text, voice and Hand differ only in how the row is created; from here they
   * are identical — optimistic append, preview patch, read mark. Written once
   * because three copies of this is how the third one quietly drifts, and
   * `writeNotification.js` already records what fifteen copies of a write path
   * cost this codebase.
   *
   * The kind comes from the ROW, never a literal. `lastPreview` once said
   * kind: 'text' while `messages` had no kind column at all — true by accident,
   * and wrong the moment any other kind existed.
   */
  async function afterSend(message) {
    setMessages(prev => [...prev, message]);
    setSending(false);
    patch(conversationId, { lastPreview: { text: message.body, kind: message.kind } }, true);
    await markConversationRead(conversationId);
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

    onDraftChange('');
    await afterSend(message);
  }

  /**
   * A Hand — YesPleez's universal acknowledgement, sent to the conversation.
   *
   * The ratified rule: a CONVERSATION Hand is a message, a MESSAGE Hand is
   * metadata. This is the first form, so it is an ordinary message with an
   * ordinary kind and no special path — which is why it is four lines.
   *
   * One tap sends it. No confirmation step, deliberately: a Yes that takes two
   * taps is not a Yes worth having, and the entire value is that it costs
   * nothing to send.
   */
  /**
   * Double-tap: give a message a Yes, or take it back.
   *
   * OPTIMISTIC. The gesture has to feel instant — it is meant to become the
   * most-used interaction in the app — so the badge appears on the tap and the
   * write follows. On failure the state is put back exactly as it was, which
   * is why the previous value is captured rather than recomputed.
   *
   * `handed_at` is per PROFILE (§A3 attribution), so the question is "has the
   * profile I am speaking as said yes to this", not "have I".
   */
  async function onToggleHand(messageId) {
    if (!senderProfile) return;

    const before  = handsByMessage.get(messageId) ?? [];
    const wasHanded = before.includes(senderProfile);
    const after = wasHanded
      ? before.filter(id => id !== senderProfile)
      : [...before, senderProfile];

    setHandsByMessage(prev => {
      const next = new Map(prev);
      if (after.length) next.set(messageId, after); else next.delete(messageId);
      return next;
    });

    const { error: toggleError } = await toggleHand({
      messageId, profileId: senderProfile, handed: wasHanded,
    });

    if (toggleError) {
      setHandsByMessage(prev => {
        const next = new Map(prev);
        if (before.length) next.set(messageId, before); else next.delete(messageId);
        return next;
      });
      setError(toggleError.message ?? 'Could not update that.');
    }
  }

  async function onSendHand() {
    if (!senderProfile || sending) return;
    setSending(true);
    setError(null);

    const { message, error: sendError } = await sendHand({
      conversationId,
      fromProfileId: senderProfile,
    });

    if (sendError) {
      setError(sendError.message ?? 'Could not send.');
      setSending(false);
      return;
    }

    await afterSend(message);
  }

  /**
   * A finished recording, on its way to becoming a message.
   *
   * Everything after the upload is identical to sending text — the same
   * optimistic append, the same preview patch, the same read mark. That
   * sameness is the point: a voice note is a message with a different kind,
   * not a second send path that has to be kept in step with this one.
   */
  async function onRecordedVoice({ blob, durationMs, capture }) {
    if (!senderProfile || sending) return;
    setSending(true);
    setError(null);

    const { message, error: sendError } = await sendVoiceNote({
      conversationId,
      fromProfileId: senderProfile,
      blob,
      durationMs,
      capture,   // `C21` — what the device actually negotiated, not what we asked for
    });

    if (sendError) {
      // Upload and insert failures arrive here identically, and should: the
      // sender only cares that it did not send.
      setError(sendError.message ?? 'Could not send that recording.');
      setSending(false);
      // Thrown, not returned: the recorder awaits this to decide between its
      // `sent` and `idle` states, and a silent return would show "Sent" for a
      // message that never left.
      throw sendError;
    }

    await afterSend(message);
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
        style={{
          flex: 1, overflowY: 'auto', padding: '22px 18px 8px', minHeight: 0,
          // THE WALLPAPER.
          //
          // On the SCROLL CONTAINER, with attachment left at its default
          // `scroll` — which on a scrollable element means the image is fixed
          // to the element and messages travel over it. `local` would scroll
          // the image away with the content; `fixed` would pin it to the
          // browser viewport, so inside the drawer it would align to the window
          // rather than to the thread.
          backgroundImage: "url('/chat-bg.webp')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          // Under the image, so a slow load or a failed fetch shows the app's
          // own surface rather than a white flash in a dark thread.
          backgroundColor: 'var(--dark)',
        }}
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

          // DATE ONLY — never a time.
          //
          // Every bubble carries its own clock now, so a marker that repeated
          // it said the same thing twice on the same screen. The dormant-gap
          // marker was PURELY a time and is gone entirely.
          //
          // Day markers stay, and are not redundant: a bubble shows 18:10, and
          // only the marker can say whether that was today or three weeks ago.
          const markerLabel = newDay ? dayLabel(m.created_at) : null;

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
                handed={(handsByMessage.get(m.id) ?? []).includes(senderProfile)}
                onToggleHand={() => onToggleHand(m.id)}
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
          Separation is now an upward wash — the mirror of the header's.

          The composer owns its own row entirely (M9h). This view no longer
          renders the field, the mic or the send button, and no longer holds a
          positioning context for anything to overlay — which is what the old
          `inset: 0 62px 0 0` depended on. */}
      <Composer
        draft={draft}
        onDraftChange={onDraftChange}
        onSubmit={onSend}
        onRecorded={onRecordedVoice}
        onSendHand={onSendHand}
        onNotice={setError}
        sending={sending}
        canWrite={Boolean(senderProfile)}
        placeholder={senderProfile ? 'Type a message…' : 'You cannot write in this conversation'}
        inputRef={inputRef}
        onInputEvent={rememberSelection}
      />
    </div>
  );
}

/**
 * Dispatches on message kind so voice notes, images, attachments and native
 * YesPleez cards land as branches rather than a rewrite. Only `text` exists —
 * the others are declared, not built, and nothing here pretends otherwise.
 */
function MessageBubble({ message, isMine, grouped = false, endsBurst = true, speaker, handed = false, onToggleHand }) {

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

  // Asked of the registry, not decided here. Whether a kind is drawn in a
  // bubble is a fact about the kind, and this component deliberately knows
  // nothing else about kinds.
  const bare = isBareKind(message.kind);

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
          calmer of the two so the gradient keeps the lead.

          BARE KINDS GET NONE OF IT. An acknowledgement is not someone SAYING
          something, so it is not drawn in a thing that means "someone said
          this" — no background, no border, no padding, no tail. It keeps its
          side, its avatar, its place in the order and its timestamp, because
          it is still a message in every respect except how it looks. */}
      <div
        // DOUBLE-TAP TO YES. React's onDoubleClick covers mouse and touch, and
        // needs no disambiguation delay because single tap does nothing now —
        // the timestamp gave up that gesture in M9h.3 precisely so this one
        // could be instant.
        onDoubleClick={onToggleHand}
        // Suppresses the text selection a double-tap otherwise makes, which
        // would flash a highlight across the message every time.
        onMouseDown={e => { if (e.detail > 1) e.preventDefault(); }}
        style={bare ? {
          maxWidth: '76%', position: 'relative',
          // The mark supplies its own presence; padding here would only push
          // the timestamp away from it.
          padding: 0,
          background: 'none',
          border: 'none',
        } : {
        maxWidth: '76%', position: 'relative',
        borderRadius: isMine
          ? `20px 20px ${tail}px 20px`
          : `20px 20px 20px ${tail}px`,
        padding: '12px 16px',
        border: isMine ? '1px solid rgba(191,95,255,.34)' : '1px solid rgba(255,255,255,.12)',
        background: isMine ? SENT_BUBBLE : RECEIVED_BUBBLE,
        // No glow. A halo on every sent message is decoration repeated dozens
        // of times down a thread — the gradient already distinguishes it, and
        // the glow was competing with the text sitting on top of it.
        boxShadow: 'none',
      }}>
        {/* The bubble owns the CONTAINER — alignment, tail, spacing — and knows
            nothing about kinds. Content comes from the registry, so a new kind
            is a renderer there and no change here. */}
        {renderMessage(message)}

        {/* ALWAYS VISIBLE, never on tap.

            This used to be tap-to-reveal, which spent the single tap — the most
            valuable gesture a message has — on the least valuable information.
            The ratified decision is that double-tap-to-Yes takes precedence and
            the timestamp is secondary, so the timestamp gives up its gesture
            entirely rather than competing for it with a disambiguation delay
            that would make every tap feel slow.

            Permanently visible is also simply better: WhatsApp does it, and
            "when was this said" stops being a question you have to ask. */}
        {message.created_at && (
          <div style={{
            fontSize: 10,
            lineHeight: 1,
            color: isMine ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.42)',
            marginTop: 5,
            textAlign: 'right',
            // Cannot be selected or dragged — it sits inside the double-tap
            // target and a text selection would swallow the second tap.
            userSelect: 'none',
          }}>
            {timeOf(message.created_at)}
          </div>
        )}

        {/* THE YES, WHERE INSTAGRAM PUTS THE HEART.
            Overhangs the bubble's bottom corner so it reads as attached to the
            message rather than as part of what was said. Negative margins keep
            it out of the layout entirely, so a message does not change height
            when it gains one — otherwise the thread would jump under the
            reader's thumb at the moment they react. */}
        {handed && (
          <span
            role="img"
            aria-label="You said Yes to this"
            style={{
              position: 'absolute',
              // Hangs mostly BELOW the bubble rather than across it. The
              // timestamp is now permanently at the bubble's bottom-right, so a
              // reaction centred on that corner would sit on top of the time.
              // At -16 with a 27px mark it reaches ~11px into the bubble —
              // under the text, not over it.
              bottom: -16,
              // The INNER edge: toward the middle of the thread. On a received
              // message the outer edge is where the avatar lives, and on a sent
              // one it is the screen edge.
              [isMine ? 'left' : 'right']: -8,
              display: 'flex',
              color: 'var(--text)',
              // FREE FLOATING — no chip, no circle, no border. The mark sits on
              // the thread exactly as the standalone acknowledgement does: this
              // app's language is that the mark needs no container, and a badge
              // would have made the reaction the one place it wore one.
              //
              // drop-shadow, not box-shadow: the element is a masked rectangle,
              // so box-shadow would draw the shadow of a SQUARE around a hand.
              // filter follows the mask's alpha, so the shadow is hand-shaped —
              // which is what separates it from the bubble it overhangs.
              filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.75))',
              animation: 'ypYes .32s cubic-bezier(.2,1.5,.4,1)',
              pointerEvents: 'none',
            }}
          >
            <HandIcon size={27} />
          </span>
        )}
      </div>
    </div>
  );
}
