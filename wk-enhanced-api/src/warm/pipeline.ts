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
import { scoreJlpt } from '../lib/jlpt.ts';
import { ikTitleToFolder, prettifyTitle, resolveCategory, type IndexMeta } from '../lib/ikTitles.ts';

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

// Per-example media stats collected during warmOneExample. Aggregated into
// the warm.word.done log line so the operator can see at a glance how much
// of a warm was satisfied by the storage-cache vs how much required fresh
// IK / TTS / DDG calls. Internal — not part of the public payload.
interface MediaStats {
    audioSource: 'ik' | 'tts' | 'none';
    audioStorage: 'cache' | 'fetched' | 'failed' | 'skipped';
    imageSource: 'ik' | 'none';
    imageStorage: 'cache' | 'fetched' | 'failed' | 'skipped';
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

// Words with an active background DDG warm. Prevents a re-warm or a second
// lazy-fill from kicking off a duplicate DDG fetch while one's already in
// flight. Module-scoped (process-singleton); fine for a single-droplet
// deployment, would need Redis-or-similar in a multi-process world.
const ddgInFlight = new Set<string>();

// Stable, deterministic example id even when IK gives us no `id` (rare but
// happens with some test data). Combines encoded title + a content hash to
// keep media object keys idempotent across re-warms.
function exampleId(e: IkExample, encodedTitle: string, index: number): string {
    if (e.id && typeof e.id === 'string') return e.id;
    // Hash the sentence text so the same example always lands at the same key.
    const text = (e.sentence || '') + '|' + (e.sound || '') + '|' + (e.image || '');
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    return `${encodedTitle}_${index}_${(hash >>> 0).toString(36)}`;
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

// Process N items in parallel batches.
async function batched<T, U>(items: T[], size: number, fn: (item: T) => Promise<U>): Promise<U[]> {
    const out: U[] = [];
    for (let i = 0; i < items.length; i += size) {
        const slice = items.slice(i, i + size);
        const results = await Promise.all(slice.map(fn));
        out.push(...results);
    }
    return out;
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

    // Aggregate per-example stats. `audio.ik + audio.tts + audio.none` always
    // sums to examples.length. `audioStorage.cache` counts examples where the
    // audio file was already in storage from a prior warm (no IK / TTS call
    // needed this run); `audioStorage.fetched` counts fresh downloads. The
    // ratio between these is the most useful operational signal — high cache
    // hit = re-warm finished fast; high fetched = lots of new media work.
    const audio = { ik: 0, tts: 0, none: 0 };
    const audioStorage = { cache: 0, fetched: 0, failed: 0, skipped: 0 };
    const image = { ik_present: 0, ik_missing: 0 };
    const imageStorage = { cache: 0, fetched: 0, failed: 0, skipped: 0 };
    for (const s of allStats) {
        audio[s.audioSource]++;
        audioStorage[s.audioStorage]++;
        if (s.imageSource === 'ik') image.ik_present++;
        else image.ik_missing++;
        imageStorage[s.imageStorage]++;
    }

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
// Deduped by `ddgInFlight` so a concurrent re-warm doesn't trigger a duplicate.
//
// Idempotency: this runs after warmWord has already upserted the row. We
// re-read the row right before the final upsert so any concurrent change
// (e.g., a re-warm completing first) doesn't get clobbered. If the DDG fetch
// itself fails, we still upsert to clear the `incomplete` flag — better to
// serve a stable payload with empty fallbackImages than to leave clients
// re-fetching forever waiting for DDG to come back.
async function completeDdgInBackground(word: string): Promise<void> {
    if (ddgInFlight.has(word)) {
        log.debug('warm.ddg.background.skip_inflight', { word });
        return;
    }
    ddgInFlight.add(word);
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
        ddgInFlight.delete(word);
        return;
    }
    const fullPayload: VocabPayload = {
        ...(row.payload as VocabPayload),
        fallbackImages,
        incomplete: false,
    };
    db.upsertVocab(word, fullPayload, fullPayload.examples?.length || 0);
    ddgInFlight.delete(word);

    log.info('warm.ddg.background.done', {
        word,
        ms: Date.now() - t0,
        urls,
        fetched,
        failed,
        fallbackImages: fallbackImages.length,
    });
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
    let audioUrl: string | null = null;
    let hasOriginalAudio = false;
    let audioSource: MediaStats['audioSource'] = 'none';
    let audioStorage: MediaStats['audioStorage'] = 'skipped';
    if (e.sound) {
        const audioKey = keys.audio(category, encodedTitle, id);
        if (await storage.exists(audioKey)) {
            audioUrl = storage.publicUrl(audioKey);
            hasOriginalAudio = true;
            audioSource = 'ik';
            audioStorage = 'cache';
        } else {
            const url = buildDownloadMediaUrl(category, folder, e.sound);
            const r = await ikDownloadMedia(url);
            if (r.ok && r.buffer) {
                audioUrl = await storage.put(audioKey, r.buffer, r.contentType || 'audio/mpeg');
                hasOriginalAudio = true;
                audioSource = 'ik';
                audioStorage = 'fetched';
            } else {
                log.debug('warm.ik_audio_miss', { word, id, err: r.error });
            }
        }
    }
    // TTS fallback when there's no original audio (text-only literature) or
    // the IK proxy failed. Keyed by the same example id so re-warming
    // overwrites in place.
    if (!audioUrl && e.sentence) {
        const audioKey = keys.audio(category, encodedTitle, id);
        if (await storage.exists(audioKey)) {
            audioUrl = storage.publicUrl(audioKey);
            audioSource = 'tts';
            audioStorage = 'cache';
        } else {
            const tts = await googleTts(e.sentence);
            if (tts) {
                audioUrl = await storage.put(audioKey, tts.buffer, tts.contentType);
                audioSource = 'tts';
                audioStorage = 'fetched';
            } else {
                audioStorage = 'failed';
            }
        }
    }

    // ---- Image ----
    let imageUrl: string | null = null;
    let imageSource: MediaStats['imageSource'] = 'none';
    let imageStorage: MediaStats['imageStorage'] = 'skipped';
    if (e.image) {
        const imageKey = keys.image(category, encodedTitle, id);
        if (await storage.exists(imageKey)) {
            imageUrl = storage.publicUrl(imageKey);
            imageSource = 'ik';
            imageStorage = 'cache';
        } else {
            const url = buildDownloadMediaUrl(category, folder, e.image);
            const r = await ikDownloadMedia(url);
            if (r.ok && r.buffer) {
                imageUrl = await storage.put(imageKey, r.buffer, r.contentType || 'image/jpeg');
                imageSource = 'ik';
                imageStorage = 'fetched';
            } else {
                imageStorage = 'failed';
                log.debug('warm.ik_image_miss', { word, id, err: r.error });
            }
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
export async function warmAll(options?: { force?: boolean }): Promise<{ processed: number; failed: number }> {
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
