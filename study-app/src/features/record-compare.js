// Thin re-export. The record-and-compare engine was split into ./record-compare/* (Workstream C1+
// of the SOLID/quality refactor): state.js (shared singletons) + capture/takes/playback/waveform/
// view modules behind the ./record-compare/index.js barrel. This file is kept at the original path
// so the two consumers (features/minna.js, features/selftalk.js) keep importing from
// './record-compare.js' byte-for-byte unchanged.
export * from './record-compare/index.js';
