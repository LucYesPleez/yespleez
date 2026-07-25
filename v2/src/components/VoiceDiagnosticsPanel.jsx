import { useState, useEffect } from 'react';
import {
  markScenario, getVoiceSignals, clearVoiceSignals, formatVoiceSignals, isStandalone,
} from '../lib/voiceDiagnostics';

/**
 * THE INTERRUPTION MATRIX INSTRUMENT.
 *
 * Lives on the beta-feedback screen because that screen is one tap from the
 * global header on every route — and the scenarios being measured (a phone
 * call, a lock screen) cannot be run while hunting through navigation.
 *
 * Collapsed by default: this is a diagnostic for one investigation, not a
 * feature, and it must not be the first thing a beta tester meets on the
 * page they came to report a bug on.
 *
 * ⚠ READS ONLY. It never touches the recorder — see lib/voiceDiagnostics.js.
 */

/**
 * The eight scenarios, in the owner's order (2026-07-25). Each names ONE way
 * the OS can take audio away; the point of the matrix is that they may not
 * all announce themselves the same way, or at all.
 */
const SCENARIOS = [
  'Incoming phone call',
  'Outgoing phone call',
  'Screen lock',
  'App background',
  'Control Centre',
  'Siri',
  'Bluetooth disconnect',
  'Headphones unplugged',
];

export default function VoiceDiagnosticsPanel() {
  const [open, setOpen]       = useState(false);
  const [entries, setEntries] = useState([]);
  const [scenario, setScenario] = useState(SCENARIOS[0]);
  const [copied, setCopied]   = useState('');

  // Poll rather than subscribe: the writer is localStorage from inside the
  // audio path, which emits no event in the same document, and a 1s refresh
  // is plenty for reading a log after a scenario has been run.
  useEffect(() => {
    if (!open) return;
    const tick = () => setEntries(getVoiceSignals());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [open]);

  async function copyAll() {
    const text = formatVoiceSignals();
    try {
      await navigator.clipboard.writeText(text);
      setCopied('Copied — paste it into the chat.');
    } catch {
      // Clipboard is permission-gated and often blocked in a PWA. Falling
      // back to a selectable textarea keeps the data reachable, which is the
      // whole point of the panel.
      setCopied('Copy blocked — select the log text below and copy manually.');
    }
    setTimeout(() => setCopied(''), 4000);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: 'block', width: '100%', marginTop: 28, padding: '10px',
          fontFamily: "'Bebas Neue',sans-serif", fontSize: 12, letterSpacing: 1.6,
          color: 'rgba(255,255,255,.35)', background: 'none',
          border: '1px solid rgba(255,255,255,.1)', borderRadius: 12, cursor: 'pointer',
        }}
      >
        VOICE DIAGNOSTICS
      </button>
    );
  }

  return (
    <div style={{
      marginTop: 28, padding: 16, borderRadius: 14,
      border: '1px solid var(--border)', background: 'rgba(19,19,31,.55)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 15, letterSpacing: 1.5, color: 'var(--text)' }}>
          VOICE DIAGNOSTICS
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
          aria-label="Close diagnostics"
        >×</button>
      </div>

      <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, lineHeight: 1.5, color: 'var(--muted)', margin: '0 0 14px' }}>
        Pick a scenario, tap <b>Mark</b>, then go and do that thing while recording a Voicey.
        Come back and <b>Copy</b>. Recording is unaffected — this only watches.
      </p>

      <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: 'rgba(255,255,255,.3)', marginBottom: 12 }}>
        {isStandalone() ? 'Installed app (standalone)' : '⚠ Browser tab — install to home screen first'}
      </div>

      <select
        value={scenario}
        onChange={e => setScenario(e.target.value)}
        style={{
          width: '100%', padding: '10px', borderRadius: 10, marginBottom: 8,
          background: 'rgba(255,255,255,.05)', color: '#fff',
          border: '1px solid var(--border)', fontFamily: "'DM Sans',sans-serif", fontSize: 13,
          colorScheme: 'dark',
        }}
      >
        {SCENARIOS.map(sc => <option key={sc} value={sc}>{sc}</option>)}
      </select>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button
          type="button"
          onClick={() => { markScenario(scenario); setEntries(getVoiceSignals()); }}
          style={btn('linear-gradient(135deg,#FF2D78,#00E5FF)', '#0a0a14')}
        >MARK START</button>
        <button type="button" onClick={copyAll} style={btn(null, 'rgba(255,255,255,.6)')}>COPY</button>
        <button
          type="button"
          onClick={() => { clearVoiceSignals(); setEntries([]); }}
          style={btn(null, 'rgba(255,107,107,.8)')}
        >CLEAR</button>
      </div>

      {copied && (
        <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: '#7DE9FF', marginBottom: 10 }}>{copied}</div>
      )}

      {/* Selectable, so a blocked clipboard still leaves a way out. */}
      <textarea
        readOnly
        value={entries.length ? formatVoiceSignals() : 'No signals yet. Mark a scenario, then record.'}
        onFocus={e => e.target.select()}
        style={{
          width: '100%', height: 240, boxSizing: 'border-box', padding: 10,
          fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 10, lineHeight: 1.5,
          color: 'rgba(255,255,255,.8)', background: 'rgba(0,0,0,.35)',
          border: '1px solid var(--border)', borderRadius: 10, resize: 'vertical',
          whiteSpace: 'pre', overflowX: 'auto',
        }}
      />
      <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: 'rgba(255,255,255,.28)', marginTop: 6 }}>
        {entries.length} signal{entries.length === 1 ? '' : 's'} recorded
      </div>
    </div>
  );
}

function btn(bg, col) {
  return {
    flex: 1, padding: '9px 10px', borderRadius: 10, cursor: 'pointer',
    fontFamily: "'Bebas Neue',sans-serif", fontSize: 12, letterSpacing: 1.3,
    background: bg || 'none',
    border: bg ? 'none' : '1px solid rgba(255,255,255,.15)',
    color: col,
  };
}
