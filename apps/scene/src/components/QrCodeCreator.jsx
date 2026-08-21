import { useEffect, useMemo, useState } from 'react';
import QrPreview from './QrPreview';
import {
  DESTINATIONS, SUBJECT, qrUrl, destinationsForOwner, destinationAccent, posterKicker,
} from '../lib/qrDestinations';
import { selectableEvents, selectableProfiles, saveQrCode } from '../lib/qrCodes';
import { exportPng, exportPdf, exportCodeOnlyPng, copyQrLink } from '../lib/qr/qrExport';
import { PAGE_SIZES, DEFAULT_PAGE } from '../lib/qr/qrPdf';
import { formatDisplayDate } from '../lib/dates';
import { getOwnerProfiles } from '../lib/actingProfile';

/* ⚠ A stable identity. A fresh `[]` each render would restart every effect
   keyed on the profile list, refetching events forever. */
const EMPTY = Object.freeze([]);

/**
 * CREATE QR CODE — one generator, every destination.
 *
 * ⭐⭐ THERE IS NO "EVENT QR FEATURE". The brief is explicit that this must not
 * be built as one, and the shape of this component is the answer: it asks WHAT
 * DO YOU WANT THIS TO OPEN, reads the answer out of `lib/qrDestinations`, and
 * has no branch anywhere on `event` or `venue`. A new destination type appears
 * in this sheet by being added to that registry, ⛔ never by editing this file.
 *
 * ── ⛔ THE MENU IS DERIVED, NEVER HARD-CODED ────────────────────────────
 *
 * A venue sees Venue and What's On; a promoter does not see Venue because they
 * have no venue page to point at. Both come from `destinationsForOwner`, which
 * is given what this account actually holds. ⚠ It is a MENU, not a permission:
 * every destination is a public page and RLS decides what may be saved.
 *
 * ── ⚠ THE PREVIEW IS THE PROOF ─────────────────────────────────────────
 *
 * `QrPreview` draws the same symbol and the same strings the PDF prints, so
 * nobody approves one poster and prints another.
 */

const btn = (accent, filled) => ({
  flex: 1, padding: '11px 14px', borderRadius: 10, cursor: 'pointer',
  fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: 1.6,
  border: `1px solid ${filled ? accent : 'var(--border)'}`,
  background: filled ? accent : 'transparent',
  color: filled ? '#08080f' : 'var(--text)',
});

