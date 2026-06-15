// Unified audio surface — ONE /v1/audio route group for every voice source:
//
//   GET    /v1/audio/variants?text=      — catalog: which SYNTH voices exist for a text
//   GET    /v1/audio/tts?text=&voice=    — serve a tagged synth clip (public)
//   GET    /v1/audio/native?src=         — Minna native MP3 (gated)
//   POST   /v1/audio/recordings          — save a voice take (gated, per-user)
//   GET    /v1/audio/recordings?lesson=  — list the user's takes for a lesson (gated)
//   GET    /v1/audio/recordings/{id}     — stream one of the owner's takes (gated)
//   DELETE /v1/audio/recordings/{id}     — delete one of the owner's takes (gated)
//
// The native + recordings handlers read all context off the (already schema-validated) raw
// query/params rather than typed route bindings — originally so the same function could also
// serve the legacy /v1/minna/{audio,recordings…} alias paths. Those aliases were removed once the
// last client migrated to /v1/audio/*, which is the only surface now.

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { gate, denied } from '../lib/minnaGate.ts';
import { getStorage, keys } from '../services/storage.ts';
import { fetchMinnaAudio, isValidMinnaAudioPath } from '../services/minnaAudio.ts';
import { resolveTts, ttsTextHash, serveTtsHit } from '../services/tts.ts';
import * as db from '../db/client.ts';
import type { RecordingRow } from '../db/client.ts';
import {
    MinnaAudioQuerySchema,
    MinnaRecordingPostQuerySchema,
    MinnaRecordingPostResponseSchema,
    MinnaRecordingsListQuerySchema,
    MinnaRecordingsListResponseSchema,
    MinnaRecordingIdParamsSchema,
    MinnaRecordingDeleteResponseSchema,
    AudioVariantsQuerySchema,
    AudioVariantsResponseSchema,
    AudioTtsQuerySchema,
    ErrorSchema,
} from '../schemas.ts';
import { zodHook } from '../lib/zodHook.ts';

export const audioRouter = new OpenAPIHono({ defaultHook: zodHook });

// ---------- shared recordings policy / helpers (moved from routes/minna.ts) ----------

const MAX_RECORDING_BYTES = 2_000_000; // ~2 MB — a short clip; generous ceiling.
const DEFAULT_KEEP = 3;
const MAX_KEEP = 20;
// Accepted recording container types. MediaRecorder emits webm/opus on Chromium/Firefox and
// mp4 (or ogg) elsewhere; the client's silence-trim step re-encodes to wav. We store whatever
// the client sends and echo it back on serve so playback picks the right decoder.
const RECORDING_CONTENT_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav']);
const EXT_BY_TYPE: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
};

// Public (client-facing) view of a recording row — drops the internal storage key + owner.
function toRecordingDto(r: RecordingRow) {
    return { id: r.id, lesson: r.lesson, itemKey: r.itemKey, durationMs: r.durationMs, createdAt: r.createdAt };
}

// ---------- shared GATED handlers (mounted under both /v1/audio and the legacy /v1/minna) ----------
// Path-agnostic: each reads its already-validated context off the raw query/params (the
// OpenAPIHono validator + zodHook run before the handler, so the values are guaranteed-valid).

export async function serveNativeAudio(c: Context) {
    if (!gate(c)) return denied(c);
    const src = c.req.query('src') || '';
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
            // PRIVATE object: account-gated copyrighted content — the stored object must not be
            // publicly reachable at its (guessable) bucket URL either. Served ONLY through this
            // gated route via storage.get(); the publicUrl is never used.
            await storage.put(key, bytes, 'audio/mpeg', { acl: 'private' });
        } catch {
            /* serve the bytes we have even if caching failed */
        }
    }
    c.set('logCtx', { minnaAudio: src, cached });
    c.header('Content-Type', 'audio/mpeg');
    // `private`, NOT `public`: account-gated content must never sit in a SHARED cache (Cloudflare
    // / any CDN in front of the origin) — that would serve it to unauthorized users and bypass the
    // gate. The owner's own browser still caches it for a year (immutable, content-addressed key).
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    return c.body(bytes);
}

