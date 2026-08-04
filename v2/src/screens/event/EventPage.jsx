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
  // Two live features the old page carried and this one must not lose.
  // Both are given as nodes rather than data: they need session, host
  // handlers and write paths that this page has no business knowing about.
  // 3 events have applications open; 2 publish set times.
  applyAction = null,
  setTimes = null,
}) {
  const navigate = useNavigate();
  const [collected, setCollected] = useState(false);

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
    <EventPageLayout
      hero={<EventHero {...v.hero} alt={v.name} />}

      identity={
        <EventIdentity
          {...v.identity}
          favourited={favourited}
          // R3 · no dead controls. A guest has nothing to save to, so the
          // heart is absent rather than present-and-inert.
          onToggleFavourite={canFavourite && onToggleFavourite ? onToggleFavourite : null}
        />
      }

      decision={
        <EventSummaryCard
          ticketUrl={v.summary.ticketUrl}
          attending={v.summary.attending}
          description={v.summary.description}
          onShare={share}
          onAddToScene={canFavourite && onToggleFavourite ? onToggleFavourite : null}
          websiteUrl={null}
        />
      }

      description={null}

      /* APPLY TO PLAY sits with the other decisions, under the summary card
         in the primary column — it is the artist's version of GET TICKETS. */
      quickActions={applyAction}

      lineup={
        <EventLineup
          artists={v.lineup.artists}
          withheld={v.lineup.withheld}
          onOpenArtist={a => openProfile({ id: a.id, type: a.type })}
        />
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
  );
}
