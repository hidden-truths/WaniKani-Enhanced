// Warm pipeline. Per-word:
//   1. fetch IK examples
//   2. score each example with JLPT
//   3. resolve title + category from indexMeta (fallback to heuristic)
//   4. for each example: download IK audio (or TTS fallback), upload to storage
//                        download IK image, upload to storage
//   5. fetch DDG fallback image pool, upload to storage
//   6. compose the response payload, upsert to DB
//
// Same flow whether triggered by cron, the admin endpoint, or lazy-fill.
// Single-word warm reuses warmWord; bulk warm just loops over it.

import { config } from '../config.ts';
import { log } from '../lib/log.ts';
import { sleep } from '../lib/sleep.ts';
import * as db from '../db/client.ts';
import { ikSearch, ikIndexMeta, ikDownloadMedia, buildDownloadMediaUrl, type IkExample } from '../services/ik.ts';
import { ddgSearchImages, ddgFetchImage } from '../services/ddg.ts';
import { googleTts } from '../services/tts.ts';
import { fetchAllWkVocab } from '../services/wk.ts';
import { getStorage, keys } from '../services/storage.ts';
import { resolveMediaUrl, type MediaLoader } from '../services/mediaCache.ts';
import { SingleFlight } from '../lib/singleFlight.ts';
import { scoreJlpt } from '../lib/jlpt.ts';
import { ikTitleToFolder, prettifyTitle, resolveCategory, type IndexMeta } from '../lib/ikTitles.ts';
import { aggregateMediaStats, batched, exampleId, type MediaStats } from './helpers.ts';

// Per-word example cap. The userscript can show up to ~500 in the picker but
// in practice ~25 is the most a user scrolls through. Keep 50 for room.
const MAX_EXAMPLES_PER_WORD = 50;
// Concurrency for per-example media downloads inside one word. IK rate limit
// is the upstream ceiling; this controls our outbound parallelism.
const MEDIA_CONCURRENCY = 4;

export interface WarmedExample {
    id: string;
    sentence: string;
    sentenceFurigana: string;
    translation: string;
    wordList: string[];
    source: {
        title: string;          // pretty
        category: string;       // 'anime' | 'drama' | 'games' | 'literature' | 'news' | ...
        encodedTitle: string;   // for debugging / cache keys
    };
    jlptMax: number;            // 0=unknown, 1=N1 hardest, 5=N5 easiest
    hasOriginalAudio: boolean;  // false = audio was synthesized via TTS
    audioUrl: string | null;
    imageUrl: string | null;
}

export interface VocabPayload {
    word: string;
    fetchedAt: number;
    examples: WarmedExample[];
    fallbackImages: string[];
    // `incomplete: true` means the warm returned before all media work was
    // done (specifically: DDG fallbacks were deferred to a background task
    // for lazy-fill responsiveness). Clients should treat the payload as
    // short-TTL and re-fetch within seconds to pick up the full version.
    // Absent (or false) on payloads from completed warms.
    incomplete?: boolean;
}

// Dedupes overlapping background DDG completions per word: a re-warm or a second
// lazy-fill that fires while one is already running is DROPPED (the work is
// best-effort fallback imagery and the caller is fire-and-forget, so there's
// nothing to await or share). This is the COARSER, word-level cousin of
// mediaCache's per-key coalescing — it guards a whole background task, not a
// single keyed result — but it now rides the SAME generic primitive
// (lib/singleFlight.ts). The win over the prior hand-rolled Set: the in-flight
// slot is freed automatically on settle, so a throw from db.getVocab/upsertVocab
// (which sit OUTSIDE the inner try/catch) can no longer strand a word "in flight"
// forever the way a skipped manual `delete` would have. Process-singleton; a
// multi-process world would need a shared coordinator (same caveat as warmAll).
const ddgWarms = new SingleFlight<void>();

