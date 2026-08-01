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
