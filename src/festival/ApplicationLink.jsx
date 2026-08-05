import { useState } from 'react';
import { SectionCard, Button, Callout } from '../design-system';
import { TextInput, Row } from '../design-system/Form';
import { useRepositories } from '../data/dataContext';
import { useQuery } from '../data/useQuery';

/**
 * THE APPLICATION LINK.
 *
 * ⭐ This is the gateway to the entire product. Until an organiser can copy
 * this and paste it into an email, a poster or their own website, nobody can
 * enter the system at all — every other thing the portal does happens after
 * someone has followed this URL.
 *
 * ⚠ Built from `window.location` rather than a configured base URL, because a
 * hardcoded host is wrong on localhost, wrong on a preview deploy and wrong
 * again in production, and it fails silently — the link looks perfectly valid
 * and lands nobody anywhere.
 */
function applyUrl(eventId) {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/apply/${eventId}`;
}

export default function ApplicationLink() {
  const { festivals } = useRepositories();
  const { data: festival, error } = useQuery(() => festivals.getCurrent(), []);
  const [copied, setCopied] = useState(false);

  if (error) {
    return (
      <SectionCard title="Application link">
        <Callout tone="warn" title="No event yet">
          This festival has no event to take applications for, so there is no link to share.
        </Callout>
      </SectionCard>
    );
  }

  // Absent, not broken: the card stays and says nothing until the id arrives,
  // rather than rendering an input containing "undefined" that someone copies.
  if (!festival?.eventId) return null;

  const url = applyUrl(festival.eventId);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    // Long enough to read, short enough that the button is not stuck lying
    // about a clipboard whose contents have since been replaced.
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <SectionCard
      title="Application link"
      subtitle="Anyone with this link can apply. They sign in on the page itself and come straight back."
    >
      <TextInput
        label="Public link"
        readOnly
        value={url}
        onFocus={e => e.target.select()}
      />
      <Row>
        <Button variant="primary" icon={copied ? 'check' : 'external'} onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        <Button variant="secondary" iconRight="external" onClick={() => window.open(url, '_blank')}>
          Open
        </Button>
      </Row>

      {!festival.applicationsOpen && (
        <Callout tone="warn" title="Applications are closed">
          The link works, but it will tell visitors applications are closed until a category is open.
        </Callout>
      )}
    </SectionCard>
  );
}
