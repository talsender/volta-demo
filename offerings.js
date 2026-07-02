// Pure matching of selected roof materials → relevant commercial offerings.
const Offerings = (() => {
  'use strict';
  function catalog(injected) {
    if (injected) return injected;
    return (typeof window !== 'undefined' && window.VOLTA_OFFERINGS) || [];
  }
  function getAll() { return catalog().slice(); }
  function matchForRoof(materialIds, totalSize, injected) {
    const ids = materialIds || [];
    const size = parseInt(totalSize) || 0;
    const out = [];
    for (const o of catalog(injected)) {
      const applies = o.appliesTo === 'all' || ids.some(id => o.appliesTo.indexOf(id) !== -1);
      if (!applies) continue;
      const eligible = o.minArea == null || size >= o.minArea;
      const reason = eligible ? '' : `נדרש מינימום ${o.minArea} מ"ר (נבחר ${size})`;
      out.push(Object.assign({}, o, { eligible, reason }));
    }
    return out;
  }
  return { getAll, matchForRoof };
})();
if (typeof module !== 'undefined') module.exports = Offerings;
