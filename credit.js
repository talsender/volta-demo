// ============================================================
// AUTHORSHIP SIGNATURE — prints a styled credit to DevTools.
// Designed & engineered by Tal Sender.
// ============================================================
(function () {
  'use strict';

  const banner = [
    '',
    '  ╦  ╦╔═╗╦  ╔╦╗╔═╗',
    '  ╚╗╔╝║ ║║   ║ ╠═╣   ORBITAL SOLAR DEPLOYMENT GRID',
    '   ╚╝ ╚═╝╩═╝ ╩ ╩ ╩',
    '',
  ].join('\n');

  const titleCss =
    'color:#6ff8e7;font:700 13px/1.4 "JetBrains Mono",monospace;' +
    'text-shadow:0 0 10px rgba(54,230,212,.55);';
  const lineCss = 'color:#90a8cc;font:400 12px "JetBrains Mono",monospace;';
  const nameCss =
    'color:#021015;background:linear-gradient(90deg,#6ff8e7,#36e6d4);' +
    'font:700 12px "JetBrains Mono",monospace;padding:2px 8px;border-radius:4px;';
  const tagCss = 'color:#ffd16a;font:600 12px "JetBrains Mono",monospace;';

  try {
    console.log('%c' + banner, titleCss);
    console.log(
      '%cDesigned & engineered by  %c TAL SENDER %c',
      lineCss, nameCss, lineCss
    );
    console.log('%c© ' + new Date().getFullYear() + ' · built with precision.', tagCss);
  } catch (e) { /* console unavailable — ignore */ }
})();
