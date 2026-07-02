// CLOUD ACCOUNTS + SYNC — the feature layer over cloud-core. The app works fully offline
// against localStorage; signing in mirrors progress to the API so it follows the user across
// devices. FIVE debounced synced blobs are defined here (server-wins on login): 'verbs'
// (state.store), 'custom-verbs', 'settings', 'selftalk', 'songs'; plus the three defined beside
// their state ('minna' in minna.js, 'wanikani' in wanikani/store.js, 'jlpt' in jlpt/store.js —
// EIGHT in all, every one listed in blobRegistry below) and the durable POST /v1/sessions log.
// The persistence layer schedules pushes via the sync bus, which this module's initCloud() wires up.
import { state } from '../state.js';
import { mergeProgress, mergeCustomVerbs, mergeSelftalkPractice, mergeSongs } from '../core/index.js';
import { sync } from '../sync-bus.js';
import { account, setAccount, api, setSyncStatus, serverReachable, setServerReachable } from './cloud-core.js';
import { createSyncedBlob } from './synced-blob.js';
import * as queue from '../net/sync-queue.js';
import { createSyncOrchestrator } from '../net/sync-orchestrator.js';
import { migrateSelftalkPhrases, migrateCardExamples } from './cloud-migrations.js';
import { saveLocal } from '../persistence/store.js';
import { loadCustom, saveCustomLocal } from '../persistence/custom.js';
import { normalizeSelftalk, saveSelftalkLocal } from '../persistence/selftalk.js';
import { normalizeSongs, saveSongsLocal } from '../persistence/songs.js';
import { refreshPhrases as refreshSelftalkPhrases, renderSelftalk } from './selftalk.js';
import { settings, setSettings, DEFAULT_SETTINGS, saveSettingsLocal, applyFurigana } from '../settings-store.js';
import { cfg, updateDeckCount, updateDueBanner, paintPrefChips } from './deck.js';
import { renderBrowse } from './browse.js';
import { renderStats } from './stats.js';
import { rebuildData, renderCustomCount, refreshAfterVerbChange } from './custom-cards.js';
import { registerSessionHooks } from './flashcard.js';
import { migrateMinnaDupes, renderMinna, minnaBlob } from './minna.js';
import { renderSettings } from './settings-page.js';
import { renderSongs } from './songs.js';
import { wanikaniBlob } from './wanikani.js';
import { jlptBlob, renderJlpt } from './jlpt.js';

const APP_KEY = 'verbs';            // progress namespace on the server
const CUSTOM_APP_KEY = 'custom-verbs'; // custom-card-definitions namespace
const SETTINGS_APP_KEY = 'settings'; // synced preferences namespace
const SELFTALK_APP_KEY = 'selftalk'; // 独り言 phrases + practice/streak namespace
const SONGS_APP_KEY = 'songs';      // 歌/Songs per-song progress (starred/shadowed lines) namespace
let authMode = 'login';             // 'login' | 'register' — current modal mode

// The six synced "progress blobs" share one abstraction (createSyncedBlob): debounced push,
// saving/synced/offline status, the durable offline-queue fallback, server-wins-on-pull,
// fresh-account seeding, and 409 optimistic concurrency. Each registers only its read/apply +
// the side-effects unique to it. (Minna's blob lives in minna.js, beside its state.)

// Progress (the `verbs` blob = state.store).
const progressBlob = createSyncedBlob({
  appKey: APP_KEY,
  read: () => state.store,
  apply: (data) => {
    if (data && data.cards) {
      state.store = { cards: data.cards || {}, sessions: data.sessions || [], daily: data.daily || {} };
      saveLocal();                 // mirror to localStorage WITHOUT re-pushing
      setSyncStatus('✓ synced');
      return true;
    }
    return false;
  },
  onOffline: () => setSyncStatus('⚠ offline'),
  merge: mergeProgress,   // E1: union cards/sessions/daily on a 409 instead of dropping local progress
});

