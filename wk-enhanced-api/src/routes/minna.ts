// みんなの日本語 (Minna no Nihongo) lesson dashboard — curated content + practice history.
//
// Account-gated (lib/minnaGate.ts): only signed-in users (optionally narrowed to an owner
// allowlist via MINNA_OWNER_EMAILS) can read the copyrighted textbook material.
//
//   GET /v1/minna/lessons        — which lessons have curated content
//   GET /v1/minna/lessons/{n}    — the curated lesson JSON
//   GET /v1/minna/practice       — the user's per-lesson practice history
//
// The AUDIO routes (native MP3 + per-user voice recordings) now live in routes/audio.ts under
// the unified /v1/audio surface. They're ALSO mounted HERE at the legacy
// /v1/minna/{audio,recordings…} paths — the SAME path-agnostic handler functions — so existing
// clients keep working during the audio-unify transition (Phase 1). When nothing references the
// legacy paths anymore, these alias mounts can be removed.
//
// Content lives in data/minna/lesson-<n>.json (git-tracked, curated by hand from the
// scrape-minna.ts draft).

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { readdir } from 'node:fs/promises';
import { gate, denied } from '../lib/minnaGate.ts';
import * as db from '../db/client.ts';
import { serveNativeAudio, postRecording, listRecordings, getRecordingBytes, deleteRecording } from './audio.ts';
import {
    MinnaLessonsResponseSchema,
    MinnaLessonSchema,
    MinnaLessonParamsSchema,
    MinnaAudioQuerySchema,
    MinnaRecordingPostQuerySchema,
    MinnaRecordingPostResponseSchema,
    MinnaRecordingsListQuerySchema,
    MinnaRecordingsListResponseSchema,
    MinnaRecordingIdParamsSchema,
    MinnaRecordingDeleteResponseSchema,
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

// ---------- Legacy audio aliases (handlers shared with /v1/audio — see routes/audio.ts) ----------

const audioRoute = createRoute({
    method: 'get',
    path: '/audio',
    tags: ['Accounts'],
    summary: 'Proxy + cache a native-audio MP3 (legacy alias of /v1/audio/native)',
    request: { query: MinnaAudioQuerySchema },
    responses: {
        200: { description: 'MP3 audio.', content: { 'audio/mpeg': { schema: z.any() } } },
        400: { description: 'Bad audio path.', content: { 'application/json': { schema: ErrorSchema } } },
        401: { description: 'Not authorized.', content: { 'application/json': { schema: ErrorSchema } } },
        502: { description: 'Upstream fetch failed.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});
minnaRouter.openapi(audioRoute, serveNativeAudio);

const recPostRoute = createRoute({
    method: 'post',
    path: '/recordings',
    tags: ['Accounts'],
    summary: 'Save a voice recording (legacy alias of /v1/audio/recordings)',
    request: {
        query: MinnaRecordingPostQuerySchema,
        body: { required: true, content: { 'audio/webm': { schema: z.any() } } },
    },
    responses: {
        200: { description: 'Saved.', content: { 'application/json': { schema: MinnaRecordingPostResponseSchema } } },
        400: { description: 'Bad request (empty/too large/bad type).', content: { 'application/json': { schema: ErrorSchema } } },
        401: { description: 'Not authorized.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});
minnaRouter.openapi(recPostRoute, postRecording);

const recListRoute = createRoute({
    method: 'get',
    path: '/recordings',
    tags: ['Accounts'],
    summary: "List the current user's recordings for a lesson (legacy alias)",
    request: { query: MinnaRecordingsListQuerySchema },
    responses: {
        200: { description: 'Recordings, newest first.', content: { 'application/json': { schema: MinnaRecordingsListResponseSchema } } },
        401: { description: 'Not authorized.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});
minnaRouter.openapi(recListRoute, listRecordings);

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

const recGetRoute = createRoute({
    method: 'get',
    path: '/recordings/{id}',
    tags: ['Accounts'],
    summary: 'Stream one of the current user’s recordings (legacy alias)',
    request: { params: MinnaRecordingIdParamsSchema },
    responses: {
        200: { description: 'Audio bytes.', content: { 'audio/webm': { schema: z.any() } } },
        401: { description: 'Not authorized.', content: { 'application/json': { schema: ErrorSchema } } },
        404: { description: 'No such recording.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});
minnaRouter.openapi(recGetRoute, getRecordingBytes);

const recDeleteRoute = createRoute({
    method: 'delete',
    path: '/recordings/{id}',
    tags: ['Accounts'],
    summary: 'Delete one of the current user’s recordings (legacy alias)',
    request: { params: MinnaRecordingIdParamsSchema },
    responses: {
        200: { description: 'Deleted (idempotent).', content: { 'application/json': { schema: MinnaRecordingDeleteResponseSchema } } },
        401: { description: 'Not authorized.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});
minnaRouter.openapi(recDeleteRoute, deleteRecording);
