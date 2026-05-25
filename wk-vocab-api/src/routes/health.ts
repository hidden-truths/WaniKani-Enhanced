import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import * as db from '../db/client.ts';
import { HealthSchema } from '../schemas.ts';
import { zodHook } from '../lib/zodHook.ts';

const SCRIPT_VERSION = '0.1.0';

export const healthRouter = new OpenAPIHono({ defaultHook: zodHook });

const healthRoute = createRoute({
    method: 'get',
    path: '/',
    tags: ['Read'],
    summary: 'Liveness + warm-job status',
    responses: {
        200: {
            description: 'OK',
            content: { 'application/json': { schema: HealthSchema } },
        },
    },
});

healthRouter.openapi(healthRoute, (c) => {
    const lastJob = db.getLastWarmJob();
    // Health changes on every warm/serve — caching it would mask outages
    // and confuse monitors. Explicitly no-store.
    c.header('Cache-Control', 'no-store');
    return c.json(
        {
            status: 'ok' as const,
            version: SCRIPT_VERSION,
            warmedWords: db.countVocabRows(),
            lastWarm: lastJob && {
                id: lastJob.id,
                scope: lastJob.scope as 'all' | 'word',
                target: lastJob.target,
                startedAt: lastJob.startedAt,
                finishedAt: lastJob.finishedAt,
                wordsProcessed: lastJob.wordsProcessed,
                wordsFailed: lastJob.wordsFailed,
                error: lastJob.error,
            },
        },
        200,
    );
});
