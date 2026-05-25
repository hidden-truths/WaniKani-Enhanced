// Google Translate TTS, used as audio fallback when IK has no `sound` for
// a sentence. Same gtx unauthenticated client + spoofed Referer the userscript
// uses. Google caps input length at ~200 chars; we truncate to match.

const TTS_URL = 'https://translate.googleapis.com/translate_tts';
const MAX_TEXT_LEN = 200;

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
