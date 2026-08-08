import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * The diagnostics log is the instrument the iOS interruption investigation
 * depends on. If it silently mis-renders, the matrix built from it is wrong
 * and the "obvious" implementation that follows is built on a false picture.
 *
 * localStorage is stubbed rather than mocked away: the module reads it on
 * every call (not at import), so a plain object here exercises the real
 * read/write/trim path.
 */
function installStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  return store;
}

async function freshModule() {
  installStorage();
  // Cache-busted so each test starts with the module's own clock origin reset.
  return import(`./voiceDiagnostics.js?t=${Math.random()}`);
}

test('a gap between heartbeats is called out as a suspended page', async () => {
  // THE MOST DIAGNOSTIC LINE IN THE LOG. The failure being investigated is a
  // recording that kept "running" while the page was frozen — which no event
  // inside the page can report, because nothing inside the page was running.
  // The ABSENCE of samples is the only evidence, so it must be stated, not
  // left for someone to spot by subtracting timestamps.
  const d = await freshModule();

  d.logVoiceSignal('tick', 'sample', { vis: 'visible' });
  const entries = JSON.parse(globalThis.localStorage.getItem('yp_voice_diag'));
  // Simulate a 30s hole: the interval simply did not run.
  entries.push({ ...entries[0], t: entries[0].t + 30000, dt: entries[0].dt + 30000 });
  globalThis.localStorage.setItem('yp_voice_diag', JSON.stringify(entries));

  const out = d.formatVoiceSignals();
  assert.match(out, /NO SAMPLES FOR 30\.0s — PAGE SUSPENDED/);
});

test('consecutive heartbeats one second apart are NOT reported as a gap', async () => {
  // The mutation guard for the test above: a threshold that flagged everything
  // would "pass" it while making every timeline unreadable.
  const d = await freshModule();

  d.logVoiceSignal('tick', 'sample', { vis: 'visible' });
  const entries = JSON.parse(globalThis.localStorage.getItem('yp_voice_diag'));
  entries.push({ ...entries[0], t: entries[0].t + 1000, dt: entries[0].dt + 1000 });
  globalThis.localStorage.setItem('yp_voice_diag', JSON.stringify(entries));

  assert.doesNotMatch(d.formatVoiceSignals(), /PAGE SUSPENDED/);
});

test('⚠ the quiet BETWEEN two recordings is not reported as a suspension', async () => {
  // THE FALSE POSITIVE THE FIRST REAL LOG PRODUCED, twice.
  //
  // The heartbeat only runs while recording, so release→start is silence by
  // design. Comparing ticks across that boundary invented an 8.7s "PAGE
  // SUSPENDED" out of the owner simply not recording — and an instrument that
  // manufactures findings is worse than no instrument, because the matrix
  // built from it looks authoritative.
  const d = await freshModule();

  d.logVoiceSignal('tick', 'sample', { vis: 'visible' });
  d.logVoiceSignal('recorder', 'release', {});
  d.logVoiceSignal('recorder', 'started', {});
  d.logVoiceSignal('tick', 'sample', { vis: 'visible' });

  const entries = JSON.parse(globalThis.localStorage.getItem('yp_voice_diag'));
  // Push the second tick 9s past the first, spanning the boundary.
  entries[3].dt = entries[0].dt + 9000;
  globalThis.localStorage.setItem('yp_voice_diag', JSON.stringify(entries));

  assert.doesNotMatch(d.formatVoiceSignals(), /PAGE SUSPENDED/);
});

test('a gap WITHIN one recording is still reported', async () => {
  // The other half: the boundary reset must not disarm the detector for the
  // case it exists to catch — samples stopping while recording continues.
  const d = await freshModule();

  d.logVoiceSignal('recorder', 'started', {});
  d.logVoiceSignal('tick', 'sample', { vis: 'visible' });
  d.logVoiceSignal('tick', 'sample', { vis: 'visible' });

  const entries = JSON.parse(globalThis.localStorage.getItem('yp_voice_diag'));
  entries[2].dt = entries[1].dt + 9000;
  globalThis.localStorage.setItem('yp_voice_diag', JSON.stringify(entries));

  assert.match(d.formatVoiceSignals(), /NO SAMPLES FOR 9\.0s — PAGE SUSPENDED/);
});

test('a changed heartbeat is marked, an unchanged one is not', async () => {
  // The transitions are what the matrix is built from; they have to be
  // findable by eye in a timeline that is mostly identical rows.
  const d = await freshModule();

  d.logVoiceSignal('tick', 'sample', { vis: 'visible', ctx: 'running' });
  d.logVoiceSignal('tick', 'sample', { vis: 'hidden', ctx: 'interrupted', changed: true });

  const lines = d.formatVoiceSignals().split('\n');
  const changed   = lines.find(l => l.includes('vis=hidden'));
  const unchanged = lines.find(l => l.includes('vis=visible'));

  assert.ok(changed.startsWith('  * '),  'a changed sample must be starred');
  assert.ok(!unchanged.startsWith('  * '), 'an unchanged sample must not be starred');
});

test('every property the investigation asked for survives into the timeline', async () => {
  // Named individually rather than as a count: a renamed key would keep the
  // count and silently drop the value from the report.
  const d = await freshModule();

  d.logVoiceSignal('tick', 'sample', {
    vis: 'visible', ctx: 'running', rec: 'recording',
    trk: 'live', muted: false, enabled: true,
    focus: true, act: false, perf: 1234,
  });

  const out = d.formatVoiceSignals();
  for (const fragment of [
    'vis=visible', 'ctx=running', 'rec=recording',
    'track=live', 'muted=false', 'en=true',
    'focus=true', 'act=false',
  ]) {
    assert.ok(out.includes(fragment), `timeline lost ${fragment}`);
  }
});

test('a scenario marker resets the clock and records the platform', async () => {
  const d = await freshModule();
  // `navigator` is a read-only global from Node 21, so a plain assignment
  // throws. defineProperty is the only way to stand one up here.
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'TestAgent/1.0' }, configurable: true, writable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: {}, configurable: true, writable: true,
  });

  d.markScenario('Incoming phone call');
  const out = d.formatVoiceSignals();

  assert.match(out, /=== Incoming phone call ===/);
  assert.match(out, /TestAgent\/1\.0/);
  // The scenario header must say whether this was an installed PWA: on iOS a
  // browser tab and a home-screen app are different platforms, and a matrix
  // that does not record which one it measured is not a matrix.
  assert.match(out, /standalone=/);
});

test('a corrupt log reads as empty rather than throwing into the audio path', async () => {
  // Diagnostics run inside startRecording. A parse error that propagated would
  // take the recorder down with it — the opposite of the point.
  const d = await freshModule();
  globalThis.localStorage.setItem('yp_voice_diag', '{not json');

  assert.doesNotThrow(() => d.getVoiceSignals());
  assert.deepEqual(d.getVoiceSignals(), []);
  assert.doesNotThrow(() => d.logVoiceSignal('tick', 'sample', { vis: 'visible' }));
});
