// Fetch a native-audio MP3 from vnjpclub.com for the みんなの日本語 dashboard.
// The route caches the result in our storage layer, so this upstream is hit at
// most once per file ever (and playback is then served same-origin from us).
//
// SSRF: the host is hard-coded and the path is constrained to
// /Audio/<root>/<segments…>.mp3 with a strict charset (no '..', no other host),
// so a caller can never steer this at another URL. Mirrors services/tts.ts.

const VNJP_BASE = 'https://www.vnjpclub.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

// Roots seen across the scraped sections: minnamoi, minnahonsatsu1,
// minnarenshuc, FD1. We don't hard-pin the root name (new lessons may add more)
// — just the /Audio/ tree, the `_`/alnum charset, and the .mp3 suffix.
const AUDIO_PATH_RE = /^\/Audio\/[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*\.mp3$/;

export function isValidMinnaAudioPath(p: unknown): p is string {
    return typeof p === 'string' && AUDIO_PATH_RE.test(p);
}

export async function fetchMinnaAudio(vnjpPath: string): Promise<ArrayBuffer | null> {
    if (!isValidMinnaAudioPath(vnjpPath)) return null;
    try {
        const res = await fetch(VNJP_BASE + vnjpPath, {
            headers: { 'User-Agent': UA, Referer: `${VNJP_BASE}/` },
            signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        // vnjpclub returns a tiny HTML/near-empty body for a missing file.
        if (buf.byteLength < 1024) return null;
        return buf;
    } catch {
        return null;
    }
}
