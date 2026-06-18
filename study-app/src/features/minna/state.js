// Shared mutable view-state + consts for the みんなの日本語 package. ES imports are read-only, so the
// modules that make up the dashboard (store / activate / view / clips / speaking + the index
// orchestrator) share ONE object mutated IN PLACE (the study-app state.js pattern, cf.
// selftalk/state.js + songs/state.js + record-compare/state.js). Fields are only ever assigned as
// `S.x = …`, never `S = …` (a reassigned module-`let` can't be cross-module-mutated).
//
// Note: the PERSISTED/synced Minna store (notes / overlays / clips + lastLesson) lives in
// state.minnaStore on the global hub — `S` here is only the view-only working set (the lessons list
// + the per-lesson JSON cache), which used to be the single file's module-level `let`/`const`.

export const S = {
  lessons: [],       // available lesson numbers — feeds the chapter strip across re-renders (set by renderMinna)
  lessonCache: {},   // n → lesson JSON, mutated in place to avoid a refetch on re-render
};

export const MINNA_APP_KEY = 'minna';
export const MINNA_KEY = 'jpverbs_minna';
// `overlays` = { <built-in rank>: {tags,italki,minnaLesson,minnaKey,accent?,tts?} } — the dedup
// record: Minna words that map onto a baked-in verb live here, not as custom cards. `clips` =
// { <lesson>: { <lineIdx>: [startSec, endSec] } } — per-user conversation-line clip ranges set via
// the in-app marker. Both ride the 'minna' synced blob.
export const MINNA_DEFAULT = { notes: {}, lastLesson: 23, overlays: {}, clips: {} };
