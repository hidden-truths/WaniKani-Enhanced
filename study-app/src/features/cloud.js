// CLOUD ACCOUNTS + SYNC — the feature layer over cloud-core. The app works fully offline
// against localStorage; signing in mirrors progress to the API so it follows the user across
// devices. THREE debounced synced blobs (server-wins on login): 'verbs' (state.store),
// 'custom-verbs', 'settings'; plus the Minna blob (handled in minna.js) and the durable
// POST /v1/sessions log. The persistence layer schedules pushes via the sync bus, which this
// module's initCloud() wires up.
import { state } from '../state.js';
import { escapeHtml } from '../core/index.js';
import { sync } from '../sync-bus.js';
import { account, setAccount, api, setSyncStatus, serverReachable, setServerReachable } from './cloud-core.js';
import { saveLocal } from '../persistence/store.js';
import { loadCustom, saveCustomLocal } from '../persistence/custom.js';
import { settings, setSettings, DEFAULT_SETTINGS, saveSettingsLocal, applyFurigana } from '../settings-store.js';
import { cfg, updateDeckCount, updateDueBanner, paintPrefChips } from './deck.js';
import { renderBrowse } from './browse.js';
import { renderStats } from './stats.js';
import { rebuildData, renderCustomCount, refreshAfterVerbChange } from './custom-cards.js';
import { registerSessionHooks } from './flashcard.js';
import { pullMinnaCloud, migrateMinnaDupes, renderMinna } from './minna.js';
import { renderSettings } from './settings-page.js';

const APP_KEY = 'verbs';            // progress namespace on the server
const CUSTOM_APP_KEY = 'custom-verbs'; // custom-card-definitions namespace
const SETTINGS_APP_KEY = 'settings'; // synced preferences namespace
let authMode = 'login';             // 'login' | 'register' — current modal mode
let syncTimer = null, customSyncTimer = null, settingsSyncTimer = null;

// --- Progress sync (the `verbs` blob = state.store). Debounced; coalesces the rapid save()
//     calls during a session into one PUT. ---
function scheduleCloudSync() { if (!account) return; if (syncTimer) clearTimeout(syncTimer); syncTimer = setTimeout(pushCloud, 1200); }
async function pushCloud() { if (!account) return; setSyncStatus('saving…'); try { await api('/v1/progress/' + APP_KEY, { method: 'PUT', body: { data: state.store } }); setSyncStatus('✓ synced'); } catch (err) { setSyncStatus('⚠ offline'); } }

// --- Custom-card sync (separate namespace; add/edit/delete all propagate via saveCustom). ---
function scheduleCustomSync() { if (!account) return; if (customSyncTimer) clearTimeout(customSyncTimer); customSyncTimer = setTimeout(pushCustomCloud, 1200); }
async function pushCustomCloud() { if (!account) return; setSyncStatus('saving…'); try { await api('/v1/progress/' + CUSTOM_APP_KEY, { method: 'PUT', body: { data: loadCustom() } }); setSyncStatus('✓ synced'); } catch (err) { setSyncStatus('⚠ offline'); } }
// Pull custom cards after sign-in. Server wins when it has any; a fresh account seeds the
// cloud from local. Writes via saveCustomLocal() so hydration doesn't immediately re-push.
async function pullCustomCloud() {
  try {
    const r = await api('/v1/progress/' + CUSTOM_APP_KEY);
    if (r && r.data && Array.isArray(r.data.verbs)) { saveCustomLocal({ seq: r.data.seq || 100, verbs: r.data.verbs }); rebuildData(); }
    else if (loadCustom().verbs.length) { await pushCustomCloud(); }     // new account — seed from local
  } catch (err) {/* offline — keep local custom cards */}
}

// --- Settings sync (separate namespace; same server-wins-on-login model). ---
function scheduleSettingsSync() { if (!account) return; if (settingsSyncTimer) clearTimeout(settingsSyncTimer); settingsSyncTimer = setTimeout(pushSettingsCloud, 1200); }
async function pushSettingsCloud() { if (!account) return; setSyncStatus('saving…'); try { await api('/v1/progress/' + SETTINGS_APP_KEY, { method: 'PUT', body: { data: settings } }); setSyncStatus('✓ synced'); } catch (err) { setSyncStatus('⚠ offline'); } }
async function pullSettingsCloud() {
  try {
    const r = await api('/v1/progress/' + SETTINGS_APP_KEY);
    if (r && r.data && typeof r.data === 'object') {
      setSettings(Object.assign({}, DEFAULT_SETTINGS, r.data));   // export let — reassign via the setter
      saveSettingsLocal(); applyFurigana(); paintPrefChips(); renderSettings();
    } else { await pushSettingsCloud(); }   // new account — seed from local
  } catch (err) {/* offline — keep local settings */}
}

// Pull server progress after sign-in. Server wins when it has data; a fresh account inherits
// whatever's local (one-time migration upward). Then chain the other blobs.
async function pullCloud() {
  try {
    const r = await api('/v1/progress/' + APP_KEY);
    if (r && r.data && r.data.cards) {
      state.store = { cards: r.data.cards || {}, sessions: r.data.sessions || [], daily: r.data.daily || {} };
      saveLocal();                 // mirror to localStorage WITHOUT re-pushing
      setSyncStatus('✓ synced');
    } else { await pushCloud(); }   // new account — seed from local
  } catch (err) { setSyncStatus('⚠ offline'); }
  await pullCustomCloud();          // custom cards + settings + minna share the sign-in pull
  await pullSettingsCloud();
  await pullMinnaCloud();
  migrateMinnaDupes(); rebuildData();   // apply pulled Minna overlays + clean any dupes
  refreshAllViews();
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
  setAccount(null); updateAccountChip(); setSyncStatus('');
}

// Boot: probe the session and hydrate from cloud if signed in. We deliberately do NOT show
// the sign-up nudge here — a new visitor sees the app first and is nudged only AFTER their
// first session (maybeShowSignup, from endSession), which converts better.
export async function bootAuth() {
  try { const r = await api('/v1/auth/me'); setAccount((r && r.user) ? r.user : null); }
  catch (e) { setServerReachable(false); setAccount(null); }
  updateAccountChip();
  if (account) { await pullCloud(); return; }
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
  sync.progress = scheduleCloudSync;
  sync.custom = scheduleCustomSync;
  sync.settings = scheduleSettingsSync;
  registerSessionHooks({ logSession, maybeShowSignup });

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
