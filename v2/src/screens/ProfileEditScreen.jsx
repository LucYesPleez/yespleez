import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import s from './ProfileEditScreen.module.css';
import { profileIdentity } from '../lib/profileTypes';
import { STATE_OPTIONS } from '../lib/auLocations';

// Screen-specific display flags — not shared metadata, stays local
const PROFILE_FLAGS = {
  artist:  { showMix: true,  showSound: true  },
  host:    { showMix: false, showSound: false },
  band:    { showMix: true,  showSound: true  },
  standup: { showMix: false, showSound: true  },
  venue:   { showMix: false, showSound: false },
};


export default function ProfileEditScreen() {
  const [params] = useSearchParams();
  const { session } = useSession();
  const userId = session?.user?.id;

  const [profiles, setProfiles]   = useState([]);
  const [activeType, setActiveType] = useState(params.get('type') || null);
  const [form, setForm]           = useState({});
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    supabase.from('profiles').select('*').eq('user_id', userId).neq('type', 'punter')
      .then(({ data }) => {
        const profs = data || [];
        setProfiles(profs);
        const type = params.get('type') || profs[0]?.type || 'artist';
        setActiveType(type);
        const existing = profs.find(p => p.type === type) || {};
        setForm(existing);
        setLoading(false);
      });
  }, [userId]);

  function switchType(type) {
    setActiveType(type);
    const existing = profiles.find(p => p.type === type) || {};
    setForm(existing);
    setSaved(false);
    setSaveErr('');
  }

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }));
  }

  async function save() {
    if (!userId || saving) return;
    setSaving(true);
    setSaveErr('');
    // Strip DB-managed fields that shouldn't be in the upsert payload
    const { id, created_at, updated_at, ...rest } = form;
    const payload = { ...rest, user_id: userId, type: activeType };
    // If updating existing row, include the id so Supabase matches by PK
    if (id) payload.id = id;
    const { error } = await supabase.from('profiles')
      .upsert(payload, { onConflict: 'user_id,type' });
    if (error) {
      setSaveErr('Save failed — ' + (error.message || 'unknown error'));
    } else {
      setProfiles(prev => {
        const without = prev.filter(p => p.type !== activeType);
        return [...without, { ...payload, id }];
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  }

  if (loading) return <div className={s.screen}><p className={s.loading}>LOADING…</p></div>;

  // The last two copies of 10F's hand-written fallback. `activeType` is always
  // one of the account's own Scene roles here, so this never fired in practice
  // — but the pattern is the thing being removed, not one of its outcomes.
  // PROFILE_FLAGS keeps its own default: that map is about which FIELDS an
  // editor shows, not about identity, and it has no neutral member to fall to.
  const pt    = profileIdentity(activeType);
  const flags = PROFILE_FLAGS[activeType] || PROFILE_FLAGS.artist;

  return (
    <div className={s.screen}>
      <div className={s.topRow}>
        <h1 className={s.title}>EDIT PROFILE</h1>
        <button className={s.saveBtn} onClick={save} disabled={saving} style={{ color: pt.accent, borderColor: pt.accent }}>
          {saving ? '…' : saved ? '✓ SAVED' : 'SAVE'}
        </button>
      </div>

      {/* Role tabs */}
      {profiles.length > 1 && (
        <div className={s.typeTabs}>
          {profiles.map(p => {
            const ppt = profileIdentity(p.type);
            return (
              <button key={p.type}
                className={activeType === p.type ? s.typeTabActive : s.typeTab}
                style={activeType === p.type ? { borderColor: ppt.accent, color: ppt.accent } : {}}
                onClick={() => switchType(p.type)}
              >
                {ppt.label}
              </button>
            );
          })}
        </div>
      )}

      <div className={s.form}>
        {/* Avatar */}
        <div className={s.avatarSection}>
          <div className={s.avatarPreview} style={{ borderColor: pt.accent }}>
            {form.avatar
              ? <img src={form.avatar} alt="avatar" className={s.avatarImg} />
              : <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={pt.accent} strokeWidth="1.5"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
            }
          </div>
          <div className={s.avatarInputWrap}>
            <label className={s.fieldLabel}>AVATAR URL</label>
            <input className={s.input} value={form.avatar || ''} onChange={e => set('avatar', e.target.value)} placeholder="https://…" />
          </div>
        </div>

        {/* Live / Draft toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: form.is_live === false ? 'rgba(255,255,255,.04)' : 'rgba(0,229,255,.06)', border: `1px solid ${form.is_live === false ? 'rgba(255,255,255,.1)' : 'rgba(0,229,255,.25)'}`, borderRadius: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, color: form.is_live === false ? 'var(--muted)' : 'var(--neon2)' }}>
              {form.is_live === false ? 'DRAFT — NOT VISIBLE TO PUBLIC' : 'LIVE — VISIBLE TO PUBLIC'}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: 2 }}>
              {form.is_live === false ? 'Only you can see this profile.' : 'Appears in search and Discover.'}
            </div>
          </div>
          <button
            onClick={() => set('is_live', form.is_live === false ? true : false)}
            style={{ flexShrink: 0, width: 44, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer', position: 'relative', background: form.is_live === false ? 'rgba(255,255,255,.15)' : 'var(--neon2)', transition: 'background .2s' }}
          >
            <div style={{ position: 'absolute', top: 3, left: form.is_live === false ? 3 : 21, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
          </button>
        </div>

        <Field label="NAME *" value={form.name || ''} onChange={v => set('name', v)} placeholder="Your name or stage name" />
        <Field label="TAGLINE" value={form.tagline || ''} onChange={v => set('tagline', v)} placeholder="One-liner that describes you" />
        {flags.showSound && <Field label="SOUND / VIBE" value={form.sound || ''} onChange={v => set('sound', v)} placeholder="e.g. Deep rolling bass, hypnotic rhythms" />}

        <Field label="GENRES" value={form.genre_string || ''} onChange={v => set('genre_string', v)} placeholder="e.g. Techno · House · Drum & Bass" />

        <Field label="BIO" value={form.bio || ''} onChange={v => set('bio', v)} placeholder="Tell your story…" multiline />

        <div className={s.row}>
          <div style={{ flex: 1 }}>
            <Field label="LOCATION / CITY" value={form.location || ''} onChange={v => set('location', v)} placeholder="e.g. Byron Bay" />
          </div>
          <div style={{ width: 110 }}>
            <label className={s.fieldLabel}>STATE</label>
            <select className={s.select} value={form.state || ''} onChange={e => set('state', e.target.value)}>
              <option value="">—</option>
              {STATE_OPTIONS.map(st => <option key={st} value={st}>{st}</option>)}
            </select>
          </div>
        </div>

        {(activeType === 'artist' || activeType === 'band') && (
          <Field label="YEARS ACTIVE" value={form.years || ''} onChange={v => set('years', v)} placeholder="e.g. 2018" />
        )}

        {flags.showMix && <Field label="MIX / DEMO LINK" value={form.mix_link || ''} onChange={v => set('mix_link', v)} placeholder="SoundCloud, Mixcloud, YouTube link…" />}

        <div className={s.sectionDivider}>SOCIALS</div>
        <Field label="INSTAGRAM" value={form.instagram || ''} onChange={v => set('instagram', v)} placeholder="@handle" />
        <Field label="FACEBOOK" value={form.facebook || ''} onChange={v => set('facebook', v)} placeholder="https://facebook.com/…" />
        <Field label="SOUNDCLOUD" value={form.soundcloud || ''} onChange={v => set('soundcloud', v)} placeholder="https://soundcloud.com/…" />
        <Field label="MIXCLOUD" value={form.mixcloud || ''} onChange={v => set('mixcloud', v)} placeholder="https://mixcloud.com/…" />
        <Field label="YOUTUBE" value={form.youtube || ''} onChange={v => set('youtube', v)} placeholder="https://youtube.com/…" />
        <Field label="WEBSITE" value={form.website || ''} onChange={v => set('website', v)} placeholder="https://…" />

        {saveErr && <p style={{ color: 'var(--red, #FF2D78)', fontSize: 12, textAlign: 'center', marginBottom: 8 }}>{saveErr}</p>}
        <button className={s.saveBtnBottom} onClick={save} disabled={saving} style={{ background: pt.accent }}>
          {saving ? 'SAVING…' : saved ? '✓ SAVED!' : 'SAVE PROFILE'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, multiline, hint }) {
  return (
    <div className={s.field}>
      <label className={s.fieldLabel}>{label}</label>
      {multiline
        ? <textarea className={s.textarea} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={4} />
        : <input className={s.input} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      }
      {hint && <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, marginBottom: 0 }}>{hint}</p>}
    </div>
  );
}
