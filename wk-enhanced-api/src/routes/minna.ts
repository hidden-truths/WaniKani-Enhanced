// みんなの日本語 (Minna no Nihongo) lesson dashboard — curated content + practice history.
//
// Account-gated (lib/minnaGate.ts): only signed-in users (optionally narrowed to an owner
// allowlist via MINNA_OWNER_EMAILS) can read the copyrighted textbook material.
//
//   GET /v1/minna/lessons        — which lessons have curated content
//   GET /v1/minna/lessons/{n}    — the curated lesson JSON
//   GET /v1/minna/practice       — the user's per-lesson practice history
//
// AUDIO (native MP3 + per-user voice recordings) lives entirely in routes/audio.ts under the
// unified /v1/audio surface. The legacy /v1/minna/{audio,recordings…} alias mounts that kept
// pre-audio-unify clients working were removed once the last consumer migrated — nothing is
// served from /v1/minna/* except the lesson content + practice history below.
//
// Content lives in data/minna/lesson-<n>.json (git-tracked, curated by hand from the
// scrape-minna.ts draft).

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { readdir } from 'node:fs/promises';
import { gate, denied } from '../lib/minnaGate.ts';
import * as db from '../db/client.ts';
import {
    MinnaLessonsResponseSchema,
    MinnaLessonSchema,
    MinnaLessonParamsSchema,
    MinnaPracticeResponseSchema,
    ErrorSchema,
} from '../schemas.ts';
import { zodHook } from '../lib/zodHook.ts';

export const minnaRouter = new OpenAPIHono({ defaultHook: zodHook });

// data/minna/ relative to this module (src/routes/) — robust to cwd, same idiom
// as the static web serve in index.ts.
const DATA_DIR = new URL('../../data/minna/', import.meta.url);

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

// ---------- GET /practice (per-lesson practice history) ----------
//
// One row per lesson the user has recorded in, with item + take counts and the last-practiced
// time. Its own path (not /recordings/...) so it can't be shadowed by /recordings/{id}.

const recPracticeRoute = createRoute({
    method: 'get',
    path: '/practice',
    tags: ['Accounts'],
    summary: "The current user's per-lesson practice history (recording counts)",
    responses: {
        200: { description: 'Practice summary, lessons ascending.', content: { 'application/json': { schema: MinnaPracticeResponseSchema } } },
        401: { description: 'Not authorized.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

minnaRouter.openapi(recPracticeRoute, (c) => {
    const user = gate(c);
    if (!user) return denied(c);
    c.header('Cache-Control', 'no-store');
    const lessons = db.recordingSummary(user.id);
    const totalTakes = lessons.reduce((s, l) => s + l.takes, 0);
    const totalItems = lessons.reduce((s, l) => s + l.items, 0);
    return c.json({ lessons, totalItems, totalTakes }, 200);
});
