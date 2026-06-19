// Read-through media cache over the Storage layer.
//
// One primitive for the pattern that was hand-rolled in FIVE places before this
// module existed — the warm pipeline's audio-IK / audio-TTS / image-IK blocks
// (warm/pipeline.ts), the TTS resolver's google tier (services/tts.ts), and the
// native-audio proxy route (routes/audio.ts). Every one of them was some spelling
// of:
//
//     storage hit?  -> serve it
//     else          -> load upstream -> persist -> serve
//     load failed?  -> degrade
//
// Copy-pasted, each got the caching policy, the error-swallowing, and (in the
// pipeline) the concurrent-fetch-with-no-dedup subtly different. Collapsing them
// here means: ONE place owns read-through semantics, ONE place owns thundering-
// herd protection, and adding a new cached media source (e.g. song audio) is a
// loader function, not another copy of the dance (Open/Closed).
//
// Dependency-inverted: callers pass the `Storage` instance + an upstream
// `MediaLoader`, so this module knows nothing about IK / Google / vnjpclub and
// tests inject a fake storage + a counting loader (no network, matching the
// suite's no-external-calls convention).

import type { Storage, PutOptions } from './storage.ts';
import { SingleFlight } from '../lib/singleFlight.ts';

// Where a resolved body came from. The warm pipeline maps these onto its
// per-example `audioStorage` / `imageStorage` operational stats; the byte-mode
// callers use it for a `cached` log flag.
export type MediaSource = 'cache' | 'fetched' | 'failed';

export interface LoadedMedia {
    buffer: ArrayBuffer;
    contentType: string;
}

// Fetch the bytes for a cache miss. Returns null for an EXPECTED miss/failure
// (the source 404s, returns a too-small body, upstream is down) — the resolver
// maps that to source:'failed' and the caller degrades. The existing loaders
// (googleTts, fetchMinnaAudio, ikDownloadMedia) already catch and return
// null/`{ok:false}` on expected failures, so wrapping them is trivial. An
// UNEXPECTED throw is allowed to propagate (fail loud) rather than be silently
// treated as a miss.
export type MediaLoader = () => Promise<LoadedMedia | null>;

export interface MediaUrlResult {
    url: string | null;
    source: MediaSource;
}

export interface MediaBytesResult {
    buffer: ArrayBuffer | null;
    contentType: string | null;
    source: MediaSource;
    // The in-flight BACKGROUND persist of a freshly-loaded body (bytes mode, on
    // a miss only). Fire-and-forget for production callers — the bytes are
    // already being served; this lands the write for next time. Tests await it
    // to assert the body was cached. null on a cache hit or a failed load.
    persisted: Promise<void> | null;
}

// Process-wide single-flight over the UPSTREAM LOAD, keyed by storage key. Two
// concurrent cold-fills of the same key share ONE upstream fetch instead of
// racing two. This is always safe here: media keys are content-/id-addressed
// (the bytes for a key never change — that's exactly why media is served
// `immutable`), so any two concurrent loaders for a key would produce identical
// bytes. This single map is where the entire server gets herd protection on
// media — the same `SingleFlight` primitive the warm pipeline's per-word
// `ddgWarms` rides, at a finer (per-key) granularity.
const mediaLoads = new SingleFlight<LoadedMedia | null>();

// Test-only: how many upstream loads are currently in flight. Lets a test
// assert the single-flight map doesn't leak entries after settlement.
export function _mediaInFlightCount(): number {
    return mediaLoads.size;
}

export interface ResolveMediaUrlOptions {
    storage: Storage;
    key: string;
    load: MediaLoader;
    putOptions?: PutOptions;
}

// URL mode — for callers that want a PUBLIC URL to hand to a client (the warm
// pipeline composing a payload). On a hit we return `publicUrl(key)` from an
// `exists()` HEAD WITHOUT downloading the body: re-deriving a URL must never
// pull the whole MP3/JPG back through us (that efficiency property is load-
// bearing — the pipeline checks ~100 keys per cold word). On a miss we load
// upstream, persist (awaited — the public URL is the persisted object), and
// return the put()'s URL.
export async function resolveMediaUrl(opts: ResolveMediaUrlOptions): Promise<MediaUrlResult> {
    const { storage, key, load, putOptions } = opts;
    if (await storage.exists(key)) {
        return { url: storage.publicUrl(key), source: 'cache' };
    }
    const loaded = await mediaLoads.run(key, load);
    if (!loaded) return { url: null, source: 'failed' };
    const url = await storage.put(key, loaded.buffer, loaded.contentType, putOptions);
    return { url, source: 'fetched' };
}

export interface ResolveMediaBytesOptions {
    storage: Storage;
    key: string;
    load: MediaLoader;
    // Content type to report on a STORAGE HIT — `storage.get` returns only
    // bytes, so the caller supplies the type it knows the key holds. On a miss
    // the freshly-loaded media's own contentType is used instead.
    cachedContentType: string;
    putOptions?: PutOptions;
}

// Bytes mode — for callers that STREAM the body back through our own process
// (the TTS resolver, the native-audio proxy). On a hit we return the stored
// bytes; on a miss we load upstream, persist in the BACKGROUND (fire-and-forget
// — the client gets bytes immediately and a storage-write outage must not fail a
// request we can already answer), and return the fresh bytes.
export async function resolveMediaBytes(opts: ResolveMediaBytesOptions): Promise<MediaBytesResult> {
    const { storage, key, load, cachedContentType, putOptions } = opts;
    const cached = await storage.get(key);
    if (cached) {
        return { buffer: cached, contentType: cachedContentType, source: 'cache', persisted: null };
    }
    const loaded = await mediaLoads.run(key, load);
    if (!loaded) return { buffer: null, contentType: null, source: 'failed', persisted: null };
    // Persist off the response path; swallow write errors (best-effort cache).
    const persisted = storage
        .put(key, loaded.buffer, loaded.contentType, putOptions)
        .then(() => undefined)
        .catch(() => undefined);
    return { buffer: loaded.buffer, contentType: loaded.contentType, source: 'fetched', persisted };
}
