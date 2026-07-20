import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

/**
 * ACCESS REQUIRED — where a shared link lands when the recipient cannot see
 * the resource.
 *
 * ── WHY A LINK TO A PRIVATE RESOURCE STILL GENERATES ─────────────────
 *
 * Permission is resolved when a link is OPENED, not when it is created.
 * Refusing to generate a link for a private resource would mean building the
 * access model first — who may share, with whom, at what level — and that is a
 * FUTURE Access Management milestone. Generating a link is not granting
 * access; this screen is what makes that safe.
 *
 * ── WHAT THIS SCREEN DELIBERATELY IS NOT ─────────────────────────────
 *
 * Not collaborator management. Not invitations. Not an ACL editor. Not
 * ownership transfer. "Request access" is a PLACEHOLDER: it acknowledges the
 * request locally and sends nothing, because the request would need a
 * recipient, and choosing that recipient is the ownership question the
 * milestone exists to answer.
 *
 * It says so on screen rather than pretending. A button that silently does
 * nothing is worse than one that says it is not connected yet — the first
 * loses a real request, the second sets expectations honestly.
 */
export default function AccessRequiredScreen() {
  const [params] = useSearchParams();
  const [requested, setRequested] = useState(false);

  // Optional context from the link, purely for display.
  const resource = params.get('type') || 'resource';

  return (
    <div style={{ paddingTop: 72, paddingBottom: 90, minHeight: '100dvh', background: 'var(--bg)', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '48px 20px 0', textAlign: 'center' }}>

        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, letterSpacing: 3, background: 'linear-gradient(135deg, #00E5FF, #BF5FFF)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', display: 'inline-block', marginBottom: 12 }}>
          ACCESS REQUIRED
        </div>

        <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.6, margin: '0 0 24px' }}>
          This {resource} is private. You will need the owner to give you access
          before you can view it.
        </p>

        {!requested ? (
          <button
            type="button"
            onClick={() => setRequested(true)}
            style={{ border: 'none', borderRadius: 999, padding: '12px 26px', fontFamily: "'Bebas Neue',sans-serif", fontSize: 15, letterSpacing: 1.5, cursor: 'pointer', background: 'linear-gradient(135deg, #00E5FF, #BF5FFF)', color: '#000' }}
          >
            REQUEST ACCESS
          </button>
        ) : (
          <div role="status" style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', color: 'var(--muted)', fontSize: 13, lineHeight: 1.55 }}>
            Noted — but nothing has been sent yet. Access requests are not
            connected up, so contact the owner directly for now.
          </div>
        )}

        <div style={{ marginTop: 32 }}>
          <Link to="/" style={{ color: 'var(--muted)', fontFamily: "'Bebas Neue',sans-serif", fontSize: 13, letterSpacing: 1.5, textDecoration: 'none' }}>
            ← BACK TO WHAT&apos;S ON
          </Link>
        </div>
      </div>
    </div>
  );
}
