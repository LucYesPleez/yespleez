import { useEffect, useState } from 'react';
import s from './ClaimDialog.module.css';
import { profileIdentity } from '../lib/profileTypes';
import { CLAIM_RELATIONSHIPS, submitClaimRequest, fetchMyClaimRequest, checkClaimEligibility, CLAIM_BLOCKED } from '../lib/profileClaimRequest';

const CLAIMS_EMAIL       = 'claims@yespleez.com';
const YESPLEEZ_IG_HANDLE = 'yespleez_pres';
const YESPLEEZ_INSTAGRAM = `https://www.instagram.com/${YESPLEEZ_IG_HANDLE}/`;

/**
 * CLAIM THIS PROFILE — §07 stage C, submitted in-app.
 *
 * The primary path INSERTs a real claim request (lib/profileClaimRequest.js);
 * a trigger flips the profile's public state to "Claim under review". This
 * dialog never completes a claim — approval happens on the review side, and
 * the app's database roles cannot execute the approval function at all.
 * claimDelivery.test.js enforces the client half of that invariant.
 *
 * ── WHY THE MANUAL ROUTES SURVIVE UNDERNEATH ─────────────────────────
 *
 * Instagram and claims@yespleez.com remain, demoted to a quiet footer path.
 * Two reasons, both deliberate:
 *
 *   1. §09 (Ethics, ratified): "the real entity can request correction or
 *      removal WITHOUT creating an account. Claiming is never the price of
 *      control over your own listing." The in-app form requires an account;
 *      the survival of an account-free contact route is what keeps that
 *      sentence true.
 *   2. The form needs the migration applied and a signed-in session. The
 *      manual route works from a phone at a gig with neither.
 */
