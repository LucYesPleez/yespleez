import { useCallback, useEffect, useMemo, useState } from 'react';
import QrPreview from './QrPreview';
import QrCodeCreator from './QrCodeCreator';
import { supabase } from '../lib/supabase';
import { DESTINATIONS, SUBJECT, qrUrl, destinationAccent, posterKicker } from '../lib/qrDestinations';
import { listQrCodes, archiveQrCode, restoreQrCode, qrDisplayName } from '../lib/qrCodes';
import { exportPdf, exportPng } from '../lib/qr/qrExport';

/**
 * MY QR CODES — the dashboard section.
 *
 * ⭐⭐ A QR IS MADE ONCE AND USED FOREVER. The brief's rule is that a user must
 * never be made to regenerate the same destination, so the library is where a
 * poster is re-exported months later: every row can produce a fresh PDF or PNG
 * on the spot, built from the destination rather than from a stored file.
 *
 * ⛔ NOT A TOP-LEVEL AREA. It lives inside the dashboards, beside the events and
 * enquiries it belongs to, exactly as the brief asks. The bottom navigation is
 * permanent and is not touched.
 *
 * ── ⚠ A DEAD DESTINATION IS SHOWN, NOT HIDDEN ──────────────────────────
 *
 * If the event behind a saved QR was deleted, the row stays and says so. The
 * owner may have that code on fifty flyers; quietly dropping it from the list
 * would leave them believing the poster still works. Rendering contract:
 * absent, withheld and unknown are three different things, and this is the
 * first of them said out loud.
 */
export default function QrCodesSection({ ownedProfiles = [], userId, accent = '#00E5A0' }) {
  const [rows, setRows] = useState(null);
  const [names, setNames] = useState({});
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(null);

  const profileIds = useMemo(() => ownedProfiles.map(p => p.id), [ownedProfiles]);

  const load = useCallback(async () => {
    const list = await listQrCodes(profileIds, { includeArchived: true });
    setRows(list);

    /* Live names, so a renamed venue is not listed under its old label.
       ⚠ `null` means CONFIRMED GONE and `undefined` means not looked up — the
       two are different answers and qrDisplayName renders them differently. */
    const eventIds = list.filter(r => DESTINATIONS[r.destination_type]?.subject === SUBJECT.EVENT)
      .map(r => r.destination_id);
    const profileDestIds = list.filter(r => DESTINATIONS[r.destination_type]?.subject === SUBJECT.PROFILE)
      .map(r => r.destination_id);

    const next = {};
    if (eventIds.length) {
      const { data } = await supabase.from('events').select('id, name, config').in('id', [...new Set(eventIds)]);
      for (const id of eventIds) next[id] = (data ?? []).find(e => e.id === id) ?? null;
    }
    if (profileDestIds.length) {
      const { data } = await supabase.from('profiles').select('id, name, type').in('id', [...new Set(profileDestIds)]);
      for (const id of profileDestIds) next[id] = (data ?? []).find(p => p.id === id) ?? null;
    }
    setNames(next);
  }, [profileIds]);

  useEffect(() => { if (profileIds.length) load(); else setRows([]); }, [profileIds, load]);

  const active = (rows ?? []).filter(r => r.status === 'active');
  const archived = (rows ?? []).filter(r => r.status === 'archived');
  const shown = showArchived ? archived : active;

  return (
    <div id="section-qr-codes" style={{ marginTop: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h3 style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 2,
            margin: 0, color: 'var(--text)',
          }}>
            MY QR CODES
          </h3>
          {active.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{active.length}</span>
          )}
        </div>
        <button
          onClick={() => setCreating(true)}
          style={{
            background: accent, color: '#08080f', border: 'none', borderRadius: 9,
            padding: '7px 13px', cursor: 'pointer',
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: 1.4,
          }}
        >
          CREATE
        </button>
      </div>

      {archived.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {[false, true].map(v => (
            <button
              key={String(v)}
              onClick={() => setShowArchived(v)}
              style={{
                fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.4, padding: '4px 12px',
                borderRadius: 14, cursor: 'pointer',
                border: `1px solid ${showArchived === v ? 'rgba(255,255,255,.4)' : 'var(--border)'}`,
                background: showArchived === v ? 'rgba(255,255,255,.1)' : 'none',
                color: showArchived === v ? '#fff' : 'rgba(255,255,255,.7)',
              }}
            >
              {v ? `RETIRED ${archived.length}` : `IN USE ${active.length}`}
            </button>
          ))}
        </div>
      )}

      {rows === null && <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading.</p>}

      {rows !== null && shown.length === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
          {showArchived
            ? 'Nothing retired.'
            : 'No QR codes yet. Make one for your door, your posters or your socials, and it keeps working when the details change.'}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {shown.map(row => {
          const dest = DESTINATIONS[row.destination_type];
          const resolved = names[row.destination_id];
          const { name, state } = qrDisplayName(row, resolved);
          const url = qrUrl(row.destination_type, row.destination_id);
          const rowAccent = destinationAccent(row.destination_type);
          const spec = {
            url, title: name, kicker: posterKicker(row.destination_type), destinationType: row.destination_type,
          };

          return (
            <div
              key={row.id}
              style={{
                display: 'flex', gap: 13, alignItems: 'center',
                background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)',
                borderLeft: `3px solid ${rowAccent}`, borderRadius: 12, padding: 12,
                opacity: row.status === 'archived' ? 0.6 : 1,
              }}
            >
              <QrPreview url={url} variant="chip" size={54} />

              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.4, color: rowAccent,
                }}>
                  {(dest?.label ?? row.destination_type).toUpperCase()}
                </div>
                <div style={{
                  fontSize: 14, color: 'var(--text)', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {name}
                </div>
                {/* ⚠ The dead-destination line. Said plainly, because a printed
                    code that goes nowhere is the owner's problem to solve. */}
                {state === 'missing' && (
                  <div style={{ fontSize: 11, color: '#ff4d6d', marginTop: 2 }}>
                    This destination no longer exists. Anything printed with this code goes nowhere.
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
                <button
                  onClick={() => exportPdf(spec)}
                  style={{
                    background: 'rgba(255,255,255,.08)', border: '1px solid var(--border)',
                    borderRadius: 8, padding: '5px 10px', cursor: 'pointer', color: 'var(--text)',
                    fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.2,
                  }}
                >
                  PDF
                </button>
                <button
                  onClick={() => exportPng(spec)}
                  style={{
                    background: 'rgba(255,255,255,.08)', border: '1px solid var(--border)',
                    borderRadius: 8, padding: '5px 10px', cursor: 'pointer', color: 'var(--text)',
                    fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.2,
                  }}
                >
                  PNG
                </button>
                {/* ⛔ RETIRE, NOT DELETE, and it is labelled honestly: the code
                    on the wall is unaffected by anything pressed here. */}
                <button
                  disabled={busy === row.id}
                  onClick={async () => {
                    setBusy(row.id);
                    await (row.status === 'active' ? archiveQrCode(row.id) : restoreQrCode(row.id));
                    await load();
                    setBusy(null);
                  }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)',
                    fontSize: 10, letterSpacing: 0.6, padding: '2px 0',
                  }}
                >
                  {row.status === 'active' ? 'Retire' : 'Restore'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {creating && (
        <QrCodeCreator
          ownedProfiles={ownedProfiles}
          userId={userId}
          onClose={() => setCreating(false)}
          onSaved={() => load()}
        />
      )}
    </div>
  );
}
