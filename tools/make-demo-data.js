#!/usr/bin/env node
// AUTO-GENERATES a synthetic settlements-data.js for the Volta demo.
// Public sources only: localities.json (CBS names+district),
// settlement-coords.js (OpenStreetMap lat/lon). Status + install metrics are
// fully synthetic (seeded, geographically clustered) and NEVER read any real
// Volta classification — so no real business data can leak.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const FINAL_FORMS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
function normKey(s) {
  return (s == null ? '' : String(s))
    .replace(/[\s'"״׳()\[\]{}.\-–—,־]/g, '')
    .replace(/[ךםןףץ]/g, ch => FINAL_FORMS[ch]) // fold final letters to match coord keys
    .toLowerCase();
}
function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rand01(seed) { return hash32(seed) / 4294967296; }

const CELL = 0.15;             // ~15km cells → organic contiguous clusters
const GREEN_THRESHOLD = 0.50;  // yields ~77% green / ~23% red: impressive but believable
const MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

function statusFor(name, lat, lon) {
  const latCell = Math.round(lat / CELL), lonCell = Math.round(lon / CELL);
  const cellR = rand01('cell:' + latCell + ':' + lonCell); // whole-cell coherence
  const townR = rand01('town:' + name);                    // local variation
  const score = 0.7 * cellR + 0.3 * townR;
  return score < GREEN_THRESHOLD ? 'מתקינים' : 'לא מתקינים';
}
function metricsFor(name, status) {
  if (status !== 'מתקינים') return { count: '', last: '' };
  if (rand01('inst:' + name) > 0.45) return { count: '', last: '' };
  const count = 1 + Math.floor(rand01('cnt:' + name) * 40);
  const year = 2023 + Math.floor(rand01('yr:' + name) * 3);
  const month = MONTHS[Math.floor(rand01('mo:' + name) * 12)];
  return { count: String(count), last: month + ' ' + year };
}
function csvCell(v) {
  const s = (v == null ? '' : String(v));
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function generate() {
  const localities = JSON.parse(fs.readFileSync(path.join(ROOT, 'localities.json'), 'utf8'));
  const coordsText = fs.readFileSync(path.join(ROOT, 'settlement-coords.js'), 'utf8');
  const coords = JSON.parse(coordsText.match(/window\.SETTLEMENT_COORDS\s*=\s*(\{[\s\S]*\})\s*;?\s*$/)[1]);

  const HEADER = 'שם יישוב,סוג יישוב,סטטוס,כתיבים חלופיים,מה הנציג עושה,הערה,מקור,תאריך עדכון,כמות התקנות,תאריך התקנה אחרונה';
  const rows = [HEADER];
  const seen = new Set();
  let matched = 0, green = 0, totalInstalls = 0;

  for (const loc of localities) {
    const name = (loc['שם_ישוב'] || '').toString().trim();
    if (!name || name === 'כלל ארצי') continue;
    const key = normKey(name);
    if (seen.has(key)) continue;
    const c = coords[key];
    if (!c) continue; // keep only towns with a real public coordinate
    seen.add(key);
    matched++;
    const [lat, lon] = c;
    const status = statusFor(name, lat, lon);
    if (status === 'מתקינים') green++;
    const action = status === 'מתקינים' ? 'להמשיך לבדיקת תשתית ושטח' : 'לא לקדם';
    const m = metricsFor(name, status);
    if (m.count) totalInstalls += Number(m.count);
    rows.push([
      csvCell(name), csvCell('יישוב'), csvCell(status), csvCell(''),
      csvCell(action), csvCell(''), csvCell('נתוני דמו'), csvCell(''),
      csvCell(m.count), csvCell(m.last),
    ].join(','));
  }

  const out = '// AUTO-GENERATED demo data — synthetic status/metrics; public names+coords only.\n' +
    '// Regenerate: node tools/make-demo-data.js\n' +
    'window.SETTLEMENTS_CSV = `' + rows.join('\n') + '`;\n';
  fs.writeFileSync(path.join(ROOT, 'settlements-data.js'), out, 'utf8');
  console.error(`matched=${matched} green=${green} (${(100 * green / matched).toFixed(1)}%) red=${matched - green} totalInstalls=${totalInstalls}`);
}

if (require.main === module) generate();
if (typeof module !== 'undefined') module.exports = { normKey, statusFor, metricsFor, generate };
