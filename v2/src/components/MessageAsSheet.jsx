import { useState } from 'react';
import { PROFILE_TYPES } from '../lib/profileTypes';

/**
 * "MESSAGE AS…" — the identity picker, shown ONCE when a conversation is
 * created and the sender can act as more than one profile.
 *
 * This is the first interaction before a conversation exists, not a settings
 * dialog. It should read as choosing who walks into the room.
 *
 * ── PRIVACY ──────────────────────────────────────────────────────────
 *
 * This list is the SENDER'S OWN and is never shown to a recipient. They see
 * the participating profile and nothing else, so messaging cannot reveal that
 * one person runs a venue, a festival and an artist alias.
 *
 * ── SELECT THEN CONFIRM, NOT SELECT-TO-DISMISS ───────────────────────
 *
 * Choosing an identity is consequential and permanent for the life of the
 * conversation (§2.1 freezes the participant set). A tap that both selects and
 * commits gives no moment to change your mind, so selection and confirmation
 * are separate: Continue stays disabled until something is chosen.
 */
export default function MessageAsSheet({ profiles, onConfirm, onCancel }) {
  const [selected, setSelected] = useState(null);
  const [pressed, setPressed]   = useState(null);

  return (
    <div
      role="dialog"
      aria-label="Choose which profile will start this conversation"
      onClick={onCancel}
      style={{
        // CONSTITUTIONAL LAYOUT RULE — the bottom navigation is sacred.
        // This sheet stops at the top of the nav; neither it nor its backdrop
        // may render underneath. See ConversationDock for the full note.
        position: 'fixed', top: 'var(--yp-header-height, 56px)', left: 0, right: 0,
        bottom: 'var(--yp-nav-height, 64px)', zIndex: 220,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        background: 'rgba(0,0,0,.55)',
        backdropFilter: 'blur(18px) saturate(140%)',
        WebkitBackdropFilter: 'blur(18px) saturate(140%)',
        animation: 'ypSheetFade .18s ease-out',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 520,
          background: '#121214',
          borderTop: '1px solid rgba(255,255,255,.08)',
          borderRadius: '30px 30px 0 0',
          padding: '10px 20px 24px',
          boxSizing: 'border-box',
          boxShadow: '0 -18px 60px rgba(0,0,0,.6)',
          maxHeight: '88dvh', overflowY: 'auto',
          animation: 'ypSheetUp .42s cubic-bezier(.16,1,.3,1)',
        }}
      >
        {/* Grabber — signals a sheet rather than a modal. */}
        <div style={{ width: 44, height: 4, borderRadius: 999, background: 'rgba(255,255,255,.18)', margin: '0 auto 20px' }} />

        <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 34, letterSpacing: 2, color: '#fff', margin: '0 0 6px', lineHeight: 1 }}>
          MESSAGE AS…
        </h2>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,.45)', margin: '0 0 22px', lineHeight: 1.45 }}>
          Choose which profile will start this conversation.
        </p>

        {profiles.map(p => {
          const meta     = PROFILE_TYPES[p.type] ?? {};
          const accent   = meta.accent  ?? '#BF5FFF';
          const accent2  = meta.accent2 ?? '#00E5FF';
          const isOn     = selected === p.id;
          const isPress  = pressed === p.id;
          const avatar   = p.avatar_thumb || p.avatar || meta.defaultImage;

          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={isOn}
              onClick={() => setSelected(p.id)}
              onPointerDown={() => setPressed(p.id)}
              onPointerUp={() => setPressed(null)}
              onPointerLeave={() => setPressed(null)}
              style={{
                position: 'relative',
                display: 'flex', alignItems: 'center', gap: 14,
                width: '100%', textAlign: 'left', cursor: 'pointer',
                padding: 1, marginBottom: 12, borderRadius: 20, border: 'none',
                // The gradient lives on the wrapper so it reads as a border,
                // the same trick Follow and Message use.
                background: isOn
                  ? `linear-gradient(135deg, ${accent}, ${accent2})`
                  : 'rgba(255,255,255,.10)',
                boxShadow: isOn ? `0 0 26px -4px ${accent}66` : 'none',
                transform: isPress ? 'scale(.978)' : 'scale(1)',
                transition: 'transform .16s cubic-bezier(.16,1,.3,1), box-shadow .28s ease, background .28s ease',
              }}
            >
              <span style={{
                display: 'flex', alignItems: 'center', gap: 14, width: '100%',
                background: isOn ? 'rgba(30,30,36,.94)' : 'rgba(22,22,26,.94)',
                borderRadius: 19, padding: '14px 16px', boxSizing: 'border-box',
                transition: 'background .28s ease',
              }}>
                <span style={{
                  width: 48, height: 48, borderRadius: 999, flexShrink: 0,
                  padding: 2, background: `linear-gradient(135deg, ${accent}, ${accent2})`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{
                    width: '100%', height: '100%', borderRadius: 999, overflow: 'hidden',
                    background: '#0d0d10', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: accent, fontFamily: "'Bebas Neue', sans-serif", fontSize: 18,
                  }}>
                    {avatar
                      ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : (p.name?.slice(0, 1) ?? '?').toUpperCase()}
                  </span>
                </span>

                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', color: '#fff', fontSize: 16, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </span>
                  <span style={{ display: 'block', color: 'rgba(255,255,255,.42)', fontSize: 13, marginTop: 2 }}>
                    {meta.label ?? p.type}
                  </span>
                </span>

                {/* Check, not a radio — it grows in rather than toggling. */}
                <span style={{
                  width: 26, height: 26, borderRadius: 999, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: isOn ? 'none' : '1.5px solid rgba(255,255,255,.22)',
                  background: isOn ? `linear-gradient(135deg, ${accent}, ${accent2})` : 'transparent',
                  transform: isOn ? 'scale(1)' : 'scale(.9)',
                  transition: 'transform .3s cubic-bezier(.16,1,.3,1), background .28s ease',
                }}>
                  {isOn && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0a0a0f" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'ypCheckIn .3s cubic-bezier(.16,1,.3,1)' }}>
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </span>
              </span>
            </button>
          );
        })}

        <button
          type="button"
          disabled={!selected}
          onClick={() => selected && onConfirm(selected)}
          style={{
            width: '100%', marginTop: 10, border: 'none', borderRadius: 16,
            padding: '16px 20px', cursor: selected ? 'pointer' : 'not-allowed',
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 17, letterSpacing: 2,
            color: selected ? '#0a0a0f' : 'rgba(255,255,255,.30)',
            background: selected
              ? 'linear-gradient(135deg, #00E5FF, #BF5FFF)'
              : 'rgba(255,255,255,.06)',
            boxShadow: selected ? '0 10px 30px -10px rgba(191,95,255,.75)' : 'none',
            transform: selected ? 'scale(1)' : 'scale(.995)',
            transition: 'background .3s ease, box-shadow .3s ease, color .2s ease, transform .3s cubic-bezier(.16,1,.3,1)',
          }}
        >
          CONTINUE →
        </button>

        <button
          type="button"
          onClick={onCancel}
          style={{
            display: 'block', margin: '14px auto 0', background: 'none', border: 'none',
            color: 'rgba(255,255,255,.38)', fontSize: 14, cursor: 'pointer', padding: 6,
          }}
        >
          Cancel
        </button>
      </div>

      <style>{`
        @keyframes ypSheetFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes ypSheetUp {
          from { transform: translateY(100%) }
          to   { transform: translateY(0) }
        }
        @keyframes ypCheckIn {
          from { transform: scale(.4); opacity: 0 }
          to   { transform: scale(1);  opacity: 1 }
        }
      `}</style>
    </div>
  );
}
