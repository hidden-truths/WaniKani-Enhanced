// App "chrome" (shell): tab navigation, the Japanese-font switcher, the light/dark
// theme toggle, and the ふ furigana toggle. All thin DOM wiring; font/theme are device-ish
// (their own localStorage keys), furigana rides the synced `settings` blob.
import { settings, saveSettings } from '../settings-store.js';

// TAB NAV — show one panel, hide the rest. Stats/Browse/Minna re-render on show so they
// always reflect the latest state.store. The per-tab render is passed in as handlers so
// this module doesn't import the feature render fns (keeps chrome a leaf). `handlers.leaveMinna` /
// `handlers.leaveSelftalk` fire when navigating AWAY from みんなの日本語 / 独り言 (so each can release
// its persistent mic stream — see the speaking-mode dead-end); we track the active tab to know when
// we're leaving it.
export function initTabs(handlers = {}) {
  let activeTab = document.querySelector('.tab.active')?.dataset.tab || null;
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    const next = t.dataset.tab;
    if (activeTab === 'minna' && next !== 'minna') handlers.leaveMinna && handlers.leaveMinna();
    if (activeTab === 'selftalk' && next !== 'selftalk') handlers.leaveSelftalk && handlers.leaveSelftalk();
    if (activeTab === 'songs' && next !== 'songs') handlers.leaveSongs && handlers.leaveSongs();
    activeTab = next;
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    t.scrollIntoView({ inline: 'nearest', block: 'nearest' });   // keep the active tab in view in the horizontally-scrollable strip
    document.getElementById('panel-' + next).classList.add('active');
    if (next === 'stats') handlers.stats && handlers.stats();
    if (next === 'browse') handlers.browse && handlers.browse();
    if (next === 'minna') handlers.minna && handlers.minna();
    if (next === 'selftalk') handlers.selftalk && handlers.selftalk();
    if (next === 'songs') handlers.songs && handlers.songs();
    if (next === 'wanikani') handlers.wanikani && handlers.wanikani();
    if (next === 'jlpt') handlers.jlpt && handlers.jlpt();
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

// ふ FURIGANA TOGGLE (topbar) — flips settings.furigana, which `applyFurigana()` writes to
// <html data-furigana>; saveSettings() persists + syncs. The button's on/off paint is driven
// by a MutationObserver on that attribute, so it stays correct no matter who flips furigana
// (this button, the Settings #setFuri control, or a cloud pull's applyFurigana). The Settings
// modal's #setFuri only re-syncs on its next render — a brief desync if it's open at toggle time.
export function initFuriToggle() {
  const btn = document.getElementById('furiToggle');
  if (!btn) return;
  const paint = () => {
    const on = document.documentElement.dataset.furigana !== 'off';
    btn.classList.toggle('on', on);
    btn.classList.toggle('off', !on);
    btn.setAttribute('aria-pressed', String(on));
  };
  paint();
  new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-furigana'] });
  btn.addEventListener('click', () => { settings.furigana = !settings.furigana; saveSettings(); });
}
