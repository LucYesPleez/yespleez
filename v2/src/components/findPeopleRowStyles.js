/**
 * ROW STYLES FOR THE FIND PEOPLE SHEET.
 *
 * ⚠ DELIBERATELY A COPY OF ProfileMenu.module.css `.item` (owner, 2026-08-05:
 * "make the fonts all feel the same as the settings menu"). The sheet renders
 * inside that menu's popover, so its rows must read as more of the same list —
 * 13.5px, --text, 10px padding, 9px radius — not as a differently-designed
 * component that happens to be nearby.
 *
 * ⚠ A COPY, NOT AN IMPORT, AND THAT IS NOT AN OVERSIGHT. `.item` is a
 * CSS-module class: its real name is content-hashed at build time, so it cannot
 * be applied to elements outside the file that owns it. If `.item` changes,
 * change these to match — they are pinned to it by intent, not by machinery.
 *
 * ⚠ ITS OWN FILE so PhoneNumberSettings and InviteRows can both have it without
 * either exporting non-components. Three style exports on a 545-line component
 * cost that file its Fast Refresh — every edit became a full page reload, which
 * is felt immediately when the thing you are editing lives three clicks deep
 * inside a menu you then have to reopen.
 */

/** The pressable row itself. */
export const summaryRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  padding: '10px 10px',
  marginTop: 2,
  background: 'none',
  border: 'none',
  borderRadius: 9,
  color: 'var(--text)',
  fontSize: 13.5,
  cursor: 'pointer',
  textAlign: 'left',
};

/** The row's own name. Matches `.item`'s text; no Bebas, no caps. */
export const rowLabel = { fontSize: 13.5, color: 'var(--text)' };

/** The affordance at the row's end — "Settings", "Share". */
export const rowAction = {
  marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5,
  color: 'var(--muted)', fontSize: 12,
};
