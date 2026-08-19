// EP-01 · THE PUBLIC EVENT PAGE, on real data.
//
// This is the layout that lived at /#/dev/event-layout against fixtures, now
// fed by an actual event row. The harness stays exactly as it was — it is the
// only way to put a section into a state no live event currently produces
// (30 artists, a withheld venue, six detail rows), and losing it would mean
// losing the ability to judge the page for events we do not have yet.
//
// The split is deliberate and worth keeping:
//   eventViewModel.js  row → props            pure, tested
//   this file          props → sections       arrangement and interaction
//   EventPageLayout    sections → the page    structure only
//
// ⚠ NOTHING HERE READS `event.config`. If a field is needed, it is added to
// the view model with every legacy spelling it has, once, where it can be
// tested — not reached for a second time here with a different fallback.
import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import EventPageLayout from './EventPageLayout';
import EventHero from './EventHero';
import EventIdentity from './EventIdentity';
import EventSummaryCard from './EventSummaryCard';
import EventLineup from './EventLineup';
import EventLineupCompact, { isCompactLineup } from './EventLineupCompact';
import compactStyles from './EventLineupCompact.module.css';
import EventVenue from './EventVenue';
import EventVenueCard from './EventVenueCard';
import EventDetails from './EventDetails';
import EventPoster from './EventPoster';
import EventPresentedBy from './EventPresentedBy';
import EventSources from './EventSources';

import { buildEventView, buildCollectables } from './eventViewModel';
import { fetchDistributableLogos } from '../../lib/profileAssetStore';
import { navigationUrl } from '../../lib/navigateTo';
import { venueMapImageUrl } from '../../lib/venueMap';
import { profileUrl } from '../../lib/profileResolution';
import { shareUrl } from '../../lib/shareTarget';
import SendToConversationSheet from '../../components/SendToConversationSheet';
import { eventCardBody, eventCardPayload } from '../../lib/eventCard';

