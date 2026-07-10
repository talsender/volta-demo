function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================
// TAB SWITCHING
// ============================================================
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = 'tab-' + tab.dataset.tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => {
        c.classList.add('hidden');
        c.classList.remove('active');
      });
      tab.classList.add('active');
      const target = document.getElementById(targetId);
      target.classList.remove('hidden');
      target.classList.add('active');
    });
  });
}

// ============================================================
// SETTLEMENT TAB
// ============================================================
let _suggestionCache = [];
let _currentSettlement = null;

function renderSuggestions(results) {
  const el = document.getElementById('suggestions');
  if (!results.length) { el.classList.add('hidden'); _suggestionCache = []; return; }
  _suggestionCache = results;
  const cls_fn = Settlements.statusClass;
  const badges = { yes: '✅ מתקינים', no: '❌ לא מתקינים', check: '⚠️ לבדוק', unknown: '❓ לא זוהה' };
  el.innerHTML = results.map((s, i) => {
    const cls = cls_fn(s.status);
    return `<div class="suggestion-item" data-app-action="select-settlement" data-index="${i}">
      <div>
        <div class="sug-name">${escHtml(s.name)}</div>
        ${s.type ? `<div class="sug-type">${escHtml(s.type)}</div>` : ''}
      </div>
      <span class="sug-badge ${cls}">${badges[cls]}</span>
    </div>`;
  }).join('');
  el.classList.remove('hidden');
}

function renderSettlementResult(settlement) {
  const r = Settlements.getResult(settlement);
  _currentSettlement = settlement;
  document.getElementById('suggestions').classList.add('hidden');
  if (window.VoltaGlobe) window.VoltaGlobe.lockTarget(settlement.name, r.cls);
  let installBadge = '';
  if (r.installCount > 0) {
    const lastTxt = r.lastInstall ? ` · אחרונה: ${escHtml(r.lastInstall)}` : '';
    installBadge = `<div class="install-badge">📍 ${r.installCount} פרויקטים הושלמו אצלנו ביישוב זה${lastTxt}</div>`;
  }
  document.getElementById('settlement-result').innerHTML = `
    <div class="result-card ${r.cls}">
      <div class="result-icon">${r.icon}</div>
      <div>
        <div class="result-settlement">${escHtml(r.settlement)}</div>
        <div class="result-title">${escHtml(r.title)}</div>
        ${installBadge}
        ${r.note ? `<div class="result-note">${escHtml(r.note)}</div>` : ''}
        ${r.showWizardBtn ? `<button class="result-action-btn" data-app-action="switch-to-wizard">המשך לבדיקת כשירות גג ←</button>` : ''}
        <button class="result-action-btn ghost" data-app-action="open-settlement-request">🚩 בקש חריגה ממנהל</button>
      </div>
    </div>`;
}

function selectSettlement(settlement) {
  document.getElementById('settlement-input').value = settlement.name;
  renderSettlementResult(settlement);
}

function switchToWizard() {
  document.querySelector('.tab[data-tab="wizard"]').click();
}

function initSettlementTab() {
  const input = document.getElementById('settlement-input');
  let debounceTimer;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    document.getElementById('settlement-result').innerHTML = '';
    if (window.VoltaGlobe) window.VoltaGlobe.release();
    debounceTimer = setTimeout(() => {
      const results = Settlements.search(input.value);
      renderSuggestions(results);
    }, 150);
  });
  // Hide suggestions when clicking outside
  document.addEventListener('click', e => {
    if (!e.target.closest('#tab-settlement')) {
      document.getElementById('suggestions').classList.add('hidden');
    }
  });
}

