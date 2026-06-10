// Account/session helpers for the study-app accounts feature.
//
// Auth model (deliberately minimal — no JWT, no external auth dep):
//   - Passwords hashed with Bun.password (argon2id by default).
//   - On login/register we mint a random opaque 256-bit token, store it in the
//     `sessions` table, and hand it to the browser as an httpOnly cookie.
//   - Every authed request resolves the cookie → session row → user. There is
//     no client-readable token; the cookie is the whole credential.
//
// Why cookies (not a bearer token the JS holds): the study app is served from
// the SAME origin as this API (both behind the wkenhanced.dev Cloudflare
// tunnel), so a SameSite=Lax httpOnly cookie travels automatically on every
// fetch and is immune to XSS token theft. Cross-origin callers can't use these
// endpoints — that's intentional; only the served app needs them.

import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { config } from '../config.ts';
import * as db from '../db/client.ts';
import type { PublicUser } from '../db/client.ts';

export const SESSION_COOKIE = 'wk_session';

const DAY_MS = 86_400_000;

// argon2id with default params is plenty for a hobby app; Bun picks sane
// memory/time costs. Both calls are async (they run on a thread pool).
export function hashPassword(plain: string): Promise<string> {
    return Bun.password.hash(plain);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
    return Bun.password.verify(plain, hash);
}

// Normalize an email for storage + lookup so "A@B.com" and "a@b.com " collide.
export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

// Mint a session for `userId`, persist it, and set the cookie on the response.
export function startSession(c: Context, userId: number): void {
    const token = generateToken();
    const expiresAt = Date.now() + config.auth.sessionTtlDays * DAY_MS;
    db.createSession(token, userId, expiresAt);
    setCookie(c, SESSION_COOKIE, token, {
        httpOnly: true,
        secure: config.auth.cookieSecure,
        sameSite: 'Lax',
        path: '/',
        // maxAge is in seconds.
        maxAge: config.auth.sessionTtlDays * 24 * 60 * 60,
    });
}

// Clear the current session (DB row + cookie). Safe to call when not logged in.
export function endSession(c: Context): void {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) db.deleteSession(token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

// Resolve the current user from the session cookie, or null if unauthenticated
// / expired. Does not throw.
export function currentUser(c: Context): PublicUser | null {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) return null;
    return db.getValidSession(token);
}

// 256 bits of CSPRNG entropy, hex-encoded. crypto is a global in Bun.
function generateToken(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    let out = '';
    for (const b of bytes) out += b.toString(16).padStart(2, '0');
    return out;
}
