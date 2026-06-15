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
        baseUpdatedAt: z.number().int().optional().openapi({
            description:
                'Optimistic-concurrency guard: the updatedAt the client last saw for this blob. ' +
                'If the stored row has moved past it, the write is rejected with 409 and the current ' +
                '{ data, updatedAt } so the client can reconcile. OMIT for last-write-wins (the legacy ' +
                'path — no client is forced to upgrade).',
        }),
    })
    .openapi('ProgressPutRequest');

export const ProgressPutResponseSchema = z
    .object({
        ok: z.boolean(),
        updatedAt: z.number().int(),
    })
    .openapi('ProgressPutResponse');

// 409 body when a baseUpdatedAt no longer matches the stored row. Carries the server's current
// copy so the client can reconcile in one round-trip (no follow-up GET).
export const ProgressConflictResponseSchema = z
    .object({
        code: z.literal('conflict'),
        error: z.string(),
        data: z.any().nullable().openapi({ description: "The server's current blob (newer than the client's base)." }),
        updatedAt: z.number().int().openapi({ description: "The server's current updatedAt." }),
    })
    .openapi('ProgressConflictResponse');

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
