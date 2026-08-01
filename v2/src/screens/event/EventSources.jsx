// § 11 · Information Sources
//
// Spec: docs/event-page-layout-spec.md § 11
//
// Lowest emphasis on the page, fully legible when sought. It sits last because
// it answers a question the reader only asks once already sceptical — surfaced
// earlier, it plants doubt in readers who had none.
//
// ⭐ ITS PRESENCE IS ITSELF INFORMATION. Rendering says "we found this, we did
// not write it", which is what makes an imported or unclaimed event honest
// rather than presumptuous. A manually created event therefore shows nothing
// at all — there is no third party to credit and no provenance to explain.
//
// ⚠ Confidence is a CLAIM. Anything shown here is YesPleez asserting something
// about someone else's event, and it has to be defensible when it is wrong. The
// component renders only what the caller supplies and invents no verdict of its
// own; what computes that verdict is an open question in the spec.

import { TickIcon } from './eventIcons';
import s from './EventSections.module.css';

export default function EventSources({
  origin = null,          // 'discovery' | 'merged' | 'manual'
  contributors = [],
  lastChecked = null,
  confidence = null,
}) {
  // A manually created event has no provenance story. Hide, do not explain.
  if (origin === 'manual' || !origin) return null;

  const named = (contributors || []).filter(Boolean);
  if (!named.length && !lastChecked && !confidence) return null;

  return (
    <section className={`${s.card} ${s.sources}`}>
      <div className={s.headRow}><h2 className={s.heading}>INFORMATION SOURCES</h2></div>

      {named.length > 0 && (
        <div className={s.sourceList}>
          {named.map(c => (
            <div className={s.sourceItem} key={c}>
              <TickIcon className={s.sourceTick} /> {c}
            </div>
          ))}
        </div>
      )}

      {(lastChecked || confidence) && (
        <div className={s.sourceFoot}>
          {lastChecked && <span>Last checked {lastChecked}</span>}
          {confidence && <span>Confidence {confidence}</span>}
        </div>
      )}
    </section>
  );
}
