/**
 * THE EMBEDDABLE WIDGET'S CONTRACT — `public/embed/venue-events.js`.
 *
 * ⚠ A SOURCE SWEEP, ⛔ not a render test: this repo has no DOM harness, and the
 * file cannot be imported because it is a static asset (an IIFE served as-is,
 * deliberately outside the app bundle). What a sweep CAN prove is the set of
 * properties that make this file safe to paste into a website we do not
 * control — and every one of them is a property of the SOURCE, not of a render:
 *
 *   ⛔ it carries no key and no session
 *   ⛔ it never writes remote text as markup
 *   ⛔ it never hands a remote string to an href or src unchecked
 *   ⭐ it talks to the public endpoint and links back to the real event page
 *
 * ⚠ It also guards the HTML wrapper, which exists only so an embed builder that
 * takes a URL rather than markup can carry the same widget.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const WIDGET = read('../../public/embed/venue-events.js');
const PAGE = read('../../public/embed/venue-events.html');

/** Prose explaining a hazard must not be able to trip a guard against it. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
const CODE = stripComments(WIDGET);

/* ── no credential of any kind ─────────────────────────────────────────────── */

test('⛔⛔ the widget contains NO Supabase client, url, key or token', () => {
  for (const forbidden of [/supabase/i, /apikey/i, /anon[_-]?key/i, /service[_-]?role/i, /\beyJ/, /Bearer/i]) {
    assert.doesNotMatch(CODE, forbidden,
      `a credential in a file pasted into a third-party CMS is a credential you cannot rotate: ${forbidden}`);
  }
});

