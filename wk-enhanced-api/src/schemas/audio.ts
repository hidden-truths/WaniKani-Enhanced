// Unified audio schemas (/v1/audio) — the synth-voice variant catalog query/response
// and the tagged-TTS serve query.

import { z } from '@hono/zod-openapi';

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
