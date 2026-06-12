// The みんなの日本語 owner gate, shared by the minna content routes (lessons/practice) and the
// gated audio routes (native audio + voice recordings, now served under /v1/audio). Extracted
// from routes/minna.ts so both routers can use it without a cross-router import cycle.
//
// Returns the signed-in user, or null when the caller must be denied — either not signed in, OR
// signed in but not on a non-empty owner allowlist (MINNA_OWNER_EMAILS). We use ONE 401 for both
// so a non-owner can't even probe what content exists.

import type { Context } from 'hono';
import { config } from '../config.ts';
import { currentUser } from './auth.ts';

export function gate(c: Context) {
    const user = currentUser(c);
    if (!user) return null;
    const allow = config.minna.ownerEmails;
    if (allow.length && !allow.includes(user.email.toLowerCase())) return null;
    return user;
}

export const denied = (c: Context) =>
    c.json(
        { code: 'unauthorized' as const, error: 'not authorized', detail: 'Sign in to access みんなの日本語.' },
        401,
    );
