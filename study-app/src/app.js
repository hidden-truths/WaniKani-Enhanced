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
import './styles.css';
import { VERBS } from './data/verbs.js';
import { state, attachLevels } from './state.js';
import { API_BASE, localDay } from './config.js';
import { sync } from './sync-bus.js';
import { loadCustom, saveCustom, saveCustomLocal } from './persistence/custom.js';
import { loadStore, save, saveLocal } from './persistence/store.js';
import { settings, setSettings, DEFAULT_SETTINGS, applyFurigana, saveSettings, saveSettingsLocal } from './settings-store.js';
import { speakWord, TTS_OK, initTtsUI } from './features/tts.js';
import { provenanceBadge, jishoUrl } from './features/render-helpers.js';
import { annotateJlptChips, annotateCatChips, annotateSourceChips, initA11y } from './features/a11y.js';
import { initTabs, initFontSwitch, initTheme } from './features/chrome.js';
import {
  cfg, buildDeck, updateDeckCount, updateDueBanner, updateStartLabel, repaintDeck,
  startDueSession, makeMultiSelect, wireFacets, paintSummary, syncVerbRows, paintPrefChips,
  registerStartSession, initDeckUI,
} from './features/deck.js';
import { session, startSession, renderExample, initFlashcardUI, registerSessionHooks } from './features/flashcard.js';
import { bcfg, renderBrowse, initBrowseUI, registerCardActions } from './features/browse.js';
import { renderStats, initStatsUI } from './features/stats.js';
import * as Core from './core/index.js';
const {
  TYPE_LABEL, CATS, CAT_LABEL, colorClass, cardStamp,
  BOX_DAYS, BOX_COLORS, cardStat, scheduleCard, isDue, dueCards, nextDueLabel, rollingAcc, isLeech, leeches,
  forecastWindow, reviewForecast,
  oneGroup, facetAll, facetMatch, passes, DECK_FACETS, TOKEN_FACET, tokenFacet, DECK_LABEL, deckLabel, filterSummary,
  JLPT_TIERS, availableTiers, exampleForLevel,
  normKana, romajiToKana, splitMora, pitchHtml, escapeHtml, ttsText,
  minnaBuiltinRank, applyMinnaOverlays, minnaSig,
} = Core;

// The persistence layer (store/custom/settings) schedules cloud pushes through the sync
// bus; cloud + minna still live below in this file, so register their (hoisted) schedulers
// onto the bus here. When cloud/minna are extracted into their own modules, they'll
// self-register and these lines go away.
sync.progress = scheduleCloudSync;
sync.custom   = scheduleCustomSync;
sync.settings = scheduleSettingsSync;
sync.minna    = scheduleMinnaSync;

// The backing API origin. Empty today would keep relative /v1 paths working same-origin;
// as its own container at wkenhanced.dev the app is cross-ORIGIN from the API, so
// VITE_API_BASE (baked by Vite) points at https://api.wkenhanced.dev and every fetch +
// the TTS/Minna <audio> address the API there. The httpOnly session cookie still rides
// because the two are same-SITE (Domain=.wkenhanced.dev) and api() sends credentials:'include'.
// API_BASE + localDay → config.js; custom-verb storage (loadCustom/saveCustom/
// saveCustomLocal) → persistence/custom.js (both imported above).

// state.DATA is the live deck: the baked-in VERBS (minus any v.skip) plus the user's
// own custom verbs. It's a `let` rebuilt by rebuildData() so every reader
// (buildDeck/dueCards/leeches/renderBrowse/renderStats) picks up added/edited/
// deleted custom verbs without re-binding. state.MAXRANK tracks the highest rank present
// so the rank-range filter can extend past 100 to include custom verbs.
// Initial deck build (built-ins + custom). state.DATA/state.MAXRANK live in state.js;
// boot's rebuildData() re-applies Minna overlays. attachLevels() runs just below.
state.DATA=VERBS.filter(v=>!v.skip).concat(loadCustom().verbs);
state.MAXRANK=state.DATA.reduce((m,v)=>Math.max(m,v.rank),0)||100;

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

/* ============================================================================
   FLASHCARD SESSION → features/flashcard.js.
   ----------------------------------------------------------------------------
   logSession stays here: it talks to the cloud api() + reads account (both still inline
   below), and reads cfg.mode (deck). It's injected into flashcard via registerSessionHooks
   so endSession can call it; maybeShowSignup (cloud, inline) is injected the same way.
   When cloud is extracted, logSession moves with it.
   ========================================================================== */
initTtsUI();
// Append a finished session to the durable server log (fire-and-forget; signed-in only).
// Local + blob already hold it — this just guarantees it's never pruned. `mode` keeps the
// test direction; `details.kind` carries the SRS/free distinction.
function logSession(right,tot,kind){
  if(!account)return;
  try{ api('/v1/sessions',{method:'POST',body:{right,total:tot,mode:cfg.mode,details:{kind,direction:cfg.mode}}}).catch(()=>{}); }catch(e){}
}
registerSessionHooks({ logSession, maybeShowSignup });
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


/* ============================================================================
   CLOUD ACCOUNTS + SYNC
   ----------------------------------------------------------------------------
   The app still works fully offline against localStorage (see STORAGE). When
   the user signs in, progress is mirrored to the backing API so it follows
   them across devices. Model:
     • save() writes localStorage immediately, then (if signed in) schedules a
       debounced PUT of the whole `state.store` to the server.
     • On boot we probe /v1/auth/me. If signed in, we pull the server copy
       (server wins) and re-render; a brand-new account with no server data
       gets its current local state.store pushed up as the baseline.
   All requests are same-origin with credentials:'include' — the session lives
   in an httpOnly cookie set by the server, never touched by this JS.

   Three independent synced blobs (separate server `app` namespaces, all server-wins
   on login, all debounced-push on change):
     • 'verbs'        — the progress `state.store` (cards/sessions/daily). save().
     • 'custom-verbs' — the user's custom verb definitions. saveCustom().
     • 'settings'     — the Settings-page preferences. saveSettings().
   Completed sessions are ALSO appended to a durable server log (POST /v1/sessions)
   so full session history survives the capped in-blob `state.store.sessions`.

   Endpoints (served from this same origin):
     POST /v1/auth/register | /login | /logout      {email,password}
     GET  /v1/auth/me                    → {user:{id,email}|null}
     GET/PUT /v1/progress/verbs          {data:<state.store>}
     GET/PUT /v1/progress/custom-verbs   {data:{seq,verbs}}
     GET/PUT /v1/progress/settings       {data:<settings>}
     POST /v1/sessions                   {right,total,mode}  (append-only history)
   ========================================================================== */
