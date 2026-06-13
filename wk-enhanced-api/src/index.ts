// wk-enhanced-api server entry.
//
// Routes:
//   GET    /                  (the verb-trainer study app — web/index.html)
//   GET    /v1/health
//   GET    /v1/vocab/:word
//   GET    /v1/index_meta
//   POST   /v1/admin/warm     (Authorization: Bearer <ADMIN_TOKEN>)
//   POST   /v1/auth/register | /login | /logout,  GET /v1/auth/me
//   GET/PUT /v1/progress/{app} (session cookie — per-user study progress)
//   POST   /v1/sessions       (session cookie — append-only study-session log)
//   GET    /v1/tts            (Google Translate TTS proxy for the study app)
//   GET    /media/*           (only when STORAGE_DRIVER=local)
//   GET    /docs              (Scalar UI)
//   GET    /openapi.json      (OpenAPI 3.1 spec, auto-generated from Zod schemas)

import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { Scalar } from '@scalar/hono-api-reference';
import { zodHook } from './lib/zodHook.ts';
import { resolve, join, normalize } from 'node:path';
import { config } from './config.ts';
import { log } from './lib/log.ts';
import { getDb, deleteExpiredSessions } from './db/client.ts';
import { healthRouter } from './routes/health.ts';
import { vocabRouter } from './routes/vocab.ts';
import { indexMetaRouter } from './routes/indexMeta.ts';
import { adminRouter } from './routes/admin.ts';
import { authRouter } from './routes/auth.ts';
import { progressRouter } from './routes/progress.ts';
import { sessionsRouter } from './routes/sessions.ts';
import { minnaRouter } from './routes/minna.ts';
import { audioRouter } from './routes/audio.ts';
import { sentencesRouter } from './routes/sentences.ts';
import { templatesRouter } from './routes/templates.ts';
import { MEDIA_CACHE_CONTROL } from './services/storage.ts';
import { resolveTts, ttsEtag } from './services/tts.ts';

const app = new OpenAPIHono({ defaultHook: zodHook });