// Custom cards (separate namespace; add/edit/delete all propagate via saveCustom).
const customBlob = createSyncedBlob({
  appKey: CUSTOM_APP_KEY,
  read: () => loadCustom(),
  apply: (data) => {
    if (data && Array.isArray(data.verbs)) { saveCustomLocal({ seq: data.seq || 100, verbs: data.verbs }); return true; }
    return false;
  },
  afterPull: () => { rebuildData(); },
  shouldSeed: () => loadCustom().verbs.length > 0,   // new account — seed only if we have local cards
  merge: mergeCustomVerbs,   // E1: union cards by rank (local wins), max seq — never drop a card or reuse a rank
});

// Settings (separate namespace; same server-wins-on-login model).
const settingsBlob = createSyncedBlob({
  appKey: SETTINGS_APP_KEY,
  read: () => settings,
  apply: (data) => {
    if (data && typeof data === 'object') {
      setSettings(Object.assign({}, DEFAULT_SETTINGS, data));   // export let — reassign via the setter
      saveSettingsLocal();
      return true;
    }
    return false;
  },
  afterPull: () => { applyFurigana(); paintPrefChips(); renderSettings(); },
});

// Self-Talk (the 'selftalk' blob carries ONLY the practice/streak signal; user phrases are
// first-class private rows in the sentence store, synced via /v1/sentences). apply returns true
// unconditionally so afterPull's one-time phrase migration runs on every pull (even a fresh
// account with no server practice). selftalkLocalPhrases bridges apply→afterPull (captured before
// the server's practice overwrites state.selftalkStore).
let selftalkLocalPhrases = [];
const selftalkBlob = createSyncedBlob({
  appKey: SELFTALK_APP_KEY,
  read: () => ({ practice: state.selftalkStore.practice }),
  apply: (data) => {
    selftalkLocalPhrases = (state.selftalkStore && state.selftalkStore.phrases) || [];
    if (data && typeof data === 'object' && data.practice) {
      state.selftalkStore = normalizeSelftalk({ practice: data.practice });   // server-wins
    }
    return true;
  },
  afterPull: async (data, opt = {}) => {
    const cloudPhrases = (data && Array.isArray(data.phrases)) ? data.phrases : [];
    const failed = await migrateSelftalkPhrases(selftalkLocalPhrases, cloudPhrases);
    state.selftalkStore.phrases = failed;   // keep only un-migrated (retried next pull); [] when all done
    saveSelftalkLocal();
    if (!opt.reconcile) await selftalkBlob.push();   // the blob now syncs {practice} only
    // Repaint the tab with the migrated rows (refreshSelftalkPhrases re-reads GET /v1/sentences).
    if (await refreshSelftalkPhrases()) {
      const panel = document.getElementById('panel-selftalk');
      if (panel && panel.classList.contains('active')) renderSelftalk();
    }
  },
  merge: mergeSelftalkPractice,   // E1: keep the longer streak / later day on a 409
});

// Songs (the 'songs' blob = state.songsStore): per-song PROGRESS ONLY (starred/shadowed line
// ordinals + the last view cursor). Song CONTENT is server-authoritative (the sentence store), so
// this blob never carries line text — same split as Self-Talk's {practice}-only blob. No migration.
// afterPull re-renders the library so the progress ring reflects the pulled blob if the user is
// sitting on the Songs tab when they sign in.
const songsBlob = createSyncedBlob({
  appKey: SONGS_APP_KEY,
  read: () => state.songsStore,
  apply: (data) => {
    if (data && typeof data === 'object' && data.progress) {
      state.songsStore = normalizeSongs(data);   // server-wins
      saveSongsLocal();                           // mirror to localStorage WITHOUT re-pushing
      return true;
    }
    return false;                                 // fall through to the fresh-account seed
  },
  afterPull: () => { if (document.getElementById('panel-songs').classList.contains('active')) renderSongs(); },
  shouldSeed: () => Object.keys(state.songsStore.progress || {}).length > 0,   // new account — seed only if we have local progress
  merge: mergeSongs,   // E1: union starred/shadowed sets on a 409 (local-wins lastMode) — never drop a shadowed line
});