test('⛔⛔ the widget depends on no YesPleez session', () => {
  for (const forbidden of [/document\.cookie/, /localStorage/, /sessionStorage/, /credentials\s*:\s*['"](include|same-origin)['"]/, /getSession|auth\./]) {
    assert.doesNotMatch(CODE, forbidden, String(forbidden));
  }
  /* ⭐ Stated rather than defaulted: the request must be byte-identical
     whoever makes it, or the shared cache in front of it is wrong. */
  assert.match(CODE, /credentials\s*:\s*['"]omit['"]/);
});

test('⛔ the widget imports nothing — one <script> tag is the whole integration', () => {
  assert.doesNotMatch(CODE, /\bimport\s/);
  assert.doesNotMatch(CODE, /\brequire\s*\(/);
  assert.doesNotMatch(CODE, /<script/i, 'it must not inject further scripts into the host page');
});

/* ── it cannot be turned into script running in the venue's own origin ─────── */

test('⛔⛔ remote text is never written as markup', () => {
  /* Event names and blurbs are typed by organisers and scraped from posters.
     This code runs inside SOMEBODY ELSE'S SITE, so `<script>` in an event name
     would execute in their origin, against their visitors. */
  /* ⭐ ZERO, not "one for the stylesheet". A <style> takes textContent just as
     happily, so the exception this file used to carry is gone and the rule is
     now absolute — there is no innerHTML here at all to argue about. */
  const innerHtml = CODE.match(/\.innerHTML\s*=/g) || [];
  assert.equal(innerHtml.length, 0, 'no innerHTML at all — stylesheets go in by textContent');
  assert.match(CODE, /el\.textContent = CSS;/);
  assert.match(CODE, /el\.textContent = FRAME_CSS;/);
  assert.doesNotMatch(CODE, /outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(CODE, /\beval\s*\(|new\s+Function\s*\(/);
  /* Everything a reader sees goes through textContent. */
  assert.match(CODE, /node\.textContent\s*=\s*String\(text\)/);
});

test('⛔ every remote URL is scheme-checked before it reaches an href or a src', () => {
  assert.match(CODE, /function safeUrl/);
  assert.match(CODE, /u\.protocol === 'http:' \|\| u\.protocol === 'https:'/,
    'javascript: in an href is the same bug wearing a different hat');
  for (const sink of [/a\.href = href;/, /picture\.src = img;/]) {
    assert.match(CODE, sink);
  }
  assert.match(CODE, /var href = safeUrl\(ev\.url\)/);
  assert.match(CODE, /var img = safeUrl\(ev\.image\)/);
});

test('⛔ an outbound link cannot navigate the venue\'s own window', () => {
  assert.match(CODE, /rel = 'noopener noreferrer'/);
});

/* ── it talks to the public endpoint, and links to the real event page ─────── */

test('⭐ the widget fetches the public venue-events endpoint with the venue id', () => {
  assert.match(CODE, /\/api\/venue-events\?venue=' \+ encodeURIComponent\(venue\)/);
  assert.match(CODE, /getAttribute\('data-yespleez-venue'\)/);
});

test('⭐ the API origin is THIS SCRIPT\'S origin, never the host page\'s', () => {
  /* `window.location.origin` inside an embed is the VENUE'S website. Reading
     the script's own src is what makes one snippet work against production, a
     Pages preview and a local preview with no edit. */
  assert.match(CODE, /document\.currentScript && document\.currentScript\.src/);
  assert.doesNotMatch(CODE, /window\.location\.origin/);
  assert.match(CODE, /return 'https:\/\/yespleez\.com'/, 'and production is the fallback');
});

test('⭐ event links come from the FEED, so they point at the normal public event page', () => {
  /* ⛔ The widget must not build `/#/event/<id>` itself. The feed already
     answers a `url` built from PUBLIC_ORIGIN; a second builder here is how the
     embed and the app come to disagree about where an event lives. */
  assert.doesNotMatch(CODE, /#\/event\//);
  assert.match(CODE, /safeUrl\(ev\.url\)/);
});

test('the widget is responsive — a single column that grows with the space', () => {
  assert.match(CODE, /grid-template-columns:1fr/);
  assert.match(CODE, /@media \(min-width:560px\)/);
  assert.match(CODE, /@media \(min-width:900px\)/);
  assert.match(CODE, /width:100%/);
});

/* ── the card ──────────────────────────────────────────────────────────────── */

test('⭐ the date is a BLOCK — weekday, numeral, month — not a sentence', () => {
  assert.match(CODE, /function dateParts\(iso\)/);
  assert.match(CODE, /el\('span', 'ypz-ve-dow', parts\.dow\)/);
  assert.match(CODE, /el\('span', 'ypz-ve-day', daySpan\(ev, parts\)\)/);
  assert.match(CODE, /el\('span', 'ypz-ve-mon', parts\.mon\)/);
  /* ⚠ Local noon. `new Date('2026-09-11')` is UTC midnight, which is the 10th
     in the Americas — the widget would print a day the poster does not. */
  assert.match(CODE, /new Date\(iso \+ 'T12:00:00'\)/);
});

test('⭐ a little divider rule stands between the date and the heading', () => {
  assert.match(CODE, /\.ypz-ve-date\{[^']*border-right:1px solid\}/);
  /* ⚠ `flex-start`, so the rule is the DATE STACK'S own height. `stretch` would
     run it the full height of the card now the blurb sits in the title column. */
  assert.match(CODE, /\.ypz-ve-head\{display:flex;align-items:flex-start\}/);
  /* Its colour is a theme's business — a black hairline is invisible on dark. */
  for (const theme of ['light', 'open', 'dark', 'plain']) {
    assert.ok(CODE.includes(`.ypz-ve--theme-${theme} .ypz-ve-date{border-right-color:`),
      `${theme} does not colour the divider`);
  }
});

test('⭐ the blurb sits in the TITLE column, aligned to the heading', () => {
  /* Per the comp: the description's left edge is the title's, not the date
     numeral's. The time and place rows below still run the card's full width —
     they describe the event, not the heading. */
  assert.match(CODE, /titles\.appendChild\(el\('p', 'ypz-ve-desc'/);
  assert.doesNotMatch(CODE, /body\.appendChild\(el\('p', 'ypz-ve-desc'/);
});

test('⭐⭐ the time row holds its space when there is no time — and states nothing', () => {
  /* Five of the Federal Hotel's seven upcoming events have no start time. A
     card that omitted the row would sit its venue line and its button a row
     above its neighbours and the grid would read as broken. So the row is
     always emitted; when empty it carries NO icon and NO words, and holds its
     line by min-height alone. ⛔ Reserving space asserts nothing; "TBA" would. */
  assert.match(CODE, /metas\.appendChild\(metaRow\('clock', ev\.start_time \|\| ev\.doors\) \|\| el\('div', 'ypz-ve-meta'\)\)/);
  assert.match(CODE, /metas\.appendChild\(metaRow\('pin', venueLabel\) \|\| el\('div', 'ypz-ve-meta'\)\)/);
  assert.match(CODE, /\.ypz-ve-meta\{[^']*min-height:\d+px\}/);
  /* The empty row is built by `el`, which appends no icon — the icon only ever
     comes from `metaRow`, which returns null when there is no text. */
  assert.match(CODE, /function metaRow\(iconName, text\) \{\s*if \(!text\) return null;/);
});

test('⭐⭐ every zone has a floor, so the cards agree line for line', () => {
  /* A one-line title must not pull the blurb up, and a missing genre must not
     lift the button. The floors equal the clamp ceilings. */
  assert.match(CODE, /\.ypz-ve--layout-grid \.ypz-ve-name\{min-height:[\d.]+em\}/);
  assert.match(CODE, /\.ypz-ve--layout-grid \.ypz-ve-tag\{min-height:[\d.]+em\}/);
  assert.match(CODE, /\.ypz-ve--layout-grid \.ypz-ve-desc\{min-height:[\d.]+em\}/);
  /* Which means genre and blurb are emitted even when empty — a min-height
     reserves nothing for an element that was never created. */
  assert.match(CODE, /titles\.appendChild\(el\('div', 'ypz-ve-tag', genres\)\)/);
  assert.match(CODE, /el\('p', 'ypz-ve-desc', ev\.description \|\| ''\)/);
  /* ⚠ The reservation is a GRID promise: a poster wall and a sidebar list are
     compact by definition, so an empty row there is dead space. */
  assert.match(CODE, /\.ypz-ve--layout-posters \.ypz-ve-meta:empty\{display:none\}/);
  assert.match(CODE, /\.ypz-ve--layout-list \.ypz-ve-meta:empty\{display:none\}/);
});

test('⚠⚠ a filled row is still conditional on its DATA — nothing is invented', () => {
  /* Two of the Federal Hotel's seven upcoming events carry a start time. A
     card that printed "TBA" or an empty clock row for the other five would be
     stating a fact nobody recorded. */
  /* ⚠ The ROW is reserved (see above); its CONTENT is not. `metaRow` returns
     null rather than an icon beside nothing, the date block is drawn only when
     the date parses, and the button only when there is somewhere to go. */
  assert.match(CODE, /function metaRow\(iconName, text\) \{\s*if \(!text\) return null;/);
  assert.match(CODE, /if \(parts\) \{/);
  assert.match(CODE, /if \(href\) body\.appendChild\(el\('span', 'ypz-ve-cta'/);
  assert.match(CODE, /if \(img\) \{/);
  /* ⛔ No placeholder text anywhere — an empty zone stays empty. */
  assert.doesNotMatch(CODE, /'TBA'|'To be announced'|'Time TBC'|'Coming soon'|'Doors TBC'/);
});

test('⛔ the icons are built with createElementNS, NOT an innerHTML string of SVG', () => {
  /* The one innerHTML in this file is the stylesheet; an icon is not worth
     reopening that door. Path data is a constant. */
  assert.match(CODE, /document\.createElementNS\(SVG_NS, 'svg'\)/);
  assert.match(CODE, /document\.createElementNS\(SVG_NS, 'path'\)/);
  assert.match(CODE, /path\.setAttribute\('d', ICONS\[name\]\)/);
  assert.doesNotMatch(CODE, /<svg/);
});

test('⚠ VIEW EVENT is a SPAN — an anchor inside an anchor is invalid', () => {
  /* The whole card is already the link. */
  assert.match(CODE, /el\('span', 'ypz-ve-cta', 'View event'\)/);
  assert.match(CODE, /if \(href\) body\.appendChild\(el\('span', 'ypz-ve-cta'/,
    'no button on a card that has nowhere to go');
});

test('⭐ the footer offers the way back to the venue\'s whole YesPleez page', () => {
  assert.match(CODE, /'See all upcoming at ' \+ data\.venue\.name/);
  assert.match(CODE, /var venueUrl = data\.venue && safeUrl\(data\.venue\.url\)/);
  assert.match(CODE, /if \(venueUrl\) \{/, '⛔ never a dead button when the feed named no url');
  assert.match(CODE, /'Events powered by '/);
});

test('the venue line names the venue and its town, whichever the feed gave', () => {
  assert.match(CODE, /\[venue\.name, venue\.town\]\.filter\(Boolean\)\.join\(', '\)/);
});

test('⛔⛔ the scrollbar is hidden ONLY in a frame that is nothing but this widget', () => {
  /* ⚠ THIS REVERSES AN EARLIER ABSOLUTE. The file used to be forbidden from
     naming `html` or `body` at all, because it drops into pages we do not own
     and their scrollbar is the reader's only clue the page continues. A Wix
     HTML embed is not such a page — it is a frame containing only this widget —
     so the rule becomes a GATE rather than a ban. ⛔ The gate is the whole
     safety property; without it this is the hostile version. */
  assert.match(CODE, /function frameIsOnlyThisWidget\(\)/);
  assert.match(CODE, /if \(!frameIsOnlyThisWidget\(\)\) return;/);

  /* ⛔ BOTH HALVES. Being framed is not enough — a site may frame a page of its
     own — so everything outside our mounts is inspected and any real content
     disqualifies the document. */
  assert.match(CODE, /framed = window\.self !== window\.top/);
  assert.match(CODE, /if \(!framed \|\| !document\.body\) return false/);
  assert.match(CODE, /if \(!inAMount\(content\[i\]\)\) return false/);
  for (const tag of ['img', 'iframe', 'form', 'h1', 'p', 'a', 'button', 'table']) {
    assert.ok(/'img,iframe[^']*'/.test(CODE) && CODE.includes(tag), `${tag} is not screened for`);
  }

  /* ⭐ Checked BEFORE anything renders, while the body still holds only the
     mount and our script tag — afterwards the body is full of our own cards. */
  const startBody = CODE.slice(CODE.indexOf('function start()'));
  assert.ok(startBody.indexOf('hideFrameScrollbar()') < startBody.indexOf('querySelectorAll(SELECTOR)'),
    'the frame test must run before the mounts are filled with our own cards');
});

/* ── the presets ───────────────────────────────────────────────────────────── */

test('⭐ the three option tables are closed sets, not free text', () => {
  assert.match(CODE, /var THEMES = \{ light: 1, open: 1, dark: 1, plain: 1 \}/);
  assert.match(CODE, /var LAYOUTS = \{ grid: 1, posters: 1, list: 1 \}/);
  assert.match(CODE, /var COLUMNS = \{ auto: 1, '1': 1, '2': 1, '3': 1, '4': 1 \}/);
});

test('⭐⭐ an unrecognised option renders the DEFAULT, never an error and never nothing', () => {
  /* A snippet is pasted into a CMS once and never revisited. A typo'd theme
     must look like the standard widget, not like a bug the venue has to
     diagnose on their own homepage. */
  assert.match(CODE, /function pick\(mount, name, allowed, fallback\)/);
  assert.match(CODE, /hasOwnProperty\.call\(allowed, v\) \? v : fallback/);
  assert.match(CODE, /pick\(mount, 'theme', THEMES, 'light'\)/);
  assert.match(CODE, /pick\(mount, 'layout', LAYOUTS, 'grid'\)/);
  assert.match(CODE, /pick\(mount, 'columns', COLUMNS, 'auto'\)/);
});

test('⭐ the LIGHT theme paints its own ground, and DARK deliberately does not', () => {
  /* Light is a cream panel with white cards and real padding — the whitespace
     IS the design, and a widget that inherited a cramped container would lose
     it. Dark paints nothing: a venue choosing it has a dark, usually
     photographic site, and a flat panel would hide the design they chose. */
  assert.match(CODE, /\.ypz-ve--theme-light\{color:#[0-9a-f]{6};background:#[0-9a-f]{6};padding:[\d px]+\}/);
  /* ⚠ More on top than anywhere else: the widget lands under a heading the
     venue wrote, and a grid flush to the panel edge reads as cropped. */
  const lightPad = CODE.match(/\.ypz-ve--theme-light\{[^']*padding:([\d px]+)\}/)[1].trim().split(/\s+/);
  assert.ok(parseInt(lightPad[0], 10) > parseInt(lightPad[2] || lightPad[0], 10),
    'the top padding must exceed the bottom');
  assert.match(CODE, /\.ypz-ve--theme-light \.ypz-ve-card\{background:#fff/);
  assert.match(CODE, /\.ypz-ve--theme-dark\{color:#[0-9a-f]{6};padding:[\d px]+\}/,
    'dark states a colour and NO background — that is the deliberate asymmetry');
  assert.doesNotMatch(CODE, /\.ypz-ve--theme-dark\{[^']*background/,
    "dark must not paint a panel over the venue's own photograph");
});

test('⭐⭐ OPEN states its ink TWICE — outside the card and inside it', () => {
  /* Cream cards on the venue's own dark background. The footer button and the
     credit sit OUTSIDE the cards on that background and need light text; inside
     a card the ground is cream and needs dark. Stating only one is exactly how
     the original default came to be black text over a photograph. */
  assert.match(CODE, /\.ypz-ve--theme-open\{color:#f4f1ec;padding:[\d px]+\}/);
  assert.match(CODE, /\.ypz-ve--theme-open \.ypz-ve-card\{background:#faf8f4;color:#1a1714/);
  /* ⛔ And it paints no ground — that is what separates it from `light`. */
  assert.doesNotMatch(CODE, /\.ypz-ve--theme-open\{[^']*background/);
});

test('⚠ title and blurb are CLAMPED, and the widget never rewrites either', () => {
  /* A comp says "MADSPIN BABY"; the row is called "The Friday Mix Up feat
     MADSPiN BABY 8:30pm" and sets four lines in a quarter-width card. Clamping
     is a display decision. ⛔ Trimming the stored name would be inventing a
     short title on the organiser's behalf. */
  assert.match(CODE, /\.ypz-ve-name\{[^']*-webkit-line-clamp:2/);
  assert.match(CODE, /\.ypz-ve-desc\{[^']*-webkit-line-clamp:4/);
  assert.doesNotMatch(CODE, /ev\.name\.(slice|substring|replace)/,
    'the name is drawn whole and clipped by CSS, never edited');
});

test('⚠ the default theme is LIGHT — a preset must state colour AND background', () => {
  /* The widget shipped transparent-and-inherit, which in an iframe embed
     inherits nothing: black text over whatever photograph is behind it. Every
     theme now states both halves. */
  for (const theme of ['light', 'open', 'dark', 'plain']) {
    assert.ok(CODE.includes(`.ypz-ve--theme-${theme}{color:`), `${theme} states no text colour`);
    assert.ok(CODE.includes(`.ypz-ve--theme-${theme} .ypz-ve-card{background:`), `${theme} states no card background`);
  }
});

test('⛔⛔ NO option is ever interpolated into the stylesheet', () => {
  /* The one innerHTML assigns CSS, and CSS is built from string literals only.
     If an attribute could reach it, an embed could inject arbitrary CSS into
     the page — and the constant-stylesheet guarantee above would be a fiction. */
  const cssBlock = CODE.slice(CODE.indexOf('var CSS = ['), CODE.indexOf('].join(\'\')'));

  /* ⚠ The guard is about MECHANICS, not vocabulary. `theme`, `layout` and
     `accent` appear all over this block as CLASS NAMES and a custom-property
     name, which is exactly right — an earlier version of this test banned the
     words and failed on its own correct code. What must not appear is any way
     to get a runtime value into the string. */
  for (const interpolation of [/`/, /\$\{/, /\+/, /getAttribute/, /\bpick\s*\(/, /\bmount\b/]) {
    assert.doesNotMatch(cssBlock, interpolation,
      `the stylesheet must be string literals only — found ${interpolation}`);
  }

  /* Classes are built by concatenating a FIXED PREFIX with a value that has
     already been looked up in a table — never with raw attribute text. */
  assert.doesNotMatch(CODE, /classList\.add\([^)]*getAttribute/);
});

test('⭐ the accent colour is a custom property behind a hex test, not CSS', () => {
  assert.match(CODE, /var HEX = \/\^#\(\?:\[0-9a-f\]\{3,4\}\|\[0-9a-f\]\{6\}\|\[0-9a-f\]\{8\}\)\$\/i/);
  assert.match(CODE, /if \(HEX\.test\(accent\)\) \{/);
  assert.match(CODE, /mount\.style\.setProperty\('--ypz-ve-accent', accent\)/,
    'setProperty is parsed by the browser and drops a non-colour; string concatenation is not');
  /* Set on the MOUNT, so two widgets on one page can carry different accents. */
  assert.doesNotMatch(CODE, /document\.(documentElement|body)\.style\.setProperty/);
  /* And the sheet consumes it with a fallback, so an unset accent is just the
     text colour rather than a blank rule. */
  assert.match(CODE, /color:var\(--ypz-ve-accent,currentColor\)/);
});

test('⚠ a pinned column count is a MAXIMUM — phones stay single-column', () => {
  /* Every columns rule lives inside a min-width query, so nothing can force
     three cards across a 375px screen. */
  const colRules = CODE.match(/\.ypz-ve--cols-\d[^']*/g) || [];
  assert.ok(colRules.length > 0);
  for (const rule of colRules) {
    const line = CODE.slice(CODE.lastIndexOf("'", CODE.indexOf(rule)), CODE.indexOf(rule));
    assert.match(line, /@media \(min-width:/, `a columns rule outside a media query: ${rule}`);
  }
});

test('⚠ the LIST layout outranks the column rules — a list is one column', () => {
  /* Three classes deep against the column rules' two, so a `columns` attribute
     left in a snippet cannot turn a list back into a grid. */
  assert.match(CODE, /\.ypz-ve\.ypz-ve--layout-list \.ypz-ve-list\{grid-template-columns:1fr/);
});

test('the layouts differ in the ways they claim to', () => {
  assert.match(CODE, /\.ypz-ve--layout-grid \.ypz-ve-img\{aspect-ratio:3\/2\}/);
  assert.match(CODE, /\.ypz-ve--layout-posters \.ypz-ve-img\{aspect-ratio:2\/3\}/);
  /* A poster carries its own bill and date, so the blurb under it repeats the
     picture; a list row has no space for one. */
  assert.match(CODE, /\.ypz-ve--layout-posters \.ypz-ve-desc\{display:none\}/);
  assert.match(CODE, /\.ypz-ve--layout-list \.ypz-ve-desc\{display:none\}/);
  assert.match(CODE, /\.ypz-ve--layout-list \.ypz-ve-card\{flex-direction:row/);
});

test('⛔ the widget cannot restyle the page it lands on', () => {
  const css = CODE.slice(CODE.indexOf('var CSS'), CODE.indexOf('function ensureStyle'));
  /* Every selector is prefixed. A bare `body`, `a` or `*` rule would silently
     redecorate the venue's homepage. */
  const selectors = css.match(/'[^']*\{/g) || [];
  assert.ok(selectors.length > 0);
  for (const sel of selectors) {
    assert.ok(/^'(@media|\.ypz-ve)/.test(sel), `an unprefixed selector escapes into the host page: ${sel}`);
  }
});

test('a failure tells the reader nothing technical', () => {
  /* This renders on somebody else's homepage; a stack trace there is worse
     than a quiet line. */
  assert.match(CODE, /Events are unavailable right now\./);
  assert.doesNotMatch(CODE, /console\.(log|error|warn)/);
});

/* ── the URL-mode wrapper page ─────────────────────────────────────────────── */

test('⭐ the HTML wrapper reuses the widget rather than reimplementing it', () => {
  assert.match(PAGE, /<script src="\.\/venue-events\.js"><\/script>/);
  assert.doesNotMatch(PAGE, /\/api\/venue-events/, 'the wrapper must not grow its own fetch');
  assert.doesNotMatch(PAGE, /#\/event\//);
});

test('⭐ the wrapper hides its scrollbar — and venue-events.js never could', () => {
  /* A bar down the right of an events panel reads as a broken embed. The page
     still scrolls; only the bar is hidden. ⚠ Safe ONLY because the whole
     document IS the widget — hiding it on a page with other content would take
     away the reader's only clue that there is more. */
  assert.match(PAGE, /scrollbar-width: none/);
  assert.match(PAGE, /::-webkit-scrollbar/);

  /* ⚠ `venue-events.js` MAY now hide a scrollbar, but only inside a frame whose
     entire content is this widget — see the dedicated test below. On a real
     website that bar is the reader's only clue the page continues. */
  assert.match(CODE, /var FRAME_CSS = 'html\{scrollbar-width:none/);
});

test('⛔ the wrapper puts the query string in an ATTRIBUTE, never in markup', () => {
  assert.match(PAGE, /setAttribute\('data-yespleez-venue'/);
  assert.doesNotMatch(stripComments(PAGE), /innerHTML|document\.write/);
});

test('⭐ URL mode carries EVERY option the HTML embed takes', () => {
  /* Two ways in, one widget. A builder that only offers "paste a URL" must not
     get a crippled version of the thing. */
  assert.match(PAGE, /\['theme', 'layout', 'columns', 'accent', 'limit'\]/);
  assert.match(PAGE, /setAttribute\('data-yespleez-' \+ name, params\.get\(name\)\)/);
});

test('⛔ the wrapper validates nothing — venue-events.js owns that', () => {
  /* A second opinion on what a valid theme is, is a second thing to disagree
     with the first. The wrapper hands values over; the widget decides. */
  assert.doesNotMatch(stripComments(PAGE), /THEMES|LAYOUTS|COLUMNS|\/\^#/);
});

test('the wrapper is not indexable — it is a fragment, not a page', () => {
  assert.match(PAGE, /<meta name="robots" content="noindex">/);
});
