// ============================================================
// VOLTA RECON MAP — flat tactical map of Israel + HUD telemetry
// Pure-canvas. Shows company coverage (install / no-install / check) at rest,
// flies to a settlement's real location on search, and fires a solar
// "installed" burst on a passing roof-wizard outcome.
// Decorative only; does not touch app state. Public API: window.VoltaGlobe.
// ============================================================
(() => {
  'use strict';

  // ---- status palette (alpha appended at draw time) ----------
  const STATUS_COL = {
    yes:     'rgba(61,240,138,',
    no:      'rgba(255,93,108,',
    check:   'rgba(255,178,74,',
    unknown: 'rgba(150,180,215,',
  };
  const CYAN = 'rgba(86,247,214,';
  const GOLD = 'rgba(255,209,106,';

  // ---- Hebrew name normalization ----
  // Unifies the settlement CSV names with the (separately sourced) coord keys.
  // Key fix: collapse ktiv male/haser (יי→י, וו→ו) so "קרית ים" (CSV) matches
  // "קריית ים" (coords). Run on BOTH sides (names and re-indexed coord keys).
  const HEB_FINAL = { 'ך':'כ','ם':'מ','ן':'נ','ף':'פ','ץ':'צ' };
  function normName(s) {
    if (!s) return '';
    return String(s).trim()
      .replace(/[)(\]\[]/g, ' ')
      .replace(/['"`׳״]/g, '')
      .replace(/[־\-–—]/g, '')
      .replace(/[ךםןףץ]/g, c => HEB_FINAL[c])
      .replace(/\s+/g, '')
      .replace(/יי/g, 'י')
      .replace(/וו/g, 'ו');
  }

  // Re-key a raw {name: [lat,lon]} coord map under the current normName, so a
  // lookup with the unified normalization hits keys stored in older spelling.
  function reindexCoords(rawCoords) {
    const idx = {};
    if (!rawCoords) return idx;
    for (const k in rawCoords) idx[normName(k)] = rawCoords[k];
    return idx;
  }

  // ---- pure: merge settlements with coords into drawable sites ----
  function buildSites(all, coords, statusClassFn) {
    if (!all || !coords) return [];
    const out = [];
    for (const s of all) {
      const ll = coords[normName(s.name)];
      if (!ll) continue;
      out.push({
        name: s.name,
        cls: statusClassFn(s.status),
        lat: ll[0], lon: ll[1],
        installCount: s.installCount || 0,
      });
    }
    return out;
  }

  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  // ============================================================
  function initGlobe() {
    const canvas = document.getElementById('globe');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0;

    const elHud   = document.getElementById('target-hud');
    const elName  = document.getElementById('th-name');
    const elCap   = document.getElementById('globe-caption');
    const elNodes = document.getElementById('r-nodes');
    const elStage = canvas.closest('.globe-stage');

    // ---- site layer (lazily (re)built when settlement data lands) ----
    // coordIndex: SETTLEMENT_COORDS re-keyed under normName, shared by the map
    // dots and the search fly-to so both place settlements identically.
    let coordIndex = reindexCoords((typeof window !== 'undefined' && window.SETTLEMENT_COORDS) || {});
    let sites = [];
    let _siteSig = -1;
    function ensureSites() {
      const all = (typeof Settlements !== 'undefined' && Settlements.getAll)
        ? Settlements.getAll() : [];
      if (all.length === _siteSig) return;
      _siteSig = all.length;
      coordIndex = reindexCoords((typeof window !== 'undefined' && window.SETTLEMENT_COORDS) || {});
      const sc = (typeof Settlements !== 'undefined' && Settlements.statusClass) || (() => 'unknown');
      sites = buildSites(all, coordIndex, sc);
      if (elNodes && sites.length) elNodes.textContent = sites.length.toLocaleString();
      buildCoverageCache();
    }

    // ---- camera + interaction state ----
    let target = null;   // { name, status, t, pt:{lon,lat} }
    let deploy = null;   // { t, pt:{lon,lat} }
    let viewZoom = 1, panX = 0, panY = 0;

    const PAD = () => Math.max(10, W * 0.06);

    // ---- offscreen coverage cache (clipped green glow inside Israel) ----
    // Rebuilt only when size or sites change; blitted each frame with the
    // camera transform, so we never regenerate hundreds of gradients per frame.
    let cov = null;
    function buildCoverageCache() {
      if (!W || !H || !sites.length) { cov = null; return; }
      cov = document.createElement('canvas');
      cov.width = W * dpr; cov.height = H * dpr;
      const c = cov.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const v = { W, H, pad: PAD(), zoom: 1, panX: 0, panY: 0 };
      c.beginPath();
      IsraelGeo.OUTLINE.forEach((pt, i) => {
        const p = IsraelGeo.project(pt[0], pt[1], v);
        i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y);
      });
      c.closePath();
      c.clip();
      for (const s of sites) {
        if (s.cls !== 'yes') continue;
        const p = IsraelGeo.project(s.lon, s.lat, v);
        const r = 9 + Math.min(13, s.installCount * 2.5);
        const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, 'rgba(61,240,138,0.055)');
        g.addColorStop(1, 'rgba(61,240,138,0)');
        c.fillStyle = g;
        c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill();
      }
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      W = Math.max(1, rect.width); H = Math.max(1, rect.height);
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildCoverageCache();
    }
    resize();
    window.addEventListener('resize', resize);
    const view = () => ({ W, H, pad: PAD(), zoom: viewZoom, panX, panY });
    const P = (lon, lat) => IsraelGeo.project(lon, lat, view());

    // center-of-Israel fallback point
    const centerPt = (() => {
      const B = IsraelGeo.BOUNDS;
      return { lon: (B.minLon + B.maxLon) / 2, lat: (B.minLat + B.maxLat) / 2 };
    })();

    // ---- draw helpers ----------------------------------------
    function drawHalo() {
      const cx = W / 2, cy = H * 0.42, r = Math.max(W, H) * 0.7;
      const g = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
      g.addColorStop(0, 'rgba(70,180,220,0.10)');
      g.addColorStop(0.6, 'rgba(60,150,210,0.04)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    function drawGrid() {
      ctx.strokeStyle = CYAN + '0.07)'; ctx.lineWidth = 1;
      for (let gy = H * 0.15; gy < H; gy += H * 0.18) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      }
      for (let gx = W * 0.22; gx < W; gx += W * 0.26) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
      }
    }
    function drawCoverage() {
      if (!cov) return;
      const cx = W / 2, cy = H / 2;
      // fade the coverage wash as we zoom into a settlement, so the focused
      // area, its dots and the reticle read clearly instead of a green smear.
      const fade = 1 - Math.min(1, (viewZoom - 1) / 1.0) * 0.6;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(panX, panY);
      ctx.translate(cx, cy); ctx.scale(viewZoom, viewZoom); ctx.translate(-cx, -cy);
      ctx.drawImage(cov, 0, 0, W, H);
      ctx.restore();
    }
    function drawOutline() {
      ctx.beginPath();
      IsraelGeo.OUTLINE.forEach((c, i) => {
        const p = P(c[0], c[1]);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fillStyle = CYAN + '0.05)'; ctx.fill();
      ctx.strokeStyle = CYAN + '0.85)'; ctx.lineWidth = 1.6;
      ctx.shadowColor = CYAN + '0.6)'; ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    function drawSweep(now) {
      const t = (now / 1800) % 1;
      const y = (H * 0.1) + t * (H * 0.8);
      ctx.strokeStyle = CYAN + '0.16)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    function drawSites(now) {
      const lockNorm = target && target.name ? normName(target.name) : null;
      // pass 1: dark contrast halos, so every city reads as a crisp point
      // even over the green coverage tint
      ctx.fillStyle = 'rgba(3,8,16,0.55)';
      for (const s of sites) {
        if (lockNorm && normName(s.name) === lockNorm) continue;
        const p = P(s.lon, s.lat);
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2); ctx.fill();
      }
      // pass 2: bright status-colored cores
      for (const s of sites) {
        if (lockNorm && normName(s.name) === lockNorm) continue; // drawn by reticle
        const p = P(s.lon, s.lat);
        const col = STATUS_COL[s.cls] || STATUS_COL.unknown;
        ctx.fillStyle = col + '0.95)';
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    function drawLockedDot(p, col, now) {
      const pulse = (Math.sin(now / 400) + 1) / 2;
      // dark backing so a green marker still reads on green coverage
      ctx.fillStyle = 'rgba(4,10,18,0.85)';
      ctx.beginPath(); ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2); ctx.fill();
      // white core ringed in the status color
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = col + '1)'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = col + '1)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = col + (0.6 * (1 - pulse)).toFixed(3) + ')'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 4 + pulse * 9, 0, Math.PI * 2); ctx.stroke();
    }
    function drawReticle(p, tg, now) {
      const col = STATUS_COL[tg.status] || STATUS_COL.unknown;
      const prog = Math.min(1, tg.t / 0.7);
      const e = easeOut(prog);
      const ringR = (Math.max(W, H) * 0.4) * (1 - e) + 22 * e; // contracts onto site
      const rot = tg.t * 1.4;
      ctx.save();
      ctx.translate(p.x, p.y);

      // spotlight vignette: darkens just around the focus so the status-colored
      // reticle always reads, even over bright green coverage.
      const vr = ringR + 34;
      const vg = ctx.createRadialGradient(0, 0, 0, 0, 0, vr);
      vg.addColorStop(0, 'rgba(4,10,18,0.55)');
      vg.addColorStop(0.7, 'rgba(4,10,18,0.22)');
      vg.addColorStop(1, 'rgba(4,10,18,0)');
      ctx.fillStyle = vg;
      ctx.beginPath(); ctx.arc(0, 0, vr, 0, Math.PI * 2); ctx.fill();

      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 3; // contrast on bright fills

      ctx.strokeStyle = col + '0.95)'; ctx.lineWidth = 1.6;
      for (let i = 0; i < 4; i++) {
        ctx.save(); ctx.rotate(rot + i * Math.PI / 2);
        ctx.beginPath(); ctx.arc(0, 0, ringR, -0.32, 0.32); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ringR, 0); ctx.lineTo(ringR + 5, 0); ctx.stroke();
        ctx.restore();
      }
      const reach = ringR + 12, gap = 7;
      ctx.strokeStyle = col + '0.5)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gap, 0); ctx.lineTo(reach, 0); ctx.moveTo(-gap, 0); ctx.lineTo(-reach, 0);
      ctx.moveTo(0, gap); ctx.lineTo(0, reach); ctx.moveTo(0, -gap); ctx.lineTo(0, -reach);
      ctx.stroke();

      if (prog >= 1) {
        const pp = (tg.t * 0.8) % 1;
        ctx.strokeStyle = col + (0.4 * (1 - pp)).toFixed(3) + ')'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(0, 0, 22 + pp * 26, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
      drawLockedDot(p, col, now);
    }
    // solar "installed" burst
    function drawBurst(p, t) {
      const life = Math.min(1, t / 2.4);
      ctx.save();
      ctx.translate(p.x, p.y);
      // gold sun rays scaling out + fading
      const rayScale = 0.3 + life * 1.3;
      ctx.strokeStyle = GOLD + (1 - life).toFixed(3) + ')';
      ctx.lineWidth = 2; ctx.lineCap = 'round';
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 10 * rayScale, Math.sin(a) * 10 * rayScale);
        ctx.lineTo(Math.cos(a) * 18 * rayScale, Math.sin(a) * 18 * rayScale);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      // green shock ring
      const rr = 6 + life * 30;
      ctx.strokeStyle = STATUS_COL.yes + (0.9 * (1 - life)).toFixed(3) + ')';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2); ctx.stroke();
      // pulsing gold core
      const core = 3.5 + Math.sin(t * 6) * 1.2;
      ctx.fillStyle = 'rgba(255,233,168,1)';
      ctx.shadowColor = GOLD + '0.9)'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(0, 0, core, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
      if (t > 3) deploy = null;
    }

    // ---- main loop -------------------------------------------
    let last = performance.now();
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      ensureSites();
      ctx.clearRect(0, 0, W, H);

      // camera ease toward a located target, or back to full-Israel at rest
      // (a search with no known coordinate keeps the full-map view).
      viewZoom += (((target && target.pt) ? 2.0 : 1) - viewZoom) * Math.min(1, dt * 2.4);
      let desPanX = 0, desPanY = 0;
      if (target && target.pt) {
        const p0 = IsraelGeo.project(target.pt.lon, target.pt.lat,
          { W, H, pad: PAD(), zoom: viewZoom, panX: 0, panY: 0 });
        desPanX = W / 2 - p0.x;
        desPanY = H / 2 - p0.y;
      }
      panX += (desPanX - panX) * Math.min(1, dt * 2.4);
      panY += (desPanY - panY) * Math.min(1, dt * 2.4);
      if (target) target.t += dt;
      if (deploy) deploy.t += dt;

      drawHalo();
      drawGrid();
      drawCoverage();
      drawOutline();
      drawSweep(now);
      drawSites(now);
      if (target && target.pt) drawReticle(P(target.pt.lon, target.pt.lat), target, now);
      if (deploy && deploy.pt) drawBurst(P(deploy.pt.lon, deploy.pt.lat), deploy.t);

      requestAnimationFrame(frame);
    }

    // ---- public API ------------------------------------------
    // Returns the real {lon,lat} for a settlement, or null when we have no
    // coordinate for it (don't fake a center position — that misleads the rep).
    function ptForName(name) {
      const ll = coordIndex[normName(name)];
      return ll ? { lon: ll[1], lat: ll[0] } : null;
    }
    window.VoltaGlobe = {
      lockTarget(name, status) {
        const pt = ptForName(name);
        target = { name: name || '', status: status || 'unknown', t: 0, pt };
        if (elHud) { elHud.classList.add('active'); elHud.dataset.status = target.status; }
        if (elName) elName.textContent = name || '—';
        if (elCap) elCap.textContent = pt ? 'TARGET LOCK · ISR SECTOR'
                                          : 'LOCATION UNAVAILABLE · ISR SECTOR';
      },
      release() {
        target = null;
        if (!deploy && elCap) elCap.textContent = 'COVERAGE SCAN · ISR SECTOR';
        if (elHud) elHud.classList.remove('active');
      },
      deploy() {
        deploy = { t: 0, pt: (target && target.pt) ? target.pt : { lon: centerPt.lon, lat: centerPt.lat } };
        if (elCap) elCap.textContent = 'INSTALL CONFIRMED · UPLINK OK';
        if (elStage) {
          elStage.classList.remove('deploy-flash');
          void elStage.offsetWidth;
          elStage.classList.add('deploy-flash');
          const r = elStage.getBoundingClientRect();
          if (r.bottom < 80 || r.top > window.innerHeight - 80) {
            elStage.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      },
    };

    requestAnimationFrame(frame);
  }

  // ---- Starfield (background) --------------------------------
  function initStars() {
    const c = document.getElementById('starfield');
    if (!c) return;
    const ctx = c.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let stars = [];
    function resize() {
      c.width = window.innerWidth * dpr; c.height = window.innerHeight * dpr;
      c.style.width = window.innerWidth + 'px'; c.style.height = window.innerHeight + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round((window.innerWidth * window.innerHeight) / 9000);
      stars = Array.from({ length: n }, () => ({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: Math.random() * 1.2 + 0.2,
        tw: Math.random() * Math.PI * 2,
        sp: Math.random() * 1.5 + 0.4,
      }));
    }
    resize();
    window.addEventListener('resize', resize);
    function frame(now) {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const s of stars) {
        const a = 0.25 + (Math.sin(now / 1000 * s.sp + s.tw) + 1) / 2 * 0.6;
        ctx.fillStyle = 'rgba(180,220,255,' + a.toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ---- HUD telemetry ----------------------------------------
  function initHud() {
    const timeEl = document.getElementById('sys-time');
    const seqEl = document.getElementById('foot-seq');
    const fluxEl = document.getElementById('r-flux');
    let seq = 0;
    setInterval(() => {
      if (timeEl) {
        const d = new Date();
        timeEl.textContent = d.toISOString().substr(11, 8);
      }
      if (seqEl) {
        seq = (seq + 7 + Math.floor(Math.random() * 5)) & 0xffff;
        seqEl.textContent = 'SEQ 0x' + seq.toString(16).toUpperCase().padStart(4, '0');
      }
      if (fluxEl) {
        const f = 1361 + Math.round((Math.random() - 0.5) * 6);
        fluxEl.textContent = f + ' W/m²';
      }
    }, 1000);
  }

  function boot() { initStars(); initGlobe(); initHud(); }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else { boot(); }
  }

  if (typeof module !== 'undefined') module.exports = { buildSites, normName, reindexCoords };
})();
