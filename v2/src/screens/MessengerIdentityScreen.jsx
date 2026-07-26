import { useState, useEffect, useRef } from 'react';
import { useSession } from '../App';
import { supabase } from '../lib/supabase';
import { getPersonalProfileId } from '../lib/actingProfile';
import AvatarUpload from '../components/AvatarUpload';
import MessengerAvatar from '../components/MessengerAvatar';

/**
 * MI1 · The Messenger identity — avatar only.
 *
 * ⚠ THIS IS NOT A PUBLIC PROFILE, and the scope is deliberately one field.
 * No bio, no genres, no location, no links. Those belong to the industry
 * profiles (artist/venue/band/host/standup), which already have full editors.
 * The Personal profile is who you are in Messenger and in phone discovery,
 * and for now that means a picture and the name you already have.
 *
 * It exists now, ahead of the larger redesign, for one reason: phone-discovery
 * search is about to show people to each other. A search result with a blank
 * placeholder where a face should be is a bad first impression of the whole
 * feature, and the avatar is the only part of that needed to fix it.
 *
 * ⚠ THE DISPLAY NAME IS HERE BECAUSE IT MOVED, NOT BECAUSE SCOPE GREW. Tapping
 * your name in My Scene used to open a rename sheet; that tap now opens this
 * screen, so the rename had to come with it or the routing change would have
 * silently deleted an existing feature. Same upsert as before
 * (user_id + type='punter'), so nothing about how it saves changed.
 *
 * Saves immediately rather than using useProfileForm's dirty/save cycle. That
 * hook exists for multi-field forms where a Save button is the natural
 * boundary; with a single field, an upload that does not persist until you
 * find a button is just a way to lose an upload.
 */
export default function MessengerIdentityScreen() {
  const { session } = useSession();
  const userId = session?.user?.id;

  const [profileId, setProfileId] = useState(null);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingName, setSavingName] = useState(false);
  const [status, setStatus] = useState('');
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    if (!userId) { setLoading(false); return; }

    (async () => {
      // M5.5 guarantees exactly one Personal profile per account, so a null
      // here means something upstream is wrong, not that the user is unusual.
      const id = await getPersonalProfileId(userId);
      if (cancelled.current) return;
      if (!id) { setStatus("Couldn't find your Messenger profile."); setLoading(false); return; }

      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, avatar, avatar_hero, avatar_thumb')
        .eq('id', id)
        .maybeSingle();

      if (cancelled.current) return;
      if (error || !data) { setStatus("Couldn't load your details."); setLoading(false); return; }

      setProfileId(data.id);
      setName(data.name || '');
      setAvatar(data.avatar_thumb || data.avatar_hero || data.avatar || '');
      setLoading(false);
    })();

    return () => { cancelled.current = true; };
  }, [userId]);

  async function persist({ avatar_hero, avatar_thumb }) {
    if (!profileId) return;
    setStatus('');
    // All three columns, matching what the industry profile editors write, so
    // a Personal profile is not a special case for anything that reads avatars.
    const { error } = await supabase
      .from('profiles')
      .update({
        avatar: avatar_hero || null,
        avatar_hero: avatar_hero || null,
        avatar_thumb: avatar_thumb || null,
      })
      .eq('id', profileId);

    if (error) { setStatus("Couldn't save that. Try again."); return; }
    setAvatar(avatar_thumb || avatar_hero || '');
    setStatus(avatar_hero ? 'Photo saved.' : 'Photo removed.');
  }

  /**
   * The rename that moved here from My Scene. Upsert on (user_id, type) —
   * identical to what that sheet did, deliberately, so this is a relocation
   * and not a reimplementation with new failure modes.
   */
  async function saveName() {
    if (!userId || !name.trim()) return;
    setSavingName(true);
    setStatus('');
    const { error } = await supabase
      .from('profiles')
      .upsert({ user_id: userId, type: 'punter', name: name.trim() }, { onConflict: 'user_id,type' });
    setSavingName(false);
    setStatus(error ? "Couldn't save your name." : 'Name saved.');
  }

  if (loading) {
    return (
      <div style={page}>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 16px', color: 'var(--muted)' }}>
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 16px' }}>

        {/* No page-level back control — GlobalHeader already provides one on
            every route, and two back affordances on one screen is a choice the
            user has to make for no reason. */}

        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: 3,
          background: 'linear-gradient(135deg, #00E5FF, #BF5FFF)', WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent', backgroundClip: 'text', display: 'inline-block',
          marginBottom: 4 }}>
          MESSENGER AVATAR
        </div>

        <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.5, marginBottom: 20 }}>
          How you appear in Messenger and when someone finds you by number.
          This is not a public profile.
        </div>

        {profileId && (
          <AvatarUpload
            userId={userId}
            bucket="avatars"
            pathPrefix="punter_avatars"
            avatar={avatar}
            onUpload={persist}
            onRemove={() => persist({ avatar_hero: '', avatar_thumb: '' })}
          />
        )}

        <div style={{ marginTop: 24 }}>
          <label htmlFor="mi-name" style={labelStyle}>DISPLAY NAME</label>
          <input
            id="mi-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name or username"
            style={inputStyle}
          />
          <button
            type="button"
            onClick={saveName}
            disabled={savingName || !name.trim()}
            style={{ ...saveStyle, opacity: savingName || !name.trim() ? 0.5 : 1 }}
          >
            {savingName ? 'SAVING…' : 'SAVE NAME'}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 24,
          paddingTop: 18, borderTop: '1px solid var(--border)' }}>
          {/* The same component every other surface uses, so what you see here
              is literally what a search result shows. */}
          <MessengerAvatar src={avatar} size={44} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name || 'You'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              This is how you appear to others
            </div>
          </div>
        </div>

        {status && (
          <div role="status" style={{ marginTop: 14, fontSize: 12.5, color: 'var(--muted)' }}>
            {status}
          </div>
        )}
      </div>
    </div>
  );
}

const page = {
  paddingTop: 72,
  paddingBottom: 90,
  minHeight: '100dvh',
  background: 'var(--bg)',
  boxSizing: 'border-box',
};

const labelStyle = {
  display: 'block',
  fontFamily: "'Bebas Neue', sans-serif",
  fontSize: 12,
  letterSpacing: 1.5,
  color: 'var(--muted)',
  marginBottom: 6,
};

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--card2, #0f0f1a)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '12px 14px',
  color: 'var(--text)',
  fontSize: 15,
  outline: 'none',
};

const saveStyle = {
  marginTop: 10,
  background: 'linear-gradient(135deg, #00E5FF, #BF5FFF)',
  color: '#0a0a0f',
  border: 'none',
  borderRadius: 999,
  fontFamily: "'Bebas Neue', sans-serif",
  fontSize: 13,
  letterSpacing: 1.5,
  padding: '10px 20px',
  cursor: 'pointer',
};

// backStyle removed with the page-level back button — GlobalHeader owns that
// affordance on every route.
