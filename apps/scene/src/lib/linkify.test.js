import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { linkify, hrefFor } from './linkify.js';

const KINDS_SRC = readFileSync(fileURLToPath(new URL('./messageKinds.jsx', import.meta.url)), 'utf8');
const RENDER_TEXT = KINDS_SRC.slice(
  KINDS_SRC.indexOf('function renderText'),
  KINDS_SRC.indexOf('function renderFallback'));

/**
 * ⭐ A URL TYPED INTO A MESSAGE MUST BE CLICKABLE ON SIGHT — no menu, no long
 * press. And ⭐ PEOPLE DO NOT TYPE THE PROTOCOL (owner, 2026-08-11): "Check
 * yespleez.com" is how a human writes an address, so a bare domain links.
 *
 * ⛔ The cost of accepting bare domains is that filenames look exactly like
 * them, which is what most of these tests are about.
 */

const urls = s => linkify(s).filter(t => t.type === 'url');
const hrefs = s => urls(s).map(t => t.href);
const rebuild = s => linkify(s).map(t => t.value).join('');

// ── The four shapes that must link ──────────────────────────────────────────

test('every ordinary way of writing an address links', () => {
  assert.equal(hrefFor('https://yespleez.com'), 'https://yespleez.com');
  assert.equal(hrefFor('http://yespleez.com'),  'http://yespleez.com');
  assert.equal(hrefFor('www.yespleez.com'),     'https://www.yespleez.com');
  assert.equal(hrefFor('yespleez.com'),         'https://yespleez.com');
});

test('paths, queries and fragments survive', () => {
  assert.equal(hrefFor('https://yespleez.com/events/123'), 'https://yespleez.com/events/123');
  assert.equal(hrefFor('yespleez.com/events/123'), 'https://yespleez.com/events/123');
  assert.equal(hrefFor('example.com/a?b=1&c=2#d'), 'https://example.com/a?b=1&c=2#d');
});

test('a co.uk / com.au style host links', () => {
  assert.ok(hrefFor('yespleez.com.au'));
  assert.ok(hrefFor('bbc.co.uk'));
});

// ── ⛔ The file-extension collision ─────────────────────────────────────────

/**
 * ⛔⛔ `.md`, `.sh`, `.rs` and `.zip` are all REAL top-level domains. A "dot
 * plus letters" rule turns every filename anyone mentions into a link, which
 * is why bare domains are checked against an allowlist that omits them.
 */
test('⛔ filenames are never links', () => {
  ['somefile.html', 'index.html', 'README.md', 'script.sh', 'main.rs',
   'photo.zip', 'notes.txt', 'app.js', 'style.css', 'data.json',
   'clip.mov', 'logo.ai'].forEach(f =>
    assert.equal(hrefFor(f), null, `${f} became a link`));
});

/**
 * ⭐ …but typing a scheme or `www.` is unambiguous intent, so it links even
 * when the TLD is one we refuse bare.
 */
test('an explicit scheme overrides the bare-domain allowlist', () => {
  assert.equal(hrefFor('https://foo.md'), 'https://foo.md');
  assert.equal(hrefFor('www.foo.md'), 'https://www.foo.md');
});

// ── ⛔ Unsafe schemes ───────────────────────────────────────────────────────

/**
 * ⛔⛔ THE INJECTION CASE. These must never become an href, whatever they look
 * like. The renderer is React elements rather than HTML, so this is the second
 * line of defence, not the only one.
 */
test('⛔ unsafe schemes never become links', () => {
  ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html;base64,AAA',
   'vbscript:msgbox', 'file:///etc/passwd', 'about:blank'].forEach(s =>
    assert.equal(hrefFor(s), null, `${s} became a link`));
});

test('mailto and tel are out of scope, not links', () => {
  assert.equal(hrefFor('mailto:lucious.aus@gmail.com'), null);
  assert.equal(hrefFor('tel:+61400000000'), null);
});

// ── ⚠ The email trap ───────────────────────────────────────────────────────

/**
 * ⚠⚠ Without the email check, a naive bare-domain matcher pulls `gmail.com`
 * out of the middle of somebody's address and links THAT.
 */
test('⚠ an email address yields no link at all', () => {
  assert.equal(hrefFor('lucious.aus@gmail.com'), null);
  assert.deepEqual(hrefs('email me at lucious.aus@gmail.com thanks'), []);
});

// ── Boundaries in real sentences ───────────────────────────────────────────

test('trailing sentence punctuation is not part of the address', () => {
  assert.deepEqual(hrefs('Check yespleez.com.'), ['https://yespleez.com']);
  assert.deepEqual(hrefs('Check yespleez.com, then call'), ['https://yespleez.com']);
  assert.deepEqual(hrefs('yespleez.com!'), ['https://yespleez.com']);
  assert.deepEqual(hrefs('yespleez.com…'), ['https://yespleez.com']);
});

test('a parenthetical keeps its brackets out of the link', () => {
  assert.deepEqual(hrefs('(see yespleez.com)'), ['https://yespleez.com']);
});

/**
 * ⭐ …but a bracket that is PART of the address survives, which is the case
 * Wikipedia produces constantly.
 */
test('balanced brackets inside a path are kept', () => {
  assert.deepEqual(hrefs('https://en.wikipedia.org/wiki/Bell_(disambiguation)'),
    ['https://en.wikipedia.org/wiki/Bell_(disambiguation)']);
});