const APP_KEY='verbs';            // progress namespace on the server
const CUSTOM_APP_KEY='custom-verbs'; // custom-verb-definitions namespace
const SETTINGS_APP_KEY='settings'; // synced preferences namespace
let account=null;                  // {id,email} when signed in, else null
let authMode='login';              // 'login' | 'register' — current modal mode
let serverReachable=true;          // false after a failed /me probe (e.g. file://)
let syncTimer=null;                 // progress-blob debounce
let customSyncTimer=null;           // custom-verbs debounce (independent)

// Thin JSON fetch wrapper. Throws an Error carrying .status / .code on non-2xx
// so callers can branch; a network failure throws fetch's own TypeError (no
// .status), which the UI treats as "server unreachable".
async function api(path,opts={}){
  const res=await fetch(API_BASE+path,{
    method:opts.method||'GET',
    headers:opts.body!==undefined?{'Content-Type':'application/json'}:undefined,
    body:opts.body!==undefined?JSON.stringify(opts.body):undefined,
    credentials:'include',
    cache:'no-store',
  });
  let data=null; try{data=await res.json();}catch(e){}
  if(!res.ok){
    const err=new Error((data&&data.error)||('HTTP '+res.status));
    err.code=data&&data.code; err.status=res.status; throw err;
  }
  return data;
}

function setSyncStatus(t){const el=document.getElementById('syncStatus');if(el)el.textContent=t;}

// Debounced push of the whole state.store (only when signed in). Coalesces the rapid
// save() calls during a session into one PUT shortly after activity settles.
function scheduleCloudSync(){
  if(!account)return;
  if(syncTimer)clearTimeout(syncTimer);
  syncTimer=setTimeout(pushCloud,1200);
}
async function pushCloud(){
  if(!account)return;
  setSyncStatus('saving…');
  try{ await api('/v1/progress/'+APP_KEY,{method:'PUT',body:{data:state.store}}); setSyncStatus('✓ synced'); }
  catch(err){ setSyncStatus('⚠ offline'); }   // next save() retries
}

// --- Custom-verb sync (mirrors the progress sync above, separate namespace) ---
// Add/edit/delete all go through saveCustom(), which schedules this push, so a
// removal propagates to the cloud just like an add.
function scheduleCustomSync(){
  if(!account)return;
  if(customSyncTimer)clearTimeout(customSyncTimer);
  customSyncTimer=setTimeout(pushCustomCloud,1200);
}
async function pushCustomCloud(){
  if(!account)return;
  setSyncStatus('saving…');
  try{ await api('/v1/progress/'+CUSTOM_APP_KEY,{method:'PUT',body:{data:loadCustom()}}); setSyncStatus('✓ synced'); }
  catch(err){ setSyncStatus('⚠ offline'); }
}
// Pull custom verbs after sign-in. Server wins when it has any; a fresh account
// seeds the cloud from whatever custom verbs are currently local. Writes via
// saveCustomLocal() so hydration doesn't immediately re-push the same bytes.
async function pullCustomCloud(){
  try{
    const r=await api('/v1/progress/'+CUSTOM_APP_KEY);
    if(r&&r.data&&Array.isArray(r.data.verbs)){
      saveCustomLocal({seq:r.data.seq||100, verbs:r.data.verbs});
      rebuildData();
    }else if(loadCustom().verbs.length){
      await pushCustomCloud();     // new account — seed cloud from local custom verbs
    }
  }catch(err){/* offline — keep local custom verbs */}
}

// --- Settings sync (separate namespace; same server-wins-on-login model) ---
let settingsSyncTimer=null;
function scheduleSettingsSync(){
  if(!account)return;
  if(settingsSyncTimer)clearTimeout(settingsSyncTimer);
  settingsSyncTimer=setTimeout(pushSettingsCloud,1200);
}
async function pushSettingsCloud(){
  if(!account)return;
  setSyncStatus('saving…');
  try{ await api('/v1/progress/'+SETTINGS_APP_KEY,{method:'PUT',body:{data:settings}}); setSyncStatus('✓ synced'); }
  catch(err){ setSyncStatus('⚠ offline'); }
}
// Pull settings after sign-in. Server wins; a fresh account seeds from local.
// Re-applies side-effects (furigana) and repaints the controls that read settings.
async function pullSettingsCloud(){
  try{
    const r=await api('/v1/progress/'+SETTINGS_APP_KEY);
    if(r&&r.data&&typeof r.data==='object'){
      setSettings(Object.assign({}, DEFAULT_SETTINGS, r.data));   // export let — reassign via the setter
      saveSettingsLocal(); applyFurigana(); paintPrefChips();
      if(typeof renderSettings==='function')renderSettings();
    }else{
      await pushSettingsCloud();    // new account — seed cloud from local settings
    }
  }catch(err){/* offline — keep local settings */}
}

// Pull server progress after sign-in. Server wins when it has data; a fresh
// account inherits whatever's currently local (one-time migration upward).
async function pullCloud(){
  try{
    const r=await api('/v1/progress/'+APP_KEY);
    if(r&&r.data&&r.data.cards){
      state.store={cards:r.data.cards||{},sessions:r.data.sessions||[],daily:r.data.daily||{}};
      saveLocal();                 // mirror to localStorage WITHOUT re-pushing
      setSyncStatus('✓ synced');
    }else{
      await pushCloud();           // new account — seed cloud from local
    }
  }catch(err){ setSyncStatus('⚠ offline'); }
  await pullCustomCloud();          // custom verbs + settings + minna share the sign-in pull
  await pullSettingsCloud();
  await pullMinnaCloud();
  migrateMinnaDupes(); rebuildData();   // apply pulled Minna overlays + clean any dupes
  refreshAllViews();
}

// Re-render every state.store-derived view. Mirrors the import handler's refresh set.
function refreshAllViews(){
  updateDeckCount(); updateDueBanner(); renderBrowse();
  if(typeof renderCustomCount==='function')renderCustomCount();
  if(document.getElementById('panel-stats').classList.contains('active'))renderStats();
  if(document.getElementById('panel-minna').classList.contains('active')&&typeof renderMinna==='function')renderMinna();
}

