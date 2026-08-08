import { useState } from 'react';
import { supabase } from '../data/supabase/client';
import { TextInput } from '../design-system/Form';
import Button from '../design-system/Button';
import { useRepositories } from '../data/dataContext';
import s from './SignInScreen.module.css';

/**
 * ONBOARDING — the account is signed in and owns no festival.
 *
 * ⭐ This was the last SQL-only step in the organiser journey. Until it
 * existed, "create festival profile" meant someone hand-inserting a row, which
 * is the difference between a demo for one festival and a platform any
 * organiser can start on.
 *
 * Two fields, deliberately. Tagline, description, website and everything else
 * already have a home in the Festival screen's Identity card — asking for them
 * here would be a second form to keep agreeing with the first. The minimum to
 * exist is a name; everything else is editing, and editing is built.
 *
 * Reuses the sign-in card's styles: same moment in the journey, same shape of
 * decision, and a second near-identical stylesheet would only drift.
 */
export default function CreateFestivalScreen({ onCreated }) {
  const { festivals } = useRepositories();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await festivals.createProfile({ name: name.trim(), location: location.trim() });
      onCreated?.();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className={s.wrap}>
      <form className={s.card} onSubmit={submit}>
        <h1 className={s.brand}>CREATE YOUR FESTIVAL</h1>
        <span className={s.sub}>
          One festival per account. You can add events, dates and applications next.
        </span>

        <div className={s.fields}>
          <TextInput
            label="Festival name"
            value={name}
            placeholder="Echo Valley Festival"
            onChange={e => setName(e.target.value)}
            required
          />
          <TextInput
            label="Location"
            optional
            value={location}
            placeholder="Mid North Coast, NSW"
            onChange={e => setLocation(e.target.value)}
          />
        </div>

        <div className={s.error} role="alert">{error}</div>

        <Button type="submit" variant="primary" block disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create festival'}
        </Button>

        {/* The other door out. Someone who signed in with the wrong account
            should not have to clear cookies to leave. */}
        <Button variant="ghost" size="sm" block onClick={() => supabase.auth.signOut()}>
          Sign out
        </Button>
      </form>
    </div>
  );
}
