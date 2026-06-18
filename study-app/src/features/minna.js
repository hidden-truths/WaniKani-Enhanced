// みんなの日本語 dashboard — thin re-export so main.js + cloud.js import unchanged. The surface was
// decomposed (the last large feature module to get the treatment) into the features/minna/ package:
// state (shared mutable `S`) + store (the 'minna' SyncedBlob + clip ranges) + activate (vocab→deck
// glue over the pure core planner) + view (render + section builders + per-render wiring) + clips
// (the conversation-line clip marker) + speaking (the nav dock + visibilitychange) behind index.js.
// Mirrors features/selftalk.js + features/songs.js + features/record-compare.js. See study-app/MINNA.md.
export * from './minna/index.js';
