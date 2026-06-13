// Sentence-template API (Slice 1: 独り言 Self-Talk slot-swap generators).
//
//   GET /v1/templates[?source=selftalk]  — public (anon) + the caller's own private templates
//
// A template is a sentence GENERATOR (skeleton + slots + fillers), NOT a sentence — served from
// the sentence_template table through the db.getTemplates privacy choke-point (the literal mirror
// of db.getSentences' VIEWER_VISIBLE gate). READ is anon-friendly (built-ins are public); the
// client renders the slot-swap UI from this. Curator-only for now — no authoring write path yet
// (mirrors how Self-Talk phrases shipped read-first); realization materialization is a later slice.
//
// NOTE: this router is in index.ts's STUDY_ROUTE CORS allowlist — even the anon GET is a
// credentialed (cookie-bearing) request from the study app, so it must get the echoed origin.

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import * as db from '../db/client.ts';
import { currentUser } from '../lib/auth.ts';
import { TemplateListResponseSchema, TemplateListQuerySchema } from '../schemas.ts';
import { zodHook } from '../lib/zodHook.ts';

export const templatesRouter = new OpenAPIHono({ defaultHook: zodHook });

const listRoute = createRoute({
    method: 'get',
    path: '/',
    tags: ['Accounts'],
    summary: 'List slot-swap templates for a surface (public + own private)',
    request: { query: TemplateListQuerySchema },
    responses: {
        200: { description: 'Templates.', content: { 'application/json': { schema: TemplateListResponseSchema } } },
    },
});

templatesRouter.openapi(listRoute, (c) => {
    const user = currentUser(c); // null = anon → public rows only
    const { source } = c.req.valid('query');
    c.header('Cache-Control', 'no-store');
    const templates = db.getTemplates({ source: source ?? null, viewer: user?.id ?? null });
    c.set('logCtx', { source: source ?? null, viewer: user?.id ?? null, count: templates.length });
    return c.json({ templates }, 200);
});
