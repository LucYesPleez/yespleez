import s from './states.module.css';

/**
 * A single shimmering placeholder shape.
 *
 * The primitive behind LoadingState, and usable directly wherever one value
 * is pending. Shimmering rather than static: a still grey block is
 * indistinguishable from a broken image, and movement says "loading" without
 * any copy.
 */
export default function Skeleton({ width = '100%', height = 10, shape = 'bar', style, ...rest }) {
  const shapeClass =
    shape === 'circle' ? s.skeletonCircle :
    shape === 'block'  ? s.skeletonBlock  : '';

  return (
    <span
      className={`${s.skeleton} ${shapeClass}`}
      style={{ width, height, display: 'block', ...style }}
      aria-hidden="true"
      {...rest}
    />
  );
}
