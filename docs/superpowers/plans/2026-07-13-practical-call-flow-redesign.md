# Practical Call-Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shorten the live sales call and cut agent-handling cost by trimming the wizard to fewer screens, moving the full 3D/2D house editor out of the live-call path behind a permission gate, surfacing reference info inline instead of via tab-switch, and measuring actual call duration so the fix can be verified.

**Architecture:** All changes are additive/refactoring within the existing vanilla-JS module pattern (`wizard.js`/`auth.js`/`requests.js` pure logic modules tested with `node --test`; `app.js`/`admin.js`/`index.html`/`styles.css` for rendering and wiring). No new build tooling, no new Firestore collections — reuses `agents`, `requests`, `auditLogs`.

**Tech Stack:** Vanilla JS (browser globals pattern), Firestore via the `VoltaDB` facade, `node --test`, headless Chrome (puppeteer-core) for e2e, GitHub Pages deploy (push to `main`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-13-practical-call-flow-redesign-design.md`.
- Do not touch: knowledge-base/offerings standalone tabs (03/04) as browsing surfaces, attendance module, the auth-race fix (`startAgentAuthSession`), Hebrew header/clock.
- Do not add smart context defaults for the eligibility questions (rejected in design — risk of mis-qualification).
- Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- All shell commands are Git Bash syntax, run from the repo root.
- **Critical discovered constraint:** `Auth.publicAgent()` and `Auth.setCurrentAgent()` (`auth.js`) whitelist which agent fields survive into the stored/current-agent object used everywhere via `Auth.getCurrentAgent()`. Any new per-agent field (`canDetailedPlan`) MUST be added to both whitelists or permission checks against the "current agent" will silently never see it.
- **Critical discovered constraint:** `Audit.buildEvent()` (`audit.js`) throws for any actor whose role isn't `lead`/`manager` — it cannot be used to log wizard-duration events for `agent`-role reps (the majority of users). Call-duration logging must call `VoltaDB.addAuditEvent(event)` directly with a hand-built event object, bypassing `admin.js`'s `audit()` wrapper and `Audit.buildEvent()` entirely.

---

### Task 1: `detailedPlanning` capability in Auth, with per-agent override

**Files:**
- Modify: `auth.js` (CAPS map ~line 14-18, `can()` ~line 127-131, `publicAgent()` ~line 188-190, `setCurrentAgent()` ~line 182-186)
- Test: `tests/auth.test.js` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Auth.can(agent, 'detailedPlanning')` — true for `manager` by default, false for `lead`/`agent` by default, overridden per-agent by a boolean `agent.canDetailedPlan` field when present. `canDetailedPlan` now survives `Auth.publicAgent()`/`Auth.setCurrentAgent()` into the stored session object. Task 2 (admin UI) writes this field on the agent's Firestore doc; Task 3 (button gating) reads it via `Auth.can`.

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/auth.test.js`
Expected: FAIL — `Auth.can` doesn't know `detailedPlanning`; `publicAgent` doesn't include `canDetailedPlan`.

- [ ] **Step 3: Implement**

In `auth.js`, add `detailedPlanning: true` to the `manager` entry in `CAPS` (line ~17), matching the existing style (only `true` capabilities are listed):

```js
  const CAPS = {
    agent:   { request: true },
    lead:    { request: true, reviewRequests: true },
    manager: { request: true, reviewRequests: true, manageAgents: true, roofSettings: true, detailedPlanning: true },
  };
```

Update `can()` (line ~127-131):

```js
  function can(agent, capability) {
    if (!agent || !agent.role) return false;
    if (capability === 'detailedPlanning' && typeof agent.canDetailedPlan === 'boolean') {
      return agent.canDetailedPlan;
    }
    const caps = CAPS[agent.role];
    return !!(caps && caps[capability]);
  }
```

Update `publicAgent()` (line ~188-190):

```js
  function publicAgent(agent) {
    return agent ? { id: agent.id, name: agent.name, role: agent.role, email: agent.email, canDetailedPlan: agent.canDetailedPlan } : null;
  }
```

Update `setCurrentAgent()` (line ~182-186):

```js
  function setCurrentAgent(agent) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      id: agent.id, name: agent.name, role: agent.role, email: agent.email, canDetailedPlan: agent.canDetailedPlan,
    }));
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/auth.test.js`
Expected: PASS (7 tests). Also run `node --test` (full suite) to confirm nothing else broke.

- [ ] **Step 5: Commit**

```bash
git add auth.js tests/auth.test.js
git commit -m "feat(auth): detailedPlanning capability with per-agent override"
```

---

### Task 2: Manager panel — grant/revoke detailed-planning access per agent

**Files:**
- Modify: `admin.js` (`renderAgents()` ~line 418-440, `editRowHtml()` ~line 474-489, `viewRowHtml()` ~line 456-472, `addAgent()` ~line 495-550, `saveEdit()` ~line 552-589)
- Modify: `styles.css` (new small rule for the checkbox label)

**Interfaces:**
- Consumes: `Auth.can`/`canDetailedPlan` field from Task 1.
- Produces: the agent add/edit forms write `canDetailedPlan` (boolean) to the agent's Firestore doc via `VoltaDB.addAgent`/`VoltaDB.setAgentProfile`/`VoltaDB.updateAgent` (all pre-existing, unchanged signatures).

- [ ] **Step 1: Add the checkbox to the add-agent form**

In `admin.js`'s `renderAgents()` (~line 424-432), add a checkbox to the `.agent-add` block:

```js
    pane.innerHTML = `
      <div class="agent-add">
        <input id="new-agent-name" class="login-input sm" maxlength="120" placeholder="שם">
        <input id="new-agent-email" class="login-input sm" type="email" maxlength="254" placeholder="אימייל">
        <input id="new-agent-password" class="login-input sm" type="${passwordType}" placeholder="${passwordPlaceholder}">
        <input id="new-agent-phone" class="login-input sm" maxlength="40" placeholder="טלפון (אופציונלי)">
        <select id="new-agent-role" class="login-input sm">${roleOptions('agent')}</select>
        <label class="plan-access-label"><input type="checkbox" id="new-agent-can-plan"> תכנון מפורט (3D)</label>
        <button class="btn primary sm" data-admin-action="add-agent">הוסף נציג</button>
      </div>
      <div id="agent-add-error" class="req-error"></div>
      <input id="agent-search" class="login-input sm agent-search"
        placeholder="🔍 חיפוש לפי שם / אימייל / טלפון" data-admin-input="agent-search">
      <div id="agent-list" class="agent-list"></div>`;
