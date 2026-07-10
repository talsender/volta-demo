// Pure house/roof layout model. Source of truth the 2D plan edits and the 3D renders.
const RoofLayout = (() => {
  'use strict';
  const DOOR_ORIENT = { S: 180, N: 0, E: 270, W: 90 };

  function getBSS() {
    if (typeof buildSimState !== 'undefined') return buildSimState;             // browser global
    if (typeof require !== 'undefined') return require('./sim-state.js').buildSimState; // node
    return null;
  }
  function deriveShading(obstacles) {
    const t = (obstacles || []).map(o => o.type);
    if (t.length === 0) return 'none';
    if (t.indexOf('building') !== -1 || t.length >= 3) return 'heavy';
    return 'partial';
  }

  const PERGOLA_H = 2.5, STORY_H = 3;
  // Per-segment level. h:null = auto (pergola 2.5m, else stories*3); number = manual.
  function segmentHeight(seg, house) {
    if (seg && typeof seg.h === 'number') return seg.h;
    if (seg && seg.geometry === 'pergola') return PERGOLA_H;
    return STORY_H * ((house && house.stories) || 1);
  }

  function buildLayout(inputs, roofConfig) {
    const bss = getBSS();
    const base = bss ? bss(inputs, roofConfig)
                     : { parts: [], house: { footprint: 8, stories: 1 }, obstacles: [] };
    // square footprint so each segment's plan area (w*d) equals its real m²
    // (footprint = sqrt(totalArea); a row of segments tiling the square gives
    // area = areaShare * totalArea = the size the rep entered).
    const width = base.house.footprint;
    const depth = width;
    const parts = base.parts.length ? base.parts : [{ id: '_', label: '', geometry: 'flat', areaShare: 1 }];
    let x = -width / 2;
    const segments = parts.map(p => {
      const w = Math.max(0.5, width * (p.areaShare || (1 / parts.length)));
      const cx = x + w / 2; x += w;
      return { id: 'seg-' + p.id, materialId: p.id, label: p.label, geometry: p.geometry,
               cx: cx, cz: 0, w: w, d: depth, rotDeg: 0, h: null };
    });
    return {
      house: { width: width, depth: depth, stories: base.house.stories,
               orientationDeg: inputs.azimuth || 180, door: { side: 'S', t: 0.5 } },
      segments: segments,
      obstacles: base.obstacles.map(o => Object.assign({}, o)),
    };
  }

  function layoutToSimState(layout) {
    const h = layout.house;
    return {
      house: { width: h.width, depth: h.depth, stories: h.stories,
               orientationRad: (180 - (h.orientationDeg || 180)) * Math.PI / 180, door: h.door },
      parts: layout.segments.map(s => ({ id: s.id, label: s.label, geometry: s.geometry,
               cx: s.cx, cz: s.cz, w: s.w, d: s.d, rotDeg: s.rotDeg || 0,
               h: segmentHeight(s, layout.house) })),
      // sun is immediately overridden by sim.setSunTime(t) in the editor; placeholder here.
      sun: { az: h.orientationDeg || 180, elev: 60, dir: { x: 0, y: 1, z: 0 } },
      obstacles: layout.obstacles.map(o => Object.assign({}, o)),
      shading: deriveShading(layout.obstacles),
    };
  }

  function alignToDoor(layout) {
    const s = layout.house.door.side;
    return DOOR_ORIENT[s] != null ? DOOR_ORIENT[s] : 180;
  }
  function segmentArea(seg) { return (seg.w || 0) * (seg.d || 0); }

  const SNAP_M = 0.4;
  // Effective axis-aligned half-extents under rotation; free angles have no
  // well-defined edges, so only center snapping applies to them.
  function halfExtents(seg) {
    const r = (((seg.rotDeg || 0) % 360) + 360) % 360;
    if (r % 180 === 0) return { hx: seg.w / 2, hz: seg.d / 2, edges: true };
    if (r % 90 === 0) return { hx: seg.d / 2, hz: seg.w / 2, edges: true };
    return { hx: 0, hz: 0, edges: false };
  }
  // Magnetic snapping for a dragged segment. Priority: edge-to-edge, then
  // center alignment, then the house reference frame. Axes are independent.
  function snapMove(seg, proposed, segments, house) {
    const me = halfExtents(seg);
    const gEdgeX = [], gEdgeZ = [], gCenterX = [], gCenterZ = [], gFrameX = [], gFrameZ = [];
    (segments || []).forEach(o => {
      if (o.id === seg.id) return;
      const oe = halfExtents(o);
      if (me.edges && oe.edges) {
        gEdgeX.push({ pos: o.cx - oe.hx - me.hx, at: o.cx - oe.hx });
        gEdgeX.push({ pos: o.cx + oe.hx + me.hx, at: o.cx + oe.hx });
        gEdgeZ.push({ pos: o.cz - oe.hz - me.hz, at: o.cz - oe.hz });
        gEdgeZ.push({ pos: o.cz + oe.hz + me.hz, at: o.cz + oe.hz });
      }
      gCenterX.push({ pos: o.cx, at: o.cx });
      gCenterZ.push({ pos: o.cz, at: o.cz });
    });
    if (house && me.edges) {
      const hw = (house.width || 0) / 2, hd = (house.depth || 0) / 2;
      gFrameX.push({ pos: -hw + me.hx, at: -hw }, { pos: hw - me.hx, at: hw });
      gFrameZ.push({ pos: -hd + me.hz, at: -hd }, { pos: hd - me.hz, at: hd });
    }
    function pick(prop, groups) {
      for (let gi = 0; gi < groups.length; gi++) {
        let best = null;
        groups[gi].forEach(c => {
          const dlt = Math.abs(c.pos - prop);
          if (dlt <= SNAP_M && (!best || dlt < best.dlt)) best = { pos: c.pos, at: c.at, dlt: dlt };
        });
        if (best) return best;
      }
      return null;
    }
    const guides = [];
    let cx = proposed.cx, cz = proposed.cz;
    const bx = pick(proposed.cx, [gEdgeX, gCenterX, gFrameX]);
    if (bx) { cx = bx.pos; guides.push({ axis: 'x', at: bx.at }); }
    const bz = pick(proposed.cz, [gEdgeZ, gCenterZ, gFrameZ]);
    if (bz) { cz = bz.pos; guides.push({ axis: 'z', at: bz.at }); }
    return { cx: cx, cz: cz, guides: guides };
  }

  // One-click tidy: tile all segments in a touching, centered row. Keeps sizes,
  // heights and materials; only placement changes. Obstacles stay put.
  function autoArrange(layout) {
    const segs = (layout && layout.segments) || [];
    if (!segs.length) return layout;
    const total = segs.reduce((a, s) => a + (s.w || 0), 0);
    let x = -total / 2;
    segs.forEach(s => { s.rotDeg = 0; s.cz = 0; s.cx = x + s.w / 2; x += s.w; });
    if (layout.house && total > (layout.house.width || 0)) layout.house.width = total;
    return layout;
  }

  return { buildLayout: buildLayout, layoutToSimState: layoutToSimState, alignToDoor: alignToDoor, segmentArea: segmentArea, segmentHeight: segmentHeight, snapMove: snapMove, autoArrange: autoArrange };
})();
if (typeof module !== 'undefined') module.exports = RoofLayout;
if (typeof window !== 'undefined') window.RoofLayout = RoofLayout;
