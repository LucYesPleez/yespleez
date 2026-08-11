import { useNavigate } from 'react-router-dom';
import { useSession } from '../App';
import { readEventCard } from '../lib/eventCard';
import { useEventLike } from '../screens/event/useEventLike';

/**
 * AN EVENT CARD IN A CONVERSATION.
 *
 * ⭐ IT IS A LINK, NOT A COPY OF THE EVENT. The card shows enough to recognise
 * and decide — name, when, where, the cover — and tapping it opens the real
 * event page. Reproducing the event in the bubble would mean two renderings of
 * one thing that drift apart, and the second one is always the stale one.
 *
 * ── ⭐ THE HEART IS HERE BECAUSE THIS IS WHERE THE DECISION HAPPENS ───
 *
 * Someone sends you a gig; the answer is "yes, I'm interested". Making that
 * cost a trip to the event page and back is three taps for a one-tap thought,
 * and the thread is where the conversation about it is happening.
 *
 * It writes the SAME follow the event page's heart writes — same hook, same
 * row, same attribution — so a gig saved from a chat is indistinguishable from
 * one saved on the page, and My Scene sees one thing rather than two.
 *
 * ── ⚠ THE RENDERING CONTRACT, WHICH THIS KIND MAKES EASY TO BREAK ────
 *
 * Absent ≠ withheld ≠ unknown, and no placeholders. A shared event with no
 * cover renders WITHOUT a cover — not with a grey box, not with a broken
 * image frame. Same for the venue line and the date. The card is built from
 * whatever is actually there, so it is short when the event is thin rather
 * than being padded out to a fixed shape with holes in it.
 */
