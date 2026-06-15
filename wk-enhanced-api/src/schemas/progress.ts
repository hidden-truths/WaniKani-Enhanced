// Study-app per-user data schemas — the opaque progress blob get/put shapes and the
// durable study-session POST. The blob is z.any() (the client owns its evolving shape).

import { z } from '@hono/zod-openapi';

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