// Whether a `warmAll` is currently running. Prevents a manual
// `POST /v1/admin/warm {"scope":"all"}` from kicking off a second bulk
// warm while the monthly timer (or a prior manual run) is still in flight
// — which would double IK call volume and cause the two runs to fight
// over the same `vocab_examples` rows. Set/cleared inside warmAll's
// try/finally so an unhandled error still releases the flag.
let warmAllInFlight = false;

export function isWarmAllInFlight(): boolean {
    return warmAllInFlight;
}

// Test-only: directly force the in-flight flag so route tests can exercise
// the 409 path without spinning up a real warmAll (which would hit live
// IK + WK API). Mirrors the `_useDbForTesting` pattern in db/client.ts.
export function _setWarmAllInFlightForTesting(value: boolean): void {
    warmAllInFlight = value;
}

// Refresh /index_meta if stale, return current map. Cached in DB.
export async function ensureIndexMeta(force = false): Promise<IndexMeta> {
    const existing = db.getIndexMeta();
    const ttlMs = config.indexMetaRefreshDays * 24 * 60 * 60 * 1000;
    if (!force && existing && Date.now() - existing.fetchedAt < ttlMs) {
        return existing.decks;
    }
    try {
        log.info('warm.index_meta.refreshing');
        const decks = await ikIndexMeta();
        db.upsertIndexMeta(decks);
        log.info('warm.index_meta.refreshed', { decks: Object.keys(decks).length });
        return decks;
    } catch (err) {
        log.warn('warm.index_meta.failed', { err: (err as Error).message });
        // Degrade: return whatever stale we have, or empty.
        return existing?.decks || {};
    }
}

// Warm a single word end-to-end. Idempotent: re-warming an existing word
// overwrites its payload. Returns the warmed payload.
export async function warmWord(word: string, options?: { force?: boolean }): Promise<VocabPayload> {
    const force = options?.force ?? false;
    const existing = db.getVocab(word);
    const ttlMs = config.warmRefreshDays * 24 * 60 * 60 * 1000;
    if (!force && existing && Date.now() - existing.fetchedAt < ttlMs) {
        log.debug('warm.skip_fresh', { word });
        return existing.payload as VocabPayload;
    }

    log.info('warm.word.start', { word });
    const t0 = Date.now();
    const indexMeta = await ensureIndexMeta();
    const storage = getStorage();

    // 1. Fetch IK examples.
    //
    // Critical: re-throw on failure rather than swallowing. The old behavior
    // (set rawExamples = [] and continue) meant we'd upsert an empty payload
    // with a fresh fetched_at — and the next warm would see it as `fresh`
    // and skip. During the first production bulk warm, IK's 429 storm caused
    // 100% of rows to be poisoned this way. Throwing here means the outer
    // caller (warmAll's try/catch or warmSingle's try/catch) logs +
    // increments `failed` without persisting anything, so the row stays
    // missing and the next warm retries cleanly.
    //
    // Distinction worth preserving: an empty *successful* IK response
    // (`ikSearch` returns []) is still a legitimate "no examples for this
    // word" answer and DOES get upserted as an empty payload — that's
    // factual, not a failure. Only thrown exceptions skip the upsert.
    let rawExamples: IkExample[];
    try {
        rawExamples = await ikSearch(word);
    } catch (err) {
        log.warn('warm.ik_search_failed', { word, err: (err as Error).message });
        throw err;
    }
    // Cap. Prefer those with audio (sound field) — they get the IK voice-actor
    // recording, which is much better than TTS. Within "has-audio", IK already
    // sorts by relevance/quality, so we just take the first N.
    rawExamples.sort((a, b) => {
        const aHas = a.sound ? 1 : 0;
        const bHas = b.sound ? 1 : 0;
        return bHas - aHas; // has-audio first
    });
    const trimmed = rawExamples.slice(0, MAX_EXAMPLES_PER_WORD);

    // 2-4. Resolve titles, score JLPT, fetch + upload media. Per-example work
    // runs in concurrent batches. Each call returns the warmed example plus
    // a MediaStats record describing what we actually had to fetch vs what
    // we served from the storage cache.
    const warmed = await batched(trimmed, MEDIA_CONCURRENCY, (e) =>
        warmOneExample(word, e, indexMeta, storage),
    );
    const examples = warmed.filter((w) => w.example !== null).map((w) => w.example) as WarmedExample[];
    const allStats = warmed.map((w) => w.stats);

    // 5. DDG fallback pool is DEFERRED to a background task. DDG accounts for
    // ~1.5s of the cold-fill latency (1 vqd fetch + 10 image downloads, only
    // 3-wide concurrency) and is purely a fallback — most examples already
    // have an IK image, and the userscript falls back to "no image" gracefully
    // when fallbackImages is empty. So we ship the payload now with empty
    // fallbacks, mark it `incomplete: true` so the userscript re-fetches
    // shortly, and complete the DDG work behind the response.
    //
    // Reuse the existing payload if a prior warm already populated it (e.g.,
    // re-warm after a partial). This preserves DDG state across re-warms even
    // before the new background DDG completes.
    const priorFallbacks: string[] = Array.isArray(existing?.payload?.fallbackImages)
        ? (existing!.payload.fallbackImages as string[])
        : [];

    // 6. Compose + persist initial payload. incomplete=true tells clients to
    // re-check soon; the background task drops this flag when it upserts
    // again with the real fallbackImages.
    const payload: VocabPayload = {
        word,
        fetchedAt: Date.now(),
        examples,
        fallbackImages: priorFallbacks,
        incomplete: true,
    };
    db.upsertVocab(word, payload, examples.length);

    // Aggregate per-example stats for the operator log (helpers.ts, pure + tested). `audio.ik +
    // audio.tts + audio.none` sums to examples.length; `audioStorage.cache` vs `.fetched` is the key
    // signal — high cache = re-warm finished fast with no external calls; high fetched = new media work.
    const { audio, audioStorage, image, imageStorage } = aggregateMediaStats(allStats);

    log.info('warm.word.done', {
        word,
        ms: Date.now() - t0,
        examples: examples.length,
        audio,
        audioStorage,
        image,
        imageStorage,
        ddg: { deferred: true, priorFallbackImages: priorFallbacks.length },
    });

    // Kick off DDG completion in the background. Fire-and-forget; the lazy-
    // fill request returns immediately. completeDdgInBackground handles its
    // own logging and the in-flight dedupe.
    void completeDdgInBackground(word);

    return payload;
}

