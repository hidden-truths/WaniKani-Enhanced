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

// Polite rate limit. IK is free + community-supported; don't hammer.
// 50ms = ~20 req/sec ceiling. The original 500ms (~2 req/sec) made cold
// lazy-fill feel sluggish in the userscript (16 IK calls per word × 500ms
// floor = ~8s of pure throttle wait). Dropped to 50ms so interactive
// lazy-fills come back in ~1s instead of 5–6s; bulk warm is still bounded
// by IK's actual response time and our 4-wide per-word concurrency.
// Revisit upward if IK ever pushes back (429s, IP blocks).
let lastIkCallAt = 0;
const MIN_GAP_MS = 50;

async function rateLimit() {
    const gap = Date.now() - lastIkCallAt;
    if (gap < MIN_GAP_MS) await sleep(MIN_GAP_MS - gap);
    lastIkCallAt = Date.now();
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    await rateLimit();
    const res = await fetch(url, init);
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
    await rateLimit();
    try {
        const res = await fetch(url, {
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
