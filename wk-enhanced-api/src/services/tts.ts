// Google Translate TTS, used as audio fallback when IK has no `sound` for
// a sentence. Same gtx unauthenticated client + spoofed Referer the userscript
// uses. Google caps input length at ~200 chars; we truncate to match.

import { createHash } from 'node:crypto';
import { getStorage } from './storage.ts';

const TTS_URL = 'https://translate.googleapis.com/translate_tts';
const MAX_TEXT_LEN = 200;

// Content-address a TTS clip by the EXACT text the client requests, so the study app's
// lookup and the local pre-generation driver (scripts/generate-tts.ts) agree on where a
// clip lives. Single source of truth for the hash so the legacy `tts/` key and the tagged
// `audio/<provider>/<voice>/` keys can't drift.
export function ttsTextHash(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 40);
}

// LEGACY (still authoritative for the "default" tts voice — the ~960 pre-generated clips):
// `tts/<hash>.{m4a,mp3}`. Two extensions coexist under the same hash: `.m4a` is an Apple-voice
// clip pre-generated on macOS, `.mp3` is the Google-TTS fallback persisted on first request.
// `/v1/tts` (and `/v1/audio/tts` with the default voice) prefers the `.m4a` so the
// higher-quality local voice wins when we've pre-generated it.
export function ttsKey(text: string, ext: 'm4a' | 'mp3'): string {
    return `tts/${ttsTextHash(text)}.${ext}`;
}

// TAGGED key for a SPECIFIC voice variant (Phase 1 of the audio-unify work):
// `audio/<provider>/<gender|'default'>/<hash>.<ext>`. Lets multiple voices for the same text
// coexist (e.g. Siri male + Siri female), each discoverable via the `audio_variants` manifest.
// `provider` is e.g. 'siri'; `gender` is 'male'|'female'|'' (→ 'default'). The legacy `tts/`
// keys above are untouched — this is an additive namespace, so existing playback keeps working.
export function ttsVariantKey(text: string, provider: string, gender: string, ext: string): string {
    return `audio/${provider}/${gender || 'default'}/${ttsTextHash(text)}.${ext}`;
}

// ---------- the 3-tier TTS resolver ----------
//
// text(+voice) → audio is stable, so it's resolved through a three-tier cache, cheapest
// first: in-process map → our storage layer → Google. Shared by BOTH `/v1/tts` (default
// voice) and `/v1/audio/tts?voice=` (a specific tagged voice), so a clip rendered once is
// reused everywhere. Lives in the service (not the route) so the cache + fallback order can't
// diverge between the two endpoints.

export interface TtsHit {
    buffer: ArrayBuffer;
    contentType: string;
    source: string; // for logging: 'memory' | 'storage-<voice>' | 'storage-m4a' | 'storage-mp3' | 'google'
}

// Bounded in-process cache, keyed by voice+text (a tagged voice and the default voice for the
// same text are distinct clips). Survives only this process; the storage tier survives restarts.
const ttsCache = new Map<string, TtsHit>();
const TTS_CACHE_MAX = 500;
function cacheKey(text: string, voice: string): string { return `${voice}\n${text}`; }
function ttsCachePut(key: string, hit: TtsHit): void {
    if (ttsCache.size >= TTS_CACHE_MAX) ttsCache.delete(ttsCache.keys().next().value!); // evict oldest
    ttsCache.set(key, hit);
}

// Resolve audio for `text` in the requested `voice`. `voice` is a "<provider>:<gender>" tag
// (e.g. 'siri:female'); 'default'/'google'/undefined mean the default voice. A tagged voice
// tries its pre-generated `.m4a` first, then FALLS THROUGH to the default 3-tier (legacy
// `tts/<hash>.m4a` → `.mp3` → live Google, persisted on first hit) — so a missing tagged clip
// still plays something. Returns null only when even Google fails.
export async function resolveTts(text: string, voice?: string): Promise<TtsHit | null> {
    const v = !voice || voice === 'google' ? 'default' : voice;
    const key = cacheKey(text, v);
    const cached = ttsCache.get(key);
    if (cached) return cached;

    const storage = getStorage();
    // A specific tagged voice (e.g. siri:female): prefer its own pre-generated clip.
    if (v !== 'default') {
        const [provider, gender = ''] = v.split(':');
        const tagged = await storage.get(ttsVariantKey(text, provider!, gender, 'm4a'));
        if (tagged) { const hit = { buffer: tagged, contentType: 'audio/mp4', source: `storage-${v}` }; ttsCachePut(key, hit); return hit; }
        // not pre-generated → fall through to the default voice below.
    }

    // Default 3-tier: pre-generated Apple `.m4a` wins, then a previously-persisted Google `.mp3`,
    // then live Google (persisted so future requests + restarts skip it).
    let hit: TtsHit;
    const m4a = await storage.get(ttsKey(text, 'm4a'));
    if (m4a) hit = { buffer: m4a, contentType: 'audio/mp4', source: 'storage-m4a' };
    else {
        const mp3 = await storage.get(ttsKey(text, 'mp3'));
        if (mp3) hit = { buffer: mp3, contentType: 'audio/mpeg', source: 'storage-mp3' };
        else {
            const r = await googleTts(text);
            if (!r) return null;
            hit = { buffer: r.buffer, contentType: r.contentType, source: 'google' };
            void storage.put(ttsKey(text, 'mp3'), r.buffer, r.contentType || 'audio/mpeg').catch(() => {}); // fire-and-forget
        }
    }
    ttsCachePut(key, hit);
    return hit;
}

export async function googleTts(text: string): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
    const truncated = (text || '').slice(0, MAX_TEXT_LEN);
    if (!truncated.trim()) return null;
    const params = new URLSearchParams({
        ie: 'UTF-8',
        tl: 'ja',
        client: 'gtx',
        q: truncated,
    });
    try {
        const res = await fetch(`${TTS_URL}?${params.toString()}`, {
            headers: { Referer: 'https://translate.google.com/' },
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return null;
        const buffer = await res.arrayBuffer();
        // Anything below ~1KB is going to be an error response or near-silence.
        if (buffer.byteLength < 512) return null;
        const contentType = res.headers.get('content-type') || 'audio/mpeg';
        return { buffer, contentType };
    } catch {
        return null;
    }
}
