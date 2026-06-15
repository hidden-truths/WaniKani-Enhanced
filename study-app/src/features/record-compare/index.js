// Public barrel for the record-and-compare engine. Re-exports ONLY the 13 names the two consumers
// (features/minna.js, features/selftalk.js) import — internal helpers/singletons stay private to
// their modules. As the C1+ split proceeds, each `from` points at the module that now owns the name;
// the rest still live in engine.js until their peel commit.
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
export {
  speakingBarHtml,
  paintCompareWaveforms,
  recordControlHtml,
  wireSpeakingControls,
  wireRecordCompare,
} from './engine.js';
