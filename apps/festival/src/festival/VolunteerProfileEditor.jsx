import { useEffect, useState } from 'react';
import {
  SectionCard, Button, Callout, EmptyState, LoadingState,
  TextInput, Textarea, Select, Row, ChipGroup,
} from '../design-system';
import {
  VOLUNTEER_PROFILE_FIELDS,
  EVIDENCE_BACKED_CAPABILITIES,
  capabilityLabel,
} from '../config/volunteerProfile';
import { readVolunteerData, writeVolunteerData } from '../lib/volunteerRoleProfile';
import { useRepositories } from '../data/dataContext';
import { useQuery } from '../data/useQuery';
import s from './VolunteerProfileEditor.module.css';

/**
 * THE VOLUNTEER ROLE-PROFILE EDITOR.
 *
 * ⭐⭐ TWO CARDS BECAUSE THERE ARE TWO LAYERS, and the split is the feature.
 * The first is the PERSON (`person_private`, keyed by account — one human, one
 * date of birth, however many profiles). The second is the ROLE
 * (`festival_role_profiles.data` where `role_key = 'volunteer'`) — what kind of
 * volunteer somebody is, still true at a different festival next year.
 *
 * ⛔⛔ AVAILABILITY, DEPARTMENTS AND A FESTIVAL'S OWN QUESTIONS ARE NOT HERE,
 * and no future convenience puts them here. They change per festival and live
 * on `festival_applications.answers`; freezing one festival's answers into a
 * person's permanent record is the failure this whole architecture exists to
 * prevent. `config/volunteerProfile.js` carries the test for every new field:
 * would the answer be the same at the next festival?
 *
 * ⭐ THE FORM IS RENDERED FROM THE CONFIG, not written out by hand. Adding a
 * field is an entry in `VOLUNTEER_PROFILE_FIELDS`, and Worker, Decor and Media
 * become sibling entries rather than three more copies of this screen.
 *
 * ⛔ NO PARALLEL FORM SYSTEM. Every control is a design-system primitive —
 * TextInput, Textarea, Select, ChipGroup — so this editor inherits label
 * placement, focus treatment and the container queries the rest of the portal
 * already agreed on.
 */

/** One field, drawn from what the config says it IS. ⛔ Never from its key. */
function FieldControl({ field, value, onChange }) {
  const common = {
    label: field.label,
    hint: field.help,
    optional: field.optional,
  };

  if (field.choices && field.multiple) {
    return (
      <ChipGroup
        label={field.label}
        options={field.choices.map(c => ({ value: c.key, label: c.label }))}
        selected={Array.isArray(value) ? value : []}
        onChange={onChange}
      />
    );
  }

  if (field.choices) {
    return (
      <Select
        {...common}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        /* ⚠ The blank option is a real choice, not a placeholder to be styled
           away: an unanswered question and "no prior experience" are different
           answers, and a select that silently defaults to its first entry would
           collapse the two. */
        options={[
          { value: '', label: 'Not answered yet' },
          ...field.choices.map(c => ({ value: c.key, label: c.label })),
        ]}
      />
    );
  }

  const Control = field.multiline ? Textarea : TextInput;
  return <Control {...common} value={value ?? ''} onChange={e => onChange(e.target.value)} />;
}

