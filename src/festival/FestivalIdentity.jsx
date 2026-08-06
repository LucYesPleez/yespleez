import { useEffect, useState } from 'react';
import { SectionCard, Button, Callout } from '../design-system';
import { TextInput, Textarea } from '../design-system/Form';
import { useRepositories } from '../data/dataContext';
import { useQuery } from '../data/useQuery';

/**
 * THE FESTIVAL'S OWN IDENTITY.
 *
 * ⭐ Writes the SHARED `profiles` row. A festival is a profile like any other,
 * so changing its name here changes it on every YesPleez surface — that is the
 * point, not a side effect.
 *
 * ⚠ This card previously rendered `defaultValue={FESTIVAL.name}` from a config
 * constant: it showed a different festival's name on uncontrolled inputs that
 * saved nothing. A form that looks editable and silently discards what you type
 * is worse than no form, because you only find out later.
 *
 * ⛔ No avatar or banner here. Image upload needs a storage bucket and a
 * policy, and half an upload control is worse than none.
 */
const FIELDS = ['name', 'tagline', 'description', 'location', 'website'];

export default function FestivalIdentity() {
  const { festivals } = useRepositories();
  const { data, reload } = useQuery(() => festivals.getCurrent(), []);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Seed once. Re-seeding whenever the query settles would wipe whatever the
  // organiser is halfway through typing.
  useEffect(() => {
    if (data && !form) {
      setForm(Object.fromEntries(FIELDS.map(k => [k, data[k] ?? ''])));
    }
  }, [data, form]);

  if (!form) return null;

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setSaved(false); setError(''); };

  async function save() {
    setSaving(true);
    setError('');
    try {
      await festivals.updateProfile({
        name: form.name.trim(),
        tagline: form.tagline.trim(),
        bio: form.description.trim(),
        location: form.location.trim(),
        website: form.website.trim(),
      });
      setSaved(true);
      reload();
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  }

  return (
    <SectionCard
      title="Identity"
      subtitle="Shared with every YesPleez surface — changing it here changes it everywhere. The tagline and description are what applicants read first."
    >
      <TextInput label="Festival name" value={form.name} onChange={e => set('name', e.target.value)} />
      <TextInput
        label="Tagline" optional maxLength={80} placeholder="Eighty characters at most"
        value={form.tagline} onChange={e => set('tagline', e.target.value)}
      />
      <Textarea
        label="Description" rows={5}
        placeholder="What the festival is, in the words an applicant should read first."
        value={form.description} onChange={e => set('description', e.target.value)}
      />
      <TextInput label="Location" value={form.location} onChange={e => set('location', e.target.value)} />
      <TextInput
        label="Website" optional placeholder="https://"
        value={form.website} onChange={e => set('website', e.target.value)}
      />

      {error && <Callout tone="danger" title="Not saved">{error}</Callout>}

      <Button variant="primary" onClick={save} disabled={saving || !form.name.trim()}>
        {saving ? 'Saving…' : saved ? 'Saved' : 'Save identity'}
      </Button>
    </SectionCard>
  );
}
