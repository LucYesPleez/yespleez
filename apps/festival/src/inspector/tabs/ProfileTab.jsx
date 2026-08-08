import { SectionCard, Skeleton, Icon } from '../../design-system';
import s from './ProfileTab.module.css';

/**
 * The first inspector tab, and the reference implementation for the rest.
 *
 * ⭐ Note what it does NOT do: it never renders a stored copy of the
 * applicant's bio, genres or links. Identity is referenced and read live;
 * only what was SUBMITTED is preserved with the application. A profile
 * snapshot would be a second source of truth about what an artist is.
 *
 * Field rows are a local pattern rather than a design-system component
 * because only inspector tabs use them. It moves into the design system the
 * moment a second surface needs it — not before.
 */
function Field({ label, children }) {
  return (
    <div className={s.field}>
      <span className={s.fieldLabel}>{label}</span>
      <span className={s.fieldValue}>{children}</span>
    </div>
  );
}

export default function ProfileTab() {
  return (
    <>
      <SectionCard title="Links">
        <div className={s.links}>
          {['spotify', 'soundcloud', 'instagram', 'youtube', 'external'].map(name => (
            <span key={name} className={s.link}><Icon name={name} size={16} /></span>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Bio" subtitle="Read live from the profile — never copied.">
        <div className={s.lines}>
          <Skeleton width="100%" />
          <Skeleton width="94%" />
          <Skeleton width="61%" />
        </div>
      </SectionCard>

      <SectionCard title="Details">
        <Field label="Location"><Skeleton width={120} height={9} /></Field>
        <Field label="Experience"><Skeleton width={96} height={9} /></Field>
        <Field label="Availability"><Skeleton width={140} height={9} /></Field>
      </SectionCard>
    </>
  );
}
