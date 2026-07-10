const test = require('node:test');
const assert = require('node:assert');

// firebase.js reads the SDK facade (`firebase`) and `CONFIG` from globals,
// exactly like the browser. Each helper call re-requires a fresh instance.
function freshVoltaDB(onSnapshotImpl) {
  global.CONFIG = { FIREBASE_CONFIG: {} };
  global.firebase = {
    initializeApp: () => ({}),
    getFirestore: () => ({}),
    getAuth: () => ({}),
    collection: () => ({}),
    onSnapshot: onSnapshotImpl || (() => () => {}),
  };
  delete require.cache[require.resolve('../firebase.js')];
  return require('../firebase.js');
}

test('subscribeAgents before init() reports a non-authoritative empty list', () => {
  const VoltaDB = freshVoltaDB();
  const calls = [];
  VoltaDB.subscribeAgents((list, meta) => calls.push({ list, meta }));
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0].list, []);
  // The app must be able to tell this apart from a real "no agents" snapshot,
  // otherwise an existing deployment looks like first-time setup.
  assert.ok(calls[0].meta && calls[0].meta.authoritative === false);
});

test('subscribeAgents server snapshots are authoritative', () => {
  let snapHandler;
  const VoltaDB = freshVoltaDB((ref, onNext) => { snapHandler = onNext; return () => {}; });
  VoltaDB.init();
  const calls = [];
  VoltaDB.subscribeAgents((list, meta) => calls.push({ list, meta }));
  snapHandler({ docs: [{ id: 'a1', data: () => ({ name: 'מנהל', role: 'manager', active: true }) }] });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].list.length, 1);
  assert.strictEqual(calls[0].list[0].id, 'a1');
  assert.ok(calls[0].meta && calls[0].meta.authoritative === true);
});

test('subscribeAgents listen errors are non-authoritative (must not wipe session state)', () => {
  let errHandler;
  const VoltaDB = freshVoltaDB((ref, onNext, onError) => { errHandler = onError; return () => {}; });
  VoltaDB.init();
  const calls = [];
  VoltaDB.subscribeAgents((list, meta) => calls.push({ list, meta }));
  errHandler(new Error('permission-denied'));
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0].list, []);
  assert.ok(calls[0].meta && calls[0].meta.authoritative === false);
});
