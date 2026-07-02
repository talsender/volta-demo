// Pure transform: wizard inputs → render-ready sim state. No Three.js, no DOM.
// Axes: N=-z, S=+z, E=+x, W=-x. Azimuth deg: 0=N,90=E,180=S,270=W. Sun elev 60°.

// Obstacle types the agent can pick. Roof-mounted ones sit on the roof surface;
// the rest stand on the ground on the sun side.
const ROOF_MOUNTED = { equipment: true, antenna: true, chimney: true };

// Single source of truth for shading severity, derived from the picked obstacles.
// Keeps the wizard's existing none/partial/heavy eligibility behavior.
function deriveShadingSeverity(types) {
  const t = types || [];
  if (t.length === 0) return 'none';
  if (t.indexOf('building') !== -1 || t.length >= 3) return 'heavy';
  return 'partial';
}

// Back-compat: convert a legacy shading string into an equivalent obstacle list.
function obstaclesFromShading(shading) {
  if (shading === 'partial') return ['tree'];
  if (shading === 'heavy') return ['tree', 'tree', 'building'];
  return [];
}

function buildSimState(inputs, roofConfig) {
  const SUN_ELEV = 60;
  const materials = (inputs.materials || []).filter(m => (parseInt(m.size) || 0) > 0);
  const totalArea = materials.reduce((a, m) => a + (parseInt(m.size) || 0), 0);

  const parts = materials.map(m => {
    const def = (roofConfig.materials || []).find(x => x.id === m.id);
    const size = parseInt(m.size) || 0;
    return {
      id: m.id,
      label: def ? def.label : m.id,
      geometry: def && def.geometry ? def.geometry : 'flat',
      size,
      areaShare: totalArea > 0 ? size / totalArea : 0,
    };
  });

  // sun direction (unit vector pointing toward the sun)
  const azRad = ((inputs.azimuth || 0) % 360) * Math.PI / 180;
  const elevRad = SUN_ELEV * Math.PI / 180;
  const cosE = Math.cos(elevRad);
  const sun = {
    az: inputs.azimuth || 0,
    elev: SUN_ELEV,
    dir: {
      x: Math.sin(azRad) * cosE,
      y: Math.sin(elevRad),
      z: -Math.cos(azRad) * cosE,
    },
  };

  // Obstacles: explicit agent selection (inputs.obstacles), or a legacy shading
  // string converted to an equivalent list.
  const selected = Array.isArray(inputs.obstacles)
    ? inputs.obstacles
    : obstaclesFromShading(inputs.shading || 'none');
  const shadingSeverity = deriveShadingSeverity(selected);

  const obstacles = [];
  const dist = 9;
  let groundIdx = 0, roofIdx = 0;
  selected.forEach((type, i) => {
    if (ROOF_MOUNTED[type]) {
      // on the roof, spread around its center
      const side = roofIdx % 2 === 0 ? 1 : -1;
      const step = Math.floor(roofIdx / 2);
      obstacles.push({
        id: 'obs' + i, type, onRoof: true,
        x: side * (1.2 + step * 1.4),
        z: side * 1.2,
        height: 1.4,
      });
      roofIdx++;
    } else {
      // on the ground, on the sun side, fanned out laterally
      const mult = 1 + groundIdx * 0.06;
      const side = groundIdx % 2 === 0 ? 1 : -1;
      const lateral = side * (2 + Math.floor(groundIdx / 2) * 2.2);
      obstacles.push({
        id: 'obs' + i, type, onRoof: false,
        x: sun.dir.x * dist * mult + lateral,
        z: sun.dir.z * dist * mult,
        height: type === 'building' ? 8 : 3.5,
      });
      groundIdx++;
    }
  });

  // house footprint from total area (meters-ish), clamped to a pleasant scene size
  const footprint = Math.max(5, Math.min(18, Math.sqrt(totalArea || 25)));
  const stories = /^condo/.test(inputs.propertyType || '') ? 2 : 1;
  // orientation: which way the roof faces. Default azimuth 180 (south) → 0 rotation.
  const orientationRad = (180 - (inputs.azimuth || 180)) * Math.PI / 180;

  return { totalArea, parts, house: { footprint, stories, orientationRad }, sun, obstacles, shading: shadingSeverity };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Object.assign(module.exports || {}, { buildSimState, deriveShadingSeverity });
}
if (typeof window !== 'undefined') { window.deriveShadingSeverity = deriveShadingSeverity; }
