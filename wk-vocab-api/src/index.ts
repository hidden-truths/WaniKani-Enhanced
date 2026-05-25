// wk-vocab-api server entry.
//
// Routes:
//   GET    /v1/health
//   GET    /v1/vocab/:word
//   GET    /v1/index_meta
//   POST   /v1/admin/warm     (Authorization: Bearer <ADMIN_TOKEN>)
//   GET    /media/*           (only when STORAGE_DRIVER=local)
//   GET    /docs              (Scalar UI)
//   GET    /openapi.json      (OpenAPI 3.1 spec, auto-generated from Zod schemas)

import { OpenAPIHono } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { zodHook } from './lib/zodHook.ts';
import { resolve, join, normalize } from 'node:path';
import { config } from './config.ts';
import { log } from './lib/log.ts';
import { getDb } from './db/client.ts';
import { healthRouter } from './routes/health.ts';
import { vocabRouter } from './routes/vocab.ts';
import { indexMetaRouter } from './routes/indexMeta.ts';
import { adminRouter } from './routes/admin.ts';
import { MEDIA_CACHE_CONTROL } from './services/storage.ts';

const app = new OpenAPIHono({ defaultHook: zodHook });

// Simple permissive CORS — the userscript may run on www.wanikani.com OR
// preview.wanikani.com OR (in dev) the same localhost. No credentials, no
// cookies, no per-user data → blanket allow is safe.
app.use('*', async (c, next) => {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (c.req.method === 'OPTIONS') {
        return c.body(null, 204);
    }
    await next();
});

// Request logging — one line per request, post-hoc. Route handlers can
// attach additional context (cache status, warm timing, etc.) by calling
// `c.set('logCtx', { ... })`; those fields are merged into the http log
// line so a single entry tells the whole story of a request. Common fields
// to set:
//   - cacheStatus: 'hit' | 'not_modified' | 'cold_warm' | 'nowarm_miss' |
//                  'empty' | 'error' | 'batch'
//   - warmMs:      number — how long lazy-fill took (only for cold_warm paths)
//   - ifNoneMatch: boolean — did the client send a conditional GET header
//   - word, found, missing, etc.: route-specific.
app.use('*', async (c, next) => {
    const t0 = Date.now();
    await next();
    const ctx = (c.get('logCtx') as Record<string, unknown>) || {};
    log.info('http', {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Date.now() - t0,
        ...ctx,
    });
});

app.route('/v1/health', healthRouter);
app.route('/v1/vocab', vocabRouter);
app.route('/v1/index_meta', indexMetaRouter);
app.route('/v1/admin', adminRouter);

// OpenAPI 3.1 spec, auto-generated from each route's Zod schema. .doc31() is
// the 3.1 variant; .doc() emits 3.0 which lacks some types we use.
app.doc31('/openapi.json', (c) => {
    const url = new URL(c.req.url);
    return {
        openapi: '3.1.0',
        info: {
            title: 'wk-vocab-api',
            version: config.version,
            description:
                'Backing API for the WK Vocab Review — ImmersionKit Examples userscript. ' +
                'Coalesces ImmersionKit, DuckDuckGo, and Google Translate TTS behind a single ' +
                'pre-warmed endpoint. See SERVER_DESIGN.md for the broader rationale.',
        },
        servers: [{ url: `${url.protocol}//${url.host}`, description: 'This server' }],
        tags: [
            { name: 'Read', description: 'Client-facing endpoints. Safe to expose publicly. Edge-cacheable.' },
            { name: 'Admin', description: 'Operational endpoints. Bearer-token gated; not for end users.' },
        ],
    };
});

app.get(
    '/docs',
    Scalar({
        url: '/openapi.json',
        theme: 'purple',
        pageTitle: 'wk-vocab-api docs',
    }),
);

// Local-mode static media route. Serves /media/<key> from LOCAL_MEDIA_DIR.
if (config.storage.driver === 'local') {
    const root = resolve(config.storage.localDir);
    app.get('/media/*', async (c) => {
        const rel = c.req.path.replace(/^\/media\//, '');
        // Decode + normalize, then guard against path traversal by checking
        // the resolved path is still inside `root`.
        const decoded = rel.split('/').map((s) => decodeURIComponent(s)).join('/');
        const target = normalize(join(root, decoded));
        if (!target.startsWith(root)) {
            return c.text('forbidden', 403);
        }
        const file = Bun.file(target);
        if (!(await file.exists())) return c.text('not found', 404);
        // Construct Response directly with explicit headers. We can't use
        // c.header() here because returning a fresh Response object
        // bypasses Hono's response pipeline — c.header() calls would be
        // silently dropped, including the CORS middleware's headers
        // (verified empirically: pre-fix, /media/* returned no
        // Access-Control-* and no Cache-Control). Set both explicitly.
        return new Response(file, {
            headers: {
                'Content-Type': file.type || 'application/octet-stream',
                'Cache-Control': MEDIA_CACHE_CONTROL,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
            },
        });
    });
    log.info('media.static_route_enabled', { root });
}

app.get('/', (c) =>
    c.json({
        name: 'wk-vocab-api',
        version: config.version,
        docs: '/docs',
        openapi: '/openapi.json',
        endpoints: [
            'GET  /v1/health',
            'GET  /v1/vocab/:word',
            'GET  /v1/index_meta',
            'POST /v1/admin/warm  (bearer auth)',
        ],
    }),
);

app.notFound((c) =>
    c.json(
        { code: 'not_found' as const, error: 'not found', detail: `no route matches ${c.req.method} ${c.req.path}` },
        404,
    ),
);

app.onError((err, c) => {
    log.error('http.unhandled', { err: err.message, stack: err.stack });
    return c.json(
        { code: 'internal_error' as const, error: 'internal error', detail: err.message },
        500,
    );
});

// Eagerly open the DB so any schema/path error surfaces at boot, not on the
// first request.
getDb();

log.info('boot', {
    port: config.port,
    storageDriver: config.storage.driver,
    databaseFile: config.databaseFile,
});

export default {
    port: config.port,
    fetch: app.fetch,
};
