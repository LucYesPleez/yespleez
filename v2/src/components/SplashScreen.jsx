import { useEffect, useRef, useState } from 'react';

const SEEN_KEY = 'yp_splash_done';

/**
 * The boot splash, ported from the legacy prototype — same asset, same
 * timing, same behaviour. Mounted independently of <App/> in main.jsx so it
 * covers App's own loading gap (App renders `null` while checking the
 * session) rather than fighting it.
 *
 * sessionStorage, not localStorage — this is a boot animation the user sees
 * once per open tab, not a one-time welcome.
 */
export default function SplashScreen() {
  const [mounted, setMounted] = useState(() => !sessionStorage.getItem(SEEN_KEY));
  const rootRef = useRef(null);
  const wrapRef = useRef(null);
  const echoRef = useRef(null);

  useEffect(() => {
    if (!mounted) return undefined;

    const mob = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth <= 600;
    // Timings (phone): fade-in 1900ms, static 600ms, echo 500ms, fade-out ~1000ms = ~4s total
    const fadeIn  = mob ? 1900 : 1400;
    const echoAt  = mob ? 2500 : 1900;
    const fadeAt  = mob ? 3000 : 2500;
    const fadeDur = mob ? 1000 : 500;

    const root = rootRef.current;
    const wrap = wrapRef.current;
    const echo = echoRef.current;
    const timers = [];
    let done = false;

    function dismiss() {
      if (done) return;
      done = true;
      sessionStorage.setItem(SEEN_KEY, '1');
      root.style.transition = `opacity ${fadeDur / 1000}s ease`;
      root.style.opacity = '0';
      timers.push(setTimeout(() => setMounted(false), fadeDur + 50));
    }

    // Black screen shows instantly — image fades in on top.
    wrap.style.transition = `opacity ${fadeIn / 1000}s ease`;
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => { wrap.style.opacity = '1'; });
    });

    timers.push(setTimeout(() => echo.classList.add('go'), echoAt));
    timers.push(setTimeout(dismiss, fadeAt));
    timers.push(setTimeout(dismiss, 8000)); // safety cap

    return () => {
      cancelAnimationFrame(raf1);
      timers.forEach(clearTimeout);
    };
  }, [mounted]);

  if (!mounted) return null;

  return (
    <div
      ref={rootRef}
      style={{
        position: 'fixed', inset: 0, zIndex: 999999,
        background: '#000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        ref={wrapRef}
        style={{
          position: 'relative', maxWidth: 420, width: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: 0,
        }}
      >
        <img
          src="/splash.png" alt=""
          style={{ maxWidth: 420, width: '100%', maxHeight: '100vh', objectFit: 'contain' }}
        />
        <img
          ref={echoRef}
          src="/splash.png" alt="" className="yp-splash-echo"
          style={{
            position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none',
            maxWidth: 420, width: '100%', maxHeight: '100vh', objectFit: 'contain',
          }}
        />
      </div>
    </div>
  );
}
