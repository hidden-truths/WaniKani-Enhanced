// Cross-cutting primitives shared by many feature modules.
//
// Kept deliberately tiny: only the two things that genuinely span features live here.
// Per-feature storage-key constants (jpverbs_v3, jpverbs_custom, …) stay defined in the
// module that owns them, so each module is self-contained.

// The backing API origin. Empty would keep relative /v1 paths working same-origin; as its
// own container at wkenhanced.dev the app is cross-ORIGIN from the API, so VITE_API_BASE
// (baked by Vite) points at https://api.wkenhanced.dev and every fetch + the TTS/Minna
// <audio> address the API there. The httpOnly session cookie still rides because the two
// are same-SITE (Domain=.wkenhanced.dev) and api() sends credentials:'include'.
export const API_BASE = import.meta.env.VITE_API_BASE || '';

// Local-time YYYY-MM-DD. We deliberately AVOID toISOString() alone because it's UTC — an
// evening study session in a western timezone would otherwise count toward the next
// calendar day. Shifting by the tz offset fixes the bucket. Used by the export filename
// (io) and the daily-accuracy bucket (flashcard endSession).
export function localDay(d) {
  d = d || new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}