function initAppDelegates() {
  document.addEventListener('click', e => {
    const actionEl = e.target.closest('[data-app-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.appAction;
    if (action === 'select-settlement') {
      const settlement = _suggestionCache[parseInt(actionEl.dataset.index, 10)];
      if (settlement) selectSettlement(settlement);
    } else if (action === 'switch-to-wizard') {
      switchToWizard();
    } else if (action === 'open-settlement-request') {
      openSettlementRequest();
    } else if (action === 'reset-wizard') {
      resetWizard();
    } else if (action === 'wizard-back') {
      wizardBack();
    } else if (action === 'wizard-answer') {
      wizardAnswer(parseInt(actionEl.dataset.optionIndex, 10));
    } else if (action === 'wizard-toggle-roof') {
      wizardToggleRoof(parseInt(actionEl.dataset.optionIndex, 10));
    } else if (action === 'wizard-confirm-roofs') {
      wizardConfirmRoofs();
    } else if (action === 'wizard-toggle-obstacle') {
      wizardToggleObstacle(parseInt(actionEl.dataset.optionIndex, 10));
    } else if (action === 'wizard-confirm-obstacles') {
      wizardConfirmObstacles();
    } else if (action === 'compass-set') {
      compassSet(parseInt(actionEl.dataset.deg, 10));
    } else if (action === 'wizard-orientation-confirm') {
      wizardOrientationConfirm();
    } else if (action === 'material-sizes-confirm') {
      materialSizesConfirm();
    } else if (action === 'open-roof-request') {
      openRoofRequest();
    } else if (action === 'dock-compass-set') {
      dockCompassSet(parseInt(actionEl.dataset.deg, 10));
    } else if (action === 'toggle-compass-dock') {
      toggleCompassDock();
    } else if (action === 'recenter-sim') {
      recenterSim();
    } else if (action === 'toggle-sim-dock') {
      toggleSimDock();
    }
  });

  document.addEventListener('input', e => {
    const inputEl = e.target.closest('[data-app-input]');
    if (!inputEl) return;
    if (inputEl.dataset.appInput === 'material-size') updateMaterialSizes();
  });
}

// ============================================================
// WIZARD RENDERING
// ============================================================
function renderWizard() {
  const container = document.getElementById('wizard-container');
  const s = Wizard.getState();
  const q = Wizard.currentQuestion();

  if (s.outcome) {
    container.innerHTML = renderWizardResult();
    if (window.VoltaGlobe && (s.outcome === 'go' || s.outcome === 'go-notes')) {
      window.VoltaGlobe.deploy();
    }
    setTimeout(() => updateSimDock(), 0); // dock reflects the final house
    return;
  }

  const flow = Wizard.currentFlow();
  const total = flow.length;
  const current = s.step + 1;
  const pct = Math.round((s.step / total) * 100);
  const pctClass = Math.max(0, Math.min(100, Math.round(pct / 5) * 5));

  let html = `
    <div class="progress-area">
      <div class="progress-label"><span>שאלה ${current} מתוך ${total}</span><span>${pct}%</span></div>
      <div class="progress-bar"><div class="progress-fill progress-${pctClass}"></div></div>
    </div>`;

  // Previous answers
  if (s.answers.length > 0) {
    html += '<div class="prev-answers">';
    s.answers.forEach(a => {
      const cls = a.flagClass === 'warn' ? ' warn' : '';
      html += `<div class="prev-row"><span class="prev-q">${escHtml(labelForId(a.questionId))}</span><span class="prev-a${cls}">${escHtml(a.label)}</span></div>`;
    });
    html += '</div>';
  }

  // Current question
  html += `<div class="question-card">
    <div class="q-step">שאלה ${current} מתוך ${total}</div>
    <div class="q-text">${escHtml(q.text)}</div>
    ${q.hint ? `<div class="q-hint">${escHtml(q.hint)}</div>` : ''}
    ${renderQuestionInput(q)}
  </div>`;

  html += `<div class="btn-row">
    ${Wizard.canBack() ? '<button class="btn secondary" data-app-action="wizard-back">→ חזור שלב</button>' : ''}
    <button class="btn reset" data-app-action="reset-wizard">🔄 התחל מחדש</button>
  </div>`;

  container.innerHTML = html;
  if (q && q.type === 'compass') {
    setTimeout(() => initRoofCompass(180), 0);
  }
  if (q && q.type === 'material-sizes') {
    setTimeout(() => updateMaterialSizes(), 0);
  }
  setTimeout(() => updateSimDock(q && q.type === 'material-sizes' ? readMaterialSizes() : null), 0);
}

// ============================================================
// HOUSE SIM — persistent interactive 3D dock (bottom-right)
// ============================================================
let _dockSim = null;

function initSimDock() {
  const canvas = document.getElementById('sim-dock-canvas');
  const msg = document.getElementById('sim-dock-msg');
  if (!canvas) return;
  if (!window.VoltaSim || !VoltaSim.available()) {
    if (msg) { msg.innerHTML = '⚠ טעינת מנוע התלת-ממד (Three.js) נכשלה.<br>דרוש חיבור אינטרנט — רענן את הדף.'; msg.classList.add('on'); }
    canvas.classList.add('hidden');
    return;
  }
  _dockSim = VoltaSim.mount(canvas, { interactive: true });
  updateSimDock();
}

function updateSimDock(liveSizes, liveAz) {
  if (!_dockSim) return;
  const inputs = Wizard.getSimInputs(liveSizes, liveAz);
  const cfg = (typeof RoofStore !== 'undefined') ? RoofStore.get() : { materials: [] };
  // getSimInputs returns raw inputs; buildSimState turns them into the render-ready
  // state (house/parts/sun/obstacles) that VoltaSim.update expects.
  _dockSim.update(buildSimState(inputs, cfg));
}

function recenterSim() { if (_dockSim) _dockSim.recenter(); }

function toggleSimDock() {
  const d = document.getElementById('sim-dock');
  if (!d) return;
  const collapsed = d.classList.toggle('collapsed');
  const t = document.getElementById('sim-dock-toggle');
  if (t) t.textContent = collapsed ? '▴' : '▾';
  if (_dockSim) {
    _dockSim.setActive(!collapsed);
    if (!collapsed) setTimeout(() => _dockSim.resize(), 30);
  }
}

// ============================================================
// ROOF ORIENTATION COMPASS
// ============================================================
let _roofCompass = null;

function initRoofCompass(initialAz) {
  const canvas = document.getElementById('roof-compass');
  if (!canvas || !window.RoofCompass) return;
  _roofCompass = window.RoofCompass.mount(canvas, initialAz, updateCompassReadout);
  highlightDirBtn(initialAz);
}

function compassSet(deg) {
  if (_roofCompass) _roofCompass.set(deg);
  highlightDirBtn(deg);
}

function highlightDirBtn(deg) {
  const d = ((Math.round(deg / 45) * 45) % 360 + 360) % 360;
  document.querySelectorAll('.dir-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.deg) === d);
  });
}

function updateCompassReadout(a) {
  const dir = document.getElementById('compass-dir');
  const yld = document.getElementById('compass-yield');
  const ql = document.getElementById('compass-quality');
  const v = document.getElementById('compass-verdict');
  if (dir) dir.textContent = a.dir;
  if (yld) yld.textContent = '~' + a.yield + '%';
  if (ql) { ql.textContent = a.quality; ql.className = 'cr-v ' + (a.flagClass === 'ok' ? 'good' : 'warn'); }
  if (v) {
    v.className = 'compass-verdict ' + (a.flagClass === 'ok' ? 'ok' : 'warn');
    v.textContent = a.flag
      ? a.flag
      : '☀ ' + a.dir + ' · תפוקה ~' + a.yield + '% — תנוחה ' + a.quality + ' לייצור סולארי';
  }
  highlightDirBtn(a.az);
  updateSimDock(null, a.az); // live: rotate the house/sun as the compass turns
}

function wizardOrientationConfirm() {
  const az = _roofCompass ? _roofCompass.get() : 180;
  Wizard.answer({}, az);
  renderWizard();
}

// ============================================================
// PERSISTENT COMPASS DOCK (always-visible, independent instance)
// ============================================================
let _dockCompass = null;

function initDockCompass() {
  const canvas = document.getElementById('dock-compass');
  if (!canvas || !window.RoofCompass) return;
  _dockCompass = window.RoofCompass.mount(canvas, 180, updateDockReadout);
  highlightDockDirBtn(180);
}