// ── The synced-blob REGISTRY: the single ordered source of truth that pull / flush / bus-wiring all
// derive from. This used to be three hand-maintained copies of the blob list (pullCloud / flushQueue /
// initCloud), each with minna special-cased — adding a blob meant editing all three, and a drift (a
// blob flushed but not pulled) would false-409 that device forever. A new synced blob is now added in
// exactly ONE place: here. `busKey` is the persistence sync-bus slot the blob's debounced scheduler
// wires onto; minna has none (saveMinna calls minnaBlob.schedule directly). A FUNCTION, not a const,
// because minnaBlob rides the cloud⇄minna import cycle and isn't initialized at this module's eval time
// — the registry is read lazily, at call time. Order is the pull order (preserved verbatim).
function blobRegistry() {
  return [
    { blob: progressBlob, busKey: 'progress' },
    { blob: customBlob,   busKey: 'custom' },
    { blob: settingsBlob, busKey: 'settings' },
    { blob: minnaBlob,    busKey: null },        // off-bus: saveMinna schedules minnaBlob directly
    { blob: selftalkBlob, busKey: 'selftalk' },
    { blob: songsBlob,    busKey: 'songs' },
    { blob: wanikaniBlob, busKey: null },        // off-bus: saveWanikani schedules wanikaniBlob directly
    { blob: jlptBlob,     busKey: null },        // off-bus: saveJlpt schedules jlptBlob directly
  ];
}

// One orchestrator over that registry (net/sync-orchestrator.js): pull-all / flush-all / bus-wire,
// DOM-free + dependency-injected. Memoized lazily — first use is initCloud(), by which point every
// feature module (incl. minna) has evaluated, so minnaBlob is live. `account` is read through a thunk
// so the orchestrator always sees the live sign-in state, never a stale capture.
let _orchestrator = null;
function orchestrator() {
  return _orchestrator || (_orchestrator = createSyncOrchestrator({
    registry: blobRegistry, queue, sync, getAccount: () => account,
  }));
}

// Pull every synced blob after sign-in / boot (server-wins, fresh-account seed; each blob isolated so
// one failure can't block the rest — see pullAll), then run the cross-blob finalizers: apply pulled
// Minna overlays + clean dupes, backfill custom-card examples, and refresh the state.store-derived views.
async function pullCloud() {
  await orchestrator().pullAll();
  migrateMinnaDupes(); rebuildData();   // apply pulled Minna overlays + clean any dupes
  await migrateCardExamples();          // backfill custom-card examples → private store rows (one-time/device)
  refreshAllViews();
}

// Flush the durable offline write-queue for the current account (idempotent replays). On each
// successful replay the orchestrator bumps the owning blob's lastUpdatedAt from the server's response
// (mapped by queueKey off the same registry) so the next live push won't false-conflict. No-op signed
// out. Fire-and-forget callers (the 'online' listener) tolerate the returned promise.
async function flushQueue() {
  await orchestrator().flushAll();
}

// Re-render every state.store-derived view. Mirrors the import handler's refresh set.
function refreshAllViews() {
  updateDeckCount(); updateDueBanner(); renderBrowse(); renderCustomCount();
  if (document.getElementById('panel-stats').classList.contains('active')) renderStats();
  if (document.getElementById('panel-minna').classList.contains('active')) renderMinna();
  if (document.getElementById('panel-jlpt').classList.contains('active')) renderJlpt();
}