// escapeHtml lives in core/text.js; splitMora + pitchHtml (visual pitch accent) in core/pitch.js.
function updateAccountChip(){
  const btn=document.getElementById('accountBtn');
  if(account){ btn.innerHTML='<svg class="ic" aria-hidden="true"><use href="#i-cloud-check"/></svg>'+escapeHtml(account.email); btn.title='Signed in — click to sign out'; }
  else { btn.innerHTML='<svg class="ic" aria-hidden="true"><use href="#i-user"/></svg>Sign in'; btn.title='Sign in to sync progress'; setSyncStatus(''); }
}

/* ---- Auth modal wiring ---- */
const authModal=document.getElementById('authModal');
function openAuth(mode){
  authMode=mode||'login';
  const login=authMode==='login';
  document.getElementById('authTitle').textContent=login?'Sign in':'Create account';
  document.getElementById('authSub').textContent=login
    ?'Save your progress to the cloud and study from any device.'
    :'Create an account to back up and sync your progress.';
  document.getElementById('authSubmit').textContent=login?'Sign in':'Create account';
  document.getElementById('authPass').setAttribute('autocomplete',login?'current-password':'new-password');
  document.getElementById('authToggleText').textContent=login?'New here?':'Already have an account?';
  document.getElementById('authToggle').textContent=login?'Create an account':'Sign in';
  document.getElementById('authErr').textContent='';
  authModal.classList.add('show');
  document.getElementById('authEmail').focus();
}
function closeAuth(){ authModal.classList.remove('show'); }

document.getElementById('accountBtn').addEventListener('click',()=>{
  if(account){ if(confirm('Sign out? Your progress stays saved in the cloud.'))doLogout(); }
  else openAuth('login');
});
document.getElementById('authClose').addEventListener('click',closeAuth);
document.getElementById('authOffline').addEventListener('click',closeAuth);
document.getElementById('authToggle').addEventListener('click',()=>openAuth(authMode==='login'?'register':'login'));
authModal.addEventListener('click',e=>{ if(e.target===authModal)closeAuth(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&authModal.classList.contains('show'))closeAuth(); });

document.getElementById('authForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const email=document.getElementById('authEmail').value.trim();
  const password=document.getElementById('authPass').value;
  const errEl=document.getElementById('authErr'); errEl.textContent='';
  const submit=document.getElementById('authSubmit'); submit.disabled=true;
  try{
    const path=authMode==='login'?'/v1/auth/login':'/v1/auth/register';
    const r=await api(path,{method:'POST',body:{email,password}});
    account=r.user; updateAccountChip(); closeAuth();
    document.getElementById('authPass').value='';
    await pullCloud();
  }catch(err){ errEl.textContent=friendlyAuthError(err); }
  finally{ submit.disabled=false; }
});

function friendlyAuthError(err){
  if(err.status===401)return 'Wrong email or password.';
  if(err.status===409)return 'That email is already registered — try signing in.';
  if(err.status===400||err.code==='validation_error')return 'Enter a valid email and a password of at least 8 characters.';
  if(err.status===undefined)return 'Could not reach the server. Check your connection and try again.';
  return err.message||'Something went wrong.';
}

async function doLogout(){
  try{ await api('/v1/auth/logout',{method:'POST'}); }catch(e){}
  account=null; updateAccountChip(); setSyncStatus('');
}

// Boot: probe the session and hydrate from cloud if signed in. We deliberately do
// NOT show the sign-up nudge here — a brand-new visitor sees the app first and only
// gets nudged AFTER finishing their first session (see maybeShowSignup, called from
// endSession), which converts far better than a cold first-paint banner.
async function bootAuth(){
  try{ const r=await api('/v1/auth/me'); account=(r&&r.user)?r.user:null; }
  catch(e){ serverReachable=false; account=null; }
  updateAccountChip();
  if(account){ await pullCloud(); return; }
}
// Show the dismissible sign-up banner once the user has engaged (finished a
// session): only when signed out, server reachable, and not previously dismissed.
// Safe to call repeatedly — it no-ops after dismissal or sign-in.
function maybeShowSignup(){
  if(account||!serverReachable)return;
  if(localStorage.getItem('jpverbs_signup_dismissed')==='1')return;
  document.getElementById('signupBanner').hidden=false;
}
// Sign-up banner actions: "Create account" opens the auth modal on demand;
// dismiss hides it and remembers the choice.
document.getElementById('signupCreate').addEventListener('click',()=>{
  document.getElementById('signupBanner').hidden=true; openAuth('register');
});
document.getElementById('signupDismiss').addEventListener('click',()=>{
  document.getElementById('signupBanner').hidden=true;
  localStorage.setItem('jpverbs_signup_dismissed','1');
});

/* ============================================================================
   CUSTOM VERBS — add / edit / delete (the modal CRUD layer).
   ----------------------------------------------------------------------------
   The state.store + state.DATA merge live up in the STORAGE area (loadCustom/saveCustom and
   the state.DATA concat). Here we wire the #verbModal form. A custom verb gets a rank
   from a monotonic `seq` (never reused, so progress in state.store.cards is stable
   across deletes) and custom:true. rebuildData() rebuilds state.DATA, extends state.MAXRANK +
   the rank-range UI, and re-runs the JLPT annotation; callers then re-render.
   ========================================================================== */