// Background task: fetch DDG illustration pool, upload, and re-upsert the
// vocab row with the full fallbackImages array and incomplete=false.
// Deduped by `ddgWarms` (SingleFlight) so a concurrent re-warm doesn't trigger a duplicate.
//
// Idempotency: this runs after warmWord has already upserted the row. We
// re-read the row right before the final upsert so any concurrent change
// (e.g., a re-warm completing first) doesn't get clobbered. If the DDG fetch
// itself fails, we still upsert to clear the `incomplete` flag — better to
// serve a stable payload with empty fallbackImages than to leave clients
// re-fetching forever waiting for DDG to come back.
async function completeDdgInBackground(word: string): Promise<void> {
    // Drop a duplicate rather than join it: the caller is fire-and-forget and the
    // result is best-effort, so a concurrent completion for the same word is just
    // skipped (exactly as the prior Set did). has()→run() is race-free in the
    // single-threaded event loop — there's no await between the two.
    if (ddgWarms.has(word)) {
        log.debug('warm.ddg.background.skip_inflight', { word });
        return;
    }
    await ddgWarms.run(word, async () => {
        const t0 = Date.now();
        const storage = getStorage();
        let urls = 0;
        let fetched = 0;
        let failed = 0;
        let fallbackImages: string[] = [];
        try {
            const ddgUrls = await ddgSearchImages(word);
            urls = ddgUrls.length;
            const indexed = ddgUrls.map((url, idx) => ({ url, idx }));
            const uploaded = await batched(indexed, 3, async ({ url, idx }) => {
                const img = await ddgFetchImage(url);
                if (!img) {
                    failed++;
                    return null;
                }
                fetched++;
                const key = keys.ddg(word, idx);
                return storage.put(key, img.buffer, img.contentType);
            });
            fallbackImages = uploaded.filter((u): u is string => u !== null);
        } catch (err) {
            log.warn('warm.ddg.background.failed', { word, err: (err as Error).message });
        }

        // Re-read the row so we layer on top of whatever the latest payload is.
        // If the row vanished (cache evicted between warm and now — shouldn't
        // happen in practice), bail without writing.
        const row = db.getVocab(word);
        if (!row) {
            log.warn('warm.ddg.background.row_missing', { word });
            return;
        }
        const fullPayload: VocabPayload = {
            ...(row.payload as VocabPayload),
            fallbackImages,
            incomplete: false,
        };
        db.upsertVocab(word, fullPayload, fullPayload.examples?.length || 0);

        log.info('warm.ddg.background.done', {
            word,
            ms: Date.now() - t0,
            urls,
            fetched,
            failed,
            fallbackImages: fallbackImages.length,
        });
    });
}

