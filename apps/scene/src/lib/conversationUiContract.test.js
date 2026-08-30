import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * ⛔⛔ EVERY NAME DESTRUCTURED FROM `useConversationUi()` MUST EXIST ON IT.
 *
 * `EnquiryDossierSheet` pulled `{ openConversation }` while the context exports
 * `open`. JavaScript answers a missing key with `undefined` rather than an
 * error, so the call site type-checked fine, rendered fine, and failed only
 * when pressed — and it failed SILENTLY, because the call sat in an async
 * function after `onClose()`. REPLY and MESSAGE closed the sheet and did
 * nothing else. A venue could not answer an enquiry at all.
 *
 * ⭐ This test exists to kill the CLASS, not the instance: a typo'd or renamed
 * key on any consumer now fails here rather than under someone's thumb.
 */

const srcRoot = fileURLToPath(new URL('..', import.meta.url));

/** The context's own surface, read from the provider rather than restated. */
function contextKeys() {
  const src = readFileSync(new URL('./conversationUi.jsx', import.meta.url), 'utf8');
  // The single `useMemo` that builds the provider value.
  const value = src.slice(src.indexOf('const value = useMemo(('), src.indexOf('}), [openId'));
  const body = value.slice(value.indexOf('{') + 1);
  return new Set(
    body.split(',')
      .map(s => s.split(':')[0].trim())
      .filter(s => /^[A-Za-z_$][\w$]*$/.test(s))
  );
}

/** Every .js/.jsx under src/, recursively. */
function sourceFiles(dir = srcRoot, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') sourceFiles(full, out); }
    else if (/\.jsx?$/.test(entry.name) && !entry.name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

test('the context exposes the keys its consumers rely on', () => {
  const keys = contextKeys();
  for (const expected of ['open', 'openId', 'minimise', 'dismiss', 'getState', 'patch']) {
    assert.ok(keys.has(expected), `the provider no longer exposes \`${expected}\``);
  }
});

test('no consumer destructures a name the context does not have', () => {
  const keys = contextKeys();
  const offenders = [];

  for (const file of sourceFiles()) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('useConversationUi()')) continue;
    // `const { a, b: c } = useConversationUi();` — capture the braces.
    for (const m of src.matchAll(/\{([^{}]*)\}\s*=\s*useConversationUi\(\)/g)) {
      for (const part of m[1].split(',')) {
        const name = part.split(':')[0].trim();
        if (!name) continue;
        if (!keys.has(name)) {
          offenders.push(`${file.slice(srcRoot.length + 1)} destructures \`${name}\``);
        }
      }
    }
  }

  assert.deepEqual(offenders, [],
    `a call site asks the conversation context for something it does not provide, which yields undefined and fails only when pressed:\n  ${offenders.join('\n  ')}`);
});

test('the dossier sheet opens the dock rather than navigating', () => {
  const src = readFileSync(`${srcRoot}/components/EnquiryDossierSheet.jsx`, 'utf8');
  assert.match(src, /open:\s*openConversation/,
    'the dossier must RENAME `open` — the context has no `openConversation` key');
  assert.doesNotMatch(src, /navigate\(\s*[`'"]\/messages/,
    'messaging is a dock, never a navigation — see conversationUi.jsx');
});
