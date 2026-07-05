import { useRef, useCallback } from 'react';

export function useDragScroll() {
  const ref = useRef(null);
  const drag = useRef({ active: false, startX: 0, scrollLeft: 0 });

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
