const CONFIG = {
  SHEET_CSV_URL: '', // unused in the demo; settlement data is embedded (synthetic)
  ROOF_SIZE_GOOD: 70,
  ROOF_SIZE_BORDERLINE: 60,
  ROOF_AGE_WARNING: 25,
  AUTH_MODE: 'legacy',

  // Demo Firebase project — paste values from FIREBASE-SETUP.md.
  // Never use the real production project here.
  FIREBASE_CONFIG: {
    apiKey: 'AIzaSyD9YvLoZVkNRv6Ze5rxlWJhRR4MfMUnTsw',
    authDomain: 'volta-demo-92912.firebaseapp.com',
    projectId: 'volta-demo-92912',
    storageBucket: 'volta-demo-92912.firebasestorage.app',
    messagingSenderId: '696332545009',
    appId: '1:696332545009:web:e6d94176056ad112d1f250',
  },
};

// Single source of truth for roof eligibility. Drives the wizard offline.
const DEFAULT_ROOF_CONFIG = {
  totalSizeThresholds: { good: 70, borderline: 60 }, // m², vs sum of all materials
  tilesAgeWarning: 25,                               // years
  // Disposable demo bootstrap password (used to create the first manager).
  managerPassword: '123654yk',

  materials: [
    {
      id: 'concrete', label: 'בטון שטוח', emoji: '🟫',
      baseFlagClass: 'ok', baseAction: null, geometry: 'flat',
      messages: { flagMsg: '', escalateNote: '', stopReason: '', stopScript: '' },
      sizeRules: [{ upTo: null, outcome: 'ok', message: '' }],
    },
    {
      id: 'tiles', label: 'רעפים', emoji: '🔺',
      baseFlagClass: 'ok', baseAction: 'tiles-age', geometry: 'pitched',
      messages: { flagMsg: '', escalateNote: '', stopReason: '', stopScript: '' },
      sizeRules: [{ upTo: null, outcome: 'ok', message: '' }],
    },
    {
      id: 'pergola', label: 'פרגולה סולארית', emoji: '☀️',
      baseFlagClass: 'ok', baseAction: 'flag', geometry: 'pergola',
      messages: { flagMsg: 'פרגולה סולארית — פאנלים מיוחדים, המומחה יאשר את הסוג', escalateNote: '', stopReason: '', stopScript: '' },
      sizeRules: [{ upTo: null, outcome: 'ok', message: '' }],
    },
    {
      id: 'insulated', label: 'פאנל מבודד', emoji: '🔧',
      baseFlagClass: 'warn', baseAction: 'escalate', geometry: 'insulated',
      messages: { flagMsg: '', escalateNote: 'פאנל מבודד — נדרש אישור מנהל. יש מקרים שהושלמו בהצלחה.', stopReason: '', stopScript: '' },
      sizeRules: [{ upTo: null, outcome: 'ok', message: '' }],
    },
    {
      id: 'corrugated', label: 'איסכורית', emoji: '🏗',
      baseFlagClass: 'warn', baseAction: 'flag', geometry: 'corrugated',
      messages: { flagMsg: 'איסכורית — נדרש אישור קונסטרוקטור לחוזק הגג. המומחה יבדוק.', escalateNote: '', stopReason: '', stopScript: '' },
      sizeRules: [{ upTo: null, outcome: 'ok', message: '' }],
    },
    {
      id: 'spanish_tiles', label: 'רעף ספרדי', emoji: '🧱',
      baseFlagClass: 'warn', baseAction: 'flag', geometry: 'pitched',
      messages: { flagMsg: 'רעף ספרדי — נדרשת התאמת מחוך/הברגה מיוחדת. ציין למומחה שמדובר ברעף ספרדי.', escalateNote: '', stopReason: '', stopScript: '' },
      sizeRules: [{ upTo: null, outcome: 'ok', message: '' }],
    },
    {
      id: 'light_tile', label: 'רב-רעף / רעף פלסטיק', emoji: '🟧',
      baseFlagClass: 'warn', baseAction: 'flag', geometry: 'corrugated',
      messages: { flagMsg: 'רב-רעף/פלסטיק — חומר קל, לא רעף אמיתי. נדרש קונסטרוקטור / קיבוע לקונסטרוקציה הנושאת.', escalateNote: '', stopReason: '', stopScript: '' },
      sizeRules: [{ upTo: null, outcome: 'ok', message: '' }],
    },
    {
      id: 'onduline', label: 'אונדולין / ביטומן גלי', emoji: '〰️',
      baseFlagClass: 'warn', baseAction: 'flag', geometry: 'corrugated',
      messages: { flagMsg: 'אונדולין — חומר קל (~6.5 ק"ג/מ"ר). נדרשת בדיקת קונסטרוקטור; מתחברים למבנה הנושא שמתחת.', escalateNote: '', stopReason: '', stopScript: '' },
      sizeRules: [{ upTo: null, outcome: 'ok', message: '' }],
    },
    {
      id: 'polycarbonate', label: 'סנטף / פוליקרבונט (שקוף)', emoji: '🔆',
      baseFlagClass: 'warn', baseAction: 'escalate', geometry: 'corrugated',
      messages: { flagMsg: '', escalateNote: 'גג שקוף/קל שאינו נושא עומס — התקנה רק על קונסטרוקציה נושאת. נדרש אישור מנהל.', stopReason: '', stopScript: '' },
      sizeRules: [{ upTo: null, outcome: 'ok', message: '' }],
    },
    {
      id: 'wood_pergola', label: 'פרגולת עץ', emoji: '🪵',
      baseFlagClass: 'warn', baseAction: 'flag', geometry: 'pergola',
      messages: { flagMsg: 'פרגולת עץ — נדרש אישור קונסטרוקטור לחוזק ולעיגון. בקש תמונות + תוכנית.', escalateNote: '', stopReason: '', stopScript: '' },
      sizeRules: [{ upTo: null, outcome: 'ok', message: '' }],
    },
    {
      id: 'alu_pergola', label: 'פרגולת אלומיניום', emoji: '⬜',
      baseFlagClass: 'warn', baseAction: 'flag', geometry: 'pergola',
      messages: { flagMsg: 'פרגולת אלומיניום — לרוב דורשת חיזוק. להתייעץ עם קונסטרוקטור.', escalateNote: '', stopReason: '', stopScript: '' },
      sizeRules: [{ upTo: null, outcome: 'ok', message: '' }],
    },
    {
      id: 'membrane', label: 'יריעות איטום / EPDM', emoji: '🩹',
      baseFlagClass: 'warn', baseAction: 'flag', geometry: 'flat',
      messages: { flagMsg: 'יריעות איטום/EPDM — מתחברים למבנה הנושא שמתחת ליריעה (לא ליריעה). זהירות באיטום, נדרשת בדיקה.', escalateNote: '', stopReason: '', stopScript: '' },
      sizeRules: [{ upTo: null, outcome: 'ok', message: '' }],
    },
    {
      id: 'ground', label: 'התקנה על הקרקע / עמודים', emoji: '🌍',
      baseFlagClass: 'warn', baseAction: 'escalate', geometry: 'flat',
      messages: { flagMsg: '', escalateNote: 'התקנה על הקרקע — נדרש תכנון קונסטרוקטיבי (עמוד נעוץ עד ~10מ\', מעבר לכך יסוד בטון). אישור מנהל.', stopReason: '', stopScript: '' },
      sizeRules: [{ upTo: null, outcome: 'ok', message: '' }],
    },
    {
      id: 'asbestos', label: 'אסבסט / חשד לאסבסט', emoji: '☣️',
      baseFlagClass: 'bad', baseAction: 'stop', geometry: 'light',
      messages: { flagMsg: '', escalateNote: '', stopReason: 'אסבסט — אסור להתקין לפני טיפול/הסרה מקצועית', stopScript: 'לא ניתן להתקין על גג אסבסט. נדרש טיפול מקצועי של האסבסט תחילה — מטעמי בטיחות.' },
      sizeRules: [{ upTo: null, outcome: 'ok', message: '' }],
    },
    {
      id: 'light', label: 'בנייה קלה', emoji: '❌',
      baseFlagClass: 'bad', baseAction: 'stop', geometry: 'light',
      messages: { flagMsg: '', escalateNote: '', stopReason: 'בנייה קלה — לא מתאים להתקנה', stopScript: 'לצערנו לא מתקינים על גגות בנייה קלה. תודה על הפנייה!' },
      sizeRules: [{ upTo: null, outcome: 'ok', message: '' }],
    },
  ],
};

// Node export (for tests); harmless in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Object.assign(module.exports || {}, { CONFIG, DEFAULT_ROOF_CONFIG });
}
