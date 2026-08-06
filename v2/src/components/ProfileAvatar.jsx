import { profileIdentity } from '../lib/profileTypes';

/**
 * A PROFILE'S PICTURE — or an honest stand-in, never someone else's.
 *
 * ⛔ THE RULE THIS EXISTS TO ENFORCE (owner, 2026-08-06):
 *   · if an identity has a default image, use it
 *   · if it does not, render no image — a tinted initial, not a photo
 *   · NEVER pretend another identity's default image belongs to it
 *
 * Seven call sites used to end in `|| PROFILE_TYPES.artist.defaultImage`, a
 * pre-10F habit that survived the pass which introduced UNKNOWN_PROFILE. It was
 * invisible while every type happened to own artwork, and became a lie the
 * moment one did not: a festival rendered wearing a DJ's face, confidently and
 * with nothing in the console. That is worse than a blank — a blank reads as
 * missing, a stranger's photo reads as true.
 *
 * ⚠ THE POINT IS THAT THIS IS ONE COMPONENT. Seven copies of the correct
 * conditional would rot exactly the way seven copies of the wrong one did. The
 * next identity added to the platform needs no call-site change at all.
 *
 * The fallback is a tinted initial rather than an empty box, because the
 * rendering contract forbids visual holes — the row must not collapse or gap
 * where a face would be. It follows InboxScreen, which already did this.
 *
 * @param {object}  props
 * @param {string=} props.avatar    already-resolved image URL, if the caller has one
 * @param {object=} props.profile   a profiles-shaped row; avatar_thumb/avatar/type read from it
 * @param {string=} props.type      profile type, when there is no `profile` to read it from
 * @param {object=} props.identity  pre-resolved tokens, when the caller already has them
 * @param {string=} props.name      used for the alt text and the fallback initial
 */
export default function ProfileAvatar({
  avatar, profile, type, identity, name, className, style, alt,
}) {
  const tokens = identity ?? profileIdentity(type ?? profile?.type);
  const src = avatar || profile?.avatar_thumb || profile?.avatar || tokens.defaultImage || null;
  const label = (alt ?? name ?? profile?.name ?? '').trim();

  if (src) {
    return <img className={className} style={style} src={src} alt={label} />;
  }

  return (
    <div
      className={className}
      // The caller's style still applies, so the stand-in occupies exactly the
      // box the photo would have — same size, same radius, same border colour.
      // Anything here that the caller also sets is deliberately overridable by
      // spreading `style` last.
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `rgba(${tokens.rgb},.14)`,
        color: tokens.accent,
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: 18,
        letterSpacing: 1,
        overflow: 'hidden',
        ...style,
      }}
      // Not `alt` — this is not an image. The name is already rendered beside
      // every one of these, so announcing it again would be a duplicate rather
      // than a description.
      aria-hidden="true"
    >
      {(label || '?').slice(0, 1).toUpperCase()}
    </div>
  );
}
