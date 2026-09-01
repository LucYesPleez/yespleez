/**
 * THE THREE CHANNELS, AS A NAVIGATION AID — ⛔ NOT a fourth settings system.
 *
 * ⚠⚠ THE PROBLEM THIS SOLVES IS DISCOVERABILITY, NOT CONTROL (owner,
 * 2026-09-01: "I opened Settings → Notifications without realising I needed to
 * scroll to find Email"). Two things hid it: the settings are behind a MANAGE
 * press, and the third panel is below the fold. A chip row fixes both by
 * OPENING the panel and SCROLLING to the section.
 *
 * ⛔⛔ THE CHIPS HOLD NO STATE OF THEIR OWN. They are told what each channel is
 * doing by the panel that owns it, and they can only navigate. If a chip ever
 * writes a preference, this has become the second settings system it exists to
 * avoid, and the two will disagree the first time one of them is wrong.
 *
 * ── WHY THIS FILE IS SEPARATE FROM THE COMPONENT ────────────────────
 *
 * The label logic is the only part worth asserting, and a component in this
 * repo can only be tested by reading its source text — which never compiles or
 * renders what it claims to check. Keeping the decision here makes it a real
 * test against the real function.
 */

/**
 * ⭐⭐ IN-APP HAS NO OFF SWITCH, AND SAYING SO IS THE HONEST ANSWER.
 *
 * ⚠ Push can be unsubscribed and email has a master switch, so both have a
 * genuine OFF. In-app does not: NP1's model is that preferences govern delivery
 * PER CATEGORY and nothing turns the feed off wholesale. A chip claiming
 * otherwise would be a control-shaped thing that cannot reach the state it
 * advertises.
 *
 * ⛔ So the in-app chip reads ON permanently, by design rather than by omission.
 * ⚠ If that reads as inert, the honest alternative is a muted COUNT ("2 muted"),
 * ⛔ not a fake OFF — but that is a product decision, not a defect fix.
 */
export const CHANNELS = [
  { key: 'in_app', label: 'In-app', alwaysOn: true },
  { key: 'push',   label: 'Push',   alwaysOn: false },
  { key: 'email',  label: 'Email',  alwaysOn: false },
];

/**
 * What a chip should read, given what the owning panels report.
 *
 * @param {object} state
 * @param {boolean|null} state.push   subscribed on this device; null = unknown
 * @param {boolean|null} state.email  master switch on; null = unknown
 * @returns {Array<{key, label, status, on}>} `status` is the word to render.
 *
 * ⚠ `null` MEANS NOT KNOWN YET, ⛔ and is not the same as OFF. A panel that has
 * not finished loading must not make a chip claim the channel is disabled —
 * that flashes a wrong answer on every visit, and "off" is the answer a reader
 * acts on. Unknown renders as a neutral dash instead.
 */
export function channelChips(state = {}) {
  return CHANNELS.map(c => {
    if (c.alwaysOn) return { ...c, status: 'ON', on: true };
    const v = state[c.key];
    if (v === null || v === undefined) return { ...c, status: '·', on: null };
    return { ...c, status: v ? 'ON' : 'OFF', on: Boolean(v) };
  });
}

/**
 * ⚠ MUST MATCH `.section`'s scroll-margin-top in NotificationsScreen.module.css.
 * The app header is fixed, so a section scrolled to `block:'start'` lands
 * UNDERNEATH it and the heading a reader was sent to find is the one thing they
 * cannot see. ⛔ Do not switch this to a pixel offset computed at call time:
 * scroll-margin-top is honoured by the browser's own smooth scrolling, and a
 * manual `scrollBy` after `scrollIntoView` races it.
 */
export const SECTION_SCROLL_MARGIN = 88;
