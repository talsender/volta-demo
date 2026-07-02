// Manager panel: entry (double-click logo + password), requests tab, agents tab.
const Admin = (() => {
  let _agents = [];
  let _requests = [];
  let _open = false;
  let _reqFilter = 'pending'; // 'pending' | 'all'
  let _ctx = 'manager';       // 'lead' (requests only) | 'manager' (all tabs)
  let _agentSearch = '';
  let _editingId = null;
  let _agentsUnsub = null;
  let _requestsUnsub = null;
  let _auditUnsub = null;
  let _auditLogs = [];
  const REQ_STATUS_CLASS = { pending: 'pending', approved: 'approved', rejected: 'rejected' };
  const ROLE_CLASS = { agent: 'agent', lead: 'lead', manager: 'manager' };
  const AUDIT_LABELS = {
    'request.approve': 'אישור בקשה',
    'request.reject': 'דחיית בקשה',
    'agent.create': 'יצירת נציג',
    'agent.update': 'עדכון נציג',
    'agent.activate': 'הפעלת נציג',
    'agent.deactivate': 'השבתת נציג',
    'agent.delete': 'מחיקת נציג',
    'roofConfig.update': 'עדכון הגדרות גג',
  };

  function authMode() {
    return (typeof CONFIG !== 'undefined' && CONFIG.AUTH_MODE === 'firebase') ? 'firebase' : 'legacy';
  }

  function domId(value) {
    return String(value || '').replace(/[^A-Za-z0-9_-]/g, '_');
  }

  function managerPassword() {
    // Prefer the live (manager-editable) password from RoofStore, so the unified
    // entry honors any change made in the roof-settings editor.
    if (typeof RoofStore !== 'undefined' && RoofStore.get) {
      const cfg = RoofStore.get();
      if (cfg && cfg.managerPassword) return String(cfg.managerPassword);
    }
    return (typeof DEFAULT_ROOF_CONFIG !== 'undefined' && DEFAULT_ROOF_CONFIG.managerPassword)
      || '';
  }

  function bootstrapPasswordEnabled() {
    const pw = managerPassword().trim();
    return !!pw && pw.toLowerCase() !== 'volta';
  }

  function audit(action, targetType, targetId, details) {
    if (!VoltaDB.ready || !VoltaDB.ready() || !VoltaDB.addAuditEvent) return;
    const actor = Auth.getCurrentAgent();
    if (!actor) return;
    let event;
    try {
      event = Audit.buildEvent(actor, action, targetType, targetId, details);
    } catch (e) {
      console.warn('audit event skipped:', e);
      return;
    }
    VoltaDB.addAuditEvent(event).catch(e => console.warn('audit log failed:', e));
  }

  // ---- "manager panel" toolbar badge ----
  function adminSeenKey() {
    const a = Auth.getCurrentAgent();
    return a ? 'volta_seen_admin_' + a.id : null;
  }
  function getAdminLastSeen() {
    const k = adminSeenKey();
    return k ? (parseInt(localStorage.getItem(k)) || 0) : 0;
  }
  function markAdminSeen() {
    const k = adminSeenKey();
    if (k) localStorage.setItem(k, String(Date.now()));
  }
  function renderAdminBadge() {
    const badge = document.getElementById('admin-badge');
    if (!badge) return;
    const agent = Auth.getCurrentAgent();
    if (!agent || !Auth.can(agent, 'reviewRequests')) { badge.classList.add('hidden'); return; }
    const { pending, unseenNew } = Requests.adminBadge(_requests, getAdminLastSeen());
    if (pending === 0 && unseenNew === 0) { badge.classList.add('hidden'); return; }
    badge.textContent = pending;
    badge.classList.toggle('alert', unseenNew > 0);
    badge.classList.remove('hidden');
  }

  // roleCtx: 'lead' → requests tab only; 'manager' → all tabs.
  function open(roleCtx) {
    _ctx = roleCtx === 'manager' ? 'manager' : 'lead';
    _editingId = null;
    applyTabVisibility();
    document.getElementById('admin-modal').classList.remove('hidden');
    _open = true;
    renderRequests();
    renderAgents();
    renderRoof();
    renderAudit();
    switchTab('requests');
    markAdminSeen();      // opening the panel = the manager has now seen pending items
    renderAdminBadge();
  }
  function close() {
    document.getElementById('admin-modal').classList.add('hidden');
    _open = false;
  }

  // Open honoring the logged-in agent's role.
  function openForCurrentAgent() {
    const agent = Auth.getCurrentAgent();
    if (!agent) return;
    refreshSubscriptions();
    if (Auth.can(agent, 'manageAgents')) open('manager');
    else if (Auth.can(agent, 'reviewRequests')) open('lead');
    else alert('אין לך הרשאה לפאנל הניהול.');
  }

  // First-time setup: only when no agents exist, the bootstrap password opens
  // the panel in manager mode so the first manager account can be created.
  function bootstrap() {
    const hasManager = _agents.some(a => a.role === 'manager' && a.active);
    if (hasManager) { alert('כבר קיים מנהל פעיל — היכנס עם חשבון המנהל.'); return; }
    if (!bootstrapPasswordEnabled()) {
      alert('אתחול מנהל מהדפדפן מושבת עד להגדרת סיסמת אתחול ייחודית. לפרודקשן מומלץ ליצור מנהל דרך Firebase Console/Admin.');
      return;
    }
    const pw = window.prompt('סיסמת אתחול:');
    if (pw == null) return;
    if (pw === managerPassword()) open('manager');
    else alert('סיסמה שגויה');
  }

  function applyTabVisibility() {
    const isManager = _ctx === 'manager';
    const set = (atab, show) => {
      const btn = document.querySelector('.admin-tab[data-atab="' + atab + '"]');
      if (btn) btn.classList.toggle('hidden', !show);
    };
    set('requests', true);
    set('agents', isManager);
    set('roof', isManager);
    set('audit', isManager);
  }

  function switchTab(name) {
    document.querySelectorAll('.admin-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.atab === name));
    document.getElementById('admin-requests').classList.toggle('hidden', name !== 'requests');
    document.getElementById('admin-agents').classList.toggle('hidden', name !== 'agents');
    document.getElementById('admin-roof').classList.toggle('hidden', name !== 'roof');
    document.getElementById('admin-audit').classList.toggle('hidden', name !== 'audit');
  }

  // ---- roof settings tab (launches the existing roof Settings editor) ----
  function renderRoof() {
    const pane = document.getElementById('admin-roof');
    if (!pane) return;
    if (typeof Settings === 'undefined' || !window.Settings) {
      pane.innerHTML = '<div class="my-req-empty">עורך הגדרות הגג לא נטען.</div>';
      return;
    }
    pane.innerHTML = `
      <div class="my-req-empty admin-empty-note">
        עריכת ספי גודל, גיל גג, חומרים וכללי גודל — משותף לכל הנציגים.
      </div>
      <button class="btn primary" data-admin-action="open-roof-settings">פתח עורך הגדרות גג ←</button>`;
  }

  function openRoofSettings() {
    if (window.Settings) Settings.open();
  }

  function renderAudit() {
    const pane = document.getElementById('admin-audit');
    if (!pane) return;
    if (_ctx !== 'manager') { pane.innerHTML = ''; return; }
    const list = _auditLogs.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 80);
    if (!list.length) {
      pane.innerHTML = '<div class="my-req-empty">אין אירועי audit עדיין.</div>';
      return;
    }
    pane.innerHTML = list.map(e => {
      const details = e.details ? JSON.stringify(e.details) : '';
      return `<div class="audit-row">
        <div class="audit-head">
          <span class="audit-action">${escHtml(AUDIT_LABELS[e.action] || e.action || '')}</span>
          <span class="audit-time">${escHtml(fmtDateTime(e.createdAt))}</span>
        </div>
        <div class="audit-meta">
          <span>${escHtml(e.actorName || '')}</span>
          <span>${escHtml(Auth.roleLabel(e.actorRole) || e.actorRole || '')}</span>
          <span>${escHtml(e.targetType || '')}:${escHtml(e.targetId || '')}</span>
        </div>
        ${details ? `<div class="audit-details">${escHtml(details)}</div>` : ''}
      </div>`;
    }).join('');
  }

  // ---- requests tab ----
  function renderRequests() {
    const pane = document.getElementById('admin-requests');
    let list = _requests.slice();
    if (_reqFilter === 'pending') list = list.filter(r => r.status === 'pending');
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const filterBar = `<div class="admin-filter">
      <button class="chip ${_reqFilter === 'pending' ? 'on' : ''}" data-admin-action="filter-req" data-filter="pending">ממתינות</button>
      <button class="chip ${_reqFilter === 'all' ? 'on' : ''}" data-admin-action="filter-req" data-filter="all">הכל</button>
    </div>`;

    if (!list.length) { pane.innerHTML = filterBar + '<div class="my-req-empty">אין בקשות.</div>'; return; }

    pane.innerHTML = filterBar + list.map(r => {
      const idAttr = escHtml(r.id || '');
      const canPermanent = _ctx === 'manager';
      const permLabel = r.type === 'settlement' ? 'אשר — שינוי קבוע' : 'אשר — קבוע (גג)';
      const permanentAction = canPermanent
        ? `<button class="btn primary sm" data-admin-action="approve" data-id="${idAttr}" data-resolution="permanent">${permLabel}</button>`
        : '';
      const actions = r.status === 'pending' ? `
        <div class="req-row-actions">
          ${permanentAction}
          <button class="btn secondary sm" data-admin-action="approve" data-id="${idAttr}" data-resolution="one-off">אשר — חד-פעמי</button>
          <button class="btn vsd sm" data-admin-action="reject" data-id="${idAttr}">דחה</button>
        </div>`
        : `<div class="req-row-status">${escHtml(r.status)} ${escHtml(r.resolution || '')}${r.managerNote ? ' · ' + escHtml(r.managerNote) : ''}</div>`;
      return `<div class="admin-req-row ${REQ_STATUS_CLASS[r.status] || ''}">
        <div class="ar-head"><span>${r.type === 'roof' ? '🏠 גג' : '📍 יישוב'}</span>
          <span class="ar-agent">${escHtml(r.agentName || '')}</span></div>
        <div class="ar-subject">${escHtml(r.subject || '')}</div>
        ${r.type === 'settlement' && r.requestedStatus
          ? `<div class="ar-requested">מבקש לשנות ל־ <b>${escHtml(r.requestedStatus)}</b></div>` : ''}
        <div class="ar-reason">${escHtml(r.reason || '')}</div>
        ${actions}
      </div>`;
    }).join('');
  }

  function filterReq(f) { _reqFilter = f; renderRequests(); }

  async function approve(id, resolution) {
    const req = _requests.find(r => r.id === id);
    if (!req) return;
    if (resolution === 'permanent' && _ctx !== 'manager') {
      alert('אישור קבוע זמין למנהל בלבד. ראש צוות יכול לאשר חד-פעמית או לדחות.');
      return;
    }
    if (resolution === 'permanent' && req.type === 'roof') {
      alert('אישור גג קבוע נרשם. החלת הכלל בפועל נעשית בפאנל הגדרות הגג.');
    }
    const note = managerNotePrompt('הערה לנציג (אופציונלי):');
    if (note == null) return;
    const patch = Requests.decideRequest(req, { action: 'approve', resolution, managerNote: note });
    // Permanent settlement approval applies the status the agent requested.
    if (resolution === 'permanent' && req.type === 'settlement') {
      const actor = Auth.getCurrentAgent();
      const ov = Requests.overrideFromApproval(req, actor ? actor.name : 'מנהל');
      if (!ov) throw new Error('missing settlement override for permanent approval');
      await VoltaDB.applyPermanentSettlementApproval(id, patch, ov);
    } else {
      await VoltaDB.updateRequest(id, patch);
    }
    audit('request.approve', 'request', id, {
      type: req.type,
      subject: req.subject || '',
      resolution,
      permanentOverride: resolution === 'permanent' && req.type === 'settlement',
    });
  }

  async function reject(id) {
    const req = _requests.find(r => r.id === id);
    if (!req) return;
    const note = managerNotePrompt('סיבת דחייה (אופציונלי):');
    if (note == null) return;
    const patch = Requests.decideRequest(req, { action: 'reject', managerNote: note });
    await VoltaDB.updateRequest(id, patch);
    audit('request.reject', 'request', id, { type: req.type, subject: req.subject || '' });
  }

  // ---- agents tab ----
  function roleOptions(sel) {
    return Auth.ROLES.map(r =>
      `<option value="${r}"${r === sel ? ' selected' : ''}>${escHtml(Auth.roleLabel(r))}</option>`).join('');
  }
  function fmtDate(ts) {
    try { return new Date(ts).toLocaleDateString('he-IL'); } catch (e) { return ''; }
  }
  function fmtDateTime(ts) {
    try { return new Date(ts).toLocaleString('he-IL'); } catch (e) { return ''; }
  }
  function managerNotePrompt(label) {
    const note = window.prompt(label, '');
    if (note == null) return null;
    if (note.length > 500) {
      alert('הערת מנהל ארוכה מדי (מקסימום 500 תווים).');
      return null;
    }
    return note;
  }

  function renderAgents() {
    const pane = document.getElementById('admin-agents');
    if (!pane) return;
    const firebaseMode = authMode() === 'firebase';
    const passwordType = firebaseMode ? 'text' : 'password';
    const passwordPlaceholder = firebaseMode ? 'Firebase Auth UID' : 'סיסמה';
    pane.innerHTML = `
      <div class="agent-add">
        <input id="new-agent-name" class="login-input sm" maxlength="120" placeholder="שם">
        <input id="new-agent-email" class="login-input sm" type="email" maxlength="254" placeholder="אימייל">
        <input id="new-agent-password" class="login-input sm" type="${passwordType}" placeholder="${passwordPlaceholder}">
        <input id="new-agent-phone" class="login-input sm" maxlength="40" placeholder="טלפון (אופציונלי)">
        <select id="new-agent-role" class="login-input sm">${roleOptions('agent')}</select>
        <button class="btn primary sm" data-admin-action="add-agent">הוסף נציג</button>
      </div>
      <div id="agent-add-error" class="req-error"></div>
      <input id="agent-search" class="login-input sm agent-search"
        placeholder="🔍 חיפוש לפי שם / אימייל / טלפון" data-admin-input="agent-search">
      <div id="agent-list" class="agent-list"></div>`;
    const se = document.getElementById('agent-search');
    if (se) se.value = _agentSearch;
    renderAgentList();
  }

  function renderAgentList() {
    const host = document.getElementById('agent-list');
    if (!host) return;
    const q = _agentSearch.trim().toLowerCase();
    let list = _agents.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (q) list = list.filter(a =>
      (a.name || '').toLowerCase().includes(q) ||
      (a.email || '').toLowerCase().includes(q) ||
      (a.phone || '').includes(q));
    host.innerHTML = list.length
      ? list.map(a => _editingId === a.id ? editRowHtml(a) : viewRowHtml(a)).join('')
      : '<div class="my-req-empty">אין נציגים.</div>';
  }

  function viewRowHtml(a) {
    const idAttr = escHtml(a.id || '');
    const roleClass = ROLE_CLASS[a.role] || 'agent';
    const removeLabel = authMode() === 'firebase' ? 'ארכב' : 'מחק';
    return `<div class="agent-row ${a.active ? '' : 'inactive'}">
      <span class="ag-name">${escHtml(a.name || '')}</span>
      <span class="role-badge role-${roleClass}">${escHtml(Auth.roleLabel(a.role))}</span>
      <span class="ag-code">${escHtml(a.email || '')}</span>
      <span class="ag-phone">${escHtml(a.phone || '')}</span>
      <span class="ag-state">${a.active ? 'פעיל' : 'מושבת'}${a.lastLoginAt ? ' · כניסה ' + fmtDate(a.lastLoginAt) : ''}</span>
      <span class="ag-actions">
        <button class="btn secondary sm" data-admin-action="start-edit" data-id="${idAttr}">ערוך</button>
        <button class="btn secondary sm" data-admin-action="toggle-agent" data-id="${idAttr}">${a.active ? 'השבת' : 'הפעל'}</button>
        <button class="btn vsd sm" data-admin-action="remove-agent" data-id="${idAttr}">${removeLabel}</button>
      </span>
    </div>`;
  }

  function editRowHtml(a) {
    const safeId = domId(a.id);
    const idAttr = escHtml(a.id || '');
    return `<div class="agent-row editing">
      <input id="edit-name-${safeId}" class="login-input sm" maxlength="120" value="${escHtml(a.name || '')}" placeholder="שם">
      <input id="edit-email-${safeId}" class="login-input sm" type="email" maxlength="254" value="${escHtml(a.email || '')}" placeholder="אימייל">
      <input id="edit-password-${safeId}" class="login-input sm" type="password" placeholder="סיסמה חדשה (ריק = ללא שינוי)">
      <input id="edit-phone-${safeId}" class="login-input sm" maxlength="40" value="${escHtml(a.phone || '')}" placeholder="טלפון">
      <select id="edit-role-${safeId}" class="login-input sm">${roleOptions(a.role)}</select>
      <span class="ag-actions">
        <button class="btn primary sm" data-admin-action="save-edit" data-id="${idAttr}">שמור</button>
        <button class="btn reset sm" data-admin-action="cancel-edit">ביטול</button>
      </span>
      <div id="edit-error-${safeId}" class="req-error"></div>
    </div>`;
  }

  function searchAgents(v) { _agentSearch = v; renderAgentList(); }
  function startEdit(id) { _editingId = id; renderAgentList(); }
  function cancelEdit() { _editingId = null; renderAgentList(); }

  async function addAgent() {
    const fields = {
      name: document.getElementById('new-agent-name').value.trim(),
      email: document.getElementById('new-agent-email').value.trim(),
      password: document.getElementById('new-agent-password').value,
      phone: document.getElementById('new-agent-phone').value.trim(),
      role: document.getElementById('new-agent-role').value,
    };
    const err = document.getElementById('agent-add-error');
    if (authMode() === 'firebase') {
      const uid = fields.password.trim();
      if (!uid) { err.textContent = 'יש להזין Firebase Auth UID קיים'; return; }
      if (!Auth.validFirebaseUid(uid)) { err.textContent = 'Firebase Auth UID לא תקין'; return; }
      if (_agents.some(a => a.id === uid)) { err.textContent = 'כבר קיים פרופיל לנציג עם UID זה'; return; }
      const problem = Auth.validateAgentFields(Object.assign({}, fields, { password: '' }), _agents);
      if (problem) { err.textContent = problem; return; }
      err.textContent = '';
      await VoltaDB.setAgentProfile(uid, {
        name: fields.name,
        email: fields.email.toLowerCase(),
        phone: fields.phone,
        role: fields.role,
        active: true,
        createdAt: Date.now(),
        lastLoginAt: null,
      });
      audit('agent.create', 'agent', uid, {
        name: fields.name,
        email: fields.email.toLowerCase(),
        role: fields.role,
        firebaseAuthUid: uid,
      });
      ['new-agent-name', 'new-agent-email', 'new-agent-password', 'new-agent-phone'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      return;
    }
    if (!fields.password) { err.textContent = 'סיסמה חובה'; return; }
    const problem = Auth.validateAgentFields(fields, _agents);
    if (problem) { err.textContent = problem; return; }
    err.textContent = '';
    const passwordPatch = await Auth.hashPassword(fields.password);
    const ref = await VoltaDB.addAgent({
      name: fields.name, email: fields.email.toLowerCase(),
      passwordHash: passwordPatch.passwordHash, password: null,
      phone: fields.phone, role: fields.role, active: true, createdAt: Date.now(), lastLoginAt: null,
    });
    audit('agent.create', 'agent', ref && ref.id, {
      name: fields.name,
      email: fields.email.toLowerCase(),
      role: fields.role,
    });
    ['new-agent-name', 'new-agent-email', 'new-agent-password', 'new-agent-phone'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
  }

  async function saveEdit(id) {
    const agent = _agents.find(a => a.id === id);
    if (!agent) return;
    const safeId = domId(id);
    const fields = {
      name: document.getElementById('edit-name-' + safeId).value.trim(),
      email: document.getElementById('edit-email-' + safeId).value.trim(),
      password: document.getElementById('edit-password-' + safeId).value,
      phone: document.getElementById('edit-phone-' + safeId).value.trim(),
      role: document.getElementById('edit-role-' + safeId).value,
    };
    const err = document.getElementById('edit-error-' + safeId);
    if (authMode() === 'firebase' && fields.password) {
      if (err) err.textContent = 'במצב Firebase Auth שינוי סיסמה מתבצע דרך Firebase Auth, לא כאן.';
      return;
    }
    const problem = Auth.validateAgentFields(fields, _agents, id);
    if (problem) { if (err) err.textContent = problem; return; }
    // Guard: don't demote the last active manager away from 'manager'.
    if (agent.role === 'manager' && fields.role !== 'manager' && Auth.isLastActiveManager(_agents, id)) {
      if (err) err.textContent = 'לא ניתן לשנות תפקיד של המנהל הפעיל האחרון';
      return;
    }
    const patch = { name: fields.name, email: fields.email.toLowerCase(), phone: fields.phone, role: fields.role };
    if (fields.password) {
      const passwordPatch = await Auth.hashPassword(fields.password);
      patch.passwordHash = passwordPatch.passwordHash;
      patch.password = null;
    } // empty = keep existing
    _editingId = null;
    await VoltaDB.updateAgent(id, patch);
    audit('agent.update', 'agent', id, {
      name: fields.name,
      email: fields.email.toLowerCase(),
      role: fields.role,
      passwordChanged: !!fields.password,
    });
  }

  async function toggleAgent(id) {
    const agent = _agents.find(a => a.id === id);
    if (!agent) return;
    if (agent.active && Auth.isLastActiveManager(_agents, id)) {
      alert('לא ניתן להשבית את המנהל הפעיל האחרון.');
      return;
    }
    const nextActive = !agent.active;
    await VoltaDB.updateAgent(id, { active: nextActive });
    audit(nextActive ? 'agent.activate' : 'agent.deactivate', 'agent', id, {
      name: agent.name || '',
      email: agent.email || '',
    });
  }

  async function removeAgent(id) {
    const agent = _agents.find(a => a.id === id);
    if (Auth.isLastActiveManager(_agents, id)) {
      alert('לא ניתן למחוק את המנהל הפעיל האחרון.');
      return;
    }
    if (authMode() === 'firebase') {
      if (!window.confirm('לארכב את הנציג? במצב Firebase Auth הפרופיל יושבת במקום להימחק, כדי לשמור היסטוריית בקשות ו-audit.')) return;
      if (_editingId === id) _editingId = null;
      await VoltaDB.updateAgent(id, { active: false });
      audit('agent.deactivate', 'agent', id, {
        name: (agent || {}).name || '',
        email: (agent || {}).email || '',
        archived: true,
      });
      return;
    }
    if (!window.confirm('למחוק את הנציג? (עדיף להשבית כדי לשמור היסטוריית בקשות)')) return;
    if (_editingId === id) _editingId = null;
    await VoltaDB.deleteAgent(id);
    audit('agent.delete', 'agent', id, {
      name: (agent || {}).name || '',
      email: (agent || {}).email || '',
    });
  }

  function handleAdminClick(e) {
    const btn = e.target.closest('[data-admin-action]');
    if (!btn) return;
    const action = btn.dataset.adminAction;
    const id = btn.dataset.id || '';
    if (action === 'open-roof-settings') openRoofSettings();
    else if (action === 'filter-req') filterReq(btn.dataset.filter || 'pending');
    else if (action === 'approve') approve(id, btn.dataset.resolution || 'one-off');
    else if (action === 'reject') reject(id);
    else if (action === 'add-agent') addAgent();
    else if (action === 'start-edit') startEdit(id);
    else if (action === 'toggle-agent') toggleAgent(id);
    else if (action === 'remove-agent') removeAgent(id);
    else if (action === 'save-edit') saveEdit(id);
    else if (action === 'cancel-edit') cancelEdit();
  }

  function handleAdminInput(e) {
    if (e.target && e.target.dataset && e.target.dataset.adminInput === 'agent-search') {
      searchAgents(e.target.value);
    }
  }

  function init() {
    // Double-click the logo opens the panel for the logged-in lead/manager.
    // (Login-gate bootstrap + header button are wired in app.js.)
    const logo = document.querySelector('.brand');
    if (logo) logo.addEventListener('dblclick', openForCurrentAgent);
    const modal = document.getElementById('admin-modal');
    if (modal) {
      modal.addEventListener('click', handleAdminClick);
      modal.addEventListener('input', handleAdminInput);
    }
    document.getElementById('admin-close').addEventListener('click', close);
    document.querySelectorAll('.admin-tab').forEach(t =>
      t.addEventListener('click', () => switchTab(t.dataset.atab)));

    refreshSubscriptions();
  }

  function clearSubscriptions() {
    if (_agentsUnsub) { try { _agentsUnsub(); } catch (e) {} _agentsUnsub = null; }
    if (_requestsUnsub) { try { _requestsUnsub(); } catch (e) {} _requestsUnsub = null; }
    if (_auditUnsub) { try { _auditUnsub(); } catch (e) {} _auditUnsub = null; }
  }

  function refreshSubscriptions() {
    clearSubscriptions();
    const agent = Auth.getCurrentAgent();
    if (!agent || !VoltaDB.ready()) {
      _agents = [];
      _requests = [];
      _auditLogs = [];
      renderAdminBadge();
      return;
    }
    if (Auth.can(agent, 'manageAgents')) {
      _agentsUnsub = VoltaDB.subscribeAgents(list => {
        _agents = list;
        // Refresh only the list (keeps the add-form's typed values intact).
        if (_open && _ctx === 'manager') renderAgentList();
      });
    }
    if (Auth.can(agent, 'reviewRequests')) {
      _requestsUnsub = VoltaDB.subscribeRequests(list => {
        _requests = list;
        renderAdminBadge();
        if (_open) renderRequests();
      });
    }
    if (Auth.can(agent, 'manageAgents') && VoltaDB.subscribeAuditLogs) {
      _auditUnsub = VoltaDB.subscribeAuditLogs(list => {
        _auditLogs = list;
        if (_open && _ctx === 'manager') renderAudit();
      });
    }
  }

  return {
    init,
    refreshSubscriptions,
    openForCurrentAgent, bootstrap,
    filterReq, approve, reject,
    addAgent, saveEdit, toggleAgent, removeAgent, startEdit, cancelEdit, searchAgents,
    openRoofSettings,
    refreshBadge: renderAdminBadge,
  };
})();

function initManagerPanel() { Admin.init(); }
if (typeof window !== 'undefined') window.Admin = Admin;
