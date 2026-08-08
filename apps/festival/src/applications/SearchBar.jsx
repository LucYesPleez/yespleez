import { useState, useRef, useEffect } from 'react';
import { Icon } from '../design-system';
import s from './SearchBar.module.css';

/**
 * The search field.
 *
 * ⛔ NO SEARCH LOGIC. It holds its own input value — that is UI state, not
 * business logic — and calls `onChange` so a data layer can subscribe later.
 * It filters nothing.
 *
 * `/` focuses it, which is the one keyboard affordance worth having before
 * the rest of the shortcut set exists: it is how anyone with a large list
 * expects to start. The listener ignores keystrokes while another input has
 * focus, or typing a slash into a note would jump focus away mid-sentence.
 */
export default function SearchBar({ placeholder = 'Search applications…', onChange }) {
  const [value, setValue] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    function onKey(e) {
      if (e.key !== '/') return;
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) return;
      e.preventDefault();
      ref.current?.focus();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function update(next) {
    setValue(next);
    onChange?.(next);
  }

  return (
    <div className={s.wrap}>
      <Icon name="search" size={16} />
      <input
        ref={ref}
        className={s.input}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={e => update(e.target.value)}
      />
      {value ? (
        <button className={s.clear} type="button" onClick={() => update('')} aria-label="Clear search">
          <Icon name="close" size={14} />
        </button>
      ) : (
        <span className={s.hint} aria-hidden="true">/</span>
      )}
    </div>
  );
}
