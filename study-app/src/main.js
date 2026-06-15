/* ============================================================================
   日常日本語 Japanese Trainer — entry point.
   ----------------------------------------------------------------------------
   The app is split into feature modules under features/* on top of the pure,
   unit-tested core/* (SRS, facets, forecast, kana, pitch, examples, text, minna),
   the shared mutable state.js hub (store/DATA/minnaStore/MAXRANK), persistence/*
   (localStorage), settings-store, config, and the sync-bus seam. This file owns
   NO feature logic — it only builds the initial deck and calls each module's
   initX() in boot order. Architecture + dead-ends: CLAUDE.md.

   Boot-order notes:
   - ES imports evaluate before this body, so modules must not read state.DATA/
     MAXRANK at module-eval time (cfg.rmax etc. are finalized inside initDeckUI).
   - Cross-feature calls are wired three ways: direct imports (live bindings,
     safe even when circular because calls happen at event/runtime), the sync-bus
     (persistence → cloud schedulers), and a couple of register*() callback seams
     (startSession, card actions, session hooks) to avoid eval-time cycles.
   - initCustomUI()'s rebuildData() runs BEFORE initMinna() so it sees the state.js
     default empty Minna overlays; the boot rebuild at the end applies the real ones.
   - bootAuth() is LAST and not awaited (it chains pullCloud → rebuildData →
     refreshAllViews, which touch every feature — all must be initialized first).
   ========================================================================== */
import './styles.css';
import { VERBS } from './data/verbs.js';
import { state, attachLevels } from './state.js';
import { loadCustom } from './persistence/custom.js';
import { loadStore } from './persistence/store.js';
import { applyFurigana } from './settings-store.js';
import { initTtsUI } from './features/tts.js';
import { initA11y } from './features/a11y.js';
import { initTabs, initFontSwitch, initTheme } from './features/chrome.js';
import { initExportImport } from './features/io.js';
import { registerStartSession, initDeckUI, updateDeckCount, updateDueBanner, updateStartLabel } from './features/deck.js';
import { startSession, initFlashcardUI } from './features/flashcard.js';
import { renderBrowse, initBrowseUI, registerCardActions } from './features/browse.js';
import { renderStats, initStatsUI } from './features/stats.js';
import { rebuildData, renderCustomCount, openVerbModal, deleteVerb, initCustomUI } from './features/custom-cards.js';
import { initSettingsPage } from './features/settings-page.js';
import { initMinna, migrateMinnaDupes, renderMinna, onMinnaHidden } from './features/minna.js';
import { initSelftalk, showSelftalk, onSelftalkHidden } from './features/selftalk.js';
import { initExamples } from './features/examples.js';
import { initCloud, bootAuth } from './features/cloud.js';

// Initial deck build (built-ins + custom) so deck/browse readers have state.DATA before the
// boot rebuildData() re-applies Minna overlays. state.DATA/MAXRANK + attachLevels: state.js.
state.DATA = VERBS.filter(v => !v.skip).concat(loadCustom().verbs);
state.MAXRANK = state.DATA.reduce((m, v) => Math.max(m, v.rank), 0) || 100;
attachLevels();

// Hydrate the progress store + apply the furigana setting before any reader/render.
loadStore();
applyFurigana();

// Chrome: tabs (per-tab render passed as handlers so chrome stays a leaf), font, theme, I/O.
initTabs({ stats: () => renderStats(), browse: () => renderBrowse(), minna: () => renderMinna(), leaveMinna: () => onMinnaHidden(), selftalk: () => showSelftalk(), leaveSelftalk: () => onSelftalkHidden() });
initFontSwitch();
initTheme();
initExportImport();

// Deck picker. registerStartSession lets deck's startDueSession trigger a run without
// importing flashcard (callback seam). Then the live deck-count / due-banner / Start label.
registerStartSession(startSession);
initDeckUI();
updateDeckCount();
updateDueBanner();
updateStartLabel();

// Flashcard session. (logSession + maybeShowSignup are injected by initCloud below.)
initTtsUI();
initFlashcardUI();

// Browse grid + detail modal. Edit/Delete call into custom-cards — injected here.
registerCardActions({ openVerbModal, deleteVerb });
initBrowseUI();
// Accessibility: annotate chips + roving tabindex. After deck + browse facets + topic groups.
initA11y();

// Stats panel (study-leeches jump + hard reset).
initStatsUI();

// Cloud: auth modal + sign-up banner, sync-scheduler registration on the bus, and the
// session-hook injection into flashcard. bootAuth runs last.
initCloud();

// Custom cards: wire the modal, then the initial deck rebuild + count. BEFORE initMinna so
// this rebuild sees the state.js default empty overlays (the boot rebuild applies the real ones).
initCustomUI();
rebuildData();
renderCustomCount();

// Settings page + みんなの日本語 dashboard. initMinna loads the Minna store (after the rebuild above).
initSettingsPage();
initMinna();
// 独り言 Self-Talk tab (anon-readable; fetches the phrase store + the practice signal).
initSelftalk();

// ---- Initial paint ---- Flashcard is the default-active panel; Stats renders lazily on
// tab-open; Browse needs one render now so it's ready on switch.
migrateMinnaDupes(); rebuildData();   // apply local Minna overlays + clean pre-dedup dupes
renderBrowse();
// Refresh built-in example sentences from the server store (Phase 2). state.exampleLevels is
// already cache-hydrated (state.js), so the deck paints instantly; this freshens it + re-renders.
initExamples();   // fire-and-forget
bootAuth();   // session probe + cloud hydration; fire-and-forget, must be last