export default function EventMessage({ message }) {
  const navigate = useNavigate();
  const { session } = useSession();
  const card = readEventCard(message);
  const userId = session?.user?.id ?? null;

  /**
   * ⚠ HOOKS RUN BEFORE THE EARLY RETURN, so this is called unconditionally
   * with whatever the card yielded. React forbids a conditional hook, and a
   * malformed payload is a live possibility here — see readEventCard.
   */
  const like = useEventLike({
    id: card?.eventId ?? null,
    // The hook needs a name for `entity_name` and an object to prove the event
    // is loaded. The snapshot supplies both without a fetch: the card already
    // knows what it is pointing at.
    event: card ? { id: card.eventId, name: card.name || 'Event' } : null,
    userId,
    isRealEvent: Boolean(card?.eventId),
  });

  /**
   * ⚠ A CARD WHOSE PAYLOAD IS UNREADABLE FALLS BACK TO ITS OWN BODY.
   *
   * `body` is required to be legible for exactly this case (M9a) — it holds
   * "Name — 15 Aug 2026". So a card written by a future version of the app, or
   * damaged, still says what was shared instead of rendering an empty bubble
   * or throwing and taking the conversation with it.
   */
  if (!card) {
    return <span style={{ fontSize: 15, lineHeight: 1.4 }}>{message?.body}</span>;
  }

  /** Room the bottom lines leave for the floating heart — 0 when there is none. */
  const heartInset = userId ? 34 : 0;

  return (
    /* ⚠ A DIV, NOT A BUTTON. The heart is a control INSIDE the card, and a
       button nested in a button is invalid HTML — browsers recover from it
       unpredictably, and the inner control is the one that loses. Two siblings
       in a plain container instead: the body opens the event, the heart saves
       it, and neither swallows the other. */
    <span style={{
      display: 'flex', alignItems: 'stretch',
      width: '100%', minWidth: 0, overflow: 'hidden',
      borderRadius: 14,
      border: '1px solid rgba(255,255,255,.14)',
      background: 'rgba(255,255,255,.05)',
      // Anchors the heart, which is now positioned rather than in the flow —
      // see the note on it below.
      position: 'relative',
    }}>
      <button
        type="button"
        onClick={() => navigate(`/event/${card.eventId}`)}
        style={{
          display: 'flex', alignItems: 'stretch', gap: 0, flex: 1, minWidth: 0,
          padding: 0, border: 'none', background: 'none', color: 'inherit',
          textAlign: 'left', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
        }}
      >
        {/* Absent when there is no cover — see the rendering contract above.
            A fixed-width strip that is sometimes empty is a visual hole, which
            is the thing that rule exists to forbid. */}
        {card.cover && (
          <img
            src={card.cover}
            alt=""
            style={{ width: 78, alignSelf: 'stretch', objectFit: 'cover', flexShrink: 0, display: 'block' }}
          />
        )}

        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '10px 12px', minWidth: 0 }}>
          <span style={{
            fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase',
            color: 'rgba(0,229,255,.85)', fontWeight: 700,
          }}>
            Event
          </span>

          <span style={{
            fontSize: 15, fontWeight: 650, lineHeight: 1.25,
            // Two lines then ellipsis: a long event name must not push the date
            // and venue out of a bubble that is already width-constrained.
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {card.name || 'Event'}
          </span>

          {/* ⚠ ONLY THESE TWO CLEAR THE HEART, AND ONLY WHEN IT IS THERE.
              The heart floats over the card's bottom-right corner, so the
              lines that reach that corner reserve room for it — and the TITLE
              deliberately does not, which is the whole point of moving the
              heart down here. `heartInset` is 0 for a signed-out reader,
              because then there is no heart to avoid. */}
          {card.when && (
            <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,.72)', paddingRight: heartInset }}>
              {card.when}
            </span>
          )}
          {card.venue && (
            <span style={{
              fontSize: 12.5, color: 'rgba(255,255,255,.52)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              paddingRight: heartInset,
            }}>
              {card.venue}
            </span>
          )}
        </span>
      </button>

      {/* ⛔ ABSENT, NOT DISABLED, when nobody is signed in. A guest reading a
          shared link has nothing to save it to, so the heart is not rendered
          rather than rendered-and-inert — R3, the same rule the event page's
          own heart follows.

          ⭐ BOTTOM RIGHT, AND OUT OF THE FLOW. It sat top-right as a flex
          sibling, which took its width off the text column for the WHOLE
          height of the card — so the title wrapped early to leave room for a
          control that only occupies one corner. Absolutely positioned, it
          costs the title nothing and the name runs the full width across the
          top.

          ⚠ The bottom is the right corner for it precisely BECAUSE the text
          is ragged there: the venue line is the shortest, so the heart lands
          in space the card already had rather than crowding anything. */}
      {userId && (
        <button
          type="button"
          onClick={() => void like.toggleLike()}
          disabled={like.likedBusy}
          aria-pressed={like.liked}
          aria-label={like.liked ? 'Remove from My Scene' : 'Add to My Scene'}
          title={like.liked ? 'Remove from My Scene' : 'Add to My Scene'}
          className="yp-tap44"
          style={{
            position: 'absolute', right: 6, bottom: 6,
            width: 34, height: 34,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: 'none', background: 'none', padding: 0,
            cursor: like.likedBusy ? 'default' : 'pointer',
            color: like.liked ? '#FF2D78' : 'rgba(255,255,255,.55)',
            WebkitTapHighlightColor: 'transparent',
            transition: 'color .18s cubic-bezier(.2,.8,.3,1), transform .18s cubic-bezier(.2,.8,.3,1)',
            transform: like.liked ? 'scale(1.06)' : 'scale(1)',
          }}
        >
          {/* Filled once saved, outline until then — the state is the shape,
              not only the colour, so it survives being seen in monochrome. */}
          <svg width="19" height="19" viewBox="0 0 24 24"
               fill={like.liked ? 'currentColor' : 'none'}
               stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21.2l7.7-7.7 1.1-1.1a5.5 5.5 0 0 0 0-7.8z" />
          </svg>
        </button>
      )}
    </span>
  );
}
