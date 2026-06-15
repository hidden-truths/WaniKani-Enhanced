// Warm-pipeline + admin schemas: the POST /v1/admin/warm request union, its per-scope
// responses, and the GET /v1/admin/jobs audit listing. WarmWordResponseSchema embeds
// VocabPayloadSchema from ./vocab.ts (one-way import).

import { z } from '@hono/zod-openapi';
import { VocabPayloadSchema } from './vocab.ts';

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
