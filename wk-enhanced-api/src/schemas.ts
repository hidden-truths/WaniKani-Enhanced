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

// ---------- unified audio (/v1/audio) ----------

// GET /v1/audio/variants?text= — which SYNTH voices exist for a text. Native + user-recording
// variants aren't here: the client already knows the minna path / has the recordings list and
// folds those into the catalog itself.
export const AudioVariantsQuerySchema = z.object({
    text: z.string().min(1).max(200).openapi({ param: { name: 'text', in: 'query' }, example: '食べる' }),
});

// One tagged voice variant. The synth-only descriptors this endpoint returns are always
// public (gated:false); the client adds gated native/user descriptors of its own.
export const AudioVariantSchema = z
    .object({
        id: z.string().openapi({ description: "'<provider>:<gender|default>', e.g. 'siri:female' or 'google'.", example: 'siri:female' }),
        provider: z.string().openapi({ example: 'siri' }),
        kind: z.enum(['tts', 'native', 'user']).openapi({ description: 'The KIND axis users can prioritize by.', example: 'tts' }),
        gender: z.string().nullable().openapi({ example: 'female' }),
        label: z.string().openapi({ example: 'Siri · female' }),
        gated: z.boolean().openapi({ description: 'true → play via a credentialed <audio>; false → public.', example: false }),
        available: z.boolean().openapi({ example: true }),
        url: z.string().openapi({ description: 'Playback path (rebase onto API_BASE client-side).', example: '/v1/audio/tts?text=%E9%A3%9F%E3%81%B9%E3%82%8B&voice=siri:female' }),
    })
    .openapi('AudioVariant');

export const AudioVariantsResponseSchema = z
    .object({ text: z.string(), variants: z.array(AudioVariantSchema) })
    .openapi('AudioVariantsResponse');

// GET /v1/audio/tts?text=&voice= — serve a tagged synth clip. `voice` omitted/'default'/'google'
// → the default 3-tier; a specific voice (e.g. 'siri:female') prefers its clip then falls through.
export const AudioTtsQuerySchema = z.object({
    text: z.string().min(1).max(200).openapi({ param: { name: 'text', in: 'query' }, example: '食べる' }),
    voice: z.string().max(40).optional().openapi({ param: { name: 'voice', in: 'query' }, example: 'siri:female' }),
});

// ---------- unified sentence store (/v1/sentences) ----------

// A furigana segment: base `t`, optional reading `r`. concat(seg.t) MUST equal the
// sentence's plain text (enforced server-side on write); the kana reading is derived
// client-side (seg.r ?? seg.t), never stored.
export const FuriganaSegSchema = z
    .object({
        t: z.string().openapi({ description: 'Base text (a kanji run or plain kana).', example: '歯' }),
        r: z.string().optional().openapi({ description: 'Kana reading over `t`; omitted for plain text.', example: 'は' }),
    })
    .openapi('FuriganaSeg');

// The link between a sentence and what owns/illustrates it. Self-Talk uses
// `{ owner_type: 'selftalk' }`; card/grammar/conversation owners arrive in later phases.
export const SentenceLinkSchema = z
    .object({
        owner_type: z.string().openapi({ example: 'selftalk' }),
        owner_id: z.string().nullable().optional(),
        tier: z.string().nullable().optional(),
        role: z.string().nullable().optional(),
        ordinal: z.number().int().optional(),
        clip_start_ms: z.number().int().nullable().optional(),
        clip_end_ms: z.number().int().nullable().optional(),
    })
    .openapi('SentenceLink');

// GiNZA-derived structure (Phase 4 NLP enrichment), served only when ?annotate=1. A token is one
// morpheme; `start`/`end` are UTF-16 code-unit offsets into `text` (see the offset-contract
// dead-end in wk-enhanced-api/CLAUDE.md), so the client maps a tap by slicing `text` in JS. `lemma`
// (dictionary form) drives the card/Jisho link; `reading` is GiNZA's (visible reading is furigana).
export const AnnotationTokenSchema = z
    .object({
        i: z.number().int(),
        start: z.number().int(),
        end: z.number().int(),
        surface: z.string(),
        lemma: z.string(),
        pos: z.string(),
        tag: z.string(),
        reading: z.string(),
        dep: z.string(),
        head: z.number().int(),
    })
    .openapi('AnnotationToken');

// A phrase chunk (also UTF-16 offsets into text), for phrase-level highlight / grammar matching.
export const AnnotationBunsetsuSchema = z
    .object({ start: z.number().int(), end: z.number().int() })
    .openapi('AnnotationBunsetsu');

