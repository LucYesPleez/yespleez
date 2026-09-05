import SocialSection from './SocialSection';
import { providerFor } from '../lib/demoMixProviders';
import {
  demoMixFieldFor, DEMO_MIX_PLACEHOLDER, DEMO_MIX_NOTICE, DEMO_MIX_MINUTES,
} from '../lib/demoMixField';

/**
 * ONE DEMO MIX FIELD FOR EVERY PERFORMER TYPE.
 *
 * ⛔⛔ THE ONLY PLACE THIS FIELD IS RENDERED. It replaces three separate
 * implementations that disagreed about the section name, the accepted formats
 * and whether a limit existed at all. Extend `lib/demoMixField.js` rather than
 * writing a fourth.
 *
 * ⚠ STYLES ARE INJECTED (`s`), as with BlurbFields — the same reason: the
 * editors carry their own accents. All three performer editors happen to share
 * ArtistProfileScreen.module.css today, but the prop is what keeps that a
 * coincidence rather than a dependency.
 */
export default function DemoMixField({ s, type, value, onChange, naFields, onToggleNa }) {
  const field = demoMixFieldFor(type);
  if (!field) return null;   // ⛔ hosts and venues do not perform

  /* ⚠⚠ A WARNING, ⛔ NOT A REJECTION. Existing profiles hold YouTube and Vimeo
     links saved when the editors invited them, and refusing to save would
     destroy a link the owner still wants without offering anywhere to put it.
     This says the truth instead: it is stored, it will not play here.
     ⚠ Only shown once something has been typed — an empty box is not a
     mistake, and `providerFor('')` is null for the ordinary reason. */
  const typed = (value || '').trim();
  const unplayable = typed.length > 0 && !providerFor(typed);

  return (
    <>
      <p className={s.sectionHint}>{field.blurb} {DEMO_MIX_NOTICE}</p>
      {/* ⚠ OPTIONAL, AND RENDERED WHEN PRESENT. Standup had a label before
          ("LINK TO YOUR BEST SET OR SHOWREEL") so dropping it everywhere would
          be a silent downgrade; Artist never had one. Band's was removed by the
          owner because it restated the title directly above it. ⛔ Do not make
          this unconditional: an empty label row leaves a gap where the input
          should start. */}
      {field.label && <label className={s.fieldLabel}>{field.label}</label>}
      <SocialSection
        links={[{
          icon: 'headphones',
          key: 'mixLink',
          value: value || '',
          onChange,
          placeholder: DEMO_MIX_PLACEHOLDER,
          noNa: true,
        }]}
        naFields={naFields}
        onToggleNa={onToggleNa}
        inputClass={s.input}
        rowClass={s.socialRow}
        iconClass={s.socialIcon}
      />
      {unplayable && (
        <p className={s.sectionHint} style={{ color: 'var(--warn, #FFB830)' }}>
          This link will not play on YesPleez. The player takes SoundCloud and
          Mixcloud audio, so a video link opens in a new tab instead and the
          promoter leaves your profile to hear it.
        </p>
      )}
    </>
  );
}

/** ⚠ Re-exported so a caller can title its own Section without a second import. */
export { DEMO_MIX_MINUTES };
