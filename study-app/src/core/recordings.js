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
// find the first and last window of a SUSTAINED run above threshold, then pad generously on
// each side. Four reasons it's forgiving by design — clipping real speech is far worse than
// leaving a little dead air:
//   1. ADAPTIVE threshold = max(floor, peakRMS * ratio). A fixed absolute threshold trims
//      quiet recordings to nothing and, worse, eats low-energy consonants. Scaling to the
//      clip's own peak tracks the speaker's level.
//   2. ROBUST peak = a high percentile (peakPct) of the window RMS, NOT the raw max. A single
//      impossibly-loud window — a trackpad/keyboard click picked up by a laptop mic — would
//      otherwise inflate the adaptive threshold and clip quiet speech (and the breathy onsets
//      in #4). The percentile ignores such isolated impulses so the threshold tracks speech.
//   3. SUSTAIN gate (minRunMs). An edge only counts as speech if energy stays above threshold
//      for a run of ≥ minRunMs. A mechanical click is a 1–5 ms impulse, so it can't ANCHOR the
//      start/end — without this the click sits at sample 0 / the last sample and nothing gets
//      trimmed (the bug a laptop trackpad-click recording exposed). Real syllables (≥~100 ms)
//      clear the gate easily.
//   4. ASYMMETRIC, generous padding (leadPad > tailPad). Voiceless/aspirated onsets — ひ
//      [çi], ふ [ɸɯ], the breathy start of 引きます — are broadband noise BELOW the vowel's
//      RMS, so the sustained run starts at the vowel and would clip the consonant. A wide lead
//      pad (~160 ms) restores that onset even though detection started later.
// Returns null when no sustained run clears threshold (all silence / only transients) — the
// caller keeps the original untouched. Pure + DOM-free (operates on a Float32Array), so it's
// unit-tested.
export function findTrimBounds(samples, sampleRate, opts = {}) {
  const floor = opts.floor ?? 0.004;          // absolute RMS floor (~ -48 dBFS)
  const ratio = opts.ratio ?? 0.04;           // …or this fraction of the clip's peak, whichever is higher
  const windowMs = opts.windowMs ?? 10;
  // `padMs` is a symmetric fallback; leadPadMs/tailPadMs override per side.
  const leadPadMs = opts.leadPadMs ?? opts.padMs ?? 160;
  const tailPadMs = opts.tailPadMs ?? opts.padMs ?? 140;
  const minRunMs = opts.minRunMs ?? 30;       // a run must last this long to anchor an edge (kills click impulses); 0 disables
  const peakPct = opts.peakPct ?? 0.95;       // adaptive-threshold peak = this percentile of window RMS, not the raw max
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
  for (let from = 0; from < n; from += win) wins.push(rmsAt(from));
  // An explicit `threshold` (used by tests) overrides the adaptive one and skips the peak calc.
  let threshold = opts.threshold;
  if (threshold == null) {
    const sorted = [...wins].sort((a, b) => a - b);
    const peak = sorted[Math.min(sorted.length - 1, Math.round(peakPct * (sorted.length - 1)))];
    if (!(peak > 0)) return null;             // (near-)silent once isolated impulses are discounted
    threshold = Math.max(floor, peak * ratio);
  }
  // First / last window of a SUSTAINED run (≥ minRun windows) above threshold. A lone window
  // above threshold (a click) never updates first/last, so it can't anchor the trim.
  const minRun = Math.max(1, Math.round(minRunMs / windowMs));
  let first = -1, last = -1, runStart = -1, runLen = 0;
  for (let w = 0; w < wins.length; w++) {
    if (wins[w] >= threshold) {
      if (runStart < 0) { runStart = w; runLen = 1; } else runLen++;
      if (runLen >= minRun) { if (first < 0) first = runStart; last = w; }
    } else { runStart = -1; runLen = 0; }
  }
  if (first < 0) return null;   // no sustained run above threshold
  const start = Math.max(0, first * win - Math.round((leadPadMs / 1000) * sampleRate));
  const end = Math.min(n, last * win + win + Math.round((tailPadMs / 1000) * sampleRate));
  return { start, end };
}

// Downsample a mono PCM buffer to `bins` peak amplitudes in [0, 1] for the record-and-compare
// waveform (drawn to a canvas in features/minna-record.js). Each bin is the MAX ABSOLUTE
// sample over its slice, then the whole set is NORMALIZED to the clip's own peak — so a quiet
// take still draws a full-height shape. That's deliberate: the waveform is for comparing
// SHAPE / TIMING between your take and the native audio, not absolute loudness (the two are
// recorded at different levels anyway). Pure + DOM-free, so it's unit-tested. Empty input or
// bins < 1 → an empty array; a flat/silent buffer → all-zero bins (peak 0, left un-normalized).
export function waveformPeaks(samples, bins) {
  const b = Math.floor(bins);
  if (!samples || !samples.length || !(b >= 1)) return new Float32Array(0);
  const n = samples.length;
  const out = new Float32Array(b);
  let peak = 0;
  for (let i = 0; i < b; i++) {
    const from = Math.floor((i * n) / b);
    const to = Math.max(from + 1, Math.floor(((i + 1) * n) / b));   // ≥1 sample even when bins > samples
    let mx = 0;
    for (let j = from; j < to && j < n; j++) { const a = Math.abs(samples[j]); if (a > mx) mx = a; }
    out[i] = mx;
    if (mx > peak) peak = mx;
  }
  if (peak > 0) for (let i = 0; i < b; i++) out[i] /= peak;
  return out;
}

// Allowed compare-player playback speeds, slow→normal. Slowing the native audio down (pitch
// preserved, set in minna-record.js) makes it easier to mimic; 1× is normal.
export const COMPARE_SPEEDS = [0.5, 0.75, 1];
// Snap a stored/user speed to the nearest allowed step, defaulting to 1× for anything invalid.
// Keeps the client from sending the <audio> element a nonsense playbackRate.
export function clampSpeed(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 1;
  let best = 1, bestD = Infinity;
  for (const s of COMPARE_SPEEDS) { const d = Math.abs(s - v); if (d < bestD) { bestD = d; best = s; } }
  return best;
}
