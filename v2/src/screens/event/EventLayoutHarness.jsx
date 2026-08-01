// DEV ONLY — the Event Page layout harness.
//
// Renders the whole page against fixtures so the layout can be judged against
// the event the spec was written for, rather than against the sparse rows that
// actually exist. Not routed in production.
//
// Route: /#/dev/event-layout   (the app uses HashRouter)

import { useState } from 'react';
import EventPageLayout from './EventPageLayout';
import EventHero from './EventHero';
import EventIdentity from './EventIdentity';
import EventSummaryCard from './EventSummaryCard';
import EventLineup from './EventLineup';
import EventVenue from './EventVenue';
import EventDetails from './EventDetails';
import EventPoster from './EventPoster';
import EventPresentedBy from './EventPresentedBy';
import EventSources from './EventSources';
import EventStickyBar from './EventStickyBar';
import {
  heroCases, summaryCases, lineupCases, venueCases,
  detailCases, presenterCases, sourcesCases, posterSample, collectableCases,
} from './eventFixture';

const K = o => Object.keys(o);

function Switcher({ label, options, value, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', marginBottom: 6 }}>
      <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.4, color: 'rgba(255,255,255,.32)', minWidth: 92 }}>{label}</span>
      {options.map(o => (
        <button key={o} onClick={() => onChange(o)}
          style={{
            fontFamily: "'Bebas Neue'", fontSize: 10.5, letterSpacing: 1.1,
            padding: '4px 9px', borderRadius: 6, cursor: 'pointer',
            border: `1px solid ${value === o ? 'var(--neon2)' : 'rgba(255,255,255,.13)'}`,
            background: value === o ? 'rgba(0,229,255,.12)' : 'none',
            color: value === o ? 'var(--neon2)' : 'rgba(255,255,255,.42)',
          }}>{o.toUpperCase()}</button>
      ))}
    </div>
  );
}

export default function EventLayoutHarness() {
  const [rung, setRung]       = useState(K(heroCases)[0]);
  const [content, setContent] = useState(K(summaryCases)[0]);
  const [bill, setBill]       = useState(K(lineupCases)[0]);
  const [venue, setVenue]     = useState(K(venueCases)[0]);
  const [details, setDetails] = useState(K(detailCases)[0]);
  const [presenter, setPres]  = useState(K(presenterCases)[0]);
  const [sources, setSources] = useState(K(sourcesCases)[0]);
  const [showPoster, setShowPoster] = useState('yes');
  const [collectables, setCollectables] = useState(K(collectableCases)[0]);

  const [fav, setFav] = useState(false);
  const [collected, setCollected] = useState(false);

  const c = summaryCases[content];

  return (
    <div style={{ padding: '72px 0 24px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto 20px', padding: '0 16px' }}>
        <Switcher label="HERO"      options={K(heroCases)}      value={rung}      onChange={setRung} />
        <Switcher label="CONTENT"   options={K(summaryCases)}   value={content}   onChange={setContent} />
        <Switcher label="LINEUP"    options={K(lineupCases)}    value={bill}      onChange={setBill} />
        <Switcher label="VENUE"     options={K(venueCases)}     value={venue}     onChange={setVenue} />
        <Switcher label="DETAILS"   options={K(detailCases)}    value={details}   onChange={setDetails} />
        <Switcher label="POSTER"    options={['yes', 'no']}     value={showPoster} onChange={setShowPoster} />
        <Switcher label="COLLECTABLES" options={K(collectableCases)} value={collectables} onChange={setCollectables} />
        <Switcher label="PRESENTER" options={K(presenterCases)} value={presenter} onChange={setPres} />
        <Switcher label="SOURCES"   options={K(sourcesCases)}   value={sources}   onChange={setSources} />
      </div>

      {/* §§ 3–5 are ONE card now — status, description and utilities as divided
          bands. The description and quickActions slots stay empty; the card
          fills the decision slot and carries all three. */}
      <EventPageLayout
        hero={<EventHero {...heroCases[rung]} alt={c.name} />}

        identity={
          <EventIdentity
            name={c.name} when={c.when} where={c.where} genres={c.genres}
            favourited={fav}
            onToggleFavourite={() => setFav(v => !v)}
          />
        }

        decision={
          <EventSummaryCard
            ticketUrl={c.ticketUrl}
            attending={c.attending}
            description={c.description}
            onShare={() => {}}
            onAddToScene={() => {}}
            /* Same-origin on purpose: an external href here makes the browser
               pane's site-approval prompt fire during layout checks. */
            websiteUrl={c.ticketUrl ? '#/dev/event-layout' : null}
          />
        }

        description={null}

        quickActions={null}

        lineup={<EventLineup {...lineupCases[bill]} onViewAll={() => {}} />}

        venue={<EventVenue {...venueCases[venue]} onOpenVenue={() => {}} />}

        eventDetails={<EventDetails rows={detailCases[details]} />}

        gallery={
          <EventPoster
            poster={showPoster === 'yes' ? posterSample : null}
            collectables={collectableCases[collectables]}
            collected={collected}
            onToggleCollect={() => setCollected(v => !v)}
          />
        }

        relatedEvents={null}

        presentedBy={<EventPresentedBy {...presenterCases[presenter]} onViewProfile={() => {}} />}

        informationSources={<EventSources {...sourcesCases[sources]} />}

        stickyBar={
          <EventStickyBar
            ticketUrl={c.ticketUrl}
            favourited={fav}
            onToggleFavourite={() => setFav(v => !v)}
            onShare={() => {}}
          />
        }
      />
    </div>
  );
}
