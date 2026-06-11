/* ============================================================================
   Japanese Verb Trainer — application logic.
   ----------------------------------------------------------------------------
   Split out of index.html. Loaded as a classic <script> AFTER verbs.js, so the
   global `VERBS` (the dataset) is already defined when this runs; both share one
   global scope. No bundler, no modules — see the architecture map + data model +
   design decisions in the top-of-file comment of index.html (the source of truth).

   Section banners below mirror the original single-file layout: state.DATA/STORAGE/SRS →
   TAB NAV → FONT/THEME → EXPORT/IMPORT → DECK BUILDING → FLASHCARD → BROWSE →
   STATS+CHARTS → CUSTOM VERBS → CLOUD ACCOUNTS + SYNC.
   ========================================================================== */
// ---------------------------------------------------------------------------
// ES-module imports. The dataset + leveled examples are data modules; the pure,
// unit-tested core (SRS, facets, forecast, kana, pitch, examples, text, minna)
// lives under core/; the shared mutable deck/progress lives in state.js. We pull
// the core names into local bindings so the call sites below read exactly as they
// did when this was one classic script.
// Entry point. The app is split into feature modules under features/* (plus the pure core/*,
// the shared state.js hub, persistence/*, settings-store, config, and sync-bus). This file
// wires them in boot order; almost all logic lives in the modules it imports.
import './styles.css';
import { VERBS } from './data/verbs.js';
import { state, attachLevels } from './state.js';
import { localDay } from './config.js';
import { loadCustom } from './persistence/custom.js';
import { loadStore, save } from './persistence/store.js';
import { applyFurigana } from './settings-store.js';
import { initTtsUI } from './features/tts.js';
import { initA11y } from './features/a11y.js';
import { initTabs, initFontSwitch, initTheme } from './features/chrome.js';
import { registerStartSession, initDeckUI, updateDeckCount, updateDueBanner, updateStartLabel } from './features/deck.js';
import { startSession, initFlashcardUI } from './features/flashcard.js';
import { renderBrowse, initBrowseUI, registerCardActions } from './features/browse.js';
import { renderStats, initStatsUI } from './features/stats.js';
import { rebuildData, renderCustomCount, openVerbModal, deleteVerb, initCustomUI } from './features/custom-cards.js';
import { initSettingsPage } from './features/settings-page.js';
import { initMinna, migrateMinnaDupes, renderMinna } from './features/minna.js';
import { initCloud, bootAuth } from './features/cloud.js';

// Initial deck build (built-ins + custom) so deck/browse readers have state.DATA before the
// boot rebuildData() re-applies Minna overlays. state.DATA/MAXRANK + attachLevels are in state.js.
state.DATA = VERBS.filter(v => !v.skip).concat(loadCustom().verbs);
state.MAXRANK = state.DATA.reduce((m, v) => Math.max(m, v.rank), 0) || 100;

// state.BUILTIN_RANK_BY_JP + attachLevels live in state.js; the tier/pick helpers
// (availableTiers/exampleForLevel) in core/examples.js. attachLevels() is called
// after the initial state.DATA build below and after every rebuildData().
attachLevels();

/* ============================================================================
   STORAGE + SRS
   ----------------------------------------------------------------------------
   All progress lives in ONE localStorage key as a single JSON blob (see the
   `state.store` shape in the file header). Persistence model:
     • Mutations happen in memory on the `state.store` object.
     • save() is called after every grade (so a tab-close mid-session doesn't
       lose progress) and after import/reset.
   save() and the initial read are wrapped in try/catch because localStorage
   can throw (private mode, quota, disabled). Failure degrades to in-memory-
   only — the app still runs, it just won't persist.

   SCHEMA VERSIONING: the key is suffixed "_v3". If the state.store shape changes
   incompatibly, bump to _v4 and (ideally) write a migration that reads the old
   key. Right now we do soft per-field migration in cardStat() instead.
   ========================================================================== */
// Progress storage (KEY/loadStore/save/saveLocal) → persistence/store.js. Hydrate
// state.store from localStorage now (before any reader runs below).
loadStore();

// localDay now lives in config.js (imported above).

// Leitner SRS (BOX_DAYS / cardStat / scheduleCard / isDue / dueCards /
// nextDueLabel) lives in core/srs.js; the forecast helpers in core/forecast.js;
// rollingAcc / isLeech / leeches there too. All read the shared state.store / state.DATA.

// Forecast (forecastHorizon + renderForecast) + the whole DECK BUILDING section →
// features/deck.js (imported above).

// TAB NAV → features/chrome.js (initTabs). The per-tab render fns still live below in this
// file, so they're passed as handlers.
initTabs({ stats: () => renderStats(), browse: () => renderBrowse(), minna: () => renderMinna() });

