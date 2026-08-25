import { useState } from 'react';
import { SectionCard, Button, Callout } from '../design-system';
import { TextInput, Row } from '../design-system/Form';
import { sceneEventUrl } from '../config/scene';
import { landingUrl } from '../config/landing';

/**
 * THE PUBLIC LINKS.
 *
 * ⭐ The gateway to the entire product. Until an organiser can copy these and
 * paste them into an email, a poster or their own website, nobody can enter
 * the system at all — every other thing the portal does happens after someone
 * has followed one of these URLs.
 *
 * Two links with two jobs (owner, 2026-08-26):
 *
 *   LANDING PAGE  this app's `/f/:eventId` — the festival's front door. What
 *                 goes on the website and the poster: identity, dates, open
 *                 categories, and APPLY actions that lead to Scene.
 *   EVENT PAGE    Scene's `/event/:id` — where applying actually happens
 *                 (owner's ruling 2026-08-06: exactly ONE public apply
 *                 surface, and it is Scene's).
 *
 * ⚠ Both are scoped to an EVENT ID passed in, never to "the current event". A
 * festival with three events has three of each, and a card that quietly showed
 * one of them would be handing out the wrong year's URL.
 */

export default function ApplicationLink({ eventId, applicationsOpen = true }) {
  if (!eventId) return null;

  const landing = landingUrl(eventId);
  const scene = sceneEventUrl(eventId);

  return (
    <SectionCard
      title="Public links"
      subtitle="The landing page is your front door for websites and posters. Applying itself happens on the Scene event page, which the landing page links to."
    >
      <LinkRow
        label="Festival landing page"
        url={landing}
      />
      <LinkRow
        label="Event page in Scene"
        url={scene}
      />

      {!applicationsOpen && (
        <Callout tone="warn" title="Applications are closed">
          Both links work, but they will tell visitors applications are closed until a
          category is open on this event.
        </Callout>
      )}
    </SectionCard>
  );
}

function LinkRow({ label, url }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    // Long enough to read, short enough that the button is not left lying
    // about a clipboard whose contents have since been replaced.
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <TextInput label={label} readOnly value={url} onFocus={e => e.target.select()} />
      <Row>
        <Button variant="primary" icon={copied ? 'check' : 'external'} onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        <Button variant="secondary" iconRight="external" onClick={() => window.open(url, '_blank')}>
          Open
        </Button>
      </Row>
    </>
  );
}