export const SentenceAnnotationSchema = z
    .object({
        tokens: z.array(AnnotationTokenSchema),
        bunsetsu: z.array(AnnotationBunsetsuSchema),
        parser: z.string().openapi({ example: 'ja_ginza_electra/5.2.0 ginza/5.2.0 splitC' }),
        parsedAt: z.number().int().openapi({ description: 'Epoch ms the parse was loaded.' }),
    })
    .openapi('SentenceAnnotation');

// The assembled sentence the API serves (composed from sentence + translation + tag + link).
export const SentenceSchema = z
    .object({
        id: z.string().openapi({ description: 'Stable external id (builtin slug or user UUID).', example: 'st-morning-1' }),
        text: z.string().openapi({ description: 'plainText canonical (the audio key).', example: '歯を磨いている。' }),
        furigana: z.array(FuriganaSegSchema).nullable().openapi({ description: 'Structured ruby; concat(t) === text.' }),
        translations: z.record(z.string(), z.string()).openapi({ description: 'Lang → translation, e.g. { en: "…" }.' }),
        tags: z
            .record(z.string(), z.union([z.string(), z.array(z.string())]))
            .openapi({ description: 'e.g. { topic: "morning", grammar: ["te-iru"] }.' }),
        link: SentenceLinkSchema,
        custom: z.boolean().openapi({ description: 'true = user-authored (private); false = curator/public.' }),
        annotation: SentenceAnnotationSchema.optional().openapi({
            description: 'GiNZA tokens/bunsetsu. Present only when ?annotate=1 AND the sentence is parsed (public rows + the viewer’s own private rows).',
        }),
    })
    .openapi('Sentence');

export const SentenceListResponseSchema = z
    .object({ sentences: z.array(SentenceSchema) })
    .openapi('SentenceListResponse');

// GET /v1/sentences?ownerType=[&ownerId=] — 'selftalk' (Phase 1) + 'card' (Phase 2, built-in
// vocab example sentences). The enum widens as later phases wire grammar/conversation owners.
// ownerId narrows a 'card' read to one rank; omitted = the whole owner surface (the deck's
// boot batch). Returns one entry per link (a reused sentence reports every owner_id/tier).
export const SentenceListQuerySchema = z.object({
    ownerType: z
        .enum(['selftalk', 'card'])
        .openapi({ param: { name: 'ownerType', in: 'query' }, description: 'Which owner surface to read.', example: 'card' }),
    ownerId: z
        .string()
        .optional()
        .openapi({ param: { name: 'ownerId', in: 'query' }, description: 'Optional: narrow to one owner (e.g. a card rank).', example: '1' }),
    // Opt-in: '1' attaches each sentence's GiNZA token annotation (tap-to-lookup). A plain string so
    // any other/absent value is simply off — never a validation 400. Off keeps the payload unchanged.
    annotate: z
        .string()
        .optional()
        .openapi({ param: { name: 'annotate', in: 'query' }, description: 'Set to "1" to include token annotations per sentence.', example: '1' }),
});

// POST body — carries the CLIENT-generated id (ext_id). text/furigana/tags/translations/link
// describe the sentence; the server computes the hash + stamps it private.
export const SentenceCreateRequestSchema = z
    .object({
        id: z.string().min(1).max(200).openapi({ example: 'usr-7b1c…' }),
        text: z.string().min(1).max(1000),
        furigana: z.array(FuriganaSegSchema).nullish(),
        translations: z.record(z.string(), z.string()).optional(),
        tags: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
        link: SentenceLinkSchema,
    })
    .openapi('SentenceCreateRequest');

// PUT body — same as create minus `id` (the id rides in the path). Full replace.
export const SentenceUpdateRequestSchema = z
    .object({
        text: z.string().min(1).max(1000),
        furigana: z.array(FuriganaSegSchema).nullish(),
        translations: z.record(z.string(), z.string()).optional(),
        tags: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
        link: SentenceLinkSchema.optional(),
    })
    .openapi('SentenceUpdateRequest');

export const SentenceIdParamsSchema = z.object({
    id: z.string().min(1).max(200).openapi({ param: { name: 'id', in: 'path' }, description: 'The sentence ext_id.', example: 'usr-7b1c…' }),
});

export const SentenceMutateResponseSchema = z
    .object({ sentence: SentenceSchema })
    .openapi('SentenceMutateResponse');

