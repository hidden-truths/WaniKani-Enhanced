// ImmersionKit API client. Three endpoints:
//   - /search           — sentence pool for a given word
//   - /index_meta       — canonical encoded-title → {title, category} map
//   - /download_media   — proxy for the audio + image source files
//
// All three are unauthenticated. /download_media requires a Referer header
// spoof; the others don't. See the userscript's CLAUDE.md for the dead-end
// warnings around alternate URL shapes and the direct linode bucket (which
// has been 403 since Aug 2025 — don't try it).

import { sleep } from '../lib/sleep.ts';
import { log } from '../lib/log.ts';

const SEARCH_URL = 'https://apiv2.immersionkit.com/search';
const INDEX_META_URL = 'https://apiv2.immersionkit.com/index_meta';
const DOWNLOAD_MEDIA_URL = 'https://apiv2.immersionkit.com/download_media';

// IK's /download_media proxy returns a near-empty body (XML error or empty
// blob) when the underlying file is missing. The userscript treats <1KB as
// a miss; we match that threshold here.
const MIN_VALID_MEDIA_BYTES = 1024;

export interface IkExample {
    id?: string;
    sentence?: string;
    sentence_with_furigana?: string;
    translation?: string;
    title?: string;
    deck_name?: string;
    word_list?: string[];
    sound?: string;
    image?: string;
    // pass-through: IK has more fields than we use
    [k: string]: unknown;
}

export interface IkSearchResponse {
    examples: IkExample[];
}

export interface IkIndexMetaEntry {
    title: string;
    category: string;
}

// Polite rate limit + 429-with-exponential-backoff. IK is free +
// community-supported; don't hammer.
//
// History (minGapMs):
//   - v0.x: 500ms (~2 req/sec). Safe but made cold lazy-fill feel sluggish
//     in the userscript (~16 IK calls per word × 500ms floor = ~8s of pure
//     throttle wait).
//   - rc2 (2026-05): dropped to 50ms (~20 req/sec) to fix lazy-fill latency.
//   - 2026-05-25, first production bulk warm: IK began returning 429 Too
//     Many Requests across the board after ~5 minutes of sustained 50ms-
//     gated traffic. The whole 6500-word warm completed in 19 minutes with
//     ~100% empty payloads (every ikSearch failed). Even single-word lookups
//     from a *different* curl on the same droplet got 429s for a while.
//   - Current: 500ms again. The DDG-deferred-to-background change (rc2) and
//     the per-word 4-wide media concurrency mean cold lazy-fill is still
//     ~2–4s at 500ms, which is fine. Bulk warm becomes ~1h+ (the README's
//     original projection) but the data isn't garbage.
//
// 429-backoff (added 2026-05-25): every IK call goes through fetchWithRetry,
// which retries 429s with exponential backoff (base 1s, factor 2, cap 30s,
// 3 retries) and honors Retry-After when present. Both fetchJson (search,
// index_meta) and ikDownloadMedia (audio + image proxy) share the same
// retry budget per call. A transient 429 wave during a bulk warm now
// recovers within tens of seconds instead of poisoning the rest of the
// run. We deliberately do NOT retry 5xx — that's a different failure mode
// (server bug, not rate limit) and retrying it here would muddy the
// `warm.ik_search_failed` signal. If we ever need 5xx retry, it's a
// separate change.
//
// Lowering minGapMs below 500ms is still gated on more than just having
// backoff — the rc2 lockout suggested IK has a per-IP soft ceiling that
// kicks in even after backoff recovery. Backoff means a retry burst is
// survivable; it does not mean a sustained higher request rate is.
//
// Test-only knob. Production code MUST NOT mutate this; tests use it to
// shorten retry waits so the suite stays fast. Mirrors the
// `_useDbForTesting` pattern used by db/client.ts.
export const _ikFetchConfig = {
    minGapMs: 500,
    maxRetries: 3,
    baseBackoffMs: 1000,
    maxBackoffMs: 30_000,
};

let lastIkCallAt = 0;

async function rateLimit() {
    const gap = Date.now() - lastIkCallAt;
    if (gap < _ikFetchConfig.minGapMs) await sleep(_ikFetchConfig.minGapMs - gap);
    lastIkCallAt = Date.now();
}

// Parse a Retry-After header value. RFC 7231 §7.1.3 allows either an integer
// number of seconds (e.g. "120") or an HTTP-date (e.g. "Wed, 21 Oct 2015
// 07:28:00 GMT"). Returns the wait in ms, or null if the header is absent
// or unparseable. Capping to maxBackoffMs is the caller's job.
export function parseRetryAfter(header: string | null): number | null {
    if (!header) return null;
    const trimmed = header.trim();
    if (!trimmed) return null;
    // The two RFC forms are mutually exclusive. If the value looks numeric
    // (digits + optional sign/decimal), parse it as seconds and don't fall
    // through to Date.parse — Bun's date parser is lax enough that "-5"
    // resolves to a real (past) date, which would surprise callers.
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(trimmed)) {
        const seconds = Number(trimmed);
        return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
    }
    const target = Date.parse(trimmed);
    if (Number.isFinite(target)) {
        return Math.max(0, target - Date.now());
    }
    return null;
}