let editingRank=null;   // null = adding a new verb; otherwise the rank being edited
// Merge Minna provenance onto matching built-ins (the dedup path). A Minna word that
// already exists as a baked-in verb is NOT re-added as a bare card — its built-in rank
// gets an entry in state.minnaStore.overlays, and here we merge that onto a COPY of the
// built-in: it keeps its examples / mnemonic / rank / SRS progress but gains the
// みんなの日本語 + iTalki tags, flags, and (if present) pitch accent. Copies — not
// mutation of the shared VERBS objects — so removing an overlay reverts cleanly.
// applyMinnaOverlays lives in core/minna.js (reads state.minnaStore.overlays).
function rebuildData(){
  const prevMax=state.MAXRANK;
  state.DATA=applyMinnaOverlays(VERBS.filter(v=>!v.skip)).concat(loadCustom().verbs);
  state.MAXRANK=state.DATA.reduce((m,v)=>Math.max(m,v.rank),0)||100;
  attachLevels();
  ['rmin','rmax','brmin','brmax'].forEach(id=>{const el=document.getElementById(id);if(el)el.max=state.MAXRANK;});
  // If a range's max was at the old ceiling ("show everything"), extend it so a
  // freshly-added custom verb is included by default; otherwise respect narrowing.
  if(cfg.rmax>=prevMax){cfg.rmax=state.MAXRANK;const e=document.getElementById('rmax');if(e)e.value=state.MAXRANK;}
  if(bcfg.rmax>=prevMax){bcfg.rmax=state.MAXRANK;const e=document.getElementById('brmax');if(e)e.value=state.MAXRANK;}
  annotateJlptChips(); annotateCatChips(); annotateSourceChips();
}
function renderCustomCount(){
  const all=loadCustom().verbs;
  const n=all.filter(v=>!v.minna).length, m=all.filter(v=>v.minna).length;
  const parts=[];
  if(n)parts.push(`<b>${n}</b> custom card${n===1?'':'s'}`);
  if(m)parts.push(`<b>${m}</b> みんなの日本語`);
  document.getElementById('customCount').innerHTML = parts.join(' · ');
}
// Per-category option lists for the modal's Type select. Verbs use the
// conjugation classes; adjectives reuse the field for the い/な split; nouns,
// adverbs and phrases have no subtype (the whole Type cell hides for them).
const VF_TYPE_OPTS={
  verb:[['godan','Godan (う-verb)'],['ichidan','Ichidan (る-verb)'],['irregular','Irregular']],
  adjective:[['i-adj','い-adjective'],['na-adj','な-adjective']]
};
// Repopulate #vfType for the chosen category, preserving the current value if it's
// still a valid option (so reopening an edit keeps the saved subtype selected).
function setTypeOptions(cat){
  const sel=document.getElementById('vfType'), cur=sel.value;
  const opts=VF_TYPE_OPTS[cat]||[];
  sel.innerHTML=opts.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
  if(opts.some(o=>o[0]===cur))sel.value=cur;
}
// Show the verb/adjective-only fields (Type, Transitivity) only when they apply:
// Type for verbs+adjectives, Transitivity for verbs alone. Keeps the add-card form
// honest — you're never asked for a noun's conjugation class.
function syncVerbFields(){
  const cat=document.getElementById('vfCat').value;
  setTypeOptions(cat);
  document.getElementById('vfTypeCell').style.display = VF_TYPE_OPTS[cat]?'':'none';
  document.getElementById('vfTransCell').style.display = cat==='verb'?'':'none';
}
function openVerbModal(verb){
  editingRank = verb?verb.rank:null;
  document.getElementById('verbTitle').textContent = verb?'Edit card':'Add a card';
  document.getElementById('verbSubmit').textContent = verb?'Save changes':'Save card';
  document.getElementById('verbDelete').hidden = !verb;
  document.getElementById('verbErr').textContent='';
  const g=id=>document.getElementById(id);
  g('vfJp').value=verb?verb.jp:''; g('vfRead').value=verb?verb.read:''; g('vfMean').value=verb?verb.mean:'';
  g('vfCat').value=verb?(verb.cat||'verb'):'verb';
  syncVerbFields();                                   // rebuild Type options + show/hide before setting values
  g('vfType').value=verb&&verb.type?verb.type:(g('vfType').value);
  g('vfJlpt').value=verb?verb.jlpt:'N4';
  g('vfTrans').value=verb?(verb.trans||''):'';
  g('vfTags').value=verb?(verb.tags||[]).filter(t=>t!=='custom').join(', '):'';
  g('vfMnem').value=verb?(verb.mnem||''):''; g('vfTip').value=verb?(verb.tip||''):'';
  g('vfExJp').value=verb&&verb.ex&&verb.ex[0]?verb.ex[0][0]:'';
  g('vfExEn').value=verb&&verb.ex&&verb.ex[0]?verb.ex[0][1]:'';
  document.getElementById('verbModal').classList.add('show');
  setTimeout(()=>g('vfJp').focus(),0);
}
function closeVerbModal(){ document.getElementById('verbModal').classList.remove('show'); }
// Re-render every derived view after a custom-verb change.
function refreshAfterVerbChange(){
  renderCustomCount(); renderBrowse(); updateDeckCount(); updateDueBanner();
  if(document.getElementById('panel-stats').classList.contains('active'))renderStats();
}
function saveVerb(e){
  e.preventDefault();
  const val=id=>document.getElementById(id).value.trim();
  const jp=val('vfJp'),read=val('vfRead'),mean=val('vfMean');
  if(!jp||!read||!mean){ document.getElementById('verbErr').textContent='Japanese, reading, and meaning are all required.'; return; }
  const tags=val('vfTags').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
  if(!tags.includes('custom'))tags.push('custom');
  const exJp=val('vfExJp');
  const cat=val('vfCat');
  // Only verbs+adjectives carry a `type`; only verbs carry transitivity. Store ''
  // for the categories where the field is hidden so a stale value can't linger.
  const verb={ jp, read, mean, cat, type:VF_TYPE_OPTS[cat]?val('vfType'):'', jlpt:val('vfJlpt'),
    trans:cat==='verb'?val('vfTrans'):'',
    tags, mnem:val('vfMnem'), tip:val('vfTip'), ex: exJp?[[exJp,val('vfExEn')]]:[], custom:true };
  const cs=loadCustom();
  const existing = editingRank!=null ? cs.verbs.findIndex(v=>v.rank===editingRank) : -1;
  if(existing>=0){ verb.rank=editingRank; cs.verbs[existing]=verb; }      // edit in place (keep rank → keep progress)
  else { cs.seq=(cs.seq||100)+1; verb.rank=cs.seq; cs.verbs.push(verb); } // new monotonic rank
  saveCustom(cs);
  rebuildData(); closeVerbModal(); refreshAfterVerbChange();
}
function deleteVerb(rank){
  const cs=loadCustom();
  cs.verbs=cs.verbs.filter(v=>v.rank!==rank);
  saveCustom(cs);
  if(state.store.cards[rank]){ delete state.store.cards[rank]; save(); }   // drop the orphaned progress
  rebuildData(); closeVerbModal(); refreshAfterVerbChange();
}
document.getElementById('addVerbBtn').addEventListener('click',()=>openVerbModal(null));
document.getElementById('verbClose').addEventListener('click',closeVerbModal);
document.getElementById('vfCat').addEventListener('change',syncVerbFields);   // category drives which verb/adjective fields show
document.getElementById('verbForm').addEventListener('submit',saveVerb);
document.getElementById('verbDelete').addEventListener('click',()=>{ if(editingRank!=null&&confirm('Delete this custom card? Its progress is also removed.'))deleteVerb(editingRank); });
document.getElementById('verbModal').addEventListener('click',e=>{ if(e.target.id==='verbModal')closeVerbModal(); }); // backdrop
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&document.getElementById('verbModal').classList.contains('show'))closeVerbModal(); });
rebuildData();          // sync the rank-range UI to state.MAXRANK (state.DATA already merged custom verbs at load)
renderCustomCount();

