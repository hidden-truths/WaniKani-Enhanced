// Google Translate TTS, used as audio fallback when IK has no `sound` for
// a sentence. Same gtx unauthenticated client + spoofed Referer the userscript
// uses. Google caps input length at ~200 chars; we truncate to match.

import { createHash } from 'node:crypto';

const TTS_URL = 'https://translate.googleapis.com/translate_tts';
const MAX_TEXT_LEN = 200;

// Storage object key for a TTS clip, content-addressed by the EXACT text the client
// requests — so the study app's `/v1/tts?text=…` lookup and the local pre-generation
// driver (scripts/generate-tts.ts → jp-tts) agree on where a clip lives. Two extensions
// coexist under the same hash: `.m4a` is an Apple-voice clip pre-generated on macOS,
// `.mp3` is the Google-TTS fallback persisted on first request. `/v1/tts` prefers the
// `.m4a` so the higher-quality local voice wins when we've pre-generated it.
export function ttsKey(text: string, ext: 'm4a' | 'mp3'): string {
    const hash = createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 40);
    return `tts/${hash}.${ext}`;
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
