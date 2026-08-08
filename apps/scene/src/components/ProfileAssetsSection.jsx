import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { PROFILE_ASSET_TYPES, isMulti } from '../lib/profileAssets';
import { listAssets, uploadAsset, deleteAsset, assetUrl, validateAssetFile } from '../lib/profileAssetStore';

/**
 * PROFESSIONAL ASSETS — the reusable document library.
 * Design: docs/professional-profile-requirements-engine-design-2026-08.md
 *
 * Upload a press kit once; every future opportunity that asks for one
 * references it. This is the section that ends re-uploading the same four
 * files into every festival's form.
 *
 * ⚠ LIVES IN THE PROFILE EDITOR, NOT THE DASHBOARD (owner, 2026-08-02).
 * Assets are part of the profile you are editing, not a dashboard widget —
 * they sit alongside bio and socials because that is what they are: reusable
 * profile content. The dashboard shows what is HAPPENING; the editor is where
 * you say who you are.
 *
 * ── THREE RULES THIS UI MUST NOT BREAK ───────────────────────────────
 *
 * 1. NO ENGINE WORDS ON SCREEN. The engine's states are `absent` / `withheld`
 *    / `satisfied`; the reader sees "Not provided" and a filename. If
 *    "withheld" or "absent" ever appears in this file, that is the bug.
 * 2. EVERY TYPE IS LISTED, INCLUDING THE EMPTY ONES. This is the applicant's
 *    private view of their own dossier and its job is to show what is missing —
 *    the Rendering Contract's R3/R5 (no placeholders, no visual holes) govern
 *    PUBLIC surfaces and are deliberately not in force here. Hiding the empty
 *    rows would destroy the feature: you cannot upload what you cannot see.
 * 3. A PROFILE THAT DOES NOT EXIST YET CANNOT HOLD FILES. Assets are keyed on
 *    profile id, and a first-time editor has none until Save. Saying so is the
 *    honest move; rendering nine upload buttons that would each fail is not.
 */
/** Rows shown while minimised. Press Kit, Stage Plot, Tech Rider — the three a
 *  venue asks for most often, and the reason the registry is in this order. */
const VISIBLE_WHEN_CLOSED = 3;

