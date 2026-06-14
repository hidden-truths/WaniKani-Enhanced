// Sentence-template API (独り言 Self-Talk slot-swap generators).
//
//   GET  /v1/templates[?source=selftalk]   — public (anon) + the caller's own private templates
//   POST /v1/templates/{extId}/realize      — materialize ONE filler combo (cookie; Slice 2)
//
// A template is a sentence GENERATOR (skeleton + slots + fillers), NOT a sentence — served from
// the sentence_template table through the db.getTemplates privacy choke-point (the literal mirror
// of db.getSentences' VIEWER_VISIBLE gate). READ is anon-friendly (built-ins are public); the
// client renders the slot-swap UI from this. Templates are curator-only (no authoring write path).
//
// REALIZE (Slice 2): picking a filler per slot REALIZES a concrete sentence; the first time a user
// plays/records a combo the client POSTs ONLY the picks here, and the server RECONSTRUCTS the
// realized text/furigana/English from the stored skeleton (decision #1 — authoritative; the client
// can't materialize a public row whose text doesn't match the curated template), then upserts it as
// a PUBLIC `sentence` row (source='template', idempotent by hash) linked via owner_type='template',
// copying the template's curated grammar. So NLP/TTS/grammar/export cover the combos people use.
// Account-gated (it writes the public corpus); anon keeps playing via the lazy TTS path. Full
// design + phasing: ../../SENTENCE_STORE_TEMPLATES.md.
//
// NOTE: this router is in index.ts's STUDY_ROUTE CORS allowlist — even the anon GET is a
// credentialed (cookie-bearing) request from the study app, so it must get the echoed origin.

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import * as db from '../db/client.ts';
import { currentUser } from '../lib/auth.ts';
import { realizeTemplate } from '../lib/realize.ts';
import {
    TemplateListResponseSchema,
    TemplateListQuerySchema,
    TemplateRealizeParamsSchema,
    TemplateRealizeRequestSchema,
    SentenceMutateResponseSchema,
    ErrorSchema,
} from '../schemas.ts';
import { zodHook } from '../lib/zodHook.ts';
import { log } from '../lib/log.ts';

export const templatesRouter = new OpenAPIHono({ defaultHook: zodHook });

const unauthorized = (c: any) =>
    c.json({ code: 'unauthorized' as const, error: 'not logged in', detail: 'Log in to materialize a template realization.' }, 401);

const notFound = (c: any) =>
    c.json({ code: 'not_found' as const, error: 'not found', detail: 'No template with that id is visible to you.' }, 404);

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

// ---------- POST /{extId}/realize ----------

const realizeRoute = createRoute({
    method: 'post',
    path: '/{extId}/realize',
    tags: ['Accounts'],
    summary: 'Materialize one filler combo of a template into a public sentence row',
    request: {
        params: TemplateRealizeParamsSchema,
        body: { required: true, content: { 'application/json': { schema: TemplateRealizeRequestSchema } } },
    },
    responses: {
        200: { description: 'The materialized (or reused) sentence.', content: { 'application/json': { schema: SentenceMutateResponseSchema } } },
        400: { description: 'The realization is invalid (e.g. furigana mismatch).', content: { 'application/json': { schema: ErrorSchema } } },
        401: { description: 'Not logged in.', content: { 'application/json': { schema: ErrorSchema } } },
        404: { description: 'No such template visible to you.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

templatesRouter.openapi(realizeRoute, (c) => {
    const user = currentUser(c);
    if (!user) return unauthorized(c); // writing the public corpus is account-gated; anon stays on lazy TTS
    const { extId } = c.req.valid('param');
    const { picks } = c.req.valid('json');

    // Look up the template THROUGH the gate (404 if missing / not visible) and read its curated
    // grammar server-side — never trust the client for tags that land on a public row.
    const template = db.getTemplate({ extId, viewer: user.id });
    if (!template) return notFound(c);

    // Reconstruct the combo from the stored skeleton + the client's picks (decision #1).
    const r = realizeTemplate(template, picks ?? {});
    try {
        const sentence = db.materializeTemplateRealization({
            templateExtId: extId,
            role: r.role,
            text: r.text,
            furigana: r.furigana,
            translations: { en: r.mean },
            grammar: template.grammar,
        });
        c.header('Cache-Control', 'no-store');
        log.info('template.realize', { userId: user.id, extId, role: r.role, sentenceId: sentence.id });
        return c.json({ sentence }, 200);
    } catch (err) {
        // The only expected throw is the furigana invariant (a malformed curated skeleton) — surface
        // it as a 400 with the offending detail rather than a 500.
        const msg = err instanceof Error ? err.message : String(err);
        return c.json({ code: 'validation_error' as const, error: 'invalid realization', detail: msg }, 400);
    }
});
