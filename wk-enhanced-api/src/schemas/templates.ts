// Sentence-template schemas (slot-swap generators; /v1/templates) — the skeleton + slots +
// fillers the client renders, plus the lazy realize request. Self-contained (no cross-file deps).

import { z } from '@hono/zod-openapi';

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
