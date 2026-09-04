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
  const innerHtml = CODE.match(/\.innerHTML\s*=/g) || [];
  assert.equal(innerHtml.length, 1, 'exactly one innerHTML is allowed, and it is the stylesheet');
  assert.match(CODE, /el\.innerHTML\s*=\s*CSS;/, 'the one innerHTML assigns the CSS constant, nothing remote');
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

test('⛔ the wrapper puts the query string in an ATTRIBUTE, never in markup', () => {
  assert.match(PAGE, /setAttribute\('data-yespleez-venue'/);
  assert.doesNotMatch(stripComments(PAGE), /innerHTML|document\.write/);
});

test('the wrapper is not indexable — it is a fragment, not a page', () => {
  assert.match(PAGE, /<meta name="robots" content="noindex">/);
});
