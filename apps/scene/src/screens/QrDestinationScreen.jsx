import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { resolveDestination, DESTINATIONS } from '../lib/qrDestinations';

/**
 * `/q/:type/:id` — WHERE EVERY SCANNED YESPLEEZ CODE LANDS FIRST.
 *
 * ⭐⭐ THIS ROUTE IS PERMANENT. Addresses of this shape are printed on paper and
 * cannot be corrected, so the contract is one-way: types may be ADDED, and
 * ⛔ no existing type may ever be renamed, removed, or pointed somewhere that
 * is not what its label promised. If a destination's surface changes, change
 * `DESTINATIONS[type].route` — that is the entire point of resolving here
 * rather than printing the surface's own URL.
 *
 * ⚠ It is a redirect, not a page: `replace` so the back button returns to
 * wherever the visitor came from rather than bouncing between this and the
 * destination. A scan opens a fresh tab, where there is nothing behind it, and
 * the destination becomes the first entry.
 *
 * ⚠ PUBLIC, AND IT MUST STAY PUBLIC. A poster is read by strangers. Discovery
 * is anonymous; whether the destination itself shows everything to a signed-out
 * reader is that surface's own decision, made by RLS, ⛔ not by this route.
 */
export default function QrDestinationScreen() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const path = resolveDestination(type, id);

  useEffect(() => {
    if (path) navigate(path, { replace: true });
  }, [path, navigate]);

  if (path) return null;

  /**
   * ⚠ AN HONEST DEAD END. A mistyped or retired address gets an explanation and
   * a way onwards. ⛔ Not a silent redirect home: somebody is standing in front
   * of a poster wondering why nothing happened, and "this code is not one of
   * ours" is information they can act on.
   */
  const known = DESTINATIONS[type];
  return (
    <div style={{
      padding: '96px 24px 80px', maxWidth: 480, margin: '0 auto',
      textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <h1 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 30, letterSpacing: 2, margin: 0 }}>
        THIS CODE GOES NOWHERE
      </h1>
      <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.65, margin: 0 }}>
        {known
          ? 'The code scanned correctly, but it is missing the part that says which one to open.'
          : 'We do not recognise this code. It may be from an older version, or the link may have been copied incompletely.'}
      </p>
      <button
        onClick={() => navigate('/')}
        style={{
          alignSelf: 'center', marginTop: 6, padding: '11px 22px', borderRadius: 10,
          border: '1px solid var(--border)', background: 'rgba(255,255,255,.06)',
          color: 'var(--text)', cursor: 'pointer',
          fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: 1.8,
        }}
      >
        SEE WHAT IS ON
      </button>
    </div>
  );
}
