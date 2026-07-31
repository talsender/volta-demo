// tests/wizard.test.js
const test = require('node:test');
const assert = require('node:assert');
// wizard.js's cfg() reads the roof-materials config from the global
// DEFAULT_ROOF_CONFIG/RoofStore if present (browser globals pattern) — in Node
// neither exists unless set explicitly, so roofTypeOptions()/toggleRoofType()
// would otherwise see an empty materials list. Needed for the Task 5 roof-type
// test below; harmless for the eligibility-only tests in this task.
global.DEFAULT_ROOF_CONFIG = require('../config.js').DEFAULT_ROOF_CONFIG;
const { Wizard } = require('../wizard.js');

const ALL_OK = { 'property-type': 0, ownership: 0, permit: 0, connection: 0, meter: 0 }; // all the "good" option at index 0 for every one of the 5

test('confirmEligibility requires all five answers', () => {
  Wizard.reset();
  const r = Wizard.confirmEligibility({ 'property-type': 0 });
  assert.strictEqual(r.done, false);
  assert.ok(r.error);
});

test('confirmEligibility advances past the checklist when everything is fine', () => {
  Wizard.reset();
  const r = Wizard.confirmEligibility(ALL_OK);
  assert.strictEqual(r.done, false); // continues to roof-and-sizes, not an outcome yet
  assert.strictEqual(Wizard.getState().outcome, null);
  assert.strictEqual(Wizard.getState().answers.length, 5);
});

test('confirmEligibility stops on the first disqualifying answer in flow order (ownership before permit)', () => {
  Wizard.reset();
  // ownership index 1 = "לא, שכירות" (stop); permit index 2 = "אין" (follow-up) — ownership comes first in order.
  const r = Wizard.confirmEligibility({ 'property-type': 0, ownership: 1, permit: 2, connection: 0, meter: 0 });
  assert.strictEqual(r.done, true);
  assert.strictEqual(Wizard.getState().outcome, 'stop');
  assert.ok(Wizard.getState().stopReason.includes('בעלות'));
});

test('confirmEligibility surfaces follow-up when no stop precedes it', () => {
  Wizard.reset();
  const r = Wizard.confirmEligibility({ 'property-type': 0, ownership: 0, permit: 2, connection: 0, meter: 0 });
  assert.strictEqual(r.done, true);
  assert.strictEqual(Wizard.getState().outcome, 'follow-up');
});

test('confirmEligibility accumulates flags from every answer, not just the first', () => {
  Wizard.reset();
  // meter index 1 = "בתוך הבית" (flag). property-type index 1 = condo-private (flag). Neither disqualifies.
  const r = Wizard.confirmEligibility({ 'property-type': 1, ownership: 0, permit: 0, connection: 0, meter: 1 });
  assert.strictEqual(r.done, false);
  assert.strictEqual(Wizard.getState().flags.length, 2);
});

test('getQuestionById exposes a sub-question for rendering', () => {
  const q = Wizard.getQuestionById('ownership');
  assert.strictEqual(q.id, 'ownership');
  assert.ok(Array.isArray(q.options));
});

test('back() undoes a confirmEligibility stop in one step', () => {
  Wizard.reset();
  Wizard.confirmEligibility({ 'property-type': 0, ownership: 1, permit: 0, connection: 0, meter: 0 });
  assert.strictEqual(Wizard.getState().outcome, 'stop');
  assert.strictEqual(Wizard.back(), true);
  assert.strictEqual(Wizard.getState().outcome, null);
  assert.strictEqual(Wizard.getState().answers.length, 0);
});

test('flags are accumulated even when submission ends in stop', () => {
  Wizard.reset();
  // property-type index 1 = condo-private (flag). ownership index 1 = stop.
  const r = Wizard.confirmEligibility({ 'property-type': 1, ownership: 1, permit: 0, connection: 0, meter: 0 });
  assert.strictEqual(r.done, true);
  assert.strictEqual(Wizard.getState().outcome, 'stop');
  assert.strictEqual(Wizard.getState().flags.length, 1);
});

test('first blocking in fixed order wins — permit follow-up before connection stop', () => {
  Wizard.reset();
  // permit index 2 = "אין" (follow-up, position 3 in order). connection index 1 = stop (position 4 in order).
  // Since permit comes FIRST in the order, outcome should be 'follow-up', not 'stop'.
  const r = Wizard.confirmEligibility({ 'property-type': 0, ownership: 0, permit: 2, connection: 1, meter: 0 });
  assert.strictEqual(r.done, true);
  assert.strictEqual(Wizard.getState().outcome, 'follow-up');
});

test('confirmRoofTypesAndSizes evaluates the merged screen in one call', () => {
  Wizard.reset();
  Wizard.confirmEligibility(ALL_OK);
  Wizard.toggleRoofType(0); // first material in RoofStore/DEFAULT_ROOF_CONFIG — concrete, per config.js
  const r = Wizard.confirmRoofTypesAndSizes({ concrete: 80 });
  assert.strictEqual(r.done, false); // advances to roof-orientation
  assert.strictEqual(Wizard.getState().materialSizes.length, 1);
  const answers = Wizard.getState().answers;
  assert.ok(answers.some(a => a.questionId === 'roof-type'));
  assert.ok(answers.some(a => a.questionId === 'material-sizes'));
});

test('confirmRoofTypesAndSizes requires at least one roof type', () => {
  Wizard.reset();
  Wizard.confirmEligibility(ALL_OK);
  const r = Wizard.confirmRoofTypesAndSizes({});
  assert.strictEqual(r.done, false);
  assert.ok(r.error);
});
