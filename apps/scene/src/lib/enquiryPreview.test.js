import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildEnquiryPreview,
  previewCompleteness,
  ENQUIRY_PREVIEW_COLUMNS,
  NOT_PROVIDED,
} from './enquiryPreview.js';

/**
 * P8 — the pre-send check's CONTENT.
 *
 * The dialog's only real claim is "this is what they will see". A preview that
 * omits a field the venue can read is worse than no preview at all: it tells
 * someone their fee is private when it is not.
 */

const FULL = {
  id: 'p1', name: 'Dusky Waters', tagline: 'Rock trio, loud rooms',
  location: 'Bellingen', suburb: 'Bellingen', state: 'NSW',
  genre_string: 'Rock · Jazz', sound: 'Warm', years: '9',
  bio: 'Nine years of loud rooms.', mix_link: 'https://mix/x',
  fee: '450', fee_type: 'per set', contact_email: 'band@example.com',
};

test('every row the venue can read is present in the preview', () => {
  const keys = buildEnquiryPreview(FULL).map(r => r.key);
  for (const k of ['name','tagline','location','genres','sound','years','bio','mix','fee','email']) {
    assert.ok(keys.includes(k), `${k} is sent to the venue but never shown in the check`);
  }
});

test('a missing field is SHOWN as not provided, never hidden', () => {
  const rows = buildEnquiryPreview({ name: 'Solo Act' });
  const bio = rows.find(r => r.key === 'bio');
  assert.equal(bio.present, false);
  assert.equal(bio.value, NOT_PROVIDED);
  assert.equal(rows.length, buildEnquiryPreview(FULL).length,
    'a sparse profile renders fewer rows — you cannot fix what you cannot see');
});

test('whitespace is not a value', () => {
  const rows = buildEnquiryPreview({ name: '   ', bio: '\n' });
  assert.equal(rows.find(r => r.key === 'name').present, false);
  assert.equal(rows.find(r => r.key === 'bio').present, false);
});

/**
 * 'N/A' is a real answer — Rendering Contract R1, the same rule the
 * requirements verdict follows. Someone who declined to give a website has
 * ANSWERED; showing "Not provided" would push them to invent one.
 */
test("'N/A' is shown as the answer it is, not as a gap", () => {
  const row = buildEnquiryPreview({ contact_email: 'N/A' }).find(r => r.key === 'email');
  assert.equal(row.present, true);
  assert.equal(row.value, 'N/A');
});

test('the fee carries its type, because the number alone misleads', () => {
  assert.equal(buildEnquiryPreview(FULL).find(r => r.key === 'fee').value, '450 · per set');
  assert.equal(buildEnquiryPreview({ fee: '450' }).find(r => r.key === 'fee').value, '450');
  assert.equal(buildEnquiryPreview({ fee: 'N/A', fee_type: 'per set' }).find(r => r.key === 'fee').present, false,
    'a declined fee must not read as "N/A · per set"');
});

test('a null profile yields a full list of gaps rather than throwing', () => {
  const rows = buildEnquiryPreview(null);
  assert.ok(rows.length > 0);
  assert.ok(rows.every(r => r.present === false && r.value === NOT_PROVIDED));
});

test('completeness counts filled rows and never gates anything', () => {
  assert.deepEqual(previewCompleteness(buildEnquiryPreview({ name: 'X' })), { filled: 1, total: 10 });
  assert.deepEqual(previewCompleteness([]), { filled: 0, total: 0 });
  assert.deepEqual(previewCompleteness(null), { filled: 0, total: 0 });
});

/**
 * ⚠ THE CONTRACT THAT KEEPS THE PROMISE HONEST. EnquiryCard declares the
 * columns the venue actually reads. Every field the preview claims to show must
 * be one the card can display — otherwise the dialog is describing a different
 * message than the one being sent.
 */
test('the preview only claims fields EnquiryCard actually reads', () => {
  const card = readFileSync(fileURLToPath(new URL('../components/EnquiryCard.jsx', import.meta.url)), 'utf8');
  const block = card.slice(card.indexOf('ENQUIRY_CARD_COLUMNS'), card.indexOf('])]'));
  const shown = ['name','tagline','location','genre_string','sound','years','bio','mix_link','fee','fee_type','contact_email'];
  for (const col of shown) {
    assert.ok(block.includes(`'${col}'`),
      `the check shows ${col}, but EnquiryCard does not read it — the preview is describing a different message`);
  }
});

test('the fetch list covers every column the projection reads', () => {
  for (const col of ['name','tagline','location','suburb','state','genre_string','sound','years','bio','mix_link','fee','fee_type','contact_email']) {
    assert.ok(ENQUIRY_PREVIEW_COLUMNS.includes(col),
      `${col} is rendered but never fetched — it would always read as Not provided`);
  }
});
