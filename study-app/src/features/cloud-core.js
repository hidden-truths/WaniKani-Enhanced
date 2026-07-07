// Cloud bottom-layer: the session identity + the fetch wrapper + the sync-status readout.
// Separated from the cloud FEATURE (sync trios + auth UI in cloud.js) so modules that only
// need to talk to the API — minna, settings-page, flashcard's logSession — can import this
// without cycling against the full cloud orchestration.

// The resilient fetch wrapper (timeout + retry + backoff) lives in net/transport.js; it's
// re-exported here so the existing `import { api } from './cloud-core.js'` sites are unchanged.
export { api } from '../net/transport.js';

// account: {id,email} when signed in, else null. `export let` — only the auth flow (cloud.js)
// reassigns it via setAccount; everyone else reads the live binding.
export let account = null;
export function setAccount(a) { account = a; }

export let serverReachable = true;   // false after a failed /me probe (e.g. server down)
export function setServerReachable(v) { serverReachable = v; }

// Sync/feedback messages ("saving…", "✓ synced", "✓ recording saved", "⚠ offline", …) are
// TRANSIENT — shown as a brief pill in the navbar and auto-cleared after a few seconds, so the
// account button's cloud icon carries the persistent "signed-in/synced" state without a lingering
// "✓ synced" label beside it. Passing a falsy value clears immediately. Pass `{sticky:true}` for a
// message that must NOT auto-clear (e.g. "session expired") — it stays until the next setSyncStatus.
let syncClearTimer = null;
export function setSyncStatus(t, opts) {
  const el = document.getElementById('syncStatus'); if (!el) return;
  el.textContent = t || '';
  if (syncClearTimer) { clearTimeout(syncClearTimer); syncClearTimer = null; }
  if (t && !(opts && opts.sticky)) syncClearTimer = setTimeout(() => { el.textContent = ''; syncClearTimer = null; }, 2600);
}

// Session-expiry seam. A background sync that 401s means the session cookie died server-side while
// the app still believes it's signed in — every subsequent save would silently strand in
// localStorage. cloud.js registers the real handler (clear account + flip the avatar + prompt
// re-auth); synced-blob calls handleAuthExpired() on a 401 so the low-level sync layer needn't
// import the auth UI. Idempotent: no-op once already signed out, so parallel 401s (pullAll fans out)
// only fire it once.
let authExpiredHandler = null;
export function setAuthExpiredHandler(fn) { authExpiredHandler = fn; }
export function handleAuthExpired() {
  if (!account) return;
  if (authExpiredHandler) authExpiredHandler();
}