// PUT /v1/sentences/card/{rank} — replace a custom card's whole example set in one call (Phase 2.5:
// custom-card examples → private store rows). Each slot is 'ex' (the untiered single example) or a
// JLPT tier; text/furigana are the same client-derived-then-server-validated shape as a private
// Self-Talk sentence. The array is bounded to the 6 possible slots.
export const CardExampleSlotSchema = z
    .object({
        slot: z.enum(['ex', 'N5', 'N4', 'N3', 'N2', 'N1']),
        text: z.string().min(1).max(1000),
        furigana: z.array(FuriganaSegSchema).nullish(),
        en: z.string().max(1000).optional(),
    })
    .openapi('CardExampleSlot');

export const CardExamplesRequestSchema = z
    .object({ examples: z.array(CardExampleSlotSchema).max(6) })
    .openapi('CardExamplesRequest');

export const CardRankParamsSchema = z.object({
    rank: z
        .string()
        .min(1)
        .max(32)
        .openapi({ param: { name: 'rank', in: 'path' }, description: 'The custom card rank (owner_id).', example: '101' }),
});

export const SentenceDeleteResponseSchema = z
    .object({ ok: z.boolean() })
    .openapi('SentenceDeleteResponse');

// ---------- Sentence templates (slot-swap generators; GET /v1/templates) ----------
// A template is a sentence GENERATOR (skeleton + slots + fillers), served from sentence_template
// (not a `sentence` row). The shape below IS what the client slot-swap UI renders.

export const TemplateFillerSchema = z
    .object({
        jp: z.string().openapi({ description: 'Ruby JP substituted into the {slot} marker.', example: '<ruby>木<rt>き</rt></ruby>' }),
        en: z.string().openapi({ example: 'wood' }),
    })
    .openapi('TemplateFiller');

export const TemplateSlotSchema = z
    .object({
        id: z.string().openapi({ description: 'Matches a {id} marker in jp/en.', example: 'material' }),
        label: z.string().openapi({ example: 'material' }),
        fillers: z.array(TemplateFillerSchema),
    })
    .openapi('TemplateSlot');

export const TemplateSchema = z
    .object({
        id: z.string().openapi({ description: 'Stable skeleton ext_id (the record-compare key).', example: 'tpl-minecraft-gather' }),
        source: z.string().openapi({ example: 'selftalk' }),
        topic: z.string().nullable().openapi({ description: 'Taxonomy topic id.', example: 'minecraft' }),
        thought: z.string().optional().openapi({ description: 'Optional sentence-thought sub-cluster.', example: 'resources' }),
        grammar: z.array(z.string()).openapi({ description: 'Teaching-grammar ids.', example: ['volitional'] }),
        en: z.string().openapi({ description: 'English skeleton with {slot} markers.', example: "I'm running low on {material} — let me go {action}." }),
        jp: z.string().openapi({ description: 'JP skeleton with {slot} markers (ruby on fixed kanji).' }),
        slots: z.array(TemplateSlotSchema),
        custom: z.boolean().openapi({ description: 'true = user-authored (private); false = curator/public.' }),
    })
    .openapi('Template');

export const TemplateListResponseSchema = z
    .object({ templates: z.array(TemplateSchema) })
    .openapi('TemplateListResponse');

// GET /v1/templates[?source=] — public (anon) + the caller's own private templates through the
// db.getTemplates privacy gate. `source` optionally narrows to one surface ('selftalk' today).
export const TemplateListQuerySchema = z.object({
    source: z
        .string()
        .optional()
        .openapi({ param: { name: 'source', in: 'query' }, description: 'Optional: narrow to one surface (e.g. "selftalk").', example: 'selftalk' }),
});

// POST /v1/templates/{extId}/realize — lazily materialize ONE filler combo into a public `sentence`
// row (Slice 2). The body carries ONLY the picks: the server RECONSTRUCTS the realized
// text/furigana/English from the stored skeleton (authoritative; the client can't send wrong text)
// and reads the curated grammar off the template. Returns the assembled sentence (SentenceSchema,
// reusing SentenceMutateResponseSchema).
export const TemplateRealizeParamsSchema = z.object({
    extId: z
        .string()
        .min(1)
        .max(200)
        .openapi({ param: { name: 'extId', in: 'path' }, description: 'The template ext_id (the skeleton / record-compare id).', example: 'tpl-minecraft-gather' }),
});

export const TemplateRealizeRequestSchema = z
    .object({
        picks: z
            .record(z.string(), z.number().int().min(0))
            .openapi({
                description: 'slotId → chosen filler index. Missing/out-of-range clamps to the nearest valid index server-side; an empty object realizes the all-defaults combo.',
                example: { material: 0, action: 1 },
            }),
    })
    .openapi('TemplateRealizeRequest');
