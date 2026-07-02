// Manager settings panel: edit roofConfig in a working draft, validate, save.
const Settings = (() => {
  let draft = null;
  let onSaved = null;
  let delegatesBound = false;
  const OUTCOMES = [['ok', 'תקין'], ['warn', 'אזהרה'], ['escalate', 'הסלמה'], ['stop', 'עצירה']];
  const ACTIONS = [['', 'ללא'], ['flag', 'דגל'], ['escalate', 'הסלמה'], ['stop', 'עצירה'], ['tiles-age', 'שאלת גיל']];
  const GEOMS = [['flat', 'שטוח'], ['pitched', 'משופע (רעפים)'], ['pergola', 'פרגולה'], ['insulated', 'מבודד'], ['corrugated', 'איסכורית'], ['light', 'בנייה קלה']];
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function host() { return document.getElementById('settings-modal'); }

  function onKey(e) { if (e.key === 'Escape') close(); }

  function open() {
    draft = (typeof RoofStore !== 'undefined') ? RoofStore.get() : null;
    if (!draft) return;
    bindDelegates();
    document.addEventListener('keydown', onKey);
    render();
  }
  function close() {
    const h = host();
    if (h) { h.classList.remove('on'); h.setAttribute('aria-hidden', 'true'); h.innerHTML = ''; }
    document.removeEventListener('keydown', onKey);
  }

  function sel(options, val) {
    return options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(val == null ? '' : val) ? ' selected' : ''}>${esc(l)}</option>`).join('');
  }

  function render() {
    const h = host(); if (!h) return;
    const th = draft.totalSizeThresholds || {};
    const mats = draft.materials.map((m, i) => materialCard(m, i)).join('');
    h.innerHTML = `
      <div class="settings-backdrop" data-settings-action="close"></div>
      <div class="settings-panel" role="dialog" aria-label="הגדרות מנהל">
        <div class="settings-head">
          <span class="settings-title">⚙ הגדרות מנהל · כשירות גג</span>
          <button class="settings-x" data-settings-action="close">✕</button>
        </div>
        <div class="settings-body">
          <div id="settings-errors" class="settings-errors"></div>
          <div class="set-grid">
            <label class="set-field"><span>סף שטח "טוב" (מ"ר)</span>
              <input type="number" min="1" value="${esc(th.good)}" data-settings-input="num" data-key="good"></label>
            <label class="set-field"><span>סף שטח "גבולי" (מ"ר)</span>
              <input type="number" min="1" value="${esc(th.borderline)}" data-settings-input="num" data-key="borderline"></label>
            <label class="set-field"><span>גיל גג מקסימלי (שנים)</span>
              <input type="number" min="1" value="${esc(draft.tilesAgeWarning)}" data-settings-input="num" data-key="tilesAge"></label>
            <label class="set-field"><span>סיסמת אתחול מנהל ראשון</span>
              <input type="text" value="${esc(draft.managerPassword)}" data-settings-input="pass"></label>
          </div>
          <div class="set-section-title">חומרי גג</div>
          <div id="set-materials">${mats}</div>
          <button class="btn secondary" data-settings-action="add-material">➕ הוסף חומר</button>
        </div>
        <div class="settings-foot">
          <button class="btn primary" data-settings-action="save">💾 שמור</button>
          <button class="btn reset" data-settings-action="reset-defaults">↺ אפס לברירת מחדל</button>
          <button class="btn secondary" data-settings-action="close">ביטול</button>
        </div>
      </div>`;
    h.classList.add('on');
    h.setAttribute('aria-hidden', 'false');
  }

  function materialCard(m, i) {
    const msg = m.messages || {};
    const showFlag = m.baseAction === 'flag', showEsc = m.baseAction === 'escalate', showStop = m.baseAction === 'stop';
    const rules = (m.sizeRules || []).map((r, j) => `
      <div class="rule-row">
        <input type="number" placeholder="עד (∞=ריק)" value="${r.upTo == null ? '' : esc(r.upTo)}" data-settings-input="rule" data-index="${i}" data-rule="${j}" data-key="upTo">
        <select data-settings-input="rule" data-index="${i}" data-rule="${j}" data-key="outcome">${sel(OUTCOMES, r.outcome)}</select>
        <input type="text" placeholder="הודעה" value="${esc(r.message)}" data-settings-input="rule" data-index="${i}" data-rule="${j}" data-key="message">
        <button class="rule-x" data-settings-action="del-rule" data-index="${i}" data-rule="${j}">✕</button>
      </div>`).join('');
    return `
      <div class="mat-card">
        <div class="mat-head">
          <input class="mat-emoji" type="text" value="${esc(m.emoji)}" data-settings-input="mat" data-index="${i}" data-key="emoji">
          <input class="mat-label" type="text" value="${esc(m.label)}" data-settings-input="mat" data-index="${i}" data-key="label">
          <input class="mat-id" type="text" value="${esc(m.id)}" data-settings-input="mat" data-index="${i}" data-key="id" title="מזהה ייחודי">
          <button class="mat-del" data-settings-action="del-material" data-index="${i}">🗑</button>
        </div>
        <div class="mat-row">
          <label>פעולת בסיס
            <select data-settings-input="mat" data-index="${i}" data-key="baseAction">${sel(ACTIONS, m.baseAction || '')}</select>
          </label>
          <label>גאומטריה (לסימולציה)
            <select data-settings-input="mat" data-index="${i}" data-key="geometry">${sel(GEOMS, m.geometry || 'flat')}</select>
          </label>
        </div>
        ${showFlag ? `<label class="mat-msg">הודעת דגל<input type="text" value="${esc(msg.flagMsg)}" data-settings-input="msg" data-index="${i}" data-key="flagMsg"></label>` : ''}
        ${showEsc ? `<label class="mat-msg">הערת הסלמה<input type="text" value="${esc(msg.escalateNote)}" data-settings-input="msg" data-index="${i}" data-key="escalateNote"></label>` : ''}
        ${showStop ? `<label class="mat-msg">סיבת עצירה<input type="text" value="${esc(msg.stopReason)}" data-settings-input="msg" data-index="${i}" data-key="stopReason"></label>
          <label class="mat-msg">נוסח לנציג<input type="text" value="${esc(msg.stopScript)}" data-settings-input="msg" data-index="${i}" data-key="stopScript"></label>` : ''}
        <div class="rules-title">כללי שטח <button class="rule-add" data-settings-action="add-rule" data-index="${i}">+ כלל</button></div>
        ${rules}
      </div>`;
  }

  function bindDelegates() {
    const h = host();
    if (!h || delegatesBound) return;
    h.addEventListener('click', handleClick);
    h.addEventListener('input', handleInput);
    h.addEventListener('change', handleInput);
    delegatesBound = true;
  }

  function handleClick(e) {
    const btn = e.target.closest('[data-settings-action]');
    if (!btn) return;
    const action = btn.dataset.settingsAction;
    const i = parseInt(btn.dataset.index);
    const j = parseInt(btn.dataset.rule);
    if (action === 'close') close();
    else if (action === 'add-material') addMaterial();
    else if (action === 'save') save();
    else if (action === 'reset-defaults') resetDefaults();
    else if (action === 'del-material') delMaterial(i);
    else if (action === 'add-rule') addRule(i);
    else if (action === 'del-rule') delRule(i, j);
  }

  function handleInput(e) {
    const el = e.target;
    if (!el || !el.dataset || !el.dataset.settingsInput) return;
    const type = el.dataset.settingsInput;
    const i = parseInt(el.dataset.index);
    const j = parseInt(el.dataset.rule);
    const key = el.dataset.key;
    if (type === 'num') setNum(key, el.value);
    else if (type === 'pass') setPass(el.value);
    else if (type === 'mat') setMat(i, key, el.value);
    else if (type === 'msg') setMsg(i, key, el.value);
    else if (type === 'rule') setRule(i, j, key, el.value);
  }

  // ---- draft mutations ----
  function setNum(k, v) { const n = parseInt(v) || 0; if (k === 'tilesAge') draft.tilesAgeWarning = n; else draft.totalSizeThresholds[k] = n; }
  function setPass(v) { draft.managerPassword = v; }
  function setMat(i, k, v) { draft.materials[i][k] = (k === 'baseAction' && v === '') ? null : v; if (k === 'baseAction') render(); }
  function setMsg(i, k, v) { draft.materials[i].messages = draft.materials[i].messages || {}; draft.materials[i].messages[k] = v; }
  function setRule(i, j, k, v) {
    const r = draft.materials[i].sizeRules[j];
    if (k === 'upTo') r.upTo = (v === '' ? null : (parseInt(v) || 0));
    else r[k] = v;
  }
  function addRule(i) { (draft.materials[i].sizeRules = draft.materials[i].sizeRules || []).push({ upTo: null, outcome: 'ok', message: '' }); render(); }
  function delRule(i, j) { draft.materials[i].sizeRules.splice(j, 1); render(); }
  function addMaterial() {
    const ids = new Set(draft.materials.map(m => m.id));
    let n = draft.materials.length + 1;
    while (ids.has('mat' + n)) n++;
    draft.materials.push({ id: 'mat' + n, label: 'חומר חדש', emoji: '🏠', baseFlagClass: 'ok', baseAction: null, geometry: 'flat', messages: { flagMsg: '', escalateNote: '', stopReason: '', stopScript: '' }, sizeRules: [{ upTo: null, outcome: 'ok', message: '' }] });
    render();
  }
  function delMaterial(i) { draft.materials.splice(i, 1); render(); }

  function showErrors(errs) {
    const e = document.getElementById('settings-errors');
    if (!e) return;
    e.innerHTML = errs.map(x => `<div>⚠ ${esc(x)}</div>`).join('');
    e.classList.toggle('on', errs.length > 0);
  }

  async function save() {
    const v = RoofStore.validate(draft);
    if (!v.ok) { showErrors(v.errors); return; }
    const res = RoofStore.saveAsync ? await RoofStore.saveAsync(draft) : RoofStore.save(draft);
    if (!res.ok) { showErrors(res.errors); return; }
    if (typeof VoltaDB !== 'undefined' && VoltaDB.ready && VoltaDB.ready() && VoltaDB.addAuditEvent && typeof Auth !== 'undefined') {
      const actor = Auth.getCurrentAgent && Auth.getCurrentAgent();
      if (actor && typeof Audit !== 'undefined') {
        let event = null;
        try {
          event = Audit.buildEvent(actor, 'roofConfig.update', 'roofConfig', 'default', {
            materials: (draft.materials || []).length,
            good: draft.totalSizeThresholds && draft.totalSizeThresholds.good,
            borderline: draft.totalSizeThresholds && draft.totalSizeThresholds.borderline,
          });
        } catch (e) {
          console.warn('audit event skipped:', e);
        }
        if (event) VoltaDB.addAuditEvent(event).catch(e => console.warn('audit log failed:', e));
      }
    }
    close();
    if (typeof onSaved === 'function') onSaved();
  }
  function resetDefaults() { draft = RoofStore.reset(); render(); }

  function setOnSaved(fn) { onSaved = fn; }

  return { open, close, setNum, setPass, setMat, setMsg, setRule, addRule, delRule, addMaterial, delMaterial, save, resetDefaults, setOnSaved };
})();
if (typeof window !== 'undefined') window.Settings = Settings;