// The account avatar (#accountBtn — the round .avatar in the topbar): signed in → the user's
// initial via textContent + the gradient skin; signed out → a muted person glyph + the
// .signed-out skin. The email rides ONLY in the title attribute (set via .title, not innerHTML),
// so the user-controlled string is never HTML-interpolated — no escaping needed.
function updateAccountChip() {
  const btn = document.getElementById('accountBtn');
  if (!btn) return;
  if (account) {
    const initial = ((account.email || '?').trim().charAt(0) || '?').toUpperCase();
    btn.classList.remove('signed-out');
    btn.textContent = initial;
    btn.title = 'Signed in as ' + account.email + ' — click to sign out';
  } else {
    btn.classList.add('signed-out');
    btn.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-user"/></svg>';
    btn.title = 'Sign in to sync progress';
    setSyncStatus('');
  }
  updateDevRoadmapLink();
}

// DEV-ONLY maintainer convenience: a "Roadmap" link in the topbar that opens the repo-root
// ROADMAP.html (the consolidated backlog hub, served by the dev-server middleware in vite.config.js).
// Shown ONLY under `vite dev` (import.meta.env.DEV) AND only for the dev/maintainer account — so it
// never ships in the prod bundle (the guard below is statically false there → dead-code-eliminated)
// and the internal backlog is never served publicly. Allowlist via VITE_DEV_EMAILS (comma-separated);
// defaults to the dev account. Toggled from updateAccountChip() on every sign-in/out/boot.
function updateDevRoadmapLink() {
  if (!import.meta.env.DEV) return;   // statically false in `vite build` → whole body is dead-code-eliminated
  const emails = (import.meta.env.VITE_DEV_EMAILS || 'dylan_j_kelly@icloud.com')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const show = !!account && emails.includes((account.email || '').toLowerCase());
  let link = document.getElementById('devRoadmapLink');
  if (show && !link) {
    const actions = document.querySelector('.top-actions');
    if (!actions) return;
    link = document.createElement('a');
    link.id = 'devRoadmapLink';
    link.className = 'icon-btn';
    link.href = '/ROADMAP.html';
    link.target = '_blank';
    link.rel = 'noopener';
    link.title = 'Project roadmap & backlog (dev only)';
    link.setAttribute('aria-label', 'Project roadmap');
    link.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-list"/></svg>';
    actions.insertBefore(link, document.getElementById('settingsBtn') || null);
  } else if (!show && link) {
    link.remove();
  }
}

/* ---- Auth modal ---- */
export function openAuth(mode) {
  authMode = mode || 'login';
  const login = authMode === 'login';
  document.getElementById('authTitle').textContent = login ? 'Sign in' : 'Create account';
  document.getElementById('authSub').textContent = login
    ? 'Save your progress to the cloud and study from any device.'
    : 'Create an account to back up and sync your progress.';
  document.getElementById('authSubmit').textContent = login ? 'Sign in' : 'Create account';
  document.getElementById('authPass').setAttribute('autocomplete', login ? 'current-password' : 'new-password');
  document.getElementById('authToggleText').textContent = login ? 'New here?' : 'Already have an account?';
  document.getElementById('authToggle').textContent = login ? 'Create an account' : 'Sign in';
  document.getElementById('authErr').textContent = '';
  document.getElementById('authModal').classList.add('show');
  document.getElementById('authEmail').focus();
}
function closeAuth() { document.getElementById('authModal').classList.remove('show'); }

function friendlyAuthError(err) {
  if (err.status === 401) return 'Wrong email or password.';
  if (err.status === 409) return 'That email is already registered — try signing in.';
  if (err.status === 400 || err.code === 'validation_error') return 'Enter a valid email and a password of at least 8 characters.';
  if (err.status === undefined) return 'Could not reach the server. Check your connection and try again.';
  return err.message || 'Something went wrong.';
}

async function doLogout() {
  try { await api('/v1/auth/logout', { method: 'POST' }); } catch (e) {}
  setAccount(null); queue.clear(); updateAccountChip(); setSyncStatus('');   // queued writes are per-account
}