export async function postRecording(c: Context) {
    const user = gate(c);
    if (!user) return denied(c);
    const lessonNum = Number(c.req.query('lesson'));
    const itemKey = c.req.query('itemKey') || '';
    const durationMs = c.req.query('durationMs');
    const keep = c.req.query('keep');

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
    const storageKey = keys.minnaRecording(user.id, lessonNum, itemKey, token, EXT_BY_TYPE[ct] || 'webm');
    try {
        await getStorage().put(storageKey, body, ct, { acl: 'private' });
    } catch {
        // A storage-write outage is a server-side failure, not a bad request — 500 so the
        // code (internal_error) and HTTP status agree (every other internal_error is 500; see
        // index.ts's onError handler). NOT 400: a client/monitor keying retry/alert logic on
        // the 4xx/5xx split must see a 5xx here. NOT 502/upstream_failure either — that code is
        // for failed *reads* from external services (cf. serveNativeAudio's fetchMinnaAudio miss).
        return c.json({ code: 'internal_error' as const, error: 'could not store recording' }, 500);
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
}

export function listRecordings(c: Context) {
    const user = gate(c);
    if (!user) return denied(c);
    c.header('Cache-Control', 'no-store');
    const recordings = db.listRecordings(user.id, Number(c.req.query('lesson'))).map(toRecordingDto);
    return c.json({ recordings }, 200);
}

export async function getRecordingBytes(c: Context) {
    const user = gate(c);
    if (!user) return denied(c);
    const row = db.getRecording(user.id, Number(c.req.param('id')));
    if (!row) return c.json({ code: 'not_found' as const, error: 'no such recording' }, 404);
    const bytes = await getStorage().get(row.storageKey);
    if (!bytes) return c.json({ code: 'not_found' as const, error: 'recording bytes missing' }, 404);
    c.header('Content-Type', row.contentType);
    // Private + immutable: the bytes for a given id never change; deletion just 404s a fresh
    // fetch. Must never sit in a shared cache (personal voice data).
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    return c.body(bytes);
}

export async function deleteRecording(c: Context) {
    const user = gate(c);
    if (!user) return denied(c);
    const row = db.deleteRecording(user.id, Number(c.req.param('id')));
    if (row) await getStorage().delete(row.storageKey).catch(() => {});
    return c.json({ ok: true }, 200);
}

// ---------- synth catalog + serving (new, public) ----------

function labelFor(provider: string, gender: string): string {
    const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
    if (provider === 'google') return 'Google';
    if (provider === 'siri') return gender ? `Siri · ${cap(gender)}` : 'Siri';
    return gender ? `${cap(provider)} · ${cap(gender)}` : cap(provider);
}
function synthUrl(text: string, voice: string): string {
    return `/v1/audio/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice)}`;
}
// The synth (tts-kind) variant catalog for a text: the SPECIFIC pre-generated voices recorded in
// the audio_variants manifest (Siri male/female today) PLUS an always-available `google` fallback
// (the lazy gtx path — which also serves any legacy `tts/<hash>` clip via resolveTts). Native +
// user variants are added client-side. All synth variants are public (gated:false).
function buildSynthVariants(text: string) {
    const rows = db.listAudioVariants(ttsTextHash(text));
    const variants = rows.map((r) => {
        const id = `${r.provider}:${r.gender || 'default'}`;
        return { id, provider: r.provider, kind: 'tts' as const, gender: r.gender || null, label: labelFor(r.provider, r.gender), gated: false, available: true, url: synthUrl(text, id) };
    });
    variants.push({ id: 'google', provider: 'google', kind: 'tts' as const, gender: null, label: 'Google', gated: false, available: true, url: synthUrl(text, 'google') });
    return variants;
}

// ---------- route definitions ----------

const variantsRoute = createRoute({
    method: 'get',
    path: '/variants',
    tags: ['Accounts'],
    summary: 'List the synth voice variants available for a text',
    request: { query: AudioVariantsQuerySchema },
    responses: {
        200: { description: 'Variant catalog.', content: { 'application/json': { schema: AudioVariantsResponseSchema } } },
        400: { description: 'Bad request.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});
audioRouter.openapi(variantsRoute, (c) => {
    const { text } = c.req.valid('query');
    c.header('Cache-Control', 'no-store');
    return c.json({ text, variants: buildSynthVariants(text) }, 200);
});

const ttsRoute = createRoute({
    method: 'get',
    path: '/tts',
    tags: ['Accounts'],
    summary: 'Serve a tagged synth TTS clip',
    request: { query: AudioTtsQuerySchema },
    responses: {
        200: { description: 'Audio bytes.', content: { 'audio/mpeg': { schema: z.any() } } },
        400: { description: 'Bad request.', content: { 'application/json': { schema: ErrorSchema } } },
        502: { description: 'TTS upstream failed.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});
audioRouter.openapi(ttsRoute, async (c) => {
    const { text, voice } = c.req.valid('query');
    const hit = await resolveTts(text.trim(), voice);
    if (!hit) return c.json({ code: 'upstream_failure' as const, error: 'tts unavailable' }, 502);
    return serveTtsHit(c, hit, { ttsLen: text.length, ttsVoice: voice || 'default' });
});

// Gated audio under /v1/audio (shares its handlers with the legacy /v1/minna mounts).

const nativeRoute = createRoute({
    method: 'get',
    path: '/native',
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
audioRouter.openapi(nativeRoute, serveNativeAudio);

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
        500: { description: 'Storage write failed.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});
audioRouter.openapi(recPostRoute, postRecording);

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
audioRouter.openapi(recListRoute, listRecordings);

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
audioRouter.openapi(recGetRoute, getRecordingBytes);

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
audioRouter.openapi(recDeleteRoute, deleteRecording);
