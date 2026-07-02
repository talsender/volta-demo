// Agent identity + role capabilities.
// Pure helpers (findAgentByCredentials, can, roleLabel, lastManagerGuard) are
// unit-tested in Node; the session helpers use localStorage (browser only).
const Auth = (() => {
  const STORAGE_KEY = 'volta_agent';
  const HASH_PREFIX = 'sha256';
  const PBKDF2_PREFIX = 'pbkdf2';
  const PBKDF2_ITERATIONS = 120000;

  const ROLES = ['agent', 'lead', 'manager'];
  const ROLE_LABELS = { agent: 'נציג', lead: 'ראש צוות', manager: 'מנהל' };

  // Capability matrix per role. agent < lead < manager.
  const CAPS = {
    agent:   { request: true },
    lead:    { request: true, reviewRequests: true },
    manager: { request: true, reviewRequests: true, manageAgents: true, roofSettings: true },
  };

  function roleLabel(role) { return ROLE_LABELS[role] || role || ''; }

  function randomSalt() {
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      const nodeCrypto = require('node:crypto');
      const buf = nodeCrypto.randomBytes(bytes.length);
      bytes.set(buf);
    }
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function sha256Hex(text) {
    const value = String(text);
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      const data = new TextEncoder().encode(value);
      const digest = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    const nodeCrypto = require('node:crypto');
    return nodeCrypto.createHash('sha256').update(value, 'utf8').digest('hex');
  }

  async function hashPassword(password, salt) {
    const s = salt || randomSalt();
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: enc.encode(s), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        key,
        256
      );
      const hash = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
      return { passwordHash: `${PBKDF2_PREFIX}:${PBKDF2_ITERATIONS}:${s}:${hash}` };
    }
    const nodeCrypto = require('node:crypto');
    const hash = nodeCrypto.pbkdf2Sync(String(password), s, PBKDF2_ITERATIONS, 32, 'sha256').toString('hex');
    return { passwordHash: `${PBKDF2_PREFIX}:${PBKDF2_ITERATIONS}:${s}:${hash}` };
  }

  async function hashPasswordSha256(password, salt) {
    const s = salt || randomSalt();
    const hash = await sha256Hex(`${s}:${password}`);
    return { passwordHash: `${HASH_PREFIX}:${s}:${hash}` };
  }

  async function verifyPassword(agent, password) {
    if (!agent || !agent.active || !password) return { ok: false, legacy: false };
    if (agent.passwordHash) {
      const parts = String(agent.passwordHash).split(':');
      if (parts[0] === PBKDF2_PREFIX && parts.length === 4) {
        const iter = parseInt(parts[1]) || PBKDF2_ITERATIONS;
        const salt = parts[2];
        let hash;
        if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
          const enc = new TextEncoder();
          const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
          const bits = await crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: enc.encode(salt), iterations: iter, hash: 'SHA-256' },
            key,
            256
          );
          hash = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
        } else {
          const nodeCrypto = require('node:crypto');
          hash = nodeCrypto.pbkdf2Sync(String(password), salt, iter, 32, 'sha256').toString('hex');
        }
        return { ok: `${PBKDF2_PREFIX}:${iter}:${salt}:${hash}` === agent.passwordHash, legacy: false };
      }
      if (parts[0] === HASH_PREFIX && parts.length === 3) {
        const expected = await hashPasswordSha256(password, parts[1]);
        return { ok: expected.passwordHash === agent.passwordHash, legacy: false, needsRehash: expected.passwordHash === agent.passwordHash };
      }
      return { ok: false, legacy: false };
    }
    const ok = String(agent.password || '') === String(password);
    return { ok, legacy: ok };
  }

  // Match an active agent by email (case-insensitive) + exact legacy password.
  // Kept synchronous for old records and existing unit tests. New browser login
  // should use findAgentByCredentialsAsync so passwordHash records are supported.
  function findAgentByCredentials(agents, email, password) {
    if (!email || !password) return null;
    const e = String(email).trim().toLowerCase();
    const p = String(password);
    return agents.find(a =>
      a.active &&
      String(a.email || '').trim().toLowerCase() === e &&
      String(a.password || '') === p
    ) || null;
  }

  async function findAgentByCredentialsAsync(agents, email, password) {
    if (!email || !password) return null;
    const e = String(email).trim().toLowerCase();
    for (const agent of (agents || [])) {
      if (!agent.active || String(agent.email || '').trim().toLowerCase() !== e) continue;
      const verified = await verifyPassword(agent, password);
      if (verified.ok) return Object.assign({}, agent, { _legacyPassword: verified.legacy, _needsPasswordRehash: verified.needsRehash });
    }
    return null;
  }

  function can(agent, capability) {
    if (!agent || !agent.role) return false;
    const caps = CAPS[agent.role];
    return !!(caps && caps[capability]);
  }

  // Guard: would disabling/removing `agentId` leave zero active managers?
  // Returns true when the action is BLOCKED (it's the last active manager).
  function isLastActiveManager(agents, agentId) {
    const activeManagers = agents.filter(a => a.role === 'manager' && a.active);
    return activeManagers.length === 1 && activeManagers[0].id === agentId;
  }

  function validFirebaseUid(id) {
    return typeof id === 'string'
      && !!id
      && id.length <= 128
      && id === id.trim()
      && id !== '.'
      && id !== '..'
      && !id.includes('/')
      && !/[\x00-\x1F\x7F]/.test(id);
  }

  // Validate agent fields for add/edit. On edit, pass ignoreId to skip the
  // agent's own email in the uniqueness check, and an empty password means
  // "keep existing". Returns an error string, or null when valid.
  function validateAgentFields(fields, agents, ignoreId) {
    const name = (fields.name || '').trim();
    const email = (fields.email || '').trim();
    const role = fields.role;
    const password = fields.password;
    if (!name) return 'שם חובה';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'אימייל לא תקין';
    if (name.length > 120) return 'שם ארוך מדי';
    if (email.length > 254) return 'אימייל ארוך מדי';
    if (String(fields.phone || '').length > 40) return 'טלפון ארוך מדי';
    if (!ROLES.includes(role)) return 'תפקיד לא תקין';
    if (password != null && password !== '' && String(password).length < 4) {
      return 'סיסמה קצרה מדי (מינימום 4 תווים)';
    }
    const e = email.toLowerCase();
    if ((agents || []).some(a => a.id !== ignoreId && String(a.email || '').trim().toLowerCase() === e)) {
      return 'אימייל כבר קיים';
    }
    return null;
  }

  function getCurrentAgent() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function setCurrentAgent(agent) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      id: agent.id, name: agent.name, role: agent.role, email: agent.email,
    }));
  }

  function publicAgent(agent) {
    return agent ? { id: agent.id, name: agent.name, role: agent.role, email: agent.email } : null;
  }

  function reconcileCurrentAgent(agents) {
    const current = getCurrentAgent();
    if (!current || !current.id) return null;
    const live = (agents || []).find(a => a.id === current.id && a.active);
    if (!live) {
      logout();
      return null;
    }
    const fresh = publicAgent(live);
    setCurrentAgent(fresh);
    return fresh;
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
  }

  return {
    findAgentByCredentials, findAgentByCredentialsAsync, hashPassword, verifyPassword,
    can, roleLabel, isLastActiveManager, validFirebaseUid, validateAgentFields,
    getCurrentAgent, setCurrentAgent, reconcileCurrentAgent, logout,
    ROLES, ROLE_LABELS, CAPS,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Auth;
if (typeof window !== 'undefined') window.Auth = Auth;
