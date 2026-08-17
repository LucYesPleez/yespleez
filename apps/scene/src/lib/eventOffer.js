import { formatDisplayDate } from './dates';

/**
 * OFFERING SOMEBODY A PLACE AT AN EVENT — as a message the host sends.
 *
 * ⭐⭐ LIFTED FROM V1 (`legacy-v1/events.js`, `sendSlotOffer`), which had this
 * right: it composed the message, revealed it in a textarea, and let the HOST
 * send it. ⛔ It never sent anything itself.
 *
 * ⚠⚠ THAT IS THE PLATFORM LAW, ⛔ not a limitation. Phone Discovery §6, restated
 * in `InviteRows`: **YesPleez does not send messages on a user's behalf, ever.**
 * Whatever goes out is sent BY the host, FROM their own app, with them looking
 * at it. ⛔ Do not "finish this off" by wiring a mailer or an SMS gateway.
 *
 * ── ⛔ WHAT V1 DID THAT THIS DELIBERATELY DROPS ─────────────────────────────
 *
 * ⛔⛔ NO CLAIM CODES (owner, 2026-08-17). V1 minted a code into
 * `approval_codes` locked to one slot, so the recipient had a secret to type
 * and the offer was a slot-level contract. That is a whole second identity
 * system — a code table, a redemption path, and an answer to what happens when
 * two people enter the same code — and `InviteRows` already refused it once for
 * profile invites on exactly those grounds.
 *
 * ⛔⛔ NO SLOT. The offer is for the EVENT IN GENERAL. A link that promises the
 * 9pm slot has to stay true while the host is still moving the running order
 * around, and it cannot. The running order is settled IN the app, by the host,
 * after the artist is on board.
 *
 * ⭐ So the link is just the event's public page. It identifies the event,
 * survives every reshuffle, and needs no new table to mean something.
 */

/**
 * ⚠ WHAT THE HOST PASTES. Plain text: it has to survive a text message,
 * Instagram DM and a Facebook message with no markup of any kind.
 *
 * ⛔ NO EM DASHES — house rule for user-facing copy, and they render as
 * mojibake in half the places this will be pasted anyway.
 *
 * @param toName  who it is for. ⚠ Optional: a host copying a link to post
 *                publicly has nobody to greet, and "Hey there!" is worse than
 *                no greeting at all.
 */
export function offerMessage({ toName, eventName, date, venue, url }) {
  const who   = String(toName || '').trim();
  const event = String(eventName || '').trim() || 'an event';
  const where = String(venue || '').trim();

  /**
   * ⚠⚠ THE SPACE AFTER THE GREETING IS PART OF IT. This was assembled by
   * `join('')` over an array, which ran "Hey Gravid!" straight into "You are
   * invited" and shipped `Hey Gravid!You are invited`. ⛔ The greeting owns its
   * own trailing space, and it is EMPTY when there is no name, so nothing has
   * to strip a leading gap afterwards.
   */
  const greeting = who ? `Hey ${who}! ` : '';

  /**
   * ⭐ A HUMAN DATE, ⛔ not the stored one. `events.config.date` is
   * `2026-10-03`, and a message a host sends to an artist should not read like
   * a database row. `formatDisplayDate` gives "3 Oct 2026".
   *
   * ⚠ It builds a LOCAL date from the split parts, so it carries none of the
   * UTC-shift bug that any `Date` parse of a bare `YYYY-MM-DD` would.
   */
  const raw = String(date || '').trim();
  /* ⛔ A NON-ISO VALUE MUST NOT BECOME "Invalid Date". `formatDisplayDate`
     splits on `-` and feeds the parts to `new Date`, so anything that is not
     `YYYY-MM-DD` yields NaN and prints as `Invalid Date` in a message a host is
     about to send someone. ⚠ Falling back to the raw string is worse-looking
     and still TRUE, which is the right way round. */
  const pretty = formatDisplayDate(raw);
  const when = pretty && !/invalid/i.test(pretty) ? pretty : raw;

  const line = `${greeting}You are invited to play at ${event}`
    + (when  ? ` on ${when}`  : '')
    + (where ? ` at ${where}` : '')
    + '.';

  /* ⚠ The link on its OWN LINE. Every messaging app linkifies a bare URL at a
     line break; one buried mid-sentence gets punctuation swept into it. */
  return `${line}\n\n${url || ''}`.trim();
}

/**
 * The share payload. ⚠ `preview` is the whole message because a native share
 * sheet sends `text` and `url` separately — the recipient sees both, and the
 * text has to read as a complete message on its own.
 */
export function offerTarget({ toName, eventName, date, venue, url }) {
  return {
    type: 'event_offer',
    title: eventName ? `${eventName} on YesPleez` : 'An event on YesPleez',
    preview: offerMessage({ toName, eventName, date, venue, url }),
    url,
  };
}
