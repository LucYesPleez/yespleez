import { CATEGORIES } from '../config/categories';

/**
 * How many people an audience reaches.
 *
 * ⛔ Arithmetic, not a query. It sums counts already on screen; it does not
 * resolve an audience. Status narrowing has no counts to sum yet, and the
 * caller says so rather than inventing a figure — a confidently wrong
 * recipient count is worse than an honest "not narrowed yet", because the
 * number is the one thing someone checks before an irreversible send.
 *
 * Its own module: a file exporting both a component and a function breaks
 * React Fast Refresh, and this is used by two components.
 */
export function recipientCount(categoryKeys = []) {
  if (!categoryKeys.length) return CATEGORIES.reduce((n, c) => n + c.count, 0);
  return CATEGORIES
    .filter(c => categoryKeys.includes(c.key))
    .reduce((n, c) => n + c.count, 0);
}
