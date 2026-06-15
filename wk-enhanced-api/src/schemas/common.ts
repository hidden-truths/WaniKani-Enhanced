// Shared base / leaf Zod schemas — the smallest building blocks referenced across
// domains: the error envelope and the sentence-store leaf types. Kept here so the
// layering stays acyclic — `common` is imported BY domain files and imports none of
// them. See the schemas.ts barrel for the full module map.

import { z } from '@hono/zod-openapi';

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
