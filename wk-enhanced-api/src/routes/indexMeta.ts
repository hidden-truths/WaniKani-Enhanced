import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import * as db from '../db/client.ts';
import { ensureIndexMeta } from '../warm/pipeline.ts';
import { IndexMetaSchema, ErrorSchema } from '../schemas.ts';
import { zodHook } from '../lib/zodHook.ts';

export const indexMetaRouter = new OpenAPIHono({ defaultHook: zodHook });

const indexMetaRoute = createRoute({
    method: 'get',
    path: '/',
    tags: ['Read'],
    summary: 'Cached IK encoded-title → {title, category} map',
    description:
        'Refreshed weekly by the warm pipeline. Useful for the userscript to handle legacy ' +
        'cache entries and for debugging title-encoding issues.',
    responses: {
        200: {
            description: 'OK',
            content: { 'application/json': { schema: IndexMetaSchema } },
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
    c.header('Cache-Control', 'public, max-age=604800, stale-while-revalidate=2592000');
    return c.json({ fetchedAt: row.fetchedAt, decks: row.decks }, 200);
});