```

- [ ] **Step 2: Read the checkbox in `addAgent()`**

In the Firebase-auth branch (~line 512-520):

```js
      await VoltaDB.setAgentProfile(uid, {
        name: fields.name,
        email: fields.email.toLowerCase(),
        phone: fields.phone,
        role: fields.role,
        canDetailedPlan: document.getElementById('new-agent-can-plan').checked,
        active: true,
        createdAt: Date.now(),
        lastLoginAt: null,
      });
```

In the legacy branch (~line 537-541):

```js
    const ref = await VoltaDB.addAgent({
      name: fields.name, email: fields.email.toLowerCase(),
      passwordHash: passwordPatch.passwordHash, password: null,
      phone: fields.phone, role: fields.role,
      canDetailedPlan: document.getElementById('new-agent-can-plan').checked,
      active: true, createdAt: Date.now(), lastLoginAt: null,
    });
```

And when clearing the form fields after add (~line 527-529 and 547-549), also reset the checkbox:

```js
      ['new-agent-name', 'new-agent-email', 'new-agent-password', 'new-agent-phone'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      const planCb = document.getElementById('new-agent-can-plan'); if (planCb) planCb.checked = false;
```
(apply this same 3-line addition at both of the two places listed above where the field-clearing loop currently ends).

- [ ] **Step 3: Add the checkbox to the edit-agent row and read it in `saveEdit()`**

In `editRowHtml()` (~line 474-489):

```js
  function editRowHtml(a) {
    const safeId = domId(a.id);
    const idAttr = escHtml(a.id || '');
    return `<div class="agent-row editing">
      <input id="edit-name-${safeId}" class="login-input sm" maxlength="120" value="${escHtml(a.name || '')}" placeholder="שם">
      <input id="edit-email-${safeId}" class="login-input sm" type="email" maxlength="254" value="${escHtml(a.email || '')}" placeholder="אימייל">
      <input id="edit-password-${safeId}" class="login-input sm" type="password" placeholder="סיסמה חדשה (ריק = ללא שינוי)">
      <input id="edit-phone-${safeId}" class="login-input sm" maxlength="40" value="${escHtml(a.phone || '')}" placeholder="טלפון">
      <select id="edit-role-${safeId}" class="login-input sm">${roleOptions(a.role)}</select>
      <label class="plan-access-label"><input type="checkbox" id="edit-can-plan-${safeId}"${a.canDetailedPlan ? ' checked' : ''}> תכנון מפורט (3D)</label>
      <span class="ag-actions">
        <button class="btn primary sm" data-admin-action="save-edit" data-id="${idAttr}">שמור</button>
        <button class="btn reset sm" data-admin-action="cancel-edit">ביטול</button>
      </span>
      <div id="edit-error-${safeId}" class="req-error"></div>
    </div>`;
  }
```

In `saveEdit()`, add to `fields` (~line 556-562) and to `patch` (~line 575):

```js
    const fields = {
      name: document.getElementById('edit-name-' + safeId).value.trim(),
      email: document.getElementById('edit-email-' + safeId).value.trim(),
      password: document.getElementById('edit-password-' + safeId).value,
      phone: document.getElementById('edit-phone-' + safeId).value.trim(),
      role: document.getElementById('edit-role-' + safeId).value,
      canDetailedPlan: document.getElementById('edit-can-plan-' + safeId).checked,
    };
```

```js
    const patch = { name: fields.name, email: fields.email.toLowerCase(), phone: fields.phone, role: fields.role, canDetailedPlan: fields.canDetailedPlan };
```

- [ ] **Step 4: Show the override at a glance in the agent list row**

In `viewRowHtml()` (~line 456-472), add a small badge only when the field is explicitly set (so a normal role-default agent shows nothing extra):

```js
  function viewRowHtml(a) {
    const idAttr = escHtml(a.id || '');
    const roleClass = ROLE_CLASS[a.role] || 'agent';
    const removeLabel = authMode() === 'firebase' ? 'ארכב' : 'מחק';
    const planBadge = a.canDetailedPlan === true
      ? '<span class="role-badge role-manager" title="הרשאת תכנון מפורט הוענקה ידנית">🧩 תכנון</span>'
      : (a.canDetailedPlan === false ? '<span class="role-badge" title="תכנון מפורט חסום ידנית">🚫 תכנון</span>' : '');
    return `<div class="agent-row ${a.active ? '' : 'inactive'}">
      <span class="ag-name">${escHtml(a.name || '')}</span>
      <span class="role-badge role-${roleClass}">${escHtml(Auth.roleLabel(a.role))}</span>
      ${planBadge}
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
```

- [ ] **Step 5: Add the checkbox-label style**

Append to `styles.css`:

```css
.plan-access-label { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-dim); white-space: nowrap; }
```

- [ ] **Step 6: Manual verification**

Run: `node --check admin.js` → no output. This task has no pure-logic unit to test (it's DOM wiring); it will be exercised end-to-end in Task 9's browser e2e (manager grants/revokes the checkbox, Task 3's gate reacts).

- [ ] **Step 7: Commit**

```bash
git add admin.js styles.css
git commit -m "feat(admin): per-agent detailed-planning access toggle in agent form"
```

---

### Task 3: `'planning'` request type + gate the full 3D/2D editor button

**Files:**
- Modify: `requests.js` (`buildRequest` type whitelist, line ~33)
- Modify: `app.js` (add `REQ_TYPE_LABEL`, new `updateSimDockAccess()`/`sendPlanningHandoff()`, wire dispatcher, call from `renderWizard()`/`renderAgentBar()`)
- Modify: `admin.js` (request-type label in `renderRequests()`, line ~344)
- Modify: `index.html` (sim-dock header markup, line ~269-277)
- Modify: `styles.css` (small rule for the handoff button)
- Test: `tests/requests.test.js` (new)

**Interfaces:**
- Consumes: `Auth.can(agent, 'detailedPlanning')` (Task 1), `Wizard.getState().outcome`.
- Produces: `Requests.buildRequest({ type: 'planning', ... })` now valid; `#se-open-btn` visible only at outcome + permission; `#se-handoff-btn` visible only at outcome without permission, wired to a new `send-planning-handoff` app-action.

- [ ] **Step 1: Write the failing test for the new request type**

```js
// tests/requests.test.js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/requests.test.js`
Expected: FAIL — `buildRequest` throws `invalid type` for `'planning'`.

- [ ] **Step 3: Add `'planning'` to the type whitelist**

In `requests.js` line ~33:

```js
    if (!['settlement', 'roof', 'planning'].includes(type)) throw new Error('invalid type');
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/requests.test.js` → PASS (2 tests). Run `node --test` (full suite) to confirm no regression — `admin.js`'s `resolution === 'permanent' && req.type === 'roof'`/`'settlement'` guards will simply never match `'planning'`, so the existing permanent-approval branches are unaffected.

- [ ] **Step 5: Update the two request-type label ternaries to a 3-way map**

In `app.js`, add near the top of the "MY REQUESTS" section (~line 1046, right before `let _myRequests = [];`):

```js
const REQ_TYPE_LABEL = { settlement: '📍 יישוב', roof: '🏠 גג', planning: '📤 תכנון' };
```

Replace the ternary at ~line 1060:

```js
      <div class="mr-head"><span class="mr-type">${REQ_TYPE_LABEL[r.type] || r.type}</span>
```

In `admin.js`, add the same constant near the top of the file (after `AUDIT_LABELS`, ~line 25):

```js
  const REQ_TYPE_LABEL = { settlement: '📍 יישוב', roof: '🏠 גג', planning: '📤 תכנון' };
```

Replace the ternary at ~line 344:

```js
        <div class="ar-head"><span>${REQ_TYPE_LABEL[r.type] || r.type}</span>
```

- [ ] **Step 6: Add the handoff button next to the editor-open button in `index.html`**

Replace the dock-actions block (~line 272-276):

```html
      <span class="dock-actions">
        <button class="dock-toggle dock-edit hidden" id="se-open-btn" title="הגדל ועריכה: הוספת גג, מכשולים ודלת">⛶ הגדל ועריכה</button>
        <button class="dock-toggle dock-edit hidden" id="se-handoff-btn" data-app-action="send-planning-handoff" title="שלח את המקרה לתכנון תלת-ממד מפורט">📤 שלח לתכנון טכני</button>
        <button class="dock-toggle" data-app-action="recenter-sim" title="מרכז מחדש">⊕</button>
        <button class="dock-toggle" id="sim-dock-toggle" data-app-action="toggle-sim-dock" title="כווץ / הרחב">▾</button>
      </span>
```

Note: `#se-open-btn` starts with the `hidden` class now (previously always visible from the first render) — this is the core fix for "the editor button is visible from the first moment of the wizard."

- [ ] **Step 7: Add the gating + handoff logic in `app.js`**

Add after `renderAgentBar()`'s closing brace (after ~line 813):

```js
function wizardRoofSubjectForHandoff() {
  return (typeof wizardRoofSubject === 'function') ? wizardRoofSubject() : '';
}

function updateSimDockAccess() {
  const openBtn = document.getElementById('se-open-btn');
  const handoffBtn = document.getElementById('se-handoff-btn');
  if (!openBtn) return;
  const agent = Auth.getCurrentAgent();
  const atOutcome = !!(Wizard.getState().outcome);
  const allowed = atOutcome && !!(agent && Auth.can(agent, 'detailedPlanning'));
  openBtn.classList.toggle('hidden', !allowed);
  if (handoffBtn) handoffBtn.classList.toggle('hidden', !(atOutcome && !allowed));
}

async function sendPlanningHandoff() {
  const agent = Auth.getCurrentAgent();
  if (!agent) return;
  if (!VoltaDB.ready()) { alert('אין חיבור לשרת — נסה שוב'); return; }
  try {
    const req = Requests.buildRequest({
      type: 'planning', agent, subject: wizardRoofSubjectForHandoff(),
      reason: 'העברה אוטומטית לתכנון תלת-ממד מפורט לאחר הכשרת האשף.',
      context: { outcome: Wizard.getState().outcome },
    });
    await VoltaDB.addRequest(req);
    alert('המקרה נשלח לתכנון טכני ✓');
  } catch (e) {
    alert('שליחה נכשלה: ' + ((e && e.message) || 'שגיאה'));
  }
}
```

Wire the click in `initAppDelegates()`'s dispatcher (~line 143-147, right after the `toggle-sim-dock` branch):

```js
    } else if (action === 'toggle-sim-dock') {
      toggleSimDock();
    } else if (action === 'send-planning-handoff') {
      sendPlanningHandoff();
    } else if (action === 'attendance-punch') {
```

Call `updateSimDockAccess()` at the top of `renderWizard()` (right after `const q = Wizard.currentQuestion();`, ~line 163) and at the end of `renderAgentBar()` (~line 812, after the attendance line):

```js
  if (typeof renderAttendance === 'function') renderAttendance(); // punch button follows login state
  if (typeof updateSimDockAccess === 'function') updateSimDockAccess();
```

- [ ] **Step 8: Style the handoff button distinctly (secondary, not the primary edit-amber look)**

Append to `styles.css`:

```css
#se-handoff-btn { color: var(--text-dim); border-color: var(--line); }
#se-handoff-btn:hover { color: var(--cyan); border-color: var(--cyan); background: rgba(120,220,255,.08); }
```

- [ ] **Step 9: Syntax check + full test suite**

Run: `node --check app.js && node --check admin.js && node --check requests.js` → no output.
Run: `node --test` → all pass, including the new `tests/requests.test.js`.

- [ ] **Step 10: Commit**

```bash
git add requests.js app.js admin.js index.html styles.css tests/requests.test.js
git commit -m "feat: gate the full 3D/2D editor behind detailedPlanning; add planning-handoff request type"
```

---

### Task 4: Merge the 5 eligibility questions into one checklist screen

**Files:**
- Modify: `wizard.js` (`QUESTIONS`, `MAIN_FLOW`, `buildFlow`, `toggleRoofType`'s lookup untouched here, new `confirmEligibility`, `getQuestionById`, exported API)
- Test: `tests/wizard.test.js` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Wizard.confirmEligibility(selections)` where `selections` is `{ 'property-type': optionIndex, ownership: optionIndex, permit: optionIndex, connection: optionIndex, meter: optionIndex }`, returning `{ done: true }` (stop/follow-up/advance) or `{ done: false, error }` when incomplete. `Wizard.getQuestionById(id)` exposes any `QUESTIONS` entry by id (used by Task 5's rendering to read sub-question `text`/`options`). `MAIN_FLOW`'s first step becomes `'eligibility'` instead of the five separate ids.

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/wizard.test.js`
Expected: FAIL — `Wizard.confirmEligibility`/`Wizard.getQuestionById` don't exist yet.

- [ ] **Step 3: Implement in `wizard.js`**

Add a new `QUESTIONS` entry (insert right before the existing `roof-type` entry, ~line 172):

```js
    {
      id: 'eligibility',
      text: 'בדיקת התאמה ראשונית',
      hint: 'שאל את הלקוח את כל חמש השאלות ברצף, ואז סמן הכל ולחץ המשך',
      type: 'eligibility-checklist',
      subIds: ['property-type', 'ownership', 'permit', 'connection', 'meter'],
    },
```

Update `MAIN_FLOW` (line 225):

```js
  const MAIN_FLOW = ['eligibility','roof-and-sizes','roof-orientation','shading'];
```

Rename the `roof-type` QUESTIONS entry's `id` to `roof-and-sizes` and reword its copy (this entry currently sits right after the new `eligibility` entry, ~line 173-178):

```js
    {
      id: 'roof-and-sizes',
      text: 'מה סוג/י הגג — ומה השטח המשוער של כל חלק?',
      hint: 'בחר סוג, ואז הזן הערכת שטח לצידו. אפשר לבחור כמה חלקים — לדוגמה פרגולה + בטון שטוח.',
      type: 'roof-and-sizes',
      get options() { return roofTypeOptions(); },
    },
```

Remove the standalone `material-sizes` QUESTIONS entry (~line 192-198) — it's superseded by the merged `roof-and-sizes` entry and is no longer referenced by any `getQuestion` lookup.

Update `toggleRoofType()`'s lookup (line 265) to match the renamed id:

```js
  function toggleRoofType(optionIndex) {
    const q = QUESTIONS.find(q => q.id === 'roof-and-sizes');
```

Update `buildFlow()`'s tiles-age insertion anchor (line 252-261), since `'material-sizes'` no longer exists as a flow id:

```js
  function buildFlow() {
    const flow = [...MAIN_FLOW];
    const hasTiles = state.selectedRoofTypes.some(t => t.value === 'tiles') ||
      state.answers.some(a => a.questionId === 'roof-type' && a.value === 'tiles');
    if (hasTiles) {
      const idx = flow.indexOf('roof-and-sizes');
      flow.splice(idx, 0, 'tiles-age');
    }
    return flow;
  }
```

Add `getQuestionById` and `confirmEligibility` (insert after `getQuestion`, ~line 229, before the undo-history block):

```js
  function getQuestionById(id) { return getQuestion(id); }

  // Merge the five binary eligibility gates into one submission. Precedence
  // matches the original sequential flow exactly: walk the five in order,
  // and whichever is the FIRST with a stop or follow-up action determines the
  // outcome — later answers in the order are never "reached" for that purpose,
  // same as if they'd been asked one screen at a time. Flags are accumulated
  // from ALL five regardless of where the stop/follow-up point falls: the rep
  // already collected every answer in one go, so there's strictly more useful
  // context for the manager than the old one-screen-at-a-time flow ever showed.
  function confirmEligibility(selections) {
    const ids = getQuestion('eligibility').subIds;
    const missing = ids.filter(id => selections == null || selections[id] == null);
    if (missing.length) return { done: false, error: 'יש לענות על כל השאלות' };

    snapshot();
    const chosen = ids.map(id => ({ id, opt: getQuestion(id).options[selections[id]] }));
    chosen.forEach(({ id, opt }) => {
      state.answers.push({ questionId: id, label: opt.label, value: opt.value, flagClass: opt.flagClass || 'ok' });
    });

    const firstBlocking = chosen.find(({ opt }) => opt.action === 'stop' || opt.action === 'follow-up');
    if (firstBlocking) {
      const { opt } = firstBlocking;
      if (opt.action === 'stop') {
        state.outcome = 'stop';
        state.stopReason = opt.stopReason;
        state.stopScript = opt.stopScript;
      } else {
        state.outcome = 'follow-up';
        state.followUpNote = opt.followUpNote;
      }
      return { done: true };
    }

    chosen.forEach(({ opt }) => { if (opt.action === 'flag' && opt.flagMsg) state.flags.push(opt.flagMsg); });
    if (chosen.some(({ id }) => id === 'property-type')) {
      state.propertyType = chosen.find(({ id }) => id === 'property-type').opt.value;
    }

    state.step++;
    const flow = currentFlow();
    if (state.step >= flow.length) {
      state.outcome = state.flags.length > 0 ? 'go-notes' : 'go';
      return { done: true };
    }
    return { done: false };
  }
```

Add `getQuestionById` and `confirmEligibility` to the returned public API (line ~469):

```js
  return { reset, back, canBack, currentQuestion, currentFlow, answer, getState, getQuestionById, confirmEligibility,
    toggleRoofType, confirmRoofTypes, toggleObstacle, confirmObstacles, selectedMaterials, answerMaterialSizes, getSimInputs };
```

(`confirmRoofTypes`/`answerMaterialSizes` stay exported for now — Task 5 replaces their call sites and removes them from the export list.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/wizard.test.js` → PASS (7 tests).
Run: `node --test` (full suite) — expect `tests/roof-layout.test.js` and others unaffected. Note: this step temporarily breaks `app.js`'s old rendering (which still calls the now-removed flow ids) — that's fixed in Task 5's rendering step; `node --check app.js` may still pass since these are runtime lookups, not syntax errors, but the wizard tab will not render correctly in the browser until Task 5 lands. Do not deploy between Task 4 and Task 5.

- [ ] **Step 5: Commit**

```bash
git add wizard.js tests/wizard.test.js
git commit -m "feat(wizard): merge the 5 eligibility gates into one checklist submission"
```

---

### Task 5: Render the eligibility checklist + merge roof-type/size into one screen

**Files:**
- Modify: `wizard.js` (new `confirmRoofTypesAndSizes`, remove `confirmRoofTypes`/`answerMaterialSizes` from the public API)
- Modify: `app.js` (`renderQuestionInput`, `renderWizard`, new `eligibilityPick`/`readEligibilitySelections`/`wizardConfirmEligibility`/`wizardConfirmRoofSizes`, dispatcher wiring)
- Modify: `styles.css` (checklist row styling)
- Test: extend `tests/wizard.test.js`

**Interfaces:**
- Consumes: `Wizard.getQuestionById`/`Wizard.confirmEligibility` (Task 4).
- Produces: `Wizard.confirmRoofTypesAndSizes(sizesMap)` where `sizesMap` is `{ [materialId]: size }`; app-actions `eligibility-pick`, `wizard-confirm-eligibility`, `wizard-confirm-roof-sizes`.

- [ ] **Step 1: Write the failing test for the merged roof-type+size function**

Add to `tests/wizard.test.js`:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/wizard.test.js`
Expected: FAIL — `Wizard.confirmRoofTypesAndSizes is not a function`.

- [ ] **Step 3: Implement `confirmRoofTypesAndSizes` in `wizard.js`, deleting the two functions it replaces**

Delete `confirmRoofTypes()` entirely, including its preceding comment (~line 274-297: `// Confirm multi-roof selection...` through its closing `}`). Delete `answerMaterialSizes()` entirely, including its preceding comment (~line 371-407: `// Submit per-material sizes...` through its closing `}`). Both are fully superseded — after Task 4 and this step, neither is called anywhere in `app.js`, and Task 4 already noted they'd be dropped from the public API here.

In their place (same general area — right after `currentFlow()`/`currentQuestion()`, before `answer()`, ~where `confirmRoofTypes` used to sit at line 274), add:

```js
  // Merged screen: roof-type selection + per-type size entry in one submission.
  // Runs the same evaluateRoof single source of truth confirmRoofTypes/answerMaterialSizes
  // used to run separately; this replaces both call sites.
  function confirmRoofTypesAndSizes(sizesMap) {
    if (state.selectedRoofTypes.length === 0) return { done: false, error: 'בחר לפחות סוג גג אחד' };
    snapshot();
    const selected = state.selectedRoofTypes;
    const labels = selected.map(t => t.label).join(' + ');
    state.answers.push({
      questionId: 'roof-type', label: labels,
      value: selected.map(t => t.value).join('+'), flagClass: 'ok',
    });

    const sizes = selected.map(t => ({ materialId: t.value, size: (sizesMap && sizesMap[t.value]) || 0 }));
    const r = evaluateRoof(sizes, cfg());
    state.materialSizes = sizes.filter(s => (parseInt(s.size) || 0) > 0);
    const recap = r.perMaterial.map(p => `${p.label} ${p.size}מ"ר`).join(' + ');
    const hasWarn = r.flags.length > 0 || r.perMaterial.some(p => p.outcome === 'warn');
    state.answers.push({
      questionId: 'material-sizes',
      label: recap + (hasWarn ? ' ⚠️' : ' ✅'),
      value: sizes.map(s => `${s.materialId}:${s.size}`).join(','),
      flagClass: hasWarn ? 'warn' : 'ok',
    });

    if (r.outcome === 'stop') {
      state.outcome = 'stop'; state.stopReason = r.stopReason; state.stopScript = r.stopScript;
      return { done: true };
    }
    if (r.outcome === 'escalate') {
      state.outcome = 'escalate'; state.escalateNote = r.escalateNote;
      return { done: true };
    }
    r.flags.forEach(f => { if (f) state.flags.push(f); });

    state.step++;
    const flow = currentFlow();
    if (state.step >= flow.length) {
      state.outcome = state.flags.length > 0 ? 'go-notes' : 'go';
      return { done: true };
    }
    return { done: false };
  }
```

Update the public API (replace `confirmRoofTypes, ... answerMaterialSizes,` with `confirmRoofTypesAndSizes,`):

```js
  return { reset, back, canBack, currentQuestion, currentFlow, answer, getState, getQuestionById, confirmEligibility,
    toggleRoofType, confirmRoofTypesAndSizes, toggleObstacle, confirmObstacles, selectedMaterials, getSimInputs };
```

- [ ] **Step 4: Run the wizard tests to verify they pass**

Run: `node --test tests/wizard.test.js` → PASS (9 tests).

- [ ] **Step 5: Render the eligibility checklist in `app.js`**

In `renderQuestionInput()` (~line 360), add a new branch (order doesn't matter, put it first):

```js
function renderQuestionInput(q) {
  if (q.type === 'eligibility-checklist') {
    const groups = q.subIds.map(id => {
      const sq = Wizard.getQuestionById(id);
      const opts = sq.options.map((opt, oi) =>
        `<button class="answer-btn sm" data-app-action="eligibility-pick" data-qid="${id}" data-option-index="${oi}">${escHtml(opt.label)}</button>`
      ).join('');
      return `<div class="elig-row" data-qid="${id}">
        <div class="elig-q">${escHtml(sq.text)}</div>
        <div class="answer-row">${opts}</div>
      </div>`;
    }).join('');
    return `<div class="elig-checklist">${groups}</div>
      <div id="elig-error" class="roof-multi-error"></div>
      <div class="btn-row mt-14">
        <button class="btn primary" data-app-action="wizard-confirm-eligibility">המשך ←</button>
      </div>`;
  }
  if (q.type === 'roof-and-sizes') {
    const selected = Wizard.getState().selectedRoofTypes;
    const btns = q.options.map((opt, i) => {
      const isSel = selected.some(t => t.value === opt.value);
      return `<button class="roof-btn ${opt.flagClass}${isSel ? ' selected' : ''}" data-app-action="wizard-toggle-roof" data-option-index="${i}">${escHtml(opt.label)}</button>`;
    }).join('');
    const sizeRows = selected.map(t => `
      <div class="msize-row">
        <span class="msize-label">${escHtml(t.label)}</span>
        <input type="number" min="0" max="1000" value="40" inputmode="numeric"
          class="msize-input" data-id="${escHtml(t.value)}" data-app-input="material-size">
        <span class="msize-unit">מ"ר</span>
      </div>`).join('');
    return `<div class="roof-grid">${btns}</div>
      <div id="roof-multi-error" class="roof-multi-error"></div>
      ${selected.length ? `<div class="msize-list mt-14">${sizeRows}</div>
        <div class="msize-total" id="msize-total">סה"כ: 0 מ"ר</div>
        <div class="msize-verdict ok" id="msize-verdict"></div>` : ''}
      <div class="btn-row mt-14">
        <button class="btn primary" data-app-action="wizard-confirm-roof-sizes">אשר גגות ומידות ←</button>
      </div>`;
  }
  if (q.type === 'buttons') {
```

Remove the now-dead `q.type === 'roof-grid-multi'` and `q.type === 'material-sizes'` branches (they were the two screens `roof-and-sizes` replaces).

- [ ] **Step 6: Wire the new interactions in `app.js`**

Delete `materialSizesConfirm()` (~line 473-476) entirely — no replacement, it's superseded by `wizardConfirmRoofSizes()` below. Leave `wizardToggleObstacle()`, `wizardConfirmObstacles()`, and `wizardToggleRoof()` (~line 478-489, sitting right after it) exactly as they are — untouched, not part of this change.

Then delete `wizardConfirmRoofs()` (~line 491-499, right after `wizardToggleRoof`) and replace it with:

```js
function eligibilityPick(qid, optionIndex) {
  const row = document.querySelector(`.elig-row[data-qid="${qid}"]`);
  if (!row) return;
  row.querySelectorAll('.answer-btn').forEach((b, i) => b.classList.toggle('selected', i === optionIndex));
}

function readEligibilitySelections() {
  const out = {};
  document.querySelectorAll('.elig-row').forEach(row => {
    const qid = row.dataset.qid;
    const idx = Array.from(row.querySelectorAll('.answer-btn')).findIndex(b => b.classList.contains('selected'));
    if (idx >= 0) out[qid] = idx;
  });
  return out;
}

function wizardConfirmEligibility() {
  const result = Wizard.confirmEligibility(readEligibilitySelections());
  if (!result.done && result.error) {
    const errEl = document.getElementById('elig-error');
    if (errEl) errEl.textContent = result.error;
    return;
  }
  renderWizard();
}

function wizardConfirmRoofSizes() {
  const sizesMap = {};
  readMaterialSizes().forEach(s => { sizesMap[s.materialId] = s.size; });
  const result = Wizard.confirmRoofTypesAndSizes(sizesMap);
  if (!result.done && result.error) {
    const errEl = document.getElementById('roof-multi-error');
    if (errEl) errEl.textContent = result.error;
    return;
  }
  renderWizard();
}
```

Update the dispatcher in `initAppDelegates()`. Two separate edits (these two branches are not adjacent in the original list — see `app.js:103-155`):

Replace the `wizard-confirm-roofs` branch (~line 123-124, right after `wizard-toggle-roof`):

```js
    } else if (action === 'wizard-toggle-roof') {
      wizardToggleRoof(parseInt(actionEl.dataset.optionIndex, 10));
    } else if (action === 'eligibility-pick') {
      eligibilityPick(actionEl.dataset.qid, parseInt(actionEl.dataset.optionIndex, 10));
    } else if (action === 'wizard-confirm-eligibility') {
      wizardConfirmEligibility();
    } else if (action === 'wizard-confirm-roof-sizes') {
      wizardConfirmRoofSizes();
    } else if (action === 'wizard-toggle-obstacle') {
```

Delete the separate `material-sizes-confirm` branch further down (~line 133-134, between `wizard-orientation-confirm` and `open-roof-request`):

```js
    } else if (action === 'wizard-orientation-confirm') {
      wizardOrientationConfirm();
    } else if (action === 'open-roof-request') {
```

- [ ] **Step 7: Update `renderWizard()`'s post-render hooks**

Replace the `material-sizes`-keyed hooks at the end of `renderWizard()` (~line 210-216):

```js
  container.innerHTML = html;
  if (q && q.type === 'compass') {
    setTimeout(() => initRoofCompass(180), 0);
  }
  if (q && q.type === 'roof-and-sizes' && Wizard.getState().selectedRoofTypes.length) {
    setTimeout(() => updateMaterialSizes(), 0);
  }
  setTimeout(() => updateSimDock(q && q.type === 'roof-and-sizes' ? readMaterialSizes() : null), 0);
```

- [ ] **Step 8: Style the checklist rows**

Append to `styles.css`:

```css
.elig-checklist { display: flex; flex-direction: column; gap: 14px; }
.elig-row { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
.elig-q { font-weight: 600; color: var(--text); margin-bottom: 8px; font-size: 14px; }
.answer-btn.sm { padding: 8px 12px; font-size: 13px; }
```

- [ ] **Step 9: Full test suite + syntax check**

Run: `node --test` → all pass.
Run: `node --check app.js && node --check wizard.js` → no output.

- [ ] **Step 10: Commit**

```bash
git add wizard.js app.js styles.css tests/wizard.test.js
git commit -m "feat(wizard): render the merged eligibility checklist and roof-type+size screens"
```

---

### Task 6: Visible step + elapsed-time indicator

**Files:**
- Modify: `wizard.js` (`reset()`, line ~246-250)
- Modify: `app.js` (`renderWizard()` progress area, new `tickWizardElapsed()`, start the interval in `initWizard()`)
- Modify: `styles.css` (elapsed-time chip styling)

**Interfaces:**
- Consumes: `Wizard.getState().startedAt` (new field).
- Produces: a live `#wizard-elapsed` chip, ticking every second while a wizard session is in progress.

- [ ] **Step 1: Add `startedAt` to the wizard state**

In `wizard.js`'s `reset()` (line 246-250):

```js
  function reset() {
    history = [];
    state = { step: 0, answers: [], flags: [], outcome: null, stopReason: '', stopScript: '', escalateNote: '', followUpNote: '', selectedRoofTypes: [],
      materialSizes: [], orientationAz: 180, shading: 'none', selectedObstacles: [], propertyType: 'private', startedAt: Date.now() };
  }
```

- [ ] **Step 2: Add the chip markup + ticking in `app.js`**

In `renderWizard()` (~line 180-184), add the chip next to the step counter:

```js
  let html = `
    <div class="progress-area">
      <div class="progress-label"><span>שאלה ${current} מתוך ${total} · <span id="wizard-elapsed">00:00</span></span><span>${pct}%</span></div>
      <div class="progress-bar"><div class="progress-fill progress-${pctClass}"></div></div>
    </div>`;
```

Add a ticking function and start it once, near `initWizard()` (~line 762-765):

```js
function tickWizardElapsed() {
  const s = Wizard.getState();
  const el = document.getElementById('wizard-elapsed');
  if (!el || !s.startedAt) return;
  const totalSec = Math.floor((Date.now() - s.startedAt) / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  el.textContent = mm + ':' + ss;
}

function initWizard() {
  Wizard.reset();
  renderWizard();
  setInterval(tickWizardElapsed, 1000);
}
```

(`setInterval` is started once, since `initWizard()` runs once at app startup — see `app.js`'s `init()`; it harmlessly no-ops via the `if (!el...) return` guard whenever the chip isn't on screen, e.g. on the outcome page.)

- [ ] **Step 3: Style the chip**

Append to `styles.css`:

```css
#wizard-elapsed { font-family: var(--mono); color: var(--muted); }
```

- [ ] **Step 4: Manual verification**

Run: `node --check app.js && node --check wizard.js` → no output. No pure-logic unit to test here (it's a `Date.now()`-driven DOM tick); verified in Task 9's browser e2e (chip advances, resets to `00:00` after "בדיקה חדשה").

- [ ] **Step 5: Commit**

```bash
git add wizard.js app.js styles.css
git commit -m "feat(wizard): visible step + elapsed-time indicator"
```

---

### Task 7: Call-duration measurement

**Files:**
- Create: `call-metrics.js`, `tests/call-metrics.test.js`
- Modify: `app.js` (log on outcome), `admin.js` (`renderAudit()` stat block + row filtering), `index.html` (new script tag)

**Interfaces:**
- Consumes: `VoltaDB.addAuditEvent` (existing, unchanged), `VoltaDB.subscribeAuditLogs` (existing, already feeding `admin.js`'s `_auditLogs`).
- Produces: `CallMetrics.aggregate(events)` → `{ count, medianMs, avgMs }`; `CallMetrics.fmtDuration(ms)` → `"mm:ss"` string. Every wizard completion writes one `auditLogs` doc with `action: 'wizard.duration'`.

- [ ] **Step 1: Write the failing tests for the pure aggregation module**

```js
// tests/call-metrics.test.js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/call-metrics.test.js`
Expected: FAIL — `Cannot find module '../call-metrics.js'`.

- [ ] **Step 3: Create `call-metrics.js`**

```js
// Pure aggregation over wizard.duration audit events. No DOM, no Firebase.
const CallMetrics = (() => {
  function aggregate(events) {
    const durations = (events || [])
      .filter(e => e && e.action === 'wizard.duration' && e.details && typeof e.details.durationMs === 'number')
      .map(e => e.details.durationMs)
      .sort((a, b) => a - b);
    const count = durations.length;
    if (count === 0) return { count: 0, medianMs: 0, avgMs: 0 };
    const mid = Math.floor(count / 2);
    const medianMs = count % 2 ? durations[mid] : Math.round((durations[mid - 1] + durations[mid]) / 2);
    const avgMs = Math.round(durations.reduce((a, b) => a + b, 0) / count);
    return { count, medianMs, avgMs };
  }

  function fmtDuration(ms) {
    const totalSec = Math.round((ms || 0) / 1000);
    const mm = Math.floor(totalSec / 60);
    const ss = String(totalSec % 60).padStart(2, '0');
    return mm + ':' + ss;
  }

  return { aggregate, fmtDuration };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CallMetrics;
if (typeof window !== 'undefined') window.CallMetrics = CallMetrics;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/call-metrics.test.js` → PASS (5 tests).

- [ ] **Step 5: Log a duration event once per wizard session, in `app.js`**

Add near `initWizard()` (module scope, e.g. right before `initWizard()`, ~line 762):

```js
let _durationLogged = false;

function logWizardDurationIfNeeded() {
  if (_durationLogged) return;
  const s = Wizard.getState();
  if (!s.outcome || !s.startedAt) return;
  const agent = Auth.getCurrentAgent();
  if (!agent || !VoltaDB.ready() || !VoltaDB.addAuditEvent) return;
  _durationLogged = true;
  VoltaDB.addAuditEvent({
    action: 'wizard.duration',
    targetType: 'wizardSession',
    targetId: '',
    actorId: agent.id, actorName: agent.name || '', actorRole: agent.role || '',
    details: { durationMs: Date.now() - s.startedAt, outcome: s.outcome },
    createdAt: Date.now(),
  }).catch(() => {});
}
```

Call it from `renderWizard()`'s outcome branch (~line 165-172):

```js
  if (s.outcome) {
    container.innerHTML = renderWizardResult();
    if (window.VoltaGlobe && (s.outcome === 'go' || s.outcome === 'go-notes')) {
      window.VoltaGlobe.deploy();
    }
    setTimeout(() => updateSimDock(), 0); // dock reflects the final house
    logWizardDurationIfNeeded();
    return;
  }
```

Reset the flag in `resetWizard()` (~line 501-504):

```js
function resetWizard() {
  Wizard.reset();
  _durationLogged = false;
  renderWizard();
}
```

(This event write is deliberately NOT built through `admin.js`'s `audit()` helper / `Audit.buildEvent()` — that path throws for any actor whose role isn't `lead`/`manager`, and most reps completing the wizard are role `agent`. Calling `VoltaDB.addAuditEvent` directly with a hand-built event, as above, writes to the same `auditLogs` collection for any role.)

- [ ] **Step 6: Surface the aggregate in the manager panel's Audit tab, in `admin.js`**

Replace `renderAudit()` (line 289-313):

```js
  function renderAudit() {
    const pane = document.getElementById('admin-audit');
    if (!pane) return;
    if (_ctx !== 'manager') { pane.innerHTML = ''; return; }
    const metrics = (typeof CallMetrics !== 'undefined')
      ? CallMetrics.aggregate(_auditLogs)
      : { count: 0, medianMs: 0, avgMs: 0 };
    const statsHtml = `<div class="call-metrics">
      <div class="cm-title">⏱ זמן שיחה (אשף כשירות גג)</div>
      <div class="cm-row">
        <span class="cm-stat"><b>${metrics.count}</b> שיחות נמדדו</span>
        <span class="cm-stat">חציון <b>${CallMetrics.fmtDuration(metrics.medianMs)}</b></span>
        <span class="cm-stat">ממוצע <b>${CallMetrics.fmtDuration(metrics.avgMs)}</b></span>
      </div>
    </div>`;
    const list = _auditLogs
      .filter(e => e.action !== 'wizard.duration')
      .slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 80);
    if (!list.length) {
      pane.innerHTML = statsHtml + '<div class="my-req-empty">אין אירועי audit עדיין.</div>';
      return;
    }
    pane.innerHTML = statsHtml + list.map(e => {
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
```

- [ ] **Step 7: Load the new module in `index.html`**

Add near the other pure-logic modules, right after the `attendance.js` script tag:

```html
  <script src="attendance.js"></script>
  <script src="call-metrics.js"></script>
```

- [ ] **Step 8: Style the stat block**

Append to `styles.css`:

```css
.call-metrics { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; }
.cm-title { font-weight: 700; color: var(--text); margin-bottom: 8px; font-size: 14px; }
.cm-row { display: flex; gap: 18px; flex-wrap: wrap; }
.cm-stat { font-size: 13px; color: var(--text-dim); }
.cm-stat b { color: var(--cyan-br); font-variant-numeric: tabular-nums; }
```

- [ ] **Step 9: Full test suite + syntax check**

Run: `node --test` → all pass.
Run: `node --check app.js && node --check admin.js && node --check call-metrics.js` → no output.

- [ ] **Step 10: Commit**

```bash
git add call-metrics.js tests/call-metrics.test.js app.js admin.js index.html styles.css
git commit -m "feat: measure and surface wizard call duration (median/avg) in the manager panel"
```

---

### Task 8: Contextual KB + offerings drawer inside the wizard

**Files:**
- Modify: `app.js` (new `renderReferenceDrawer()`, `toggleReferenceDrawer()`, hook into `renderWizard()`)
- Modify: `index.html` (drawer markup inside `#tab-wizard`)
- Modify: `styles.css` (drawer styling)

**Interfaces:**
- Consumes: `window.VOLTA_KB` (existing, from `knowledge-base.js`), `Offerings.getAll()` (existing).
- Produces: a collapsible in-wizard drawer that highlights the KB/offering entry matching the currently-selected roof type(s), reachable without leaving the wizard screen. Standalone tabs 03/04 are untouched.

- [ ] **Step 1: Add the drawer markup to `index.html`**

Replace `index.html:114-121` (the whole `#tab-wizard` section) with:

```html
        <section id="tab-wizard" class="tab-content hidden">
          <div class="module-head">
            <span class="module-id">MODULE&nbsp;02</span>
            <span class="module-name">ROOF&nbsp;QUALIFICATION</span>
            <span class="module-stat"><span class="led led-amber"></span>DIAGNOSTIC</span>
          </div>
          <div id="wizard-container"></div>
          <div id="wizard-ref-drawer" class="wizard-ref-drawer collapsed">
            <button class="wref-toggle" data-app-action="toggle-ref-drawer">📚 עיון מהיר</button>
            <div class="wref-body" id="wizard-ref-body"></div>
          </div>
        </section>
```

- [ ] **Step 2: Render contextual entries in `app.js`**

Add near `renderKnowledgeBase`/`renderOfferings` (these already exist — place the new function right after `renderOfferings()`):

```js
function relevantKbEntries(roofTypeIds) {
  if (!window.VOLTA_KB || !roofTypeIds.length) return [];
  return window.VOLTA_KB.filter(e => roofTypeIds.some(id => (e.keywords || '').toLowerCase().includes(id)));
}

// Reuses the existing pure matcher (offerings.js) rather than re-deriving the
// appliesTo/minArea logic here — same function the wizard-result screen already
// calls (app.js renderWizardResult, ~line 657).
function relevantOfferings(roofTypeIds) {
  if (typeof Offerings === 'undefined' || !roofTypeIds.length) return [];
  const total = (Wizard.getState().materialSizes || []).reduce((a, m) => a + (parseInt(m.size) || 0), 0);
  return Offerings.matchForRoof(roofTypeIds, total);
}

function renderReferenceDrawer() {
  const body = document.getElementById('wizard-ref-body');
  if (!body) return;
  const s = Wizard.getState();
  const roofTypeIds = (s.selectedRoofTypes || []).map(t => t.value);
  const kb = relevantKbEntries(roofTypeIds);
  const offers = relevantOfferings(roofTypeIds);
  if (!roofTypeIds.length) {
    body.innerHTML = '<div class="kb-empty">בחר סוג גג כדי לראות הערות ומחירים רלוונטיים כאן.</div>';
    return;
  }
  const kbHtml = kb.length ? kb.map(e => `
    <div class="kb-item ${e.verdict === 'no' ? 'no' : e.verdict === 'yes' ? 'yes' : 'check'}">
      <div class="kb-item-head"><span class="kb-item-name">${escHtml(e.item)}</span></div>
      <div class="kb-note">${escHtml(e.note)}</div>
    </div>`).join('') : '';
  const offersHtml = offers.length ? offers.map(o => `
    <div class="offering-card">
      <div class="offering-head"><span class="offering-name">${escHtml(o.emoji)} ${escHtml(o.name)}</span>
        ${o.price ? `<span class="offering-price">${escHtml(fmtPrice(o.price))}</span>` : ''}</div>
    </div>`).join('') : '';
  body.innerHTML = (kbHtml + offersHtml) || '<div class="kb-empty">אין הערות מיוחדות לסוג הגג שנבחר.</div>';
}

function toggleReferenceDrawer() {
  const d = document.getElementById('wizard-ref-drawer');
  if (d) d.classList.toggle('collapsed');
}
```

Wire the toggle in `initAppDelegates()`'s dispatcher (next to `toggle-sim-dock`):

```js
    } else if (action === 'toggle-ref-drawer') {
      toggleReferenceDrawer();
    } else if (action === 'send-planning-handoff') {
```

Call `renderReferenceDrawer()` from `renderWizard()` (right before its closing brace, so it refreshes on every wizard render — including roof-type toggles):

```js
  setTimeout(() => updateSimDock(q && q.type === 'roof-and-sizes' ? readMaterialSizes() : null), 0);
  renderReferenceDrawer();
}
```

- [ ] **Step 3: Style the drawer**

Append to `styles.css`:

```css
.wizard-ref-drawer { margin-top: 16px; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.wref-toggle { all: unset; cursor: pointer; display: block; width: 100%; box-sizing: border-box; padding: 10px 14px; font-weight: 600; color: var(--cyan-br); }
.wref-body { padding: 0 14px 14px; display: flex; flex-direction: column; gap: 10px; }
.wizard-ref-drawer.collapsed .wref-body { display: none; }
```

- [ ] **Step 4: Manual verification**

Run: `node --check app.js` → no output. No pure-logic unit to test (DOM read of existing modules); verified in Task 9's browser e2e (selecting a roof type surfaces its KB/offering entry in the drawer without leaving the wizard tab).

- [ ] **Step 5: Commit**

```bash
git add app.js index.html styles.css
git commit -m "feat(wizard): contextual KB + offerings drawer inline in the wizard"
```

---

### Task 9: Full verification and deploy

**Files:**
- Use: `tools/verify-clean.sh`, all new/modified test files, a scratchpad headless-Chrome script (same pattern as prior sessions in this project).

- [ ] **Step 1: Run the proprietary-token sweep**

Run: `bash tools/verify-clean.sh` → expected: `PASS: no proprietary tokens in tracked files`.

- [ ] **Step 2: Run the full test suite**

Run: `node --test` → all pass, including `tests/auth.test.js`, `tests/requests.test.js`, `tests/wizard.test.js`, `tests/call-metrics.test.js` alongside the pre-existing suites.

- [ ] **Step 3: Browser e2e (headless Chrome, local serve)**

Serve: `npx http-server . -p 8123 -c-1 --silent` (background). With an injected `volta_agent` session for a real manager (`SL8sEd1xDRq6KJ6vRrpt`, per project convention) and separately for a plain `agent`-role user, verify:
1. Eligibility checklist screen shows all 5 sub-questions with pick buttons; submitting with a disqualifying pick (e.g. ownership = "לא, שכירות") shows the stop screen with the right script; submitting all-good picks advances to the roof-and-sizes screen.
2. Roof-and-sizes screen: toggling a roof type reveals its size input inline; confirming with too small a total shows the stop outcome; a normal case reaches "go"/"go-notes".
3. Elapsed-time chip (`#wizard-elapsed`) ticks up while on a question screen.
4. At the outcome screen: for the manager session, `#se-open-btn` is visible and `#se-handoff-btn` is hidden; for a plain-agent session (no `canDetailedPlan` override), `#se-open-btn` is hidden and `#se-handoff-btn` is visible and clicking it shows the "נשלח ✓" confirmation. Before reaching an outcome (mid-checklist), both buttons are hidden for every role.
5. The reference drawer (`📚 עיון מהיר`) shows relevant KB/offering entries once a roof type is selected, without switching tabs.
6. Manager panel → Audit tab shows the new "⏱ זמן שיחה" stat block with a non-zero count after at least one wizard completion in this session, and the raw event list no longer contains a `wizard.duration` row.

- [ ] **Step 4: Fix anything the e2e surfaces, then re-run Steps 1–3**

- [ ] **Step 5: Deploy**

```bash
git push origin main
```

Poll `https://talsender.github.io/volta-demo/call-metrics.js?nocache=<random>` (or any newly-added file) until HTTP 200, then re-run the Step 3 checks read-only against the live URL (skip the planning-handoff click against the live site to avoid polluting the shared Firestore — verify it only against the local serve in Step 3).
