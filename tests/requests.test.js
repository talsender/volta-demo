const test = require('node:test');
const assert = require('node:assert');
const Requests = require('../requests.js');

const agent = { id: 'a1', name: 'Rep' };

test('buildRequest accepts type "planning"', () => {
  const req = Requests.buildRequest({ type: 'planning', agent, subject: 'Case X', reason: 'handoff' });
  assert.strictEqual(req.type, 'planning');
  assert.strictEqual(req.status, 'pending');
  assert.strictEqual(req.requestedStatus, null);
});

test('buildRequest still rejects an unknown type', () => {
  assert.throws(() => Requests.buildRequest({ type: 'bogus', agent, subject: 'x', reason: 'y' }), /invalid type/);
});
