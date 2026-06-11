// Shared Zod schemas. Used for both request validation and OpenAPI doc
// generation by @hono/zod-openapi — a single source of truth replaces the
// hand-written spec at src/openapi.ts.
//
// .openapi() adds the field-level OpenAPI metadata; .openapi({ ref: 'Name' })
// at the top level promotes a schema into components/schemas so it shows up
// as a reusable type in the docs UI.

import { z } from '@hono/zod-openapi';

// ---------- Components ----------

export const ExampleSchema = z
    .object({
        id: z.string().openapi({
            description: 'Stable id; same example always lands at the same media key.',
            example: 'anime_hunter_x_hunter_000017918',
        }),
        sentence: z.string().openapi({ example: '今日は外で食べる予定です。' }),
        sentenceFurigana: z.string().openapi({
            description: 'Bracket-format furigana: `今日[きょう]は外[そと]で食[た]べる予定[よてい]です。`',
            example: '今日[きょう]は外[そと]で食[た]べる予定[よてい]です。',
        }),
        translation: z.string().openapi({ example: "We're planning to eat outside today." }),
        wordList: z.array(z.string()).openapi({
            description: "IK's pre-tokenized words. Used client-side for click-to-lookup.",
        }),
        source: z
            .object({
                title: z.string().openapi({ description: 'Pretty title.', example: 'Hunter × Hunter' }),
                category: z.string().openapi({
                    description: 'IK source category — typically anime / drama / games / literature / news.',
                    example: 'anime',
                }),
                encodedTitle: z.string().openapi({
                    description: "IK's lossy snake_case encoding; useful for debugging.",
                    example: 'hunter_x_hunter',
                }),
            })
            .openapi('ExampleSource'),
        jlptMax: z.number().int().min(0).max(5).openapi({
            description:
                'Hardest known surrounding word\'s JLPT level. 5=N5 easiest, 1=N1 hardest. ' +
                '0 = "unknown / no identifiable tokens" — fail-open sentinel that passes any ceiling filter.',
        }),
        hasOriginalAudio: z.boolean().openapi({
            description: 'true = IK voice-actor recording. false = Google TTS fallback.',
        }),
        audioUrl: z.string().url().nullable(),
        imageUrl: z.string().url().nullable(),
    })
    .openapi('Example');

export const VocabPayloadSchema = z
    .object({
        word: z.string().openapi({ example: '食べる' }),
        fetchedAt: z.number().int().openapi({ description: 'Epoch ms when this payload was last warmed.' }),
        examples: z.array(ExampleSchema),
        fallbackImages: z
            .array(z.string().url())
            .openapi({
                description:
                    "DDG illustration pool. Used when an example's imageUrl is null or the client cycles ⟳.",
            }),
        incomplete: z.boolean().optional().openapi({
            description:
                'true on payloads where the DDG fallback pool is still warming in the background ' +
                '(returned this way on cold lazy-fill to keep response latency low). Clients should ' +
                'cache short and re-fetch within seconds to pick up the full version. Absent or false ' +
                'on payloads from completed warms.',
        }),
    })
    .openapi('VocabPayload');

export const IndexMetaSchema = z
    .object({
        fetchedAt: z.number().int(),
        decks: z
            .record(
                z.string(),
                z.object({
                    title: z.string().openapi({ example: 'Kanon (2006)' }),
                    category: z.string().openapi({ example: 'anime' }),
                }),
            )
            .openapi({ description: 'Map of IK encoded titles → { title, category }.' }),
    })
    .openapi('IndexMeta');

export const HealthSchema = z
    .object({
        status: z.literal('ok'),
        version: z.string().openapi({ example: '0.1.0' }),
        warmedWords: z.number().int(),
        lastWarm: z
            .object({
                id: z.number().int(),
                scope: z.enum(['all', 'word']),
                target: z.string().nullable(),
                startedAt: z.number().int(),
                finishedAt: z.number().int().nullable(),
                wordsProcessed: z.number().int(),
                wordsFailed: z.number().int(),
                error: z.string().nullable(),
            })
            .nullable(),
    })
    .openapi('Health');

