import { useState, useEffect } from 'react';
import { ROLES } from '../screens/RoleSelectorScreen';
import { visibleRoles } from '../lib/roleVisibility';
import { supabase } from '../lib/supabase';
import AccountInvite from './AccountInvite';
import s from './IndustryPanel.module.css';

export default function IndustryPanel({ open, onClose, onNavigate, session }) {
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

  // ⚠ THE RESTRICTION FILTER IS NEEDED HERE TOO, and it is not obvious why.
  // This panel only shows roles the account already has a profile for, and
  // `festival` is not a Scene profile type — so it looks unreachable. But the
  // Festival Portal writes to the SAME Supabase project, so a real
  // `type = 'festival'` row can exist and would put the card in front of
  // whoever owns it. Filtering by email first keeps the two surfaces agreeing
  // about who may see what.
  const setupRoles = visibleRoles(ROLES, session).filter(r => r.id in setupNames);

  return (
    <>
      {open && <div className={s.overlay} onClick={onClose} />}

      <div className={open ? s.panelOpen : s.panel}>
        <div className={s.handle} />

        <div className={s.cards}>
          {!session ? (
            /* ⚠ Was "Sign in to access industry features" + a bare SIGN IN
               button — which named the wall rather than what lies past it.
               Now the same block the heart's sheet shows (owner, 2026-08-12),
               and this panel IS already a slide-up, so the two match without
               a card inside a sheet.
               ⛔ No dismiss: the panel's own scrim and handle close it, and a
               second "Not now" inside would be two ways to do one thing. */
            <div className={s.guestMsg}>
              <AccountInvite
                title="SET UP YOUR PROFILE"
                body="Apply for gigs, book acts and run your own events."
                onCreateAccount={() => onNavigate('/auth', 'signup')}
                onSignIn={() => onNavigate('/auth', 'signin')}
              />
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
