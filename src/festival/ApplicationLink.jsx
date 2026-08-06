import { useState } from 'react';
import { SectionCard, Button, Callout } from '../design-system';
import { TextInput, Row } from '../design-system/Form';

/**
 * THE APPLICATION LINK.
 *
 * ⭐ The gateway to the entire product. Until an organiser can copy this and
 * paste it into an email, a poster or their own website, nobody can enter the
 * system at all — every other thing the portal does happens after someone has
 * followed this URL.
 *
 * ⚠ Built from `window.location` rather than a configured base URL. A hardcoded
 * host is wrong on localhost, wrong on a preview deploy and wrong again in
 * production, and it fails silently — the link looks perfectly valid and lands
 * nobody anywhere.
 *
 * ⚠ Scoped to an EVENT ID passed in, never to "the current event". A festival
 * with three events has three links, and a card that quietly showed one of them
 * would be handing out the wrong year's URL.
 */
function applyUrl(eventId) {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/apply/${eventId}`;
}

export default function ApplicationLink({ eventId, applicationsOpen = true }) {
  const [copied, setCopied] = useState(false);
  if (!eventId) return null;

  const url = applyUrl(eventId);

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
      subtitle="Anyone with this link can apply. They sign in on the page itself and come straight back."
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
