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
import * as db from '../db/client.ts';
import type { RecordingRow } from '../db/client.ts';
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

// ---------- Record-and-compare (Phase 2): per-user voice recordings ----------
//
// The learner records themselves saying a vocab word / conversation line and
// compares it to the cached native audio. Recordings are PRIVATE storage objects
// (acl:'private') and are served only through GET /recordings/{id} below, scoped
// to the owner — never via a public URL. Old takes are pruned per item to the
// user's keep-N setting so storage stays bounded.

const MAX_RECORDING_BYTES = 2_000_000; // ~2 MB — a short clip; generous ceiling.
const DEFAULT_KEEP = 3;
const MAX_KEEP = 20;
// Accepted recording container types. MediaRecorder emits webm/opus on
// Chromium/Firefox and mp4 (or ogg) elsewhere; we store whatever the client
// sends and echo it back on serve so playback picks the right decoder.
const RECORDING_CONTENT_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg']);

// Public (client-facing) view of a recording row — drops the internal storage key + owner.
function toRecordingDto(r: RecordingRow) {
    return { id: r.id, lesson: r.lesson, itemKey: r.itemKey, durationMs: r.durationMs, createdAt: r.createdAt };
}

// ---------- POST /recordings ----------

const recPostRoute = createRoute({
    method: 'post',
    path: '/recordings',
    tags: ['Accounts'],
    summary: 'Save a voice recording for a vocab word or conversation line',
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

minnaRouter.openapi(recPostRoute, async (c) => {
    const user = gate(c);
    if (!user) return denied(c);
    const { lesson, itemKey, durationMs, keep } = c.req.valid('query');
    const lessonNum = Number(lesson);

    const ct = (c.req.header('content-type') || 'audio/webm').split(';')[0]!.trim();
    if (!RECORDING_CONTENT_TYPES.has(ct)) {
        return c.json({ code: 'validation_error' as const, error: 'unsupported audio type', detail: ct }, 400);
    }
    const body = await c.req.arrayBuffer();
    if (!body.byteLength) {
        return c.json({ code: 'validation_error' as const, error: 'empty recording' }, 400);
    }
    if (body.byteLength > MAX_RECORDING_BYTES) {
        return c.json(
            { code: 'validation_error' as const, error: 'recording too large', detail: `${body.byteLength} bytes; max ${MAX_RECORDING_BYTES}.` },
            400,
        );
    }

    const token = crypto.randomUUID();
    const storageKey = keys.minnaRecording(user.id, lessonNum, itemKey, token);
    try {
        await getStorage().put(storageKey, body, ct, { acl: 'private' });
    } catch {
        return c.json({ code: 'internal_error' as const, error: 'could not store recording' }, 400);
    }

    const dur = durationMs ? Number(durationMs) : null;
    const id = db.insertRecording(user.id, lessonNum, itemKey, storageKey, ct, dur, Date.now());

    // Prune to the user's keep-N (clamped), deleting older takes' storage objects too.
    const keepN = Math.min(MAX_KEEP, Math.max(1, keep ? Number(keep) : DEFAULT_KEEP));
    const pruned = db.pruneRecordings(user.id, lessonNum, itemKey, keepN);
    if (pruned.length) {
        const storage = getStorage();
        await Promise.all(pruned.map((p) => storage.delete(p.storageKey).catch(() => {})));
    }

    const created = db.getRecording(user.id, id)!;
    const takes = db.listRecordings(user.id, lessonNum).filter((r) => r.itemKey === itemKey);
    c.set('logCtx', { minnaRec: 'save', itemKey, bytes: body.byteLength, pruned: pruned.length });
    return c.json({ ok: true, recording: toRecordingDto(created), takes: takes.map(toRecordingDto) }, 200);
});

// ---------- GET /recordings (list a lesson's takes) ----------

const recListRoute = createRoute({
    method: 'get',
    path: '/recordings',
    tags: ['Accounts'],
    summary: "List the current user's recordings for a lesson",
    request: { query: MinnaRecordingsListQuerySchema },
    responses: {
        200: { description: 'Recordings, newest first.', content: { 'application/json': { schema: MinnaRecordingsListResponseSchema } } },
        401: { description: 'Not authorized.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

minnaRouter.openapi(recListRoute, (c) => {
    const user = gate(c);
    if (!user) return denied(c);
    const { lesson } = c.req.valid('query');
    c.header('Cache-Control', 'no-store');
    const recordings = db.listRecordings(user.id, Number(lesson)).map(toRecordingDto);
    return c.json({ recordings }, 200);
});

// ---------- GET /recordings/{id} (serve the audio bytes) ----------

const recGetRoute = createRoute({
    method: 'get',
    path: '/recordings/{id}',
    tags: ['Accounts'],
    summary: 'Stream one of the current user’s recordings',
    request: { params: MinnaRecordingIdParamsSchema },
    responses: {
        200: { description: 'Audio bytes.', content: { 'audio/webm': { schema: z.any() } } },
        401: { description: 'Not authorized.', content: { 'application/json': { schema: ErrorSchema } } },
        404: { description: 'No such recording.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

minnaRouter.openapi(recGetRoute, async (c) => {
    const user = gate(c);
    if (!user) return denied(c);
    const { id } = c.req.valid('param');
    const row = db.getRecording(user.id, Number(id));
    if (!row) return c.json({ code: 'not_found' as const, error: 'no such recording' }, 404);
    const bytes = await getStorage().get(row.storageKey);
    if (!bytes) return c.json({ code: 'not_found' as const, error: 'recording bytes missing' }, 404);
    c.header('Content-Type', row.contentType);
    // Private + immutable: the bytes for a given id never change; deletion just 404s
    // a fresh fetch. Must never sit in a shared cache (personal voice data).
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    return c.body(bytes);
});

// ---------- DELETE /recordings/{id} ----------

const recDeleteRoute = createRoute({
    method: 'delete',
    path: '/recordings/{id}',
    tags: ['Accounts'],
    summary: 'Delete one of the current user’s recordings',
    request: { params: MinnaRecordingIdParamsSchema },
    responses: {
        200: { description: 'Deleted (idempotent).', content: { 'application/json': { schema: MinnaRecordingDeleteResponseSchema } } },
        401: { description: 'Not authorized.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

minnaRouter.openapi(recDeleteRoute, async (c) => {
    const user = gate(c);
    if (!user) return denied(c);
    const { id } = c.req.valid('param');
    const row = db.deleteRecording(user.id, Number(id));
    if (row) await getStorage().delete(row.storageKey).catch(() => {});
    return c.json({ ok: true }, 200);
});
