import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import * as db from '../db/client.ts';
import { ensureIndexMeta } from '../warm/pipeline.ts';
import { log } from '../lib/log.ts';
import { etagFor, normalizeEtag } from '../lib/etag.ts';
import { IndexMetaSchema, ErrorSchema } from '../schemas.ts';
import { zodHook } from '../lib/zodHook.ts';

export const indexMetaRouter = new OpenAPIHono({ defaultHook: zodHook });

// Long cache: index_meta only refreshes weekly via the warm pipeline, so
// clients can revalidate cheaply (304 round-trips) rather than re-download
// the ~12KB body on every visit. Same Cache-Control on the 200 and 304 paths
// so a CDN sitting between us and the client treats them identically.
const INDEX_META_CACHE_CONTROL = 'public, max-age=604800, stale-while-revalidate=2592000';

const indexMetaRoute = createRoute({
    method: 'get',
    path: '/',
    tags: ['Read'],
    summary: 'Cached IK encoded-title → {title, category} map',
    description:
        'Refreshed weekly by the warm pipeline. Useful for the userscript to handle legacy ' +
        'cache entries and for debugging title-encoding issues. Supports `If-None-Match` for ' +
        'conditional GET; revisits return 304 No-Content until the next weekly refresh.',
    responses: {
        200: {
            description: 'OK',
            content: { 'application/json': { schema: IndexMetaSchema } },
            headers: {
                'Cache-Control': { schema: { type: 'string' }, description: INDEX_META_CACHE_CONTROL },
                ETag: { schema: { type: 'string' }, description: 'Strong ETag derived from the row\'s fetchedAt.' },
            },
        },
        304: {
            description: 'Not modified — client\'s `If-None-Match` matched the current ETag.',
        },
        503: {
            description: 'No cached index_meta and the live fetch from IK failed.',
            content: { 'application/json': { schema: ErrorSchema } },
        },
    },
});

indexMetaRouter.openapi(indexMetaRoute, async (c) => {
    let row = db.getIndexMeta();
    if (!row) {
        await ensureIndexMeta();
        row = db.getIndexMeta();
    }
    if (!row) {
        return c.json(
            {
                code: 'service_unavailable' as const,
                error: 'index_meta unavailable',
                detail: 'No cached index_meta and the live fetch from IK failed.',
            },
            503,
        );
    }
    const etag = etagFor(row.fetchedAt);
    const ifNoneMatch = c.req.header('If-None-Match');
    if (ifNoneMatch && normalizeEtag(ifNoneMatch) === etag) {
        // 304 carries the same Cache-Control + ETag headers a 200 would, so
        // any intermediary cache can re-pin the validator without a follow-up.
        c.header('Cache-Control', INDEX_META_CACHE_CONTROL);
        c.header('ETag', etag);
        c.set('logCtx', { cacheStatus: 'not_modified', ifNoneMatch: true });
        log.info('index_meta.serve', {
            cacheStatus: 'not_modified',
            etag,
            ageMs: Date.now() - row.fetchedAt,
        });
        return c.body(null, 304);
    }
    c.header('Cache-Control', INDEX_META_CACHE_CONTROL);
    c.header('ETag', etag);
    c.set('logCtx', {
        cacheStatus: 'hit',
        decks: Object.keys(row.decks).length,
        ...(ifNoneMatch ? { ifNoneMatch: true } : {}),
    });
    log.info('index_meta.serve', {
        cacheStatus: 'hit',
        etag,
        decks: Object.keys(row.decks).length,
        ageMs: Date.now() - row.fetchedAt,
    });
    return c.json({ fetchedAt: row.fetchedAt, decks: row.decks }, 200);
});
