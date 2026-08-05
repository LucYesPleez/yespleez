import { useState, useEffect } from 'react';
import { ROLES } from '../screens/RoleSelectorScreen';
import { supabase } from '../lib/supabase';
import s from './IndustryPanel.module.css';

export default function IndustryPanel({ open, onClose, onNavigate, session, isGuest, onSignOut }) {
  /**
   * type -> the profile's NAME (owner, 2026-08-04: "have the name next to the
   * tick instead of where it says profile set up").
   *
   * ⚠ The select now asks for `name` as well as `type`. The tick used to say
   * the same five words on every card, which told someone with five profiles
   * nothing they could not already see from the row existing — the useful fact
   * is WHICH profile is behind each role.
   */
  const [setupNames, setSetupNames] = useState({});

  useEffect(() => {
    if (!open || !session) return;
    supabase
      .from('profiles')
      .select('type, name')
      .eq('user_id', session.user.id)
      .then(({ data }) => {
        if (!data) return;
        const byType = {};
        // FIRST wins, not last. A card opens one dashboard per role, so if an
        // account somehow holds two profiles of a type this must settle on one
        // deterministically rather than on whatever order the planner returned.
        for (const p of data) if (!(p.type in byType)) byType[p.type] = (p.name || '').trim();
        setSetupNames(byType);
      });
  }, [open, session]);

  const setupRoles = ROLES.filter(r => r.id in setupNames);

  return (
    <>
      {open && <div className={s.overlay} onClick={onClose} />}

      <div className={open ? s.panelOpen : s.panel}>
        <div className={s.handle} />

        <div className={s.cards}>
          {(isGuest || !session) ? (
            <div className={s.guestMsg}>
              <p className={s.guestText}>Sign in to access industry features</p>
              <button className={s.guestBtn} onClick={onSignOut}>SIGN IN →</button>
            </div>
          ) : (
            <>
              <button className={s.cardAdd} onClick={() => onNavigate('/role-select')}>
                <span className={s.cardIcon} style={{ color: 'var(--neon2)' }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
                  </svg>
                </span>
                <div className={s.cardTitle} style={{ color: 'var(--neon2)' }}>ADD PROFILE</div>
              </button>

              {setupRoles.length === 0 && (
                <p className={s.noProfiles}>No profiles set up yet. Tap ADD PROFILE to get started.</p>
              )}

              <div className={s.roleGrid}>
                {setupRoles.map(role => {
                  const col = role.hoverStyle.borderColor;
                  return (
                    <button
                      key={role.id}
                      className={s.card}
                      onClick={() => onNavigate(role.path)}
                    >
                      <span className={s.cardIcon} style={{ color: '#fff' }}>{role.icon}</span>
                      <div className={s.cardBody}>
                        <div className={s.cardTitle} style={role.titleStyle}>{role.title}</div>
                        {/* R1 · an unnamed profile falls back to the old
                            wording rather than rendering a bare tick — "✓"
                            alone reads as a rendering fault, not as absence. */}
                        <div className={s.cardSetup} style={{ color: col }}>
                          ✓ {setupNames[role.id] || 'Profile set up'}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* ⛔ NO SIGN OUT HERE (owner, 2026-08-04) — it lives only in the
                  header's identity menu now. This panel is for switching
                  between your industry profiles; leaving the app entirely was
                  never the same kind of action. */}
            </>
          )}
        </div>
      </div>
    </>
  );
}