export default function QrCodeCreator({
  /** Omit and the sheet resolves them itself — the event page has a session
   *  but no reason to have loaded a profile list. ⛔ Still `getOwnerProfiles`,
   *  never a second resolver. */
  ownedProfiles: ownedProfilesProp,
  userId,
  /** Pre-select a destination, for the entry inside an event's manage menu. */
  initial = null,
  onClose,
  onSaved,
}) {
  const [type, setType] = useState(initial?.destinationType ?? null);
  const [entity, setEntity] = useState(null);
  const [events, setEvents] = useState(null);
  const [profiles, setProfiles] = useState(null);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [fetchedProfiles, setFetchedProfiles] = useState(null);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE);

  useEffect(() => {
    if (ownedProfilesProp || !userId) return undefined;
    let cancelled = false;
    getOwnerProfiles(userId).then(list => { if (!cancelled) setFetchedProfiles(list || []); });
    return () => { cancelled = true; };
  }, [ownedProfilesProp, userId]);

  const ownedProfiles = ownedProfilesProp ?? fetchedProfiles ?? EMPTY;
  const profileIds = useMemo(() => ownedProfiles.map(p => p.id), [ownedProfiles]);

  /* Events are loaded once: they decide whether Event and Set Times are even
     offered, and they are the artist selector's authorisation basis. */
  useEffect(() => {
    let cancelled = false;
    selectableEvents({ userId, profileIds }).then(list => {
      if (!cancelled) setEvents(list);
    });
    return () => { cancelled = true; };
  }, [userId, profileIds]);

  const dest = type ? DESTINATIONS[type] : null;

  useEffect(() => {
    let cancelled = false;
    if (!dest || dest.subject !== SUBJECT.PROFILE) { setProfiles(null); return undefined; }
    setProfiles(null);
    selectableProfiles(type, { ownedProfiles, eventIds: (events ?? []).map(e => e.id) })
      .then(list => { if (!cancelled) setProfiles(list); });
    return () => { cancelled = true; };
  }, [type, dest, ownedProfiles, events]);

  /* ⚠ Held back until events have loaded. Offering Event and Set Times, then
     removing them a moment later, is worse than a beat of nothing. */
  const menu = events === null ? null : destinationsForOwner({
    ownedProfiles,
    manageableEventCount: events.length,
    bookedArtistCount: events.length ? 1 : 0,
  });

  /* Resolve a pre-selected destination once its list arrives. */
  useEffect(() => {
    if (!initial?.destinationId || entity) return;
    const pool = dest?.subject === SUBJECT.EVENT ? events : profiles;
    const hit = (pool ?? []).find(x => x.id === initial.destinationId);
    if (hit) setEntity(hit);
  }, [initial, entity, dest, events, profiles]);

  const url = entity ? qrUrl(type, entity.id) : null;
  const accent = type ? destinationAccent(type) : '#00E5A0';

  const title = entity?.name || '';
  const context = dest?.subject === SUBJECT.EVENT && entity?.config?.date
    ? formatDisplayDate(entity.config.date)
    : '';

  const spec = url ? {
    url, title, kicker: posterKicker(type, context), destinationType: type, pageSize,
  } : null;

  async function handleSave() {
    if (!spec || !entity) return;
    setSaving(true);
    setError(null);
    /* ⭐ The row belongs to a PROFILE. For a profile destination that is the
       profile itself where you own it; otherwise the dashboard you are standing
       on. ⛔ Never the active profile: that is UX state, not authority. */
    const ownerProfileId = ownedProfiles.find(p => p.id === entity.id)?.id
      ?? entity.owner_profile_id
      ?? profileIds[0];

    const out = await saveQrCode({
      ownerProfileId,
      destinationType: type,
      destinationId: entity.id,
      label: title,
      userId,
    });
    setSaving(false);
    if (!out.ok) { setError(out.error); return; }
    setSaved(out);
    onSaved?.(out.row);
  }

  const list = dest?.subject === SUBJECT.EVENT ? events : profiles;
  const filtered = (list ?? []).filter(x =>
    !search.trim() || String(x.name || '').toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div
      role="dialog"
      aria-label="Create QR code"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.82)', zIndex: 2000,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        paddingBottom: 'var(--yp-safe-bottom)',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#0f0f1a', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480,
          maxHeight: '88vh', display: 'flex', flexDirection: 'column',
          border: '1px solid rgba(255,255,255,.07)', borderBottom: 'none',
          boxShadow: '0 -4px 40px rgba(0,0,0,.6)',
        }}
      >
        <div style={{
          padding: '16px 20px 12px', borderBottom: '1px solid rgba(255,255,255,.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 20, letterSpacing: 2 }}>CREATE QR CODE</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {!type ? 'What do you want this QR to open?'
                : !entity ? dest.blurb
                  : dest.label}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 26, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}
          >
            ×
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: '14px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* ── 1 · what should it open ─────────────────────────────── */}
          {!type && (
            menu === null
              ? <div style={{ color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>Loading your destinations.</div>
              : menu.length === 0
                /* ⚠ An honest empty state. A brand new promoter with no events
                   and no venue page genuinely has nothing to point at yet, and
                   saying why beats an empty list. */
                ? (
                  <div style={{ color: 'var(--muted)', fontSize: 13, padding: '12px 0', lineHeight: 1.6 }}>
                    There is nothing to point a QR code at yet. Create an event, or finish setting up
                    your venue or promoter profile, and the destinations will appear here.
                  </div>
                )
                : menu.map(d => (
                  <button
                    key={d.key}
                    onClick={() => { setType(d.key); setEntity(null); setSearch(''); }}
                    style={{
                      display: 'flex', flexDirection: 'column', gap: 3, textAlign: 'left',
                      background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)',
                      borderLeft: `3px solid ${destinationAccent(d.key)}`,
                      borderRadius: 12, padding: '13px 16px', cursor: 'pointer', width: '100%',
                    }}
                  >
                    <span style={{ fontFamily: "'Bebas Neue'", fontSize: 17, letterSpacing: 1.4, color: 'var(--text)' }}>
                      {d.label.toUpperCase()}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>{d.blurb}</span>
                  </button>
                ))
          )}

          {/* ── 2 · which one ───────────────────────────────────────── */}
          {type && !entity && (
            <>
              <button
                onClick={() => setType(null)}
                style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: accent, fontSize: 12, cursor: 'pointer', padding: 0 }}
              >
                ‹ Change destination
              </button>

              {list === null && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading.</div>}

              {list !== null && list.length > 6 && (
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={`Search ${dest.subject === SUBJECT.EVENT ? 'events' : 'profiles'}`}
                  style={{
                    background: 'rgba(255,255,255,.05)', border: '1px solid var(--border)',
                    borderRadius: 10, padding: '10px 12px', color: 'var(--text)',
                    fontFamily: 'inherit', fontSize: 14,
                  }}
                />
              )}

              {list !== null && filtered.length === 0 && (
                <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
                  {list.length === 0
                    ? `You have nothing to point a ${dest.label} QR at yet.`
                    : 'Nothing matches that search.'}
                </div>
              )}

              {filtered.map(x => (
                <button
                  key={x.id}
                  onClick={() => setEntity(x)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                    background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)',
                    borderRadius: 10, padding: '12px 14px', cursor: 'pointer', width: '100%',
                    textAlign: 'left', color: 'var(--text)', fontFamily: 'inherit', fontSize: 14,
                  }}
                >
                  <span>{x.name || 'Untitled'}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
                    {x.config?.date ? formatDisplayDate(x.config.date) : (x.type || '')}
                  </span>
                </button>
              ))}
            </>
          )}

          {/* ── 3 · preview and export ──────────────────────────────── */}
          {type && entity && (
            <>
              <button
                onClick={() => { setEntity(null); setSaved(null); }}
                style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: accent, fontSize: 12, cursor: 'pointer', padding: 0 }}
              >
                ‹ Choose something else
              </button>

              <QrPreview
                url={url}
                title={title}
                kicker={posterKicker(type, context)}
                pageSize={pageSize}
              />

              {/* ⭐ PAPER SIZE, not "poster style". The design is one template at
                  three sizes — every measurement is a fraction of the page, so
                  A5 and A3 are the same poster, not three tuned layouts.
                  ⚠ A3 is the default: this is a thing that goes on a wall. */}
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, letterSpacing: 0.4 }}>
                  Paper size
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {Object.keys(PAGE_SIZES).map(key => (
                    <button
                      key={key}
                      onClick={() => setPageSize(key)}
                      style={{
                        ...btn(accent, pageSize === key),
                        padding: '8px 0',
                      }}
                    >
                      {key}
                    </button>
                  ))}
                </div>
              </div>

              {error && <div style={{ color: '#ff4d6d', fontSize: 12 }}>{error}</div>}

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleSave} disabled={saving || !!saved} style={{ ...btn(accent, true), opacity: saved ? 0.6 : 1 }}>
                  {saved ? (saved.reused ? 'ALREADY SAVED' : 'SAVED') : (saving ? 'SAVING' : 'SAVE TO MY QR CODES')}
                </button>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => exportPdf(spec)} style={btn(accent, false)}>DOWNLOAD PDF</button>
                <button onClick={() => exportPng(spec)} style={btn(accent, false)}>DOWNLOAD PNG</button>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                {/* ⭐ A different job from the poster: the bare symbol, for
                    somebody laying out their own flyer. */}
                <button onClick={() => exportCodeOnlyPng(spec)} style={{ ...btn(accent, false), fontSize: 12 }}>
                  JUST THE CODE
                </button>
              </div>

              <button
                onClick={async () => { setCopied(await copyQrLink(url)); setTimeout(() => setCopied(false), 1800); }}
                style={{ ...btn(accent, false), flex: 'none' }}
              >
                {copied ? 'LINK COPIED' : 'COPY LINK'}
              </button>

              {/* ⭐ The permanence promise, said plainly where the decision is
                  made. It is the reason to print this rather than a link. */}
              <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
                {type === 'set-times'
                  ? 'Print this once. It keeps working when the running order changes.'
                  : type === 'whats-on'
                    ? 'Print this once and leave it up. It always shows your current upcoming events.'
                    : 'This code keeps working when the details change.'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