// Boot: probe the session and hydrate from cloud if signed in. We deliberately do NOT show
// the sign-up nudge here — a new visitor sees the app first and is nudged only AFTER their
// first session (maybeShowSignup, from endSession), which converts better.
export async function bootAuth() {
  try { const r = await api('/v1/auth/me'); setAccount((r && r.user) ? r.user : null); }
  catch (e) { setServerReachable(false); setAccount(null); }
  updateAccountChip();
  if (account) { await flushQueue(); await pullCloud(); return; }   // deliver last session's offline writes, then server-wins
}
// Show the dismissible sign-up banner once the user has engaged (finished a session): only
// when signed out, server reachable, and not previously dismissed. No-ops after that.
function maybeShowSignup() {
  if (account || !serverReachable) return;
  if (localStorage.getItem('jpverbs_signup_dismissed') === '1') return;
  document.getElementById('signupBanner').hidden = false;
}
// Append a finished session to the durable server log (signed-in only). Injected into flashcard's
// endSession via registerSessionHooks. `mode` keeps the test direction; `details.kind` carries the
// SRS/free distinction. DURABLE (E2): a client idempotencyKey makes the POST safe to retry + queue,
// so a dropped request (offline / 5xx) no longer silently loses a session — it replays on reconnect
// and the server dedups by key. Keyed per-session so distinct sessions never collapse in the queue.
function logSession(right, tot, kind) {
  if (!account) return;
  const idempotencyKey = crypto.randomUUID();
  const body = { right, total: tot, mode: cfg.mode, details: { kind, direction: cfg.mode }, idempotencyKey };
  api('/v1/sessions', { method: 'POST', body, retry: true })
    .catch(() => queue.enqueue({ key: 'session:' + idempotencyKey, path: '/v1/sessions', method: 'POST', body, accountId: account.id }));
}

// Wire the auth modal + sign-up banner, register the sync schedulers onto the bus, and inject
// the session hooks into flashcard. (bootAuth is kicked off separately, last, from main.)
export function initCloud() {
  orchestrator().wireBus();   // wire each bus-keyed blob's debounced scheduler onto the persistence sync-bus
  registerSessionHooks({ logSession, maybeShowSignup });
  // Flush queued offline writes when connectivity returns. Flush only — no forced pull, which
  // would revert in-progress local edits not yet pushed.
  window.addEventListener('online', () => { flushQueue(); });

  const authModal = document.getElementById('authModal');
  document.getElementById('accountBtn').addEventListener('click', () => {
    if (account) { if (confirm('Sign out? Your progress stays saved in the cloud.')) doLogout(); }
    else openAuth('login');
  });
  document.getElementById('authClose').addEventListener('click', closeAuth);
  document.getElementById('authOffline').addEventListener('click', closeAuth);
  document.getElementById('authToggle').addEventListener('click', () => openAuth(authMode === 'login' ? 'register' : 'login'));
  authModal.addEventListener('click', e => { if (e.target === authModal) closeAuth(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && authModal.classList.contains('show')) closeAuth(); });
  document.getElementById('authForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPass').value;
    const errEl = document.getElementById('authErr'); errEl.textContent = '';
    const submit = document.getElementById('authSubmit'); submit.disabled = true;
    try {
      const path = authMode === 'login' ? '/v1/auth/login' : '/v1/auth/register';
      const r = await api(path, { method: 'POST', body: { email, password } });
      setAccount(r.user); updateAccountChip(); closeAuth();
      document.getElementById('authPass').value = '';
      await pullCloud();
      await flushQueue();
    } catch (err) { errEl.textContent = friendlyAuthError(err); }
    finally { submit.disabled = false; }
  });
  document.getElementById('signupCreate').addEventListener('click', () => {
    document.getElementById('signupBanner').hidden = true; openAuth('register');
  });
  document.getElementById('signupDismiss').addEventListener('click', () => {
    document.getElementById('signupBanner').hidden = true;
    localStorage.setItem('jpverbs_signup_dismissed', '1');
  });
}
