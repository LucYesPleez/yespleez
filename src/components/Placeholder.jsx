import s from './Placeholder.module.css';

/**
 * The shell's stand-in for content that does not exist yet.
 *
 * Skeleton bars rather than sample prose, on purpose: a shell full of
 * plausible fake text reads as a finished product in a screenshot, and every
 * reviewer then evaluates the wrong thing. Bars say "not built yet" without
 * anyone having to explain it.
 */
export default function Placeholder({ title, lines = 4 }) {
  return (
    <div className={s.block}>
      {title && <span className={s.title}>{title}</span>}
      <div className={s.lines}>
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className={s.line} />
        ))}
      </div>
    </div>
  );
}
