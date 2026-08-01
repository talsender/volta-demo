const test = require('node:test');
const assert = require('node:assert');
const CallMetrics = require('../call-metrics.js');

test('aggregate of no events returns zeros', () => {
  assert.deepStrictEqual(CallMetrics.aggregate([]), { count: 0, medianMs: 0, avgMs: 0 });
});

test('aggregate ignores events of other actions', () => {
  const events = [{ action: 'agent.create', details: {} }];
  assert.strictEqual(CallMetrics.aggregate(events).count, 0);
});

test('aggregate computes median for an odd count', () => {
  const events = [10000, 30000, 20000].map(durationMs => ({ action: 'wizard.duration', details: { durationMs } }));
  const r = CallMetrics.aggregate(events);
  assert.strictEqual(r.count, 3);
  assert.strictEqual(r.medianMs, 20000);
});

test('aggregate computes median for an even count (average of the two middle values)', () => {
  const events = [10000, 20000, 30000, 40000].map(durationMs => ({ action: 'wizard.duration', details: { durationMs } }));
  const r = CallMetrics.aggregate(events);
  assert.strictEqual(r.medianMs, 25000);
  assert.strictEqual(r.avgMs, 25000);
});

test('fmtDuration formats milliseconds as mm:ss', () => {
  assert.strictEqual(CallMetrics.fmtDuration(65000), '1:05');
  assert.strictEqual(CallMetrics.fmtDuration(5000), '0:05');
});
