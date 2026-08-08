import { useState } from 'react';
import { SectionCard, Button, Callout } from '../design-system';
import { TextInput, Row } from '../design-system/Form';
import { sceneEventUrl } from '../config/scene';

/**
 * THE APPLICATION LINK.
 *
 * ⭐ The gateway to the entire product. Until an organiser can copy this and
 * paste it into an email, a poster or their own website, nobody can enter the
 * system at all — every other thing the portal does happens after someone has
 * followed this URL.
 *
 * ⭐ IT POINTS AT SCENE NOW, not at this app. Owner's ruling 2026-08-06: a
 * festival's event opens the normal Scene event page, and the public never needs
 * to know a Festival app exists. This repo's own `/apply/:eventId` has been
 * deleted — it was a second public surface writing the same table.
 *
 * ⚠ It was built from `window.location` and could not stay that way once the
 * destination moved to a different origin. See config/scene.js, which restates
 * the hardcoded-host warning this comment used to carry.
 *
 * ⚠ Scoped to an EVENT ID passed in, never to "the current event". A festival
 * with three events has three links, and a card that quietly showed one of them
 * would be handing out the wrong year's URL.
 */

export default function ApplicationLink({ eventId, applicationsOpen = true }) {
  const [copied, setCopied] = useState(false);
  if (!eventId) return null;

  const url = sceneEventUrl(eventId);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    // Long enough to read, short enough that the button is not left lying about
    // a clipboard whose contents have since been replaced.
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <SectionCard
      title="Application link"
      /* ⚠ The old copy promised "they sign in on the page itself and come
         straight back", which was true of this app's apply page and is not true
         of Scene's. Describing a flow the destination does not have is how an
         organiser ends up reassuring an applicant about something that will not
         happen to them. */
      subtitle="Your event's public page in Scene. Anyone with this link can see the event and apply."
    >
      <TextInput label="Public link" readOnly value={url} onFocus={e => e.target.select()} />
      <Row>
        <Button variant="primary" icon={copied ? 'check' : 'external'} onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        <Button variant="secondary" iconRight="external" onClick={() => window.open(url, '_blank')}>
          Open
        </Button>
      </Row>

      {!applicationsOpen && (
        <Callout tone="warn" title="Applications are closed">
          The link works, but it will tell visitors applications are closed until a category
          is open on this event.
        </Callout>
      )}
    </SectionCard>
  );
}
