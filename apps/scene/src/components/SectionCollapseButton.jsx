/**
 * The minimise / maximise control that sits at the right of a dashboard section
 * heading.
 *
 * ⚠ EXTRACTED, NOT INVENTED. This markup lived inline in HostDashboard's LINEUP
 * heading. It moved here the moment ENQUIRIES needed the same control (owner,
 * 2026-08-11) — two hand-copied 12-line buttons with their own hover handlers
 * are two buttons free to drift, and the drift shows up as one section behaving
 * subtly differently from the one above it.
 *
 * `expanded` describes the SECTION, not the button: true means the content is
 * open, and the icon shown is therefore the one that closes it. Getting that
 * backwards renders a "maximise" glyph on an already-maximised section.
 */
export default function SectionCollapseButton({ expanded, onToggle, accent = 'var(--neon2)' }) {
  return (
    <button
      onClick={onToggle}
      style={{ marginLeft: 'auto', background: 'none', border: '1px solid rgba(255,255,255,.15)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--muted)', flexShrink: 0, transition: 'border-color .15s, color .15s' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = accent; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.15)'; e.currentTarget.style.color = 'var(--muted)'; }}
      title={expanded ? 'Minimise' : 'Maximise'}
      aria-expanded={expanded}
    >
      {expanded
        ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>
        : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
      }
    </button>
  );
}
