// Vocab endpoints:
//   GET  /v1/vocab/:word           — single word, lazy-fills on miss (or 404s with ?nowarm=true)
//   POST /v1/vocab/batch           — bulk fetch, returns found/missing maps, never warms
//
// The single-word GET supports ETag/If-None-Match — the userscript revisits
// the same word across review sessions (interleaved SRS, wrong-answer retries)
// and we want those revisits to be 304 No-Content instead of re-downloading
// the full ~50KB payload.

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import * as db from '../db/client.ts';
import { warmWord } from '../warm/pipeline.ts';
import { log } from '../lib/log.ts';
import {
    VocabParamsSchema,
    VocabQuerySchema,
    VocabPayloadSchema,
    BatchRequestSchema,
    BatchResponseSchema,
    ErrorSchema,
} from '../schemas.ts';
import { zodHook } from '../lib/zodHook.ts';

export const vocabRouter = new OpenAPIHono({ defaultHook: zodHook });

// ETag derivation: fetchedAt is a stable identifier — it only changes when
// we re-warm, and re-warming always replaces the payload atomically. So
// fetchedAt is effectively a content version. We base36-encode it for
// compactness and wrap in standard double-quotes.
// Exported for unit testing — kept internal to the vocab route otherwise.
export function etagFor(fetchedAt: number): string {
    return `"${fetchedAt.toString(36)}"`;
}

const getVocabRoute = createRoute({
    method: 'get',
    path: '/{word}',
    tags: ['Read'],
    summary: 'Get the warmed payload for a vocab word',
    description:
        'Returns the pre-warmed payload if present; otherwise lazy-warms the word on demand and ' +
        'returns the result. Lazy fill can take 10–30 seconds for a cold word — pass `?nowarm=true` ' +
        'to skip warming and 404 on misses instead. Supports `If-None-Match` for conditional GET; ' +
        'revisits of the same word return 304 No-Content until the next warm refreshes the entry.',
    request: {
        params: VocabParamsSchema,
        query: VocabQuerySchema,
    },
    responses: {
        200: {
            description: 'OK',
            content: { 'application/json': { schema: VocabPayloadSchema } },
            headers: {
                'Cache-Control': { schema: { type: 'string' }, description: 'public, max-age=86400, stale-while-revalidate=2592000' },
                ETag: { schema: { type: 'string' }, description: 'Strong ETag derived from the payload\'s fetchedAt.' },
            },
        },
        304: {
            description: 'Not modified — client\'s `If-None-Match` matched the current ETag.',
        },
        404: {
            description: 'Cold word and `?nowarm=true` was set, so we didn\'t lazy-fill.',
            content: { 'application/json': { schema: ErrorSchema } },
        },
        502: {
            description: 'Lazy warm failed (upstream IK / DDG / TTS error).',
            content: { 'application/json': { schema: ErrorSchema } },
        },
    },
});

