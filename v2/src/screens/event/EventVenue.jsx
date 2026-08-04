// § 7 · Venue
//
// Spec: docs/event-page-layout-spec.md § 7
//
// Map size follows map PRECISION. A region-level pin in a large frame reads as
// an error rather than an intention, so the map only appears when there is
// something real to draw — and when a location is withheld, the notice leads
// and the map yields entirely, even if coordinates exist in the record.

import { useState, useEffect, useCallback } from 'react';
import { resolveVenue, addressLines } from './venueDisplay';
import { RouteIcon, ChevronIcon, ShareIcon } from './eventIcons';
import s from './EventSections.module.css';

export default function EventVenue({
  name, address, locality, state, postcode = null, mapUrl, navUrl = null, withheld = false, card = null,
  // ⛔ No `profile` / `onOpenVenue` here any more — the venue's card moved to
  // EventVenueCard and took the profile row and the click target with it.
  // Callers still spread both in harmlessly; this section simply ignores them.
}) {
  // ⚠ HOOKS BEFORE ANY EARLY RETURN. This section returns early for an absent
  // venue and again for a withheld one, so a hook declared further down runs on
  // some renders and not others — the Rules of Hooks violation React throws on.
  const [mapReady, setMapReadyState] = useState(false);
  const setMapReady = useCallback(ok => setMapReadyState(ok), []);

  // Share the address as plain text. The Web Share sheet where it exists, the
  // clipboard where it does not — the same pair the event's own SHARE uses, so
  // a phone offers its apps and a desktop quietly copies.
  const shareAddress = useCallback(() => {
    const text = [name, address, [locality, state, postcode].filter(Boolean).join(' ')]
      .filter(Boolean).join(', ');
    if (!text) return;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else navigator.clipboard?.writeText(text).catch(() => {});
  }, [name, address, locality, state, postcode]);

  const v = resolveVenue({ name, address, locality, state, mapUrl, withheld });
  if (!v) return null;   // R1 · absent

  if (v.mode === 'withheld') {
    return (
      <section className={s.card}>
        <div className={s.headRow}>
          <h2 className={s.heading}>VENUE</h2>
          <span className={s.stateChip}>SECRET LOCATION</span>
        </div>
        {v.area && <div className={s.sub}><span className={s.strong}>{v.area}</span></div>}
        <div className={s.withheldBox}>
          <div className={s.withheldTitle}>LOCATION REVEALED CLOSER TO THE DATE</div>
        </div>
      </section>
    );
  }



  // The two lines an address is written on. Same shape at every width; only
  // WHERE it sits changes between phone and desktop.
  const lines = addressLines({ address, locality, state, postcode });

  // ⚠ The address is TWO LINES, not one comma-joined string (owner,
  // 2026-08-01): street, then locality and state beneath it — the way an
  // address is written on an envelope. Each line renders only if the record
  // holds it, so a venue with no locality shows its street alone rather than
  // an empty second line.

  return (
    <section className={s.card}>
      {/* ⛔ NO "VENUE" HEADING (owner, 2026-08-03). It labelled a section that,
          once the venue card moved in beside the map, already names itself —
          the card carries the venue's name, photo and locality directly, so a
          bare category word above it was announcing what the next line down
          says anyway. The withheld branch above still keeps its own heading:
          there the card is absent, so nothing else identifies the section. */}

      {/* ⚠ THE VENUE CARD IS BACK INSIDE THIS SECTION (owner, 2026-08-02),
          reversing the 2026-08-01 note that used to sit here. That note warned
          it would rebuild a duplicate click target — and it would have, while
          § 10 still fell back to presenting the VENUE when an event had no
          owner. That fallback is gone (see EventPresentedBy), so there is now
          exactly one venue card on the page and this is where it belongs:
          beside the address and the map it describes, not floating above them.

          Two columns on desktop, stacked on a phone — see .venueBody. */}
      <div className={s.venueBody}>
        {/* The address LEADS, full width — it is the answer to "where", and the
            tiles below are the picture of it.
            ONE block, not two siblings: as separate children of the card they
            were separated by its 12px flex row gap ON TOP of a 1.5 line-height,
            which read as two unrelated lines rather than one address. */}
        {/* Two tiles of equal weight: the area, and the place. */}
        <div className={s.venueTiles}>
          {/* ⚠ NO IMAGE, NO TILE — not an empty tile.
              The map tile takes two thirds of this row, so when a postcode has
              no image in the bucket the row rendered as a large blank area with
              the venue card marooned at one end (owner: "hanging out of its
              window"). Reserving space for a picture that may never exist is
              the hole R5 forbids.

              `mapReady` is lifted out of VenueMapPreview for exactly this: the
              tile cannot decide whether to exist from inside itself. */}
          <div className={s.venueTile} style={mapReady ? undefined : { display: 'none' }}>
            <VenueMapPreview
              src={mapUrl}
              href={navUrl}
              label={v.name || v.area}
              onReady={setMapReady}
            />
          </div>

          {/* R1 · no card, no tile — the map simply takes the row. */}
          {card && (
            <div className={s.venueAside}>
              {card}
              {/* DESKTOP: stacked under the card, so the column reads
                  place-then-address and the map beside it stretches to match
                  its full height. */}
              <Address lines={lines} onShare={shareAddress} className={`${s.venueAddressTile} ${s.wideOnly}`} />
            </div>
          )}
        </div>

        {/* PHONE: beneath the row, NOT inside the map tile — that tile
            disappears when a postcode has no image, and the address must not
            disappear with it. Same content as the desktop copy above; one of
            the two is always `display:none`, which also keeps it out of the
            accessibility tree so nothing is announced twice. */}
        <Address lines={lines} onShare={shareAddress} className={`${s.venueAddressTile} ${s.narrowOnly}`} />

        {/* ⚠ MOVED INSIDE .venueBody (owner, 2026-08-03: "it needs to come
            down to the directions button"). The map is now a background layer
            sized to .venueBody's own height — see .venueTile's `position:
            absolute; inset` in the stylesheet. That only reaches down to
            wherever .venueBody actually ends, so GET DIRECTIONS has to be part
            of that box's normal flow, not a sibling after it, or the map would
            stop short of the one thing it's meant to reach.

            ⚠ THE SAME DESTINATION AS THE MAP IMAGE (owner, 2026-08-02).
            This used to be a hardcoded google.com/maps link while the picture
            above handed off to the device — so the two controls in one section
            went to different places, and on a phone with Waze or OsmAnd set as
            default, only one of them respected it.
            Now both use `navigationUrl`: Android shows the OS chooser, iOS opens
            Apple Maps, desktop opens the web map.

            No destination, no button — a directions link that opens a map of
            the wrong town is worse than no link at all. */}
        {navUrl && (
          <a className={s.linkRow} href={navUrl} rel="noopener noreferrer">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <RouteIcon size={15} /> GET DIRECTIONS
            </span>
            <ChevronIcon />
          </a>
        )}
      </div>

      {/* ⛔ No "VIEW VENUE" row. The card above IS the way in — a second
          control doing the same thing is the duplicate-click-target problem
          that got the arrow deleted from FeaturedEventCard. */}
    </section>
  );
}

