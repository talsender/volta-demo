// ============================================================
// Embedded coverage-territory outline of Israel (lon,lat), clockwise.
// Derived from the actual settlement coordinates (settlement-coords.js):
// per latitude band, the min/max longitude of served settlements + margin.
// This guarantees every settlement Volta serves — including Golan, Judea &
// Samaria and Gaza-envelope towns that fall outside any standard "Israel"
// border polygon — sits inside the silhouette. Offline; no network.
// Consumed by globe.js to draw the flat recon map + project settlements.
// ============================================================
const IsraelGeo = (() => {
  'use strict';
  const OUTLINE = [
    [35.18,33.31],[35.106,33.159],[35.03,33.078],[34.992,32.997],[34.95,32.916],
    [34.902,32.835],[34.875,32.754],[34.854,32.673],[34.834,32.592],[34.814,32.511],
    [34.791,32.43],[34.772,32.349],[34.747,32.268],[34.723,32.187],[34.687,32.107],
    [34.653,32.026],[34.621,31.945],[34.573,31.864],[34.52,31.783],[34.451,31.702],
    [34.412,31.621],[34.341,31.54],[34.278,31.459],[34.214,31.378],[34.196,31.297],
    [34.205,31.216],[34.221,31.135],[34.268,31.054],[34.306,30.973],[34.337,30.892],
    [34.362,30.811],[34.489,30.731],[34.623,30.65],[34.855,30.569],[34.98,30.488],
    [35.098,30.407],[35.048,30.326],[35.002,30.245],[34.956,30.164],[34.951,30.083],
    [34.945,30.002],[34.939,29.921],[34.935,29.84],[34.919,29.759],[34.902,29.678],
    [34.89,29.527],[35.055,29.527],[35.067,29.678],[35.093,29.759],[35.119,29.84],
    [35.154,29.921],[35.175,30.002],[35.189,30.083],[35.197,30.164],[35.206,30.245],
    [35.218,30.326],[35.227,30.407],[35.255,30.488],[35.293,30.569],[35.332,30.65],
    [35.353,30.731],[35.385,30.811],[35.411,30.892],[35.437,30.973],[35.433,31.054],
    [35.429,31.135],[35.379,31.216],[35.385,31.297],[35.397,31.378],[35.455,31.459],
    [35.461,31.54],[35.486,31.621],[35.512,31.702],[35.537,31.783],[35.536,31.864],
    [35.541,31.945],[35.561,32.026],[35.583,32.107],[35.598,32.187],[35.604,32.268],
    [35.611,32.349],[35.619,32.43],[35.64,32.511],[35.7,32.592],[35.781,32.673],
    [35.867,32.754],[35.914,32.835],[35.937,32.916],[35.925,32.997],[35.912,33.078],
    [35.896,33.159],[35.893,33.31],[35.18,33.31],
  ];
  const lons = OUTLINE.map(p => p[0]), lats = OUTLINE.map(p => p[1]);
  const BOUNDS = {
    minLon: Math.min(...lons), maxLon: Math.max(...lons),
    minLat: Math.min(...lats), maxLat: Math.max(...lats),
  };
  const midLat = (BOUNDS.minLat + BOUNDS.maxLat) / 2;
  const asp = Math.cos(midLat * Math.PI / 180);

  // Project lon/lat -> {x,y} pixels. view = {W,H,pad,zoom,panX,panY}.
  // Equirectangular with cos(midLat) aspect correction; fits BOUNDS into a
  // pad-inset W*H box (north up), then scales about center + pans.
  function project(lon, lat, view) {
    const { W, H, pad, zoom, panX, panY } = view;
    const lonSpan = (BOUNDS.maxLon - BOUNDS.minLon) * asp;
    const latSpan = BOUNDS.maxLat - BOUNDS.minLat;
    const bw = W - pad * 2, bh = H - pad * 2;
    const scale = Math.min(bw / lonSpan, bh / latSpan); // fit, keep aspect
    const drawW = lonSpan * scale, drawH = latSpan * scale;
    const ox = (W - drawW) / 2, oy = (H - drawH) / 2;
    let x = ox + ((lon - BOUNDS.minLon) * asp) * scale;
    let y = oy + (BOUNDS.maxLat - lat) * scale; // invert: north up
    const cx = W / 2, cy = H / 2;                // zoom about center
    x = cx + (x - cx) * zoom + panX;
    y = cy + (y - cy) * zoom + panY;
    return { x, y };
  }

  return { OUTLINE, BOUNDS, project };
})();
if (typeof module !== 'undefined') module.exports = IsraelGeo;
