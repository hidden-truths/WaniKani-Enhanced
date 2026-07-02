// Unified sentence-store schemas (/v1/sentences) — the assembled sentence the API serves,
// its list/create/update/delete shapes, and the custom-card example-set replace body. The
// leaf components (FuriganaSeg, SentenceLink, SentenceAnnotation) live in ./common.ts.

import { z } from '@hono/zod-openapi';
import { FuriganaSegSchema, SentenceLinkSchema, SentenceAnnotationSchema } from './common.ts';

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
// vocab example sentences) + 'grammar_point' (the N3 grammar catalog's example sentences,
// public rows seeded by seed-sentences.ts Pass 5; the GATED Minna grammar_point rows share
// the owner_type but stay dark through the same VIEWER_VISIBLE gate — public=0). The enum
// widens as later phases wire conversation owners. ownerId narrows to one owner; omitted =
// the whole owner surface. Returns one entry per link.
export const SentenceListQuerySchema = z.object({
    ownerType: z
        .enum(['selftalk', 'card', 'grammar_point'])
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