// Shared fetch wrapper for every IK call. Applies the minGapMs gate and
// retries 429s with exponential backoff. Returns the final Response — the
// caller decides how to consume the body and how to interpret a non-2xx
// status. Throws only on network/transport errors that `fetch()` itself
// surfaces (DNS, refused connection, AbortSignal trip, etc.); HTTP error
// statuses come back as a Response with res.ok=false.
//
// Don't reset lastIkCallAt during backoff — the post-backoff rateLimit()
// call naturally re-applies the minGapMs gate, and the backoff sleep is
// almost always longer than the gate so we don't pay double.
async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
    const { maxRetries, baseBackoffMs, maxBackoffMs } = _ikFetchConfig;
    for (let attempt = 0; ; attempt++) {
        await rateLimit();
        const res = await fetch(url, init);
        if (res.ok) return res;
        if (res.status !== 429 || attempt >= maxRetries) return res;
        const retryAfterMs = parseRetryAfter(res.headers.get('Retry-After'));
        const expoMs = baseBackoffMs * Math.pow(2, attempt);
        const waitMs = Math.min(retryAfterMs ?? expoMs, maxBackoffMs);
        log.warn('ik.fetch.429_backoff', {
            url,
            attempt: attempt + 1,
            waitMs,
            retryAfter: retryAfterMs,
        });
        await sleep(waitMs);
    }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetchWithRetry(url, init);
    if (!res.ok) {
        throw new Error(`IK fetch ${url} failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
}

export async function ikSearch(word: string): Promise<IkExample[]> {
    const params = new URLSearchParams({
        q: word,
        exactMatch: 'true',
        limit: '1000',
    });
    const raw = await fetchJson<any>(`${SEARCH_URL}?${params.toString()}`);
    // IK v2 returns { examples: [...] }; older versions nested under data[0].
    // Normalize so callers don't have to think about it.
    if (Array.isArray(raw?.examples)) return raw.examples;
    if (Array.isArray(raw?.data?.[0]?.examples)) return raw.data[0].examples;
    if (Array.isArray(raw)) return raw;
    log.warn('ik.search.unexpected_shape', { word, topKeys: Object.keys(raw || {}) });
    return [];
}

export async function ikIndexMeta(): Promise<Record<string, IkIndexMetaEntry>> {
    const raw = await fetchJson<any>(INDEX_META_URL);
    // The current shape is { data: { <encoded>: { title, category, ... }, ... }, lastUpdatedTimestamp }.
    // Be defensive: accept either {data: ...} or a flat object.
    const decks = raw?.data ?? raw;
    if (!decks || typeof decks !== 'object') {
        throw new Error('IK /index_meta returned no decks');
    }
    const out: Record<string, IkIndexMetaEntry> = {};
    for (const [encoded, entry] of Object.entries(decks)) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as { title?: string; category?: string };
        if (e.title && e.category) {
            out[encoded] = { title: e.title, category: e.category };
        }
    }
    return out;
}

export interface MediaFetchResult {
    ok: boolean;
    buffer?: ArrayBuffer;
    contentType?: string;
    error?: string;
}

// Build the proxy URL for an audio or image file. Same shape, different field
// on the example (sound vs image) and different extension. Path segments are
// individually percent-encoded; slashes stay literal.
export function buildDownloadMediaUrl(category: string, folder: string, filename: string): string {
    const segments = ['media', category, folder, 'media', filename];
    const path = segments.map(encodeURIComponent).join('/');
    return `${DOWNLOAD_MEDIA_URL}?path=${path}`;
}

export async function ikDownloadMedia(url: string): Promise<MediaFetchResult> {
    // 429-with-backoff applies here too — most IK traffic in a bulk warm
    // is /download_media, so retrying transient rate-limits here is what
    // closes the loop on most missed media. The 15s AbortSignal is a hard
    // ceiling for the *whole* call (retries cut into the same budget); if
    // backoff would push past 15s the signal trips and we return failure.
    // That's acceptable — media failures leave audioUrl/imageUrl null and
    // the warm completes anyway with the incomplete-payload signal.
    try {
        const res = await fetchWithRetry(url, {
            headers: { Referer: 'https://www.immersionkit.com/' },
            signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
            return { ok: false, error: `${res.status} ${res.statusText}` };
        }
        const contentType = res.headers.get('content-type') || 'application/octet-stream';
        const buffer = await res.arrayBuffer();
        if (buffer.byteLength < MIN_VALID_MEDIA_BYTES) {
            return { ok: false, error: `body too small (${buffer.byteLength}b — likely missing file)` };
        }
        return { ok: true, buffer, contentType };
    } catch (err) {
        return { ok: false, error: (err as Error).message };
    }
}
