// tests/auth.test.js
const test = require('node:test');
const assert = require('node:assert');
const Auth = require('../auth.js');

test('manager can use detailedPlanning by default', () => {
  assert.strictEqual(Auth.can({ role: 'manager' }, 'detailedPlanning'), true);
});

test('agent and lead cannot use detailedPlanning by default', () => {
  assert.strictEqual(Auth.can({ role: 'agent' }, 'detailedPlanning'), false);
  assert.strictEqual(Auth.can({ role: 'lead' }, 'detailedPlanning'), false);
});

test('per-agent canDetailedPlan=true overrides an agent-role default of false', () => {
  assert.strictEqual(Auth.can({ role: 'agent', canDetailedPlan: true }, 'detailedPlanning'), true);
});

test('per-agent canDetailedPlan=false overrides a manager-role default of true', () => {
  assert.strictEqual(Auth.can({ role: 'manager', canDetailedPlan: false }, 'detailedPlanning'), false);
});

test('publicAgent carries canDetailedPlan through', () => {
  const pub = Auth.publicAgent({ id: 'a1', name: 'A', role: 'agent', email: 'a@x.com', canDetailedPlan: true, password: 'secret' });
  assert.strictEqual(pub.canDetailedPlan, true);
  assert.strictEqual(pub.password, undefined);
});

test('publicAgent omits canDetailedPlan when not set on the record', () => {
  const pub = Auth.publicAgent({ id: 'a1', name: 'A', role: 'agent', email: 'a@x.com' });
  assert.strictEqual(pub.canDetailedPlan, undefined);
});
