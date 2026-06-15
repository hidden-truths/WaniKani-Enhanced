// Tests for the resilient fetch transport (src/net/transport.js): timeout, bounded
// retry with backoff, idempotency-aware retry policy, Retry-After, and the preserved
// fetch contract (cache:'no-store' / credentials:'include' / API_BASE rebase / error shape).
import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, _retryAfterMs, _transportConfig } from '../src/net/transport.js';

// Minimal Response stub (status + json + headers.get).
function res(status, body = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: (k) => headers[k] ?? headers[String(k).toLowerCase()] ?? null },
  };
}
const netError = (msg = 'Failed to fetch') => new TypeError(msg);

let saved;
beforeEach(() => {
  saved = { ..._transportConfig };
  _transportConfig.baseBackoffMs = 1;   // shrink waits so retry tests run in ~ms (real timers)
  _transportConfig.maxBackoffMs = 2;
  _transportConfig.retries = 3;
  _transportConfig.timeoutMs = 10000;
});
afterEach(() => {
  Object.assign(_transportConfig, saved);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('GET returns parsed JSON on 200', async () => {
  const f = vi.fn().mockResolvedValue(res(200, { hello: 'world' }));
  vi.stubGlobal('fetch', f);
  await expect(api('/v1/x')).resolves.toEqual({ hello: 'world' });
  expect(f).toHaveBeenCalledTimes(1);
});

test('preserves cache:no-store + credentials:include + API_BASE rebase + JSON body', async () => {
  const f = vi.fn().mockResolvedValue(res(200, {}));
  vi.stubGlobal('fetch', f);
  await api('/v1/x', { method: 'PUT', body: { a: 1 } });
  const [url, init] = f.mock.calls[0];
  expect(url).toBe('/v1/x');                       // API_BASE is '' under test
  expect(init.cache).toBe('no-store');
  expect(init.credentials).toBe('include');
  expect(init.method).toBe('PUT');
  expect(init.headers['Content-Type']).toBe('application/json');
  expect(init.body).toBe(JSON.stringify({ a: 1 }));
});

test('non-2xx throws Error carrying .status/.code/.body', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    res(409, { code: 'conflict', error: 'stale', data: { x: 1 }, updatedAt: 7 }),
  ));
  const err = await api('/v1/progress/verbs', { method: 'PUT', body: {} }).catch((e) => e);
  expect(err.status).toBe(409);
  expect(err.code).toBe('conflict');
  expect(err.body.updatedAt).toBe(7);
  expect(err.body.data).toEqual({ x: 1 });
});

test('GET retries on network error then succeeds', async () => {
  const f = vi.fn()
    .mockRejectedValueOnce(netError())
    .mockRejectedValueOnce(netError())
    .mockResolvedValue(res(200, { ok: true }));
  vi.stubGlobal('fetch', f);
  await expect(api('/v1/x')).resolves.toEqual({ ok: true });
  expect(f).toHaveBeenCalledTimes(3);
});

test('GET gives up after the retry budget, rethrows the network error (no .status)', async () => {
  const f = vi.fn().mockRejectedValue(netError('down'));
  vi.stubGlobal('fetch', f);
  const err = await api('/v1/x').catch((e) => e);
  expect(err).toBeInstanceOf(TypeError);
  expect(err.status).toBeUndefined();
  expect(f).toHaveBeenCalledTimes(4);   // 1 initial + 3 retries
});

test('5xx is retried (idempotent)', async () => {
  const f = vi.fn()
    .mockResolvedValueOnce(res(503, { code: 'service_unavailable', error: 'x' }))
    .mockResolvedValue(res(200, { ok: 1 }));
  vi.stubGlobal('fetch', f);
  await expect(api('/v1/x')).resolves.toEqual({ ok: 1 });
  expect(f).toHaveBeenCalledTimes(2);
});

test('4xx is NOT retried', async () => {
  const f = vi.fn().mockResolvedValue(res(400, { code: 'validation_error', error: 'bad' }));
  vi.stubGlobal('fetch', f);
  const err = await api('/v1/x').catch((e) => e);
  expect(err.status).toBe(400);
  expect(f).toHaveBeenCalledTimes(1);
});