function dockCompassSet(deg) {
  if (_dockCompass) _dockCompass.set(deg);
  highlightDockDirBtn(deg);
}

function highlightDockDirBtn(deg) {
  const d = ((Math.round(deg / 45) * 45) % 360 + 360) % 360;
  document.querySelectorAll('.dock-dir-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.deg) === d);
  });
}

function updateDockReadout(a) {
  const v = document.getElementById('dock-verdict');
  if (v) {
    v.className = 'dock-verdict ' + (a.flagClass === 'ok' ? 'ok' : 'warn');
    v.textContent = a.flag
      ? a.flag
      : '☀ ' + a.dir + ' · תפוקה ~' + a.yield + '% · ' + a.quality;
  }
  highlightDockDirBtn(a.az);
}

function toggleCompassDock() {
  const dock = document.getElementById('compass-dock');
  const btn = document.getElementById('dock-toggle');
  if (!dock) return;
  const collapsed = dock.classList.toggle('collapsed');
  if (btn) btn.textContent = collapsed ? '▴' : '▾';
}

function labelForId(id) {
  const labels = {
    'property-type': 'סוג נכס', 'ownership': 'בעלות', 'permit': 'טופס 4',
    'connection': 'חיבור חשמל', 'meter': 'מונה חשמל', 'roof-type': 'סוג גג',
    'tiles-age': 'גיל גג רעפים', 'material-sizes': 'שטחי גג', 'roof-orientation': 'כיוון גג', 'shading': 'הצללות',
  };
  return labels[id] || id;
}

function renderQuestionInput(q) {
  if (q.type === 'buttons') {
    return '<div class="answer-row">' +
      q.options.map((opt, i) =>
        `<button class="answer-btn" data-app-action="wizard-answer" data-option-index="${i}">${escHtml(opt.label)}</button>`
      ).join('') +
      '</div>';
  }
  if (q.type === 'roof-grid') {
    return '<div class="roof-grid">' +
      q.options.map((opt, i) =>
        `<button class="roof-btn ${opt.flagClass}" data-app-action="wizard-answer" data-option-index="${i}">${escHtml(opt.label)}</button>`
      ).join('') +
      '</div>';
  }
  if (q.type === 'roof-grid-multi') {
    const selected = Wizard.getState().selectedRoofTypes;
    const btns = q.options.map((opt, i) => {
      const isSel = selected.some(t => t.value === opt.value);
      return `<button class="roof-btn ${opt.flagClass}${isSel ? ' selected' : ''}" data-app-action="wizard-toggle-roof" data-option-index="${i}">${escHtml(opt.label)}</button>`;
    }).join('');
    return `<div class="roof-grid">${btns}</div>
      <div class="btn-row mt-14">
        <button class="btn primary" data-app-action="wizard-confirm-roofs">אשר בחירת גג</button>
      </div>
      <div id="roof-multi-error" class="roof-multi-error"></div>`;
  }
  if (q.type === 'obstacle-multi') {
    const selected = Wizard.getState().selectedObstacles;
    const btns = q.options.map((opt, i) => {
      const isSel = selected.indexOf(opt.value) !== -1;
      return `<button class="roof-btn${isSel ? ' selected' : ''}" data-app-action="wizard-toggle-obstacle" data-option-index="${i}">${escHtml(opt.label)}</button>`;
    }).join('');
    return `<div class="roof-grid">${btns}</div>
      <div class="btn-row mt-14">
        <button class="btn primary" data-app-action="wizard-confirm-obstacles">אשר הצללות ←</button>
      </div>`;
  }
  if (q.type === 'compass') {
    const dirs = [['צפון',0],['צ-מז',45],['מזרח',90],['ד-מז',135],['דרום',180],['ד-מע',225],['מערב',270],['צ-מע',315]];
    return `
      <div class="compass-wrap">
        <canvas id="roof-compass" class="compass-canvas" width="300" height="300"></canvas>
        <div class="compass-hint-tag">גרור את המחוג · או בחר כיוון</div>
      </div>
      <div class="compass-dirs">
        ${dirs.map(([l,d]) => `<button class="dir-btn" data-app-action="compass-set" data-deg="${d}">${l}</button>`).join('')}
      </div>
      <div class="compass-readout">
        <div class="cr-item"><span class="cr-k">כיוון</span><span class="cr-v" id="compass-dir">—</span></div>
        <div class="cr-item"><span class="cr-k">תפוקה משוערת</span><span class="cr-v" id="compass-yield">—</span></div>
        <div class="cr-item"><span class="cr-k">דירוג</span><span class="cr-v" id="compass-quality">—</span></div>
      </div>
      <div class="compass-verdict ok" id="compass-verdict"></div>
      <div class="btn-row mt-14">
        <button class="btn primary" data-app-action="wizard-orientation-confirm">אשר כיוון גג ←</button>
      </div>`;
  }
  if (q.type === 'material-sizes') {
    const mats = Wizard.selectedMaterials();
    const rows = mats.map((m, i) => `
      <div class="msize-row">
        <span class="msize-label">${escHtml(m.emoji)} ${escHtml(m.label)}</span>
        <input type="number" min="0" max="1000" value="40" inputmode="numeric"
          class="msize-input" id="msize-${i}" data-id="${escHtml(m.id)}"
          data-app-input="material-size">
        <span class="msize-unit">מ"ר</span>
      </div>`).join('');
    return `
      <div class="msize-list">${rows}</div>
      <div class="msize-total" id="msize-total">סה"כ: 0 מ"ר</div>
      <div class="msize-verdict ok" id="msize-verdict"></div>
      <div class="btn-row mt-14">
        <button class="btn primary" data-app-action="material-sizes-confirm">אשר שטחי גג ←</button>
      </div>`;
  }
  return '';
}

function wizardAnswer(optionIndex) {
  const q = Wizard.currentQuestion();
  const opt = q.options[optionIndex];
  Wizard.answer(opt);
  renderWizard();
}

