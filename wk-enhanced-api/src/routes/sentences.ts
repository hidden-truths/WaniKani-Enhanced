// Unified sentence store API (Phase 1: 独り言 Self-Talk; Phase 2: built-in card examples).
//
//   GET    /v1/sentences?ownerType=selftalk|card[&ownerId=]  — public (anon) + own private rows
//   POST   /v1/sentences                       — create a private user sentence (cookie)
//   PUT    /v1/sentences/{id}                   — replace own sentence (cookie)
//   DELETE /v1/sentences/{id}                   — delete own sentence (cookie)
//
// READ is anonymous-friendly: anon gets public rows, a signed-in user gets public + their
// own private rows — both through the ONE privacy choke-point (db.getSentences). WRITES
// require an account (private rows are per-user). The id in the body/path is the stable
// ext_id (st-<slug> for built-ins, usr-<uuid> for user phrases) — preserved verbatim because
// it is the record-compare itemKey + practice key on the client.
//
// NOTE: this router is in index.ts's STUDY_ROUTE CORS allowlist — even the anon GET is a
// credentialed (cookie-bearing) request from the study app, so it must get the echoed origin,
// never `*`.

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import * as db from '../db/client.ts';
import { currentUser } from '../lib/auth.ts';
import {
    SentenceListResponseSchema,
    SentenceListQuerySchema,
    SentenceCreateRequestSchema,
    SentenceUpdateRequestSchema,
    SentenceIdParamsSchema,
    SentenceMutateResponseSchema,
    SentenceDeleteResponseSchema,
    ErrorSchema,
} from '../schemas.ts';
import { zodHook } from '../lib/zodHook.ts';
import { log } from '../lib/log.ts';

export const sentencesRouter = new OpenAPIHono({ defaultHook: zodHook });

// Per-request body ceiling (a sentence is a few hundred bytes; this just stops abuse) and a
// generous per-user private-row cap so one account can't park unbounded rows on us.
const MAX_SENTENCE_BYTES = 8_000;
const MAX_USER_SENTENCES = 2_000;

const unauthorized = (c: any) =>
    c.json({ code: 'unauthorized' as const, error: 'not logged in', detail: 'Log in to author sentences.' }, 401);

const notFound = (c: any) =>
    c.json({ code: 'not_found' as const, error: 'not found', detail: 'No sentence with that id is yours.' }, 404);

// ---------- GET / ----------

const listRoute = createRoute({
    method: 'get',
    path: '/',
    tags: ['Accounts'],
    summary: 'List sentences for an owner surface (public + own private)',
    request: { query: SentenceListQuerySchema },
    responses: {
        200: { description: 'Sentences.', content: { 'application/json': { schema: SentenceListResponseSchema } } },
    },
});

sentencesRouter.openapi(listRoute, (c) => {
    const user = currentUser(c); // null = anon → public rows only
    const { ownerType, ownerId, annotate } = c.req.valid('query');
    const includeAnnotations = annotate === '1';
    c.header('Cache-Control', 'no-store');
    const sentences = db.getSentences({ ownerType, ownerId: ownerId ?? null, viewer: user?.id ?? null, includeAnnotations });
    c.set('logCtx', { ownerType, ownerId: ownerId ?? null, viewer: user?.id ?? null, annotate: includeAnnotations, count: sentences.length });
    return c.json({ sentences }, 200);
});

// ---------- POST / ----------

