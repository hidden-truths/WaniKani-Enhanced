// DB barrel — the stable import surface for the repository layer.
//
// The connection (db handle + test seam) lives in connection.ts; each aggregate is
// its own cohesive module under db/repos/*. This file re-exports them all so callers
// keep `import * as db from '../db/client.ts'` (and the named/`import type` variants)
// working unchanged. NO SQL lives here anymore — add a query to the relevant repo, or
// a new repo module + a line below.
//
// Layering (one-way; no cycles): connection ← every repo; sentenceCore ← {sentences,
// annotations, templates}; annotations ← templates.

export * from './connection.ts';

// Vocab / warm pipeline (the userscript surface).
export * from './repos/vocab.ts';
export * from './repos/indexMeta.ts';
export * from './repos/warmJobs.ts';

// Accounts + per-user study data (the study-app surface).
export * from './repos/accounts.ts';
export * from './repos/progress.ts';
export * from './repos/studySessions.ts';
export * from './repos/recordings.ts';
export * from './repos/audioVariants.ts';

// Unified sentence store (Self-Talk + vocab examples + templates + NLP).
export * from './repos/sentenceCore.ts';
export * from './repos/sentences.ts';
export * from './repos/annotations.ts';
export * from './repos/templates.ts';
