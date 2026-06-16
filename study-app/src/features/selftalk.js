// Thin re-export. The 独り言 Self-Talk tab was a single ~630-line file; it's now decomposed into the
// features/selftalk/ package (the record-compare/songs playbook: a shared state.js + cohesive
// per-concern modules — store/view/practice/authoring/speaking — behind index.js). This file is kept
// at the original path so the consumers (main.js, cloud.js) keep importing from './selftalk.js'
// byte-for-byte unchanged. See REFACTOR_FOLLOWUPS.md "Workstream T3".
export * from './selftalk/index.js';
