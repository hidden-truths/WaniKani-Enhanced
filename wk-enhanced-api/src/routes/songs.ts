// Songs (歌 / Songs tab) — the song library + BYO-song CRUD. A song's METADATA lives in the `song`
// table; its lyric LINES are sentence-store rows (owner_type='song'), so reads reuse the
// getSentences privacy gate. The runtime LLM analysis endpoint (POST /v1/songs/analyze) +
// the oEmbed proxy live in ./songsAnalyze.ts (mounted on this same router).
//
//   GET    /v1/songs            — library: public starters + own private songs (anon-readable)
//   GET    /v1/songs/{id}       — one song: metadata + ordered lines (gated)
//   POST   /v1/songs            — persist a reviewed analysis as a PRIVATE song (cookie)
//   PUT    /v1/songs/{id}       — edit metadata (cookie, owner)
//   PUT    /v1/songs/{id}/timing— save per-line clip starts from tap-to-sync (cookie, owner)
//   DELETE /v1/songs/{id}       — delete own song + its line rows (cookie, owner)
//
// READ is anon-friendly (starters are public); WRITES require an account (BYO songs are private).
// This router is in index.ts's STUDY_ROUTE CORS allowlist — every call is credentialed.

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import * as db from '../db/client.ts';
import { currentUser } from '../lib/auth.ts';
import { unauthorized as httpUnauthorized, notFound as httpNotFound } from '../lib/httpErrors.ts';
import {
    SongListResponseSchema,
    SongResponseSchema,
    SongDeleteResponseSchema,
    SongCreateRequestSchema,
    SongUpdateRequestSchema,
    SongTimingRequestSchema,
    SongIdParamsSchema,
    SongAnalyzeRequestSchema,
    SongAnalyzeResponseSchema,
    SongOembedQuerySchema,
    SongOembedResponseSchema,
    ErrorSchema,
} from '../schemas.ts';
import { analyzeLyrics, splitLyrics, isAnalysisConfigured, AnalysisUnavailableError } from '../services/songAnalyze.ts';
import { zodHook } from '../lib/zodHook.ts';
import { log } from '../lib/log.ts';

