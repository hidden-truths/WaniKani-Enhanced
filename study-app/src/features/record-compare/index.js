// Public barrel for the record-and-compare engine. Re-exports ONLY the 13 names the two consumers
// (features/minna.js, features/selftalk.js) import — internal helpers/singletons stay private to
// their modules. During the C1+ split these all still live in engine.js; each peel commit moves a
// group into its own module (capture/takes/playback/waveform/view) and repoints the `from` here.
export {
  RECORD_SUPPORTED,
  isSpeakingMode,
  enterSpeakingMode,
  exitSpeakingMode,
  speakingBarHtml,
  initMicSelector,
  loadRecordings,
  newestTakeIdForItem,
  paintCompareWaveforms,
  recordControlHtml,
  setOnTakeSaved,
  wireSpeakingControls,
  wireRecordCompare,
} from './engine.js';
