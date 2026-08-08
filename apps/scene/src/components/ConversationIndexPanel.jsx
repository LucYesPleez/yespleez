import { useState, useMemo, useEffect } from 'react';
import {
  mediaEntries, fileEntries, linkEntries, searchMessages,
} from '../lib/conversationIndex';
import { formatBytes, formatToken } from '../lib/messageFiles';
import { formatDuration } from '../lib/voiceNotes';
import { describeOriginal, formatBytes as formatImageBytes } from '../lib/messageImages';

/**
 * THE CONVERSATION INDEXES — Media, Files, Links, Search
 * (conversation-workspace-v1.0 §7.4–§7.3).
 *
 * ── ⚠ EVERY ROW'S PRIMARY ACTION IS JUMP TO CHAT (W23) ────────────────
 *
 * Tapping a row navigates to the message IN PLACE. It does not download, does
 * not open, does not play — an index that acts by default is a file browser,
 * and the entire point of ratifying this as a workspace rather than a file
 * browser is that the surrounding conversation is frequently the information
 * someone actually needed. "Open Link" exists as an explicit SECONDARY
 * control for exactly one kind (Links), because there the secondary act is
 * unambiguous and common enough to deserve its own target.
 *
 * ── ⚠ A DELIBERATE SIMPLIFICATION, STATED RATHER THAN HIDDEN ─────────
 *
 * Media rows show an icon and metadata, not a decoded thumbnail. Real
 * thumbnails need a signed URL per entry — cheap for one photo, not free for a
 * list of forty — and are a legitimate fast follow once this is on screen and
 * judged. Shipping the honest, fast version today rather than a slow or
 * half-correct thumbnail grid.
 */

/** conversation-workspace-v1.0 §7.4–§7.6. Order matches the ratified menu. */
export const INDEX_LABELS = { search: 'Search', media: 'Media', files: 'Files', links: 'Links' };

function shortDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "You" for your own messages, matching how the thread already frames it. */
function senderLabel(message, mine, profilesById) {
  if (mine?.has(message.from_profile_id)) return 'You';
  return profilesById?.[message.from_profile_id]?.name || 'Them';
}

/**
 * One line of type-specific detail. Falls back to nothing rather than a
 * placeholder — an entry with no known size or duration should say less, not
 * say something invented.
 */
function detailFor(m) {
  const p = m.payload ?? {};
  if (m.kind === 'image') {
    if (p.original) return [describeOriginal(p.original, p.name), formatImageBytes(p.original.bytes)].filter(Boolean).join(' · ');
    if (p.width && p.height) return `${p.width} × ${p.height}`;
    return null;
  }
  if (m.kind === 'voice') {
    const ms = Number(p.duration_ms ?? 0);
    return ms > 0 ? formatDuration(ms / 1000) : null;
  }
  if (m.kind === 'file') {
    return [formatToken(p.name, p.mime), p.bytes ? formatBytes(p.bytes) : null].filter(Boolean).join(' · ');
  }
  return null;
}

function displayName(m) {
  if (m.kind === 'image') return m.payload?.name || 'Photo';
  if (m.kind === 'voice') return 'Voice message';
  if (m.kind === 'file') return m.payload?.name || m.body || 'Attachment';
  return m.body || '';
}

function KindIcon({ kind }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (kind === 'image') return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="8.5" cy="10" r="1.8" /><path d="m21 16-5.5-5.5L7 19" /></svg>;
  if (kind === 'voice') return <svg {...common}><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v1a7 7 0 0 1-14 0v-1" /><path d="M12 18v3" /></svg>;
  return <svg {...common}><path d="M14 2H6.5A1.5 1.5 0 0 0 5 3.5v17A1.5 1.5 0 0 0 6.5 22h11a1.5 1.5 0 0 0 1.5-1.5V7z" /><path d="M14 2v5h5" /></svg>;
}