export default function EventPage({
  event,
  ownerProfile = null,
  coHostProfiles = [],
  venueProfile = null,
  lineupMembers = [],
  memberProfiles = {},
  favourited = false,
  onToggleFavourite = null,
  canFavourite = true,
  // O2 · sending needs conversations, saving only needs desire — the two
  // stopped sharing a switch when the guest heart became a gate trigger.
  // Defaults to canFavourite so existing callers (EventHostView's false)
  // keep their exact behaviour.
  canSend = undefined,
  // Two live features the old page carried and this one must not lose.
  // Both are given as nodes rather than data: they need session, host
  // handlers and write paths that this page has no business knowing about.
  // 3 events have applications open; 2 publish set times.
  applyAction = null,
  setTimes = null,
}) {
  const navigate = useNavigate();
  const [collected, setCollected] = useState(false);
  // The "send to a conversation" sheet. Mounted only while open, so its
  // conversation fetch runs when someone asks for it rather than on every
  // event page view.
  const [sendOpen, setSendOpen] = useState(false);

  // § 11 — logos for everyone involved. Loaded after the page renders: the
  // collectables shelf is the LAST section and must never delay the Hero or
  // the decision block above it.
  const [logosByProfile, setLogosByProfile] = useState({});
  const involvedIds = useMemo(() => [
    venueProfile?.id,
    ownerProfile?.id,
    ...Object.values(memberProfiles || {}).map(p => p?.id),
  ].filter(Boolean).join(','), [venueProfile, ownerProfile, memberProfiles]);

  useEffect(() => {
    if (!involvedIds) { setLogosByProfile({}); return; }
    let cancelled = false;
    fetchDistributableLogos(involvedIds.split(','))
      .then(m => { if (!cancelled) setLogosByProfile(m); });
    return () => { cancelled = true; };
  }, [involvedIds]);

  // Rebuilt only when the data behind it changes. `now` is captured per build
  // rather than per render so the status pill and "last checked" cannot
  // disagree with each other mid-page.
  const v = useMemo(
    () => buildEventView({ event, ownerProfile, coHostProfiles, venueProfile, lineupMembers, memberProfiles }),
    [event, ownerProfile, coHostProfiles, venueProfile, lineupMembers, memberProfiles],
  );

  const collectables = useMemo(
    () => buildCollectables({
      ownerProfile, venueProfile,
      lineup: Object.values(memberProfiles || {}).filter(Boolean),
      logosByProfile,
    }),
    [ownerProfile, venueProfile, memberProfiles, logosByProfile],
  );

  const openProfile = profile => {
    const url = profileUrl(profile);
    if (url) navigate(url);
  };

  async function share() {
    const url = shareUrl(`/event/${event.id}`);
    // The Web Share sheet where it exists, the clipboard where it does not.
    // Both are best-effort: a cancelled share sheet rejects, and that is a
    // user decision, not an error to report.
    try {
      if (navigator.share) await navigator.share({ title: v.name, url });
      else if (navigator.clipboard) await navigator.clipboard.writeText(url);
    } catch { /* dismissed */ }
  }

  return (
    <>
    <EventPageLayout
      hero={<EventHero {...v.hero} alt={v.name} />}

      identity={
        <>
          <EventIdentity
            {...v.identity}
            favourited={favourited}
            // R3 · no dead controls — which O2 satisfies by making the guest
            // heart LIVE (it opens the ParticipationGate) rather than absent.
            // canFavourite=false now means only the host's own preview.
            onToggleFavourite={canFavourite && onToggleFavourite ? onToggleFavourite : null}
          />
          {/* ⭐ A BILL OF ONE OR TWO IS STATED HERE, with the date and the venue
              (owner, 2026-08-20) — ⛔ not given a section of its own below the
              whole summary, where one act became a full-width portrait and the
              largest thing on the page.

              ⚠ It renders at NARROW WIDTHS ONLY; its stylesheet hides it from
              1024px, where the layout's two-column band already puts the real
              Lineup to the right of the title as a 2-across grid. The pairing
              the owner wanted has always existed on desktop — this is the
              stacked case catching up with it. */}
          <EventLineupCompact
            artists={v.lineup.artists}
            withheld={v.lineup.withheld}
            onOpenArtist={a => openProfile({ id: a.id, type: a.type })}
          />
        </>
      }

      decision={
        <EventSummaryCard
          ticketUrl={v.summary.ticketUrl}
          attending={v.summary.attending}
          description={v.summary.description}
          onShare={share}
          // ⚠ ABSENT when there is nobody to send to. A signed-out reader has
          // no conversations, so the control is not rendered rather than
          // rendered-and-dead (R3). Gated on canSend, not canFavourite: the
          // guest heart gates to an account, but sending stays session-only.
          onSendToChat={(canSend ?? canFavourite) ? () => setSendOpen(true) : null}
          onAddToScene={canFavourite && onToggleFavourite ? onToggleFavourite : null}
          websiteUrl={null}
        />
      }

      description={null}

      /* APPLY TO PLAY sits with the other decisions, under the summary card
         in the primary column — it is the artist's version of GET TICKETS. */
      quickActions={applyAction}

      /* ⛔ ONE BILL PER SCREEN. When the compact strip above is the one showing,
         this section is hidden below 1024px rather than removed — at desktop it
         is still the right-hand column and nothing about it changes. Both sides
         ask `isCompactLineup`, so they cannot disagree about which is on. */
      lineup={
        isCompactLineup(v.lineup.artists, v.lineup.withheld) ? (
          <div className={compactStyles.fullOnly}>
            <EventLineup
              artists={v.lineup.artists}
              withheld={v.lineup.withheld}
              onOpenArtist={a => openProfile({ id: a.id, type: a.type })}
            />
          </div>
        ) : (
          <EventLineup
            artists={v.lineup.artists}
            withheld={v.lineup.withheld}
            onOpenArtist={a => openProfile({ id: a.id, type: a.type })}
          />
        )
      }

      setTimes={setTimes}

      /* The venue's card now rides INSIDE § 7 rather than in the card band
         above it (owner, 2026-08-02) — one venue, one place on the page. The
         `venueCard` slot is left empty so the band collapses to the presenter
         alone, or disappears entirely on an event with no known organiser. */
      /* The map image and the navigation target are assembled HERE, not in the
         view model: one needs the storage client and the other needs
         `navigator`, and eventViewModel stays pure so it remains testable.
         Both are null for a withheld location — the view model nulls
         `profileId` and `coords` rather than trusting this call site. */
      venue={
        <EventVenue
          {...v.venue}
          mapUrl={venueMapImageUrl(v.venue.postcode)}
          navUrl={navigationUrl({
            // navCoords, NOT coords: the latter may be a postcode centroid,
            // which is fine for choosing the town picture and useless for
            // directions. See the note in eventViewModel.
            lat: v.venue.navCoords?.lat,
            lng: v.venue.navCoords?.lng,
            label: v.venue.name,
            // Postcode included — "3/5 Church St, Bellingen, NSW" alone let a
            // geocoder pick whichever Church St it fancied.
            address: [v.venue.address, v.venue.locality, v.venue.state, v.venue.postcode]
              .filter(Boolean).join(', '),
          })}
          card={
            <EventVenueCard
              {...v.venue}
              bare
              onOpenVenue={v.venue.profile ? () => openProfile(v.venue.profile) : null}
            />
          }
        />
      }

      eventDetails={<EventDetails rows={v.details} />}

      gallery={
        <EventPoster
          poster={v.poster}
          /* § 11 — the poster plus the logos of the venue, host and every act
             on the bill. LOGO_PACK is the only world-readable asset type; if
             the fetch is still in flight or nobody has uploaded one, this is
             an empty array and the shelf simply does not render. */
          collectables={collectables}
          collected={collected}
          onToggleCollect={() => setCollected(c => !c)}
        />
      }

      relatedEvents={null}

      /* ⚠ null, not an element that renders null. A React element is TRUTHY
         even when its component returns null, so passing one unconditionally
         made the layout's `{(venueCard || presentedBy) && …}` guard always
         true — the card band rendered as an empty row, spending its gap and
         margin on nothing (R5). The decision has to be made here, where the
         data is, not downstream where only an element is visible. */
      presentedBy={
        /* ⚠ The guard now asks about CO-HOSTS TOO. It used to test the
           presenter alone, which was complete when a presenter was the only
           thing this section could hold — with co-hosts it would drop a
           billed profile whenever the owner happened to be unknown, and 17
           events carry no owner at all. */
        (v.presentedBy.presenter?.name || v.presentedBy.coHosts?.length)
          ? <EventPresentedBy
              presenter={v.presentedBy.presenter}
              coHosts={v.presentedBy.coHosts}
              onViewProfile={p => openProfile(p?.profile || p)}
              onViewCoHost={c => openProfile(c?.profile || c)}
            />
          : null
      }

      informationSources={<EventSources {...v.sources} />}
    />

    {sendOpen && (
      <SendToConversationSheet
        title={v.name}
        // ⭐ Built at SEND time, not at open time. The snapshot should record
        // the event as it is when it is actually shared — an open sheet left
        // sitting while the organiser edits the event would otherwise send a
        // card that was already out of date on arrival.
        buildMessage={() => ({
          kind: 'event',
          // ⚠ `v`, NOT `event`. The view model has already resolved the date
          // out of `config` and honoured a WITHHELD venue; the raw row has
          // done neither. See the note at the top of lib/eventCard.
          body: eventCardBody(v),
          payload: eventCardPayload(event.id, v),
        })}
        onClose={() => setSendOpen(false)}
      />
    )}
    </>
  );
}
