// Leveled-example selection — pure. Which JLPT tiers a card actually has a sentence for,
// and the [jp,en] pair for a requested tier with graceful fallback (exact → nearest →
// single `ex` → null). The data attach (v.levels = EXAMPLES[rank]) lives in state.js.

export const JLPT_TIERS = ['N5', 'N4', 'N3', 'N2', 'N1'];   // easy → hard

export function availableTiers(v) { return v.levels ? JLPT_TIERS.filter(t => v.levels[t]) : []; }

export function exampleForLevel(v, level) {
  const L = v.levels;
  if (L) {
    if (L[level]) return L[level];
    const i = JLPT_TIERS.indexOf(level);
    for (let d = 1; d < JLPT_TIERS.length; d++) {
      const lo = i - d >= 0 ? JLPT_TIERS[i - d] : null, hi = i + d < JLPT_TIERS.length ? JLPT_TIERS[i + d] : null;
      if (lo && L[lo]) return L[lo];
      if (hi && L[hi]) return L[hi];
    }
  }
  if (v.ex && v.ex.length) return v.ex[0];
  return null;
}