// Parse a YouTube video id from a watch / youtu.be / embed / shorts URL (also the SSRF guard for the
// oEmbed proxy — we only ever fetch youtube.com/oembed for a validated id).
function parseYouTubeId(url: string): string | null {
    let id: string | null = null;
    try {
        const u = new URL(url.trim());
        const host = u.hostname.replace(/^(www\.|m\.)/, '');
        if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] || null;
        else if (host === 'youtube.com') {
            if (u.pathname === '/watch') id = u.searchParams.get('v');
            else {
                const m = u.pathname.match(/^\/(embed|shorts|v)\/([^/?#]+)/);
                if (m) id = m[2]!;
            }
        }
    } catch {
        return null;
    }
    return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
}

const serviceUnavailable = (c: any, detail: string) =>
    c.json({ code: 'service_unavailable' as const, error: 'analysis unavailable', detail }, 503);

export const songsRouter = new OpenAPIHono({ defaultHook: zodHook });

// A song carries lyrics + per-line tokens, so it's bigger than a single sentence — but still small.
const MAX_SONG_BYTES = 512_000;
const MAX_USER_SONGS = 200;

const unauthorized = (c: any) => httpUnauthorized(c, 'Log in to add or edit songs.');
const notFound = (c: any) => httpNotFound(c, 'No song with that id is yours.');

const tooLarge = (c: any, obj: unknown, max: number) =>
    JSON.stringify(obj).length > max
        ? c.json({ code: 'validation_error' as const, error: 'song too large', detail: `max ${max} bytes` }, 400)
        : null;

// ---------- GET / (library) ----------

const listRoute = createRoute({
    method: 'get',
    path: '/',
    tags: ['Accounts'],
    summary: 'List songs (public starters + own private)',
    responses: {
        200: { description: 'Songs.', content: { 'application/json': { schema: SongListResponseSchema } } },
    },
});

songsRouter.openapi(listRoute, (c) => {
    const user = currentUser(c); // null = anon → public starters only
    c.header('Cache-Control', 'no-store');
    const songs = db.getSongs({ viewer: user?.id ?? null });
    c.set('logCtx', { viewer: user?.id ?? null, count: songs.length });
    return c.json({ songs }, 200);
});

// ---------- POST /analyze (the runtime LLM pass) ----------
// Static path, registered before /{id} so it never matches the id param route.

const analyzeRoute = createRoute({
    method: 'post',
    path: '/analyze',
    tags: ['Accounts'],
    summary: 'Analyze pasted lyrics → furigana + English + grammar + JLPT tokens',
    request: { body: { required: true, content: { 'application/json': { schema: SongAnalyzeRequestSchema } } } },
    responses: {
        200: { description: 'Per-line analysis.', content: { 'application/json': { schema: SongAnalyzeResponseSchema } } },
        400: { description: 'No analyzable lines.', content: { 'application/json': { schema: ErrorSchema } } },
        401: { description: 'Not logged in.', content: { 'application/json': { schema: ErrorSchema } } },
        502: { description: 'The analysis model call failed.', content: { 'application/json': { schema: ErrorSchema } } },
        503: { description: 'Analysis not configured on this server (no model API key).', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

songsRouter.openapi(analyzeRoute, async (c) => {
    const user = currentUser(c);
    if (!user) return unauthorized(c); // writes nothing, but it's a metered model call → account-gated
    if (!isAnalysisConfigured()) return serviceUnavailable(c, 'Lyrics analysis isn’t available on this server yet.');
    const { lyrics, title, artist } = c.req.valid('json');
    const lines = splitLyrics(lyrics);
    if (!lines.length) return c.json({ code: 'validation_error' as const, error: 'no lyrics', detail: 'Paste at least one line.' }, 400);
    try {
        const result = await analyzeLyrics({ lines, title, artist });
        c.header('Cache-Control', 'no-store');
        return c.json(result, 200);
    } catch (err) {
        if (err instanceof AnalysisUnavailableError) return serviceUnavailable(c, 'Lyrics analysis isn’t available on this server yet.');
        const msg = err instanceof Error ? err.message : String(err);
        log.error('songs.analyze.failed', { userId: user.id, lines: lines.length, err: msg });
        return c.json({ code: 'upstream_failure' as const, error: 'analysis failed', detail: msg }, 502);
    }
});

// ---------- GET /oembed (keyless YouTube title/artist) ----------

const oembedRoute = createRoute({
    method: 'get',
    path: '/oembed',
    tags: ['Accounts'],
    summary: 'Fetch a YouTube video’s title/artist + id (keyless oEmbed proxy)',
    request: { query: SongOembedQuerySchema },
    responses: {
        200: { description: 'Title/artist (best-effort) + the parsed video id.', content: { 'application/json': { schema: SongOembedResponseSchema } } },
        400: { description: 'Not a YouTube URL.', content: { 'application/json': { schema: ErrorSchema } } },
        401: { description: 'Not logged in.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

songsRouter.openapi(oembedRoute, async (c) => {
    const user = currentUser(c);
    if (!user) return unauthorized(c); // outbound fetch → don't expose as an open proxy
    const { url } = c.req.valid('query');
    const youtubeId = parseYouTubeId(url);
    if (!youtubeId) return c.json({ code: 'validation_error' as const, error: 'not a YouTube URL', detail: 'Paste a youtube.com or youtu.be link.' }, 400);
    let title = '';
    let author = '';
    try {
        const oe = `https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + youtubeId)}&format=json`;
        const r = await fetch(oe, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'wk-enhanced-api' } });
        if (r.ok) {
            const j = (await r.json()) as { title?: string; author_name?: string };
            title = typeof j.title === 'string' ? j.title : '';
            author = typeof j.author_name === 'string' ? j.author_name : '';
        }
    } catch {
        // best-effort — the client falls back to manual title/artist entry
    }
    c.header('Cache-Control', 'no-store');
    return c.json({ title, author, youtubeId }, 200);
});

// ---------- GET /{id} ----------

const getRoute = createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Accounts'],
    summary: 'Get one song with its ordered lines',
    request: { params: SongIdParamsSchema },
    responses: {
        200: { description: 'The song.', content: { 'application/json': { schema: SongResponseSchema } } },
        404: { description: 'No such visible song.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

songsRouter.openapi(getRoute, (c) => {
    const user = currentUser(c);
    const { id } = c.req.valid('param');
    c.header('Cache-Control', 'no-store');
    const song = db.getSong({ extId: id, viewer: user?.id ?? null });
    if (!song) return httpNotFound(c, 'No song with that id is visible to you.');
    return c.json({ song }, 200);
});

// ---------- POST / (create) ----------

const createRouteDef = createRoute({
    method: 'post',
    path: '/',
    tags: ['Accounts'],
    summary: 'Create a private song from a reviewed analysis',
    request: { body: { required: true, content: { 'application/json': { schema: SongCreateRequestSchema } } } },
    responses: {
        200: { description: 'Created (or the existing song on an idempotent re-POST).', content: { 'application/json': { schema: SongResponseSchema } } },
        400: { description: 'Malformed body, too large, or furigana mismatch.', content: { 'application/json': { schema: ErrorSchema } } },
        401: { description: 'Not logged in.', content: { 'application/json': { schema: ErrorSchema } } },
        409: { description: 'That song id is already taken.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

songsRouter.openapi(createRouteDef, (c) => {
    const user = currentUser(c);
    if (!user) return unauthorized(c);
    const body = c.req.valid('json');

    const oversize = tooLarge(c, body, MAX_SONG_BYTES);
    if (oversize) return oversize;

    // Idempotent re-POST of the user's own id → return the existing song. A visible song with that id
    // that's NOT theirs is either a public starter (custom=false) or another account's private song
    // (createSong's UNIQUE below catches that) — refuse to let them claim it.
    const existing = db.getSong({ extId: body.id, viewer: user.id });
    if (existing) {
        if (existing.custom) return c.json({ song: existing }, 200);
        return c.json({ code: 'conflict' as const, error: 'id already taken', detail: 'That song id is reserved.' }, 409);
    }

    if (db.countUserSongs(user.id) >= MAX_USER_SONGS) {
        return c.json({ code: 'validation_error' as const, error: 'too many songs', detail: `max ${MAX_USER_SONGS} per account` }, 400);
    }

    try {
        const song = db.createSong({
            extId: body.id,
            title: body.title,
            artist: body.artist ?? null,
            youtubeId: body.youtubeId ?? null,
            createdBy: user.id,
            lines: body.lines,
        });
        log.info('song.create', { userId: user.id, extId: body.id, lines: body.lines.length });
        return c.json({ song }, 200);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/UNIQUE constraint failed: song\.ext_id/i.test(msg)) {
            return c.json({ code: 'conflict' as const, error: 'id already taken', detail: 'That song id belongs to another account.' }, 409);
        }
        return c.json({ code: 'validation_error' as const, error: 'invalid song', detail: msg }, 400);
    }
});

// ---------- PUT /{id} (metadata) ----------

const updateRoute = createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['Accounts'],
    summary: "Edit one of your songs' metadata",
    request: {
        params: SongIdParamsSchema,
        body: { required: true, content: { 'application/json': { schema: SongUpdateRequestSchema } } },
    },
    responses: {
        200: { description: 'Updated.', content: { 'application/json': { schema: SongResponseSchema } } },
        401: { description: 'Not logged in.', content: { 'application/json': { schema: ErrorSchema } } },
        404: { description: 'No such song owned by you.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

songsRouter.openapi(updateRoute, (c) => {
    const user = currentUser(c);
    if (!user) return unauthorized(c);
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const song = db.updateSong({
        extId: id,
        viewer: user.id,
        title: body.title,
        artist: body.artist ?? null,
        youtubeId: body.youtubeId ?? null,
    });
    if (!song) return notFound(c);
    log.info('song.update', { userId: user.id, extId: id });
    return c.json({ song }, 200);
});

// ---------- PUT /{id}/timing (tap-to-sync) ----------
// Two path segments so it never shadows PUT /{id}.

const timingRoute = createRoute({
    method: 'put',
    path: '/{id}/timing',
    tags: ['Accounts'],
    summary: "Save a song's per-line clip starts (tap-to-sync)",
    request: {
        params: SongIdParamsSchema,
        body: { required: true, content: { 'application/json': { schema: SongTimingRequestSchema } } },
    },
    responses: {
        200: { description: 'Updated.', content: { 'application/json': { schema: SongResponseSchema } } },
        401: { description: 'Not logged in.', content: { 'application/json': { schema: ErrorSchema } } },
        404: { description: 'No such song owned by you.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

songsRouter.openapi(timingRoute, (c) => {
    const user = currentUser(c);
    if (!user) return unauthorized(c);
    const { id } = c.req.valid('param');
    const { timings } = c.req.valid('json');
    const song = db.updateSongTiming({ extId: id, viewer: user.id, timings });
    if (!song) return notFound(c);
    log.info('song.timing', { userId: user.id, extId: id, marked: timings.length });
    return c.json({ song }, 200);
});

// ---------- DELETE /{id} ----------

const deleteRoute = createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Accounts'],
    summary: 'Delete one of your songs',
    request: { params: SongIdParamsSchema },
    responses: {
        200: { description: 'Deleted.', content: { 'application/json': { schema: SongDeleteResponseSchema } } },
        401: { description: 'Not logged in.', content: { 'application/json': { schema: ErrorSchema } } },
        404: { description: 'No such song owned by you.', content: { 'application/json': { schema: ErrorSchema } } },
    },
});

songsRouter.openapi(deleteRoute, (c) => {
    const user = currentUser(c);
    if (!user) return unauthorized(c);
    const { id } = c.req.valid('param');
    const ok = db.deleteSong({ extId: id, viewer: user.id });
    if (!ok) return notFound(c);
    log.info('song.delete', { userId: user.id, extId: id });
    return c.json({ ok: true }, 200);
});
