// Mockup helper: (1) apply ?theme / ?furigana from the query string so the gallery can
// flip a screen by reloading its iframe; (2) inject a small stroke-icon sprite (24-grid,
// Feather-style) so every screen references <svg class="ic"><use href="#i-NAME"></use></svg>
// without repeating paths — and we avoid emoji-glyph rendering in screenshots.
(function () {
  var q = new URLSearchParams(location.search);
  document.documentElement.setAttribute('data-theme', q.get('theme') === 'dark' ? 'dark' : 'light');
  if (q.get('furigana') === 'off') document.documentElement.setAttribute('data-furigana', 'off');

  var I = {
    'i-play': 'M7 5l12 7-12 7z',
    'i-pause': 'M9 5v14M15 5v14',
    'i-mic': 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z M5 11a7 7 0 0 0 14 0 M12 18v3 M8 21h8',
    'i-gear': 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1A2 2 0 1 1 7 3.3l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1H22a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z',
    'i-cloud': 'M18 10h-1.3A7 7 0 1 0 4 16h14a4 4 0 0 0 0-8z',
    'i-theme': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 3v18',
    'i-plus': 'M12 5v14M5 12h14',
    'i-check': 'M5 12l5 5L20 6',
    'i-refresh': 'M21 12a9 9 0 1 1-3-6.7L21 8 M21 3v5h-5',
    'i-pencil': 'M4 20h4L19 9l-4-4L4 16v4z M14 6l4 4',
    'i-star': 'M12 4l2.5 5.1 5.6.8-4 4 1 5.6-5.1-2.7-5 2.7 1-5.6-4.1-4 5.6-.8z',
    'i-search': 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M21 21l-4.3-4.3',
    'i-external': 'M14 4h6v6 M20 4l-9 9 M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5',
    'i-headphones': 'M4 14a8 8 0 0 1 16 0 M4 14v3a2 2 0 0 0 2 2h1v-7H6a2 2 0 0 0-2 2z M20 14v3a2 2 0 0 1-2 2h-1v-7h1a2 2 0 0 1 2 2z',
    'i-book': 'M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z M18 17H6',
    'i-cards': 'M8 3h11a1 1 0 0 1 1 1v11 M4 8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z',
    'i-music': 'M9 18V6l11-2v12 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    'i-repeat': 'M17 2l4 4-4 4 M3 11V9a4 4 0 0 1 4-4h14 M7 22l-4-4 4-4 M21 13v2a4 4 0 0 1-4 4H3',
    'i-eye': 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    'i-eyeoff': 'M3 3l18 18 M10.6 10.6a3 3 0 0 0 4.2 4.2 M9.9 5.1A9 9 0 0 1 12 5c6 0 10 7 10 7a18 18 0 0 1-3 3.6 M6.1 6.1A18 18 0 0 0 2 12s4 7 10 7a9 9 0 0 0 3-.5',
    'i-alert': 'M12 4l9 16H3z M12 10v4 M12 17h.01',
    'i-arrow': 'M5 12h14 M13 6l6 6-6 6',
    'i-chevron': 'M6 9l6 6 6-6',
    'i-grid': 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
    'i-chart': 'M4 20V10 M10 20V4 M16 20v-7 M3 20h18',
    'i-scissors': 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M20 4L8.1 15.9 M14.5 14.5L20 20 M8.2 8.2l3.8 3.8',
    'i-clock': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2',
    'i-upload': 'M12 16V4 M7 9l5-5 5 5 M5 20h14',
    'i-tag': 'M3 11l8-8 9 9-8 8z M7.5 7.5h.01',
    'i-back': 'M19 12H5 M11 6l-6 6 6 6',
    'i-sliders': 'M4 8h10 M18 8h2 M4 16h2 M10 16h10 M14 6v4 M6 14v4'
  };
  var ns = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
  Object.keys(I).forEach(function (id) {
    var sym = document.createElementNS(ns, 'symbol');
    sym.setAttribute('id', id);
    sym.setAttribute('viewBox', '0 0 24 24');
    var p = document.createElementNS(ns, 'path');
    p.setAttribute('d', I[id]);
    sym.appendChild(p);
    svg.appendChild(sym);
  });
  document.body.insertBefore(svg, document.body.firstChild);

  // Expose full content height on <html data-h> so the screenshot driver can size the
  // window to the page (headless captures the viewport, not the full page).
  document.documentElement.setAttribute('data-h', String(document.body.scrollHeight + 6));
})();
