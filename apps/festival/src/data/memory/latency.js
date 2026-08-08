/**
 * A deliberate, small delay on every in-memory read.
 *
 * ⭐ NOT padding — it is the only way the loading states get exercised. A mock
 * that resolves synchronously means `LoadingState` never renders in
 * development, and the first time anyone sees it is against a real network,
 * which is the worst moment to discover that a skeleton is the wrong height
 * or that a spinner flashes for 40ms and looks like a glitch.
 *
 * Short enough not to be waited on, long enough for a human to see the state
 * exists. Set `?nolatency` on the URL to switch it off while clicking around.
 */
const DEFAULT_MS = 220;

const disabled = typeof window !== 'undefined'
  && window.location.search.includes('nolatency');

export function settle(value, ms = DEFAULT_MS) {
  if (disabled) return Promise.resolve(value);
  return new Promise(resolve => setTimeout(() => resolve(value), ms));
}
