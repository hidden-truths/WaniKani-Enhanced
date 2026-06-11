// Cloud bottom-layer: the session identity + the fetch wrapper + the sync-status readout.
// Separated from the cloud FEATURE (sync trios + auth UI in cloud.js) so modules that only
// need to talk to the API — minna, settings-page, flashcard's logSession — can import this
// without cycling against the full cloud orchestration.
import { API_BASE } from '../config.js';

// account: {id,email} when signed in, else null. `export let` — only the auth flow (cloud.js)
// reassigns it via setAccount; everyone else reads the live binding.
export let account = null;
export function setAccount(a) { account = a; }

export let serverReachable = true;   // false after a failed /me probe (e.g. server down)
export function setServerReachable(v) { serverReachable = v; }

// Thin JSON fetch wrapper. Throws an Error carrying .status/.code on non-2xx; a network
// failure throws fetch's TypeError (no .status), which the UI treats as "server unreachable".
// EVERY call goes through API_BASE (the app is cross-ORIGIN from the API) with
// credentials:'include' (the session cookie rides because the two are same-SITE).
// `cache:'no-store'` is LOAD-BEARING — without it Chrome can serve a stale cached payload
// for the full max-age window. Do NOT remove it, and do NOT let a rename mangle the string.
export async function api(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    method: opts.method || 'GET',
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'include',
    cache: 'no-store',
  });
  let data = null; try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    const err = new Error((data && data.error) || ('HTTP ' + res.status));
    err.code = data && data.code; err.status = res.status; throw err;
  }
  return data;
}

export function setSyncStatus(t) { const el = document.getElementById('syncStatus'); if (el) el.textContent = t; }
