// Origin-side rate limiting for the study-app auth endpoints.
//
// Cloudflare fronts us at the edge, but a determined credential-stuffer could
// still hammer /v1/auth/login or /register directly. This is a small in-memory,
// per-IP fixed-window limiter — dependency-free, single-droplet-appropriate. It
// is NOT a substitute for argon2id (each attempt is already expensive) or for
// Cloudflare; it's a cheap backstop so a tight loop gets a 429 instead of
// thousands of hash verifications.
//
// State is process-local (a Map), so it resets on restart and isn't shared
// across instances — fine for a single-droplet deploy. If we ever scale out,
// this needs a shared store (Redis) or to move to the edge.

import type { Context, Next } from 'hono';
import { log } from './log.ts';

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// Pure decision core (separated out so it's unit-testable without a Context):
// record one hit against `key` at time `now`; return whether it's over `max`
// within the current `windowMs` window, plus the seconds until the window
// resets. A fresh or expired window starts a new count.
export function rateHit(
    key: string,
    now: number,
    windowMs: number,
    max: number,
): { limited: boolean; retryAfter: number } {
    // Opportunistic sweep so the Map can't grow unbounded across many IPs.
    if (buckets.size > 5000) for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
    let b = buckets.get(key);
    if (!b || now >= b.resetAt) {
        b = { count: 0, resetAt: now + windowMs };
        buckets.set(key, b);
    }
    b.count++;
    if (b.count > max) return { limited: true, retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
    return { limited: false, retryAfter: 0 };
}

// Test-only: clear all buckets between cases.
export function _resetRateLimit(): void {
    buckets.clear();
}

// Best-effort client IP. Behind the Cloudflare Tunnel the real client is in
// CF-Connecting-IP; fall back to the first X-Forwarded-For hop, then a constant
// (so in local dev, where neither header exists, the limiter still works — it
// just buckets all dev traffic together, which is fine).
export function clientIp(c: Context): string {
    return (
        c.req.header('cf-connecting-ip') ||
        c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
        'local'
    );
}

// Hono middleware factory. `name` namespaces the bucket so login and register
// keep independent counters per IP.
export function rateLimit(opts: { windowMs: number; max: number; name: string }) {
    const { windowMs, max, name } = opts;
    return async (c: Context, next: Next) => {
        const ip = clientIp(c);
        const { limited, retryAfter } = rateHit(`${name}:${ip}`, Date.now(), windowMs, max);
        if (limited) {
            c.header('Retry-After', String(retryAfter));
            log.warn('auth.rate_limited', { endpoint: name, ip, retryAfter });
            return c.json(
                {
                    code: 'rate_limited' as const,
                    error: 'too many requests',
                    detail: `Too many attempts. Try again in ${retryAfter}s.`,
                },
                429,
            );
        }
        await next();
    };
}