test('POST is NOT retried by default', async () => {
  const f = vi.fn().mockRejectedValue(netError());
  vi.stubGlobal('fetch', f);
  await api('/v1/sessions', { method: 'POST', body: {} }).catch(() => {});
  expect(f).toHaveBeenCalledTimes(1);
});

test('POST IS retried when opts.retry is true', async () => {
  const f = vi.fn().mockRejectedValueOnce(netError()).mockResolvedValue(res(200, { ok: 1 }));
  vi.stubGlobal('fetch', f);
  await expect(api('/v1/sentences', { method: 'POST', body: {}, retry: true })).resolves.toEqual({ ok: 1 });
  expect(f).toHaveBeenCalledTimes(2);
});

test('PUT (idempotent) is retried by default', async () => {
  const f = vi.fn().mockRejectedValueOnce(netError()).mockResolvedValue(res(200, { ok: 1 }));
  vi.stubGlobal('fetch', f);
  await expect(api('/v1/progress/verbs', { method: 'PUT', body: {} })).resolves.toEqual({ ok: 1 });
  expect(f).toHaveBeenCalledTimes(2);
});

test('timeout aborts the attempt (no .status); retries:0 → a single attempt', async () => {
  // fetch hangs but rejects when the abort signal fires.
  const f = vi.fn((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }));
  vi.stubGlobal('fetch', f);
  const err = await api('/v1/x', { timeoutMs: 5, retries: 0 }).catch((e) => e);
  expect(err.name).toBe('AbortError');
  expect(err.status).toBeUndefined();
  expect(f).toHaveBeenCalledTimes(1);
});

test('_retryAfterMs parses delta-seconds, HTTP-date, and missing', () => {
  expect(_retryAfterMs(res(429, {}, { 'Retry-After': '2' }))).toBe(2000);
  expect(_retryAfterMs(res(429, {}, {}))).toBeNull();
  const ms = _retryAfterMs(res(429, {}, { 'Retry-After': new Date(Date.now() + 3000).toUTCString() }));
  expect(ms).toBeGreaterThan(1000);
  expect(ms).toBeLessThanOrEqual(3000);
});

test('429 waits for Retry-After before retrying', async () => {
  vi.useFakeTimers();
  const f = vi.fn()
    .mockResolvedValueOnce(res(429, { code: 'rate_limited', error: 'slow' }, { 'Retry-After': '2' }))
    .mockResolvedValue(res(200, { ok: 1 }));
  vi.stubGlobal('fetch', f);
  const p = api('/v1/x');
  await vi.advanceTimersByTimeAsync(1900);
  expect(f).toHaveBeenCalledTimes(1);            // still inside the 2000ms Retry-After wait
  await vi.advanceTimersByTimeAsync(200);         // cross 2000ms
  await expect(p).resolves.toEqual({ ok: 1 });
  expect(f).toHaveBeenCalledTimes(2);
});

test('rawBody is sent verbatim with its Content-Type (binary upload), not JSON-encoded (E3)', async () => {
  const f = vi.fn().mockResolvedValue(res(200, { ok: true, takes: [] }));
  vi.stubGlobal('fetch', f);
  const blob = { fake: 'blob' };   // stand-in object the transport must pass through untouched
  await api('/v1/audio/recordings?idem=x', { method: 'POST', rawBody: blob, contentType: 'audio/webm', retry: true });
  const [url, init] = f.mock.calls[0];
  expect(url).toBe('/v1/audio/recordings?idem=x');
  expect(init.method).toBe('POST');
  expect(init.body).toBe(blob);                          // the blob itself — NOT JSON.stringify'd
  expect(init.headers['Content-Type']).toBe('audio/webm');
  expect(init.credentials).toBe('include');
  expect(init.cache).toBe('no-store');
});

test('a rawBody POST with retry:true retries a transient failure (idempotency-key-safe) (E3)', async () => {
  const f = vi.fn().mockRejectedValueOnce(netError()).mockResolvedValue(res(200, { ok: 1 }));
  vi.stubGlobal('fetch', f);
  await expect(api('/v1/audio/recordings?idem=y', { method: 'POST', rawBody: { b: 1 }, contentType: 'audio/webm', retry: true }))
    .resolves.toEqual({ ok: 1 });
  expect(f).toHaveBeenCalledTimes(2);
});
