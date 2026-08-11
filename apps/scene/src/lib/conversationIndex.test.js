import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// ⚠ conversationIndex.js imports isPlayableAudio from messageFiles.js, which
// imports supabase.js at module scope — and that file reads import.meta.env,
// which exists under Vite and not under plain Node. Same trap messageFiles
// itself hit; same fix: mock the module before anything transitively imports
// it, so this file never needs to know messageFiles has a network dependency
// at all.
mock.module('./supabase', {
  exports: { supabase: { storage: { from: () => ({}) } } },
});

const {
  isMediaMessage, isFileMessage, mediaEntries, fileEntries,
  firstUrl, linkEntries, searchMessages,
} = await import('./conversationIndex.js');

const T = (kind, over = {}) => ({
  id: over.id ?? Math.random().toString(36),
  kind, body: '', created_at: '2026-01-01T00:00:00Z', payload: {}, ...over,
});

// ── MEDIA vs FILES: THE SPLIT MATCHES FileMessage'S OWN JUDGEMENT ─────

test('photos and voiceys are media', () => {
  assert.equal(isMediaMessage(T('image')), true);
  assert.equal(isMediaMessage(T('voice')), true);
});

test('⚠ an audio FILE is media; a document FILE is not — same predicate FileMessage uses', () => {
  const wav = T('file', { payload: { name: 'master.wav', mime: 'audio/wav' } });
  const pdf = T('file', { payload: { name: 'rider.pdf', mime: 'application/pdf' } });

  assert.equal(isMediaMessage(wav), true, 'a played-back file belongs beside photos and Voiceys');
  assert.equal(isFileMessage(wav), false, 'and must not ALSO appear in Files');

  assert.equal(isMediaMessage(pdf), false);
  assert.equal(isFileMessage(pdf), true);
});

test('text and hand messages are neither', () => {
  assert.equal(isMediaMessage(T('text')), false);
  assert.equal(isFileMessage(T('text')), false);
  assert.equal(isMediaMessage(T('hand')), false);
});

test('⚠ every file message is EXACTLY one of media or files, never both, never neither', () => {
  const cases = [
    T('file', { payload: { name: 'a.wav', mime: 'audio/wav' } }),
    T('file', { payload: { name: 'a.pdf', mime: 'application/pdf' } }),
    T('file', { payload: { name: 'a.aiff', mime: 'audio/aiff' } }),
    T('file', { payload: {} }),   // no name, no mime — still must land somewhere decidable
  ];
  for (const m of cases) {
    assert.equal(isMediaMessage(m) !== isFileMessage(m), true, JSON.stringify(m.payload));
  }
});

test('entries are ordered newest first', () => {
  const old = T('image', { id: 'old', created_at: '2026-01-01T00:00:00Z' });
  const recent = T('image', { id: 'new', created_at: '2026-06-01T00:00:00Z' });
  const entries = mediaEntries([old, recent]);
  assert.equal(entries[0].id, 'new');
});

test('fileEntries never leaks a media message in', () => {
  const wav = T('file', { payload: { name: 'a.wav', mime: 'audio/wav' } });
  const pdf = T('file', { payload: { name: 'a.pdf' } });
  const out = fileEntries([wav, pdf]);
  assert.deepEqual(out.map(m => m.id), [pdf.id]);
});

// ── LINKS ──────────────────────────────────────────────────────────────

test('finds a plain url in prose', () => {
  assert.equal(firstUrl('check this out https://soundcloud.com/x/y please'), 'https://soundcloud.com/x/y');
});

test('⚠ trailing sentence punctuation is not part of the address', () => {
  assert.equal(firstUrl('see https://example.com/x.'), 'https://example.com/x');
  assert.equal(firstUrl('link: https://example.com/x!'), 'https://example.com/x');
});

test('no url returns null, not an empty match', () => {
  assert.equal(firstUrl('no links here'), null);
  assert.equal(firstUrl(''), null);
  assert.equal(firstUrl(null), null);
});

test('⚠ one entry per MESSAGE, not per url — a message is one thing said', () => {
  const many = T('text', { body: 'https://a.com and also https://b.com and https://c.com' });
  const out = linkEntries([many]);
  assert.equal(out.length, 1);
  assert.equal(out[0].url, 'https://a.com', 'the first link represents the message');
});

/**
 * ⛔⛔ ONE DEFINITION OF "WHAT IS A LINK". This list used to carry its own
 * scheme-only regex; the moment the thread began auto-linking bare domains the
 * two disagreed on exactly the case the feature was asked for — "Check
 * yespleez.com" was clickable in the bubble and absent from this list.
 */
test('⛔ the Links list and the thread agree on what a link is', async () => {
  const { linkify } = await import('./linkify.js');
  ['Check out yespleez.com — this is the new site.',
   'www.bellobrewery.com.au/whats-on',
   'https://soundcloud.com/x/y',
   'README.md is not a link',
   'lucious.aus@gmail.com',
   'no links here'].forEach(body => {
    const fromThread = linkify(body).find(t => t.type === 'url')?.href ?? null;
    assert.equal(firstUrl(body), fromThread, `disagreement on: ${body}`);
  });
});

test('a bare domain now reaches the Links list', () => {
  assert.equal(firstUrl('Check out yespleez.com — this is the new site.'), 'https://yespleez.com');
});

/**
 * ⭐ LOAD BEARING: `LinkRow` feeds this value to `new URL(url).hostname` (which
 * THROWS on a bare domain) and to `href` (where a bare domain is a RELATIVE
 * path and would navigate inside the app). It must always carry a scheme.
 */
test('⭐ every returned url is absolute, so the row can open it', () => {
  ['yespleez.com', 'www.abc.net/x', 'https://x.io/p'].forEach(body => {
    const u = firstUrl(body);
    assert.match(u, /^https?:\/\//, `${body} produced a relative url`);
    assert.doesNotThrow(() => new URL(u), `${body} produced a url LinkRow cannot parse`);
  });
});

test('⛔ a filename in a message never becomes a listed link', () => {
  assert.equal(firstUrl('sent you README.md and script.sh'), null);
});

test('messages with no link are absent from the list entirely', () => {
  const out = linkEntries([T('text', { body: 'no link' }), T('text', { body: 'https://x.com' })]);
  assert.equal(out.length, 1);
});

// ── SEARCH ─────────────────────────────────────────────────────────────

test('search is case-insensitive over the body', () => {
  const m = T('text', { body: 'The Gate Code Is 2487' });
  assert.equal(searchMessages([m], 'gate code').length, 1);
});

test('⚠ search also reaches a FILENAME, not only message text', () => {
  const m = T('file', { body: 'rider-2026.pdf', payload: { name: 'rider-2026.pdf' } });
  assert.equal(searchMessages([m], 'rider').length, 1);
});

test('an empty query returns nothing rather than everything', () => {
  assert.deepEqual(searchMessages([T('text', { body: 'anything' })], ''), []);
  assert.deepEqual(searchMessages([T('text', { body: 'anything' })], '   '), []);
});

test('no match is an empty result, not a throw', () => {
  assert.deepEqual(searchMessages([T('text', { body: 'hello' })], 'xyz'), []);
});
