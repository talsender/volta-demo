const test = require('node:test');
const assert = require('node:assert');
const RoofLayout = require('../roof-layout.js');

const cfg = { materials: [
  { id: 'concrete', label: 'בטון', geometry: 'flat' },
  { id: 'pergola', label: 'פרגולה', geometry: 'pergola' },
], totalSizeThresholds: { good: 70, borderline: 60 } };
const inputs = { materials: [{ id: 'concrete', size: 60 }, { id: 'pergola', size: 20 }], azimuth: 180, propertyType: 'private', obstacles: [] };

test('buildLayout: one segment per material, positive house dims, default door', () => {
  const L = RoofLayout.buildLayout(inputs, cfg);
  assert.strictEqual(L.segments.length, 2);
  assert.ok(L.house.width > 0 && L.house.depth > 0);
  assert.strictEqual(L.house.stories, 1);
  assert.deepStrictEqual(L.house.door, { side: 'S', t: 0.5 });
  const seg = L.segments.find(s => s.materialId === 'concrete');
  assert.strictEqual(seg.geometry, 'flat');
  assert.ok(seg.w > 0 && seg.d > 0);
});

test('layoutToSimState: maps segments to parts with placement, keeps obstacles', () => {
  const L = RoofLayout.buildLayout(inputs, cfg);
  L.obstacles = [{ id: 'o1', type: 'tree', x: 5, z: 5, height: 4, onRoof: false }];
  const s = RoofLayout.layoutToSimState(L);
  assert.strictEqual(s.parts.length, 2);
  const p = s.parts[0];
  ['id','geometry','cx','cz','w','d','rotDeg'].forEach(k => assert.ok(k in p, 'missing ' + k));
  assert.strictEqual(s.obstacles.length, 1);
  assert.ok(typeof s.house.orientationRad === 'number');
});

test('alignToDoor: N and S differ by 180', () => {
  const L = RoofLayout.buildLayout(inputs, cfg);
  L.house.door.side = 'S'; const sDeg = RoofLayout.alignToDoor(L);
  L.house.door.side = 'N'; const nDeg = RoofLayout.alignToDoor(L);
  assert.strictEqual(sDeg, 180);
  assert.strictEqual(nDeg, 0);
});

test('segmentArea = w*d', () => {
  assert.strictEqual(RoofLayout.segmentArea({ w: 6, d: 5 }), 30);
});

test('segmentHeight: pergola 2.5, others stories*3, manual override wins', () => {
  const house2 = { stories: 2 };
  assert.strictEqual(RoofLayout.segmentHeight({ geometry: 'pergola', h: null }, house2), 2.5);
  assert.strictEqual(RoofLayout.segmentHeight({ geometry: 'flat', h: null }, house2), 6);
  assert.strictEqual(RoofLayout.segmentHeight({ geometry: 'pitched', h: null }, { stories: 1 }), 3);
  assert.strictEqual(RoofLayout.segmentHeight({ geometry: 'pergola', h: 4 }, house2), 4);
  assert.strictEqual(RoofLayout.segmentHeight({ geometry: 'flat', h: 2.5 }, house2), 2.5);
});

test('buildLayout segments start with h:null; layoutToSimState resolves numeric h', () => {
  const L = RoofLayout.buildLayout(inputs, cfg);
  L.segments.forEach(s => assert.strictEqual(s.h, null));
  const st = RoofLayout.layoutToSimState(L);
  const perg = st.parts.find(p => p.geometry === 'pergola');
  const flat = st.parts.find(p => p.geometry === 'flat');
  assert.strictEqual(perg.h, 2.5);
  assert.strictEqual(flat.h, 3);
});

test('snapMove: edge-to-edge snap within threshold, exact touch', () => {
  const a = { id: 'a', cx: 0, cz: 0, w: 6, d: 8, rotDeg: 0 };
  const b = { id: 'b', cx: 99, cz: 0, w: 4, d: 8, rotDeg: 0 };
  // proposed left edge of b near right edge of a (a right=3; touch cx=5): propose 5.3
  const r = RoofLayout.snapMove(b, { cx: 5.3, cz: 0.2 }, [a, b], { width: 30, depth: 30 });
  assert.strictEqual(r.cx, 5);                       // 3 + 4/2
  assert.strictEqual(r.cz, 0);                       // center align with a
  assert.ok(r.guides.some(g => g.axis === 'x' && g.at === 3));
});

test('snapMove: no snap outside threshold', () => {
  const a = { id: 'a', cx: 0, cz: 0, w: 6, d: 8, rotDeg: 0 };
  const b = { id: 'b', cx: 99, cz: 0, w: 4, d: 8, rotDeg: 0 };
  const r = RoofLayout.snapMove(b, { cx: 6, cz: 3 }, [a, b], { width: 300, depth: 300 });
  assert.strictEqual(r.cx, 6);
  assert.strictEqual(r.cz, 3);
  assert.strictEqual(r.guides.length, 0);
});

test('snapMove: 90° rotated target uses swapped extents', () => {
  const a = { id: 'a', cx: 0, cz: 0, w: 6, d: 2, rotDeg: 90 }; // effective hx=1
  const b = { id: 'b', cx: 99, cz: 0, w: 4, d: 8, rotDeg: 0 };
  const r = RoofLayout.snapMove(b, { cx: 3.2, cz: 0 }, [a, b], { width: 300, depth: 300 });
  assert.strictEqual(r.cx, 3); // 1 + 2
});

test('snapMove: free-angle drag snaps centers only', () => {
  const a = { id: 'a', cx: 0, cz: 0, w: 6, d: 8, rotDeg: 0 };
  const b = { id: 'b', cx: 99, cz: 0, w: 4, d: 8, rotDeg: 33 };
  const r = RoofLayout.snapMove(b, { cx: 0.3, cz: 5 }, [a, b], { width: 300, depth: 300 });
  assert.strictEqual(r.cx, 0); // center align
  assert.strictEqual(r.cz, 5); // no edge snap available
});

test('autoArrange: touching centered row, keeps w/d/h, resets rot/cz', () => {
  const L = {
    house: { width: 5, depth: 10, stories: 1 },
    segments: [
      { id: 's1', w: 6, d: 8, h: 4, cx: 20, cz: 7, rotDeg: 45 },
      { id: 's2', w: 4, d: 8, h: null, cx: -9, cz: -3, rotDeg: 10 },
    ],
    obstacles: [{ id: 'o1', x: 5, z: 5 }],
  };
  RoofLayout.autoArrange(L);
  assert.strictEqual(L.segments[0].cx, -2);  // total 10 → row [-5..5]
  assert.strictEqual(L.segments[1].cx, 3);
  L.segments.forEach(s => { assert.strictEqual(s.cz, 0); assert.strictEqual(s.rotDeg, 0); });
  assert.strictEqual(L.segments[0].h, 4);
  assert.strictEqual(L.house.width, 10);     // widened to fit
  assert.strictEqual(L.obstacles[0].x, 5);   // untouched
});

test('stories change updates auto heights but not manual ones', () => {
  const L = RoofLayout.buildLayout(inputs, cfg);
  const perg = L.segments.find(s => s.geometry === 'pergola');
  perg.h = 4; // manual
  L.house.stories = 2;
  const st = RoofLayout.layoutToSimState(L);
  assert.strictEqual(st.parts.find(p => p.geometry === 'flat').h, 6);   // auto follows stories
  assert.strictEqual(st.parts.find(p => p.geometry === 'pergola').h, 4); // manual sticks
});
