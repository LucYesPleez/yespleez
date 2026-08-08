/**
 * The Messenger identity's face, in one place.
 *
 * Every surface that shows the Personal/Messenger identity renders THIS —
 * the identity screen, the Messages header, a phone-discovery search result.
 * One component because a default avatar that is chosen per call site drifts
 * immediately: the same person would appear with three different placeholders
 * depending on which screen you were looking at.
 *
 * ⚠ `punter` IS NOT IN PROFILE_TYPES, so there is no defaultImage to fall back
 * to the way artist/venue/band do. That is not an oversight to be fixed by
 * adding one — the Personal identity deliberately has no public profile type.
 * The default here is THE HAND, the brand's own mark, which is already what
 * the app uses when it needs to say "YesPleez" without saying anything else.
 *
 * The Hand is drawn with the same alpha-mask stencil as `.yp-hand` (see
 * index.css) rather than as an <img>, so it inherits colour and cannot show up
 * as a black rectangle on a dark disc.
 */
export default function MessengerAvatar({ src, size = 44, onClick, alt = '', title }) {
  const common = {
    width: size,
    height: size,
    borderRadius: 999,
    flexShrink: 0,
    display: 'block',
  };

  const face = src ? (
    <img src={src} alt={alt} style={{ ...common, objectFit: 'cover' }} />
  ) : (
    <span
      style={{
        ...common,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // A quiet disc, not a loud one: this is a placeholder, and a bright
        // fill would make everyone without a photo the most prominent thing
        // in a list.
        background: 'rgba(255,255,255,.06)',
        border: '1px solid var(--border)',
        color: 'var(--yp-hand-ink)',
      }}
      aria-hidden={alt ? undefined : 'true'}
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
    >
      <span className="yp-hand" style={{ width: size * 0.55, height: size * 0.55 }} />
    </span>
  );

  if (!onClick) return face;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title || 'Your profile pic'}
      style={{
        padding: 0,
        border: 'none',
        background: 'none',
        borderRadius: 999,
        cursor: 'pointer',
        lineHeight: 0,
        flexShrink: 0,
      }}
    >
      {face}
    </button>
  );
}