/** One row, shared by Media/Files/Search — the three list-of-messages screens. */
function EntryRow({ message, mine, profilesById, onJump }) {
  return (
    <button
      type="button"
      onClick={() => onJump(message.id)}
      style={{
        display: 'flex', alignItems: 'center', gap: 11, width: '100%',
        padding: '10px 4px', border: 'none', background: 'transparent',
        color: 'var(--text)', textAlign: 'left', cursor: 'pointer',
        borderBottom: '1px solid rgba(255,255,255,.06)',
      }}
    >
      <span aria-hidden="true" style={{
        flexShrink: 0, width: 32, height: 32, borderRadius: 9,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(191,95,255,.14)', border: '1px solid rgba(191,95,255,.26)',
        color: '#D9BFFF',
      }}>
        <KindIcon kind={message.kind} />
      </span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayName(message)}
        </span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {[senderLabel(message, mine, profilesById), shortDate(message.created_at), detailFor(message)].filter(Boolean).join(' · ')}
        </span>
      </span>

      {message.payload?.hd && (
        <span className="yp-hd-chip" style={{ flexShrink: 0 }}>HD</span>
      )}
    </button>
  );
}

function LinkRow({ entry, mine, profilesById, onJump }) {
  const { message, url } = entry;
  const domain = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } })();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 4px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
      <button
        type="button"
        onClick={() => onJump(message.id)}
        style={{ flex: 1, minWidth: 0, display: 'block', padding: 0, border: 'none', background: 'transparent', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}
      >
        <span style={{ display: 'block', fontSize: 13.5, color: '#8FD9FF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {domain}
        </span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'var(--muted)' }}>
          {senderLabel(message, mine, profilesById)} · {shortDate(message.created_at)}
        </span>
      </button>

      {/* The one SECONDARY action in any index — see header. Explicit rel
          protects the opened tab from reaching back into this one. */}
      <a
        href={url} target="_blank" rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        aria-label={`Open ${domain}`}
        style={{ flexShrink: 0, display: 'flex', width: 30, height: 30, borderRadius: 999, alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', border: '1px solid rgba(255,255,255,.10)' }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14 21 3" />
        </svg>
      </a>
    </div>
  );
}

export default function ConversationIndexPanel({ mode, messages, mine, profilesById, onJump, onClose }) {
  const [query, setQuery] = useState('');

  // Fresh each open — a stale search box from a previous visit answers a
  // question nobody is asking any more.
  useEffect(() => { setQuery(''); }, [mode]);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const entries = useMemo(() => {
    if (mode === 'media') return mediaEntries(messages);
    if (mode === 'files') return fileEntries(messages);
    if (mode === 'links') return linkEntries(messages);
    if (mode === 'search') return searchMessages(messages, query);
    return [];
  }, [mode, messages, query]);

  function jump(id) { onJump(id); onClose(); }

  return (
    <div
      role="dialog" aria-modal="true" aria-label={INDEX_LABELS[mode]}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        bottom: 'var(--yp-safe-bottom, var(--yp-nav-height, 64px))',
        margin: '0 auto', width: 'min(100%, 680px)',
        background: 'rgba(10,9,13,.99)', zIndex: 300,
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 14px 10px', borderBottom: '1px solid rgba(255,255,255,.08)', flexShrink: 0 }}>
        <button type="button" onClick={onClose} aria-label="Back" style={{ background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', display: 'flex', padding: 4 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
        </button>

        {mode === 'search' ? (
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search this conversation"
            aria-label="Search this conversation"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 15 }}
          />
        ) : (
          <span style={{ fontSize: 16, fontWeight: 600 }}>{INDEX_LABELS[mode]}</span>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 12px' }}>
        {entries.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, marginTop: 40 }}>
            {mode === 'search'
              ? (query.trim() ? 'No matches.' : 'Type to search this conversation.')
              : `No ${INDEX_LABELS[mode].toLowerCase()} yet.`}
          </p>
        ) : mode === 'links' ? (
          entries.map(entry => (
            <LinkRow key={entry.message.id} entry={entry} mine={mine} profilesById={profilesById} onJump={jump} />
          ))
        ) : (
          entries.map(m => (
            <EntryRow key={m.id} message={m} mine={mine} profilesById={profilesById} onJump={jump} />
          ))
        )}
      </div>
    </div>
  );
}
