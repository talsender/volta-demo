// sim-editor.js — full-screen house-structure editor. Left: 2D top-down plan
// (PlanEditor, the sole editor). Right: live 3D preview (VoltaSim, orbit-only).
// Edits flow plan → layout → 3D + shading metric (rAF-coalesced).
const SimEditor = (() => {
  'use strict';
  let sim = null, plan = null, layout = null, t = 0.5, playRAF = 0, raf = 0, selected = null;

  function roofCfg() { return (typeof RoofStore !== 'undefined') ? RoofStore.get() : { materials: [] }; }
  function $(id) { return document.getElementById(id); }
  function setText(id, v) { const e = $(id); if (e) e.textContent = v; }

  function injectCSS() {}

  // ---------- overlay DOM ----------
  function buildOverlay() {
    const el = document.createElement('div');
    el.className = 'se-overlay'; el.id = 'se-overlay';
    el.innerHTML = `
      <div class="se-top">
        <span class="se-title">⛭ עורך מבנה בית · סימולציית שמש</span>
        <button class="se-x" data-se-action="close">✕ סגור</button>
      </div>
      <div class="se-stage">
        <div class="se-split">
          <div class="se-pane">
            <span class="se-pane-tag">תוכנית · מבט-על (גרור · מתח פינה · סובב)</span>
            <svg id="se-plan" class="se-plan-svg"></svg>
          </div>
          <div class="se-pane">
            <span class="se-pane-tag">תצוגה · 3D + הצללה</span>
            <canvas id="se-canvas" class="se-canvas"></canvas>
            <div class="se-metric">
              <div class="se-m-row"><span>חשיפת שמש</span><b id="se-exposure">—</b></div>
              <div class="se-m-row"><span>תפוקת כיוון</span><b id="se-yield">—</b></div>
              <div class="se-total ok" id="se-total">—</div>
            </div>
          </div>
        </div>
        <div class="se-tools">
          <div class="se-card">
            <h4>הוסף מכשול</h4>
            <button class="se-btn" data-se-action="add-obstacle" data-type="tree">🌳 עץ</button>
            <button class="se-btn" data-se-action="add-obstacle" data-type="building">🏢 מבנה שכן</button>
          </div>
          <div class="se-card">
            <h4>מבנה הבית</h4>
            <div class="se-field">קומות:
              <button class="se-btn se-mini" data-se-action="stories-dec">−</button>
              <span id="se-stories">1</span>
              <button class="se-btn se-mini" data-se-action="stories-inc">+</button>
            </div>
            <button class="se-btn" data-se-action="align-door">🚪 יישר לפי הדלת</button>
          </div>
          <div class="se-card hidden" id="se-sel">
            <h4 id="se-sel-title">אובייקט נבחר</h4>
            <div class="se-field" id="se-height-field">גובה: <span id="se-height-val"></span> מ'
              <input type="range" min="2" max="20" step="0.5" id="se-height" data-se-input="height">
            </div>
            <button class="se-btn warn" data-se-action="delete-selected">🗑 מחק</button>
          </div>
          <div class="se-card">
            <button class="se-btn" data-se-action="reset-layout">↺ אפס</button>
          </div>
        </div>
      </div>
      <div class="se-bottom">
        <div class="se-time">
          <button class="se-play" id="se-play" data-se-action="toggle-play">▶</button>
          <span class="se-clock" id="se-time">12:00</span>
          <input type="range" min="0" max="1" step="0.01" value="0.5" id="se-time-range" data-se-input="time">
        </div>
        <div class="se-orient">כיוון בית:
          <input type="range" min="0" max="359" step="1" id="se-orient-range" data-se-input="orientation">
          <span id="se-orient">180°</span>
        </div>
        <span class="se-hint">עריכה בתוכנית (שמאל) · גרירת רקע ב-3D = סיבוב מצלמה</span>
      </div>`;
    document.body.appendChild(el);
    bindOverlay(el);
    return el;
  }

  function bindOverlay(el) {
    el.addEventListener('click', e => {
      const btn = e.target.closest('[data-se-action]');
      if (!btn) return;
      const action = btn.dataset.seAction;
      if (action === 'close') close();
      else if (action === 'add-obstacle') { if (plan) plan.addObstacle(btn.dataset.type); }
      else if (action === 'delete-selected') { if (plan) plan.deleteSelected(); }
      else if (action === 'reset-layout') resetLayout();
      else if (action === 'toggle-play') togglePlay();
      else if (action === 'stories-inc') changeStories(1);
      else if (action === 'stories-dec') changeStories(-1);
      else if (action === 'align-door') alignDoor();
    });
    el.addEventListener('input', e => {
      const input = e.target.closest('[data-se-input]');
      if (!input) return;
      if (input.dataset.seInput === 'height') setSelectedHeight(input.value);
      else if (input.dataset.seInput === 'time') setTime(input.value);
      else if (input.dataset.seInput === 'orientation') setOrientation(input.value);
    });
  }

  // ---------- model ----------
  function wizardInputs() {
    return (typeof Wizard !== 'undefined' && Wizard.getSimInputs)
      ? Wizard.getSimInputs()
      : { materials: [], azimuth: 180, shading: 'none', propertyType: 'private' };
  }
  function freshLayout() {
    return RoofLayout.buildLayout(wizardInputs(), roofCfg());
  }

  // ---------- live render (rAF-coalesced) ----------
  function scheduleRender() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!sim || !layout) return;
      try {
        sim.update(RoofLayout.layoutToSimState(layout));
        sim.setSunTime(t);              // update() resets the sun; re-apply the time
        refreshMetric();
      } catch (err) {
        if (typeof console !== 'undefined') console.error('SimEditor render error:', err);
      }
    });
  }

  function orientationYield(deg) {
    return (typeof RoofCompass !== 'undefined') ? RoofCompass.assess(deg).yield : 100;
  }
  function refreshMetric() {
    if (!sim) return;
    const exposure = sim.computeExposure();
    const ex = (exposure == null) ? 100 : exposure;
    const y = orientationYield(layout.house.orientationDeg);
    const total = (typeof Shading !== 'undefined') ? Shading.combine(y, ex) : ex;
    setText('se-exposure', exposure == null ? '—' : ex + '%');
    setText('se-yield', y + '%');
    const r = (typeof Shading !== 'undefined') ? Shading.rate(total) : { label: '', cls: 'ok' };
    const elT = $('se-total');
    if (elT) { elT.className = 'se-total ' + r.cls; elT.textContent = total + '% · ' + r.label; }
  }

  // ---------- selection panel (obstacles) ----------
  function onSelect(sel) {
    selected = sel;
    const card = $('se-sel');
    const isObs = sel && sel.kind === 'obs';
    if (card) card.classList.toggle('hidden', !isObs);
    if (isObs) {
      const o = layout.obstacles.find(x => x.id === sel.id);
      if (!o) return;
      setText('se-sel-title', o.type === 'building' ? '🏢 מבנה שכן' : '🌳 עץ');
      const h = $('se-height'); if (h) h.value = o.height || 4;
      setText('se-height-val', (o.height || 4));
    }
  }
  function setSelectedHeight(v) {
    if (!selected || selected.kind !== 'obs') return;
    const o = layout.obstacles.find(x => x.id === selected.id);
    if (!o) return;
    o.height = parseFloat(v);
    setText('se-height-val', o.height);
    scheduleRender();
  }

  // ---------- structure controls ----------
  function changeStories(delta) {
    layout.house.stories = Math.max(1, Math.min(3, (layout.house.stories || 1) + delta));
    setText('se-stories', layout.house.stories);
    scheduleRender();
  }
  function alignDoor() {
    layout.house.orientationDeg = RoofLayout.alignToDoor(layout);
    syncOrient();
    scheduleRender();
  }
  function setOrientation(v) {
    layout.house.orientationDeg = parseInt(v);
    setText('se-orient', layout.house.orientationDeg + '°');
    scheduleRender();
  }
  function syncOrient() {
    const rng = $('se-orient-range'); if (rng) rng.value = layout.house.orientationDeg;
    setText('se-orient', layout.house.orientationDeg + '°');
  }
  function resetLayout() {
    layout = freshLayout();
    if (plan) { plan.destroy(); }
    plan = PlanEditor.mount($('se-plan'), layout, { onChange: scheduleRender, onSelect: onSelect });
    selected = null; onSelect(null);
    setText('se-stories', layout.house.stories);
    syncOrient();
    scheduleRender();
  }

  // ---------- time / play ----------
  function hourLabel(t01) {
    const hh = 6 + t01 * 12; const h = Math.floor(hh), m = Math.round((hh - h) * 60);
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
  function setTime(v) {
    t = parseFloat(v);
    if (sim) sim.setSunTime(t);
    setText('se-time', hourLabel(t));
    const r = $('se-time-range'); if (r && r.value != t) r.value = t;
    refreshMetric();
  }
  function togglePlay() {
    if (playRAF) { cancelAnimationFrame(playRAF); playRAF = 0; setText('se-play', '▶'); return; }
    setText('se-play', '⏸');
    let last = performance.now();
    const step = (now) => {
      const dt = (now - last) / 1000; last = now;
      let nt = t + dt * 0.12; if (nt > 1) nt = 0;
      setTime(nt);
      playRAF = requestAnimationFrame(step);
    };
    playRAF = requestAnimationFrame(step);
  }

  // ---------- open / close ----------
  function open() {
    if (!window.VoltaSim || !VoltaSim.available()) { alert('מנוע התלת-ממד לא נטען — דרוש חיבור אינטרנט.'); return; }
    injectCSS();
    buildOverlay();
    try {
      layout = freshLayout();
      selected = null;
      const canvas = $('se-canvas');
      // 3D preview: orbit on, in-scene editing off (the 2D plan is the editor)
      sim = VoltaSim.mount(canvas, { interactive: true, editable: false });
      plan = PlanEditor.mount($('se-plan'), layout, { onChange: scheduleRender, onSelect: onSelect });
      setText('se-stories', layout.house.stories);
      syncOrient();
      t = 0.5; const trng = $('se-time-range'); if (trng) trng.value = t;
      setText('se-time', hourLabel(t));
      scheduleRender();
      setTimeout(() => { if (sim) sim.resize(); if (plan) plan.render(); }, 40);
    } catch (err) {
      const stage = document.querySelector('.se-stage');
      if (stage) {
        const msg = document.createElement('div');
        msg.className = 'se-load-error';
        msg.textContent = '⚠ שגיאה בטעינת העורך: ' + ((err && err.message) ? err.message : err);
        stage.appendChild(msg);
      }
      if (typeof console !== 'undefined') console.error('SimEditor open error:', err);
    }
  }
  function close() {
    if (playRAF) { cancelAnimationFrame(playRAF); playRAF = 0; }
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (plan) { plan.destroy(); plan = null; }
    if (sim) { sim.dispose(); sim = null; }
    const el = $('se-overlay'); if (el) el.remove();
    layout = null; selected = null;
  }

  // ---------- dock open button ----------
  // Prefer the labeled button in index.html (#se-open-btn); just wire its click.
  // Fall back to injecting one if the markup isn't present (parallel init / older DOM).
  function injectOpenButton() {
    let btn = document.getElementById('se-open-btn');
    if (btn) {
      if (!btn._seWired) { btn.addEventListener('click', open); btn._seWired = true; }
      return;
    }
    const head = document.querySelector('#sim-dock .dock-head');
    if (!head) return;
    btn = document.createElement('button');
    btn.id = 'se-open-btn'; btn.className = 'dock-toggle dock-edit'; btn.title = 'הגדל ועריכה: הוספת גג, מכשולים ודלת';
    btn.textContent = '⛶ הגדל ועריכה';
    btn.addEventListener('click', open); btn._seWired = true;
    const toggle = document.getElementById('sim-dock-toggle');
    const container = (toggle && toggle.parentNode) || head;
    container.insertBefore(btn, container.firstChild);
  }
  function tryInject(n) {
    injectOpenButton();
    const b = document.getElementById('se-open-btn');
    if ((!b || !b._seWired) && n > 0) setTimeout(() => tryInject(n - 1), 300);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => tryInject(8));
  else tryInject(8);

  return {
    open, close, addObstacle: t => { if (plan) plan.addObstacle(t); }, deleteSelected: () => { if (plan) plan.deleteSelected(); },
    setSelectedHeight, setOrientation, setTime, togglePlay, resetLayout, alignDoor, changeStories,
  };
})();
if (typeof window !== 'undefined') window.SimEditor = SimEditor;
