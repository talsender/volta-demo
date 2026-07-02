// Firestore data layer for agents, requests, settlementOverrides, roofConfig.
// Loaded after the Firebase SDK modular CDN (see index.html).
const VoltaDB = (() => {
  let _db = null;
  let _auth = null;
  let _ok = false;

  function init() {
    try {
      const app = firebase.initializeApp(CONFIG.FIREBASE_CONFIG);
      _db = firebase.getFirestore(app);
      if (firebase.getAuth) _auth = firebase.getAuth(app);
      _ok = true;
    } catch (e) {
      console.warn('Firebase init failed:', e);
      _ok = false;
    }
    return _ok;
  }

  function ready() { return _ok; }
  function authReady() { return !!(_ok && _auth); }

  // ---- Firebase Auth (optional production path) ----
  function subscribeAuth(cb) {
    if (!authReady() || !firebase.onAuthStateChanged) { cb(null); return () => {}; }
    return firebase.onAuthStateChanged(_auth, cb, err => { console.warn('auth listen error', err); cb(null); });
  }
  async function signIn(email, password) {
    if (!authReady() || !firebase.signInWithEmailAndPassword) throw new Error('firebase auth unavailable');
    const cred = await firebase.signInWithEmailAndPassword(_auth, email, password);
    return cred.user;
  }
  function signOutAuth() {
    if (!authReady() || !firebase.signOut) return Promise.resolve();
    return firebase.signOut(_auth);
  }
  async function getAgentProfile(uid) {
    if (!_ok || !uid) return null;
    const snap = await firebase.getDoc(firebase.doc(_db, 'agents', uid));
    return snap.exists ? Object.assign({ id: snap.id }, snap.data()) : null;
  }

  // ---- agents ----
  function subscribeAgents(cb) {
    if (!_ok) { cb([]); return () => {}; }
    return firebase.onSnapshot(firebase.collection(_db, 'agents'), snap => {
      cb(snap.docs.map(d => Object.assign({ id: d.id }, d.data())));
    }, err => { console.warn('agents listen error', err); cb([]); });
  }
  function addAgent(agent) {
    return firebase.addDoc(firebase.collection(_db, 'agents'), agent);
  }
  function setAgentProfile(uid, profile) {
    return firebase.setDoc(firebase.doc(_db, 'agents', uid), profile);
  }
  function updateAgent(id, patch) {
    return firebase.updateDoc(firebase.doc(_db, 'agents', id), patch);
  }
  function deleteAgent(id) {
    return firebase.deleteDoc(firebase.doc(_db, 'agents', id));
  }

  // ---- requests ----
  function subscribeRequests(cb) {
    if (!_ok) { cb([]); return () => {}; }
    return firebase.onSnapshot(firebase.collection(_db, 'requests'), snap => {
      cb(snap.docs.map(d => Object.assign({ id: d.id }, d.data())));
    }, err => { console.warn('requests listen error', err); cb([]); });
  }
  function subscribeRequestsForAgent(agentId, cb) {
    if (!_ok || !agentId || !firebase.query || !firebase.where) { cb([]); return () => {}; }
    const q = firebase.query(firebase.collection(_db, 'requests'), firebase.where('agentId', '==', agentId));
    return firebase.onSnapshot(q, snap => {
      cb(snap.docs.map(d => Object.assign({ id: d.id }, d.data())));
    }, err => { console.warn('agent requests listen error', err); cb([]); });
  }
  function addRequest(req) {
    return firebase.addDoc(firebase.collection(_db, 'requests'), req);
  }
  function updateRequest(id, patch) {
    return firebase.updateDoc(firebase.doc(_db, 'requests', id), patch);
  }
  function applyPermanentSettlementApproval(requestId, patch, override) {
    if (!_ok || !firebase.writeBatch) throw new Error('firestore batch unavailable');
    if (!override || !override.key || !override.value) throw new Error('missing settlement override');
    const batch = firebase.writeBatch(_db);
    batch.set(firebase.doc(_db, 'settlementOverrides', override.key), override.value);
    batch.update(firebase.doc(_db, 'requests', requestId), patch);
    return batch.commit();
  }

  // ---- settlementOverrides ----
  // Returns a plain map { normalizedName: {status,note,...} } once.
  async function loadOverrides() {
    if (!_ok) return {};
    try {
      const snap = await firebase.getDocs(firebase.collection(_db, 'settlementOverrides'));
      const map = {};
      snap.docs.forEach(d => { map[d.id] = d.data(); });
      return map;
    } catch (e) { console.warn('overrides load error', e); return {}; }
  }
  function setOverride(key, value) {
    return firebase.setDoc(firebase.doc(_db, 'settlementOverrides', key), value);
  }

  // ---- roofConfig ----
  function subscribeRoofConfig(cb) {
    if (!_ok) { cb(null); return () => {}; }
    return firebase.onSnapshot(firebase.doc(_db, 'roofConfig', 'default'), snap => {
      cb(snap.exists ? snap.data() : null);
    }, err => { console.warn('roofConfig listen error', err); cb(null); });
  }
  function saveRoofConfig(cfg) {
    return firebase.setDoc(firebase.doc(_db, 'roofConfig', 'default'), cfg);
  }

  // ---- audit logs ----
  function addAuditEvent(event) {
    if (!_ok) return Promise.resolve(null);
    return firebase.addDoc(firebase.collection(_db, 'auditLogs'), event);
  }
  function subscribeAuditLogs(cb) {
    if (!_ok) { cb([]); return () => {}; }
    return firebase.onSnapshot(firebase.collection(_db, 'auditLogs'), snap => {
      cb(snap.docs.map(d => Object.assign({ id: d.id }, d.data())));
    }, err => { console.warn('auditLogs listen error', err); cb([]); });
  }

  return {
    init, ready, authReady,
    subscribeAuth, signIn, signOutAuth, getAgentProfile,
    subscribeAgents, addAgent, setAgentProfile, updateAgent, deleteAgent,
    subscribeRequests, subscribeRequestsForAgent, addRequest, updateRequest, applyPermanentSettlementApproval,
    loadOverrides, setOverride,
    subscribeRoofConfig, saveRoofConfig,
    addAuditEvent, subscribeAuditLogs,
  };
})();

if (typeof window !== 'undefined') window.VoltaDB = VoltaDB;
