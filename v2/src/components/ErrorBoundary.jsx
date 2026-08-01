import { Component } from 'react';
import { trackError } from '../lib/analytics';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[YesPleez]', error, info);

    // TEMP: Remove after ConversationDock crash root cause is confirmed.
    // Tracking commit: 8bf1704
    //
    // Added 2026-08-01 to catch the ConversationDock exception, which is
    // intermittent: it fires on some
    // loads and not others, so the message has to survive a reload to be
    // readable at all. sessionStorage rather than a console line because the
    // console is cleared by the reload that follows the crash.
    try {
      const prior = JSON.parse(sessionStorage.getItem('yp:crashes') || '[]');
      prior.push({
        at: new Date().toISOString(),
        message: error?.message || String(error),
        name: error?.name,
        stack: error?.stack,
        componentStack: info?.componentStack,
        url: window.location.hash,
      });
      sessionStorage.setItem('yp:crashes', JSON.stringify(prior.slice(-10)));
    } catch { /* diagnostics must never mask the crash they record */ }

    // A2 · a crash nobody reports is the quietest way to lose a user: they
    // see "something went wrong", close the app, and no record of it exists
    // anywhere. This is the only place the app learns it broke in the wild.
    //
    // trackError never throws (analytics rule 1), which matters more here
    // than anywhere else — a failure inside the crash handler would replace
    // a recoverable error screen with a blank page.
    trackError(error);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '60vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '32px 24px', textAlign: 'center',
        }}>
          <p style={{ fontFamily: "'Bebas Neue'", fontSize: 28, letterSpacing: 3, color: 'var(--text)', marginBottom: 8 }}>
            SOMETHING WENT WRONG
          </p>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.5 }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              background: 'none', border: '1px solid var(--neon2)', color: 'var(--neon2)',
              fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 2,
              padding: '10px 24px', borderRadius: 8, cursor: 'pointer',
            }}
          >
            TRY AGAIN
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
