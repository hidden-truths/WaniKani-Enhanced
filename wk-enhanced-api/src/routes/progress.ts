// Per-user study-app progress (cloud-synced replacement for the study app's
// localStorage). Session-cookie gated — no bearer token.
//
//   GET /v1/progress/{app}   — fetch the saved blob (or null)
//   PUT /v1/progress/{app}   — replace the saved blob
//
// `{app}` namespaces progress per surface (verbs / custom-verbs / settings / minna /
// selftalk — see the enum below). The stored blob is opaque to the server (z.any());
// the client owns its shape.

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import * as db from '../db/client.ts';
import { unauthorized as httpUnauthorized } from '../lib/httpErrors.ts';
import { currentUser } from '../lib/auth.ts';
import {
    ProgressGetResponseSchema,
    ProgressPutRequestSchema,
    ProgressPutResponseSchema,
    ErrorSchema,
} from '../schemas.ts';
import { zodHook } from '../lib/zodHook.ts';

export const progressRouter = new OpenAPIHono({ defaultHook: zodHook });

// Allow-list of app namespaces. Keeps the table from filling with typo'd keys
// and gives the client a 400 on a bad path rather than silently writing junk.
const AppParamSchema = z.object({
    app: z
        // 'verbs'        = the study-app progress blob (cards/sessions/daily)
        // 'custom-verbs' = the user's custom verb definitions (synced separately)
        // 'settings'     = the Settings-page preferences (synced separately)
        // 'minna'        = みんなの日本語 dashboard state (per-lesson notes / activation)
        // 'selftalk'     = 独り言 Self-Talk: user-authored phrases + the practice/streak signal
        .enum(['verbs', 'custom-verbs', 'settings', 'minna', 'selftalk'])
        .openapi({ param: { name: 'app', in: 'path' }, example: 'verbs' }),
});

// Reject anything bigger than this for a single progress blob. The verb
// trainer's store is a few KB; 1 MB is a generous ceiling that still stops a
// logged-in client from parking arbitrary data on us.
const MAX_BLOB_BYTES = 1_000_000;

const unauthorized = (c: any) => httpUnauthorized(c, 'Log in to sync progress.');

// ---------- GET /{app} ----------

const getRoute = createRoute({
    method: 'get',
    path: '/{app}',
    tags: ['Accounts'],
    summary: 'Fetch saved progress for the current user',
    request: { params: AppParamSchema },
    responses: {
        200: {
            description: 'Saved blob, or { data: null } if none.',
            content: { 'application/json': { schema: ProgressGetResponseSchema } },
        },
        401: { description: 'Not logged in.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

progressRouter.openapi(getRoute, (c) => {
    const user = currentUser(c);
    if (!user) return unauthorized(c);
    const { app } = c.req.valid('param');
    c.header('Cache-Control', 'no-store');
    const row = db.getProgress(user.id, app);
    return c.json({ data: row ? row.data : null, updatedAt: row ? row.updatedAt : null }, 200);
});

// ---------- PUT /{app} ----------

const putRoute = createRoute({
    method: 'put',
    path: '/{app}',
    tags: ['Accounts'],
    summary: 'Replace saved progress for the current user',
    request: {
        params: AppParamSchema,
        body: { required: true, content: { 'application/json': { schema: ProgressPutRequestSchema } } },
    },
    responses: {
        200: {
            description: 'Saved.',
            content: { 'application/json': { schema: ProgressPutResponseSchema } },
        },
        400: { description: 'Malformed body or blob too large.', content: { 'application/json': { schema: ErrorSchema } } },
        401: { description: 'Not logged in.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

progressRouter.openapi(putRoute, (c) => {
    const user = currentUser(c);
    if (!user) return unauthorized(c);
    const { app } = c.req.valid('param');
    const { data } = c.req.valid('json');
    // Guard blob size. Stringify once here; db.upsertProgress stringifies again
    // (cheap for a few KB) — the duplication keeps the repo layer's contract
    // "give me any JSON-serializable value" clean.
    const size = JSON.stringify(data ?? null).length;
    if (size > MAX_BLOB_BYTES) {
        return c.json(
            {
                code: 'validation_error' as const,
                error: 'progress blob too large',
                detail: `Blob is ${size} bytes; max is ${MAX_BLOB_BYTES}.`,
            },
            400,
        );
    }
    const updatedAt = db.upsertProgress(user.id, app, data ?? null);
    return c.json({ ok: true, updatedAt }, 200);
});