const createRouteDef = createRoute({
    method: 'post',
    path: '/',
    tags: ['Accounts'],
    summary: 'Create a private user-authored sentence',
    request: { body: { required: true, content: { 'application/json': { schema: SentenceCreateRequestSchema } } } },
    responses: {
        200: { description: 'Created (or the existing row on an idempotent re-POST).', content: { 'application/json': { schema: SentenceMutateResponseSchema } } },
        400: { description: 'Malformed body, too large, or furigana mismatch.', content: { 'application/json': { schema: ErrorSchema } } },
        401: { description: 'Not logged in.', content: { 'application/json': { schema: ErrorSchema } } },
        409: { description: 'That id is already taken by another account.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

sentencesRouter.openapi(createRouteDef, (c) => {
    const user = currentUser(c);
    if (!user) return unauthorized(c);
    const body = c.req.valid('json');

    if (JSON.stringify(body).length > MAX_SENTENCE_BYTES) {
        return c.json({ code: 'validation_error' as const, error: 'sentence too large', detail: `max ${MAX_SENTENCE_BYTES} bytes` }, 400);
    }

    // Idempotent re-POST of the user's own id (legacy migration replays) → return the existing row.
    const existing = db.getUserSentence({ extId: body.id, viewer: user.id });
    if (existing) return c.json({ sentence: existing }, 200);

    if (db.countUserSentences(user.id) >= MAX_USER_SENTENCES) {
        return c.json({ code: 'validation_error' as const, error: 'too many sentences', detail: `max ${MAX_USER_SENTENCES} per account` }, 400);
    }

    try {
        const sentence = db.createSentence({
            extId: body.id,
            text: body.text,
            furigana: body.furigana ?? null,
            source: 'selftalk',
            createdBy: user.id,
            translations: body.translations,
            tags: body.tags,
            link: body.link,
        });
        log.info('sentence.create', { userId: user.id, extId: body.id });
        return c.json({ sentence }, 200);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // A UNIQUE(ext_id) failure here means the id exists but isn't this user's (getUserSentence
        // above already returned the row when it WAS theirs) — refuse to let them claim it.
        if (/UNIQUE constraint failed: sentence\.ext_id/i.test(msg)) {
            return c.json({ code: 'conflict' as const, error: 'id already taken', detail: 'That sentence id belongs to another account.' }, 409);
        }
        // furigana-mismatch (and any other write validation) → 400.
        return c.json({ code: 'validation_error' as const, error: 'invalid sentence', detail: msg }, 400);
    }
});

// ---------- PUT /{id} ----------

const updateRoute = createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['Accounts'],
    summary: 'Replace one of your own sentences',
    request: {
        params: SentenceIdParamsSchema,
        body: { required: true, content: { 'application/json': { schema: SentenceUpdateRequestSchema } } },
    },
    responses: {
        200: { description: 'Updated.', content: { 'application/json': { schema: SentenceMutateResponseSchema } } },
        400: { description: 'Malformed body or furigana mismatch.', content: { 'application/json': { schema: ErrorSchema } } },
        401: { description: 'Not logged in.', content: { 'application/json': { schema: ErrorSchema } } },
        404: { description: 'No such sentence owned by you.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

sentencesRouter.openapi(updateRoute, (c) => {
    const user = currentUser(c);
    if (!user) return unauthorized(c);
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    if (JSON.stringify(body).length > MAX_SENTENCE_BYTES) {
        return c.json({ code: 'validation_error' as const, error: 'sentence too large', detail: `max ${MAX_SENTENCE_BYTES} bytes` }, 400);
    }
    try {
        const sentence = db.updateUserSentence({
            extId: id,
            viewer: user.id,
            text: body.text,
            furigana: body.furigana ?? null,
            translations: body.translations,
            tags: body.tags,
            link: body.link,
        });
        if (!sentence) return notFound(c); // not theirs / doesn't exist — ownership enforced in SQL
        log.info('sentence.update', { userId: user.id, extId: id });
        return c.json({ sentence }, 200);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return c.json({ code: 'validation_error' as const, error: 'invalid sentence', detail: msg }, 400);
    }
});

// ---------- DELETE /{id} ----------

const deleteRoute = createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Accounts'],
    summary: 'Delete one of your own sentences',
    request: { params: SentenceIdParamsSchema },
    responses: {
        200: { description: 'Deleted.', content: { 'application/json': { schema: SentenceDeleteResponseSchema } } },
        401: { description: 'Not logged in.', content: { 'application/json': { schema: ErrorSchema } } },
        404: { description: 'No such sentence owned by you.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

sentencesRouter.openapi(deleteRoute, (c) => {
    const user = currentUser(c);
    if (!user) return unauthorized(c);
    const { id } = c.req.valid('param');
    const ok = db.deleteUserSentence({ extId: id, viewer: user.id });
    if (!ok) return notFound(c);
    log.info('sentence.delete', { userId: user.id, extId: id });
    return c.json({ ok: true }, 200);
});