/* ============================================================================
   SETTINGS PAGE (modal). Each control writes `settings` + saveSettings() (which
   persists, applies furigana, and schedules a cloud push). renderSettings() paints
   the active chips from `settings` and is also called after a cloud pull.
   ========================================================================== */
function renderSettings(){
  const seg=(sel,attr,val)=>document.querySelectorAll(sel).forEach(b=>b.classList.toggle('active', b.dataset[attr]===val));
  seg('.setlv','setlv',settings.exampleLevel);
  seg('.setfg','setfg',settings.furigana?'on':'off');
  seg('.setin','setin',settings.input);
  seg('.setau','setau',settings.audio);
  seg('.setfr','setfr',settings.freeReviewDue?'on':'off');
  const foot=document.getElementById('settingsFoot');
  if(foot) foot.textContent = account ? ('Synced to '+account.email) : 'Sign in to sync these across your devices.';
}
function openSettings(){ renderSettings(); document.getElementById('settingsModal').classList.add('show'); }
function closeSettings(){ document.getElementById('settingsModal').classList.remove('show'); }
document.getElementById('settingsBtn').addEventListener('click',openSettings);
document.getElementById('settingsClose').addEventListener('click',closeSettings);
document.getElementById('settingsModal').addEventListener('click',e=>{ if(e.target.id==='settingsModal')closeSettings(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&document.getElementById('settingsModal').classList.contains('show'))closeSettings(); });
document.getElementById('setLevel').addEventListener('click',e=>{const b=e.target.closest('.setlv');if(!b)return;settings.exampleLevel=b.dataset.setlv;saveSettings();renderSettings();if(session&&document.getElementById('fcStage').classList.contains('active'))renderExample(session.deck[session.i]);});
document.getElementById('setFuri').addEventListener('click',e=>{const b=e.target.closest('.setfg');if(!b)return;settings.furigana=b.dataset.setfg==='on';saveSettings();renderSettings();});
document.getElementById('setInput').addEventListener('click',e=>{const b=e.target.closest('.setin');if(!b)return;settings.input=b.dataset.setin;saveSettings();paintPrefChips();renderSettings();});
document.getElementById('setAudio').addEventListener('click',e=>{const b=e.target.closest('.setau');if(!b)return;settings.audio=b.dataset.setau;saveSettings();paintPrefChips();renderSettings();});
document.getElementById('setFreeDue').addEventListener('click',e=>{const b=e.target.closest('.setfr');if(!b)return;settings.freeReviewDue=b.dataset.setfr==='on';saveSettings();renderSettings();});

/* ============================================================================
   みんなの日本語 DASHBOARD
   ----------------------------------------------------------------------------
   Account-gated Minna no Nihongo lesson view. Content (vocab/grammar/examples/
   conversation + native audio) is fetched at runtime from /v1/minna/*, which
   only answers for signed-in users, so the copyrighted textbook material never
   ships to anonymous visitors. renderMinna() runs lazily on tab activation.

   Vocab "activation" REUSES the custom-verb system: each word becomes a tagged
   custom card (loadCustom/saveCustom + seq rank), so it joins the deck / SRS /
   Browse / Stats and syncs under the existing 'custom-verbs' blob for free —
   no separate data path, no state.DATA-merge change. Idempotent via a stable
   minnaKey. The only NEW synced blob is per-lesson NOTES (app key 'minna') —
   the "augment as I study" scratchpad. Cards carry minna:true (+ minnaLesson)
   so Browse shows a みんなの日本語 badge instead of CUSTOM.
   ========================================================================== */
const MINNA_APP_KEY='minna';
const MINNA_KEY='jpverbs_minna';
// `overlays` = { <built-in rank>: {tags,italki,minnaLesson,minnaKey,accent?,tts?} } — the
// dedup record: Minna words that map onto a baked-in verb live here, not as custom cards.
const MINNA_DEFAULT={notes:{}, lastLesson:23, overlays:{}};
function loadMinnaStore(){ try{const o=JSON.parse(localStorage.getItem(MINNA_KEY));if(o&&typeof o==='object')return Object.assign({},MINNA_DEFAULT,o,{notes:o.notes||{}, overlays:o.overlays||{}});}catch(e){} return Object.assign({},MINNA_DEFAULT,{notes:{}, overlays:{}}); }
state.minnaStore=loadMinnaStore();
function saveMinnaLocal(){ try{localStorage.setItem(MINNA_KEY,JSON.stringify(state.minnaStore));}catch(e){} }
function saveMinna(){ saveMinnaLocal(); if(typeof scheduleMinnaSync==='function')scheduleMinnaSync(); }

// --- Notes sync trio (mirrors the custom-verb / settings sync; app key 'minna') ---
let minnaSyncTimer=null;
function scheduleMinnaSync(){ if(!account)return; if(minnaSyncTimer)clearTimeout(minnaSyncTimer); minnaSyncTimer=setTimeout(pushMinnaCloud,1200); }
async function pushMinnaCloud(){ if(!account)return; setSyncStatus('saving…'); try{ await api('/v1/progress/'+MINNA_APP_KEY,{method:'PUT',body:{data:state.minnaStore}}); setSyncStatus('✓ synced'); }catch(err){ setSyncStatus('⚠ offline'); } }
async function pullMinnaCloud(){ try{ const r=await api('/v1/progress/'+MINNA_APP_KEY); if(r&&r.data&&typeof r.data==='object'){ state.minnaStore=Object.assign({},MINNA_DEFAULT,r.data,{notes:r.data.notes||{}, overlays:r.data.overlays||{}}); saveMinnaLocal(); }else if(Object.keys(state.minnaStore.notes||{}).length||Object.keys(state.minnaStore.overlays||{}).length){ await pushMinnaCloud(); } }catch(err){/* offline — keep local notes */} }

