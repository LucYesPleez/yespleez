import { useState, useEffect, useRef, Fragment } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import {
  listMessages, listParticipants, actableProfileIds,
  sendMessage, markConversationRead,
  markConversationDelivered, conversationReceipts, receiptChannelName,
} from '../lib/messaging';
import { sendVoiceNote, VOICE_FALLBACK_BODY } from '../lib/voiceNotes';
import { sendImage, sendOriginalOnly, prepareImage, IMAGE_FALLBACK_BODY, describeOriginal, formatBytes as formatImageBytes } from '../lib/messageImages';
import { sendFile, bodyForFile, safeName, isLosslessAudio, isPlayableAudio, WAVE_CEILING_BYTES, MAX_BYTES, formatBytes } from '../lib/messageFiles';
import { computeWave } from '../lib/voiceWave';
import { sendHand, HAND_BODY } from '../lib/hands';
import { listHands, toggleHand } from '../lib/messageState';
import Composer, { COMPOSER_HEIGHT } from './Composer';
import AudioSendSheet from './AudioSendSheet';
import { useConversationUi } from '../lib/conversationUi';
import { PROFILE_TYPES } from '../lib/profileTypes';
import { renderMessage, isBareKind, canReceiveHand, shapeFor, materialFor } from '../lib/messageKinds';
import HandIcon from './HandIcon';
import EqReceipt from './EqReceipt';
import { receiptFor, RECEIPT } from '../lib/receiptState';
import { makePending, appendPending, settlePending, failPending, revokePendingUrl } from '../lib/pendingSend';
import { timeOf } from '../lib/clock';

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
 * BUBBLE FILLS — SMOKED BLACK GLASS, not coloured plastic (M9u).
 *
 * Both are translucent so the wallpaper reads through them — that is the point
 * of having one at all.
 *
 * ── THE PURPLE IS THE LIGHT, NOT THE MATERIAL ────────────────────────
 *
 * Sent bubbles were `rgba(0,229,255,.20) → rgba(191,95,255,.40)`: a saturated
 * cyan-to-violet wash that WAS the surface. Repeated down a thread it read as
 * bright plastic, and it competed with the text and the waveform sitting on
 * top of it — the two things a message actually consists of.
 *
 * The fill is now near-black with a violet lean, and the colour has moved to
 * where light belongs: the border, the top highlight, and above all the
 * waveform, which is the one element allowed to be vivid. Think of a dark
 * surface catching a coloured light rather than a surface that IS the colour.
 *
 * Kept dark enough that an idle Voicey settles into the conversation, so
 * pressing play is what brings the colour up.
 *
 * ── STILL CLEARLY DISTINGUISHABLE FROM RECEIVED ──────────────────────
 *
 * The old comment's warning stands: two dark translucent panels differing by a
 * few percent alpha are much harder to tell apart over a photograph than they
 * look in a mockup. Sent no longer wins on saturation, so it has to win
 * elsewhere — it is warmer, it is lit along its top edge, and its border
 * carries violet where received carries plain white. Those three together do
 * the job the wash used to do alone.
 */
/**
 * Same treatment as a Voicey's, one notch lighter so a wall of text bubbles
 * does not go heavier than the wallpaper behind it. `rgba(30,27,38)` is eight
 * points of red-to-blue spread — charcoal that has been NEAR something violet,
 * rather than something violet.
 *
 * The magenta edge lives in the border layer, so the fill can stay neutral.
 */
const SENT_BUBBLE =
  'linear-gradient(155deg, rgba(30,27,38,.72) 0%, rgba(16,14,21,.82) 100%) padding-box,'
  + 'linear-gradient(150deg, rgba(255,79,216,.34) 0%, rgba(191,95,255,.13) 46%, rgba(255,255,255,.04) 100%) border-box';
const RECEIVED_BUBBLE = 'rgba(255,255,255,.085)';

/** Transparent, so the border-box gradient above shows through as the edge. */
const SENT_BORDER   = '1px solid transparent';

/**
 * THE YES BADGE'S GEOMETRY. Everything else about it lives in `index.css` under
 * `.yp-msg-frame` / `.yp-yes-badge`; these two exist because JS also needs them.
 *
 * ⚠ THEY MUST EQUAL `--yp-yes-size` AND `--yp-yes-drop`. The badge is drawn by a
 * React component that takes a pixel size, and the row reserves the drop as
 * inline padding — neither can read a custom property. `yesBadgeGeometry.test.js`
 * asserts the two definitions still agree, because a silent drift here reappears
 * as the badge overlapping the next message, which is the fault this replaced.
 */
const YES_SIZE = 27;
const YES_DROP = 6;
/**
 * A single lit pixel along the top edge. Not a glow: a glow around every sent
 * message is decoration repeated dozens of times down a thread, and that is
 * why `boxShadow` stays otherwise off. This is one inset line, which is what
 * makes a dark panel read as glass rather than as a hole.
 */
const SENT_LIGHTING = 'inset 0 1px 0 rgba(216,180,255,.11)';

/**
 * How far the wallpaper is pushed back behind the conversation.
 *
 * The photograph is high-contrast and was overpowering the thread at full
 * strength — it read as the subject rather than the surface. This is the one
 * number that controls that: raise the alpha to quiet it further, lower it to
 * let more of the image through.
 *
 * Tinted with the app's own --dark rather than pure black, so the dimmed image
 * settles into the surrounding UI instead of turning into a grey wash.
 */
/**
 * .72 → .80, which is "another 30% dimmer".
 *
 * Measured on what SHOWS rather than on the alpha itself: at .72 the image came
 * through at 28%, and 30% less of that is 19.6% — an alpha of .804, rounded to
 * .80. Scaling the alpha directly instead (.72 × 1.3) would land at .94 and
 * leave almost nothing visible, which is a different instruction.
 */
const CHAT_BG_SCRIM = 'rgba(10,10,15,.80)';

/**
 * The wallpaper's aspect ratio, from the file: 1162x2093.
 *
 * Hardcoded because `background-size: 100% auto` gives the browser no API to
 * report the rendered height back, and `paintWallpaper` needs it to know how
 * far the image overflows the window. Loading the image again in JS just to
 * measure it would download it twice.
 *
 * ⚠ If chat-bg.webp is ever replaced with a differently-proportioned image, this
 * number must change with it — otherwise the scroll clamp is computed against
 * a height the image does not have, and it will pin early or late.
 */
const CHAT_BG_RATIO = 1162 / 2093;

