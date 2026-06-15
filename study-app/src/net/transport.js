// Resilient fetch transport — the single network choke-point for the study app.
// Wraps fetch with a per-request timeout (AbortController), bounded retry with
// exponential backoff + full jitter, and a 429 `Retry-After` honor.
//
// IDEMPOTENCY-AWARE: GET/PUT/DELETE retry by default (our server treats them as
// idempotent — full-replace PUTs, by-id DELETEs); POST retries ONLY when the caller
// passes { retry: true }, and only for endpoints the server dedups (POST /v1/sentences
// by ext_id, /realize by hash). A POST that appends a row (POST /v1/sessions, the
// recording upload, auth) must NOT opt in — a retry would duplicate it.
//
// Contract preserved verbatim from the old cloud-core api():
//   - rebase every path onto API_BASE (the app is cross-ORIGIN from the API);
//   - credentials:'include' (the session cookie rides — the two are same-SITE);
//   - cache:'no-store' — LOAD-BEARING. Without it Chrome can serve a stale cached
//     payload for the full max-age window; a rename that mangles the string throws an
//     invalid-RequestCache TypeError that surfaces only signed-in. Do NOT touch it.
//   - throws an Error with .status/.code on a non-2xx response; a network failure (or
//     a timeout abort) throws with NO .status, which the UI treats as "unreachable".
// ADDS .body (the parsed JSON body) to the thrown error so a 409 reconcile can read the
// server's current { data, updatedAt } without a second round-trip.

import { API_BASE } from '../config.js';

// Tunable knobs, mutable so tests can shrink the waits (mirrors the server's
// `_ikFetchConfig` test-seam idiom). Production code never reassigns these.
export const _transportConfig = {
  timeoutMs: 10000,    // per-attempt timeout
  retries: 3,          // retry budget for transient failures (idempotent / opted-in)
  baseBackoffMs: 300,  // backoff = jitter(min(maxBackoffMs, base * 2^attempt))
  maxBackoffMs: 5000,
};

// Methods safe to auto-retry. POST is excluded by design (opt-in per call).
const IDEMPOTENT = new Set(['GET', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Exponential backoff with full jitter, capped at maxBackoffMs.
function backoff(attempt) {
  const ceil = Math.min(_transportConfig.maxBackoffMs, _transportConfig.baseBackoffMs * 2 ** attempt);
  return Math.floor(Math.random() * ceil);
}

// Parse a `Retry-After` header (delta-seconds or an HTTP-date) → ms, or null if absent
// /unparseable. Exported (underscore-prefixed) for direct unit testing.
export function _retryAfterMs(res) {
  const h = res && res.headers && res.headers.get && res.headers.get('Retry-After');
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(h);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return null;
}

// One fetch attempt with a timeout. Returns the Response (any status), or throws a
// network error (incl. an AbortError when the timeout fires).
async function fetchOnce(path, method, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(API_BASE + path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'include',
      cache: 'no-store',
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function api(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const timeoutMs = opts.timeoutMs ?? _transportConfig.timeoutMs;
  const maxRetries = opts.retries ?? _transportConfig.retries;
  // Idempotent methods retry by default; POST only when explicitly opted in. An
  // explicit opts.retry (true/false) always wins.
  const mayRetry = opts.retry !== undefined ? !!opts.retry : IDEMPOTENT.has(method);

  let attempt = 0;
  for (;;) {
    let res;
    try {
      res = await fetchOnce(path, method, opts.body, timeoutMs);
    } catch (netErr) {
      // Network failure or timeout abort — retry if allowed, else rethrow (no .status).
      if (mayRetry && attempt < maxRetries) {
        await sleep(backoff(attempt++));
        continue;
      }
      throw netErr;
    }

    // Transient server statuses: 429 + 5xx. Retry (idempotent / opted-in) within budget;
    // a 429 prefers its Retry-After over the computed backoff.
    if ((res.status === 429 || res.status >= 500) && mayRetry && attempt < maxRetries) {
      const wait = res.status === 429 ? (_retryAfterMs(res) ?? backoff(attempt)) : backoff(attempt);
      attempt++;
      await sleep(wait);
      continue;
    }

    // Terminal (2xx, a non-retryable 4xx, or retries exhausted): parse + return / throw.
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error((data && data.error) || ('HTTP ' + res.status));
      err.code = data && data.code;
      err.status = res.status;
      err.body = data;   // parsed body — lets a 409 reconcile read { data, updatedAt }
      throw err;
    }
    return data;
  }
}
