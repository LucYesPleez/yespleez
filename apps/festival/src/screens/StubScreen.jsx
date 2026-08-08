import { SectionCard, LoadingState } from '../design-system';
import s from './screens.module.css';

/**
 * A route that exists, works, and is not built yet.
 *
 * ⭐ Not an error state and not an empty state — an honest "later". Each stub
 * names what will live here AND which existing YesPleez system it will
 * consume, because the most important fact about Messages and Announcements
 * is that the portal builds neither of them.
 *
 * One component for four screens. Four separate files would each grow their
 * own layout before anyone decided what they should be.
 */
export default function StubScreen({ title, subtitle, blocks = [], actions }) {
  return (
    <div className={s.page}>
      <header className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>{title}</h1>
          {subtitle && <p className={s.pageSubtitle}>{subtitle}</p>}
        </div>
        {actions}
      </header>

      <div className={s.stubGrid}>
        {blocks.map(block => (
          <SectionCard key={block.title} title={block.title} subtitle={block.note}>
            <LoadingState lines={3} />
          </SectionCard>
        ))}
      </div>
    </div>
  );
}