// Build the resolveMediaUrl `load` for one IK media file: download via the proxy, return the buffer
// (with a media-type default) or null + a miss log. The audio + image read-throughs differ ONLY in
// the file, the default content-type, and the miss-log event — so they share this one factory instead
// of two near-identical closures (the resolver still owns the exists→fetch→put + single-flight).
function ikMediaLoad(
    category: string,
    folder: string,
    file: string,
    defaultType: string,
    missEvent: string,
    ctx: Record<string, unknown>,
): MediaLoader {
    return async () => {
        const r = await ikDownloadMedia(buildDownloadMediaUrl(category, folder, file));
        if (r.ok && r.buffer) return { buffer: r.buffer, contentType: r.contentType || defaultType };
        log.debug(missEvent, { ...ctx, err: r.error });
        return null;
    };
}

async function warmOneExample(
    word: string,
    e: IkExample,
    indexMeta: IndexMeta,
    storage: ReturnType<typeof getStorage>,
): Promise<{ example: WarmedExample | null; stats: MediaStats }> {
    const encodedTitle = (e.title || e.deck_name || '') as string;
    if (!encodedTitle) {
        // No source attribution is useless — skip. Stats default to all-skipped
        // so the aggregator math still adds up.
        return {
            example: null,
            stats: { audioSource: 'none', audioStorage: 'skipped', imageSource: 'none', imageStorage: 'skipped' },
        };
    }
    const folder = ikTitleToFolder(encodedTitle, indexMeta);
    const category = resolveCategory(encodedTitle, e.id, indexMeta);
    const id = exampleId(e, encodedTitle, 0);

    // ---- Audio ----
    // Two read-throughs over the SAME content-addressed key (so a re-warm
    // overwrites in place): the IK voice-actor recording first, then a Google
    // TTS fallback when IK has no `sound` or its proxy missed. mediaCache owns
    // the exists→fetch→put dance + single-flight; this block owns the audio
    // POLICY (IK-before-TTS) and the per-example `audioStorage` stats. An IK
    // miss leaves audioStorage 'skipped' and falls through to the TTS block.
    let audioUrl: string | null = null;
    let hasOriginalAudio = false;
    let audioSource: MediaStats['audioSource'] = 'none';
    let audioStorage: MediaStats['audioStorage'] = 'skipped';
    const audioKey = keys.audio(category, encodedTitle, id);
    if (e.sound) {
        const sound = e.sound;
        const res = await resolveMediaUrl({
            storage,
            key: audioKey,
            load: ikMediaLoad(category, folder, sound, 'audio/mpeg', 'warm.ik_audio_miss', { word, id }),
        });
        if (res.url) {
            audioUrl = res.url;
            hasOriginalAudio = true;
            audioSource = 'ik';
            audioStorage = res.source; // 'cache' | 'fetched'
        }
    }
    if (!audioUrl && e.sentence) {
        const sentence = e.sentence;
        const res = await resolveMediaUrl({
            storage,
            key: audioKey,
            load: async () => {
                const tts = await googleTts(sentence);
                return tts ? { buffer: tts.buffer, contentType: tts.contentType } : null;
            },
        });
        if (res.url) {
            audioUrl = res.url;
            audioSource = 'tts';
            audioStorage = res.source; // 'cache' | 'fetched'
        } else {
            audioStorage = 'failed';
        }
    }

    // ---- Image ----
    // Single read-through (no TTS-style fallback — an image miss just leaves
    // imageUrl null and clients fall back to the DDG pool).
    let imageUrl: string | null = null;
    let imageSource: MediaStats['imageSource'] = 'none';
    let imageStorage: MediaStats['imageStorage'] = 'skipped';
    if (e.image) {
        const image = e.image;
        const res = await resolveMediaUrl({
            storage,
            key: keys.image(category, encodedTitle, id),
            load: ikMediaLoad(category, folder, image, 'image/jpeg', 'warm.ik_image_miss', { word, id }),
        });
        if (res.url) {
            imageUrl = res.url;
            imageSource = 'ik';
            imageStorage = res.source; // 'cache' | 'fetched'
        } else {
            imageStorage = 'failed';
        }
    }

    return {
        example: {
            id,
            sentence: e.sentence || '',
            sentenceFurigana: e.sentence_with_furigana || '',
            translation: e.translation || '',
            wordList: Array.isArray(e.word_list) ? e.word_list : [],
            source: {
                title: prettifyTitle(encodedTitle, indexMeta),
                category,
                encodedTitle,
            },
            jlptMax: scoreJlpt(e.word_list, word),
            hasOriginalAudio,
            audioUrl,
            imageUrl,
        },
        stats: { audioSource, audioStorage, imageSource, imageStorage },
    };
}

