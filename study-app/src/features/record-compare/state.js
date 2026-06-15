// Shared mutable singletons for the record-and-compare engine. ES `import`s are read-only, so a
// reassigned module-level `let` can't be split across files and mutated; this ONE object (mutated
// IN PLACE — the study app's state.js pattern, cf. src/state.js) holds the singletons that more
// than one of the split modules (capture/takes/playback/waveform/view) reads or writes. Singletons
// only ONE module touches stay `let`/`const` local to that module (capture's speakingMode/liveStream/
// active/selectedMicId; takes' recCache/onTakeSaved; waveform's decode caches) — they don't belong here.
//
// What's shared, and why it can't be module-local:
// - takeAudioEl/takePlayingBtn/takeStop + nativeAudioEl/nativeStop: the reused <audio> elements —
//   playback drives them, the cursor loop (waveform) reads their currentTime, and setCompareSpeed /
//   applyBothVolumes read them.
// - cursorControl/cursorRaf/activeNativeWindow/activeTakeWindow: the cursor rAF (waveform) owns them,
//   but the compare handlers (view) set the active play windows and stopCompare (playback) stops the loop.
// - activeNativeGain/activeTakeGain: set by playback's normalization, read by the compare handlers (view).
// - compareBias/bothPlaying: set by setCompareBias (playback) + the bias slider (view), read across both.
export const S = {
  takeAudioEl: null, takePlayingBtn: null, takeStop: null,
  nativeAudioEl: null, nativeStop: null,
  cursorControl: null, cursorRaf: 0, activeNativeWindow: null, activeTakeWindow: null,
  activeNativeGain: 1, activeTakeGain: 1,
  compareBias: 0, bothPlaying: false,
};

// The ONE Web Audio context for the engine, lazily created. Shared by capture's maybeTrim (decode →
// trim) and waveform's fetchAudioBuffer (decode → draw), which land in different split modules.
let _audioCtx = null;
export function audioCtx() {
  if (!_audioCtx) { const C = window.AudioContext || window.webkitAudioContext; _audioCtx = new C(); }
  return _audioCtx;
}