vocabRouter.openapi(getVocabRoute, async (c) => {
    // Normalize to NFC so a search for "が" matches whether the client sent
    // it composed or decomposed.
    const word = c.req.valid('param').word.normalize('NFC');
    const nowarm = c.req.valid('query').nowarm === 'true';
    const ifNoneMatch = c.req.header('If-None-Match');

    let row = db.getVocab(word);
    let warmMs: number | undefined;

    if (!row) {
        if (nowarm) {
            c.set('logCtx', { cacheStatus: 'nowarm_miss', word });
            log.info('vocab.serve', { word, cacheStatus: 'nowarm_miss' });
            return c.json(
                { code: 'not_found' as const, error: 'word not cached', detail: `${word} is not in the warm cache` },
                404,
            );
        }
        log.info('vocab.cold_miss', { word });
        const warmT0 = Date.now();
        try {
            await warmWord(word);
        } catch (err) {
            warmMs = Date.now() - warmT0;
            c.set('logCtx', { cacheStatus: 'error', word, warmMs });
            log.warn('vocab.lazy_warm_failed', { word, warmMs, err: (err as Error).message });
            return c.json(
                { code: 'upstream_failure' as const, error: 'warm failed', detail: (err as Error).message },
                502,
            );
        }
        warmMs = Date.now() - warmT0;
        row = db.getVocab(word);
        if (!row) {
            // Warm succeeded but IK has no sentences for this word. Return
            // an empty payload (200) so the client renders "no example
            // found" without treating this as an error.
            const empty = { word, fetchedAt: Date.now(), examples: [], fallbackImages: [] };
            c.header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
            c.set('logCtx', { cacheStatus: 'empty', word, warmMs });
            log.info('vocab.serve', { word, cacheStatus: 'empty', warmMs, examples: 0 });
            return c.json(empty, 200);
        }
        // Cold warm succeeded — fall through to the serve path with
        // cacheStatus='cold_warm' set after the etag check below.
    }

    // ETag short-circuit.
    const etag = etagFor(row.fetchedAt);
    if (ifNoneMatch && ifNoneMatch === etag) {
        // 304 must include the same Cache-Control + ETag headers as a 200 would.
        c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=2592000');
        c.header('ETag', etag);
        c.set('logCtx', { cacheStatus: 'not_modified', word, ifNoneMatch: true });
        log.info('vocab.serve', {
            word,
            cacheStatus: 'not_modified',
            etag,
            ageMs: Date.now() - row.fetchedAt,
        });
        return c.body(null, 304);
    }

    db.recordVocabServe(word);
    c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=2592000');
    c.header('ETag', etag);
    const examples = Array.isArray(row.payload?.examples) ? row.payload.examples.length : 0;
    const fallbackImages = Array.isArray(row.payload?.fallbackImages) ? row.payload.fallbackImages.length : 0;
    // cacheStatus = cold_warm when we just lazy-filled, otherwise hit (DB
    // row was already there). The serve_count on the row is post-increment
    // (recordVocabServe ran above).
    const cacheStatus = warmMs !== undefined ? 'cold_warm' : 'hit';
    c.set('logCtx', {
        cacheStatus,
        word,
        examples,
        ...(warmMs !== undefined ? { warmMs } : {}),
        ...(ifNoneMatch ? { ifNoneMatch: true } : {}),
    });
    log.info('vocab.serve', {
        word,
        cacheStatus,
        etag,
        examples,
        fallbackImages,
        ageMs: Date.now() - row.fetchedAt,
        serveCount: row.serveCount,
        ...(warmMs !== undefined ? { warmMs } : {}),
    });
    return c.json(row.payload, 200);
});

// ---------- Batch endpoint ----------

const batchRoute = createRoute({
    method: 'post',
    path: '/batch',
    tags: ['Read'],
    summary: 'Bulk-fetch payloads for several words at once',
    description:
        'Returns whatever is already in cache for the given words. Never warms — a missing word ' +
        'comes back in the `missing` array, and the client can fire individual GET /v1/vocab/{word} ' +
        'requests for those if it wants to lazy-fill. Designed for the userscript to prefetch the ' +
        'next several upcoming reviews in one round trip.',
    request: {
        body: {
            required: true,
            content: { 'application/json': { schema: BatchRequestSchema } },
        },
    },
    responses: {
        200: {
            description: 'OK',
            content: { 'application/json': { schema: BatchResponseSchema } },
        },
    },
});

vocabRouter.openapi(batchRoute, (c) => {
    const t0 = Date.now();
    const body = c.req.valid('json');
    // Dedupe + NFC-normalize before hitting the DB. Preserves first-seen
    // order in `missing` for client convenience.
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const raw of body.words) {
        const w = raw.normalize('NFC');
        if (!seen.has(w)) {
            seen.add(w);
            normalized.push(w);
        }
    }

    // Payload is typed `any` from the DB layer (we control the writes; the
    // shape is whatever upsertVocab put in). The schema enforces the public
    // contract — clients see VocabPayload.
    const found: Record<string, any> = {};
    const missing: string[] = [];
    for (const w of normalized) {
        const row = db.getVocab(w);
        if (row) {
            found[w] = row.payload;
            db.recordVocabServe(w);
        } else {
            missing.push(w);
        }
    }

    const ms = Date.now() - t0;
    c.set('logCtx', {
        cacheStatus: 'batch',
        requested: body.words.length,
        deduped: normalized.length,
        found: Object.keys(found).length,
        missing: missing.length,
    });
    log.info('vocab.batch', {
        requested: body.words.length,
        deduped: normalized.length,
        found: Object.keys(found).length,
        missing: missing.length,
        ms,
    });

    // Batch responses are too volatile to cache aggressively (different
    // client requests have different word sets). Don't set Cache-Control.
    return c.json({ found, missing }, 200);
});
