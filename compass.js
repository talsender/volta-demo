// ============================================================
// VOLTA — Roof orientation compass (azimuth → solar quality)
// Interactive nav-instrument dial for the qualification wizard.
// Convention: azimuth 0=N(up), 90=E, 180=S(down), 270=W.
// ============================================================
const RoofCompass = (() => {
  'use strict';

  const NAMES = ['צפון', 'צפון-מזרח', 'מזרח', 'דרום-מזרח', 'דרום', 'דרום-מערב', 'מערב', 'צפון-מערב'];

  function norm(az) { return ((az % 360) + 360) % 360; }
  function dirName(az) { return NAMES[Math.round(norm(az) / 45) % 8]; }

  // Solar assessment for the northern hemisphere (south optimal)
  function assess(az) {
    az = norm(az);
    const devAbs = Math.abs(az - 180);
    const dev = Math.min(devAbs, 360 - devAbs);          // 0 = due south, 180 = due north
    const yieldPct = Math.round(62 + (Math.cos(dev * Math.PI / 180) + 1) / 2 * 38);
    let quality, flagClass, flag = null;
    if (dev <= 45)       { quality = 'מצוין'; flagClass = 'ok'; }
    else if (dev <= 90)  { quality = 'טוב';   flagClass = 'ok'; }
    else if (dev <= 135) { quality = 'סביר';  flagClass = 'warn';
      flag = 'גג פונה ' + dirName(az) + ' — תפוקה מופחתת (~' + yieldPct + '%). המומחה יעריך כדאיות.'; }
    else                 { quality = 'נמוך';  flagClass = 'warn';
      flag = 'גג פונה צפונה (' + dirName(az) + ') — תפוקה נמוכה (~' + yieldPct + '%). יש לציין ללקוח ולהעריך עם מומחה.'; }
    return { az, dir: dirName(az), quality, flagClass, yield: yieldPct, flag };
  }

  const COL = {
    ring:  'rgba(120,220,255,',
    tick:  'rgba(120,220,255,',
    sun:   'rgba(255,196,90,',
    text:  '#90a8cc',
    good:  'rgba(61,240,138,',
    okcy:  'rgba(54,230,212,',
    warn:  'rgba(255,178,74,',
    bad:   'rgba(255,93,108,',
  };

  function needleColor(dev) {
    if (dev <= 45) return COL.good;
    if (dev <= 90) return COL.okcy;
    if (dev <= 135) return COL.warn;
    return COL.bad;
  }

  // Mount onto a canvas; returns { get, set }
  function mount(canvas, initialAz, onChange) {
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let az = norm(initialAz || 180);
    let display = az;            // eased value for smooth motion
    let cx = 0, cy = 0, R = 0, size = 0;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      size = Math.max(1, rect.width);
      canvas.width = size * dpr; canvas.height = size * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = size / 2; cy = size / 2; R = size * 0.42;
    }
    resize();
    window.addEventListener('resize', resize);

    // az → screen point at radius r (0=up/N, clockwise)
    function pt(a, r) {
      const rad = a * Math.PI / 180;
      return { x: cx + Math.sin(rad) * r, y: cy - Math.cos(rad) * r };
    }

    function draw() {
      ctx.clearRect(0, 0, size, size);

      // base disc
      const g = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
      g.addColorStop(0, 'rgba(20,40,70,0.55)');
      g.addColorStop(1, 'rgba(4,8,18,0.2)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

      // south "sun" optimal sector (135°–225°)
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      for (let a = 135; a <= 225; a += 3) { const p = pt(a, R); ctx.lineTo(p.x, p.y); }
      ctx.closePath();
      ctx.fillStyle = COL.sun + '0.10)';
      ctx.fill();

      // rings
      ctx.strokeStyle = COL.ring + '0.18)'; ctx.lineWidth = 1;
      [R, R * 0.66, R * 0.33].forEach(r => {
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      });

      // ticks
      for (let a = 0; a < 360; a += 15) {
        const major = a % 45 === 0;
        const p1 = pt(a, R);
        const p2 = pt(a, R - (major ? 12 : 6));
        ctx.strokeStyle = COL.tick + (major ? '0.5)' : '0.22)');
        ctx.lineWidth = major ? 1.4 : 1;
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
      }

      // cardinal labels
      const cards = [['N', 0], ['E', 90], ['S', 180], ['W', 270]];
      ctx.font = '600 13px JetBrains Mono, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      cards.forEach(([t, a]) => {
        const p = pt(a, R - 26);
        ctx.fillStyle = a === 180 ? COL.sun + '1)' : COL.text;
        ctx.fillText(t, p.x, p.y);
      });

      // sun glyph at due south
      const sp = pt(180, R - 2);
      ctx.fillStyle = COL.sun + '0.95)';
      ctx.shadowColor = COL.sun + '0.9)'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;

      // --- roof needle ---
      const devAbs = Math.abs(norm(display) - 180);
      const dev = Math.min(devAbs, 360 - devAbs);
      const nc = needleColor(dev);
      const tip = pt(display, R - 16);
      const tail = pt(display + 180, R * 0.34);
      const left = pt(display + 150, R * 0.16);
      const right = pt(display - 150, R * 0.16);

      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(left.x, left.y);
      ctx.lineTo(tail.x, tail.y);
      ctx.lineTo(right.x, right.y);
      ctx.closePath();
      ctx.fillStyle = nc + '0.85)';
      ctx.shadowColor = nc + '0.7)'; ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = nc + '1)'; ctx.lineWidth = 1.2; ctx.stroke();

      // center hub
      ctx.fillStyle = '#04060e';
      ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = nc + '1)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.stroke();
    }

    // smooth easing loop (stops when canvas leaves the DOM)
    function loop() {
      if (!canvas.isConnected) { window.removeEventListener('resize', resize); return; }
      let diff = az - display;
      diff = ((diff + 540) % 360) - 180;          // shortest path
      display += diff * 0.25;
      if (Math.abs(diff) < 0.1) display = az;
      draw();
      requestAnimationFrame(loop);
    }

    function setAz(a, fire) {
      az = norm(a);
      if (fire !== false && onChange) onChange(assess(az));
    }

    // pointer interaction
    let dragging = false;
    function azFromEvent(e) {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX ?? (e.touches && e.touches[0].clientX)) - rect.left - rect.width / 2;
      const y = (e.clientY ?? (e.touches && e.touches[0].clientY)) - rect.top - rect.height / 2;
      return norm(Math.atan2(x, -y) * 180 / Math.PI);
    }
    function down(e) { dragging = true; setAz(azFromEvent(e)); e.preventDefault(); }
    function move(e) { if (dragging) { setAz(azFromEvent(e)); e.preventDefault(); } }
    function up() { dragging = false; }
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';

    requestAnimationFrame(loop);
    if (onChange) onChange(assess(az));

    return {
      get: () => az,
      set: (a) => setAz(a, true),
    };
  }

  return { assess, dirName, mount };
})();

if (typeof window !== 'undefined') window.RoofCompass = RoofCompass;
