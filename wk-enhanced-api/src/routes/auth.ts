// Account endpoints for the study apps served from this origin:
//   POST /v1/auth/register   — create an account, log in
//   POST /v1/auth/login      — log in to an existing account
//   POST /v1/auth/logout     — clear the current session
//   GET  /v1/auth/me         — who am I (200 with user:null if logged out)
//
// Session state lives in an httpOnly cookie; see src/lib/auth.ts for the model.

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { log } from '../lib/log.ts';
import * as db from '../db/client.ts';
import {
    hashPassword,
    verifyPassword,
    normalizeEmail,
    startSession,
    endSession,
    currentUser,
} from '../lib/auth.ts';
import {
    CredentialsSchema,
    AuthResponseSchema,
    LogoutResponseSchema,
    ErrorSchema,
} from '../schemas.ts';
import { zodHook } from '../lib/zodHook.ts';
import { rateLimit } from '../lib/rateLimit.ts';

export const authRouter = new OpenAPIHono({ defaultHook: zodHook });

// Origin-side per-IP rate limits on the credential endpoints (a backstop behind
// Cloudflare). Registered before the routes so the middleware runs first. Limits
// are lenient enough for a human (and dev) but cap automated abuse: login 20 per
// 15 min, register 8 per hour. /logout and /me are unthrottled.
authRouter.use('/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, name: 'login' }));
authRouter.use('/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 8, name: 'register' }));

// ---------- POST /register ----------

const registerRoute = createRoute({
    method: 'post',
    path: '/register',
    tags: ['Accounts'],
    summary: 'Create an account and start a session',
    request: {
        body: { required: true, content: { 'application/json': { schema: CredentialsSchema } } },
    },
    responses: {
        200: {
            description: 'Account created; session cookie set.',
            content: { 'application/json': { schema: AuthResponseSchema } },
        },
        400: { description: 'Invalid email or password.', content: { 'application/json': { schema: ErrorSchema } } },
        409: { description: 'Email already registered.', content: { 'application/json': { schema: ErrorSchema } } },
        429: { description: 'Too many attempts from this client; see Retry-After.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

authRouter.openapi(registerRoute, async (c) => {
    const { email, password } = c.req.valid('json');
    const normEmail = normalizeEmail(email);
    const hash = await hashPassword(password);
    try {
        const user = db.createUser(normEmail, hash);
        startSession(c, user.id);
        log.info('auth.register', { userId: user.id });
        return c.json({ user }, 200);
    } catch (err) {
        if (err instanceof db.EmailTakenError) {
            return c.json(
                { code: 'conflict' as const, error: 'email already registered', detail: 'Try logging in instead.' },
                409,
            );
        }
        throw err;
    }
});

// ---------- POST /login ----------

const loginRoute = createRoute({
    method: 'post',
    path: '/login',
    tags: ['Accounts'],
    summary: 'Log in to an existing account',
    request: {
        body: { required: true, content: { 'application/json': { schema: CredentialsSchema } } },
    },
    responses: {
        200: {
            description: 'Logged in; session cookie set.',
            content: { 'application/json': { schema: AuthResponseSchema } },
        },
        400: { description: 'Malformed request body.', content: { 'application/json': { schema: ErrorSchema } } },
        401: { description: 'Wrong email or password.', content: { 'application/json': { schema: ErrorSchema } } },
        429: { description: 'Too many attempts from this client; see Retry-After.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

authRouter.openapi(loginRoute, async (c) => {
    const { email, password } = c.req.valid('json');
    const user = db.getUserByEmail(normalizeEmail(email));
    // Always run a real verify — against the user's hash if found, else against
    // a throwaway hash — so response time doesn't reveal whether an email is
    // registered (timing-based account enumeration).
    const ok = user
        ? await verifyPassword(password, user.passwordHash)
        : (await verifyPassword(password, await dummyHash()), false);
    if (!user || !ok) {
        return c.json(
            { code: 'unauthorized' as const, error: 'invalid credentials', detail: 'Wrong email or password.' },
            401,
        );
    }
    startSession(c, user.id);
    log.info('auth.login', { userId: user.id });
    return c.json({ user: { id: user.id, email: user.email, createdAt: user.createdAt } }, 200);
});

// A real argon2id hash of a throwaway value, computed once and cached. Used
// only to keep login timing constant for unknown emails. Lazily generated (not
// a string literal) so it's always a valid hash Bun.password.verify accepts.
let _dummyHash: Promise<string> | null = null;
function dummyHash(): Promise<string> {
    if (!_dummyHash) _dummyHash = hashPassword('not-a-real-password');
    return _dummyHash;
}

// ---------- POST /logout ----------

const logoutRoute = createRoute({
    method: 'post',
    path: '/logout',
    tags: ['Accounts'],
    summary: 'Clear the current session',
    responses: {
        200: {
            description: 'Logged out (idempotent — fine to call when already logged out).',
            content: { 'application/json': { schema: LogoutResponseSchema } },
        },
    },
});

authRouter.openapi(logoutRoute, (c) => {
    endSession(c);
    return c.json({ ok: true }, 200);
});

// ---------- GET /me ----------

const meRoute = createRoute({
    method: 'get',
    path: '/me',
    tags: ['Accounts'],
    summary: 'Return the logged-in user, or null',
    responses: {
        200: {
            description: 'Current user, or { user: null } when not logged in.',
            content: { 'application/json': { schema: AuthResponseSchema } },
        },
    },
});

authRouter.openapi(meRoute, (c) => {
    // Never cache auth state at the edge — it's per-cookie.
    c.header('Cache-Control', 'no-store');
    const user = currentUser(c);
    return c.json({ user }, 200);
});
