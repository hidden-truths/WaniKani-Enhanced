// みんなの日本語 (Minna no Nihongo) lesson dashboard — content + native audio.
//
// Account-gated: only signed-in users (optionally narrowed to an owner
// allowlist via MINNA_OWNER_EMAILS) can read the copyrighted textbook material,
// so it never ships to anonymous visitors. See config.minna + the "Visibility"
// decision in the plan.
//
//   GET /v1/minna/lessons        — which lessons have curated content
//   GET /v1/minna/lessons/{n}    — the curated lesson JSON
//   GET /v1/minna/audio?src=...  — proxy + cache a native-audio MP3 from vnjpclub
//
// Content lives in data/minna/lesson-<n>.json (git-tracked, curated by hand from
// the scrape-minna.ts draft). Audio is fetched from vnjpclub once and cached in
// our storage layer thereafter, so the upstream is hit at most once per file.

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { readdir } from 'node:fs/promises';
import type { Context } from 'hono';
import { config } from '../config.ts';
import { currentUser } from '../lib/auth.ts';
import { getStorage, keys } from '../services/storage.ts';
import { fetchMinnaAudio, isValidMinnaAudioPath } from '../services/minnaAudio.ts';
import {
    MinnaLessonsResponseSchema,
    MinnaLessonSchema,
    MinnaLessonParamsSchema,
    MinnaAudioQuerySchema,
    ErrorSchema,
} from '../schemas.ts';
import { zodHook } from '../lib/zodHook.ts';

export const minnaRouter = new OpenAPIHono({ defaultHook: zodHook });

// data/minna/ relative to this module (src/routes/) — robust to cwd, same idiom
// as the static web serve in index.ts.
const DATA_DIR = new URL('../../data/minna/', import.meta.url);

// Auth + owner gate. Returns the user, or null when the caller must be denied
// (not signed in, OR signed in but not on a non-empty owner allowlist). We use
// one 401 for both so a non-owner can't even probe what content exists.
function gate(c: Context) {
    const user = currentUser(c);
    if (!user) return null;
    const allow = config.minna.ownerEmails;
    if (allow.length && !allow.includes(user.email.toLowerCase())) return null;
    return user;
}
const denied = (c: Context) =>
    c.json(
        { code: 'unauthorized' as const, error: 'not authorized', detail: 'Sign in to access みんなの日本語.' },
        401,
    );

// ---------- GET /lessons ----------

const listRoute = createRoute({
    method: 'get',
    path: '/lessons',
    tags: ['Accounts'],
    summary: 'List lessons with curated みんなの日本語 content',
    responses: {
        200: { description: 'Available lesson numbers.', content: { 'application/json': { schema: MinnaLessonsResponseSchema } } },
        401: { description: 'Not authorized.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

minnaRouter.openapi(listRoute, async (c) => {
    if (!gate(c)) return denied(c);
    c.header('Cache-Control', 'no-store');
    let lessons: number[] = [];
    try {
        const files = await readdir(DATA_DIR);
        lessons = files
            .map((f) => f.match(/^lesson-(\d+)\.json$/)?.[1]) // curated only; ignores *.draft.json
            .filter((x): x is string => !!x)
            .map(Number)
            .sort((a, b) => a - b);
    } catch {
        /* dir missing → empty list */
    }
    return c.json({ lessons }, 200);
});

// ---------- GET /lessons/{n} ----------

const getRoute = createRoute({
    method: 'get',
    path: '/lessons/{n}',
    tags: ['Accounts'],
    summary: 'Fetch a curated みんなの日本語 lesson',
    request: { params: MinnaLessonParamsSchema },
    responses: {
        200: { description: 'Lesson content.', content: { 'application/json': { schema: MinnaLessonSchema } } },
        401: { description: 'Not authorized.', content: { 'application/json': { schema: ErrorSchema } } },
        404: { description: 'No content for that lesson.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

minnaRouter.openapi(getRoute, async (c) => {
    if (!gate(c)) return denied(c);
    const { n } = c.req.valid('param');
    const num = Number(n);
    if (!Number.isInteger(num) || num < 1 || num > 50) {
        return c.json({ code: 'not_found' as const, error: 'no such lesson' }, 404);
    }
    const file = Bun.file(new URL(`lesson-${num}.json`, DATA_DIR));
    if (!(await file.exists())) {
        return c.json(
            { code: 'not_found' as const, error: 'lesson not available', detail: `Lesson ${num} has no curated content yet.` },
            404,
        );
    }
    c.header('Cache-Control', 'no-store');
    return c.json(await file.json(), 200);
});

// ---------- GET /audio ----------

const audioRoute = createRoute({
    method: 'get',
    path: '/audio',
    tags: ['Accounts'],
    summary: 'Proxy + cache a native-audio MP3 (signed-in only)',
    request: { query: MinnaAudioQuerySchema },
    responses: {
        200: { description: 'MP3 audio.', content: { 'audio/mpeg': { schema: z.any() } } },
        400: { description: 'Bad audio path.', content: { 'application/json': { schema: ErrorSchema } } },
        401: { description: 'Not authorized.', content: { 'application/json': { schema: ErrorSchema } } },
        502: { description: 'Upstream fetch failed.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

minnaRouter.openapi(audioRoute, async (c) => {
    if (!gate(c)) return denied(c);
    const { src } = c.req.valid('query');
    if (!isValidMinnaAudioPath(src)) {
        return c.json({ code: 'validation_error' as const, error: 'bad audio path' }, 400);
    }
    const storage = getStorage();
    const key = keys.minnaAudio(src);
    let bytes = await storage.get(key);
    let cached = true;
    if (!bytes) {
        cached = false;
        bytes = await fetchMinnaAudio(src);
        if (!bytes) return c.json({ code: 'upstream_failure' as const, error: 'audio unavailable' }, 502);
        try {
            await storage.put(key, bytes, 'audio/mpeg');
        } catch {
            /* serve the bytes we have even if caching failed */
        }
    }
    c.set('logCtx', { minnaAudio: src, cached });
    c.header('Content-Type', 'audio/mpeg');
    // `private`, NOT `public`: this is account-gated content, so it must never be
    // stored in a SHARED cache (Cloudflare / any CDN in front of the origin) — that
    // would serve it to unauthorized users and bypass the gate. The owner's own
    // browser still caches it for a year (immutable, content-addressed key).
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    return c.body(bytes);
});
