// Settlement data store — loaded once on init
const Settlements = (() => {
  let _data = []; // [{name, aliases, type, status, action, note, source, updated}]

  // Normalize Hebrew string for comparison: lowercase, remove punctuation
  function normalize(str) {
    if (!str) return '';
    return str
      .toLowerCase()
      .replace(/['"״׳\-–—]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Parse CSV text into array of settlement objects
  function parseCSV(text) {
    const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim());
    if (lines.length < 2) return [];
    // Skip header row (row 0)
    return lines.slice(1).map(line => {
      // Handle quoted fields with commas inside
      const cols = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { inQuotes = !inQuotes; }
        else if (ch === ',' && !inQuotes) { cols.push(cur.trim()); cur = ''; }
        else { cur += ch; }
      }
      cols.push(cur.trim());
      return {
        name:         cols[0] || '',
        type:         cols[1] || '',
        status:       cols[2] || '',
        aliases:      (cols[3] || '').split(',').map(s => s.trim()).filter(Boolean),
        action:       cols[4] || '',
        note:         cols[5] || '',
        source:       cols[6] || '',
        updated:      cols[7] || '',
        installCount: parseInt(cols[8]) || 0,
        lastInstall:  cols[9] || '',
      };
    }).filter(s => s.name);
  }

  // Load from embedded data (settlements-data.js), then merge Firestore
  // manager overrides on top (if the data layer is connected).
  async function load() {
    try {
      const text = window.SETTLEMENTS_CSV;
      if (!text) throw new Error('embedded data (SETTLEMENTS_CSV) missing');
      _data = parseCSV(text);
      if (typeof VoltaDB !== 'undefined' && VoltaDB.ready() && typeof Requests !== 'undefined') {
        const overrides = await VoltaDB.loadOverrides();
        _data = Requests.mergeOverrides(_data, overrides);
      }
      return { ok: true, count: _data.length };
    } catch (err) {
      _data = [];
      return { ok: false, error: err.message };
    }
  }

  // Search: returns top 5 matches sorted by relevance
  function search(query) {
    if (!query || query.trim().length < 2) return [];
    const q = normalize(query);

    const scored = _data.map(s => {
      const name = normalize(s.name);
      const aliasMatch = s.aliases.some(a => normalize(a).includes(q));
      if (name === q) return { s, score: 100 };
      if (name.startsWith(q)) return { s, score: 90 };
      if (aliasMatch && normalize(s.aliases.find(a => normalize(a) === q) || '') === q) return { s, score: 85 };
      if (name.includes(q)) return { s, score: 70 };
      if (aliasMatch) return { s, score: 60 };
      // Partial: query starts with at least 3 chars of name
      if (q.length >= 3 && name.includes(q.slice(0, 3))) return { s, score: 30 };
      return { s, score: 0 };
    }).filter(x => x.score > 0);

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5).map(x => x.s);
  }

  // Get badge class for status
  function statusClass(status) {
    if (status === 'מתקינים') return 'yes';
    if (status === 'לא מתקינים') return 'no';
    if (status === 'להתייעץ') return 'check';
    return 'unknown';
  }

  // Get result card data for a settlement
  function getResult(settlement) {
    const cls = statusClass(settlement.status);
    const icons = { yes: '✅', no: '❌', check: '⚠️', unknown: '❓' };
    const titles = {
      yes: 'מתקינים באזור זה',
      no: 'לא מתקינים באזור זה',
      check: 'דורש בדיקה — פנה למנהל',
      unknown: 'יישוב לא זוהה במאגר',
    };
    return {
      cls,
      icon: icons[cls],
      title: titles[cls],
      settlement: `${settlement.name}${settlement.type ? ' · ' + settlement.type : ''}`,
      note: settlement.note || settlement.action || '',
      showWizardBtn: cls === 'yes',
      installCount: settlement.installCount || 0,
      lastInstall:  settlement.lastInstall || '',
    };
  }

  function getAll() { return _data.slice(); }

  return { load, search, statusClass, getResult, getAll };
})();

if (typeof module !== 'undefined') module.exports = Settlements;