// CORS — two policies, because we serve two very different clients:
//
//  - USERSCRIPT routes (/v1/vocab, /v1/index_meta, /v1/health, /v1/tts, /media):
//    blanket `*`, NO credentials. The userscript runs on www/preview.wanikani.com
//    and carries no cookie; per-user data isn't involved, so wildcard is safe + simple.
//    ETag is exposed so the userscript can read it for conditional revalidation.
//
//  - STUDY-APP routes (/v1/auth, /v1/progress, /v1/sessions, /v1/minna, /v1/audio,
//    /v1/sentences): the study app is a SEPARATE origin (wkenhanced.dev) from this API
//    (api.wkenhanced.dev) in the two-container topology, and its requests are CREDENTIALED
//    (the session cookie). The spec forbids `*` with credentials, so we must echo the EXACT
//    requesting origin + `Allow-Credentials: true` — but only for origins on the allowlist
//    (config.studyApp). PUT is included (/v1/progress + /v1/sentences use it) and the preflight
//    (OPTIONS) gets the same headers before the 204. In dev this exercises the real path: Vite
//    :5173 → API :3000 is cross-origin + same-site, exactly like the prod apex ↔ api split.
//    `/v1/audio` is here because its gated native + recordings sub-paths are credentialed
//    (cookie-authorized, crossOrigin='use-credentials'); the public /v1/audio/tts + /variants
//    tolerate the echoed-origin branch fine. `/v1/sentences` belongs here even though its GET is
//    "public" (anon-readable): the study app's api() always sends credentials:'include', so even
//    the anon read is a credentialed request and a wildcard origin would be browser-rejected.
const STUDY_ROUTE = /^\/v1\/(auth|progress|sessions|minna|audio|sentences|templates)\b/;
app.use('*', async (c, next) => {
    const origin = c.req.header('Origin');
    if (STUDY_ROUTE.test(c.req.path) && origin && config.studyApp.allowedOrigins.includes(origin)) {
        c.header('Access-Control-Allow-Origin', origin);
        c.header('Vary', 'Origin');
        c.header('Access-Control-Allow-Credentials', 'true');
        c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        c.header('Access-Control-Allow-Headers', 'Content-Type');
    } else {
        c.header('Access-Control-Allow-Origin', '*');
        c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        c.header('Access-Control-Expose-Headers', 'ETag');
    }
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
app.route('/v1/auth', authRouter);
app.route('/v1/progress', progressRouter);
app.route('/v1/sessions', sessionsRouter);
app.route('/v1/minna', minnaRouter);
app.route('/v1/audio', audioRouter);
app.route('/v1/sentences', sentencesRouter);
app.route('/v1/templates', templatesRouter);

// TTS for the study app (replaces the browser's uneven speechSynthesis voices with
// consistent ja-JP audio). The three-tier cache (in-process → storage → Google) + the
// pre-generated-Apple-voice preference now live in resolveTts() (services/tts.ts), shared
// with /v1/audio/tts. This is the legacy "default voice" alias — kept so existing clients
// (which call /v1/tts) keep working; new callers use /v1/audio/tts?voice=.
// The study app falls back to speechSynthesis when this is unreachable (e.g. file://).
app.get('/v1/tts', async (c) => {
    const text = (c.req.query('text') || '').trim();
    if (!text) return c.json({ code: 'validation_error' as const, error: 'missing ?text' }, 400);
    if (text.length > 200) return c.json({ code: 'validation_error' as const, error: 'text too long (max 200 chars)' }, 400);
    const hit = await resolveTts(text);
    if (!hit) return c.json({ code: 'upstream_failure' as const, error: 'tts unavailable' }, 502);
    // NOT immutable: the default clip can be re-rendered (generate-tts.ts --force). Byte-ETag +
    // revalidate so a regenerated clip propagates instead of being replayed stale (W/ tolerated).
    const etag = ttsEtag(hit.buffer);
    c.header('ETag', etag);
    c.header('Cache-Control', 'public, no-cache');
    if ((c.req.header('If-None-Match') || '').replace(/^W\//, '') === etag) {
        c.set('logCtx', { ttsLen: text.length, ttsSource: 'not_modified' });
        return c.body(null, 304);
    }
    c.header('Content-Type', hit.contentType || 'audio/mpeg');
    c.set('logCtx', { ttsLen: text.length, ttsSource: hit.source });
    return c.body(hit.buffer);
});

// OpenAPI 3.1 spec, auto-generated from each route's Zod schema. .doc31() is
// the 3.1 variant; .doc() emits 3.0 which lacks some types we use.
app.doc31('/openapi.json', (c) => {
    const url = new URL(c.req.url);
    return {
        openapi: '3.1.0',
        info: {
            title: 'wk-enhanced-api',
            version: config.version,
            description:
                'Backing API for the WKEnhanced userscript. ' +
                'Coalesces ImmersionKit, DuckDuckGo, and Google Translate TTS behind a single ' +
                'pre-warmed endpoint. See SERVER_DESIGN.md for the broader rationale.',
        },
        servers: [{ url: `${url.protocol}//${url.host}`, description: 'This server' }],
        tags: [
            { name: 'Read', description: 'Client-facing endpoints. Safe to expose publicly. Edge-cacheable.' },
            { name: 'Admin', description: 'Operational endpoints. Bearer-token gated; not for end users.' },
            { name: 'Accounts', description: 'User accounts + per-user study-app progress. Session-cookie gated.' },
        ],
    };
});

app.get(
    '/docs',
    Scalar({
        url: '/openapi.json',
        theme: 'purple',
        pageTitle: 'wk-enhanced-api docs',
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

// The study app is now a SEPARATE container served at the apex (https://wkenhanced.dev);
// this API no longer serves any static study-app assets (no `/`, `/study`, `/styles.css`,
// `/verbs.js`, `/examples.js`, `/app.js`). `/` returns service-info JSON for humans/curl
// hitting api.wkenhanced.dev directly; `/_info` stays as an alias for anything bookmarked.
const serviceInfo = (c: Context) =>
    c.json({
        name: 'wk-enhanced-api',
        version: config.version,
        app: 'https://wkenhanced.dev',
        docs: '/docs',
        openapi: '/openapi.json',
        endpoints: [
            'GET  /v1/health',
            'GET  /v1/vocab/:word',
            'GET  /v1/index_meta',
            'POST /v1/admin/warm  (bearer auth)',
            'POST /v1/auth/register | /login | /logout,  GET /v1/auth/me',
            'GET/PUT /v1/progress/{app}  (session cookie)',
        ],
    });
app.get('/', serviceInfo);
app.get('/_info', serviceInfo);

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

// Periodically sweep expired session rows. Sessions are also pruned lazily
// when an expired token is presented (db.getValidSession), but accounts that
// never come back would otherwise leave rows forever. Hourly is plenty.
const sweep = () => {
    try {
        const n = deleteExpiredSessions();
        if (n > 0) log.info('auth.sessions_swept', { removed: n });
    } catch (err) {
        log.error('auth.sessions_sweep_failed', { err: (err as Error).message });
    }
};
setInterval(sweep, 60 * 60 * 1000);

log.info('boot', {
    port: config.port,
    storageDriver: config.storage.driver,
    databaseFile: config.databaseFile,
});

export default {
    port: config.port,
    fetch: app.fetch,
    // Bun's default idleTimeout is 10s, which kills cold-fill responses
    // mid-flight: `warmWord` for an uncached word takes 10–30s (one ikSearch
    // + ~100 media downloads through the 500ms IK rate-limit floor), during
    // which the handler hasn't written any bytes — Bun considers the
    // connection idle and resets it. The server-side warm still finishes
    // and populates the row, but the client sees a connection drop.
    // 60s comfortably covers the worst observed cold warm (~30s) and stays
    // well under Cloudflare's 100s free-tier edge timeout.
    idleTimeout: 60,
};
