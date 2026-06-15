// Vocab + warm-payload schemas — the userscript-facing surface: the example/payload
// shapes, index_meta, health, the GET /v1/vocab params/query, and the batch fetch.
// VocabPayloadSchema is the one schema shared beyond this file (warm.ts embeds it;
// one-way import, no cycle).

import { z } from '@hono/zod-openapi';

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
