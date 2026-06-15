// Schema barrel — the stable import surface for the Zod schemas.
//
// The 66 schemas (request validation + OpenAPI generation, via @hono/zod-openapi) used to
// live in one 733-line module; they're now split into cohesive per-domain files under
// schemas/*. This re-exports them all so callers keep `import { XSchema } from
// '../schemas.ts'` working unchanged. Add a schema to the relevant domain file (or a new
// domain file + a line below) — never here.
//
// Layering (one-way; no cycles): common ← sentences; vocab ← warm.

export * from './schemas/common.ts';

// Userscript surface (vocab lookups + warm pipeline).
export * from './schemas/vocab.ts';
export * from './schemas/warm.ts';

// Accounts + per-user study data (study-app surface).
export * from './schemas/accounts.ts';
export * from './schemas/progress.ts';

// みんなの日本語 + unified audio.
export * from './schemas/minna.ts';
export * from './schemas/audio.ts';

// Unified sentence store (Self-Talk + vocab examples + templates).
export * from './schemas/sentences.ts';
export * from './schemas/templates.ts';

// Songs (歌 / Songs tab) — song metadata + lyric lines.
export * from './schemas/songs.ts';
