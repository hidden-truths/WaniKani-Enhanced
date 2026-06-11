// App "chrome" (shell): tab navigation, the Japanese-font switcher, and the light/dark
// theme toggle. All three are thin DOM wiring with their own localStorage keys (font/theme
// are device-ish, not synced).

// TAB NAV — show one panel, hide the rest. Stats/Browse/Minna re-render on show so they
// always reflect the latest state.store. The per-tab render is passed in as handlers so
// this module doesn't import the feature render fns (keeps chrome a leaf).
export function initTabs(handlers = {}) {
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('panel-' + t.dataset.tab).classList.add('active');
    if (t.dataset.tab === 'stats') handlers.stats && handlers.stats();
    if (t.dataset.tab === 'browse') handlers.browse && handlers.browse();
    if (t.dataset.tab === 'minna') handlers.minna && handlers.minna();
  }));
}

// FONT SWITCH — swaps --jp-font (only Japanese .jp text is affected). Persisted under its
// own key, separate from progress.
export function initFontSwitch() {
  const fontSel = document.getElementById('fontSel');
  const savedFont = localStorage.getItem('jpverbs_font');
  if (savedFont) { fontSel.value = savedFont; document.documentElement.style.setProperty('--jp-font', savedFont); }
  fontSel.addEventListener('change', () => {
    document.documentElement.style.setProperty('--jp-font', fontSel.value);
    localStorage.setItem('jpverbs_font', fontSel.value);
  });
}

// THEME — light/dark via a data-theme attribute on <html>. If the user has never toggled,
// no attribute is set and the prefers-color-scheme media query in the CSS decides. The
// toggle RESOLVES the current effective theme (reading the system preference when unset)
// before flipping, so the first click always does the visibly-right thing. Persisted.
export function initTheme() {
  const savedTheme = localStorage.getItem('jpverbs_theme');
  if (savedTheme) { document.documentElement.setAttribute('data-theme', savedTheme); }
  document.getElementById('themeToggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const effective = cur || (sysDark ? 'dark' : 'light');
    const next = effective === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('jpverbs_theme', next);
  });
}
