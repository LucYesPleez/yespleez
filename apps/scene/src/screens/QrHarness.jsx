import { useState } from 'react';
import QrPreview from '../components/QrPreview';
import QrCodeCreator from '../components/QrCodeCreator';
import QrCodesSection from '../components/QrCodesSection';
import { DESTINATIONS, DESTINATION_KEYS, qrUrl, posterKicker } from '../lib/qrDestinations';
import { exportPdf, exportPng } from '../lib/qr/qrExport';

/**
 * DEV ONLY — the QR surfaces, where they can be looked at.
 *
 * Route: `/#/dev/qr`. Not linked from anywhere, and tree-shaken out of the
 * production bundle by the `import.meta.env.DEV` guard on its <Route>.
 *
 * ⭐⭐ WHY THIS EXISTS, and it is the same reason `ScheduleHarness` does: every
 * live QR surface sits behind a venue or host dashboard, so the only way to
 * look at the generator is to be signed in as somebody who owns one. That makes
 * the whole feature unreviewable for anyone else, including whoever picks this
 * up next.
 *
 * ⚠ The proofs below are FIXTURES and are labelled as such. The saved-library
 * section is the real component against the real table, so signed out it shows
 * its own empty state — which is itself worth seeing.
 */

const FIXTURES = [
  { type: 'event', id: '55512cb8-72e8-446c-9fff-f195d7e002c3', title: 'Solstice Soirée', context: '20 June 2026' },
  { type: 'set-times', id: '55512cb8-72e8-446c-9fff-f195d7e002c3', title: 'Solstice Soirée', context: '20 June 2026' },
  { type: 'whats-on', id: '3c4b2916-f2a2-452f-92ea-03fe20a0863c', title: 'Bellingen Memorial Hall', context: '' },
  { type: 'venue', id: '3c4b2916-f2a2-452f-92ea-03fe20a0863c', title: 'Bellingen Memorial Hall', context: '' },
  { type: 'artist', id: '94a88288-43aa-445b-abb8-7dc895804b51', title: 'LUCIOUS', context: '' },
];

/**
 * ⚠ A PRETEND OWNER, and it is labelled as one. The generator's menu is derived
 * from what an account holds, so signed out it correctly shows "nothing to
 * point at" — which proves the empty state and nothing else. Handing it a real
 * venue profile makes the populated menu reviewable without an account.
 *
 * ⛔ IT GRANTS NOTHING. The menu is a menu; RLS decides what may be saved, and
 * a save from here is rejected by `can_act_as` exactly as it should be.
 */
const PRETEND_VENUE = [{ id: '3c4b2916-f2a2-452f-92ea-03fe20a0863c', type: 'venue', name: 'Bellingen Memorial Hall' }];

export default function QrHarness() {
  const [creating, setCreating] = useState(false);
  const [asVenue, setAsVenue] = useState(false);

  return (
    <div style={{ padding: '72px 16px 96px', maxWidth: 680, margin: '0 auto' }}>
      <h1 style={{ fontFamily: "'Bebas Neue', sans-serif", fontWeight: 400, fontSize: 30, letterSpacing: 2, margin: '0 0 4px' }}>
        QR HARNESS
      </h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
        Dev only. Fixtures against real ids, so the codes below scan to real pages.
      </p>

      <button
        onClick={() => setCreating(true)}
        style={{
          background: '#00E5A0', color: '#08080f', border: 'none', borderRadius: 10,
          padding: '10px 16px', cursor: 'pointer', marginBottom: 24,
          fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: 1.6,
        }}
      >
        OPEN THE GENERATOR
      </button>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 24, cursor: 'pointer' }}>
        <input type="checkbox" checked={asVenue} onChange={e => setAsVenue(e.target.checked)} />
        {' '}Pretend I own a venue (fixture, for the populated menu)
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {FIXTURES.map(f => {
          const d = DESTINATIONS[f.type];
          const url = qrUrl(f.type, f.id);
          return (
            <div key={f.type}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                {f.type} → {d.route(f.id)}
              </div>
              <QrPreview url={url} title={f.title} kicker={posterKicker(f.type, f.context)} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {[['PDF', exportPdf], ['PNG', exportPng]].map(([label, fn]) => (
                  <button
                    key={label}
                    onClick={() => fn({ url, title: f.title, kicker: posterKicker(f.type, f.context), destinationType: f.type })}
                    style={{
                      flex: 1, padding: '8px', borderRadius: 8, cursor: 'pointer',
                      border: '1px solid var(--border)', background: 'rgba(255,255,255,.06)',
                      color: 'var(--text)', fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.2,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 30, fontSize: 11, color: 'var(--muted)' }}>
        Registry: {DESTINATION_KEYS.map(k => `${k}${DESTINATIONS[k].available ? '' : ' (not offered)'}`).join(' · ')}
      </div>

      {/* The real section, against the real table. Signed out it shows nothing,
          which is the correct answer and worth seeing. */}
      <QrCodesSection ownedProfiles={[]} userId={null} />

      {creating && (
        <QrCodeCreator
          ownedProfiles={asVenue ? PRETEND_VENUE : []}
          userId={null}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
