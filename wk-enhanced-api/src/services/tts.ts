// Google Translate TTS, used as audio fallback when IK has no `sound` for
// a sentence. Same gtx unauthenticated client + spoofed Referer the userscript
// uses. Google caps input length at ~200 chars; we truncate to match.

import { createHash } from 'node:crypto';
import { getStorage } from './storage.ts';
import { normalizeEtag } from '../lib/etag.ts';

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

// ---------- the TTS resolver ----------
//
// text(+voice) → audio is stable, so it's resolved cheapest-first: our storage layer →
// Google. (There is intentionally NO in-process buffer cache — see the NOTE below.) Shared
// by BOTH `/v1/tts` (default voice) and `/v1/audio/tts?voice=` (a specific tagged voice), so
// a clip rendered once is reused everywhere. Lives in the service (not the route) so the
// cache + fallback order can't diverge between the two endpoints.

export interface TtsHit {
    buffer: ArrayBuffer;
    contentType: string;
    source: string; // for logging: 'storage-<voice>' | 'storage-m4a' | 'storage-mp3' | 'google'
}

// A strong ETag for a served clip — a hash of the BYTES, not the text. A clip is NOT immutable for a
// given (text, voice) URL: an operator can re-render a voice (generate-tts.ts --force), and the same
// URL then returns different bytes. So the routes must NOT send `immutable`; they send this ETag and
// revalidate, and a regenerated clip gets a new tag → clients refetch instead of replaying the stale
// one. (This is the cache-correctness bug behind "I regenerated siri:male but still hear the old voice".)
export function ttsEtag(buffer: ArrayBuffer): string {
    return `"${new Bun.CryptoHasher('sha1').update(buffer).digest('hex').slice(0, 20)}"`;
}

// Serve a resolved TtsHit with cache-correct headers, shared by the legacy `/v1/tts` and
// `/v1/audio/tts` so the ETag/304 logic — which has bitten this code before — can't diverge:
// a bytes-ETag + `public, no-cache` (a clip is re-voiceable, so NOT immutable) and a
// weak-prefix-tolerant If-None-Match 304. `log` fields are merged into the request's logCtx.
// (c is `any` to stay compatible with both the plain `app.get` and the OpenAPIHono route.)
export function serveTtsHit(c: any, hit: TtsHit, log: Record<string, unknown> = {}) {
    const etag = ttsEtag(hit.buffer);
    c.header('ETag', etag);
    c.header('Cache-Control', 'public, no-cache');
    if (normalizeEtag(c.req.header('If-None-Match')) === etag) {
        c.set('logCtx', { ...log, ttsSource: 'not_modified' });
        return c.body(null, 304);
    }
    c.header('Content-Type', hit.contentType || 'audio/mpeg');
    c.set('logCtx', { ...log, ttsSource: hit.source });
    return c.body(hit.buffer);
}

// NOTE: there is intentionally NO in-process buffer cache here. Storage is the single source of truth
// so a regenerated clip is served immediately (no server restart needed); repeat upstream Google calls
// are already avoided because a live gtx render is persisted to storage on first hit. The HTTP layer
// (ETag + revalidation, below) is the real caching tier.

// Resolve audio for `text` in the requested `voice`. An EXPLICIT voice is honored exactly — we
// never substitute a different pre-generated voice's clip for it:
//   • voice omitted / 'default'           → the DEFAULT voice: a smart 3-tier cascade (pre-generated
//     Apple `.m4a` → persisted Google `.mp3` → live Google). The ONLY "be smart" path — used when
//     the caller expressed no specific preference.
//   • voice === 'google'                  → the Google (gtx) voice, explicitly. Never an Apple clip.
//   • voice === '<provider>:<gender>'     → that voice's OWN pre-generated clip (e.g. siri:male); if
//     it isn't generated, falls back to live Google (an honest GENERIC), never the default Apple
//     clip — which would be a DIFFERENT voice than the one the user picked.
// Returns null only when even Google fails.
export async function resolveTts(text: string, voice?: string): Promise<TtsHit | null> {
    const v = !voice || voice === 'default' ? 'default' : voice;
    const storage = getStorage();

    // The Google (gtx) voice: a previously-persisted `.mp3`, else live, persisted on first hit. This
    // is the honest fallback for any EXPLICIT voice we can't serve from its own clip — generic, not a
    // stand-in for a different specific voice.
    const googleHit = async (): Promise<TtsHit | null> => {
        const mp3 = await storage.get(ttsKey(text, 'mp3'));
        if (mp3) return { buffer: mp3, contentType: 'audio/mpeg', source: 'storage-mp3' };
        const r = await googleTts(text);
        if (!r) return null;
        void storage.put(ttsKey(text, 'mp3'), r.buffer, r.contentType || 'audio/mpeg').catch(() => {}); // fire-and-forget
        return { buffer: r.buffer, contentType: r.contentType, source: 'google' };
    };

    let hit: TtsHit | null;
    if (v === 'google') {
        // EXPLICIT Google → the gtx voice, never the default Apple `.m4a` clip.
        hit = await googleHit();
    } else if (v !== 'default') {
        // EXPLICIT tagged voice (e.g. siri:male) → ONLY its own clip; if not pre-generated, fall back
        // to live Google (honest generic), NOT the default Apple clip (a different voice).
        const [provider, gender = ''] = v.split(':');
        const tagged = await storage.get(ttsVariantKey(text, provider!, gender, 'm4a'));
        hit = tagged ? { buffer: tagged, contentType: 'audio/mp4', source: `storage-${v}` } : await googleHit();
    } else {
        // DEFAULT voice (no explicit choice) → the smart 3-tier: Apple `.m4a` → persisted `.mp3` → live.
        const m4a = await storage.get(ttsKey(text, 'm4a'));
        hit = m4a ? { buffer: m4a, contentType: 'audio/mp4', source: 'storage-m4a' } : await googleHit();
    }
    return hit ?? null;
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
