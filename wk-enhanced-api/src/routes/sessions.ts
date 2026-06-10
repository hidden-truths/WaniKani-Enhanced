// Durable, append-only log of completed study sessions. Session-cookie gated.
//
//   POST /v1/sessions   — append one finished session {right,total,mode?,details?}
//
// This is the never-pruned record of study history. The client ALSO keeps a
// capped copy in the progress blob for charts, but it posts here on every session
// end so nothing is ever lost (see the study app's endSession).

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import * as db from '../db/client.ts';
import { currentUser } from '../lib/auth.ts';
import { SessionPostRequestSchema, SessionPostResponseSchema, ErrorSchema } from '../schemas.ts';
import { zodHook } from '../lib/zodHook.ts';
import { log } from '../lib/log.ts';

export const sessionsRouter = new OpenAPIHono({ defaultHook: zodHook });

const postRoute = createRoute({
    method: 'post',
    path: '/',
    tags: ['Accounts'],
    summary: 'Append a completed study session to the durable history log',
    request: {
        body: { required: true, content: { 'application/json': { schema: SessionPostRequestSchema } } },
    },
    responses: {
        200: {
            description: 'Logged.',
            content: { 'application/json': { schema: SessionPostResponseSchema } },
        },
        401: { description: 'Not logged in.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

sessionsRouter.openapi(postRoute, (c) => {
    const user = currentUser(c);
    if (!user) {
        return c.json(
            { code: 'unauthorized' as const, error: 'not logged in', detail: 'Log in to save session history.' },
            401,
        );
    }
    const { right, total, mode, details } = c.req.valid('json');
    const id = db.insertSession(user.id, Date.now(), right, total, mode ?? null, details ?? null);
    const count = db.countSessions(user.id);
    log.info('study.session', { userId: user.id, right, total, count });
    return c.json({ ok: true, id, count }, 200);
});
