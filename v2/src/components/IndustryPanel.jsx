import { useState, useEffect } from 'react';
import { ROLES } from '../screens/RoleSelectorScreen';
import { supabase } from '../lib/supabase';
import s from './IndustryPanel.module.css';

export default function IndustryPanel({ open, onClose, onNavigate, session, isGuest, onSignOut }) {
  const [setupTypes, setSetupTypes] = useState(new Set());

  useEffect(() => {
    if (!open || !session) return;
    supabase
      .from('profiles')
      .select('type')
      .eq('user_id', session.user.id)
      .then(({ data }) => {
        if (data) setSetupTypes(new Set(data.map(p => p.type)));
      });
  }, [open, session]);

  const setupRoles = ROLES.filter(r => setupTypes.has(r.id));

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
                        <div className={s.cardSetup} style={{ color: col }}>✓ Profile set up</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <button className={s.signOutBtn} onClick={onSignOut}>SIGN OUT</button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
