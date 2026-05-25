// Admin endpoints (bearer-token gated):
//   POST /v1/admin/warm   — trigger the warm pipeline
//   GET  /v1/admin/jobs   — list recent warm-job audit records

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { config } from '../config.ts';
import { log } from '../lib/log.ts';
import * as db from '../db/client.ts';
import { warmAll, warmSingle, ensureIndexMeta } from '../warm/pipeline.ts';
import {
    WarmRequestSchema,
    WarmWordResponseSchema,
    WarmAllResponseSchema,
    WarmIndexMetaResponseSchema,
    JobsQuerySchema,
    JobsResponseSchema,
    ErrorSchema,
} from '../schemas.ts';
import { zodHook } from '../lib/zodHook.ts';

export const adminRouter = new OpenAPIHono({ defaultHook: zodHook });

// Register the bearer auth security scheme for the docs UI.
adminRouter.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    description: 'Admin bearer token — value of the ADMIN_TOKEN env var.',
});

// Auth middleware applied to all /v1/admin/* routes.
adminRouter.use('*', async (c, next) => {
    const auth = c.req.header('Authorization') || '';
    const m = auth.match(/^Bearer\s+(.+)$/);
    if (!m || m[1] !== config.adminToken) {
        return c.json(
            {
                code: 'unauthorized' as const,
                error: 'unauthorized',
                detail: 'Missing or invalid Authorization: Bearer header.',
            },
            401,
        );
    }
    await next();
});

// ---------- POST /warm ----------

const warmRoute = createRoute({
    method: 'post',
    path: '/warm',
    tags: ['Admin'],
    summary: 'Trigger the warm pipeline',
    description:
        'Three scopes: `word` (synchronous, returns payload), `all` (async, observable via /v1/health and /v1/admin/jobs), and `index_meta` (refresh the deck map).',
    security: [{ bearerAuth: [] }],
    request: {
        body: {
            required: true,
            content: { 'application/json': { schema: WarmRequestSchema } },
        },
    },
    responses: {
        200: {
            description: 'Single-word or index_meta warm completed.',
            content: {
                'application/json': {
                    schema: WarmWordResponseSchema.or(WarmIndexMetaResponseSchema),
                },
            },
        },
        202: {
            description: 'Bulk warm-all started; observe progress via /v1/health.',
            content: { 'application/json': { schema: WarmAllResponseSchema } },
        },
        400: {
            description: 'Malformed request body.',
            content: { 'application/json': { schema: ErrorSchema } },
        },
        401: {
            description: 'Missing or invalid bearer token.',
            content: { 'application/json': { schema: ErrorSchema } },
        },
        502: {
            description: 'Warm failed (upstream IK / DDG / TTS error).',
            content: { 'application/json': { schema: ErrorSchema } },
        },
    },
});

adminRouter.openapi(warmRoute, async (c) => {
    const body = c.req.valid('json');

    if (body.scope === 'word') {
        const word = body.word.normalize('NFC');
        log.info('admin.warm.word', { word, force: !!body.force });
        try {
            const payload = await warmSingle(word, { force: !!body.force });
            return c.json(
                { ok: true, word, examples: payload.examples.length, payload },
                200,
            );
        } catch (err) {
            return c.json(
                {
                    code: 'upstream_failure' as const,
                    error: 'warm failed',
                    detail: (err as Error).message,
                },
                502,
            );
        }
    }

    if (body.scope === 'all') {
        log.info('admin.warm.all', { force: !!body.force });
        // Fire-and-forget. The job is observable via /v1/health.lastWarm
        // and the new /v1/admin/jobs endpoint.
        warmAll({ force: !!body.force }).catch((err) => {
            log.error('admin.warm.all.unhandled', { err: (err as Error).message });
        });
        return c.json({ ok: true, message: 'warm-all started; observe progress at /v1/health' }, 202);
    }

    // body.scope === 'index_meta' — Zod discriminated-union narrowing.
    await ensureIndexMeta(true);
    return c.json({ ok: true }, 200);
});

// ---------- GET /jobs ----------

const jobsRoute = createRoute({
    method: 'get',
    path: '/jobs',
    tags: ['Admin'],
    summary: 'List recent warm-pipeline jobs',
    description:
        'Returns the most recent warm jobs, newest first. Useful for debugging stuck or repeatedly-failing words during a bulk warm.',
    security: [{ bearerAuth: [] }],
    request: { query: JobsQuerySchema },
    responses: {
        200: {
            description: 'OK',
            content: { 'application/json': { schema: JobsResponseSchema } },
        },
        401: {
            description: 'Missing or invalid bearer token.',
            content: { 'application/json': { schema: ErrorSchema } },
        },
    },
});

adminRouter.openapi(jobsRoute, (c) => {
    const raw = c.req.valid('query').limit;
    const parsed = raw ? Number(raw) : 20;
    // Clamp [1, 100] — Zod already enforced \d+ shape; here we cap the upper
    // bound so a curious operator can't paginate the whole table in one call.
    const limit = Math.max(1, Math.min(100, parsed));
    const jobs = db.listWarmJobs(limit);
    // health-style: real-time data, no client/edge caching.
    c.header('Cache-Control', 'no-store');
    return c.json({ jobs: jobs.map((j) => ({ ...j })) }, 200);
});