// ---- Per-material sizes ----
function readMaterialSizes() {
  return Array.from(document.querySelectorAll('.msize-input')).map(el => ({
    materialId: el.dataset.id,
    size: parseInt(el.value) || 0,
  }));
}

function updateMaterialSizes() {
  const sizes = readMaterialSizes();
  const sum = sizes.reduce((a, s) => a + s.size, 0);
  const totalEl = document.getElementById('msize-total');
  if (totalEl) totalEl.textContent = `סה"כ: ${sum} מ"ר`;
  const v = document.getElementById('msize-verdict');
  if (!v) return;
  // Read the same thresholds evaluateRoof uses, so the live preview matches the
  // authoritative result (and stays correct when roofConfig is manager-edited).
  const th = (typeof DEFAULT_ROOF_CONFIG !== 'undefined' && DEFAULT_ROOF_CONFIG.totalSizeThresholds)
    ? DEFAULT_ROOF_CONFIG.totalSizeThresholds
    : { good: CONFIG.ROOF_SIZE_GOOD, borderline: CONFIG.ROOF_SIZE_BORDERLINE };
  const good = th.good, border = th.borderline;
  if (sum >= good) { v.className = 'msize-verdict ok'; v.textContent = `✅ ${sum} מ"ר — שטח מתאים`; }
  else if (sum >= border) { v.className = 'msize-verdict warn'; v.textContent = `⚠️ ${sum} מ"ר — גבולי, המומחה יאשר`; }
  else { v.className = 'msize-verdict bad'; v.textContent = `❌ ${sum} מ"ר — קטן מדי (מינימום ${border} מ"ר)`; }
  updateSimDock(readMaterialSizes());
}

function materialSizesConfirm() {
  Wizard.answerMaterialSizes(readMaterialSizes());
  renderWizard();
}

function wizardToggleObstacle(i) {
  Wizard.toggleObstacle(i);
  renderWizard(); // re-render updates the live sim dock with the new obstacle set
}
function wizardConfirmObstacles() {
  Wizard.confirmObstacles();
  renderWizard();
}
function wizardToggleRoof(i) {
  Wizard.toggleRoofType(i);
  renderWizard();
}

function wizardConfirmRoofs() {
  const result = Wizard.confirmRoofTypes();
  if (!result.done && result.error) {
    const errEl = document.getElementById('roof-multi-error');
    if (errEl) errEl.textContent = result.error;
    return;
  }
  renderWizard();
}

function resetWizard() {
  Wizard.reset();
  renderWizard();
}

function wizardBack() {
  if (Wizard.back()) renderWizard();
}

