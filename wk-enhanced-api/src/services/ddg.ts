// DuckDuckGo image search. Two-step:
//   1. GET the search HTML page, scrape the `vqd` token.
//   2. GET /i.js?vqd=... for the JSON results.
//
// Returns up to 10 image URLs for `<word> イラスト` (illustration). The
// userscript uses these as the fallback image pool when IK has no screenshot
// for a sentence, and as the cycle-through pool when the user clicks ⟳.

import { log } from '../lib/log.ts';

const SEARCH_URL = 'https://duckduckgo.com/';
const IMAGES_URL = 'https://duckduckgo.com/i.js';
const MAX_IMAGES = 10;

export async function ddgSearchImages(word: string): Promise<string[]> {
    const query = `${word} イラスト`;
    // Step 1: scrape vqd. DDG occasionally rotates the surrounding HTML, but
    // the token format itself is stable: `vqd="N-N-N..."` or `vqd='...'`.
    const htmlRes = await fetch(`${SEARCH_URL}?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
        signal: AbortSignal.timeout(10_000),
    });
    if (!htmlRes.ok) {
        log.warn('ddg.vqd_fetch_failed', { word, status: htmlRes.status });
        return [];
    }
    const html = await htmlRes.text();
    const vqdMatch = html.match(/vqd=["']?(\d-[\d-]+)/);
    if (!vqdMatch) {
        log.warn('ddg.vqd_not_found', { word });
        return [];
    }
    const vqd = vqdMatch[1];

    // Step 2: JSON results.
    const params = new URLSearchParams({
        l: 'us-en',
        o: 'json',
        q: query,
        vqd,
        f: ',,,',
        p: '-1',
    });
    const jsonRes = await fetch(`${IMAGES_URL}?${params.toString()}`, {
        signal: AbortSignal.timeout(10_000),
    });
    if (!jsonRes.ok) {
        log.warn('ddg.json_fetch_failed', { word, status: jsonRes.status });
        return [];
    }
    const data = (await jsonRes.json()) as { results?: Array<{ image?: string; thumbnail?: string }> };
    const urls: string[] = [];
    for (const r of data.results ?? []) {
        const u = r.image || r.thumbnail;
        if (u) urls.push(u);
        if (urls.length >= MAX_IMAGES) break;
    }
    return urls;
}

// Fetch a single image URL and return its bytes. Returns null on failure;
// we treat each DDG URL as best-effort since some redirect / 403 / are dead.
export async function ddgFetchImage(url: string): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
    try {
        const res = await fetch(url, {
            // Referer helps with anti-hotlink on some hosts.
            headers: { Referer: 'https://duckduckgo.com/' },
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return null;
        const buffer = await res.arrayBuffer();
        if (buffer.byteLength < 256) return null; // probably an error page
        const contentType = res.headers.get('content-type') || 'image/jpeg';
        return { buffer, contentType };
    } catch {
        return null;
    }
}
