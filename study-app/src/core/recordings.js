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