// Enum of error codes. Clients use these for programmatic handling (e.g.
// retry on upstream_failure, give up on validation_error). The human-readable
// `error` string can change without breaking clients; `code` is the contract.
export const ErrorCodeSchema = z
    .enum([
        'validation_error',   // body/params didn't satisfy the Zod schema
        'unauthorized',       // missing or wrong bearer token
        'not_found',          // resource doesn't exist (or ?nowarm=true miss)
        'conflict',           // request collides with current server state (e.g. warmAll already running)
        'upstream_failure',   // IK / DDG / TTS or warm pipeline failed
        'service_unavailable',// dependency unavailable (e.g. no cached index_meta and live fetch failed)
        'rate_limited',       // too many requests from this client (auth endpoints); see Retry-After
        'internal_error',     // unhandled exception in our code
    ])
    .openapi('ErrorCode');

export const ErrorSchema = z
    .object({
        code: ErrorCodeSchema,
        error: z.string().openapi({
            description: 'Short human-readable summary. May change between versions; switch on `code` instead.',
        }),
        detail: z.string().optional().openapi({
            description: 'Additional context — failing field name, upstream error message, etc.',
        }),
    })
    .openapi('Error');

// ---------- Request bodies ----------

// Discriminated union on `scope`. Each branch validates the fields its scope
// actually uses, so the docs UI shows three distinct request shapes.
export const WarmRequestSchema = z
    .discriminatedUnion('scope', [
        z
            .object({
                scope: z.literal('word'),
                word: z.string().min(1).openapi({ example: '食べる' }),
                force: z.boolean().optional().openapi({
                    description: 'Re-warm even if the cached entry is fresh.',
                }),
            })
            .openapi('WarmWordRequest'),
        z
            .object({
                scope: z.literal('all'),
                force: z.boolean().optional(),
            })
            .openapi('WarmAllRequest'),
        z
            .object({
                scope: z.literal('index_meta'),
            })
            .openapi('WarmIndexMetaRequest'),
    ])
    .openapi('WarmRequest');

export const WarmWordResponseSchema = z
    .object({
        ok: z.boolean(),
        word: z.string(),
        examples: z.number().int(),
        payload: VocabPayloadSchema,
    })
    .openapi('WarmWordResponse');

export const WarmAllResponseSchema = z
    .object({
        ok: z.boolean(),
        message: z.string(),
    })
    .openapi('WarmAllResponse');

export const WarmIndexMetaResponseSchema = z
    .object({
        ok: z.boolean(),
    })
    .openapi('WarmIndexMetaResponse');

// ---------- Path params + query ----------

export const VocabParamsSchema = z.object({
    word: z
        .string()
        .min(1)
        .openapi({
            param: { name: 'word', in: 'path' },
            description: 'Dictionary-form Japanese word (URL-encode the kanji).',
            example: '食べる',
        }),
});

export const VocabQuerySchema = z.object({
    nowarm: z
        .enum(['true', 'false'])
        .optional()
        .openapi({
            param: { name: 'nowarm', in: 'query' },
            description:
                'If "true", return 404 instead of lazy-warming a cold word. ' +
                'Use this when prefetching in the background, where you don\'t want to pay ' +
                'the 10–30s cold-warm cost just to discover a word isn\'t in IK.',
        }),
});

// ---------- Batch fetch ----------

export const BatchRequestSchema = z
    .object({
        words: z
            .array(z.string().min(1))
            .min(1)
            .max(50)
            .openapi({
                description:
                    'Up to 50 vocab words. Duplicates are deduplicated server-side. Words not currently ' +
                    'in the cache are returned in `missing` (no warming triggered). The userscript should ' +
                    'fire individual GET /v1/vocab/{word} requests for misses if it wants lazy fill.',
                example: ['食べる', '飲む', '見る'],
            }),
    })
    .openapi('BatchRequest');

