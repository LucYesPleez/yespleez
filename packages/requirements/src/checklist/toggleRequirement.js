/**
 * Ticking and unticking, as a function rather than a closure in a component.
 *
 * ⭐ WHY THIS IS NOT INLINE. It was `p => p.includes(key) ? p.filter(...) : [...p, key]`
 * written inside the event editor's JSX, which made it untestable without
 * rendering React — and this monorepo has no DOM test stack. Lifting it out
 * means the one piece of behaviour the checklist actually HAS can be tested by
 * every consumer, and the component keeps only the markup.
 *
 * ⛔ It does not validate keys against the registry. An unknown key is the
 * engine's problem to surface, not this function's to reject — the same
 * fail-open rule the `required_items` columns are unconstrained for. A toggle
 * that silently refused a key would produce a tick-box that does nothing.
 */

/**
 * @param {string[]|null|undefined} selected currently ticked keys
 * @param {string} key the key being toggled
 * @returns {string[]} a NEW array — never the one passed in
 */
export function toggleRequirement(selected, key) {
  const list = Array.isArray(selected) ? selected : [];
  return list.includes(key) ? list.filter(k => k !== key) : [...list, key];
}
