const test = require('node:test');
const assert = require('node:assert');
const { Attendance } = require('../attendance.js');

test('localDateKey מחזיר תאריך בפורמט YYYY-MM-DD', () => {
  const key = Attendance.localDateKey(new Date('2026-06-18T10:00:00Z'));
  assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
  assert.strictEqual(key, '2026-06-18');
});

test('localDateKey חוצה חצות לפי שעון ישראל, לא UTC', () => {
  // 22:30 UTC = 01:30 בישראל (קיץ, UTC+3) — כבר היום הבא
  const key = Attendance.localDateKey(new Date('2026-06-18T22:30:00Z'));
  assert.strictEqual(key, '2026-06-19');
});

test('docId משלב תאריך ומזהה', () => {
  assert.strictEqual(Attendance.docId('2026-06-18', 'abc'), '2026-06-18_abc');
});

test('applyPunch פותח מקטע חדש כשאין פתוח', () => {
  const r = Attendance.applyPunch([], '2026-06-18T06:00:00.000Z');
  assert.strictEqual(r.kind, 'in');
  assert.strictEqual(r.sessions.length, 1);
  assert.strictEqual(r.sessions[0].out, null);
});

test('applyPunch סוגר מקטע פתוח', () => {
  const r = Attendance.applyPunch([{ in: '2026-06-18T06:00:00.000Z', out: null }], '2026-06-18T09:00:00.000Z');
  assert.strictEqual(r.kind, 'out');
  assert.strictEqual(r.sessions[0].out, '2026-06-18T09:00:00.000Z');
});

test('applyPunch תומך בכמה מקטעים (הפסקות)', () => {
  let s = Attendance.applyPunch([], '2026-06-18T06:00:00.000Z').sessions;      // in
  s = Attendance.applyPunch(s, '2026-06-18T09:00:00.000Z').sessions;           // out (הפסקה)
  const r = Attendance.applyPunch(s, '2026-06-18T10:00:00.000Z');              // in שוב
  assert.strictEqual(r.kind, 'in');
  assert.strictEqual(r.sessions.length, 2);
});

test('applyPunch נעצר במגבלת מקטעים יומית', () => {
  const many = [];
  for (let i = 0; i < Attendance.MAX_SESSIONS_PER_DAY; i++) {
    many.push({ in: '2026-06-18T06:00:00.000Z', out: '2026-06-18T06:01:00.000Z' });
  }
  const r = Attendance.applyPunch(many, '2026-06-18T10:00:00.000Z');
  assert.strictEqual(r.kind, 'full');
});

test('computeSummary מסכם מקטעים סגורים', () => {
  const sum = Attendance.computeSummary([
    { in: '2026-06-18T06:00:00.000Z', out: '2026-06-18T09:00:00.000Z' },   // 3h
    { in: '2026-06-18T10:00:00.000Z', out: '2026-06-18T14:30:00.000Z' },   // 4.5h
  ], Date.now(), true);
  assert.strictEqual(sum.totalMs, 7.5 * 3600000);
  assert.strictEqual(sum.open, false);
  assert.strictEqual(sum.firstIn, Date.parse('2026-06-18T06:00:00.000Z'));
  assert.strictEqual(sum.lastOut, Date.parse('2026-06-18T14:30:00.000Z'));
});

test('computeSummary מוסיף זמן חי למקטע פתוח היום בלבד', () => {
  const inMs = Date.parse('2026-06-18T06:00:00.000Z');
  const now = inMs + 2 * 3600000;
  const sessions = [{ in: '2026-06-18T06:00:00.000Z', out: null }];
  const today = Attendance.computeSummary(sessions, now, true);
  assert.strictEqual(today.totalMs, 2 * 3600000);
  assert.strictEqual(today.open, true);
  // יום שעבר עם מקטע פתוח: שכח לצאת — בלי זמן חי, מסומן פתוח
  const past = Attendance.computeSummary(sessions, now, false);
  assert.strictEqual(past.totalMs, 0);
  assert.strictEqual(past.open, true);
});

test('computeSummary מתעלם ממקטעים פגומים', () => {
  const sum = Attendance.computeSummary([
    { in: 'לא-תאריך', out: '2026-06-18T09:00:00.000Z' },
    { in: '2026-06-18T10:00:00.000Z', out: '2026-06-18T09:00:00.000Z' },   // out לפני in
    { in: '2026-06-18T10:00:00.000Z', out: '2026-06-18T11:00:00.000Z' },   // תקין: 1h
  ], Date.now(), true);
  assert.strictEqual(sum.totalMs, 3600000);
});

test('fmtDur מציג H:MM', () => {
  assert.strictEqual(Attendance.fmtDur(7.5 * 3600000), '7:30');
  assert.strictEqual(Attendance.fmtDur(9 * 60000), '0:09');
  assert.strictEqual(Attendance.fmtDur(0), '0:00');
});

test('toCsv מפיק כותרת ושורות עם סימון יציאה חסרה', () => {
  const csv = Attendance.toCsv([
    { date: '2026-06-18', agentName: 'דנה', firstIn: Date.parse('2026-06-18T06:00:00.000Z'), lastOut: Date.parse('2026-06-18T14:00:00.000Z'), totalMs: 8 * 3600000, open: false },
    { date: '2026-06-18', agentName: 'יוסי', firstIn: Date.parse('2026-06-18T07:00:00.000Z'), lastOut: null, totalMs: 0, open: true },
  ]);
  const lines = csv.split('\r\n');
  assert.strictEqual(lines.length, 3);
  assert.ok(lines[0].includes('תאריך'));
  assert.ok(lines[1].includes('8:00'));
  assert.ok(lines[2].includes('לא הוחתמה יציאה'));
});
