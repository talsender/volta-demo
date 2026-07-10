// 2D top-down plan editor over a `layout`. SVG-based; pointer drag/resize/rotate.
// Mutates the layout in place and calls onChange(layout) after every edit.
const PlanEditor = (() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const COLORS = {
    concrete: '#5a96d2', tiles: '#c98b5a', spanish_tiles: '#c97b4a', pergola: '#caa64a',
    wood_pergola: '#b98a3a', alu_pergola: '#9fb0c0', light: '#9a6bd0', light_tile: '#b07bd0',
    corrugated: '#6fb7c9', onduline: '#6f9fc9', insulated: '#7fa6d6', membrane: '#6fc9a0',
    ground: '#8a9a5a', default: '#56a0c9',
  };
  // physical half-extents (meters at s=1) for plan icons + resize math
  const OB_HALF = { tree: 1.5, building: 2.25, equipment: 0.8, antenna: 0.6, chimney: 0.5 };
  const OB_ROOF = { equipment: 1, antenna: 1, chimney: 1 };

  function mount(svg, layout, opts) {
    opts = opts || {};
    let sel = null;     // {kind:'seg'|'obs', id}
    let drag = null;    // {mode, id, dx, dz}
    let snapOn = true;  // magnetic snapping (Alt bypasses while held)
    let guides = [];    // guide lines while snapping, cleared on release
    const view = { scale: 12, ox: 0, oy: 0 };

    function fit() {
      const r = svg.getBoundingClientRect();
      const span = Math.max(layout.house.width, layout.house.depth) * 1.8 + 6;
      view.scale = Math.max(6, Math.min(r.width || 300, r.height || 300) / span);
      view.ox = (r.width || 300) / 2; view.oy = (r.height || 300) / 2;
    }
    const mx = m => view.ox + m * view.scale;
    const my = m => view.oy + m * view.scale;
    const toM = (px, py) => ({ x: (px - view.ox) / view.scale, z: (py - view.oy) / view.scale });

    function el(tag, attrs) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
    function handle(px, py, role, id) {
      return el('rect', { x: px - 5, y: py - 5, width: 10, height: 10, rx: 2, fill: '#ffd16a',
        stroke: '#0a0d14', 'stroke-width': 0.5, 'data-handle': role, 'data-id': id || '' });
    }

    function render() {
      fit();
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const r = svg.getBoundingClientRect(); const W = r.width || 300, Hh = r.height || 300;
      // grid
      for (let gx = view.ox % view.scale; gx < W; gx += view.scale) svg.appendChild(el('line', { x1: gx, y1: 0, x2: gx, y2: Hh, stroke: '#56f7d6', 'stroke-opacity': 0.07 }));
      for (let gy = view.oy % view.scale; gy < Hh; gy += view.scale) svg.appendChild(el('line', { x1: 0, y1: gy, x2: W, y2: gy, stroke: '#56f7d6', 'stroke-opacity': 0.07 }));
      // compass
      const n = el('text', { x: 16, y: 22, fill: '#56f7d6', 'font-size': 12 }); n.textContent = 'N ↑'; svg.appendChild(n);
      // house rect + edge resize handles
      const H = layout.house;
      svg.appendChild(el('rect', { x: mx(-H.width / 2), y: my(-H.depth / 2), width: H.width * view.scale, height: H.depth * view.scale,
        fill: 'rgba(86,150,210,.06)', stroke: '#56f7d6', 'stroke-opacity': 0.5, 'data-house': 1 }));
      svg.appendChild(handle(mx(H.width / 2), my(0), 'house-w'));
      svg.appendChild(handle(mx(0), my(H.depth / 2), 'house-d'));
      // segments
      layout.segments.forEach(s => {
        const g = el('g', { transform: 'translate(' + mx(s.cx) + ',' + my(s.cz) + ') rotate(' + (s.rotDeg || 0) + ')' });
        const w = s.w * view.scale, d = s.d * view.scale;
        const isSel = sel && sel.kind === 'seg' && sel.id === s.id;
        const col = COLORS[s.materialId] || COLORS.default;
        g.appendChild(el('rect', { x: -w / 2, y: -d / 2, width: w, height: d, rx: 3, fill: col + '55', stroke: col,
          'stroke-width': isSel ? 2.5 : 1.5, 'data-seg': s.id }));
        const t = el('text', { x: 0, y: 4, 'text-anchor': 'middle', fill: '#dff0ff', 'font-size': 10, 'data-seg': s.id });
        t.textContent = (s.label || s.materialId) + ' · ' + Math.round(s.w * s.d) + 'מ"ר';
        g.appendChild(t);
        if (isSel) {
          g.appendChild(handle(w / 2, d / 2, 'resize', s.id));
          g.appendChild(handle(0, -d / 2 - 14, 'rotate', s.id));
          g.appendChild(el('line', { x1: 0, y1: -d / 2, x2: 0, y2: -d / 2 - 14, stroke: '#ffd16a', 'stroke-width': 1 }));
        }
        svg.appendChild(g);
      });
      drawDoor();
      // obstacles
      layout.obstacles.forEach(o => {
        const sc = o.s || 1;
        const halfPx = Math.max(6, (OB_HALF[o.type] || 1) * sc * view.scale);
        const isB = o.type === 'building';
        const node = isB
          ? el('rect', { x: mx(o.x) - halfPx, y: my(o.z) - halfPx, width: halfPx * 2, height: halfPx * 2, rx: 2,
              fill: '#ff5d6c', 'fill-opacity': 0.75, 'data-obs': o.id })
          : el('circle', { cx: mx(o.x), cy: my(o.z), r: halfPx,
              fill: o.onRoof ? '#ffd16a' : '#3df08a', 'fill-opacity': 0.75, 'data-obs': o.id });
        const isSel = sel && sel.kind === 'obs' && sel.id === o.id;
        if (isSel) { node.setAttribute('stroke', '#fff'); node.setAttribute('stroke-width', 2); }
        svg.appendChild(node);
        if (isSel) svg.appendChild(handle(mx(o.x) + halfPx + 6, my(o.z), 'resize-obs', o.id));
      });
      // snap guide lines (transient, while dragging)
      guides.forEach(g => {
        if (g.axis === 'x') svg.appendChild(el('line', { x1: mx(g.at), y1: 0, x2: mx(g.at), y2: Hh, stroke: '#56f7d6', 'stroke-dasharray': '4 3', 'stroke-opacity': 0.8 }));
        else svg.appendChild(el('line', { x1: 0, y1: my(g.at), x2: W, y2: my(g.at), stroke: '#56f7d6', 'stroke-dasharray': '4 3', 'stroke-opacity': 0.8 }));
      });
    }

    function drawDoor() {
      const H = layout.house, dr = H.door, u = (dr.t == null ? 0.5 : dr.t) - 0.5;
      let px, py;
      if (dr.side === 'S') { px = mx(u * H.width); py = my(H.depth / 2); }
      else if (dr.side === 'N') { px = mx(u * H.width); py = my(-H.depth / 2); }
      else if (dr.side === 'E') { px = mx(H.width / 2); py = my(u * H.depth); }
      else { px = mx(-H.width / 2); py = my(u * H.depth); }
      svg.appendChild(el('rect', { x: px - 9, y: py - 4, width: 18, height: 8, rx: 2, fill: '#ffb24a', 'data-door': 1 }));
      const lab = el('text', { x: px, y: py - 9, 'text-anchor': 'middle', fill: '#ffb24a', 'font-size': 10, 'data-door': 1 });
      lab.textContent = '🚪'; svg.appendChild(lab);
    }

    // ---- pointer interactions ----
    function off(e) { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function segById(id) { return layout.segments.find(s => s.id === id); }
    function obsById(id) { return layout.obstacles.find(o => o.id === id); }
    function select(kind, id) { sel = kind ? { kind: kind, id: id } : null; if (opts.onSelect) opts.onSelect(sel); }
    function emit() { if (opts.onChange) opts.onChange(layout); }
    function clamp01(v) { return Math.max(0, Math.min(1, v)); }

    function onDown(e) {
      const t = e.target, ds = t.dataset || {}, p = off(e), m = toM(p.x, p.y);
      if (ds.handle === 'resize-obs') { drag = { mode: 'resize-obs', id: ds.id }; select('obs', ds.id); }
      else if (ds.handle === 'resize') { drag = { mode: 'resize-seg', id: ds.id }; select('seg', ds.id); }
      else if (ds.handle === 'rotate') { drag = { mode: 'rotate-seg', id: ds.id }; select('seg', ds.id); }
      else if (ds.handle === 'house-w') { drag = { mode: 'resize-house-w' }; }
      else if (ds.handle === 'house-d') { drag = { mode: 'resize-house-d' }; }
      else if (ds.door) { drag = { mode: 'move-door' }; }
      else if (ds.seg) { const s = segById(ds.seg); drag = { mode: 'move-seg', id: ds.seg, dx: m.x - s.cx, dz: m.z - s.cz }; select('seg', ds.seg); }
      else if (ds.obs) { drag = { mode: 'move-obs', id: ds.obs }; select('obs', ds.obs); }
      else { drag = null; select(null); }
      if (drag) { try { svg.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); }
      render();
    }
    function onMove(e) {
      if (!drag) return;
      const p = off(e), m = toM(p.x, p.y), H = layout.house;
      if (drag.mode === 'move-seg') {
        const s = segById(drag.id);
        let cx = m.x - drag.dx, cz = m.z - drag.dz;
        guides = [];
        if (snapOn && !e.altKey && typeof RoofLayout !== 'undefined' && RoofLayout.snapMove) {
          const r = RoofLayout.snapMove(s, { cx: cx, cz: cz }, layout.segments, layout.house);
          cx = r.cx; cz = r.cz; guides = r.guides;
        }
        s.cx = cx; s.cz = cz;
      }
      else if (drag.mode === 'resize-seg') { const s = segById(drag.id); s.w = Math.max(0.5, Math.abs(m.x - s.cx) * 2); s.d = Math.max(0.5, Math.abs(m.z - s.cz) * 2); }
      else if (drag.mode === 'rotate-seg') { const s = segById(drag.id); s.rotDeg = Math.round(Math.atan2(m.x - s.cx, -(m.z - s.cz)) * 180 / Math.PI); }
      else if (drag.mode === 'resize-house-w') { H.width = Math.max(2, Math.abs(m.x) * 2); }
      else if (drag.mode === 'resize-house-d') { H.depth = Math.max(2, Math.abs(m.z) * 2); }
      else if (drag.mode === 'move-door') { snapDoor(m); }
      else if (drag.mode === 'move-obs') { const o = obsById(drag.id); o.x = m.x; o.z = m.z; }
      else if (drag.mode === 'resize-obs') {
        const o = obsById(drag.id); const base = OB_HALF[o.type] || 1;
        const dist = Math.hypot(m.x - o.x, m.z - o.z);
        o.s = Math.max(0.4, Math.min(3, Math.round((dist / base) * 10) / 10));
      }
      render(); emit();
    }
    function onUp(e) { if (drag) { try { svg.releasePointerCapture(e.pointerId); } catch (_) {} drag = null; guides = []; render(); emit(); } }

    function snapDoor(m) {
      const H = layout.house, dx = H.width / 2, dz = H.depth / 2;
      const cand = [
        ['E', Math.abs(m.x - dx), clamp01((m.z + dz) / H.depth)],
        ['W', Math.abs(m.x + dx), clamp01((m.z + dz) / H.depth)],
        ['S', Math.abs(m.z - dz), clamp01((m.x + dx) / H.width)],
        ['N', Math.abs(m.z + dz), clamp01((m.x + dx) / H.width)],
      ];
      cand.sort((a, b) => a[1] - b[1]);
      H.door = { side: cand[0][0], t: cand[0][2] };
    }

    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);

    let obsCounter = 0;
    function addObstacle(type) {
      const id = 'usr' + (obsCounter++);
      const onRoof = !!OB_ROOF[type];
      layout.obstacles.push({ id: id, type: type,
        x: onRoof ? 0 : 4, z: onRoof ? 0 : 4,       // roof items start on the house
        height: type === 'building' ? 9 : (onRoof ? 1.4 : 4),
        s: 1, onRoof: onRoof });
      select('obs', id); render(); emit();
    }
    function deleteSelected() {
      if (!sel || sel.kind !== 'obs') return;
      layout.obstacles = layout.obstacles.filter(o => o.id !== sel.id);
      select(null); render(); emit();
    }
    function setOrientation(deg) { layout.house.orientationDeg = deg; emit(); }

    render();
    return {
      render: render, selected: () => sel, addObstacle: addObstacle, deleteSelected: deleteSelected,
      setOrientation: setOrientation,
      setSnap: function (on) { snapOn = !!on; },
      getSnap: function () { return snapOn; },
      autoArrange: function () {
        if (typeof RoofLayout !== 'undefined' && RoofLayout.autoArrange) RoofLayout.autoArrange(layout);
        select(null); render(); emit();
      },
      destroy: function () { svg.removeEventListener('pointerdown', onDown); svg.removeEventListener('pointermove', onMove); svg.removeEventListener('pointerup', onUp); },
    };
  }
  return { mount: mount };
})();
if (typeof window !== 'undefined') window.PlanEditor = PlanEditor;