export default function VolunteerProfileEditor() {
  const { roleProfiles } = useRepositories();

  /**
   * ⚠⚠ ONE QUERY, ONE SETTLE POINT — and the reason is a defect this screen
   * shipped with for exactly as long as it took to look at it.
   *
   * It was three `useQuery` calls, seeded by an effect guarded on
   * `roleRow !== undefined`. But `useQuery` STARTS at `data: null`, so "the
   * fetch has not resolved" and "there is no row for this person" are the same
   * value — the effect fired on the very first render and seeded an EMPTY form,
   * then refused to re-seed because seeding happens once. Every answer somebody
   * had already saved appeared as a blank field, and pressing Save would have
   * written the blanks back over them.
   *
   * ⛔ A `loading` flag does not fix it either: the role query is `enabled`
   * only once the profile id arrives, and in the render where that flips,
   * `loading` is still false while `data` is still null.
   *
   * ⭐ Loading everything in ONE query removes the ambiguity rather than
   * guarding against it. `bundle` is null until it has ALL resolved, and after
   * that it is an object — a state nothing else can produce.
   */
  const { data: bundle, error } = useQuery(async () => {
    const profile = await roleProfiles.getPersonProfile();
    const [person, roleRow] = await Promise.all([
      roleProfiles.getPersonPrivate(),
      profile ? roleProfiles.getRoleProfile(profile.id) : Promise.resolve(null),
    ]);
    return { profile, person, roleRow };
  }, []);

  const profile = bundle?.profile ?? null;
  const person = bundle?.person ?? null;
  const roleRow = bundle?.roleRow ?? null;
  const profileId = profile?.id ?? null;

  const [form, setForm] = useState(null);
  const [details, setDetails] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  /** ⛔ Two error slots, not one. The layers are written separately and one can
   *  fail while the other succeeds; a single "Save failed" over a half-saved
   *  form tells somebody to retype work that is already stored. */
  const [errors, setErrors] = useState({ person: '', role: '' });

  /* Seeded once, and only once everything has arrived. Re-seeding whenever a
     query settles would wipe out whatever the person is halfway through typing
     — the rule ApplicationSetup already learned. */
  useEffect(() => {
    if (!bundle || form != null) return;
    setForm(readVolunteerData(roleRow));
    setDetails({ dob: person?.dob ?? '', streetAddress: person?.street_address ?? '' });
  }, [bundle, form, roleRow, person]);

  if (error) {
    /* ⛔ Never a blank screen and never an empty form. An empty form here would
       invite somebody to fill it in over answers that are still in the database
       and merely could not be read. */
    return (
      <Callout tone="danger" title="Your volunteer profile could not be loaded">
        {error.message || 'Something went wrong reading it. Nothing has been changed.'}
      </Callout>
    );
  }

  if (!bundle) return <LoadingState lines={5} />;

  /**
   * ⛔ A MISSING PUNTER PROFILE IS NOT FIXED BY CREATING ONE. It is
   * system-generated and inalienable, and an app that mints identity to get
   * past an empty screen is inventing the person it is describing. Saying so
   * plainly is the honest answer, and it names what to do about it.
   */
  if (!profile) {
    return (
      <EmptyState
        icon="profile"
        title="This account has no personal profile"
        body="A volunteer profile hangs off the personal profile every account is given at registration. This one has none, so there is nothing to attach it to."
      />
    );
  }

  if (form == null || details == null) return <LoadingState lines={5} />;

  const set = (key, value) => {
    setForm(f => ({ ...f, [key]: value }));
    setSaved(false);
    setErrors({ person: '', role: '' });
  };
  const setDetail = (key, value) => {
    setDetails(d => ({ ...d, [key]: value }));
    setSaved(false);
    setErrors({ person: '', role: '' });
  };

  /**
   * ⚠ TWO WRITES, TWO TABLES, AND NEITHER IS ABANDONED BECAUSE THE OTHER FAILED.
   * `person_private` and `festival_role_profiles` are separate layers with
   * separate policies; a single try around both would let a rejected date of
   * birth discard a page of background somebody had just typed.
   *
   * ⛔ NO REFETCH AFTERWARDS. The form is not re-seeded once it exists, so a
   * reload would fetch rows nothing reads and could only ever disagree with
   * what is on screen.
   */
  async function save() {
    setSaving(true);
    const next = { person: '', role: '' };

    try {
      await roleProfiles.savePersonPrivate(details);
    } catch (e) {
      next.person = e.message || 'Your details could not be saved.';
    }

    try {
      await roleProfiles.saveRoleProfile(profileId, writeVolunteerData(form));
    } catch (e) {
      next.role = e.message || 'Your volunteer background could not be saved.';
    }

    setErrors(next);
    setSaved(!next.person && !next.role);
    setSaving(false);
  }

  /* Which ticked claims name a document. ⛔ Ticking one never proves anything —
     the note says where the proof goes, and there is deliberately no "verified"
     control anywhere on this screen. */
  const claimedEvidence = (form.capabilities || []).filter(k => EVIDENCE_BACKED_CAPABILITIES.includes(k));

  return (
    <div className={s.stack}>
      <SectionCard
        title="Your details"
        subtitle="The person, not the role. One date of birth however many profiles this account holds, so these are entered once and never again."
      >
        <Row>
          {/* ⚠ `type="date"` — the same control the event editor's date fields
              use. Picker-first is a platform rule, and a second date widget in
              one product is how two of them start disagreeing. */}
          <TextInput
            label="Date of birth"
            type="date"
            hint="Some roles have a minimum age. Organisers see whether you meet it, never the date itself."
            value={details.dob ?? ''}
            onChange={e => setDetail('dob', e.target.value)}
          />
          <TextInput
            label="Street address"
            hint="The street line only. Your suburb and state live on your profile."
            value={details.streetAddress ?? ''}
            onChange={e => setDetail('streetAddress', e.target.value)}
          />
        </Row>

        {/* ⭐ Every privacy statement ends with a LIMIT. "Private" on its own is
            a mood; what a reader needs is who sees it and who does not. */}
        <Callout tone="info" title="These two are private">
          They are stored apart from your public profile and are never shown on it.
          A festival sees them only where it has asked for them as part of an application.
        </Callout>

        {errors.person && <Callout tone="danger" title="Your details were not saved">{errors.person}</Callout>}
      </SectionCard>

      <SectionCard
        title="Volunteer background"
        subtitle="Answered once and reused. Which days you can work and which department you want are asked by each festival, on its own application."
      >
        {VOLUNTEER_PROFILE_FIELDS.map(field => (
          <FieldControl
            key={field.key}
            field={field}
            value={form[field.key]}
            onChange={v => set(field.key, v)}
          />
        ))}

        {form.volunteerExperience === 'NONE' && (
          /**
           * ⚠⚠ "NO PRIOR EXPERIENCE" IS AN ANSWER, ⛔ NOT AN EMPTY FIELD, and
           * this is the sentence that makes that true for the person filling it
           * in. Without it the description box below reads as an unanswered
           * question they have failed to answer, and a first-time volunteer is
           * told by the layout that their honest answer was the wrong one.
           */
          <Callout tone="info" title="That is a complete answer">
            Festivals take first-time volunteers. Leave the description blank, or use it to say
            what you would like to learn.
          </Callout>
        )}

        {claimedEvidence.length > 0 && (
          /**
           * ⛔⛔ A TICK IS A CLAIM, NEVER PROOF. Earth Frequency's own form makes
           * the same distinction — Blue Card is a checkbox AND a separate
           * upload. Saying so at the moment of ticking is what stops somebody
           * arriving on site believing the box was enough.
           */
          <Callout tone="warn" title="Some of these need the document too">
            You have said you hold {claimedEvidence.map(capabilityLabel).join(', ')}. A festival
            that requires proof will ask you to upload it as a clearance; ticking the box here
            does not satisfy that on its own.
          </Callout>
        )}

        {errors.role && <Callout tone="danger" title="Your background was not saved">{errors.role}</Callout>}
      </SectionCard>

      <div className={s.actions}>
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save volunteer profile'}
        </Button>
        <span className={s.note}>
          Saved to your account, not to any one festival.
        </span>
      </div>
    </div>
  );
}