/* ============================================================================
   SETTINGS — DB-synced preferences (the Settings page edits these).
   ----------------------------------------------------------------------------
   One object in localStorage (jpverbs_settings), synced to the server under app
   'settings' when signed in (mirrors the progress/custom-verb sync). Holds the
   cross-cutting study defaults: example sentence level, furigana visibility,
   default answer mode, default audio. Migrates the older per-key prefs
   (jpverbs_exlevel/input/audio) on first load. saveSettings() writes localStorage,
   applies side-effects (furigana), and schedules a cloud push when signed in.
   (Theme + font keep their own keys — device-ish, not synced.)
   ========================================================================== */
// Settings (SETTINGS_KEY/DEFAULT_SETTINGS/loadSettings/settings/setSettings/applyFurigana/
// saveSettings/saveSettingsLocal) → settings-store.js (imported above). `settings` was
// loaded at that module's eval; apply the furigana flip now.
applyFurigana();

// FONT SWITCH + THEME → features/chrome.js.
initFontSwitch();
initTheme();

/* ============================================================================
   EXPORT / IMPORT — the only way to move progress between browsers/devices
   (there's no backend). Export downloads the whole `state.store` as pretty JSON via
   a temporary object-URL anchor. Import validates loosely (must be an object
   with a `cards` key), confirms before overwriting, then rebuilds derived UI.
   The file input is reset in `finally` so re-importing the same file re-fires
   the change event.
   ========================================================================== */
document.getElementById('exportBtn').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify(state.store,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download='japanese-verbs-progress-'+localDay()+'.json';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});
document.getElementById('importBtn').addEventListener('click',()=>document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change',(e)=>{
  const file=e.target.files[0]; if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const data=JSON.parse(reader.result);
      if(typeof data!=='object'||!data.cards){throw new Error('Not a valid progress file');}
      if(!confirm('Replace your current progress with the imported data? This overwrites existing stats.'))return;
      state.store={cards:data.cards||{},sessions:data.sessions||[],daily:data.daily||{}};
      save();
      updateDeckCount();updateDueBanner();renderBrowse();
      if(document.getElementById('panel-stats').classList.contains('active'))renderStats();
      alert('Progress imported.');
    }catch(err){ alert('Import failed: '+err.message); }
    finally{ e.target.value=''; }
  };
  reader.readAsText(file);
});

// DECK BUILDING (cfg + makeMultiSelect/wireFacets + buildDeck + updateDeckCount/
// updateDueBanner/updateStartLabel/startDueSession + the picker chip wiring + the SRS
// forecast) → features/deck.js (imported above). startSession lives below in this file;
// register it so deck's startDueSession can trigger a run (callback seam, no import cycle).
registerStartSession(startSession);
initDeckUI();
updateDeckCount();
updateDueBanner();
updateStartLabel();

// FLASHCARD SESSION → features/flashcard.js. (logSession + maybeShowSignup live in cloud.js
// and are injected into flashcard by initCloud via registerSessionHooks.)
initTtsUI();
initFlashcardUI();

// BROWSE (bcfg + the reference grid + detail modal + topic groups) → features/browse.js.
// Edit/Delete in the detail modal call into custom-cards (still inline below); inject them.
registerCardActions({ openVerbModal, deleteVerb });
initBrowseUI();
// ACCESSIBILITY → features/a11y.js. Runs after the deck + browse facets and the topic
// groups are wired, so roving covers every chip group (annotate* + roving-tabindex).
initA11y();

/* ============================================================================
   STATS + CHARTS → features/stats.js (renderStats + lineChart/barChart/renderCardBars +
   the study-leeches jump and hard-reset wired in initStatsUI).
   ========================================================================== */
initStatsUI();

// CLOUD ACCOUNTS + SYNC → features/cloud.js (over features/cloud-core.js). initCloud wires
// the auth modal + sign-up banner, registers the sync schedulers on the bus, and injects
// logSession + maybeShowSignup into flashcard. bootAuth runs last (initial paint below).
initCloud();

// CUSTOM CARDS (rebuildData + renderCustomCount + the #verbModal CRUD) →
// features/custom-cards.js. Wire the modal, then do the initial deck rebuild + count
// (state.DATA already merged custom cards at load). Runs BEFORE initMinna so this rebuild
// sees the state.js default empty overlays (the boot rebuild below applies the real ones).
initCustomUI();
rebuildData();
renderCustomCount();

// SETTINGS PAGE → features/settings-page.js; みんなの日本語 DASHBOARD → features/minna.js.
// initMinna loads the Minna store AFTER the custom rebuild above (so that rebuild saw the
// empty default overlays); the boot rebuild below then applies the real overlays.
initSettingsPage();
initMinna();

// ---- Initial paint ----
// Flashcard is the default-active panel (its deck count + due banner were computed above).
// Stats renders lazily on tab-open; Browse needs one render now so it's ready on switch.
migrateMinnaDupes(); rebuildData();   // apply local Minna overlays + clean pre-dedup dupes
renderBrowse();
// Kick off the session probe / cloud hydration once everything above is wired.
bootAuth();
