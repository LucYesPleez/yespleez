import Skeleton from './Skeleton';
import s from './states.module.css';

/**
 * What a surface shows while its data is in flight.
 *
 * `variant="rows"` mimics the applications table so the page does not change
 * shape when real rows arrive — a loading state that occupies different space
 * than the content causes a visible jump, which reads as a bug even though
 * everything worked.
 *
 * Widths vary per row on purpose. Identical bars look like a rendering
 * artefact; uneven ones read as text.
 */
const ROW_WIDTHS = ['62%', '48%', '71%', '55%', '66%', '44%', '58%', '69%'];

export default function LoadingState({ variant = 'lines', rows = 6, lines = 4 }) {
  if (variant === 'rows') {
    return (
      <div role="status" aria-label="Loading applications">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={s.rowSkeleton}>
            <Skeleton shape="circle" width={34} height={34} />
            <div className={s.rowGrow}>
              <Skeleton width={ROW_WIDTHS[i % ROW_WIDTHS.length]} height={11} />
              <Skeleton width="32%" height={9} />
            </div>
            <Skeleton shape="block" width={92} height={22} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={s.lines} role="status" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={ROW_WIDTHS[i % ROW_WIDTHS.length]} height={10} />
      ))}
    </div>
  );
}