function renderWizardResult() {
  const s = Wizard.getState();

  // Answers recap
  const recap = s.answers.map(a => {
    const cls = a.flagClass === 'warn' ? ' warn' : '';
    return `<div class="recap-row"><span class="recap-q">${escHtml(labelForId(a.questionId))}</span><span class="recap-v${cls}">${escHtml(a.label)}</span></div>`;
  }).join('');

  // Accumulated warn-notes (meter inside, borderline size, orientation, tiles age…).
  // Shown on EVERY outcome — they don't vanish just because a roof type also
  // triggered an escalate/stop, and the manager needs them for an exception request.
  const flagsHtml = (s.flags && s.flags.length)
    ? s.flags.map(f => `<div class="flag-box"><span class="flag-icon">📌</span><span>${escHtml(f)}</span></div>`).join('')
    : '';

  // Commercial offerings — only meaningful when the customer is qualifiable.
  let offeringsHtml = '';
  if ((s.outcome === 'go' || s.outcome === 'go-notes') && typeof Offerings !== 'undefined') {
    const ids = (s.selectedRoofTypes || []).map(t => t.value);
    const total = (s.materialSizes || []).reduce((a, m) => a + (parseInt(m.size) || 0), 0);
    const matches = Offerings.matchForRoof(ids, total);
    if (matches.length) {
      offeringsHtml = `<div class="wr-offerings">
        <div class="wr-offerings-title">💰 מסלולים רלוונטיים ללקוח</div>
        ${matches.map(o => `
          <div class="offering-card${o.eligible ? '' : ' dim'}">
            <div class="offering-head">
              <span class="offering-name">${escHtml(o.emoji)} ${escHtml(o.name)}</span>
              ${o.price ? `<span class="offering-price">${escHtml(fmtPrice(o.price))}</span>` : ''}
            </div>
            <div class="offering-meta">
              ${o.roi ? `<span class="offering-chip">החזר ${escHtml(o.roi)}</span>` : ''}
              ${o.financing === 'leasing' ? `<span class="offering-chip">ליסינג</span>` : ''}
              ${o.eligible ? '' : `<span class="offering-chip warn">${escHtml(o.reason)}</span>`}
            </div>
            <ul class="offering-highlights">${o.highlights.map(h => `<li>${escHtml(h)}</li>`).join('')}</ul>
          </div>`).join('')}
      </div>`;
    }
  }

  if (s.outcome === 'go') {
    return `<div class="wizard-result go">
      <div class="wr-header"><div class="wr-icon">✅</div><div class="wr-title">ניתן לתאם שיחת מומחה</div></div>
      <div class="answers-recap">${recap}</div>
      ${offeringsHtml}
      <div class="btn-row">
        <button class="btn primary">📅 תאם שיחת מומחה</button>
        <button class="btn secondary" data-app-action="wizard-back">→ חזור שלב</button>
        <button class="btn reset" data-app-action="reset-wizard">🔄 בדיקה חדשה</button>
      </div>
    </div>`;
  }

  if (s.outcome === 'go-notes') {
    return `<div class="wizard-result go-notes">
      <div class="wr-header"><div class="wr-icon">⚠️</div><div class="wr-title">ניתן לקדם — שים לב להערות</div></div>
      <div class="answers-recap">${recap}</div>
      ${flagsHtml}
      ${offeringsHtml}
      <div class="btn-row">
        <button class="btn primary">📅 תאם שיחת מומחה</button>
        <button class="btn secondary" data-app-action="wizard-back">→ חזור שלב</button>
        <button class="btn reset" data-app-action="reset-wizard">🔄 בדיקה חדשה</button>
      </div>
    </div>`;
  }

  if (s.outcome === 'follow-up') {
    const note = s.followUpNote || 'נדרשת פעולה נוספת לפני תיאום שיחת מומחה.';
    return `<div class="wizard-result follow-up">
      <div class="wr-header"><div class="wr-icon">📋</div><div class="wr-title">לא ניתן לתאם כעת — שתי אפשרויות</div></div>
      <div class="action-box"><div class="action-text">${escHtml(note)}</div></div>
      <div class="action-box"><div class="action-title">אפשרות א׳ — פולואפ עתידי</div>
        <div class="action-text">לקבוע עם הלקוח מתי צפוי לסדר את הנושא, ולתזמן פולואפ.</div></div>
      <div class="action-box"><div class="action-title">אפשרות ב׳ — העברה ל-VSD</div>
        <div class="action-text">אם הלקוח מעוניין בתכנון ראשוני כבר עכשיו — להעביר לשיחת VSD.</div></div>
      ${flagsHtml}
      <div class="btn-row">
        <button class="btn secondary">📅 קבע פולואפ לתאריך</button>
        <button class="btn vsd">↗ העבר ל-VSD</button>
        <button class="btn ghost" data-app-action="open-roof-request">🚩 בקש חריגה ממנהל</button>
        <button class="btn secondary" data-app-action="wizard-back">→ חזור שלב</button>
        <button class="btn reset" data-app-action="reset-wizard">🔄 בדיקה חדשה</button>
      </div>
    </div>`;
  }

  if (s.outcome === 'escalate') {
    return `<div class="wizard-result escalate">
      <div class="wr-header"><div class="wr-icon">🔼</div><div class="wr-title">יש להעלות למנהל לפני קידום</div></div>
      <div class="answers-recap">${recap}</div>
      <div class="action-box"><div class="action-title">סיבה</div>
        <div class="action-text">${escHtml(s.escalateNote || '')}</div></div>
      ${flagsHtml}
      <div class="btn-row">
        <button class="btn ghost" data-app-action="open-roof-request">🚩 בקש חריגה ממנהל</button>
        <button class="btn secondary" data-app-action="wizard-back">→ חזור שלב</button>
        <button class="btn reset" data-app-action="reset-wizard">🔄 בדיקה חדשה</button>
      </div>
    </div>`;
  }

  // stop
  return `<div class="wizard-result stop">
    <div class="wr-header"><div class="wr-icon">❌</div><div class="wr-title">לא ניתן להתקין</div></div>
    <div class="answers-recap">${recap}</div>
    <div class="action-box">
      <div class="action-title">🔴 הסיבה</div>
      <div class="action-text">${escHtml(s.stopReason)}</div>
    </div>
    ${s.stopScript ? `<div class="flag-box"><span class="flag-icon">💬</span><span>נוסח לנציג: <em>"${escHtml(s.stopScript)}"</em></span></div>` : ''}
    ${flagsHtml}
    <div class="btn-row">
      <button class="btn ghost" data-app-action="open-roof-request">🚩 בקש חריגה ממנהל</button>
      <button class="btn secondary" data-app-action="wizard-back">→ חזור שלב</button>
        <button class="btn reset" data-app-action="reset-wizard">🔄 בדיקה חדשה</button>
    </div>
  </div>`;
}

// Double-click the logo → password → manager settings panel.
// Roof-settings entry is now unified into the manager panel (admin.js); this
// standalone dbl-click entry was removed to avoid a duplicate manager gesture.

function initWizard() {
  Wizard.reset();
  renderWizard();
}

let _dataLayerInitialized = false;
function initDataLayerWhenReady() {
  if (_dataLayerInitialized || !window.firebase) return false;
  _dataLayerInitialized = true;
  VoltaDB.init();
  if (window.RoofStore && RoofStore.initRemote) {
    RoofStore.initRemote(() => {
      if (typeof initWizard === 'function') initWizard();
      if (typeof updateSimDock === 'function') updateSimDock();
    });
  }
  startAgentAuthSession();
  return true;
}

// ============================================================
// AGENT LOGIN / GATING
// ============================================================
let _agents = [];

function authMode() {
  return (typeof CONFIG !== 'undefined' && CONFIG.AUTH_MODE === 'firebase') ? 'firebase' : 'legacy';
}