// Bulk warm: iterate the entire WK vocab corpus. Long-running. Wraps each
// word in try/catch so one bad word doesn't kill the run.
//
// Self-guarded against concurrent invocation: if a warmAll is already
// running, throws with `err.code === 'warm_all_in_flight'` so the admin
// route can convert that to a 409 Conflict response. The route also
// pre-checks `isWarmAllInFlight()` to short-circuit before the fire-and-
// forget call site, so the throw here is belt-and-suspenders for any
// future caller (e.g. an in-process scheduler) that might skip the
// pre-check.
export async function warmAll(options?: { force?: boolean }): Promise<{ processed: number; failed: number }> {
    if (warmAllInFlight) {
        const err = new Error('warm-all already in flight; refusing to start a second one') as Error & { code: string };
        err.code = 'warm_all_in_flight';
        throw err;
    }
    warmAllInFlight = true;
    const jobId = db.createWarmJob('all', null);
    let processed = 0;
    let failed = 0;
    let error: string | null = null;
    try {
        const words = await fetchAllWkVocab();
        log.info('warm.all.start', { count: words.length, jobId });
        for (const word of words) {
            try {
                await warmWord(word, options);
                processed++;
            } catch (err) {
                failed++;
                log.warn('warm.all.word_failed', { word, err: (err as Error).message });
            }
            // Inter-word breather. Stack it on top of the per-request rate
            // limit; we have hours either way for a monthly run.
            await sleep(100);
        }
        log.info('warm.all.done', { processed, failed, jobId });
    } catch (err) {
        error = (err as Error).message;
        log.error('warm.all.failed', { err: error, jobId });
    } finally {
        db.finishWarmJob(jobId, processed, failed, error);
        warmAllInFlight = false;
    }
    return { processed, failed };
}

// Single-word warm wrapper for the admin endpoint. Records as a job.
export async function warmSingle(word: string, options?: { force?: boolean }): Promise<VocabPayload> {
    const jobId = db.createWarmJob('word', word);
    let error: string | null = null;
    try {
        const payload = await warmWord(word, options);
        db.finishWarmJob(jobId, 1, 0, null);
        return payload;
    } catch (err) {
        error = (err as Error).message;
        db.finishWarmJob(jobId, 0, 1, error);
        throw err;
    }
}
