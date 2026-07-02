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
               cx: cx, cz: 0, w: w, d: depth, rotDeg: 0 };
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
               cx: s.cx, cz: s.cz, w: s.w, d: s.d, rotDeg: s.rotDeg || 0 })),
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

  return { buildLayout: buildLayout, layoutToSimState: layoutToSimState, alignToDoor: alignToDoor, segmentArea: segmentArea };
})();
if (typeof module !== 'undefined') module.exports = RoofLayout;
if (typeof window !== 'undefined') window.RoofLayout = RoofLayout;
