// みんなの日本語 schemas — the lesson dashboard (lessons list + lesson payload + native-
// audio query) and the Phase-2 record-and-compare surface (recordings CRUD + practice
// history).

import { z } from '@hono/zod-openapi';

export const MinnaLessonsResponseSchema = z
    .object({
        lessons: z.array(z.number().int()).openapi({
            description: 'Lesson numbers that have curated content available on this server.',
            example: [22, 23, 24],
        }),
    })
    .openapi('MinnaLessonsResponse');

export const MinnaLessonParamsSchema = z.object({
    n: z
        .string()
        .regex(/^\d+$/)
        .openapi({ param: { name: 'n', in: 'path' }, description: 'Lesson number (1–50).', example: '23' }),
});

export const MinnaAudioQuerySchema = z.object({
    src: z.string().openapi({
        param: { name: 'src', in: 'query' },
        description: 'vnjpclub audio path, e.g. /Audio/minnamoi/bai23/<id>.mp3 — validated server-side.',
        example: '/Audio/minnamoi/bai23/00010101011101110.mp3',
    }),
});

// The curated lesson payload is served verbatim from data/minna/lesson-<n>.json.
// Loosely typed — the study-app client owns the shape; this is just for docs.
export const MinnaLessonSchema = z
    .object({
        lesson: z.number().int().openapi({ example: 23 }),
        title: z.string().optional(),
        theme: z.string().optional(),
        vocab: z.array(z.any()).openapi({ description: 'Vocabulary items (kana/kanji/meaning/audio/cat…).' }),
        grammar: z.array(z.any()).optional(),
        examples: z.array(z.any()).optional(),
        conversation: z.any().optional(),
    })
    .openapi('MinnaLesson');

// One saved voice take, as returned to the client (the storage key + owner are
// internal and never serialized).
export const MinnaRecordingSchema = z
    .object({
        id: z.number().int(),
        lesson: z.number().int(),
        itemKey: z.string().openapi({ description: "What the take is of, e.g. 'mnn:23:0' or 'mnn:23:conv:2'." }),
        durationMs: z.number().int().nullable(),
        createdAt: z.number().int(),
    })
    .openapi('MinnaRecording');

// POST /v1/audio/recordings — the audio bytes are the raw request body; the
// metadata rides in the query string.
export const MinnaRecordingPostQuerySchema = z.object({
    lesson: z.string().regex(/^\d+$/).openapi({ param: { name: 'lesson', in: 'query' }, example: '23' }),
    itemKey: z.string().min(1).max(80).openapi({ param: { name: 'itemKey', in: 'query' }, example: 'mnn:23:0' }),
    durationMs: z.string().regex(/^\d+$/).optional().openapi({ param: { name: 'durationMs', in: 'query' }, example: '1800' }),
    // Keep-the-newest-N per item; clamped to [1, 20] server-side.
    keep: z.string().regex(/^\d+$/).optional().openapi({ param: { name: 'keep', in: 'query' }, example: '3' }),
});

export const MinnaRecordingPostResponseSchema = z
    .object({
        ok: z.boolean(),
        recording: MinnaRecordingSchema,
        // The item's current take list (newest first) after insert + prune, so the
        // client can re-render without a follow-up GET.
        takes: z.array(MinnaRecordingSchema),
    })
    .openapi('MinnaRecordingPostResponse');

export const MinnaRecordingsListQuerySchema = z.object({
    lesson: z.string().regex(/^\d+$/).openapi({ param: { name: 'lesson', in: 'query' }, example: '23' }),
});

export const MinnaRecordingsListResponseSchema = z
    .object({ recordings: z.array(MinnaRecordingSchema) })
    .openapi('MinnaRecordingsListResponse');

export const MinnaRecordingIdParamsSchema = z.object({
    id: z.string().regex(/^\d+$/).openapi({ param: { name: 'id', in: 'path' }, example: '42' }),
});

export const MinnaRecordingDeleteResponseSchema = z
    .object({ ok: z.boolean() })
    .openapi('MinnaRecordingDeleteResponse');

// GET /v1/minna/practice — the user's per-lesson practice history (recording counts).
export const MinnaPracticeLessonSchema = z
    .object({
        lesson: z.number().int(),
        items: z.number().int().openapi({ description: 'Distinct items (words / conversation lines) recorded in this lesson.' }),
        takes: z.number().int().openapi({ description: 'Total takes saved in this lesson.' }),
        lastCreatedAt: z.number().int().openapi({ description: "Newest take's createdAt (epoch ms)." }),
    })
    .openapi('MinnaPracticeLesson');

export const MinnaPracticeResponseSchema = z
    .object({
        lessons: z.array(MinnaPracticeLessonSchema),
        totalItems: z.number().int(),
        totalTakes: z.number().int(),
    })
    .openapi('MinnaPracticeResponse');
