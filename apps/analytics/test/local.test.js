import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalAddress } from '../lib/local.js';

test('local addresses are recognised in every spelling Express produces', () => {
  assert.equal(isLocalAddress('127.0.0.1'), true);
  assert.equal(isLocalAddress('::1'), true);
  assert.equal(isLocalAddress('::ffff:127.0.0.1'), true);
});

test('anything that is not this machine is refused', () => {
  assert.equal(isLocalAddress('192.168.1.20'), false);   // the LAN is not local
  assert.equal(isLocalAddress('::ffff:192.168.1.20'), false);
  assert.equal(isLocalAddress('10.0.0.5'), false);
  assert.equal(isLocalAddress('203.0.113.9'), false);
  assert.equal(isLocalAddress(''), false);
  assert.equal(isLocalAddress(undefined), false);
  assert.equal(isLocalAddress(null), false);
});