export const BatchResponseSchema = z
    .object({
        found: z.record(z.string(), VocabPayloadSchema).openapi({
            description: 'Map of word → payload for cache hits.',
        }),
        missing: z.array(z.string()).openapi({
            description: 'Words from the request that have no cached entry.',
        }),
    })
    .openapi('BatchResponse');

// ---------- Warm-job listing ----------

export const WarmJobSchema = z
    .object({
        id: z.number().int(),
        scope: z.enum(['all', 'word']),
        target: z.string().nullable(),
        startedAt: z.number().int(),
        finishedAt: z.number().int().nullable(),
        wordsProcessed: z.number().int(),
        wordsFailed: z.number().int(),
        error: z.string().nullable(),
    })
    .openapi('WarmJob');

export const JobsQuerySchema = z.object({
    limit: z
        .string()
        .regex(/^\d+$/)
        .optional()
        .openapi({
            param: { name: 'limit', in: 'query' },
            description: 'Max rows to return (default 20, hard max 100).',
        }),
});

export const JobsResponseSchema = z
    .object({
        jobs: z.array(WarmJobSchema),
    })
    .openapi('JobsResponse');

// ---------- Accounts / auth ----------

export const CredentialsSchema = z
    .object({
        email: z.string().email().openapi({ example: 'learner@example.com' }),
        // 8-char floor; no max so passphrases work. Bun.password handles any
        // length. We don't impose composition rules (length beats complexity).
        password: z.string().min(8).max(200).openapi({
            description: 'At least 8 characters.',
            example: 'correct horse battery staple',
        }),
    })
    .openapi('Credentials');

export const PublicUserSchema = z
    .object({
        id: z.number().int(),
        email: z.string().email(),
        createdAt: z.number().int(),
    })
    .openapi('PublicUser');

// Returned by register/login/me. `user` is null only on the unauthenticated
// branch of /v1/auth/me (200 with user:null), which lets the client probe
// login state without treating "logged out" as an error.
export const AuthResponseSchema = z
    .object({
        user: PublicUserSchema.nullable(),
    })
    .openapi('AuthResponse');

export const LogoutResponseSchema = z
    .object({ ok: z.boolean() })
    .openapi('LogoutResponse');

// ---------- Study-app progress ----------

// The progress blob is opaque to the server — it's whatever the study app's
// client-side `store` serializes to. z.any() keeps us decoupled from the
// app's evolving shape; the app owns its own schema versioning.
export const ProgressGetResponseSchema = z
    .object({
        data: z.any().nullable().openapi({
            description: 'The stored progress blob, or null if none saved yet.',
        }),
        updatedAt: z.number().int().nullable().openapi({
            description: 'Epoch ms of the last save, or null if none saved yet.',
        }),
    })
    .openapi('ProgressGetResponse');

export const ProgressPutRequestSchema = z
    .object({
        data: z.any().openapi({
            description: 'The full client store to persist. Replaces the prior blob.',
        }),
    })
    .openapi('ProgressPutRequest');

export const ProgressPutResponseSchema = z
    .object({
        ok: z.boolean(),
        updatedAt: z.number().int(),
    })
    .openapi('ProgressPutResponse');

// One completed study session, appended to the durable server-side log.
export const SessionPostRequestSchema = z
    .object({
        right: z.number().int().min(0),
        total: z.number().int().min(1),
        mode: z.string().max(20).optional(),
        details: z.any().optional(),
    })
    .openapi('SessionPostRequest');

export const SessionPostResponseSchema = z
    .object({
        ok: z.boolean(),
        id: z.number().int(),
        count: z.number().int().openapi({ description: 'Lifetime session count for this user.' }),
    })
    .openapi('SessionPostResponse');

// ---------- みんなの日本語 dashboard ----------

export const MinnaLessonsResponseSchema = z
    .object({
        lessons: z.array(z.number().int()).openapi({
            description: 'Lesson numbers that have curated content available on this server.',
            example: [23],
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

// ---------- みんなの日本語 record-and-compare (Phase 2) ----------

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

// POST /v1/minna/recordings — the audio bytes are the raw request body; the
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
