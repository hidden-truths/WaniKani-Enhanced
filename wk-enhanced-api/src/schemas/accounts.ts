// Accounts / auth schemas — credentials, the public user view, and the register/login/me
// + logout response shapes (cookie-session auth for the study app).

import { z } from '@hono/zod-openapi';

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
