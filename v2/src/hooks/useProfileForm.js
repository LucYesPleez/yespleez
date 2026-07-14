import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

export function useProfileForm() {
  const navigate = useNavigate();

  const [avatarUrl,   setAvatarUrl]   = useState('');
  const [avatarHero,  setAvatarHero]  = useState('');
  const [avatarThumb, setAvatarThumb] = useState('');
  const [naFields,    setNaFields]    = useState(new Set());
  const [isDirty,     setIsDirty]     = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [saveErr,     setSaveErr]     = useState('');
  const [showPostcodePrompt, setShowPostcodePrompt] = useState(false);

  // Guard browser tab close / refresh when dirty
  useEffect(() => {
    if (!isDirty) return;
    const handler = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // useBlocker requires a data router (createBrowserRouter/createHashRouter).
  // This app uses <HashRouter> (component-based), so SPA nav blocking is unavailable.
  // beforeunload above handles the browser close case.
  const blocker = null;

  const handleAvatarUpload = useCallback(({ avatar_hero, avatar_thumb }) => {
    setAvatarHero(avatar_hero);
    setAvatarThumb(avatar_thumb);
    setAvatarUrl(avatar_hero);
    setIsDirty(true);
  }, []);

  const handleAvatarRemove = useCallback(() => {
    setAvatarUrl('');
    setAvatarHero('');
    setAvatarThumb('');
    setIsDirty(true);
  }, []);

  function toggleNa(field) {
    setNaFields(prev => {
      const next = new Set(prev);
      if (next.has(field)) { next.delete(field); } else { next.add(field); }
      return next;
    });
    setIsDirty(true);
  }

  // Call during data load to populate naSet; after all calls, pass naSet to setNaFields
  function loadNa(val, setter, key, naSet) {
    if (val === 'N/A') { naSet.add(key); setter(''); }
    else setter(val || '');
  }

  // Wraps the async save operation with saving/saved/saveErr state management
  const runSave = useCallback(async (asyncFn, navigateTo, timeout = 800) => {
    setSaving(true);
    setSaveErr('');
    try {
      await asyncFn();
      setSaved(true);
      setIsDirty(false);
      setTimeout(() => { setSaved(false); navigate(navigateTo); }, timeout);
    } catch (err) {
      setSaveErr('Save failed: ' + (err.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  }, [navigate]);

  return {
    avatarUrl,   setAvatarUrl,
    avatarHero,  setAvatarHero,
    avatarThumb, setAvatarThumb,
    handleAvatarUpload, handleAvatarRemove,
    naFields, setNaFields, toggleNa, loadNa,
    isDirty, setIsDirty,
    markDirty: () => setIsDirty(true),
    blocker,
    showPostcodePrompt, setShowPostcodePrompt,
    saving, setSaving,
    saved, setSaved,
    saveErr, setSaveErr,
    runSave,
  };
}