function showLoginGate() {
  document.getElementById('login-gate').classList.remove('hidden');
  document.getElementById('app').classList.add('gated');
}
function hideLoginGate() {
  document.getElementById('login-gate').classList.add('hidden');
  document.getElementById('app').classList.remove('gated');
}
function renderAgentBar() {
  const agent = Auth.getCurrentAgent();
  document.getElementById('agent-name').textContent = agent ? '👤 ' + agent.name : '—';
  const badge = document.getElementById('agent-role-badge');
  badge.textContent = agent ? Auth.roleLabel(agent.role) : '';
  badge.classList.toggle('hidden', !agent);
  // Only lead/manager see the management panel entry.
  const canReview = !!(agent && Auth.can(agent, 'reviewRequests'));
  document.getElementById('admin-open-btn').classList.toggle('hidden', !canReview);
  if (typeof renderMyReqBadge === 'function') renderMyReqBadge();
  if (typeof subscribeMyRequestsForCurrentAgent === 'function') subscribeMyRequestsForCurrentAgent();
  if (window.Admin && Admin.refreshSubscriptions) Admin.refreshSubscriptions();
  if (window.Admin && Admin.refreshBadge) Admin.refreshBadge();
}
async function attemptLogin() {
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  if (authMode() === 'firebase') {
    await attemptFirebaseLogin(email, password, errEl);
    return;
  }
  if (!VoltaDB.ready()) {
    errEl.textContent = 'החיבור לשרת עדיין נטען — נסה שוב בעוד רגע';
    return;
  }
  const agent = await Auth.findAgentByCredentialsAsync(_agents, email, password);
  if (!agent) { errEl.textContent = 'אימייל או סיסמה שגויים, או חשבון מושבת'; return; }
  Auth.setCurrentAgent(agent);
  errEl.textContent = '';
  document.getElementById('login-email').value = '';
  document.getElementById('login-password').value = '';
  hideLoginGate();
  renderAgentBar();
  // Best-effort: record last login; never block the UI on failure.
  if (VoltaDB.ready()) {
    try {
      const patch = { lastLoginAt: Date.now() };
      if (agent._legacyPassword || agent._needsPasswordRehash) {
        const passwordPatch = await Auth.hashPassword(password);
        patch.passwordHash = passwordPatch.passwordHash;
        patch.password = null;
      }
      await VoltaDB.updateAgent(agent.id, patch);
    } catch (e) {}
  }
}
async function attemptFirebaseLogin(email, password, errEl) {
  if (!VoltaDB.authReady || !VoltaDB.authReady()) {
    errEl.textContent = 'Firebase Auth לא זמין כרגע';
    return;
  }
  try {
    const user = await VoltaDB.signIn(email, password);
    const agent = await VoltaDB.getAgentProfile(user.uid);
    if (!agent || !agent.active) {
      await VoltaDB.signOutAuth();
      errEl.textContent = 'חשבון לא פעיל או חסר פרופיל נציג';
      return;
    }
    Auth.setCurrentAgent(agent);
    errEl.textContent = '';
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
    hideLoginGate();
    renderAgentBar();
    try { await VoltaDB.updateAgent(agent.id, { lastLoginAt: Date.now() }); } catch (e) {}
  } catch (e) {
    errEl.textContent = 'אימייל או סיסמה שגויים';
  }
}
function refreshBootstrapVisibility() {
  // Offer bootstrap whenever there is no active manager yet (covers first-time
  // setup and migration from older agent records that have no role/manager).
  const btn = document.getElementById('bootstrap-btn');
  if (!btn) return;
  if (authMode() === 'firebase') {
    btn.classList.add('hidden');
    return;
  }
  const hasManager = _agents.some(a => a.role === 'manager' && a.active);
  btn.classList.toggle('hidden', hasManager);
}
function reconcileLoginState() {
  const current = Auth.getCurrentAgent();
  if (!current) {
    renderAgentBar();
    showLoginGate();
    return;
  }
  const fresh = Auth.reconcileCurrentAgent(_agents);
  if (fresh) {
    hideLoginGate();
  } else {
    showLoginGate();
  }
  renderAgentBar();
}
function initAgentAuth() {
  document.getElementById('login-btn').addEventListener('click', attemptLogin);
  document.getElementById('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') attemptLogin();
  });
  document.getElementById('logout-btn').addEventListener('click', () => {
    Auth.logout();
    if (authMode() === 'firebase' && VoltaDB.signOutAuth) VoltaDB.signOutAuth().catch(() => {});
    renderAgentBar();
    showLoginGate();
  });
  document.getElementById('admin-open-btn').addEventListener('click', () => {
    if (window.Admin) Admin.openForCurrentAgent();
  });
  document.getElementById('bootstrap-btn').addEventListener('click', () => {
    if (window.Admin) Admin.bootstrap();
  });
  // Initial gate state comes from the stored session only. Live reconciliation
  // starts in startAgentAuthSession() once VoltaDB is initialized.
  if (authMode() !== 'firebase' && Auth.getCurrentAgent()) { hideLoginGate(); renderAgentBar(); }
  else { showLoginGate(); }
}

// Live agents list — used to validate logins, reconcile sessions, and toggle
// bootstrap. Must run only after VoltaDB.init(): subscribing earlier returns a
// dead no-op subscription with an empty agents list, which made an existing
// deployment look like first-time setup (bootstrap button shown) and wiped the
// stored session.
function startAgentAuthSession() {
  if (authMode() === 'firebase') {
    initFirebaseAuthSession();
    return;
  }
  VoltaDB.subscribeAgents((list, meta) => {
    if (meta && meta.authoritative === false) return; // backend not ready / listen error — keep last known state
    _agents = list;
    refreshBootstrapVisibility();
    reconcileLoginState();
  });
}

function initFirebaseAuthSession() {
  refreshBootstrapVisibility();
  if (!VoltaDB.subscribeAuth) { showLoginGate(); return; }
  VoltaDB.subscribeAuth(async user => {
    if (!user) {
      Auth.logout();
      renderAgentBar();
      showLoginGate();
      return;
    }
    try {
      const agent = await VoltaDB.getAgentProfile(user.uid);
      if (!agent || !agent.active) {
        Auth.logout();
        renderAgentBar();
        showLoginGate();
        return;
      }
      Auth.setCurrentAgent(agent);
      hideLoginGate();
      renderAgentBar();
    } catch (e) {
      Auth.logout();
      renderAgentBar();
      showLoginGate();
    }
  });
}

// ============================================================
// EXCEPTION REQUEST MODAL
// ============================================================
let _pendingReq = null;

