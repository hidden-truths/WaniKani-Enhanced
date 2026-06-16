// Thin re-export. The 歌/Songs tab was a single ~790-line file; it's being decomposed into the
// features/songs/ package (the record-compare playbook: a shared state.js + cohesive per-mode modules
// behind index.js). This file is kept at the original path so the two consumers (main.js, cloud.js)
// keep importing from './songs.js' byte-for-byte unchanged. See REFACTOR_FOLLOWUPS.md "Workstream S".
export * from './songs/index.js';
