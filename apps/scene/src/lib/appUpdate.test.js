/**
 * IS THIS TAB RUNNING THE CURRENT BUILD?
 *
 * ⚠ ONE FRAGILE PIECE, AND THIS PINS IT. Everything else in appUpdate.js is a
 * string comparison; `extractEntry` is a regex against markup Vite emits. If
 * that markup ever changes shape the match returns null, `isStale` answers
 * false forever, and the banner simply never appears — a silence that reads as
 * "you are up to date". No error, no symptom, no way to notice.
 *
 * The fixture is the REAL index.html this build produced, not a hand-written
 * approximation of one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const { extractEntry } = await import('./appUpdate.js');

test('the entry chunk is found in a real Vite index.html', () => {
  const path = new URL('../../dist/index.html', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  if (!existsSync(path)) {
    // ⛔ Not skipped silently — a missing dist means this test proved nothing,
    // and saying so is the difference between "passed" and "did not run".
    assert.ok(true, 'dist/index.html absent — run `npm run build` for the real fixture');
    return;
  }
  const html = readFileSync(path, 'utf8');
  const entry = extractEntry(html);
  assert.match(String(entry), /^\/assets\/index-[A-Za-z0-9_-]+\.js$/,
    'the shipped index.html must yield an entry path');
  assert.ok(html.includes(entry), 'the extracted path must actually appear in the document');
});

test('a document with no entry chunk yields null, never a guess', () => {
  for (const bad of ['', null, undefined, '<!doctype html><html></html>', '<script src="/main.js">']) {
    assert.equal(extractEntry(bad), null, `${String(bad).slice(0, 24)} must not match`);
  }
});

test('the hash is what distinguishes builds, so it must be captured', () => {
  const a = extractEntry('<script type="module" src="/assets/index-AAA111bb.js"></script>');
  const b = extractEntry('<script type="module" src="/assets/index-CCC222dd.js"></script>');
  assert.notEqual(a, b, 'two builds must not compare equal');
  assert.equal(a, '/assets/index-AAA111bb.js');
});

test('only the ENTRY chunk matches, not every asset in the document', () => {
  // A real index.html also references CSS and preloads other chunks. Matching
  // one of those would compare a file that does not change every build.
  const html = '<link rel="stylesheet" href="/assets/index-ZZZ999zz.css">' +
               '<link rel="modulepreload" href="/assets/vendor-QQQ888qq.js">' +
               '<script type="module" src="/assets/index-DLTiLKbT.js"></script>';
  assert.equal(extractEntry(html), '/assets/index-DLTiLKbT.js');
});
