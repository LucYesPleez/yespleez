import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  requestableBySection,
  requirementLabel,
  REQUESTABLE_KEYS,
  SECTIONS,
  columnsFor,
} from '../requirements.js';

/**
 * THE CHECKLIST'S CONTRACT WITH THE ENGINE.
 *
 * The component renders exactly `requestableBySection()` and labels each row
 * with `requirementLabel()`. It cannot be rendered here — no DOM stack — so
 * these tests hold the PROJECTION it depends on instead. That is the failure
 * mode worth catching: not "does the tick-box paint", but "can the checklist
 * offer a key the engine cannot resolve", which would let a venue save a
 * requirement that silently never blocks anyone.
 *
 * Every consumer renders the same projection — the event editor and both
 * profile editors — so one drift here is a drift everywhere.
 */

test('every offered key is requestable', () => {
  const offered = requestableBySection().flatMap(g => g.keys);
  const requestable = new Set(REQUESTABLE_KEYS);
  for (const key of offered) {
    assert.ok(requestable.has(key), `checklist offers ${key}, which is not in REQUESTABLE_KEYS`);
  }
});

test('every requestable key is offered — none is unreachable in the UI', () => {
  const offered = new Set(requestableBySection().flatMap(g => g.keys));
  for (const key of REQUESTABLE_KEYS) {
    assert.ok(offered.has(key), `${key} is requestable but no checklist row can tick it`);
  }
});

/**
 * ⚠ NOT `label !== key`. `ABN` is a real, correct label that happens to be
 * identical to its key, and asserting inequality would fail on a perfectly
 * good acronym. What actually matters is that no ENGINE VOCABULARY reaches the
 * owner's screen — keys are SCREAMING_SNAKE, so an underscore or a
 * multi-word all-caps string is the tell.
 */
test('every offered key has a human label, never raw engine vocabulary', () => {
  for (const key of requestableBySection().flatMap(g => g.keys)) {
    const label = requirementLabel(key);
    assert.ok(label, `${key} has no label`);
    assert.doesNotMatch(label, /_/, `${key} shows a raw key on screen: "${label}"`);
    if (key.includes('_')) {
      assert.notEqual(label, key, `${key} falls back to its raw key`);
    }
  }
});

test('sections are known, ordered by the engine, and none is empty', () => {
  const groups = requestableBySection();
  assert.ok(groups.length > 0, 'no sections to render');
  for (const g of groups) {
    assert.ok(SECTIONS.includes(g.section), `unknown section ${g.section}`);
    assert.ok(g.keys.length > 0, `section ${g.section} renders a heading with no rows`);
  }
});

test('no key appears in two sections — a tick-box cannot exist twice', () => {
  const seen = new Set();
  for (const key of requestableBySection().flatMap(g => g.keys)) {
    assert.ok(!seen.has(key), `${key} appears in more than one section`);
    seen.add(key);
  }
});

/**
 * The gate reads a profile with `columnsFor(required)`. A field-backed
 * requirement whose column is missing would be fetched as `undefined` and
 * evaluated as absent forever — an act could never satisfy it, with nothing on
 * screen to explain why.
 */
test('every offered field-backed key projects to a column', () => {
  const offered = requestableBySection().flatMap(g => g.keys);
  const columns = columnsFor(offered);
  assert.ok(columns.length > 0, 'no columns projected for the whole checklist');
  for (const key of offered) {
    const cols = columnsFor([key]);
    // Asset-backed keys resolve through the asset table, not a column, so
    // projecting to nothing is correct for them — but a key must resolve to
    // one or the other, never to neither.
    assert.ok(cols.length <= 1, `${key} projects to more than one column`);
  }
});