/**
 * The map image, and the way out of the app.
 *
 * ── A SUPPLIED PICTURE, NOT A GENERATED ONE ──────────────────────────
 * One static image per POSTCODE, read from our own bucket — see lib/venueMap.js.
 * No provider, no key, no render-time request. A postcode with no image in the
 * bucket renders NOTHING, so the section reads address-then-directions with no
 * gap where a map might be (R1, not R5).
 *
 * ── THE PICTURE IS NOT THE NAVIGATION ────────────────────────────────
 * It is a reference image at town scale. Tapping it hands off to the reader's
 * own mapping app via `navigationUrl` — Android shows the OS chooser, iOS opens
 * Apple Maps, desktop opens the web map. Same destination as GET DIRECTIONS
 * below it: two controls, one behaviour, so tapping the picture is never a
 * different journey from tapping the row.
 */
function VenueMapPreview({ src, href, label, onReady }) {
  const [loaded, setLoaded] = useState(false);

  // Tell the section whether there is a map, so it can drop the tile entirely
  // rather than leaving a gap the width of a picture that never arrives.
  useEffect(() => { onReady?.(false); }, [src, onReady]);
  if (!src) return null;

  const settle = ok => { setLoaded(ok); onReady?.(ok); };

  const map = (
    <img
      className={s.map}
      src={src}
      alt={loaded ? `Map of the area around ${label}` : ''}
      /* ⛔ NEVER loading="lazy" HERE — it deadlocks against the reveal below.
         A lazy image inside a `display:none` tile is never in the viewport, so
         the browser never fetches it, so `onLoad` never fires, so the tile is
         never revealed: the map silently never appears. Loading is what tells
         us the file exists, so it has to be eager. It is one ~30KB image. */
      style={loaded ? undefined : { display: 'none' }}
      onLoad={() => settle(true)}
      onError={() => settle(false)}
    />
  );

  // ⛔ No rules above and below any more. They existed to separate a full-width
  // map from the address and the directions row; inside a tile that sits beside
  // the venue card they drew lines across half the section for no reason.
  if (!href) return map;

  return (
    <a
      href={href}
      className={s.mapLink}
      aria-label={`Open ${label} in your maps app`}
      /* Not target=_blank: a geo: intent has no tab to open into, and on
         Android a new tab would flash before the chooser appears. */
      rel="noopener noreferrer"
    >{map}</a>
  );
}

/**
 * The address, on the two lines an address is written on:
 *
 *     12 Street Ave,
 *     Town, STATE, postcode
 *
 * The trailing comma belongs to the street line, not to a join — it is how the
 * line ends when the next one follows, and it disappears with the street when
 * a venue has none (a showground or a doof site with only a locality).
 */
function Address({ lines, className, onShare }) {
  if (!lines?.street && !lines?.region) return null;   // R1 · absent
  return (
    <div className={`${s.sub} ${className || ''}`}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {lines.street && <div>{lines.street}{lines.region ? ',' : ''}</div>}
          {lines.region && <div>{lines.region}</div>}
        </div>
        {/* Share the ADDRESS, not the event — this is the panel someone taps
            when they are sending a friend the location. Absent rather than
            disabled when there is no handler, so the row never shows a control
            that does nothing. */}
        {onShare && (
          <button type="button" onClick={onShare} aria-label="Share this address"
            style={{ flexShrink: 0, background: 'none', border: 'none', padding: 2, margin: -2,
              cursor: 'pointer', color: 'var(--muted)', display: 'inline-flex', lineHeight: 0 }}>
            <ShareIcon size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
