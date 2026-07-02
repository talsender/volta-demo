// sim.js — VoltaSim: 3D house simulation (Three.js global build).
// Decoupled from the wizard: consumes a simState from buildSimState().
const VoltaSim = (() => {
  'use strict';

  function available() { return typeof THREE !== 'undefined'; }

  const MAT_COLOR = {
    flat: 0x49566b, pitched: 0xa8482b, pergola: 0x7a5a30,
    insulated: 0x6b7a92, corrugated: 0x7a8aa0, light: 0xff5d6c,
  };

  // ---- procedural textures (canvas → CanvasTexture), built once and cached ----
  const _texCache = {};
  function procTexture(key, w, h, draw, repeat) {
    if (_texCache[key]) return _texCache[key];
    if (typeof document === 'undefined' || typeof THREE === 'undefined') return null;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    const tex = new THREE.CanvasTexture(cv);
    if (repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(repeat[0], repeat[1]); }
    tex.anisotropy = 4;
    _texCache[key] = tex;
    return tex;
  }
  // PV module: dark-blue glass with a cell grid and a metal frame border.
  function pvTexture() {
    return procTexture('pv', 128, 128, (c, w, h) => {
      c.fillStyle = '#0e1c44'; c.fillRect(0, 0, w, h);
      const n = 4, pad = 10, cell = (w - pad * 2) / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const g = c.createLinearGradient(pad + i * cell, pad + j * cell, pad + (i + 1) * cell, pad + (j + 1) * cell);
        g.addColorStop(0, '#1c3f86'); g.addColorStop(1, '#13317a');
        c.fillStyle = g; c.fillRect(pad + i * cell + 1, pad + j * cell + 1, cell - 2, cell - 2);
      }
      c.strokeStyle = '#9fb6d8'; c.lineWidth = 6; c.strokeRect(3, 3, w - 6, h - 6); // frame
    });
  }
  // Terracotta tile rows.
  function tileTexture() {
    return procTexture('tile', 128, 128, (c, w, h) => {
      c.fillStyle = '#a8482b'; c.fillRect(0, 0, w, h);
      const rows = 6, rh = h / rows;
      for (let r = 0; r < rows; r++) {
        c.fillStyle = r % 2 ? '#b8542f' : '#9c4127';
        for (let x = -rh / 2; x < w; x += rh) {
          c.beginPath(); c.arc(x + (r % 2 ? rh / 2 : 0), r * rh + rh, rh * 0.6, Math.PI, 0); c.fill();
        }
        c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(0, r * rh); c.lineTo(w, r * rh); c.stroke();
      }
    }, [3, 3]);
  }
  // Subtle concrete speckle.
  function concreteTexture() {
    return procTexture('concrete', 128, 128, (c, w, h) => {
      c.fillStyle = '#566073'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 700; i++) {
        c.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.06})`;
        c.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
    }, [2, 2]);
  }
  // Wood grain (vertical streaks).
  function woodTexture() {
    return procTexture('wood', 64, 128, (c, w, h) => {
      c.fillStyle = '#7a5a30'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 26; i++) {
        c.strokeStyle = `rgba(${Math.random() > 0.5 ? '60,40,18' : '150,115,60'},0.4)`;
        c.lineWidth = 1 + Math.random();
        c.beginPath(); c.moveTo(Math.random() * w, 0); c.lineTo(Math.random() * w, h); c.stroke();
      }
    });
  }

  function mount(canvas, opts) {
    if (!available()) return null;
    opts = opts || {};
    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    camera.position.set(15, 13, 17);

    const ambient = new THREE.AmbientLight(0x6f8bb0, 1.5);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xfff3da, 2.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 120;
    sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
    scene.add(sun); scene.add(sun.target);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(44, 48),
      new THREE.MeshStandardMaterial({ color: 0x09121f, roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    scene.add(ground);
    const grid = new THREE.GridHelper(70, 35, 0x2f6d8b, 0x14304a);
    grid.material.opacity = 0.22; grid.material.transparent = true;
    scene.add(grid);

    let dynamic = new THREE.Group(); scene.add(dynamic);

    // Editor: overrides persist user-dragged positions across rebuilds;
    // draggables is rebuilt each update() (it references current meshes).
    const editor = { overrides: {}, draggables: [] };

    let controls = null, userMoved = false;
    if (opts.interactive && THREE.OrbitControls) {
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.target.set(0, 2.5, 0);
      controls.minDistance = 4; controls.maxDistance = 90;
      controls.maxPolarAngle = Math.PI * 0.49;
      controls.addEventListener('start', () => { userMoved = true; });
    } else {
      camera.lookAt(0, 2.5, 0);
    }

    // Frame the camera on the current house so it always fills the view.
    function frameContent() {
      const box = new THREE.Box3().setFromObject(dynamic);
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 6;
      const dist = maxDim * 1.7 + 5;
      camera.position.set(center.x + dist * 0.75, center.y + dist * 0.6, center.z + dist * 0.78);
      camera.far = dist * 8; camera.updateProjectionMatrix();
      if (controls) { controls.target.copy(center); controls.update(); }
      else camera.lookAt(center);
    }

    function resize() {
      const w = canvas.clientWidth || 300, h = canvas.clientHeight || 300;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    resize();
    const ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(canvas);

    let raf = 0, spin = 0, active = true;
    function loop() {
      if (!active) { raf = 0; return; }
      if (controls) controls.update();
      else { spin += 0.0032; camera.position.set(Math.sin(spin) * 22, 13, Math.cos(spin) * 22); camera.lookAt(0, 2.5, 0); }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    // Pause/resume the render loop (so a hidden mini-preview costs no GPU).
    function setActive(on) {
      if (on) { if (!active) { active = true; if (!raf) raf = requestAnimationFrame(loop); } }
      else { active = false; }
    }

    function clearDynamic() {
      scene.remove(dynamic);
      dynamic.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { Array.isArray(o.material) ? o.material.forEach(m => m.dispose()) : o.material.dispose(); }
      });
      dynamic = new THREE.Group(); scene.add(dynamic);
    }

    function update(simState) {
      clearHelper();
      clearDynamic();
      editor.draggables = []; // meshes are recreated below
      if (!simState) return;
      buildHouse(dynamic, simState, editor);
      buildObstacles(dynamic, simState, editor);
      const d = simState.sun.dir;
      sun.position.set(d.x * 40, Math.max(8, d.y * 40), d.z * 40);
      sun.target.position.set(0, 0, 0);
      sun.target.updateMatrixWorld();
      scene.updateMatrixWorld(true); // freshly-built meshes need world matrices NOW
                                     // (before BoxHelper / bbox framing / exposure)
      if (selKey) highlight(selKey); // re-bind selection box to the rebuilt object
      if (!userMoved) frameContent(); // keep the house framed until the user orbits
    }

    function recenter() { userMoved = false; frameContent(); }
    function resetLayout() { editor.overrides = {}; }

    // ---- editor: drag-to-move + click-to-select; shadows update live ----
    const raycaster = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPt = new THREE.Vector3();
    let dragging = null, downPt = null, moved = false;
    let selKey = null, selHelper = null;

    function pointerNdc(e) {
      const r = canvas.getBoundingClientRect();
      ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    }
    function findDraggable(o) { while (o) { if (o.userData && o.userData.drag) return o; o = o.parent; } return null; }

    function clearHelper() {
      if (selHelper) { scene.remove(selHelper); if (selHelper.geometry) selHelper.geometry.dispose(); selHelper = null; }
    }
    function highlight(key) { // (re)draw the selection box for an existing object
      clearHelper();
      const obj = key ? editor.draggables.find(d => d.userData.drag.key === key) : null;
      if (obj) { selHelper = new THREE.BoxHelper(obj, 0xffd16a); scene.add(selHelper); }
    }
    function setSelected(key) {
      selKey = key || null;
      highlight(selKey);
      if (opts.onSelect) opts.onSelect(selKey);
    }

    function onDown(e) {
      pointerNdc(e);
      raycaster.setFromCamera(ptr, camera);
      const hits = raycaster.intersectObjects(editor.draggables, true);
      moved = false; downPt = { x: e.clientX, y: e.clientY };
      if (hits.length) {
        dragging = findDraggable(hits[0].object);
        if (dragging) { if (controls) controls.enabled = false; canvas.style.cursor = 'grabbing'; e.preventDefault(); }
      } else {
        dragging = null;
        setSelected(null); // clicking empty space deselects
      }
    }
    function onMove(e) {
      if (!dragging) return;
      if (downPt && Math.hypot(e.clientX - downPt.x, e.clientY - downPt.y) > 3) moved = true;
      pointerNdc(e);
      raycaster.setFromCamera(ptr, camera);
      if (raycaster.ray.intersectPlane(dragPlane, hitPt)) {
        // convert the world ground point into the object's parent frame (house parts
        // live in a rotated group; obstacles live at world origin)
        const local = dragging.parent ? dragging.parent.worldToLocal(hitPt.clone()) : hitPt;
        const x = Math.max(-32, Math.min(32, local.x));
        const z = Math.max(-32, Math.min(32, local.z));
        dragging.position.x = x; dragging.position.z = z;
        editor.overrides[dragging.userData.drag.key] = { x: x, z: z };
        if (selHelper) selHelper.update();
      }
      e.preventDefault();
    }
    function onUp() {
      if (!dragging) return;
      const d = dragging; dragging = null;
      if (controls) controls.enabled = true;
      canvas.style.cursor = 'grab';
      if (moved) {
        if (opts.onDragEnd) opts.onDragEnd(d.userData.drag.key);
        if (opts.onChange) opts.onChange();
      } else {
        setSelected(d.userData.drag.key); // a click (no move) selects
      }
    }
    // 3D edit-drag handlers. Gated by opts.editable (default on) so a preview-only
    // mount (e.g. the 2D-plan editor, where the plan is the sole editor) can keep
    // orbit while disabling in-scene dragging.
    if (opts.editable !== false) {
      canvas.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove); // keep dragging off-canvas
      window.addEventListener('pointerup', onUp);
    }

    // ---- sun time + shading exposure (for the editor) ----
    function setSunTime(t01) {
      const S = (typeof window !== 'undefined') && window.Shading;
      const d = S ? S.sunDirAt(t01) : { x: 0, y: 1, z: 0.3 };
      sun.position.set(d.x * 40, Math.max(6, d.y * 40), d.z * 40);
      sun.target.position.set(0, 0, 0); sun.target.updateMatrixWorld();
    }

    function computeExposure() {
      const S = (typeof window !== 'undefined') && window.Shading;
      if (!S) return null;
      dynamic.updateMatrixWorld(true); // ensure world positions are current
      const panels = [], blockers = [];
      // only obstacles shade the panels (roof angle is captured by orientation-yield);
      // this keeps a clean roof at ~100% exposure, which is the headline number.
      dynamic.traverse(o => {
        if (!o.isMesh) return;
        if (o.userData.isPanel) panels.push(o);
        else if (o.userData.blocker) blockers.push(o);
      });
      if (!panels.length) return null;
      if (!blockers.length) return 100; // no obstacles → full sun on the panels
      const centers = panels.map(p => { const v = new THREE.Vector3(); p.getWorldPosition(v); v.y += 0.06; return v; });
      const rc = new THREE.Raycaster(); rc.far = 200;
      const dirV = new THREE.Vector3();
      const perStep = S.sunSteps(7).map(st => {
        dirV.set(st.dir.x, st.dir.y, st.dir.z).normalize();
        let lit = 0;
        centers.forEach(c => { rc.set(c, dirV); if (!rc.intersectObjects(blockers, false).length) lit++; });
        return { weight: st.weight, unshaded: lit / centers.length };
      });
      return S.exposurePct(perStep);
    }

    function dispose() {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      if (controls) controls.dispose();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      clearHelper();
      clearDynamic();
      renderer.dispose();
    }

    return {
      update: update, dispose: dispose, resize: resize, setActive: setActive,
      recenter: recenter, resetLayout: resetLayout,
      setSunTime: setSunTime, computeExposure: computeExposure, highlight: highlight,
      select: setSelected,
    };
  }

  // ---- geometry builders (module-private) ----
  // Register obj as draggable: apply any saved position override, tag it, and
  // add it to the editor's pick list. defaultX/Z used when no override exists.
  function applyDraggable(obj, key, editor, defaultX, defaultZ) {
    obj.userData.drag = { key: key };
    const ov = editor && editor.overrides[key];
    obj.position.set(ov ? ov.x : defaultX, 0, ov ? ov.z : defaultZ);
    if (editor) editor.draggables.push(obj);
  }

  function buildHouse(group, s, editor) {
    const H = s.house || {};
    // explicit dims (new layout) or legacy footprint (dock / old callers)
    const width = H.width != null ? H.width : (H.footprint || 8);
    const depth = H.depth != null ? H.depth : width * 0.7;
    const storyH = 3;
    const wallH = storyH * (H.stories || 1);

    // house + roof live in a rotatable group (orientation); obstacles stay world-fixed
    const houseGroup = new THREE.Group();
    houseGroup.rotation.y = H.orientationRad || 0;
    group.add(houseGroup);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x223247, roughness: 0.9, metalness: 0.05 });
    const walls = new THREE.Mesh(new THREE.BoxGeometry(width, wallH, depth), wallMat);
    walls.position.y = wallH / 2;
    walls.castShadow = true; walls.receiveShadow = true;
    houseGroup.add(walls);

    // entrance door on the named wall (visual anchor only)
    addDoor(houseGroup, H.door, width, depth);

    // roof segments: explicit placement (cx,cz,w,d,rotDeg) or legacy proportional row
    const parts = s.parts && s.parts.length ? s.parts : [{ geometry: 'flat', cx: 0, cz: 0, w: width, d: depth }];
    const explicit = parts[0] && parts[0].w != null;
    let rowX = -width / 2;
    parts.forEach(part => {
      const pw = part.w != null ? part.w : Math.max(0.5, width * (part.areaShare || (1 / parts.length)));
      const pd = part.d != null ? part.d : depth;
      const cx = part.cx != null ? part.cx : (rowX + pw / 2);
      const cz = part.cz != null ? part.cz : 0;
      if (!explicit) rowX += pw;
      const sub = new THREE.Group();
      sub.position.set(cx, 0, cz);
      sub.rotation.y = (part.rotDeg || 0) * Math.PI / 180;
      houseGroup.add(sub);
      makeRoofPart(sub, part.geometry, pw, pd, wallH);
    });
  }

  // door: a thin dark panel flush to a wall, ~1.1m wide. Visual orientation anchor.
  function addDoor(houseGroup, door, width, depth) {
    if (!door) return;
    const mat = new THREE.MeshStandardMaterial({ color: 0x0c1424, roughness: 0.7, metalness: 0.1 });
    const dw = 1.1, dh = 2.1, t = 0.12;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(dw, dh, t), mat);
    const u = (door.t == null ? 0.5 : door.t) - 0.5;  // -0.5..0.5 along the wall
    if (door.side === 'S') { mesh.position.set(u * width, dh / 2, depth / 2 + t / 2); }
    else if (door.side === 'N') { mesh.position.set(u * width, dh / 2, -depth / 2 - t / 2); }
    else if (door.side === 'E') { mesh.rotation.y = Math.PI / 2; mesh.position.set(width / 2 + t / 2, dh / 2, u * depth); }
    else { mesh.rotation.y = Math.PI / 2; mesh.position.set(-width / 2 - t / 2, dh / 2, u * depth); }
    mesh.castShadow = true; houseGroup.add(mesh);
  }

  // dispatch per material geometry — the sub-group is already placed/rotated, so
  // geometry is built centered at local origin (cx=0).
  function makeRoofPart(group, geometry, w, d, baseY) {
    if (geometry === 'pergola') return makePergola(group, 0, w, d, baseY);
    if (geometry === 'pitched') return makePitched(group, 0, w, d, baseY);
    if (geometry === 'corrugated') return makeCorrugated(group, 0, w, d, baseY);
    if (geometry === 'light') return makeSlab(group, 0, w, d, baseY, MAT_COLOR.light, false);
    // flat (concrete) and insulated → metallic slab with panels
    const metal = geometry === 'insulated' ? 0.55 : 0.15;
    return makeSlab(group, 0, w, d, baseY, MAT_COLOR[geometry] || MAT_COLOR.flat, true, metal);
  }

  function makeSlab(group, cx, w, depth, baseY, color, panels, metalness) {
    const t = 0.35;
    const ctex = concreteTexture();
    const mat = new THREE.MeshStandardMaterial({ color: color, map: ctex, roughness: 0.8, metalness: (metalness == null ? 0.1 : metalness) });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, t, depth), mat);
    slab.position.set(cx, baseY + t / 2, 0);
    slab.castShadow = true; slab.receiveShadow = true;
    group.add(slab);
    if (panels) { const g = panelGrid(w, depth); g.position.set(cx, baseY + t + 0.06, 0); group.add(g); }
  }

  // gabled tiled roof: two slopes meeting at a ridge running along z
  function makePitched(group, cx, w, depth, baseY) {
    const rh = Math.min(w, depth) * 0.42;            // ridge height
    const ang = Math.atan2(rh, w / 2);
    const slopeLen = Math.hypot(w / 2, rh);
    const mat = new THREE.MeshStandardMaterial({ color: MAT_COLOR.pitched, map: tileTexture(), roughness: 0.9, metalness: 0.02 });
    [-1, 1].forEach(sgn => {
      const slope = new THREE.Mesh(new THREE.BoxGeometry(slopeLen, 0.18, depth), mat);
      slope.position.set(cx + sgn * w / 4, baseY + rh / 2, 0);
      slope.rotation.z = -sgn * ang;
      slope.castShadow = true; slope.receiveShadow = true;
      group.add(slope);
      // panels lying on the slope
      const g = panelGrid(slopeLen * 0.86, depth * 0.86);
      g.rotation.z = -sgn * ang;
      g.position.set(cx + sgn * w / 4 - sgn * Math.sin(ang) * 0.12, baseY + rh / 2 + Math.cos(ang) * 0.14, 0);
      group.add(g);
    });
    // gable end triangles (thin) for a closed look
    const triShape = new THREE.Shape();
    triShape.moveTo(-w / 2, 0); triShape.lineTo(w / 2, 0); triShape.lineTo(0, rh); triShape.closePath();
    const tri = new THREE.Mesh(new THREE.ExtrudeGeometry(triShape, { depth: 0.1, bevelEnabled: false }),
      new THREE.MeshStandardMaterial({ color: 0x2a2440, roughness: 1 }));
    tri.position.set(cx, baseY, -depth / 2); tri.castShadow = true; group.add(tri);
    const tri2 = tri.clone(); tri2.position.set(cx, baseY, depth / 2); group.add(tri2);
  }

  // open pergola: corner posts + perimeter beams + slats (alt. PV slats)
  function makePergola(group, cx, w, depth, baseY) {
    const wood = new THREE.MeshStandardMaterial({ color: MAT_COLOR.pergola, map: woodTexture(), roughness: 0.9 });
    const top = baseY + 0.4;
    const post = (px, pz) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.4, 0.18), wood);
      p.position.set(px, baseY + 0.2, pz); p.castShadow = true; group.add(p);
    };
    post(cx - w / 2 + 0.2, -depth / 2 + 0.2); post(cx + w / 2 - 0.2, -depth / 2 + 0.2);
    post(cx - w / 2 + 0.2, depth / 2 - 0.2); post(cx + w / 2 - 0.2, depth / 2 - 0.2);
    // two beams along z
    [-1, 1].forEach(sgn => {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, depth), wood);
      beam.position.set(cx + sgn * (w / 2 - 0.2), top, 0); beam.castShadow = true; group.add(beam);
    });
    // slats across x; every other slat is a PV slat
    const pv = new THREE.MeshStandardMaterial({ color: 0xffffff, map: pvTexture(), emissive: 0x0c1c44, emissiveIntensity: 0.35, roughness: 0.35, metalness: 0.6 });
    const n = Math.max(4, Math.round(depth / 0.7));
    for (let i = 0; i < n; i++) {
      const z = -depth / 2 + 0.3 + (depth - 0.6) * (i / (n - 1));
      const slat = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, 0.07, 0.22), i % 2 ? pv : wood);
      slat.position.set(cx, top + 0.05, z); slat.castShadow = true;
      if (i % 2) slat.userData.isPanel = true;
      group.add(slat);
    }
  }

  // corrugated metal sheet: thin base + ribs running along z
  function makeCorrugated(group, cx, w, depth, baseY) {
    const mat = new THREE.MeshStandardMaterial({ color: MAT_COLOR.corrugated, roughness: 0.5, metalness: 0.7 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, depth), mat);
    base.position.set(cx, baseY + 0.06, 0); base.castShadow = true; base.receiveShadow = true; group.add(base);
    const ribs = Math.max(4, Math.round(w / 0.5));
    for (let i = 0; i < ribs; i++) {
      const rx = cx - w / 2 + (w) * ((i + 0.5) / ribs);
      const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, depth, 6), mat);
      rib.rotation.x = Math.PI / 2;
      rib.position.set(rx, baseY + 0.16, 0); rib.castShadow = true; group.add(rib);
    }
    const g = panelGrid(w * 0.7, depth * 0.7); g.position.set(cx, baseY + 0.24, 0); group.add(g);
  }

  // a flat grid of PV panels centered at origin in the xz-plane (y=0)
  function panelGrid(w, depth) {
    const grp = new THREE.Group();
    const cols = Math.max(1, Math.round(w / 1.1));
    const rows = Math.max(1, Math.round(depth / 1.4));
    const pw = (w * 0.9) / cols, pd = (depth * 0.9) / rows;
    const tex = pvTexture();
    // top face textured (cells + frame); sides darker. BoxGeometry material order:
    // [+x,-x,+y,-y,+z,-z] → index 2 is the top.
    const side = new THREE.MeshStandardMaterial({ color: 0x223152, roughness: 0.5, metalness: 0.5 });
    const topMat = new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, emissive: 0x0c1c44, emissiveIntensity: 0.35, roughness: 0.3, metalness: 0.5 });
    const mats = [side, side, topMat, side, side, side];
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(pw * 0.9, 0.08, pd * 0.9), tex ? mats : side);
        panel.position.set(-w * 0.45 + pw * (i + 0.5), 0, -depth * 0.45 + pd * (j + 0.5));
        panel.castShadow = true; panel.userData.isPanel = true;
        grp.add(panel);
      }
    }
    return grp;
  }

  function buildObstacles(group, s, editor) {
    const roofY = 3 * ((s.house && s.house.stories) || 1) + 0.5; // top of the walls
    s.obstacles.forEach((o, i) => {
      const g = new THREE.Group();              // dragged in x/z
      const inner = new THREE.Group();          // lifted to roof height for roof-mounted items
      inner.position.y = o.onRoof ? roofY : 0;
      g.add(inner);
      const h = o.height || (o.type === 'building' ? 8 : 3.5);
      switch (o.type) {
        case 'tree':      buildTree(inner, h); break;
        case 'building':  buildNeighbor(inner, h); break;
        case 'equipment': buildEquipment(inner); break;
        case 'antenna':   buildAntenna(inner); break;
        case 'chimney':   buildChimney(inner); break;
        default:          buildNeighbor(inner, h);
      }
      g.userData.obstacle = true;
      g.traverse(o2 => { if (o2.isMesh) o2.userData.blocker = true; }); // shade source
      group.add(g);
      applyDraggable(g, o.id || ('obstacle-' + i), editor, o.x, o.z);
    });
  }

  function buildTree(g, h) {
    const trunkH = h * 0.34, crownR = Math.max(1, h * 0.5);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, trunkH, 8),
      new THREE.MeshStandardMaterial({ color: 0x4a3320, map: woodTexture(), roughness: 1 }));
    trunk.position.set(0, trunkH / 2, 0); trunk.castShadow = true; g.add(trunk);
    // two stacked blobs for a fuller canopy
    [[crownR, 0.7], [crownR * 0.75, 1.25]].forEach(([r, f]) => {
      const crown = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0x276b38, roughness: 1 }));
      crown.position.set(0, trunkH + crownR * f, 0); crown.castShadow = true; g.add(crown);
    });
  }

  function buildNeighbor(g, h) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.5, h, 4.5),
      new THREE.MeshStandardMaterial({ color: 0x3b4658, map: concreteTexture(), roughness: 0.85 }));
    body.position.set(0, h / 2, 0); body.castShadow = true; body.receiveShadow = true; g.add(body);
    // lit windows on the wall facing the house (−z), a few rows/cols
    const winMat = new THREE.MeshStandardMaterial({ color: 0xbfd0e6, emissive: 0x32465f, emissiveIntensity: 0.6, roughness: 0.4 });
    const rows = Math.max(2, Math.round(h / 2.2));
    for (let r = 0; r < rows; r++) for (let cI = -1; cI <= 1; cI++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.08), winMat);
      win.position.set(cI * 1.3, 1.2 + r * 2.0, -4.5 / 2 - 0.02); g.add(win);
    }
  }

  function buildEquipment(g) {
    const metal = new THREE.MeshStandardMaterial({ color: 0xcdd6e0, roughness: 0.4, metalness: 0.7 });
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.5, 14), metal);
    tank.rotation.z = Math.PI / 2; tank.position.set(0, 0.75, -0.35); tank.castShadow = true; g.add(tank);
    [-0.55, 0.55].forEach(x => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.5), metal);
      leg.position.set(x, 0.25, -0.35); g.add(leg);
    });
    // tilted flat-plate collector in front of the tank
    const coll = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.9),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: pvTexture(), roughness: 0.5, metalness: 0.3 }));
    coll.position.set(0, 0.45, 0.55); coll.rotation.x = -0.5; coll.castShadow = true; g.add(coll);
  }

  function buildAntenna(g) {
    const metal = new THREE.MeshStandardMaterial({ color: 0xaab4c2, roughness: 0.4, metalness: 0.6 });
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.2, 8), metal);
    mast.position.set(0, 1.1, 0); mast.castShadow = true; g.add(mast);
    // dish: a flattened, tilted hemisphere
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }));
    dish.scale.set(1, 0.45, 1); dish.position.set(0, 1.7, 0.15); dish.rotation.x = -1.1; dish.castShadow = true; g.add(dish);
  }

  function buildChimney(g) {
    const brick = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x8a5648, map: concreteTexture(), roughness: 0.95 }));
    brick.position.set(0, 0.8, 0); brick.castShadow = true; g.add(brick);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.16, 0.74),
      new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.8 }));
    cap.position.set(0, 1.62, 0); g.add(cap);
  }

  return { available: available, mount: mount };
})();

if (typeof window !== 'undefined') window.VoltaSim = VoltaSim;