/**
 * How fast the wallpaper travels relative to the messages.
 *
 * 1 moves it with the content, which reads as the image being part of the
 * thread. Lower is parallax — it drifts behind, so the messages appear to slide
 * over something sitting further back, and the lower the number the further
 * back it sits. 0 pins it outright, which is the same as no effect.
 *
 * 0.35: half rate, then 30% slower again (0.5 × 0.7).
 *
 * The cost of going slower is reveal distance — at 0.35 the image needs roughly
 * 1300px of scrolling to expose its top, against 460px at full rate. Most
 * threads will only ever show the lower part of it. That is the trade being
 * made deliberately: depth in exchange for how much of the picture is ever
 * seen.
 */
/**
 * 0.35 → 0.175 (owner, 2026-07-22): halved again, so the image drifts at about
 * a sixth of the messages' speed.
 *
 * The cost named above is now doubled with it — full reveal needs roughly
 * 2600px of scrolling rather than 1300. Most threads will only ever show the
 * lowest part of the picture. That remains the deliberate trade: this is a
 * surface the conversation sits ON, and the further back it sits, the less it
 * competes with what is being read.
 */
const CHAT_BG_PARALLAX = 0.175;

/**
 * How far the message list extends DOWN behind the composer.
 *
 * The wallpaper is painted on the scroll container, so this is what stops the
 * image ending in a straight line where the composer starts — the picture runs
 * the full way under the bar instead.
 *
 * ⚠ IMPORTED, NOT WRITTEN DOWN. It was the literal 88 until the composer was
 * resized to Messenger's weight and became 62; a copied number would have left
 * the image resting in the wrong place with nothing to point at. The composer
 * computes its own height from the parts that make it, and this follows.
 */
/**
 * ⚠ A FUNCTION, NOT A CONSTANT, AND THAT IS NOT STYLE.
 *
 * `const COMPOSER_BLEED = COMPOSER_HEIGHT` at module scope threw
 * "COMPOSER_HEIGHT is not defined" and blanked the screen in dev. This module
 * sits in a circular import — ConversationView → App → screens →
 * ConversationView — so it can be evaluated before Composer has finished, and
 * reading an imported binding at TOP LEVEL hits the temporal dead zone.
 *
 * The production build did NOT catch it: the bundler hoists and orders modules
 * differently, so `npm run build` passed while the dev server was broken.
 *
 * Deferring the read to call time fixes it, because by the time anything calls
 * this every module has finished evaluating. Do not turn it back into a
 * top-level constant.
 */
const composerBleed = () => COMPOSER_HEIGHT;

/**
 * HOW FAR THE WALLPAPER CAN DRIFT — and therefore how much image is needed.
 *
 * The image can only travel as far as it has spare height above `restBottom`,
 * so this number and the crop are the same decision seen from two ends. It went
 * in because the drift had quietly fallen to 5px: growing the list by
 * COMPOSER_BLEED, then resting the image half way up the composer, between them
 * consumed all the headroom the width-locked artwork had. The parallax rate was
 * still being applied to almost nothing.
 *
 * 180 buys visible movement without a severe crop. At 412px wide it needs the
 * image about 23% wider than the screen, taken off the LEFT (see the
 * right-anchored background-position below).
 *
 * Raise it for more drift and more crop; lower it for the reverse. Where the
 * width alone already provides this much — the desktop drawer always does —
 * nothing is cropped at all.
 */
