// Songs (歌 / Songs tab) schemas — the `song` metadata entity + its lyric lines, and the
// library/create/update/timing/delete shapes. A song's LINES are sentence-store rows, so the
// assembled line reuses SentenceSchema. The analysis endpoint's shapes live in ./songAnalyze.ts.

import { z } from '@hono/zod-openapi';
import { FuriganaSegSchema, AnnotationTokenSchema } from './common.ts';
import { SentenceSchema } from './sentences.ts';

// Bounds: a song is a handful of KB of lyrics; these just stop abuse.
const MAX_LINES = 400;

// One lyric line as persisted (the reviewed analysis): plainText + structured furigana, an English
// line, per-line grammar tags (catalog ids), LLM tokens (UTF-16 offsets), and an optional clip start.
export const SongLineInputSchema = z
    .object({
        text: z.string().min(1).max(400).openapi({ description: 'plainText of the line.', example: '朝日がゆっくり昇ってくる' }),
        furigana: z.array(FuriganaSegSchema).nullish().openapi({ description: 'Structured ruby; concat(t) === text.' }),
        en: z.string().max(600).nullish().openapi({ description: 'English translation of the line.' }),
        grammar: z.array(z.string()).optional().openapi({ description: 'Grammar-catalog ids used in the line.', example: ['te-iru'] }),
        tokens: z.array(AnnotationTokenSchema).nullish().openapi({ description: 'LLM tap-to-lookup tokens (UTF-16 offsets).' }),
        clipStartMs: z.number().int().nullish().openapi({ description: 'Per-line video start (ms); end inferred from the next line.' }),
    })
    .openapi('SongLineInput');

// The assembled song the API serves: metadata + its ordered lines (each a sentence-store row).
export const SongSchema = z
    .object({
        id: z.string().openapi({ description: 'Stable song ext_id.', example: 'usr-7b1c…' }),
        title: z.string(),
        artist: z.string().nullable(),
        youtubeId: z.string().nullable(),
        source: z.string().openapi({ example: 'song' }),
        custom: z.boolean().openapi({ description: 'true = your private song; false = a public starter.' }),
        lineCount: z.number().int(),
        timedCount: z.number().int().openapi({ description: 'Lines with a per-line clip start (timing coverage).' }),
        lines: z.array(SentenceSchema).openapi({ description: 'Ordered lyric lines (furigana/en/grammar/tokens/clip).' }),
    })
    .openapi('Song');

export const SongWordSchema = z
    .object({ lemma: z.string(), jlpt: z.string().nullable() })
    .openapi('SongWord');

// Library list item: metadata + the distinct content-word list (for coverage % + difficulty), no lines.
export const SongListItemSchema = z
    .object({
        id: z.string(),
        title: z.string(),
        artist: z.string().nullable(),
        youtubeId: z.string().nullable(),
        source: z.string(),
        custom: z.boolean(),
        lineCount: z.number().int(),
        timedCount: z.number().int(),
        words: z.array(SongWordSchema),
    })
    .openapi('SongListItem');

export const SongListResponseSchema = z.object({ songs: z.array(SongListItemSchema) }).openapi('SongListResponse');
export const SongResponseSchema = z.object({ song: SongSchema }).openapi('SongResponse');
export const SongDeleteResponseSchema = z.object({ ok: z.boolean() }).openapi('SongDeleteResponse');

// POST /v1/songs — persist a reviewed analysis (the client mints the ext_id).
export const SongCreateRequestSchema = z
    .object({
        id: z.string().min(1).max(200).openapi({ example: 'usr-7b1c…' }),
        title: z.string().min(1).max(200),
        artist: z.string().max(200).nullish(),
        youtubeId: z.string().max(40).nullish(),
        lines: z.array(SongLineInputSchema).min(1).max(MAX_LINES),
    })
    .openapi('SongCreateRequest');

// PUT /v1/songs/{id} — edit metadata only (lines are edited pre-save in the review screen).
export const SongUpdateRequestSchema = z
    .object({
        title: z.string().min(1).max(200),
        artist: z.string().max(200).nullish(),
        youtubeId: z.string().max(40).nullish(),
    })
    .openapi('SongUpdateRequest');

// PUT /v1/songs/{id}/timing — save per-line clip starts from the tap-to-sync pass.
export const SongTimingRequestSchema = z
    .object({
        timings: z
            .array(z.object({ ordinal: z.number().int().min(0), clipStartMs: z.number().int().nullable() }))
            .max(MAX_LINES),
    })
    .openapi('SongTimingRequest');

export const SongIdParamsSchema = z.object({
    id: z.string().min(1).max(200).openapi({ param: { name: 'id', in: 'path' }, description: 'The song ext_id.', example: 'usr-7b1c…' }),
});

// ---- Analysis (POST /v1/songs/analyze) — the runtime LLM pass ----

// Raw pasted lyrics; the server splits into trimmed non-empty lines (returned with the analysis).
export const SongAnalyzeRequestSchema = z
    .object({
        lyrics: z.string().min(1).max(20_000).openapi({ description: 'Raw pasted lyrics (one line per lyric line).' }),
        title: z.string().max(200).optional(),
        artist: z.string().max(200).optional(),
    })
    .openapi('SongAnalyzeRequest');

// One analyzed line: the canonical line text + furigana + English + grammar ids + offset-resolved
// tokens + proofread flags ('missing' | 'furigana' | 'tokens' | 'low-confidence').
export const AnalyzedLineSchema = z
    .object({
        index: z.number().int(),
        text: z.string(),
        furigana: z.array(FuriganaSegSchema).nullable(),
        en: z.string(),
        grammar: z.array(z.string()),
        tokens: z.array(AnnotationTokenSchema),
        flags: z.array(z.string()),
    })
    .openapi('AnalyzedLine');

export const SongAnalyzeResponseSchema = z
    .object({
        profile: z.object({ jlpt: z.string().nullable(), grammarCount: z.number().int(), lineCount: z.number().int() }),
        lines: z.array(AnalyzedLineSchema),
    })
    .openapi('SongAnalyzeResponse');

// ---- oEmbed proxy (GET /v1/songs/oembed) — keyless title/artist auto-fill ----

export const SongOembedQuerySchema = z.object({
    url: z.string().min(1).max(500).openapi({ param: { name: 'url', in: 'query' }, description: 'A YouTube watch/share URL.' }),
});

export const SongOembedResponseSchema = z
    .object({ title: z.string(), author: z.string(), youtubeId: z.string().nullable() })
    .openapi('SongOembedResponse');
