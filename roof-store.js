// Persistence + validation for roofConfig.
// Uses Firestore when VoltaDB is connected, with localStorage/default fallback.
const VALID_OUTCOMES = ['ok', 'warn', 'escalate', 'stop'];
const VALID_ACTIONS = [null, 'flag', 'escalate', 'stop', 'tiles-age'];

function validateRoofConfig(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object') return { ok: false, errors: ['קונפיג חסר'] };

  const th = cfg.totalSizeThresholds || {};
  if (typeof th.good !== 'number' || th.good <= 0) errors.push('סף "טוב" חייב להיות מספר חיובי');
  if (typeof th.borderline !== 'number' || th.borderline <= 0) errors.push('סף "גבולי" חייב להיות מספר חיובי');
  if (typeof th.good === 'number' && typeof th.borderline === 'number' && th.borderline > th.good)
    errors.push('סף "גבולי" חייב להיות קטן או שווה לסף "טוב"');
  if (typeof cfg.tilesAgeWarning !== 'number' || cfg.tilesAgeWarning <= 0) errors.push('גיל גג מקסימלי חייב להיות מספר חיובי');

  const mats = cfg.materials;
  if (!Array.isArray(mats) || mats.length === 0) { errors.push('חייב להיות לפחות חומר גג אחד'); return { ok: errors.length === 0, errors }; }

  const seen = new Set();
  mats.forEach((m, i) => {
    const tag = m && m.label ? m.label : `#${i + 1}`;
    if (!m.id || !String(m.id).trim()) {
      errors.push(`חומר ${tag}: מזהה (id) חסר`);
    } else {
      if (seen.has(m.id)) errors.push(`מזהה חומר כפול: ${m.id} (חייב להיות ייחודי)`);
      seen.add(m.id);
    }
    if (!m.label || !String(m.label).trim()) errors.push(`חומר ${tag}: שם חסר`);
    if (VALID_ACTIONS.indexOf(m.baseAction === undefined ? null : m.baseAction) === -1)
      errors.push(`חומר ${tag}: פעולת בסיס לא חוקית`);
    const msg = m.messages || {};
    if (m.baseAction === 'stop' && !String(msg.stopReason || '').trim()) errors.push(`חומר ${tag}: פעולת "עצירה" דורשת סיבת עצירה`);
    if (m.baseAction === 'escalate' && !String(msg.escalateNote || '').trim()) errors.push(`חומר ${tag}: פעולת "הסלמה" דורשת הערת הסלמה`);
    if (m.baseAction === 'flag' && !String(msg.flagMsg || '').trim()) errors.push(`חומר ${tag}: פעולת "דגל" דורשת הודעת דגל`);

    const rules = m.sizeRules || [];
    let prev = -Infinity, sawNull = false;
    rules.forEach((r, j) => {
      if (VALID_OUTCOMES.indexOf(r.outcome) === -1) errors.push(`חומר ${tag} כלל ${j + 1}: תוצאה לא חוקית`);
      if (r.upTo === null || r.upTo === undefined) { sawNull = true; }
      else {
        if (sawNull) errors.push(`חומר ${tag}: כלל "ללא גבול" חייב להיות אחרון`);
        if (typeof r.upTo !== 'number' || r.upTo <= prev) errors.push(`חומר ${tag}: ערכי "עד" חייבים לעלות`);
        prev = r.upTo;
      }
    });
  });

  return { ok: errors.length === 0, errors };
}

const RoofStore = (() => {
  const KEY = 'volta.roofConfig.v1';
  const clone = o => JSON.parse(JSON.stringify(o));
  const fallback = () => (typeof DEFAULT_ROOF_CONFIG !== 'undefined' ? clone(DEFAULT_ROOF_CONFIG) : { materials: [], totalSizeThresholds: { good: 70, borderline: 60 }, tilesAgeWarning: 25, managerPassword: '' });
  let cache = null;
  let remoteUnsub = null;

  function readLocal() {
    try {
      const raw = (typeof localStorage !== 'undefined') && localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (validateRoofConfig(parsed).ok) return parsed;
      }
    } catch (e) { /* ignore bad local cache */ }
    return null;
  }

  function writeLocal(cfg) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(cfg));
      return null;
    } catch (e) {
      return 'שמירה מקומית נכשלה: ' + e.message;
    }
  }

  function get() {
    if (cache && validateRoofConfig(cache).ok) return clone(cache);
    const local = readLocal();
    if (local) { cache = clone(local); return clone(local); }
    return fallback();
  }
  function save(cfg) {
    const v = validateRoofConfig(cfg);
    if (!v.ok) return v;
    cache = clone(cfg);
    const localErr = writeLocal(cache);
    if (localErr) return { ok: false, errors: [localErr] };
    if (typeof VoltaDB !== 'undefined' && VoltaDB.ready && VoltaDB.ready() && VoltaDB.saveRoofConfig) {
      VoltaDB.saveRoofConfig(Object.assign({}, clone(cache), { updatedAt: Date.now() }))
        .catch(e => console.warn('roofConfig remote save failed:', e));
    }
    return { ok: true, errors: [] };
  }
  async function saveAsync(cfg) {
    const v = validateRoofConfig(cfg);
    if (!v.ok) return v;
    cache = clone(cfg);
    const localErr = writeLocal(cache);
    if (localErr) return { ok: false, errors: [localErr] };
    if (typeof VoltaDB !== 'undefined' && VoltaDB.ready && VoltaDB.ready() && VoltaDB.saveRoofConfig) {
      try {
        await VoltaDB.saveRoofConfig(Object.assign({}, clone(cache), { updatedAt: Date.now() }));
      } catch (e) {
        return { ok: false, errors: ['שמירה לשרת נכשלה: ' + e.message] };
      }
    }
    return { ok: true, errors: [] };
  }
  function reset() {
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY); } catch (e) {}
    cache = fallback();
    return clone(cache);
  }

  function initRemote(onChange) {
    if (remoteUnsub) { try { remoteUnsub(); } catch (e) {} remoteUnsub = null; }
    if (typeof VoltaDB === 'undefined' || !VoltaDB.ready || !VoltaDB.ready() || !VoltaDB.subscribeRoofConfig) {
      return () => {};
    }
    remoteUnsub = VoltaDB.subscribeRoofConfig(remoteCfg => {
      if (!remoteCfg) return;
      const cfg = clone(remoteCfg);
      delete cfg.updatedAt;
      const v = validateRoofConfig(cfg);
      if (!v.ok) { console.warn('Ignoring invalid remote roofConfig:', v.errors); return; }
      cache = cfg;
      writeLocal(cache);
      if (typeof onChange === 'function') onChange(clone(cache));
    });
    return remoteUnsub;
  }

  return { get, save, saveAsync, reset, initRemote, validate: validateRoofConfig };
})();

if (typeof window !== 'undefined') window.RoofStore = RoofStore;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Object.assign(module.exports || {}, { validateRoofConfig, RoofStore });
}