// --- Native-audio playback. One reused <audio>; same-origin so the session
//     cookie travels and /v1/minna/audio authorizes. Clicking a playing button
//     stops it (toggle). The .playing class lights the button. ---
let mnAudioEl=null, mnPlayingBtn=null;
function mnPlay(src, btn){
  // Minna native audio is cookie-gated, so cross-origin it must send credentials —
  // crossOrigin='use-credentials' makes the <audio> fetch include the cookie AND
  // require an origin-scoped Allow-Credentials response (never '*'). See the API CORS branch.
  if(!mnAudioEl){ mnAudioEl=new Audio(); mnAudioEl.crossOrigin='use-credentials'; }
  if(btn && btn===mnPlayingBtn && !mnAudioEl.paused){ mnAudioEl.pause(); btn.classList.remove('playing'); mnPlayingBtn=null; return; }
  if(mnPlayingBtn)mnPlayingBtn.classList.remove('playing');
  mnAudioEl.src=API_BASE+'/v1/minna/audio?src='+encodeURIComponent(src);
  mnPlayingBtn=btn||null; if(btn)btn.classList.add('playing');
  mnAudioEl.onended=mnAudioEl.onerror=()=>{ if(mnPlayingBtn){mnPlayingBtn.classList.remove('playing');mnPlayingBtn=null;} };
  mnAudioEl.play().catch(()=>{ if(btn)btn.classList.remove('playing'); mnPlayingBtn=null; });
}
const mnAudioBtn=(src)=> src?`<button class="speak-btn" type="button" data-aud="${escapeHtml(src)}" aria-label="Play native audio" title="Play native audio"><svg class="ic" aria-hidden="true"><use href="#i-volume"/></svg></button>`:'';

// --- Vocab → deck activation (via the custom-verb state.store). ---
// Build a deck card from a Minna vocab item, using the DICTIONARY form as the
// headword (the deck is dictionary-form; the textbook ます-form is kept in tip).
function minnaCard(item, lesson){
  // Tags drive both the Browse tag chips and the Source filter facet. Every Minna
  // card carries みんなの日本語 + its lesson; words flagged `italki:true` in the
  // lesson JSON (the subset actually covered in the maintainer's iTalki lessons)
  // also get the iTalki tag + a boolean flag the Source facet matches on.
  const tags=['みんなの日本語','mnn-l'+lesson];
  if(item.italki)tags.push('iTalki');
  // Textbook-form provenance note (ます-form + usage frame), kept in the tip.
  const tb='みんなの日本語 L'+lesson+' · textbook form: '+(item.kanji||item.kana)+(item.context?' '+item.context:'');
  return {
    jp: item.dict || item.kanji || item.kana,
    read: item.dictRead || item.kana,
    mean: item.mean,
    cat: item.cat || 'noun',
    type: item.type || '',
    jlpt: item.jlpt || 'N4',
    trans: item.trans || '',
    tags,
    // Rich content from the (curated/generated) lesson JSON — brings Minna cards to
    // parity with the built-ins. Empty/null when not yet generated.
    mnem: item.mnem || '',
    tip: item.tip ? (item.tip+'<br><br>'+tb) : tb,
    levels: item.levels || null,   // { N5:[jp,en], …, N1:[jp,en] } leveled examples
    accent: item.accent,           // pitch-accent number → the visual pitch marks
    tts: item.tts,                 // optional TTS-text override (ambiguous single kanji)
    ex: [],
    custom:true, minna:true, italki:!!item.italki, minnaKey:item.key, minnaLesson:lesson,
  };
}
// minnaBuiltinRank lives in core/minna.js (reads state.BUILTIN_RANK_BY_JP).
// The overlay payload for a built-in match: provenance only (the built-in keeps its own
// content). Mirrors the tag set minnaCard builds.
function minnaOverlay(item, lesson){
  const tags=['みんなの日本語','mnn-l'+lesson]; if(item.italki)tags.push('iTalki');
  const o={tags, italki:!!item.italki, minnaLesson:lesson, minnaKey:item.key};
  if(item.accent!=null)o.accent=item.accent; if(item.tts)o.tts=item.tts;
  return o;
}
// Overlap words: the only Minna-controlled data on the built-in is tags/italki + accent.
const overlaySig=o=>(o.tags||[]).join('|')+'·i'+(o.italki?1:0)+'·a'+(o.accent??'');
// A word is in the deck if it's a custom card OR an overlay on a built-in.
function minnaInDeck(key){
  if(loadCustom().verbs.some(v=>v.minnaKey===key))return true;
  const ov=(state.minnaStore&&state.minnaStore.overlays)||{};
  return Object.keys(ov).some(r=>ov[r].minnaKey===key);
}
// minnaSig (re-activation content signature) lives in core/minna.js.
// Non-mutating preview of what "Add all vocab to deck" would do: how many words are in
// the deck, new (toAdd), or already-added but carrying stale metadata (toUpdate). Words
// that match a built-in are tracked via the overlay map; the rest via custom cards.
function minnaActivationStatus(lesson, vocab){
  const cs=loadCustom(); const ov=(state.minnaStore&&state.minnaStore.overlays)||{};
  let inDeck=0, toAdd=0, toUpdate=0;
  vocab.forEach(item=>{
    const br=minnaBuiltinRank(item);
    if(br){
      const cur=ov[br];
      if(!cur){ toAdd++; return; }
      inDeck++;
      if(overlaySig(cur)!==overlaySig(minnaOverlay(item,lesson)))toUpdate++;
      return;
    }
    const existing=cs.verbs.find(v=>v.minnaKey===item.key);
    if(!existing){ toAdd++; return; }
    inDeck++;
    if(minnaSig(existing)!==minnaSig(minnaCard(item,lesson)))toUpdate++;
  });
  return {inDeck, total:vocab.length, toAdd, toUpdate};
}
// Activate a lesson's vocab into the deck. Words that match a built-in verb REUSE it
// (an overlay tags the built-in — no bare duplicate; it keeps its examples + mnemonic);
// genuinely-new words become custom cards. Re-activation patches metadata in place
// (preserving rank → SRS progress) so the iTalki tag etc. apply retroactively. Returns
// {added, updated}.
function activateMinnaVocab(lesson, vocab){
  const cs=loadCustom(); const ov=state.minnaStore.overlays=state.minnaStore.overlays||{};
  let added=0, updated=0, custChanged=false, ovChanged=false;
  vocab.forEach(item=>{
    const br=minnaBuiltinRank(item);
    if(br){
      // Reuse the built-in via an overlay; drop any bare duplicate a pre-dedup
      // activation may have created for this word.
      const fresh=minnaOverlay(item,lesson), cur=ov[br];
      if(!cur){ ov[br]=fresh; added++; ovChanged=true; }
      else if(overlaySig(cur)!==overlaySig(fresh)){ ov[br]=Object.assign({},cur,fresh); updated++; ovChanged=true; }
      const di=cs.verbs.findIndex(v=>v.minnaKey===item.key);
      if(di>=0){ cs.verbs.splice(di,1); custChanged=true; }
      return;
    }
    const fresh=minnaCard(item,lesson);
    const existing=cs.verbs.find(v=>v.minnaKey===item.key);
    if(existing){
      const changed=minnaSig(existing)!==minnaSig(fresh);
      Object.assign(existing,{tags:fresh.tags,italki:fresh.italki,mean:fresh.mean,cat:fresh.cat,type:fresh.type,trans:fresh.trans,tip:fresh.tip,levels:fresh.levels,mnem:fresh.mnem,accent:fresh.accent});
      if(changed)updated++; custChanged=true;
      return;
    }
    cs.seq=(cs.seq||100)+1; fresh.rank=cs.seq; cs.verbs.push(fresh); added++; custChanged=true;
  });
  if(custChanged)saveCustom(cs);
  if(ovChanged)saveMinna();
  if(custChanged||ovChanged){ rebuildData(); refreshAfterVerbChange(); }
  return {added, updated};
}
// One-time cleanup of pre-dedup duplicates: any Minna custom card that duplicates a
// built-in becomes an overlay (so the rich built-in represents the word) and the bare
// card is dropped. Idempotent; runs on boot + after a cloud pull, syncs only on change.
function migrateMinnaDupes(){
  const cs=loadCustom(); const ov=state.minnaStore.overlays=state.minnaStore.overlays||{};
  let cChanged=false, oChanged=false;
  for(let i=cs.verbs.length-1;i>=0;i--){
    const v=cs.verbs[i]; if(!v.minna)continue;
    const br=state.BUILTIN_RANK_BY_JP[v.jp]; if(!br)continue;
    if(!ov[br]){ ov[br]={tags:[...(v.tags||[])], italki:!!v.italki, minnaLesson:v.minnaLesson, minnaKey:v.minnaKey}; if(v.accent!=null)ov[br].accent=v.accent; oChanged=true; }
    cs.verbs.splice(i,1); cChanged=true;
  }
  if(cChanged)saveCustom(cs);
  if(oChanged)saveMinna();
  return cChanged||oChanged;
}