test('the owner\'s example sentence, exactly', () => {
  const t = linkify('Check out yespleez.com — this is the new site.');
  assert.deepEqual(t.filter(x => x.type === 'url').map(x => x.value), ['yespleez.com']);
  assert.equal(rebuild('Check out yespleez.com — this is the new site.'),
    'Check out yespleez.com — this is the new site.');
});

// ── ⛔ Ordinary writing must stay plain ─────────────────────────────────────

test('⛔ prose that merely resembles an address stays text', () => {
  ['e.g.', 'i.e.', 'etc.', 'Node.js', 'v1.2.3', '3.5', 'Mr.Smith',
   'one.two.three.four.five'].forEach(s =>
    assert.equal(hrefFor(s), null, `${s} became a link`));
});

test('⛔ a bare IP-looking string is not linked', () => {
  assert.equal(hrefFor('192.168.1.1'), null);
});

// ── Structure ──────────────────────────────────────────────────────────────

test('several addresses in one message all link', () => {
  assert.deepEqual(hrefs('yespleez.com and www.abc.net and https://x.io/p'), [
    'https://yespleez.com', 'https://www.abc.net', 'https://x.io/p',
  ]);
});

/**
 * ⭐⭐ THE ORIGINAL TEXT IS ALWAYS RECOVERABLE. `message.body` remains the one
 * source for copy, notification previews and screen readers — this tokeniser
 * must never normalise or drop anything.
 */
test('⭐ concatenating the tokens returns the input exactly', () => {
  [
    'Check out yespleez.com — this is the new site.',
    '  leading and trailing  ',
    'line one\nline two with x.com\n\nline four',
    'no links here at all',
    '(see yespleez.com) and lucious.aus@gmail.com',
    '',
  ].forEach(s => assert.equal(rebuild(s), s, `round trip failed for ${JSON.stringify(s)}`));
});

test('newlines and runs of spaces survive as text tokens', () => {
  const t = linkify('a\n\nb   c');
  assert.equal(t.map(x => x.value).join(''), 'a\n\nb   c');
  assert.equal(t.filter(x => x.type === 'url').length, 0);
});

test('non-strings and empty input are handled, never thrown on', () => {
  [null, undefined, 42, {}, []].forEach(v => assert.deepEqual(linkify(v), []));
  assert.deepEqual(linkify(''), []);
});

/**
 * ⛔ The tokeniser returns DATA, never markup — the renderer maps it onto React
 * elements, so nothing here can become executable.
 */
test('⛔ tokens carry no markup, only values and hrefs', () => {
  linkify('<script>alert(1)</script> and yespleez.com').forEach(t => {
    assert.ok(['text', 'url'].includes(t.type));
    assert.deepEqual(Object.keys(t).sort(),
      t.type === 'url' ? ['href', 'type', 'value'] : ['type', 'value']);
  });
});

test('angle-bracketed text is left alone as text', () => {
  const t = linkify('<script>alert(1)</script>');
  assert.equal(t.filter(x => x.type === 'url').length, 0);
  assert.equal(rebuild('<script>alert(1)</script>'), '<script>alert(1)</script>');
});

// ── The renderer's contract ────────────────────────────────────────────────

/**
 * ⛔⛔ THE ONE THAT MATTERS. Auto-linking text other people wrote becomes a
 * script-injection surface the moment it goes through an HTML string. React
 * elements only — for the whole file, not just this function.
 */
test('⛔ message text is never rendered as HTML', () => {
  // ⚠ Keyed on the JSX ATTRIBUTE, not the bare word — the first version of
  // this test failed on the comment above `renderText` explaining why the API
  // is not used. A rule that trips over its own documentation is a rule people
  // learn to delete.
  assert.doesNotMatch(KINDS_SRC, /dangerouslySetInnerHTML\s*=/,
    'a message kind is building HTML from content someone else typed');
});

test('renderText builds links from the tokeniser, not its own regex', () => {
  assert.match(RENDER_TEXT, /linkify\(message\.body\)/);
  assert.doesNotMatch(RENDER_TEXT, /https?:\\?\/\\?\//,
    'the renderer has grown its own URL matching beside the tokeniser');
});

/**
 * ⛔ Without `noopener` the opened page gets a handle on this one through
 * `window.opener`.
 */
test('⛔ every link opens with noopener noreferrer', () => {
  assert.match(RENDER_TEXT, /rel="noopener noreferrer"/);
  assert.match(RENDER_TEXT, /target="_blank"/);
});

/**
 * ⚠ MessageBubble treats a tap as its own gesture. Without this the link tap
 * fires both — see the long-press block in ConversationView.
 */
test('⚠ a link tap does not also fire the bubble', () => {
  assert.match(RENDER_TEXT, /onClick=\{e => e\.stopPropagation\(\)\}/);
});

/**
 * ⭐ `message.body` stays the one authoritative string — copy, notification
 * previews and screen readers all read it.
 */
test('⭐ the renderer never rewrites the body', () => {
  assert.doesNotMatch(RENDER_TEXT, /message\.body\s*=/, 'the body is being mutated');
  assert.doesNotMatch(RENDER_TEXT, /\.replace\(/, 'the body is being rewritten before display');
});
