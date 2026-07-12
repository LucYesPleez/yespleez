import { useRef, useCallback } from 'react';

// First-use discoverability: any named rail gets a small horizontal "bump"
// on its first 10 visits, then never again — just enough to hint it's
// swipeable without being distracting.
const DISCOVERY_MAX_VISITS = 10;
const DISCOVERY_BUMP_PX    = 46;
const DISCOVERY_KEY_PREFIX = 'yp_hscroll_visits_';

function armDiscoveryBump(el, discoveryId) {
  const key = DISCOVERY_KEY_PREFIX + discoveryId;
  let settled = false;
  const timers = [];

  // The rail is frequently rendered only once async data has loaded, so a
  // plain "check once at mount" can run before there's anything to overflow.
  // A ResizeObserver re-checks whenever the content's size actually changes.
  const ro = new ResizeObserver(() => {
    if (settled) return;
    if (el.scrollWidth <= el.clientWidth + 1) return; // nothing to hint yet

    const visits = Number(localStorage.getItem(key) || 0);
    settled = true;
    ro.disconnect();
    if (visits >= DISCOVERY_MAX_VISITS) return;
    localStorage.setItem(key, String(visits + 1));

    timers.push(setTimeout(() => {
      if (el.isConnected) el.scrollTo({ left: DISCOVERY_BUMP_PX, behavior: 'smooth' });
    }, 550)); // brief pause so it reads as a hint, not a layout jump on arrival
    timers.push(setTimeout(() => {
      if (el.isConnected) el.scrollTo({ left: 0, behavior: 'smooth' });
    }, 1000));
  });
  ro.observe(el);

  return () => { ro.disconnect(); timers.forEach(clearTimeout); };
}

export function useDragScroll(discoveryId) {
  const teardownRef = useRef(null);
  const drag = useRef({ active: false, startX: 0, scrollLeft: 0 });

  // A callback ref (not a plain ref object) so setup can run whenever the
  // node actually mounts — scroll rails are frequently rendered only once
  // async data has loaded, well after this hook's own first render. It also
  // exposes `.current` on itself (a normal ref object never calls back on
  // mount, so this is the one property external callers rely on, e.g.
  // MySceneScreen's `stripRef.current.children`).
  const ref = useCallback(el => {
    ref.current = el;
    if (teardownRef.current) { teardownRef.current(); teardownRef.current = null; }
    if (el && discoveryId) teardownRef.current = armDiscoveryBump(el, discoveryId);
  }, [discoveryId]);

  const onMouseDown = useCallback(e => {
    drag.current = { active: true, startX: e.pageX - ref.current.offsetLeft, scrollLeft: ref.current.scrollLeft };
    ref.current.style.cursor = 'grabbing';
    ref.current.style.userSelect = 'none';
  }, []);

  const onMouseUp = useCallback(() => {
    drag.current.active = false;
    if (ref.current) {
      ref.current.style.cursor = '';
      ref.current.style.userSelect = '';
    }
  }, []);

  const onMouseMove = useCallback(e => {
    if (!drag.current.active || !ref.current) return;
    e.preventDefault();
    const x = e.pageX - ref.current.offsetLeft;
    const walk = (x - drag.current.startX) * 1.2;
    ref.current.scrollLeft = drag.current.scrollLeft - walk;
  }, []);

  const onMouseLeave = useCallback(() => {
    drag.current.active = false;
    if (ref.current) {
      ref.current.style.cursor = '';
      ref.current.style.userSelect = '';
    }
  }, []);

  return { ref, onMouseDown, onMouseUp, onMouseMove, onMouseLeave };
}