export default function ProfileAssetsSection({
  userId,
  profileId: profileIdProp,
  profileType,
  accent     = '#00E5FF',
  accent2    = '#FF3399',
  accentRgb,
  showHeader = true,
  // The editors each own their section-heading styling (4 share one CSS module,
  // Host has its own), so the classes come in rather than being guessed at.
  titleClassName,
  titleStyle,
  gradientTitle = false,   // venue renders heading text as a gradient, not white
  defaultOpen   = false,   // minimised by default — nine rows is a lot of editor
  sectionId,
}) {
  const [open, setOpen] = useState(defaultOpen);
  // Resolve the profile ourselves when the caller has not got one to hand. The
  // five editors each load their own row but none of them keep the id, and
  // threading new state through all five to pass it down would be a bigger
  // change to stable screens than one small query.
  const [resolvedId, setResolvedId] = useState(profileIdProp ?? null);
  const [assets,  setAssets]  = useState(null);   // null = still loading
  const [busyKey, setBusyKey] = useState(null);
  const [err,     setErr]     = useState('');

  useEffect(() => {
    if (profileIdProp) { setResolvedId(profileIdProp); return; }
    if (!userId || !profileType) { setResolvedId(null); return; }
    let cancelled = false;
    supabase.from('profiles').select('id').eq('user_id', userId).eq('type', profileType).maybeSingle()
      .then(({ data }) => { if (!cancelled) setResolvedId(data?.id ?? null); });
    return () => { cancelled = true; };
  }, [profileIdProp, userId, profileType]);

  const profileId = profileIdProp ?? resolvedId;
  const rgb = accentRgb || hexToRgb(accent);

  const load = useCallback(async () => {
    if (!profileId) { setAssets([]); return; }
    try {
      setAssets(await listAssets(profileId));
    } catch {
      // A failed load is not an empty library — say so rather than showing a
      // clean "nothing here", which would invite a duplicate re-upload.
      setAssets([]);
      setErr('Could not load your assets. Check your connection and try again.');
    }
  }, [profileId]);

  useEffect(() => { load(); }, [load]);

  async function onPick(typeKey, file) {
    if (!file) return;
    const invalid = validateAssetFile(file);
    if (invalid) { setErr(invalid); return; }
    setErr('');
    setBusyKey(typeKey);
    try {
      await uploadAsset({ userId, profileId, assetTypeKey: typeKey, file });
      await load();
    } catch (e) {
      setErr(e?.message || 'Upload failed.');
    } finally {
      setBusyKey(null);
    }
  }

  async function onRemove(asset) {
    setBusyKey(asset.asset_type);
    try {
      await deleteAsset(asset);
      await load();
    } catch (e) {
      setErr(e?.message || 'Could not remove that file.');
    } finally {
      setBusyKey(null);
    }
  }

  const held = assets || [];
  const filledTypes = new Set(held.map(a => a.asset_type));

  const total = PROFILE_ASSET_TYPES.length;
  const ready = !profileId && assets !== null;

  // How many of the hidden types already hold a file. Surfaced on the "more"
  // row so a collapsed section never hides the fact that something IS there —
  // otherwise a profile with a rider and insurance looks empty until opened.
  const heldBeyondPreview = PROFILE_ASSET_TYPES
    .slice(VISIBLE_WHEN_CLOSED)
    .filter(t => filledTypes.has(t.key)).length;

  const header = showHeader && (
    <Header
      count={ready ? null : filledTypes.size}
      total={total}
      open={open}
      onToggle={() => setOpen(o => !o)}
      accent={accent}
      accent2={accent2}
      titleClassName={titleClassName}
      titleStyle={titleStyle}
      gradientTitle={gradientTitle}
    />
  );

  // Rule 3 — nothing to attach files to yet.
  if (ready) {
    return (
      <div id={sectionId}>
        {header}
        {open && (
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
            Save your profile first — then you can add a press kit, stage plot, rider and more, once,
            and reuse them for every booking.
          </p>
        )}
      </div>
    );
  }

  return (
    <div id={sectionId}>
      {header}

      {err && <div style={{ fontSize: 12, color: '#FFB830', marginBottom: 10 }}>{err}</div>}

      {/* Minimised shows the first three REAL rows — the three a venue asks for
          most often — so the common case needs no expanding at all. The fourth
          row opens the rest. A preview that is only labels would make the
          section something to get past; three working rows make it usable
          closed. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(open ? PROFILE_ASSET_TYPES : PROFILE_ASSET_TYPES.slice(0, VISIBLE_WHEN_CLOSED)).map(t => (
          <AssetRow
            key={t.key}
            type={t}
            files={held.filter(a => a.asset_type === t.key)}
            loading={assets === null}
            busy={busyKey === t.key}
            accent={accent}
            accentRgb={rgb}
            onPick={f => onPick(t.key, f)}
            onRemove={onRemove}
          />
        ))}

        {!open && (
          <MoreRow
            remaining={total - VISIBLE_WHEN_CLOSED}
            heldRemaining={heldBeyondPreview}
            accent={accent}
            accent2={accent2}
            onClick={() => setOpen(true)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The section heading, doubling as the disclosure control.
 *
 * Styling comes from the host editor (`titleClassName` / `titleStyle`) and the
 * gradient underline is rebuilt here the same way SectionBlock does it, so this
 * heading sits flush with WHO YOU ARE, YOUR SOUND and the rest rather than
 * looking like a component that wandered in.
 */
function Header({ count, total, open, onToggle, accent, accent2, titleClassName, titleStyle, gradientTitle }) {
  const [hov, setHov] = useState(false);

  const label = (
    <span style={gradientTitle
      ? { background: `linear-gradient(135deg, ${accent} 40%, ${accent2} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }
      : undefined}
    >ASSETS</span>
  );

  // ⚠ EVERY CHILD MUST RESET WebkitTextFillColor.
  // The editors' heading style (EXPERIMENTAL_HEADING_STYLE / SECTION_TITLE_STYLE)
  // paints the title as gradient text — `background-clip: text` plus
  // `-webkit-text-fill-color: transparent`. Both INHERIT, so a child that only
  // sets `color` renders completely invisible while still being present in the
  // DOM. That is exactly how the 0/9 count shipped unseen: it read correctly in
  // the accessibility tree and could not be seen on screen.
  const readable = c => ({ color: c, WebkitTextFillColor: c, background: 'none' });

  return (
    <div
      className={titleClassName}
      onClick={onToggle}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      aria-expanded={open}
      style={{
        borderImage: `linear-gradient(90deg, ${accent}, ${accent2}) 1`,
        ...titleStyle,
        display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
      }}
    >
      {label}
      {count !== null && (
        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1, ...readable('var(--muted)') }}>
          {count}/{total}
        </span>
      )}
      {/* The app's canonical disclosure control — same wording and styling as
          AvailabilitySection's VIEW ALL, rather than a bare chevron. */}
      <span
        style={{
          marginLeft: 'auto', fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1,
          opacity: hov ? 1 : 0.5, transition: 'color .15s, opacity .15s',
          ...readable(hov ? 'var(--text)' : 'var(--muted)'),
        }}
      >
        {open ? 'VIEW LESS' : 'VIEW ALL >'}
      </span>
    </div>
  );
}

/**
 * The fourth row — the app's VIEW MORE button at half height.
 *
 * Same construction as DiscoverScreen's `.viewMore` (gradient border via the
 * padding-box/border-box trick, gradient text), so it reads as the control the
 * rest of the app already uses. Two differences on purpose: `padding: 6px`
 * rather than 12px, which is the half height asked for; and the gradient comes
 * from the profile type's own accent pair instead of Discover's fixed
 * cyan→purple, so it belongs to the editor it sits in.
 *
 * It still reports how many hidden types already hold a file — a collapsed
 * section that quietly hid a completed rider would be lying by omission.
 */
function MoreRow({ remaining, heldRemaining, accent, accent2, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        // 3px padding + 14px Bebas ≈ 24px tall, against DiscoverScreen's
        // `.viewMore` at 12px padding + 16px Bebas ≈ 45px. Half, near enough.
        display: 'block', width: '100%', padding: 3, borderRadius: 10, lineHeight: 1.25,
        background: `linear-gradient(var(--card, #12122a), var(--card, #12122a)) padding-box,
                     linear-gradient(135deg, ${accent}, ${accent2}) border-box`,
        border: '1px solid transparent',
        cursor: 'pointer', opacity: hov ? 0.8 : 1, transition: 'opacity .15s',
      }}
    >
      <span style={{
        fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: 2,
        background: `linear-gradient(135deg, ${accent}, ${accent2})`,
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
      }}>
        MORE
        <span style={{ letterSpacing: 1 }}>
          {' '}· {remaining}{heldRemaining > 0 ? ` · ${heldRemaining} PROVIDED` : ''}
        </span>
      </span>
    </button>
  );
}

function AssetRow({ type, files, loading, busy, accent, accentRgb, onPick, onRemove }) {
  const inputRef = useRef(null);
  const [hov, setHov] = useState(false);
  const has = files.length > 0;
  const multi = isMulti(type.key);

  async function view(asset) {
    const url = await assetUrl(asset.storage_path);
    // Signed URLs are short-lived and single-purpose; opening in a new tab is
    // the whole interaction. A null url means signing failed — do nothing
    // rather than navigating to a dead link.
    if (url && typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
  }

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px', borderRadius: 8,
        background: 'var(--card2)',
        border: `1px solid ${has ? `rgba(${accentRgb},.35)` : 'var(--border)'}`,
        transition: 'border-color .15s',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.2, color: has ? accent : 'var(--text)' }}>
          {type.label}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {loading
            ? '…'
            : has
              ? files.map(f => f.file_name).join(' · ')
              /* Plain language — never the engine's word for it. */
              : 'Not provided'}
        </div>
      </div>

      {has && <RowBtn label="VIEW" onClick={() => view(files[0])} accent={accent} />}
      {has && <RowBtn label="REMOVE" onClick={() => onRemove(files[0])} accent="var(--muted)" disabled={busy} />}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; onPick(f); }}
      />
      <RowBtn
        label={busy ? '…' : has && !multi ? 'REPLACE' : has ? 'ADD' : 'UPLOAD'}
        onClick={() => inputRef.current?.click()}
        accent={hov ? accent : 'var(--muted)'}
        disabled={busy}
      />
    </div>
  );
}

function RowBtn({ label, onClick, accent, disabled }) {
  return (
    <button
      type="button"          /* inside a <form> in the editors — must not submit */
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1,
        color: accent, background: 'none', border: 'none',
        cursor: disabled ? 'default' : 'pointer', padding: '2px 4px',
        opacity: disabled ? 0.4 : 1, flexShrink: 0, transition: 'color .15s, opacity .15s',
      }}
    >{label}</button>
  );
}

/** "#00E5FF" -> "0,229,255". Local so a caller only has to pass one colour. */
function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  if (h.length !== 6) return '0,229,255';
  return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`;
}