// --- Render ---
const minnaLessonCache={};               // n -> lesson JSON (avoids refetch on re-render)
async function fetchMinnaLesson(n){
  if(minnaLessonCache[n])return minnaLessonCache[n];
  const r=await api('/v1/minna/lessons/'+n);
  minnaLessonCache[n]=r; return r;
}
function mnSection(title,count,bodyHtml,open){
  return `<details class="mn-section"${open?' open':''}><summary>${title}${count!=null?` <span class="mn-count">· ${count}</span>`:''}</summary><div class="mn-sec-body">${bodyHtml}</div></details>`;
}
function renderMinnaGate(){
  document.getElementById('mnHead').innerHTML='';
  document.getElementById('mnBody').innerHTML='';
  const g=document.getElementById('mnGate'); g.hidden=false;
  g.innerHTML=`<svg class="ic gate-ic" aria-hidden="true"><use href="#i-book"/></svg>
    <h2>みんなの日本語</h2>
    <p>Your private Minna no Nihongo workbook — vocabulary with native audio, grammar, example sentences and conversation, lesson by lesson. Sign in to open it.</p>
    <button class="chip primary" id="mnSignin"><svg class="ic" aria-hidden="true"><use href="#i-user"/></svg>Sign in</button>`;
  const b=document.getElementById('mnSignin'); if(b)b.addEventListener('click',()=>openAuth('login'));
}
async function renderMinna(){
  if(!account){ renderMinnaGate(); return; }
  document.getElementById('mnGate').hidden=true;
  const head=document.getElementById('mnHead'), body=document.getElementById('mnBody');
  let lessons=[];
  try{ const r=await api('/v1/minna/lessons'); lessons=(r&&r.lessons)||[]; }
  catch(e){ if(e.status===401){ renderMinnaGate(); return; } body.innerHTML='<div class="mn-error">Could not reach the server.</div>'; return; }
  if(!lessons.length){ head.innerHTML=''; body.innerHTML='<div class="mn-error">No lessons have been added yet.</div>'; return; }
  const cur=lessons.includes(state.minnaStore.lastLesson)?state.minnaStore.lastLesson:lessons[0];
  state.minnaStore.lastLesson=cur;
  head.innerHTML=`<div class="mn-kicker">みんなの日本語 · Minna no Nihongo</div>
    <div class="frow"><span class="filter-label">Chapter</span><div class="chips" id="mnChapters" aria-label="Chapter">
      ${lessons.map(n=>`<button class="chip mnch${n===cur?' active':''}" type="button" data-lesson="${n}">L${n}</button>`).join('')}
    </div></div>`;
  head.querySelectorAll('.mnch').forEach(b=>b.addEventListener('click',()=>{ state.minnaStore.lastLesson=Number(b.dataset.lesson); saveMinna(); renderMinna(); }));
  await renderMinnaLesson(cur, body);
}
async function renderMinnaLesson(n, body){
  body.innerHTML='<div class="mn-loading">Loading lesson '+n+'…</div>';
  let L;
  try{ L=await fetchMinnaLesson(n); }
  catch(e){ body.innerHTML='<div class="mn-error">Could not load lesson '+n+(e&&e.status?(' ('+e.status+')'):'')+'.</div>'; return; }
  // Three button states: words still to add → "Add"; all in deck but some carry
  // stale metadata (e.g. a pre-iTalki activation) → "Update N tags" (so the
  // retroactive patch is reachable even when nothing is left to add); all current
  // → disabled "All vocab in your deck".
  const st=minnaActivationStatus(n, L.vocab||[]);
  const btn = st.toAdd ? {ic:'plus',   label:'Add all vocab to deck', dis:''}
    : st.toUpdate     ? {ic:'refresh', label:'Update '+st.toUpdate+' word'+(st.toUpdate===1?'':'s'), dis:''}
    :                   {ic:'check',   label:'All vocab in your deck', dis:' disabled'};
  body.innerHTML=`
    <div class="mn-head" style="margin-top:14px">
      <div class="mn-title">${escapeHtml(L.title||('Lesson '+n))}</div>
      ${L.theme?`<div class="mn-theme">${escapeHtml(L.theme)}</div>`:''}
    </div>
    <div class="mn-actions">
      <button class="chip primary" id="mnAddDeck"${btn.dis}><svg class="ic" aria-hidden="true"><use href="#i-${btn.ic}"/></svg>${btn.label}</button>
      <span class="v-in" id="mnDeckCount">${st.inDeck}/${st.total} in your SRS deck</span>
    </div>
    ${minnaVocabSection(L)}
    ${minnaGrammarSection(L)}
    ${minnaExamplesSection(L)}
    ${minnaConversationSection(L)}
    ${minnaNotesSection(n)}`;
  wireMinnaLesson(n, L, body);
}
function minnaVocabSection(L){
  if(!L.vocab||!L.vocab.length)return '';
  const rows=L.vocab.map(v=>`<tr>
      <td class="v-audio">${mnAudioBtn(v.audio)}</td>
      <td><div class="mn-kanji jp">${escapeHtml(v.kanji||v.kana)}</div><div class="mn-kana jp">${escapeHtml(v.kana)}${v.context?` <span class="mn-ctx">${escapeHtml(v.context)}</span>`:''}</div></td>
      <td class="mn-mean">${escapeHtml(v.mean)}<span class="mn-pos">${escapeHtml(CAT_LABEL[v.cat]||v.cat||'')}</span>${v.italki?'<span class="mn-italki" title="Covered in your iTalki lesson">iTalki</span>':''}</td>
      <td style="text-align:right">${minnaInDeck(v.key)?'<span class="v-in">✓</span>':''}</td>
    </tr>`).join('');
  return mnSection('Vocabulary', L.vocab.length, `<table class="mn-vocab"><tbody>${rows}</tbody></table>`, true);
}
function minnaExampleRows(list){
  return `<div class="mn-ex">${list.map(e=>`<div><div class="e-jp jp">${escapeHtml(e.jp)}</div><div class="e-en">${escapeHtml(e.en)}</div></div>`).join('')}</div>`;
}
function minnaGrammarSection(L){
  if(!L.grammar||!L.grammar.length)return '';
  const items=L.grammar.map(g=>`<div class="mn-gram">
      <div class="mn-pattern jp">${escapeHtml(g.pattern)}</div>
      ${g.structure?`<div class="mn-structure jp">${escapeHtml(g.structure)}</div>`:''}
      ${g.explain?`<div class="mn-explain">${escapeHtml(g.explain)}</div>`:''}
      ${g.examples&&g.examples.length?minnaExampleRows(g.examples):''}
    </div>`).join('');
  return mnSection('Grammar', L.grammar.length, items, true);
}
function minnaExamplesSection(L){
  if(!L.examples||!L.examples.length)return '';
  return mnSection('Example sentences', L.examples.length, minnaExampleRows(L.examples), false);
}
function minnaConversationSection(L){
  const c=L.conversation; if(!c||!c.lines||!c.lines.length)return '';
  const head=c.title?`<div class="mn-theme jp" style="margin:0 0 8px">${escapeHtml(c.title)}</div>`:'';
  const audio=c.audio?`<div class="mn-conv-audio">${mnAudioBtn(c.audio)}<span>Play the whole conversation</span></div>`:'';
  const lines=c.lines.map(ln=>`<div class="mn-line"><div class="mn-role">${escapeHtml(ln.role||'')}</div><div><div class="l-jp jp">${escapeHtml(ln.jp)}</div><div class="l-en">${escapeHtml(ln.en)}</div></div></div>`).join('');
  return mnSection('Conversation', c.lines.length, head+audio+lines, false);
}
function minnaNotesSection(n){
  const val=escapeHtml((state.minnaStore.notes&&state.minnaStore.notes[n])||'');
  return mnSection('My notes', null, `<div class="mn-notes"><textarea id="mnNotes" placeholder="Augment this lesson as you study with your tutor — grammar nuances, mistakes to avoid, anything. Synced to your account.">${val}</textarea><div class="mn-saved" id="mnNotesSaved"></div></div>`, false);
}
function wireMinnaLesson(n, L, body){
  body.querySelectorAll('[data-aud]').forEach(b=>b.addEventListener('click',()=>mnPlay(b.dataset.aud,b)));
  const add=body.querySelector('#mnAddDeck');
  if(add)add.addEventListener('click',()=>{
    const {added,updated}=activateMinnaVocab(n, L.vocab||[]);
    renderMinnaLesson(n, body);
    const msg=added ? '✓ added '+added+' word'+(added===1?'':'s')+' to your deck'
      : updated ? '✓ updated '+updated+' word'+(updated===1?'':'s')
      : 'already in your deck';
    setSyncStatus(msg);
  });
  const ta=body.querySelector('#mnNotes');
  if(ta){
    let t=null;
    ta.addEventListener('input',()=>{
      state.minnaStore.notes=state.minnaStore.notes||{}; state.minnaStore.notes[n]=ta.value;
      const s=body.querySelector('#mnNotesSaved'); if(s)s.textContent='saving…';
      if(t)clearTimeout(t);
      t=setTimeout(()=>{ saveMinna(); const e=body.querySelector('#mnNotesSaved'); if(e)e.textContent=account?'saved · synced':'saved on this device'; },500);
    });
  }
}
// provenanceBadge → features/render-helpers.js (imported above).

// ---- Initial paint ----
// The flashcard tab is the default-active panel (its deck count + due banner
// were already computed above). Stats renders lazily on tab-open. Browse needs
// one render now so it's ready the moment the user switches to it.
migrateMinnaDupes(); rebuildData();   // apply local Minna overlays + clean pre-dedup dupes
renderBrowse();
// Kick off the session probe / cloud hydration once everything above is wired.
bootAuth();