export default function ClaimDialog({ open, onClose, profile, session, onSubmitted }) {
  const [copied, setCopied]             = useState(false);
  const [relationship, setRelationship] = useState('');
  const [evidence, setEvidence]         = useState('');
  const [phase, setPhase]               = useState('form');   // form | sending | done
  const [error, setError]               = useState('');
  const [existing, setExisting]         = useState(undefined); // undefined = loading, null = none, obj = claim
  const [eligibility, setEligibility]   = useState(null);      // null = loading, else {eligible, reason?, ownedProfile?}

  const signedIn = Boolean(session?.user?.id);

  // On open, resolve two things before deciding what to show, so the form
  // never appears for a claim that could not succeed:
  //   - do I already have a claim under review here? (show that instead)
  //   - is this profile claimable by me at all? (an account holds one profile
  //     per type, so a second of the same type is a duplicate, not a claim)
  useEffect(() => {
    if (!open || !profile?.id || !signedIn) return;
    let alive = true;
    setExisting(undefined);
    setEligibility(null);
    fetchMyClaimRequest(profile.id).then(({ request }) => {
      if (alive) setExisting(request);
    });
    checkClaimEligibility({ userId: session.user.id, profileType: profile.type }).then((e) => {
      if (alive) setEligibility(e);
    });
    return () => { alive = false; };
  }, [open, profile?.id, profile?.type, signedIn, session?.user?.id]);

  if (!open || !profile) return null;

  const profileUrl = window.location.href;
  // ⚠ Labels are display tokens: ALL CAPS with punctuation — artist is
  // "DJ / PROD.", standup is "COMEDY / POETRY". Render AS-IS; lower-casing
  // produced "a dj / prod. profile", which reads like a typo.
  // profileIdentity() is the canonical accessor — it never guesses a type.
  // The old `|| 'Artist'` fallback here labelled an unknown profile as an
  // artist in the claim email, which is exactly the 10F anti-pattern.
  const typeLabel  = profileIdentity(profile.type).label;
  const userEmail  = session?.user?.email || '[your YesPleez account email]';

  const subject = `Profile Claim Request – ${profile.name}`;
  const body = [
    'Hello YesPleez,', '',
    "I'd like to claim the following YesPleez profile.", '',
    'Profile:', profileUrl, '',
    'Profile Type:', typeLabel, '',
    'My YesPleez account email:', userEmail, '',
    'Evidence of ownership:', '',
    'Official Website: ', 'Instagram: ', 'Facebook: ',
    'Spotify / SoundCloud / Bandcamp / Resident Advisor: ',
    'Business Email (if applicable): ', '',
    'Additional information:', '',
    'Thank you.',
  ].join('\n');
  const mailtoUrl = `mailto:${CLAIMS_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setPhase('sending');
    const { request, error: err } = await submitClaimRequest({
      profileId: profile.id, profileType: profile.type, relationship, evidence,
    });
    if (err) {
      setPhase('form');
      setError(err.message);
      return;
    }
    setPhase('done');
    setExisting(request);
    // The profile row's claim_status just became 'pending' via the trigger;
    // let the screen refetch so "Claim under review" appears without a reload.
    onSubmitted?.();
  }

  const pendingAlready = existing && existing.status === 'pending' && phase !== 'done';
  // Signed in but the two on-open lookups have not both resolved yet. Hold the
  // form back until they do, so a claim that cannot succeed never gets a form.
  const checkingPrecheck = signedIn && phase !== 'done' && (existing === undefined || eligibility === null);
  const blockedOwnsType  = eligibility && !eligibility.eligible
    && eligibility.reason === CLAIM_BLOCKED.OWNS_TYPE && phase !== 'done';

  const ownedName = eligibility?.ownedProfile?.name;

  // The account-free routes (§09: claiming is never the price of control over
  // your own listing). Shared by the form and the already-own-this-type panel —
  // the latter uses them as the "message us to merge" path.
  const altRoutes = (
    <>
      <p className={s.altHeading}>Prefer to contact us directly?</p>
      <div className={s.options}>
        <a href={YESPLEEZ_INSTAGRAM} target="_blank" rel="noopener noreferrer" className={`${s.option} ${s.optionInstagram}`} onClick={onClose}>
          <div className={s.optionIcon}>
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect width="20" height="20" x="2" y="2" rx="5" ry="5"/>
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
              <line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>
            </svg>
          </div>
          <div className={s.optionContent}>
            <div className={s.optionTitle}>DM us on Instagram</div>
            <div className={s.optionDesc}>
              Message <span className={s.igHighlight}>@{YESPLEEZ_IG_HANDLE}</span> with your profile link and evidence of ownership.
            </div>
          </div>
          <div className={s.optionArrow}>›</div>
        </a>

        <a href={mailtoUrl} className={s.option} onClick={onClose}>
          <div className={s.optionIcon}>
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/>
            </svg>
          </div>
          <div className={s.optionContent}>
            <div className={s.optionTitle}>Email us</div>
            <div className={s.optionDesc}>
              Opens your email app with a pre-filled template for{' '}
              <span className={s.emailHighlight}>{CLAIMS_EMAIL}</span>
            </div>
          </div>
          <div className={s.optionArrow}>›</div>
        </a>
      </div>

      {/* Fallback for the silent-mailto case — a machine with no mail
          handler does nothing at all on the link above. */}
      <button
        type="button"
        className={s.copyRow}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(CLAIMS_EMAIL);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch { /* clipboard blocked — the address is on screen regardless */ }
        }}
      >
        {copied ? 'Address copied' : `Email app didn't open? Copy ${CLAIMS_EMAIL}`}
      </button>
    </>
  );

  return (
    <div className={s.backdrop} onClick={onClose}>
      <div className={s.sheet} onClick={e => e.stopPropagation()}>
        <div className={s.handle} />

        <div className={s.header}>
          <span className={s.title}>CLAIM THIS PROFILE</span>
          <button className={s.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        {phase === 'done' ? (
          <div className={s.doneBox}>
            <div className={s.doneMark}>✓</div>
            <p className={s.doneTitle}>Claim submitted</p>
            <p className={s.body}>
              This profile now shows as under review. The YesPleez team checks every
              claim by hand — you&apos;ll be contacted on your account email if anything
              more is needed.
            </p>
            <button type="button" className={s.submitBtn} onClick={onClose}>Done</button>
          </div>
        ) : pendingAlready ? (
          <div className={s.doneBox}>
            <div className={s.doneMark}>⏳</div>
            <p className={s.doneTitle}>Your claim is under review</p>
            <p className={s.body}>
              You submitted a claim for this profile on{' '}
              {new Date(existing.created_at).toLocaleDateString()}. There&apos;s nothing
              more to do — the team reviews every claim by hand.
            </p>
            <button type="button" className={s.submitBtn} onClick={onClose}>OK</button>
          </div>
        ) : checkingPrecheck ? (
          <p className={s.body} style={{ textAlign: 'center', padding: '24px 0' }}>Checking…</p>
        ) : blockedOwnsType ? (
          <>
            <div className={s.doneBox}>
              <div className={s.doneMark}>🔀</div>
              <p className={s.doneTitle}>You already own a {typeLabel} profile</p>
              <p className={s.body}>
                {ownedName
                  ? <>This one looks like a duplicate of <strong>{ownedName}</strong>, which you already own.</>
                  : <>This one looks like a duplicate of the profile you already own.</>}
                {' '}Combining duplicate profiles isn&apos;t available yet, so it can&apos;t be
                claimed at the moment. Nothing is wrong with your account — you keep everything
                on your existing profile.
              </p>
            </div>
            {altRoutes}
          </>
        ) : (
          <>
            <p className={s.body}>
              If you own or officially represent this profile, you can request ownership.
              All claims are reviewed manually by the YesPleez team.
            </p>

            {signedIn ? (
              <form className={s.form} onSubmit={handleSubmit}>
                <label className={s.fieldLabel} htmlFor="claim-rel">Your connection</label>
                <select
                  id="claim-rel"
                  className={s.select}
                  value={relationship}
                  onChange={e => setRelationship(e.target.value)}
                  required
                >
                  <option value="" disabled>Choose one…</option>
                  {CLAIM_RELATIONSHIPS.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>

                <label className={s.fieldLabel} htmlFor="claim-ev">Evidence of ownership</label>
                <textarea
                  id="claim-ev"
                  className={s.textarea}
                  value={evidence}
                  onChange={e => setEvidence(e.target.value)}
                  placeholder={'Links that show this is you — official website, Instagram, Spotify / SoundCloud, a business email on the same domain…'}
                  rows={4}
                />

                {error && <p className={s.errorMsg}>{error}</p>}

                <button type="submit" className={s.submitBtn} disabled={phase === 'sending'}>
                  {phase === 'sending' ? 'Submitting…' : 'Submit claim'}
                </button>
              </form>
            ) : (
              <p className={s.signInNote}>
                Claiming needs a YesPleez account, so we know who to hand the profile
                to. Sign in (or create a free account), come back here, and the claim
                takes a minute — or use one of the routes below, no account required.
              </p>
            )}

            {altRoutes}
          </>
        )}

        <p className={s.footer}>
          We aim to review all claims within a few business days.
        </p>
      </div>
    </div>
  );
}
