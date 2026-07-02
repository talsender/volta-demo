// Demo offerings — synthetic sample catalogue for demonstration only.
// Embedded (no network). Consumed by offerings.js + app.js.
// price.unit: 'total' (₪ for whole system) | 'perSqm' (₪ per מ"ר).
window.VOLTA_OFFERINGS = [
  {
    id: 'system-traditional', name: 'מערכת בבעלות — פאנלים סטנדרטיים', emoji: '🔋',
    category: 'system', appliesTo: ['concrete','tiles','spanish_tiles','ground'],
    minArea: 70, price: { min: 50000, max: 90000, unit: 'total' }, roi: '6-8 שנים',
    financing: 'purchase',
    highlights: ['פאנלים סטנדרטיים על בטון / רעפים', 'שטח 60-69 מ"ר — גבולי, לאישור מומחה'],
    note: 'מערכת בבעלות הלקוח. שטח מומלץ 70 מ"ר ומעלה. (נתוני דמו)',
  },
  {
    id: 'system-apollo', name: 'מערכת בבעלות — פאנלים גמישים', emoji: '🧩',
    category: 'system',
    appliesTo: ['light','corrugated','onduline','membrane','polycarbonate','insulated','light_tile'],
    minArea: null, price: { min: 90000, max: 130000, unit: 'total' }, roi: null,
    financing: 'purchase',
    highlights: ['פאנלים גמישים לבנייה קלה', 'למשטחים שאינם בטון/רעפים', 'מפחית סיכון נזילות'],
    note: 'מתאים כשהמשטח אינו נושא פאנל סטנדרטי. (נתוני דמו)',
  },
  {
    id: 'leasing', name: 'ליסינג — השכרת גג', emoji: '🤝',
    category: 'leasing', appliesTo: 'all',
    minArea: 100, price: null, roi: null, financing: 'leasing',
    highlights: ['מענק ראשוני לדוגמה', 'תשואה שנתית משוערת', 'חוזה ל-25 שנה',
                 'אפשרות רכישת המערכת בהמשך'],
    note: 'השכרת גג הבית. שטח מינימלי לליסינג — 100 מ"ר. (נתוני דמו)',
  },
  {
    id: 'pergola-unikit', name: 'פרגולה סולארית — הקמה חדשה', emoji: '☀️',
    category: 'pergola', appliesTo: ['pergola','wood_pergola','alu_pergola'],
    minArea: 40, price: null, roi: null, financing: 'purchase',
    highlights: ['הקמת פרגולה עצמאית — מינימום 40 מ"ר',
                 'פרגולה כחלק מגג — נספרת לשטח הכולל (מינ׳ גג 60 מ"ר)',
                 'מעל 50 מ"ר — נדרש היתר עירייה'],
    note: 'אין טווח מחירים קבוע — לפי תכנון. (נתוני דמו)',
  },
  {
    id: 'pergola-build', name: 'הקמת פרגולה (בנייה)', emoji: '🏗',
    category: 'pergola', appliesTo: ['pergola','wood_pergola','alu_pergola'],
    minArea: null, price: { min: 600, max: 900, unit: 'perSqm' }, roi: null,
    financing: 'purchase',
    highlights: ['מחיר הבנייה נפרד ממחיר המערכת'],
    note: 'עלות בניית הפרגולה עצמה. (נתוני דמו)',
  },
];
if (typeof module !== 'undefined') module.exports = window.VOLTA_OFFERINGS;
