// Public barrel for the record-and-compare engine. Re-exports ONLY the 13 names the two consumers
// (features/minna.js, features/selftalk.js) import — internal helpers/singletons stay private to
// their owning module. The C1+ split is complete: each `from` points at the module that owns the name
// (capture / takes / waveform / view), behind ../record-compare.js (a thin `export *` re-export so
// the consumers' import path never changed). state.js + playback.js are internal-only (no public name).
export {
  RECORD_SUPPORTED,
  isSpeakingMode,
  enterSpeakingMode,
  exitSpeakingMode,
  initMicSelector,
} from './capture.js';
export {
  loadRecordings,
  newestTakeIdForItem,
  setOnTakeSaved,
} from './takes.js';
export { paintCompareWaveforms } from './waveform.js';
export {
  speakingBarHtml,
  recordControlHtml,
  wireSpeakingControls,
  wireRecordCompare,
} from './view.js';
