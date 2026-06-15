// DB-synced PREFERENCES — one object in localStorage (jpverbs_settings), synced to the
// server under app 'settings' when signed in (mirrors the progress/custom-verb sync).
// Holds the cross-cutting study defaults: example-sentence level, furigana visibility,
// default answer mode, default audio, free-review-due. Migrates the older per-key prefs
// (jpverbs_exlevel/input/audio) on first load. saveSettings() writes localStorage, applies
// side-effects (furigana), and schedules a cloud push when signed in (via the sync bus).
// (Theme + font keep their own keys — device-ish, not synced.)
import { sync } from './sync-bus.js';
import { pruneAudioPrefs } from './core/index.js';

const SETTINGS_KEY = 'jpverbs_settings';
// freeReviewDue: in FREE study, grading a card that's already DUE still advances its SRS
// schedule (a due card is fair game to count). Not-due cards are never touched in free
// study, and SRS-review sessions always reschedule due cards regardless. Default on — the
// behavior most learners expect; toggle off for pure no-stakes practice.
// recordingsKeep: how many voice takes to keep per word/line in the みんなの日本語
// record-and-compare feature. The server prunes older takes beyond this on each
// upload (clamped 1–20). Default 3.
// trimSilence: auto-trim leading/trailing (near-)silence off a new recording before
// saving, so the take is just the spoken words. Default on.
// compareSpeed: playback rate (0.5/0.75/1×) for the record-and-compare player — slow the
// native audio down (pitch preserved) to mimic it more easily. Default 1×.
// audioPrefs: per-context voice-priority lists for the audio-unify voice picker (audio-unify
// Phase 2). Keyed by context ('reviews'/'browse'/'minna'); each value is an ordered array of
// priority tokens — a specific voice id ('siri:female') or a kind ('kind:native'/'kind:tts'/
// 'kind:user'). Empty/missing context → core/audio.js DEFAULT_AUDIO_PREFS. Synced.
export const DEFAULT_SETTINGS = { exampleLevel: 'N5', furigana: true, input: 'self', audio: 'off', freeReviewDue: true, recordingsKeep: 3, trimSilence: true, compareSpeed: 1, audioPrefs: {} };

// Drop unknown audioPrefs tokens (a stale/foreign synced blob) so they can't sit in the saved list
// or the Settings editor. Mutates + returns the settings object.
function normalizeSettings(s) {
  if (s && typeof s === 'object') s.audioPrefs = pruneAudioPrefs(s.audioPrefs || {});
  return s;
}

export function loadSettings() {
  let s = null; try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch (e) {}
  if (s && typeof s === 'object') return normalizeSettings(Object.assign({}, DEFAULT_SETTINGS, s));
  return Object.assign({}, DEFAULT_SETTINGS, {          // migrate legacy per-key prefs
    exampleLevel: localStorage.getItem('jpverbs_exlevel') || DEFAULT_SETTINGS.exampleLevel,
    input: localStorage.getItem('jpverbs_input') || DEFAULT_SETTINGS.input,
    audio: localStorage.getItem('jpverbs_audio') || DEFAULT_SETTINGS.audio,
  });
}

// The live settings object. `export let` so importers read the current value; only this
// module (and cloud via setSettings) reassigns it. Property mutations (settings.input=…)
// by other modules operate on the live object and are fine.
export let settings = loadSettings();

// Wholesale replace — used by the settings SyncedBlob's apply (server-wins on login), the one
// caller that needs to swap the object identity (to drop stale keys). Importers can read a
// reassigned `export let` but never write it, so this setter is the cross-module hook.
export function setSettings(next) { settings = normalizeSettings(next); }

// Furigana visibility is a single attribute flip on <html> (CSS hides <rt> when off).
export function applyFurigana() { document.documentElement.dataset.furigana = settings.furigana ? 'on' : 'off'; }
export function saveSettingsLocal() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {} }
export function saveSettings() { saveSettingsLocal(); applyFurigana(); sync.settings(); }
