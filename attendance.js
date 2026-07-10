// Attendance (time-clock) pure logic. No DOM, no Firestore — the data layer
// lives in firebase.js and the UI in app.js/admin.js. Day boundary is the
// Israel-local calendar date; "midnight reset" is just the date key changing.
const Attendance = (() => {
  'use strict';

  const TZ = 'Asia/Jerusalem';
  const MAX_SESSIONS_PER_DAY = 40;

  // 'YYYY-MM-DD' in Israel local time (en-CA locale formats exactly like that).
  function localDateKey(d) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d || new Date());
  }

  function docId(dateKey, uid) { return dateKey + '_' + uid; }

  // Apply a punch to an entry's sessions. Returns { sessions, kind: 'in'|'out' }.
  // An open session (out === null) is closed; otherwise a new one is opened.
  function applyPunch(sessions, nowIso) {
    const list = (sessions || []).map(s => ({ in: s.in, out: s.out === undefined ? null : s.out }));
    const open = list.find(s => s.out === null);
    if (open) {
      open.out = nowIso;
      return { sessions: list, kind: 'out' };
    }
    if (list.length >= MAX_SESSIONS_PER_DAY) return { sessions: list, kind: 'full' };
    list.push({ in: nowIso, out: null });
    return { sessions: list, kind: 'in' };
  }

  // Daily summary. nowMs only matters for a live (today, still-open) session.
  // isToday=false + open session ⇒ the rep forgot to clock out: no live time is
  // added and the row is flagged for the manager to complete.
  function computeSummary(sessions, nowMs, isToday) {
    const list = sessions || [];
    let totalMs = 0, firstIn = null, lastOut = null, open = false;
    for (const s of list) {
      const inMs = Date.parse(s.in);
      if (isNaN(inMs)) continue;
      if (firstIn === null || inMs < firstIn) firstIn = inMs;
      if (s.out) {
        const outMs = Date.parse(s.out);
        if (!isNaN(outMs) && outMs >= inMs) {
          totalMs += outMs - inMs;
          if (lastOut === null || outMs > lastOut) lastOut = outMs;
        }
      } else {
        open = true;
        if (isToday && typeof nowMs === 'number' && nowMs > inMs) totalMs += nowMs - inMs;
      }
    }
    return { totalMs, firstIn, lastOut, open };
  }

  function fmtTime(ms) {
    if (ms === null || ms === undefined) return '—';
    return new Intl.DateTimeFormat('he-IL', {
      timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(ms));
  }

  function fmtDur(ms) {
    if (!ms || ms < 0) return '0:00';
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h + ':' + String(m).padStart(2, '0');
  }

  // Manager report rows → CSV (Excel-Hebrew friendly: caller prepends BOM).
  // rows: [{date, agentName, firstIn, lastOut, totalMs, open}]
  function toCsv(rows) {
    const esc = v => {
      const s = String(v === null || v === undefined ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const head = ['תאריך', 'נציג', 'כניסה ראשונה', 'יציאה אחרונה', 'סה"כ שעות', 'הערה'];
    const lines = [head.join(',')];
    for (const r of rows) {
      lines.push([
        esc(r.date), esc(r.agentName),
        esc(r.firstIn === null ? '' : fmtTime(r.firstIn)),
        esc(r.lastOut === null ? '' : fmtTime(r.lastOut)),
        esc(fmtDur(r.totalMs)),
        esc(r.open ? 'לא הוחתמה יציאה' : ''),
      ].join(','));
    }
    return lines.join('\r\n');
  }

  return { localDateKey, docId, applyPunch, computeSummary, fmtTime, fmtDur, toCsv, MAX_SESSIONS_PER_DAY };
})();

if (typeof window !== 'undefined') window.Attendance = Attendance;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Object.assign(module.exports || {}, { Attendance });
}
