// CLOUD ACCOUNTS + SYNC — the feature layer over cloud-core. The app works fully offline
// against localStorage; signing in mirrors progress to the API so it follows the user across
// devices. THREE debounced synced blobs (server-wins on login): 'verbs' (state.store),
// 'custom-verbs', 'settings'; plus the Minna blob (handled in minna.js) and the durable
// POST /v1/sessions log. The persistence layer schedules pushes via the sync bus, which this
// module's initCloud() wires up.
import { state } from '../state.js';
import { escapeHtml, phraseToSentence, cardExamplesPayload, mergeProgress, mergeCustomVerbs, mergeSelftalkPractice } from '../core/index.js';
import { sync } from '../sync-bus.js';
import { account, setAccount, api, setSyncStatus, serverReachable, setServerReachable } from './cloud-core.js';
import { createSyncedBlob } from './synced-blob.js';
import * as queue from '../net/sync-queue.js';
import { saveLocal } from '../persistence/store.js';
import { loadCustom, saveCustomLocal } from '../persistence/custom.js';
import { normalizeSelftalk, saveSelftalkLocal } from '../persistence/selftalk.js';
import { refreshPhrases as refreshSelftalkPhrases, renderSelftalk } from './selftalk.js';
import { settings, setSettings, DEFAULT_SETTINGS, saveSettingsLocal, applyFurigana } from '../settings-store.js';
import { cfg, updateDeckCount, updateDueBanner, paintPrefChips } from './deck.js';
import { renderBrowse } from './browse.js';
import { renderStats } from './stats.js';
import { rebuildData, renderCustomCount, refreshAfterVerbChange } from './custom-cards.js';
import { registerSessionHooks } from './flashcard.js';
import { pullMinnaCloud, migrateMinnaDupes, renderMinna, minnaBlob } from './minna.js';
import { renderSettings } from './settings-page.js';

const APP_KEY = 'verbs';            // progress namespace on the server
const CUSTOM_APP_KEY = 'custom-verbs'; // custom-card-definitions namespace
const SETTINGS_APP_KEY = 'settings'; // synced preferences namespace
const SELFTALK_APP_KEY = 'selftalk'; // 独り言 phrases + practice/streak namespace
let authMode = 'login';             // 'login' | 'register' — current modal mode

// The five synced "progress blobs" share one abstraction (createSyncedBlob): debounced push,
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

// POST each legacy phrase to the sentence store as a private row; returns the ones that FAILED so
// they stay in the blob for a later retry. POST is idempotent by ext_id (the usr-<uuid> ids), so a
// replay (re-sign-in / another device) is a no-op. Empty input → no-op.
async function migrateSelftalkPhrases(localPhrases, cloudPhrases) {
  const byId = new Map();
  for (const p of cloudPhrases) if (p && p.id) byId.set(p.id, p);
  for (const p of localPhrases) if (p && p.id) byId.set(p.id, p);   // local wins on a dup id
  if (!byId.size) return [];
  const failed = [];
  for (const p of byId.values()) {
    try { await api('/v1/sentences', { method: 'POST', body: phraseToSentence(p), retry: true }); }   // idempotent by ext_id
    catch (err) { failed.push(p); }
  }
  if (byId.size > failed.length) setSyncStatus('✓ phrases migrated');
  return failed;
}

// One-time-per-device backfill: push every existing custom card's examples into the store so it
// becomes the source for ALL example text (Phase 2.5). pushCardExamples keeps them current on every
// save; this catches cards authored before Phase 2.5 / on another device. Flag-gated so it doesn't
// re-run each sign-in; a partial run is harmless (the localStorage blob still renders any card not
// yet migrated) and retried next sign-in until all succeed. Idempotent — the PUT replaces wholesale.
async function migrateCardExamples() {
  if (!account) return;
  if (localStorage.getItem('jpverbs_cardex_migrated')) return;
  const verbs = (loadCustom().verbs || []).filter(v => (v.ex && v.ex.length) || (v.levels && Object.keys(v.levels).length));
  if (!verbs.length) { localStorage.setItem('jpverbs_cardex_migrated', '1'); return; }
  const results = await Promise.allSettled(
    verbs.map(v => api('/v1/sentences/card/' + encodeURIComponent(v.rank), { method: 'PUT', body: cardExamplesPayload(v) })),
  );
  if (results.every(r => r.status === 'fulfilled')) localStorage.setItem('jpverbs_cardex_migrated', '1');
}

// Pull every synced blob after sign-in / boot, in order, then run the cross-blob finalizers.
// Each blob is server-wins with a fresh-account seed; the finalizers apply Minna overlays and
// backfill custom-card examples. (pullMinnaCloud is minnaBlob.pull, re-exported from minna.js.)
async function pullCloud() {
  await progressBlob.pull();
  await customBlob.pull();
  await settingsBlob.pull();
  await pullMinnaCloud();
  await selftalkBlob.pull();
  migrateMinnaDupes(); rebuildData();   // apply pulled Minna overlays + clean any dupes
  await migrateCardExamples();          // backfill custom-card examples → private store rows (one-time/device)
  refreshAllViews();
}

// Flush the durable offline write-queue for the current account (idempotent replays). On each
// successful replay, bump the owning blob's lastUpdatedAt from the server's response so the next
// live push won't false-conflict. The blob registry is built lazily here (not at module top level)
// because minnaBlob is imported across the cloud⇄minna cycle.
async function flushQueue() {
  if (!account) return;
  const byQueueKey = {};
  for (const b of [progressBlob, customBlob, settingsBlob, selftalkBlob, minnaBlob]) byQueueKey[b.queueKey] = b;
  await queue.flush(account.id, (key, r) => {
    const b = byQueueKey[key];
    if (b && r && typeof r.updatedAt === 'number') b._setLastUpdatedAt(r.updatedAt);
  });
}

// Re-render every state.store-derived view. Mirrors the import handler's refresh set.
function refreshAllViews() {
  updateDeckCount(); updateDueBanner(); renderBrowse(); renderCustomCount();
  if (document.getElementById('panel-stats').classList.contains('active')) renderStats();
  if (document.getElementById('panel-minna').classList.contains('active')) renderMinna();
}

function updateAccountChip() {
  const btn = document.getElementById('accountBtn');
  // The account email is escapeHtml'd before interpolation (user-controlled → XSS otherwise).
  if (account) { btn.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-cloud-check"/></svg><span class="nav-acct-name">' + escapeHtml(account.email) + '</span>'; btn.title = 'Signed in — click to sign out'; }
  else { btn.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-user"/></svg><span class="nav-acct-name">Sign in</span>'; btn.title = 'Sign in to sync progress'; setSyncStatus(''); }
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
// Append a finished session to the durable server log (fire-and-forget; signed-in only).
// Injected into flashcard's endSession via registerSessionHooks. `mode` keeps the test
// direction; `details.kind` carries the SRS/free distinction.
function logSession(right, tot, kind) {
  if (!account) return;
  try { api('/v1/sessions', { method: 'POST', body: { right, total: tot, mode: cfg.mode, details: { kind, direction: cfg.mode } } }).catch(() => {}); } catch (e) {}
}

// Wire the auth modal + sign-up banner, register the sync schedulers onto the bus, and inject
// the session hooks into flashcard. (bootAuth is kicked off separately, last, from main.)
export function initCloud() {
  sync.progress = progressBlob.schedule;
  sync.custom = customBlob.schedule;
  sync.settings = settingsBlob.schedule;
  sync.selftalk = selftalkBlob.schedule;
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
