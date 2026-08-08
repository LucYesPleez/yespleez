import PostcodePrompt from './PostcodePrompt';

export default function ProfileFormShell({
  blocker,
  showPostcodePrompt,
  onPostcodeSave,
  onPostcodeDismiss,
  onSubmit,
  onFormChange,
  children,
}) {
  return (
    <>
      {blocker?.state === 'blocked' && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.82)',
          zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div style={{
            background: '#181825', borderRadius: 16, padding: 24,
            maxWidth: 320, width: '100%', border: '1px solid rgba(255,255,255,.1)',
          }}>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 20, letterSpacing: 2, marginBottom: 10 }}>
              UNSAVED CHANGES
            </div>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,.55)', marginBottom: 20, lineHeight: 1.6 }}>
              You have unsaved changes. Leave without saving?
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => blocker.reset()}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 10,
                  border: '1px solid rgba(255,255,255,.15)', background: 'none',
                  color: 'rgba(255,255,255,.6)', fontFamily: "'Bebas Neue'",
                  fontSize: 13, letterSpacing: 1.5, cursor: 'pointer',
                }}
              >STAY</button>
              <button
                type="button"
                onClick={() => blocker.proceed()}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
                  background: '#FF3B5C', color: '#fff', fontFamily: "'Bebas Neue'",
                  fontSize: 13, letterSpacing: 1.5, cursor: 'pointer',
                }}
              >LEAVE</button>
            </div>
          </div>
        </div>
      )}
      {showPostcodePrompt && (
        <PostcodePrompt onSave={onPostcodeSave} onDismiss={onPostcodeDismiss} />
      )}
      <form onSubmit={onSubmit} onChange={onFormChange}>
        {children}
      </form>
    </>
  );
}
