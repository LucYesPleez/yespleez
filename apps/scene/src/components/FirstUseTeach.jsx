/**
 * THE ONE-LINE LESSON. Mounted once in Shell; listens, shows, forgets.
 *
 * ⛔ Not a tour, not a step, not dismissible-by-obligation — it fades on its
 * own after a few seconds. Nothing waits on it and nothing is blocked by it.
 * See lib/firstUseTeach for why there is exactly one entry in the registry.
 *
 * ⚠ IT DOCKS ABOVE THE BOTTOM NAV (--yp-safe-bottom), like every other
 * floating element in this app. ⛔ The nav is never covered.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from '../App';
import { TEACH_EVENT, TEACH, alreadyTaught, markTaught } from '../lib/firstUseTeach';

const VISIBLE_MS = 4200;

export default function FirstUseTeach() {
  const { session } = useSession() ?? {};
  const [text, setText] = useState(null);
  const userId = session?.user?.id;

  useEffect(() => {
    async function onTeach(e) {
      const moment = TEACH[e?.detail?.momentKey];
      if (!moment || !userId) return;
      if (await alreadyTaught(userId, moment.key)) return;
      // Spent on SHOWING, not on acknowledging — there is nothing to
      // acknowledge. A lesson nobody has to dismiss cannot be "completed".
      markTaught(userId, moment.key);
      setText(moment.text);
    }
    window.addEventListener(TEACH_EVENT, onTeach);
    return () => window.removeEventListener(TEACH_EVENT, onTeach);
  }, [userId]);

  useEffect(() => {
    if (!text) return undefined;
    const t = setTimeout(() => setText(null), VISIBLE_MS);
    return () => clearTimeout(t);
  }, [text]);

  if (!text) return null;

  return createPortal(
    <div
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 'calc(var(--yp-safe-bottom) + 14px)',
        zIndex: 800,
        maxWidth: 'min(88vw, 420px)',
        padding: '11px 16px',
        borderRadius: 12,
        background: 'var(--card)',
        border: '1px solid rgba(0,229,255,.45)',
        boxShadow: '0 8px 28px rgba(0,0,0,.55)',
        color: 'var(--text)',
        fontSize: 13,
        lineHeight: 1.45,
        textAlign: 'center',
      }}
    >
      {text}
    </div>,
    document.body,
  );
}
