import { Component } from 'react';

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