function openRequestModal(type, subject, context) {
  _pendingReq = { type, subject, context, requestedStatus: null };
  document.getElementById('req-context').textContent =
    (type === 'settlement' ? 'יישוב: ' : 'בדיקת גג: ') + subject;
  document.getElementById('req-reason').value = '';
  document.getElementById('req-error').textContent = '';
  // The status selector ('מתקינים' / 'לא מתקינים') is only for settlement requests.
  const statusSel = document.getElementById('req-status-select');
  if (type === 'settlement') { statusSel.classList.remove('hidden'); setReqStatus(null); }
  else { statusSel.classList.add('hidden'); }
  document.getElementById('req-modal').classList.remove('hidden');
}
function setReqStatus(status) {
  if (_pendingReq) _pendingReq.requestedStatus = status;
  document.querySelectorAll('#req-status-select .req-status-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.status === status);
  });
}
function openSettlementRequest() {
  if (!_currentSettlement) return;
  // subject is the bare name so the override key matches the settlement lookup.
  openRequestModal('settlement', _currentSettlement.name, { status: _currentSettlement.status });
}
function wizardRoofSubject() {
  const s = Wizard.getState();
  const parts = s.answers.map(a => labelForId(a.questionId) + ': ' + a.label);
  return (s.outcome ? '[' + s.outcome + '] ' : '') + parts.join(' · ');
}
function openRoofRequest() {
  const s = Wizard.getState();
  openRequestModal('roof', wizardRoofSubject(), {
    outcome: s.outcome,
    answers: s.answers.map(a => ({ q: labelForId(a.questionId), a: a.label })),
  });
}
function closeRequestModal() {
  document.getElementById('req-modal').classList.add('hidden');
  _pendingReq = null;
}
async function sendRequest() {
  const reason = document.getElementById('req-reason').value;
  const errEl = document.getElementById('req-error');
  const agent = Auth.getCurrentAgent();
  if (!agent) { errEl.textContent = 'לא מחובר נציג'; return; }
  if (!VoltaDB.ready()) { errEl.textContent = 'אין חיבור לשרת — נסה שוב'; return; }
  if (reason.length > 2000) { errEl.textContent = 'הנימוק ארוך מדי (מקסימום 2000 תווים)'; return; }
  try {
    const req = Requests.buildRequest({
      type: _pendingReq.type, agent, subject: _pendingReq.subject,
      reason, context: _pendingReq.context, requestedStatus: _pendingReq.requestedStatus,
    });
    await VoltaDB.addRequest(req);
    closeRequestModal();
    alert('הבקשה נשלחה למנהל ✓');
  } catch (e) {
    const msg = e && e.message;
    errEl.textContent = msg === 'reason required' ? 'יש לכתוב נימוק'
      : msg === 'invalid requestedStatus' ? 'יש לבחור מתקינים או לא מתקינים'
      : 'שגיאה בשליחה';
  }
}
function initRequestModal() {
  document.getElementById('req-send').addEventListener('click', sendRequest);
  document.getElementById('req-cancel').addEventListener('click', closeRequestModal);
  document.querySelectorAll('#req-status-select .req-status-btn').forEach(b => {
    b.addEventListener('click', () => setReqStatus(b.dataset.status));
  });
}

// ============================================================
// MY REQUESTS
// ============================================================
let _myRequests = [];
let _myReqUnsub = null;
const STATUS_LABEL = { pending: '⏳ ממתין', approved: '✅ אושר', rejected: '❌ נדחה' };
const RES_LABEL = { 'one-off': 'חד-פעמי', 'permanent': 'קבוע' };

function renderMyRequests() {
  const agent = Auth.getCurrentAgent();
  const mine = agent ? _myRequests.filter(r => r.agentId === agent.id) : [];
  mine.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const el = document.getElementById('my-req-list');
  if (!mine.length) { el.innerHTML = '<div class="my-req-empty">אין בקשות עדיין.</div>'; return; }
  el.innerHTML = mine.map(r => {
    const res = r.resolution ? ` · ${RES_LABEL[r.resolution] || ''}` : '';
    const note = r.managerNote ? `<div class="mr-note">💬 ${escHtml(r.managerNote)}</div>` : '';
    return `<div class="my-req-row ${r.status}">
      <div class="mr-head"><span class="mr-type">${r.type === 'roof' ? '🏠 גג' : '📍 יישוב'}</span>
        <span class="mr-status">${STATUS_LABEL[r.status] || r.status}${res}</span></div>
      <div class="mr-subject">${escHtml(r.subject || '')}</div>
      ${r.type === 'settlement' && r.requestedStatus
        ? `<div class="ar-requested">מבקש לשנות ל־ <b>${escHtml(r.requestedStatus)}</b></div>` : ''}
      <div class="mr-reason">${escHtml(r.reason || '')}</div>
      ${note}
    </div>`;
  }).join('');
}
// ---- "my requests" toolbar badge ----
function myReqSeenKey() {
  const a = Auth.getCurrentAgent();
  return a ? 'volta_seen_myreq_' + a.id : null;
}
function getMyReqLastSeen() {
  const k = myReqSeenKey();
  return k ? (parseInt(localStorage.getItem(k)) || 0) : 0;
}
function markMyReqSeen() {
  const k = myReqSeenKey();
  if (k) localStorage.setItem(k, String(Date.now()));
}
function renderMyReqBadge() {
  const badge = document.getElementById('myreq-badge');
  if (!badge) return;
  const agent = Auth.getCurrentAgent();
  if (!agent) { badge.classList.add('hidden'); return; }
  const { pending, unseenResolved } = Requests.myRequestsBadge(_myRequests, agent.id, getMyReqLastSeen());
  if (pending === 0 && unseenResolved === 0) { badge.classList.add('hidden'); return; }
  badge.textContent = pending || unseenResolved;
  badge.classList.toggle('alert', unseenResolved > 0);
  badge.classList.remove('hidden');
}

function subscribeMyRequestsForCurrentAgent() {
  if (_myReqUnsub) { try { _myReqUnsub(); } catch (e) {} _myReqUnsub = null; }
  const agent = Auth.getCurrentAgent();
  if (!agent || !VoltaDB.ready()) {
    _myRequests = [];
    renderMyReqBadge();
    return;
  }
  const sub = VoltaDB.subscribeRequestsForAgent || VoltaDB.subscribeRequests;
  _myReqUnsub = sub === VoltaDB.subscribeRequestsForAgent
    ? VoltaDB.subscribeRequestsForAgent(agent.id, handleMyRequests)
    : VoltaDB.subscribeRequests(handleMyRequests);
}

function handleMyRequests(list) {
  const agent = Auth.getCurrentAgent();
  _myRequests = agent ? list.filter(r => r.agentId === agent.id) : [];
  renderMyReqBadge();
  if (!document.getElementById('my-req-modal').classList.contains('hidden')) renderMyRequests();
}

