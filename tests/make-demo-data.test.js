const test = require('node:test');
const assert = require('node:assert');
const { statusFor, normKey, metricsFor } = require('../tools/make-demo-data.js');

test('statusFor is deterministic', () => {
  assert.strictEqual(statusFor('אבו גוש', 31.8, 35.1), statusFor('אבו גוש', 31.8, 35.1));
});

test('statusFor returns a valid status token', () => {
  const s = statusFor('דוגמה', 32.0, 34.9);
  assert.ok(s === 'מתקינים' || s === 'לא מתקינים');
});

test('normKey strips spaces and punctuation to match coord keys', () => {
  assert.strictEqual(normKey("אבו ג'ווייעד (שבט)"), 'אבוגווייעדשבט');
});

test('normKey folds final Hebrew letters (matches coord-key convention)', () => {
  assert.strictEqual(normKey('בית שאן'), 'ביתשאנ');   // final ן -> נ
  assert.strictEqual(normKey('אביבים'), 'אביבימ');     // final ם -> מ
});

test('metricsFor never gives installs to a red town', () => {
  const m = metricsFor('דוגמה', 'לא מתקינים');
  assert.strictEqual(m.count, '');
  assert.strictEqual(m.last, '');
});