const BG_TRAVEL_PX = 180;

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
  // An audio file waiting on its send sheet (M12). Holds the File and whether
  // it qualified for the HD chip, so the sheet can describe what is being sent.
  const [pendingAudio, setPendingAudio] = useState(null);
  // profile_id -> profile, so a received bubble can show its speaker. Keyed by
  // the ATTRIBUTION id (from_profile_id), never the human — §A3.
  const [profilesById, setProfilesById] = useState({});
  // message_id -> [profile_id], every Yes on every message in view. A Set of
  // MY handed message ids would be simpler, but would make "did anyone say
  // yes" unanswerable when group threads arrive (`DA1`).
  const [handsByMessage, setHandsByMessage] = useState(new Map());
  /**
   * Latest moment any OTHER participant read this thread — the EQ receipt's
   * top rung. ONE timestamp for the whole conversation, not a flag per message:
   * see `conversationSeenWatermark`, where the reason is the §2.5 amendment
   * rather than an optimisation.
   */
  const [seenWatermark, setSeenWatermark] = useState(null);
  /** Latest moment the message reached anyone else's DEVICE. See M10b. */
  const [deliveredWatermark, setDeliveredWatermark] = useState(null);
  /** The broadcast channel this thread's receipts travel on, while open. */
  const receiptChannel = useRef(null);
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

      // The OTHER side's watermarks, for receipts. Same placement as the hands
      // above and for the same reason: a receipt is decoration on a message
      // that is already readable, so it must never block the thread.
      const { deliveredAt, seenAt } = await conversationReceipts(conversationId);
      if (!cancelled.current) {
        setDeliveredWatermark(deliveredAt);
        setSeenWatermark(seenAt);
      }

      // ⚠ ACKNOWLEDGE ON LOAD, BEFORE marking read.
      //
      // This is the reconnect path: messages that arrived while this device was
      // closed or offline were never acknowledged by any live subscription, and
      // opening the thread is the first moment they are genuinely HERE. Without
      // this the sender would jump from one bar to three, skipping the rung
      // that says the message actually arrived.
      await markConversationDelivered(conversationId);
      announceReceipt('delivered');

      // `C11` — this human's watermark. Monotonic in the database.
      await markConversationRead(conversationId);
      announceReceipt('read');
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
          // ⚠ THE ACKNOWLEDGEMENT, at the only moment that honestly counts:
          // this device now HAS the message. Not when it was stored, not when a
          // push was queued — the row is in this client's hands.
          //
          // Unconditional, and before the read branch below: delivery does not
          // depend on whether you are scrolled to the bottom, and a message you
          // have received while reading history is every bit as delivered.
          markConversationDelivered(conversationId);
          announceReceipt('delivered');

          if (atBottomRef.current) {
            // Reading at the bottom: the watermark should follow.
            markConversationRead(conversationId);
            announceReceipt('read');
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

  /**
   * Tell the other side a rung has been reached.
   *
   * Fire-and-forget: the durable record is the row this client just wrote, and
   * a failed announcement costs the sender a delay, not correctness — they read
   * the same fact from the table when they next open the thread.
   */
  function announceReceipt(kind) {
    const at = new Date().toISOString();
    receiptChannel.current?.send({
      type: 'broadcast',
      event: 'receipt',
      payload: kind === 'read' ? { read: at, delivered: at } : { delivered: at },
    });
  }

  /**
   * RECEIPTS TRAVEL ON A BROADCAST CHANNEL. There is no poll.
   *
   * An earlier version polled this every 15 seconds, because read state
   * advances by UPDATE and both message subscriptions here are INSERT-only —
   * so nothing told this client that the other side had just opened a message.
   *
   * ⚠ A TABLE SUBSCRIPTION CANNOT SOLVE IT EITHER, which is the part worth
   * understanding before anyone "improves" this. `postgres_changes` respects
   * RLS, and the sender is forbidden from reading the recipient's read-state
   * row — M8d's wall, which M10a deliberately left standing. Subscribing to
   * that table would deliver the sender precisely nothing.
   *
   * Broadcast goes client to client and never touches that row, so it sidesteps
   * the problem rather than working around it. The database stays the source of
   * truth — read once on open, above — and the wire only carries liveness.
   *
   * Missing a broadcast is harmless by design: it is picked up from
   * `conversationReceipts` the next time the thread opens.
   */
  useEffect(() => {
    if (!conversationId) return undefined;

    const channel = supabase.channel(receiptChannelName(conversationId), {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'receipt' }, ({ payload }) => {
      // Monotonic on the way in. A delayed or duplicated announcement must
      // never walk a watermark BACKWARDS and un-deliver a message the sender
      // has already been shown — the same guarantee the database gives, applied
      // again here because the wire can reorder.
      const advance = setter => value => setter(prev =>
        !prev || (value && Date.parse(value) > Date.parse(prev)) ? (value ?? prev) : prev);
      if (payload?.delivered) advance(setDeliveredWatermark)(payload.delivered);
      if (payload?.read)      advance(setSeenWatermark)(payload.read);
    });

    channel.subscribe();
    receiptChannel.current = channel;

    return () => {
      receiptChannel.current = null;
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  /**
   * THE WALLPAPER TRACKS THE SCROLL, THEN PINS.
   *
   * At the bottom of the thread the image's bottom sits on the window's bottom.
   * Scrolling up drags the image down with the content, revealing more of it —
   * so the wallpaper belongs to the conversation rather than floating over it.
   * The moment its TOP reaches the window top it stops, and messages carry on
   * scrolling past a now-stationary image.
   *
   * That clamp is the whole reason this is JS. `background-attachment: local`
   * gives the first half for free, but it keeps going — the image would slide
   * off the bottom and leave a gap above it in any thread taller than the
   * picture, which is most of them.
   *
   * Written straight to style on a ref, never through state: scroll fires at
   * display rate and a re-render per event would make the thread stutter for a
   * decorative effect.
   */
  function paintWallpaper(el) {
    // ── WHERE THE IMAGE'S BOTTOM RESTS ──────────────────────────────
    //
    // Half way up the composer, not at the very bottom of the container.
    //
    // The list bleeds COMPOSER_BLEED past the composer so the picture runs on
    // underneath it — but resting the image's bottom down THERE spent its whole
    // last stretch hidden behind an opaque bar. Stopping half way up means far
    // more of the photograph lands where it can actually be seen, and the point
    // where it ends is behind the composer rather than out in the open.
    const restBottom = el.clientHeight - composerBleed() / 2;

    // ── HOW TALL THE IMAGE HAS TO BE ────────────────────────────────
    //
    // Two things depend on it, and at phone size the width alone delivers
    // neither. It must reach `restBottom` so nothing is chopped off, AND carry
    // BG_TRAVEL_PX of surplus above that, because the surplus IS the parallax:
    // the image can only drift as far as it has spare height.
    //
    // Width-locked (100% wide) is the ideal — the whole photograph shows. Where
    // that is tall enough, it is what gets used; on the desktop drawer it
    // always is. At phone size it falls ~200px short, so the height is locked
    // instead and the width overflows.
    const widthLocked = el.clientWidth / CHAT_BG_RATIO;
    const needed      = restBottom + BG_TRAVEL_PX;
    const renderedHeight = Math.max(widthLocked, needed);

    // Only pay the crop when the width genuinely cannot deliver. `100% auto`
    // and `auto Npx` are the same picture at the same ratio — the difference is
    // only which axis is doing the constraining.
    el.style.backgroundSize = renderedHeight > widthLocked
      ? `auto, auto ${Math.ceil(renderedHeight)}px`
      : 'auto, 100% auto';

    // 0 at the newest message, growing as the reader moves back through time.
    const fromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;

    // At rest the image's bottom sits on `restBottom`; scrolling back drags it
    // down until its TOP reaches the top of the box, and then it pins. Clamped
    // at 0 so it can never travel past that and open a gap above.
    //
    // PARALLAX slows the rate, so the image drifts behind the messages instead
    // of moving with them — which is what reads as depth. The side effect is
    // that full reveal takes 1/PARALLAX times as much scrolling, so a short
    // thread may never expose the top of the image at all. That is correct: the
    // clamp still guarantees no gap, and a wallpaper that only fully appears in
    // a long conversation is a better outcome than one that races the text.
    const rest = restBottom - renderedHeight;
    const y = Math.min(0, fromBottom * CHAT_BG_PARALLAX + rest);
    // RIGHT-ANCHORED, so when the image is wider than the box the overflow is
    // taken off the LEFT. Owner's choice, and it is a choice about the artwork
    // rather than about layout — `center` would halve the loss but take it from
    // both edges, and the right of this photograph is the side worth keeping.
    el.style.backgroundPosition = `center, right ${Math.round(y)}px`;
  }

  // Position it before the first paint of a thread, and again whenever the
  // container resizes — the offset is derived from clientWidth/Height, so a
  // drawer resize or an orientation change invalidates it.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    paintWallpaper(el);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => paintWallpaper(el));
    ro.observe(el);
    return () => ro.disconnect();
  }, [conversationId, messages.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    paintWallpaper(el);
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    atBottomRef.current = atBottom;
    patch(conversationId, { scrollTop: el.scrollTop });
    if (atBottom && pendingNew > 0) {
      setPendingNew(0);
      markConversationRead(conversationId);
      announceReceipt('read');
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
  async function afterSend(message, pendingId = null) {
    setMessages(prev => (pendingId
      ? settlePending(prev, pendingId, message)
      : [...prev, message]));
    setSending(false);
    patch(conversationId, { lastPreview: { text: message.body, kind: message.kind } }, true);
    await markConversationRead(conversationId);
  }

  /**
   * Send anything that can be retried, with the message on screen throughout.
   *
   * The placeholder goes in BEFORE the await and stays there whatever happens:
   * it becomes the real row on success, and turns red on failure. What it never
   * does is disappear. The old path appended only after the insert returned, so
   * a failed send left the thread untouched and the only evidence was a line of
   * text above the composer — which is indistinguishable, at a glance, from
   * having sent successfully and scrolled.
   *
   * `attempt` is a thunk rather than the arguments, because text and the Hand
   * reach different functions; `retry` beside it is the DATA needed to build
   * that thunk again later. See `pendingSend.js` for why a stored closure would
   * be an attribution bug.
   */
  async function trySend({ attempt, retry, body, kind, payload }) {
    const pending = makePending({ body, kind, fromProfileId: senderProfile, retry, payload });
    setMessages(prev => appendPending(prev, pending));
    setSending(true);
    setError(null);

    const { message, error: sendError } = await attempt();

    if (sendError) {
      // No `setError` banner. The message itself is now carrying the failure,
      // and saying it twice would put a permanent red line above the composer
      // for a message the user can already see and act on.
      setMessages(prev => failPending(prev, pending.id, sendError.message ?? null));
      setSending(false);
      return { ok: false, error: sendError };
    }

    // The server's row has a storage path now, so the local copy is dead
    // weight. Revoked HERE and not on failure: a failed Voicey has to stay
    // playable, because deciding whether to retry it usually means listening
    // back to what you actually said.
    revokePendingUrl(pending);
    await afterSend(message, pending.id);
    return { ok: true, message };
  }

  async function onSend(e) {
    e.preventDefault();
    if (!draft.trim() || !senderProfile || sending) return;

    const body = draft;
    // Cleared BEFORE the await, not after a successful insert. The draft's job
    // is done the moment the message is on screen; leaving it in the field
    // would show the same sentence twice for the length of the round trip, and
    // a second Enter would send it twice.
    onDraftChange('');

    await trySend({
      body,
      retry:   { type: 'text', body },
      attempt: () => sendMessage({
        conversationId,
        fromProfileId: senderProfile,   // ATTRIBUTION only; the human comes from the session
        body,
      }),
    });
  }

  /**
   * Send a failed message again.
   *
   * The old placeholder is replaced by a NEW one rather than revived in place,
   * so a second failure is a fresh `waiting → failed` transition. Mutating the
   * existing one back to `waiting` would leave `EqReceipt`'s `prev` ref equal to
   * the state it lands on, and the glyph would sit silently on red without ever
   * showing the retry was attempted.
   *
   * ⚠ The acting profile is re-read HERE, at retry time, from `senderProfile`.
   * §2.1 fixes the sending identity for the life of a conversation so it should
   * not have moved — but reading it now rather than from the stored attempt is
   * what makes that a guarantee rather than an assumption.
   */
  async function onRetry(message) {
    if (!senderProfile || sending) return;
    const retry = message?.retry;
    if (!retry) return;

    setMessages(prev => prev.filter(m => m.id !== message.id));

    if (retry.type === 'voice') {
      // A FRESH object url, and the old one released. Reusing it would tie the
      // new placeholder's lifetime to the old one's — settling the retry would
      // revoke a url the discarded message still referenced, and any second
      // retry after that would render a bubble pointing at a revoked blob.
      revokePendingUrl(message);
      await trySend({
        body: VOICE_FALLBACK_BODY, kind: 'voice', retry,
        payload: {
          localUrl:    URL.createObjectURL(retry.blob),
          duration_ms: Math.max(0, Math.round(retry.durationMs ?? 0)),
          ...(retry.wave && { wave: retry.wave }),
        },
        attempt: () => sendVoiceNote({
          conversationId,
          fromProfileId: senderProfile,
          blob:       retry.blob,
          durationMs: retry.durationMs,
          wave:       retry.wave,    // computed at record time; a retry never re-decodes
          capture:    retry.capture,
        }),
      });
      return;
    }

    if (retry.type === 'image-original') {
      await trySend({
        body: retry.file.name || IMAGE_FALLBACK_BODY, kind: 'image', retry,
        payload: { name: retry.file.name, pendingBytes: retry.file.size },
        attempt: () => sendOriginalOnly({
          conversationId, fromProfileId: senderProfile, file: retry.file,
        }),
      });
      return;
    }

    if (retry.type === 'image') {
      // A FRESH object url, and the old one released — the same reasoning as
      // voice above. Reusing it would tie the new placeholder's lifetime to the
      // discarded one's, and settling the retry would revoke a url a second
      // retry still needed.
      revokePendingUrl(message);
      await trySend({
        body: IMAGE_FALLBACK_BODY, kind: 'image', retry,
        payload: {
          localUrl: URL.createObjectURL(retry.image.blob),
          width:    retry.image.width,
          height:   retry.image.height,
        },
        attempt: () => sendImage({
          conversationId,
          fromProfileId: senderProfile,
          image: retry.image,   // prepared once at pick time; a retry never re-encodes
          // ⚠ CARRIED THROUGH THE RETRY. Without these a failed HD send would
          // quietly come back as an ordinary photo, and the sender would have
          // no way to know the original they asked to keep was not kept.
          preserveOriginal: retry.preserveOriginal,
        }),
      });
      return;
    }

    if (retry.type === 'file') {
      // The original File is re-uploaded. No object url to revoke and nothing
      // to re-prepare — a document has no local representation to keep alive.
      await trySend({
        body: bodyForFile(retry.file.name), kind: 'file', retry,
        payload: { name: safeName(retry.file.name), bytes: retry.file.size, mime: retry.file.type || null, ...(isLosslessAudio(retry.file.name, retry.file.type) && { hd: true }), ...(retry.downloadable === false && { downloadable: false }), ...(retry.wave && { wave: retry.wave }) },
        attempt: () => sendFile({ conversationId, fromProfileId: senderProfile, file: retry.file, downloadable: retry.downloadable !== false, wave: retry.wave ?? null }),
      });
      return;
    }

    if (retry.type === 'hand') {
      await trySend({
        body: message.body, kind: message.kind, retry,
        attempt: () => sendHand({ conversationId, fromProfileId: senderProfile }),
      });
      return;
    }

    await trySend({
      body: retry.body, retry,
      attempt: () => sendMessage({ conversationId, fromProfileId: senderProfile, body: retry.body }),
    });
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

    await trySend({
      body:    HAND_BODY,
      kind:    'hand',
      retry:   { type: 'hand' },
      attempt: () => sendHand({ conversationId, fromProfileId: senderProfile }),
    });
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

    // Computed BEFORE the placeholder, and handed to both it and the upload.
    // Without them `toDisplayPeaks` returns null and the pending bubble draws a
    // collapsed waveform that pops into shape when the real row lands — which
    // reads as the recording having been damaged and then repaired.
    //
    // It is a decode of a blob already in memory, not a network call, so the
    // delay before the bubble appears is a few milliseconds. Degrades to no
    // waveform rather than no message: `computePeaks` already returns null on
    // failure and `sendVoiceNote` omits the key entirely when it does.
    const wave = await computeWave(blob);

    const { ok, error: sendError } = await trySend({
      body: VOICE_FALLBACK_BODY,
      kind: 'voice',
      // ⚠ THE RECORDING IS KEPT. This is the whole change: a failed Voicey used
      // to be discarded here, and audio the user cannot re-perform — the one
      // thing in this app that is genuinely unrecoverable — was gone with no
      // way back. The blob is held in the placeholder until it either uploads
      // or the user gives up on it.
      retry: { type: 'voice', blob, durationMs, capture, wave },
      // A local url so the pending bubble is a real, playable Voicey rather
      // than a grey placeholder, with the length from the recorder and the
      // waveform computed above — so the note looks exactly the same before and
      // after it lands, and settling is invisible rather than a visible repair.
      payload: {
        localUrl:    URL.createObjectURL(blob),
        duration_ms: Math.max(0, Math.round(durationMs ?? 0)),
        // Omitted entirely when they could not be computed — the renderer's
        // test is "can I draw this", and a key holding null answers that
        // identically while costing bytes on every read.
        ...(wave && { wave }),
      },
      attempt: () => sendVoiceNote({
        conversationId,
        fromProfileId: senderProfile,
        blob,
        durationMs,
        wave,      // already computed; never decode the same blob twice
        capture,   // `C21` — what the device actually negotiated, not what we asked for
      }),
    });

    // Still thrown, and for the original reason: the recorder awaits this to
    // choose between its `sent` and `idle` states, and a silent return would
    // show "Sent" for a message that never left. What has changed is that the
    // recording no longer dies with it — it is on screen, playable, retryable.
    if (!ok) throw sendError;
  }

  /**
   * A photo, from the camera or the library (M11).
   *
   * The same shape as `onRecordedVoice`, and for the same reason: prepare the
   * heavy artefact BEFORE the placeholder so the pending bubble is the real
   * picture at the real aspect ratio, then hand the identical prepared image to
   * every attempt so a retry never re-encodes.
   *
   * ⚠ PREPARATION CAN FAIL, AND THAT IS NOT A SEND FAILURE. An undecodable
   * file — a HEIC straight off an iPhone is the realistic case — must surface
   * as a notice and leave the thread untouched. Routing it through `trySend`
   * would put a red retryable bubble in the conversation for a file that will
   * fail identically every time it is retried.
   */
  /**
   * A photo, from the camera or either of the two image rows.
   *
   * ⚠ THE HD DECISION ARRIVES WITH THE FILE, not after it. It is made by which
   * menu row was tapped, so there is nothing to confirm and the photo sends
   * immediately — the same as it did before M13. A confirmation step existed
   * briefly and was removed: it charged every ordinary photo an extra tap to
   * serve the few that want an original kept.
   *
   * The window is `DEFAULT_WINDOW` (72h) because the row that chose HD is the
   * only place a duration could have been picked, and putting four durations in
   * the menu would make the common choice harder to hit than the rare one.
   */
  async function onPickImage(file, { preserveOriginal = false } = {}) {
    if (!senderProfile || sending) return;

    const { image, error: prepError, undecodable } = await prepareImage(file);

    // ⚠ A RAW OR TIFF IS THE POINT OF HD, NOT A FAILURE OF IT. No browser can
    // decode either, so there is no optimised copy and no thumbnail — but the
    // original is exactly what a photographer meant to send. It goes up on its
    // own and the bubble draws a card instead of a picture.
    //
    // Only when preservation was asked for. An ordinary image send has nothing
    // left to show and nothing to store, so it still reports the problem.
    if (undecodable && preserveOriginal) {
      await sendUndecodableOriginal(file);
      return;
    }
    if (prepError) { setError(prepError.message); return; }

    // A local url so the pending bubble is the actual photo rather than a grey
    // box, with the dimensions measured during preparation — so the picture
    // looks identical before and after it lands and settling is invisible.
    const localUrl = URL.createObjectURL(image.blob);

    await trySend({
      body: IMAGE_FALLBACK_BODY,
      kind: 'image',
      // The PREPARED image is kept, not the original File. A retry re-uploads
      // the same bytes rather than decoding, rotating and re-encoding the
      // photograph again for an identical result — and it carries the
      // preservation choice, so retrying an HD send is still an HD send.
      retry: { type: 'image', image, preserveOriginal },
      payload: { localUrl, width: image.width, height: image.height },
      attempt: () => sendImage({
        conversationId,
        fromProfileId: senderProfile,
        image,
        preserveOriginal,
        // No `window` argument: `sendImage` defaults to DEFAULT_WINDOW, and
        // passing undefined here rather than a literal keeps the default in one
        // place instead of two that can drift.
      }),
    });
  }

  /**
   * A RAW, a TIFF — an original with nothing viewable to go with it.
   *
   * The placeholder carries the filename and size rather than a picture,
   * because that is also what the settled message will show: there is no local
   * preview to make, so nothing changes shape when it lands.
   */
  async function sendUndecodableOriginal(file) {
    await trySend({
      body: file.name || IMAGE_FALLBACK_BODY,
      kind: 'image',
      retry: { type: 'image-original', file },
      // No `localUrl` and no dimensions: an undecodable file has neither, and
      // inventing a box for it would reserve space for a picture that never
      // arrives.
      payload: { name: file.name, pendingBytes: file.size },
      attempt: () => sendOriginalOnly({
        conversationId,
        fromProfileId: senderProfile,
        file,
      }),
    });
  }

  /**
   * A document (M12).
   *
   * Simpler than a photo, because there is nothing to prepare: the bytes the
   * user picked are the bytes that get stored. So there is no expensive step to
   * do before the placeholder, and the File itself is what a retry re-uploads.
   *
   * ⚠ THE SIZE IS CHECKED HERE AS WELL AS IN THE LIB AND THE BUCKET. Not
   * belt-and-braces: this is the only one of the three that can refuse a 40 MB
   * file WITHOUT first putting a red bubble in the thread. A file over the limit
   * fails identically on every retry, so it must never become a retryable
   * message.
   */
  async function onPickFile(file) {
    if (!senderProfile || sending || !file) return;

    // ⚠ THE CHIP FOLLOWS THE FILE, NOT THE ROW. Derived here for the optimistic
    // placeholder and derived again in `sendFile` for the real row, from the
    // same function — so the bubble cannot flash a chip the settled message
    // then takes away.
    const hd = isLosslessAudio(file.name, file.type);

    // ⚠ CHECKED BEFORE ANYTHING ELSE, INCLUDING BEFORE THE SHEET. A file over
    // the limit fails identically on every retry, so it must never reach
    // `trySend` and become a red retryable bubble — and there is no point
    // asking someone how to share a file that cannot be sent.
    if (file.size > MAX_BYTES) {
      setError(`That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_BYTES)}.`);
      return;
    }

    // Audio gets a confirm step; documents do not. The asymmetry is deliberate:
    // sending a master is a rare, considered act with a decision attached
    // (may they keep it?), while sending a PDF is frequent and has none. The
    // photo path proved that charging every send a tap to serve a minority is
    // the wrong trade.
    if (isPlayableAudio(file.name, file.type)) {
      setPendingAudio({ file, hd });
      return;
    }

    await dispatchFile(file, { downloadable: true, wave: null });
  }

  /**
   * The audio sheet confirmed — or a document, which never asked.
   *
   * ⚠ PEAKS ARE COMPUTED HERE, ONCE, ON THE SENDER'S DEVICE. The recipient must
   * never decode 30MB to draw a picture, so the waveform travels in the payload
   * exactly as a Voicey's does. Above `WAVE_CEILING_BYTES` it is skipped
   * entirely — `decodeAudioData` holds the whole file as 32-bit float PCM, and
   * a phone killed mid-send is a worse outcome than a card with no waveform.
   */
  async function dispatchFile(file, { downloadable, wave: precomputed }) {
    let wave = precomputed;

    if (wave === null && isPlayableAudio(file.name, file.type) && file.size <= WAVE_CEILING_BYTES) {
      // Degrades to no waveform rather than no message: `computeWave` already
      // returns null on a format this browser cannot decode.
      wave = await computeWave(file);
    }

    await trySend({
      body: bodyForFile(file.name),
      kind: 'file',
      retry: { type: 'file', file, downloadable, wave },
      payload: {
        name: safeName(file.name), bytes: file.size, mime: file.type || null,
        ...(isLosslessAudio(file.name, file.type) && { hd: true }),
        ...(downloadable === false && { downloadable: false }),
        ...(wave && { wave }),
      },
      attempt: () => sendFile({
        conversationId, fromProfileId: senderProfile, file, downloadable, wave,
      }),
    });
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
      {/* There is deliberately NO pull-down grab handle here, and NO dismiss
          gesture anywhere in the drawer.

          The gesture's history is a cautionary tale in two acts. It began as an
          invisible swipe on the whole dialog — an ancestor of the scrolling
          message list — so ordinary reading dismissed conversations on both iOS
          and Android. It was then rebuilt as a visible handle on this header,
          which fixed the conflict but earned its 34px only if people actually
          pulled it. They did not: the back button and, on desktop, the
          click-away scrim already close the drawer, so the handle was a second
          control for a solved problem. Owner removed it 2026-07-22.

          If a dismiss gesture is ever wanted again, the constraint that matters
          is the one that survives both acts: it must NOT listen anywhere above
          the message list's scroll container. */}
      <div className="yp-convo-header" style={{
        display: 'flex', alignItems: 'center', gap: 13, flexShrink: 0,
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

        {/* ── THE IDENTITY COLUMN ──────────────────────────────────
            Three stacked rows on desktop: name, then the type pill, then who
            you are speaking as.

            On a PHONE that stack made the header tall enough to eat the top of
            the conversation. The phone rules in `index.css` pull the pill up
            ONTO the name's line and let the "as" line wrap beneath, so the same
            information lands in two rows instead of three. Nothing is hidden —
            §2.1 makes the sending identity permanent for the life of the
            conversation, so it must never become ambiguous to save space.

            Desktop is untouched: the layout below IS the desktop layout. */}
        <span className="yp-convo-id" style={{ minWidth: 0, flex: 1 }}>
          {/* PRIMARY. Lifted to 19px/650 and tightened, so the name wins the
              composition outright instead of competing with the row below. */}
          <span className="yp-convo-name" style={{ display: 'block', color: '#fff', fontSize: 19, fontWeight: 650, letterSpacing: '-.2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.15 }}>
            {title}
          </span>

          {/* SECONDARY ROW — type pill and presence share one line. Presence
              is absent today and the row simply closes up; it does not reserve
              empty space for a feature that does not exist.

              `margin-top` lives in the stylesheet, not here: the phone rules
              zero it, and an inline value would beat them silently. */}
          <span className="yp-convo-pillrow" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
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
            <span className="yp-convo-as" style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
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
        {/* ⛔ THE CALL BUTTON IS GONE, NOT DISABLED (2026-07-22, owner).

            A disabled control is a PROMISE — it says "this is coming" and holds
            its place for it. Calling is not designed: it does not appear in
            `communication-v1.0.md` at all, there is no call model, no signalling,
            and no decision on which profile a call would be placed as. Showing
            it in the header advertised something nobody has specified.

            Restoring it costs nothing — this row is a flex line of ghost
            buttons, so putting one back is putting one back. */}

        <button type="button" disabled aria-label="More — not available yet" title="No conversation actions yet" style={{ ...ghostBtn, opacity: .32, cursor: 'not-allowed' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
          </svg>
        </button>
      </div>

      {/* The privacy strip lived here — a padlock and "Private — only you and
          the participants can see these messages." Removed by owner decision.

          It cost a permanent band plus its own borderBottom at the top of every
          conversation, to say something true of every conversation in the app.
          A reassurance that never varies is not information; it is furniture.

          NOTHING ABOUT PRIVACY CHANGED. C29 (no AI, ever) and C32 (content
          never feeds ranking or recommendation) are enforced in the database,
          not asserted by this banner. If the guarantee ever needs stating in
          the UI again, the honest home for it is the conversation's info
          panel — on request — rather than a line nobody reads twice. */}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="yp-noscrollbar"
        style={{
          flex: 1, overflowY: 'auto', minHeight: 0,
          // ── THE IMAGE RUNS ON UNDERNEATH THE COMPOSER ──────────────
          //
          // The wallpaper is painted on THIS element, so wherever this element
          // ends, the image ends. While it stopped exactly where the composer
          // began, that boundary was a straight line across the screen — and no
          // amount of fading over it fully hid the fact that the picture simply
          // stopped there.
          //
          // A negative bottom margin lets this box extend BEHIND the composer
          // instead. The image now carries on under the text field and only
          // ends at the drawer's own bottom edge, which is a real edge rather
          // than an invented one.
          //
          // The padding gives the extra distance back to the CONTENT, so the
          // last message still comes to rest above the composer rather than
          // underneath it. Margin moves the box; padding protects what is in
          // it — they are not cancelling each other out.
          marginBottom: -composerBleed(),
          padding: `22px 18px ${composerBleed() + 8}px`,
          // THE MESSAGE LIST OWNS VERTICAL SCROLLING, AND KEEPS IT.
          //
          // `contain` stops the scroll CHAINING outward when the thread reaches
          // either end: without it, continuing to drag at the top hands the
          // scroll to whatever is behind the drawer, which on mobile also arms
          // pull-to-refresh. Reaching the oldest message and being answered by
          // the page underneath moving is the same class of surprise as the
          // dismiss bug — a reading gesture escaping the thing being read.
          overscrollBehavior: 'contain',
          // THE WALLPAPER.
          //
          // On the SCROLL CONTAINER, with attachment left at its default
          // `scroll` — which on a scrollable element means the image is fixed
          // to the element and messages travel over it. `local` would scroll
          // the image away with the content; `fixed` would pin it to the
          // browser viewport, so inside the drawer it would align to the window
          // rather than to the thread.
          // TWO LAYERS: a flat scrim over the photograph. Order matters —
          // the first background paints on TOP.
          //
          // `100% auto` — the image's WIDTH is locked to the window and its
          // height follows proportionally.
          //
          // Not `contain`: that fits the whole image, which in the wide desktop
          // drawer shrank it to a 333px column inside a 558px box with black
          // bars either side — the opposite of sitting at full width. Not
          // `cover` either, which is free to scale UP past the window to fill
          // the height.
          //
          // The image is very tall (ratio 0.555), so at full width it overflows
          // vertically and the middle shows. On a phone that overflow is about
          // 10% of the height; in the drawer it is more. Full width is the
          // fixed constraint, and the vertical crop is what gives.
          //
          // The scrim is what stops the image competing with the conversation.
          // It is a flat fill rather than a gradient: the photograph is already
          // strongly graded left-to-right, and a gradient scrim on top of that
          // would fight its composition instead of quieting it.
          // WebP, not PNG: same artwork at the same 1162×2093, 1.85MB → 46KB.
          // A 39× saving on the one asset every conversation waits for.
          backgroundImage: `linear-gradient(${CHAT_BG_SCRIM}, ${CHAT_BG_SCRIM}), url('/chat-bg.webp')`,
          backgroundSize: 'auto, 100% auto',
          // Right-anchored so any horizontal overflow crops off the LEFT.
          // paintWallpaper overwrites the vertical part on every scroll; this
          // is only what shows for the frame before it first runs.
          backgroundPosition: 'center, right',
          backgroundRepeat: 'no-repeat, no-repeat',
          // Fills the letterbox, and shows through if the image is slow or
          // fails — a dark thread should never flash white.
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
                onRetry={() => onRetry(m)}
                seenWatermark={seenWatermark}
                deliveredWatermark={deliveredWatermark}
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
      {pendingAudio && (
        <AudioSendSheet
          file={pendingAudio.file}
          hd={pendingAudio.hd}
          onCancel={() => setPendingAudio(null)}
          onSend={({ downloadable }) => {
            const { file } = pendingAudio;
            setPendingAudio(null);
            void dispatchFile(file, { downloadable, wave: null });
          }}
        />
      )}

      <Composer
        draft={draft}
        onDraftChange={onDraftChange}
        onSubmit={onSend}
        onRecorded={onRecordedVoice}
        onPickImage={onPickImage}
        onPickFile={onPickFile}
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
function MessageBubble({ message, isMine, grouped = false, endsBurst = true, speaker, handed = false, onToggleHand, onRetry, seenWatermark = null, deliveredWatermark = null }) {

  // Null for anything received — receiptFor enforces that, and it is the rule
  // that keeps the §2.5 amendment narrow: a receipt on a message you received
  // would report your own reading, or a colleague's, back into the thread.
  const receipt = receiptFor({
    isMine,
    createdAt: message.created_at,
    pendingState: message.pendingState,
    deliveredWatermark,
    seenWatermark,
  });

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
  // A Hand IS a Yes, so it cannot be given one — see `UNHANDABLE_KINDS`. Asked
  // as a rule about the KIND rather than handled at the call site, so a future
  // kind inherits the gesture by default and only an acknowledgement has to opt
  // out of it.
  const handable = canReceiveHand(message.kind);
  // Geometry only — the fill and border stay the bubble's, so a Voicey still
  // reads as belonging to whoever sent it.
  const shape = shapeFor(message.kind);
  const radius = shape?.radius ?? 20;
  // A tail is what makes a rectangle read as speech. Kinds that are objects
  // rather than utterances opt out and get equal corners.
  const corner = shape?.tail === false ? radius : tail;
  // The only route by which a kind may set colour. Per direction, so a Voicey
  // still says whose it is.
  const material = materialFor(message.kind, isMine);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-end',
      gap: 8,
      justifyContent: isMine ? 'flex-end' : 'flex-start',
      // ⚠ THE ROW RESERVES THE BADGE'S DROP, ALWAYS.
      //
      // The Yes badge dips `--yp-yes-drop` below the message frame. That space
      // is reserved here as padding rather than being allowed to overhang, which
      // is what makes the badge structurally incapable of touching the message
      // below it — no z-index between rows, and no dependence on whether a
      // neighbour happens to be a Voicey with a backdrop-filter.
      //
      // Reserved on EVERY row, not only handed ones, and taken back out of the
      // margin so the thread's rhythm is unchanged. Reserving it conditionally
      // would reflow the thread under the reader's thumb at the moment they
      // react, which is the one instant it must not move.
      paddingBottom: YES_DROP,
      // 3px inside a burst, 14px between turns. The gap is what separates
      // "one person talking" from "two people exchanging".
      //
      // The reserved drop above is subtracted from it rather than added to it,
      // so those two numbers still describe the spacing you actually see.
      marginBottom: Math.max(0, (endsBurst ? 14 : 3) - YES_DROP),
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
      {/* ══ THE MESSAGE FRAME — the canonical anchor ══════════════════
          Every kind renders inside this, and the Yes badge is positioned
          against IT rather than against the bubble. The bubble is not one
          shape — KIND_SHAPE gives text, voice and bare Hands different padding,
          different minimums and, for bare, no box at all — so anchoring to the
          bubble meant inheriting each kind's geometry. The frame shrink-wraps
          whatever it holds and carries the max-width, so its box is the
          message's outer box by definition.

          A NEW KIND NEEDS NO POSITIONING CODE. It is rendered inside the frame
          like every other kind and the badge already knows where to go. */}
      <div className="yp-msg-frame">
      <div
        className={shape?.className}
        // DOUBLE-TAP TO YES. React's onDoubleClick covers mouse and touch, and
        // needs no disambiguation delay because single tap does nothing now —
        // the timestamp gave up that gesture in M9h.3 precisely so this one
        // could be instant.
        onDoubleClick={handable ? onToggleHand : undefined}
        // Suppresses the text selection a double-tap otherwise makes, which
        // would flash a highlight across the message every time. Still wanted on
        // an unhandable kind: the double-tap does nothing, but it would still
        // select.
        onMouseDown={e => { if (e.detail > 1) e.preventDefault(); }}
        style={bare ? {
          minWidth: 0, position: 'relative',
          // The mark supplies its own presence; padding here would only push
          // the timestamp away from it.
          padding: 0,
          background: 'none',
          border: 'none',
        } : {
        minWidth: 0, position: 'relative',
        borderRadius: isMine
          ? `${radius}px ${radius}px ${corner}px ${radius}px`
          : `${radius}px ${radius}px ${radius}px ${corner}px`,
        padding: shape?.padding ?? '12px 16px',
        // Only set when a kind asks for one, so a text bubble still sizes to
        // exactly the text in it.
        ...(shape?.minHeight && {
          minHeight: shape.minHeight,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }),
        border: isMine ? SENT_BORDER : '1px solid rgba(255,255,255,.12)',
        background: isMine ? SENT_BUBBLE : RECEIVED_BUBBLE,
        // No glow, still. A halo on every sent message is decoration repeated
        // dozens of times down a thread. What sent messages get instead is a
        // single lit edge — depth, not radiance.
        boxShadow: isMine ? SENT_LIGHTING : 'none',
        // A kind may supply its own finish. Spread LAST so it wins — placed
        // above, the defaults below would have silently overwritten it, which
        // is the classic way a style object stops doing what it reads as doing.
        // This is the only route by which a kind may touch colour, and it comes
        // from KIND_MATERIAL alone.
        ...(material ?? {}),
      }}>
        {/* The bubble owns the CONTAINER — alignment, tail, spacing — and knows
            nothing about kinds. Content comes from the registry, so a new kind
            is a renderer there and no change here. */}
        {renderMessage(message, { receipt })}

        {/* ALWAYS VISIBLE, never on tap.

            This used to be tap-to-reveal, which spent the single tap — the most
            valuable gesture a message has — on the least valuable information.
            The ratified decision is that double-tap-to-Yes takes precedence and
            the timestamp is secondary, so the timestamp gives up its gesture
            entirely rather than competing for it with a disambiguation delay
            that would make every tap feel slow.

            Permanently visible is also simply better: WhatsApp does it, and
            "when was this said" stops being a question you have to ask.

            A kind may claim the clock for itself — see KIND_SHAPE.ownsTimestamp.
            The Voicey does, so its length and its clock share one line instead
            of stacking two timings on top of each other. */}
        {message.created_at && !shape?.ownsTimestamp && (() => {
          // ⚠ AN HD IMAGE PUTS ITS FILE TYPE AND SIZE ON THIS SAME LINE, TO THE
          // LEFT OF THE CLOCK — computed HERE rather than inside ImageMessage,
          // because this row already renders uniformly below every non-owning
          // kind (image included) and reaches every branch ImageMessage can
          // take for free: an ordinary photo (no `original`, nothing shown), a
          // decodable HD photo, AND a RAW/TIFF sent with no viewable preview at
          // all — that last one carries `payload.original` too, so it gets the
          // caption without ImageMessage needing a third render path to draw it.
          //
          // The alternative — drawing this inside ImageMessage by giving the
          // 'image' kind `ownsTimestamp: true` — would mean EVERY one of its
          // render branches (the plain photo, the RAW card, the pending
          // placeholder, the "unavailable" fallback) has to grow its own clock
          // row or silently lose its timestamp. That is a real trap this
          // codebase has hit once already for Voiceys — see the comment on
          // `EqReceipt` above — and reaching for the row that already exists
          // avoids reintroducing it for a fourth kind.
          const original = message.kind === 'image' ? message.payload?.original : null;
          const caption = original
            ? [describeOriginal(original, message.payload?.name), formatImageBytes(original.bytes)]
                .filter(Boolean).join(' · ')
            : null;

          return (
            <div className="yp-msg-meta" style={{
              marginTop: 5,
              display: 'flex', alignItems: 'baseline',
              // space-between only when there is something to put on the left —
              // an ordinary message keeps the exact layout it has today.
              justifyContent: caption ? 'space-between' : 'flex-end',
              gap: 10,
            }}>
              {caption && (
                // SAME FONT AND COLOUR AS THE AUDIO FILE CARD'S METADATA LINE —
                // "WAV · 31.2 MB" — so the two read as one convention for
                // describing an attachment's real file, not two different ones.
                <span style={{
                  minWidth: 0, flex: 1, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontSize: 11.5, color: 'var(--muted)',
                }}>
                  {caption}
                </span>
              )}
              <span style={{
                flexShrink: 0,
                fontSize: 10,
                lineHeight: 1,
                color: isMine ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.42)',
                // Tabular so the right edge of the clock lines up down the whole
                // thread — proportional digits make each message's timestamp
                // end a pixel or two apart, which reads as sloppy without being
                // nameable.
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '.02em',
                // Cannot be selected or dragged — it sits inside the double-tap
                // target and a text selection would swallow the second tap.
                userSelect: 'none',
                // The receipt sits with the clock rather than on its own line —
                // both answer "what happened to this message", and stacking
                // them would give a one-word status its own row in every
                // bubble.
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                {timeOf(message.created_at)}
                <EqReceipt state={receipt} />
              </span>
            </div>
          );
        })()}

        {/* THE ONLY RUNG THAT ASKS FOR SOMETHING.
            Sent, delivered and read are a record; failed is a request. So it is
            the one receipt state that gets words and a tap target — the glyph
            alone says "something is wrong" without saying what to do, and at
            8px it is far too small to be the control.

            Inside the bubble, not a toast: the whole point is that the failure
            stays attached to the message it belongs to. A thread with two failed
            sends needs two retries, and a banner above the composer can only
            ever describe one of them. */}
        {receipt === RECEIPT.FAILED && (
          <button
            type="button"
            onClick={onRetry}
            className="yp-msg-retry"
            title={message.failReason ?? undefined}
          >
            Not sent — tap to retry
          </button>
        )}

      </div>{/* bubble */}

      {/* THE YES, WHERE INSTAGRAM PUTS THE HEART.

          A BADGE PINNED TO THE FRAME, not a mark floating near the message.
          It is a sibling of the bubble inside the frame and is anchored to the
          FRAME, so its placement is identical for text, voice, a bare Hand and
          every kind not yet written — none of which contain a single line of
          positioning code for it.

          Every offset lives in index.css as one set of custom properties. The
          overlap is 5px on both axes, which is narrower than any kind's
          padding, so the badge cannot reach text, the clock, the EQ receipt or
          a Voicey's play button whatever that kind chooses for its box.

          Out of flow, and the space it needs is reserved unconditionally by the
          row and the frame — so a message does not change size when it gains
          one, and the thread does not jump under the reader's thumb at the
          moment they react. */}
      {/* `handable` as well as `handed`: rows handed before the gesture was
          withdrawn still carry the state, and drawing it would put the badge
          back on the one kind whose layout cannot hold it. */}
      {handed && handable && (
        <span role="img" aria-label="You said Yes to this" className="yp-yes-badge">
          <HandIcon size={YES_SIZE} />
        </span>
      )}
      </div>{/* frame */}
    </div>
  );
}