function initMyRequests() {
  document.getElementById('my-requests-btn').addEventListener('click', () => {
    renderMyRequests();
    markMyReqSeen();
    renderMyReqBadge();
    document.getElementById('my-req-modal').classList.remove('hidden');
  });
  document.getElementById('my-req-close').addEventListener('click', () => {
    document.getElementById('my-req-modal').classList.add('hidden');
  });
  subscribeMyRequestsForCurrentAgent();
}

// ============================================================
// INIT
// ============================================================
async function init() {
  initTabs();
  initAppDelegates();
  initSettlementTab();
  initRequestModal();

  // Wire the login UI (and gate from the stored session) before the data layer
  // starts the live agents subscription in startAgentAuthSession().
  initAgentAuth();
  if (!initDataLayerWhenReady()) {
    window.addEventListener('firebase-ready', initDataLayerWhenReady, { once: true });
  }
  initMyRequests();
  if (typeof initManagerPanel === 'function') initManagerPanel();
  // The roof-settings editor is launched from inside the unified manager panel
  // (its "הגדרות גג" tab). We keep only its post-save refresh hook here — its
  // separate dbl-click entry is intentionally not wired (see admin.js).
  if (window.Settings && Settings.setOnSaved) {
    Settings.setOnSaved(() => { if (typeof initWizard === 'function') initWizard(); });
  }

  const statusEl = document.getElementById('data-status');
  statusEl.textContent = 'טוען נתוני יישובים...';
  const result = await Settlements.load();
  if (result.ok) {
    statusEl.textContent = `✓ ${result.count} יישובים נטענו`;
    setTimeout(() => { statusEl.textContent = ''; }, 3000);
  } else {
    statusEl.textContent = `⚠️ לא ניתן לטעון נתונים`;
  }

  if (typeof initWizard === 'function') initWizard();
  initDockCompass();
  initSimDock();
  initKnowledgeBase();
  renderOfferings();
}

// ============================================================
// KNOWLEDGE BASE (demo field rules)
// ============================================================
// ============================================================
// OFFERINGS / PRICING REFERENCE
// ============================================================
function fmtPrice(p) {
  if (!p) return '';
  const n = v => v.toLocaleString('he-IL');
  return p.unit === 'perSqm'
    ? `${n(p.min)}-${n(p.max)} ₪ למ"ר`
    : `${n(p.min)}-${n(p.max)} ₪`;
}

function renderOfferings() {
  const list = document.getElementById('offerings-list');
  if (!list || typeof Offerings === 'undefined') return;
  const all = Offerings.getAll();
  if (!all.length) { list.innerHTML = '<div class="kb-empty">אין נתוני מסלולים.</div>'; return; }
  const CATS = { system: '☀️ מערכות', leasing: '🤝 ליסינג', pergola: '🏗 פרגולות' };
  const order = ['system', 'leasing', 'pergola'];
  list.innerHTML = order.filter(c => all.some(o => o.category === c)).map(cat => `
    <div class="kb-cat">${escHtml(CATS[cat] || cat)}</div>
    ${all.filter(o => o.category === cat).map(o => `
      <div class="offering-card">
        <div class="offering-head">
          <span class="offering-name">${escHtml(o.emoji)} ${escHtml(o.name)}</span>
          ${o.price ? `<span class="offering-price">${escHtml(fmtPrice(o.price))}</span>` : ''}
        </div>
        <div class="offering-meta">
          ${o.minArea ? `<span class="offering-chip">מינ׳ ${o.minArea} מ"ר</span>` : ''}
          ${o.roi ? `<span class="offering-chip">החזר ${escHtml(o.roi)}</span>` : ''}
          ${o.financing === 'leasing' ? `<span class="offering-chip">ליסינג</span>` : ''}
        </div>
        <ul class="offering-highlights">
          ${o.highlights.map(h => `<li>${escHtml(h)}</li>`).join('')}
        </ul>
        ${o.note ? `<div class="kb-note">${escHtml(o.note)}</div>` : ''}
      </div>`).join('')}
  `).join('');
}

function initKnowledgeBase() {
  const input = document.getElementById('kb-input');
  if (!input || !window.VOLTA_KB) return;
  renderKnowledgeBase('');
  input.addEventListener('input', () => renderKnowledgeBase(input.value));
}

function renderKnowledgeBase(query) {
  const list = document.getElementById('kb-list');
  if (!list) return;
  const VERDICT = {
    yes:     { cls:'yes',   badge:'✅ מתקינים' },
    consult: { cls:'check', badge:'⚠️ להתיייעץ' },
    no:      { cls:'no',    badge:'❌ לא מתקינים' },
  };
  const q = (query || '').trim().toLowerCase();
  const items = window.VOLTA_KB.filter(e => {
    if (!q) return true;
    return (e.item + ' ' + e.note + ' ' + e.cat + ' ' + (e.keywords || '')).toLowerCase().includes(q);
  });

  if (!items.length) {
    list.innerHTML = '<div class="kb-empty">לא נמצאו תוצאות. נסה מונח אחר, או פנה למומחה / מנהל.</div>';
    return;
  }

  // group by category, preserving order of first appearance
  const cats = [];
  const byCat = {};
  items.forEach(e => { if (!byCat[e.cat]) { byCat[e.cat] = []; cats.push(e.cat); } byCat[e.cat].push(e); });

  list.innerHTML = cats.map(cat => `
    <div class="kb-cat">${escHtml(cat)}</div>
    ${byCat[cat].map(e => {
      const v = VERDICT[e.verdict] || VERDICT.consult;
      return `<div class="kb-item ${v.cls}">
        <div class="kb-item-head">
          <span class="kb-item-name">${escHtml(e.item)}</span>
          <span class="kb-badge ${v.cls}">${v.badge}</span>
        </div>
        <div class="kb-note">${escHtml(e.note)}</div>
      </div>`;
    }).join('')}
  `).join('');
}

document.addEventListener('DOMContentLoaded', init);
