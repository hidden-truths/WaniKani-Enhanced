// Pure helpers for the みんなの日本語 record-and-compare feature (Phase 2). DOM-free
// so the test imports them directly. The DOM/MediaRecorder glue lives in
// features/minna-record.js.

export const KEEP_MIN = 1;
export const KEEP_MAX = 20;
export const KEEP_DEFAULT = 3;

// Clamp a user-supplied "recordings to keep per word" value into [1, 20], falling
// back to the default for anything non-numeric. Mirrors the server's clamp so the
// client never sends a value the server would silently change.
export function clampKeep(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return KEEP_DEFAULT;
  return Math.min(KEEP_MAX, Math.max(KEEP_MIN, v));
}

// The stable item key for a conversation LINE. Vocab words already carry their own
// stable `key` ('mnn:23:0') from the lesson JSON; conversation lines have none, so
// we synthesize one from the lesson + line index ('mnn:23:conv:2'). Stable as long
// as the curated line order doesn't change.
export function convItemKey(lesson, lineIdx) {
  return 'mnn:' + lesson + ':conv:' + lineIdx;
}

// Format a recording length (ms) as M:SS for the take list. null/invalid → ''.
export function formatDuration(ms) {
  if (ms == null || ms === '') return '';   // Number(null) is 0, so guard first
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '';
  const totalSec = Math.round(n / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

// A valid clip is [startSec, endSec] with finite, non-negative numbers and
// start < end. Returns the normalized pair or null. Used to slice the cached
// whole-conversation MP3 to a single line for the native compare.
export function validClip(clip) {
  if (!Array.isArray(clip) || clip.length !== 2) return null;
  const a = Number(clip[0]), b = Number(clip[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a < 0 || b <= a) return null;
  return [a, b];
}

// Resolve a conversation line's clip from its two sources — the per-user synced
// store (set via the in-app marker) wins over the curated lesson-JSON `line.clip`.
// Returns a valid [start,end] or null (→ native compare disabled for that line).
export function resolveClip(lineClip, storeClip) {
  return validClip(storeClip) || validClip(lineClip);
}

// "0:03–0:07" label for a clip; '' when there's no valid clip.
export function clipLabel(clip) {
  const v = validClip(clip);
  return v ? formatDuration(v[0] * 1000) + '–' + formatDuration(v[1] * 1000) : '';
}

// Find the [start, end) sample window of actual sound in a mono PCM buffer, so we can trim
// leading/trailing (near-)silence off a recording. Windowed RMS: scan in ~windowMs chunks,
// keep the first and last window whose RMS clears the threshold, then pad generously on each
// side. Two reasons it's forgiving by design — clipping real speech is far worse than
// leaving a little dead air:
//   1. ADAPTIVE threshold = max(floor, peakRMS * ratio). A fixed absolute threshold trims
//      quiet recordings to nothing and, worse, eats low-energy consonants. Scaling to the
//      clip's own peak tracks the speaker's level.
//   2. ASYMMETRIC, generous padding (leadPad > tailPad). Voiceless/aspirated onsets — ひ
//      [çi], ふ [ɸɯ], the breathy start of 引きます — are broadband noise BELOW the vowel's
//      RMS, so the window scan starts at the vowel and would clip the consonant. A wide lead
//      pad (~160 ms) restores that onset even though detection started later.
// Returns null when the whole buffer is below threshold (all silence) — the caller keeps the
// original untouched. Pure + DOM-free (operates on a Float32Array), so it's unit-tested.
export function findTrimBounds(samples, sampleRate, opts = {}) {
  const floor = opts.floor ?? 0.004;          // absolute RMS floor (~ -48 dBFS)
  const ratio = opts.ratio ?? 0.04;           // …or this fraction of the clip's peak, whichever is higher
  const windowMs = opts.windowMs ?? 10;
  // `padMs` is a symmetric fallback; leadPadMs/tailPadMs override per side.
  const leadPadMs = opts.leadPadMs ?? opts.padMs ?? 160;
  const tailPadMs = opts.tailPadMs ?? opts.padMs ?? 140;
  const n = samples.length;
  if (!n || !sampleRate) return null;
  const win = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  const rmsAt = (from) => {
    const to = Math.min(n, from + win);
    let s = 0;
    for (let i = from; i < to; i++) s += samples[i] * samples[i];
    return Math.sqrt(s / (to - from));
  };
  const wins = [];
  let peak = 0;
  for (let from = 0; from < n; from += win) { const r = rmsAt(from); wins.push(r); if (r > peak) peak = r; }
  if (peak <= 0) return null;
  // An explicit `threshold` (used by tests) overrides the adaptive one.
  const threshold = opts.threshold ?? Math.max(floor, peak * ratio);
  let first = -1, last = -1;
  for (let w = 0; w < wins.length; w++) {
    if (wins[w] >= threshold) { if (first < 0) first = w; last = w; }
  }
  if (first < 0) return null;   // all below threshold
  const start = Math.max(0, first * win - Math.round((leadPadMs / 1000) * sampleRate));
  const end = Math.min(n, last * win + win + Math.round((tailPadMs / 1000) * sampleRate));
  return { start, end };
}
