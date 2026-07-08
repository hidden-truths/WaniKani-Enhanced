// GRAMMAR MCQ — pure logic for the wave-2 文法形式判断 drill (fill-the-blank, four choices).
//
// The exam's grammar paper does not ask you to recall a pattern; it shows a sentence with a hole and
// four patterns you almost know, under time pressure. That's a different skill from the cloze card
// (which asks you to PRODUCE the pattern), so it gets its own bank and its own drill — but it keys on
// the SAME durable point ids, so a point's cloze card and its MCQ questions always refer to one thing.
//
// Bank shape (generated, tools/grammar-n3/build-mcq.mjs):
//   { <pointId>: [{ stem, choices[4], answer, why }] }
//
// DOM-free; the drill's render lives in features/jlpt/view.js. `rand` is always injected so quiz
// assembly is deterministic under test (core/* never calls Math.random).

// The blank in a stem. Kept in sync with GAP in tools/grammar-n3/build-mcq.mjs — the builder
// validates that every stem has exactly one, and splitStem below assumes it.
export const MCQ_GAP = '＿＿＿';
export const MCQ_CHOICES = 4;

// Split a stem into [before, after] around its gap. A stem with no gap (shouldn't reach here — the
// builder errors on it) degrades to "everything before, nothing after" rather than throwing.
export function splitStem(stem) {
  const i = String(stem || '').indexOf(MCQ_GAP);
  return i < 0 ? [String(stem || ''), ''] : [stem.slice(0, i), stem.slice(i + MCQ_GAP.length)];
}

// The stem with the gap filled by `text` — the reveal face's completed sentence.
export function fillGap(stem, text) {
  const [a, b] = splitStem(stem);
  return a + text + b;
}

export const mcqPointIds = (bank) => Object.keys(bank || {});
export const mcqQuestionCount = (bank) =>
  Object.values(bank || {}).reduce((n, qs) => n + (qs ? qs.length : 0), 0);

// Which of a point's questions exist, as flat {pointId, index} refs.
function allRefs(bank, ids) {
  const out = [];
  for (const id of ids || mcqPointIds(bank)) {
    const qs = (bank || {})[id];
    if (!Array.isArray(qs)) continue;
    for (let i = 0; i < qs.length; i++) out.push({ pointId: id, index: i });
  }
  return out;
}

// Fisher–Yates over a COPY, with the RNG injected (0 ≤ rand() < 1). Pure: same rand, same order.
export function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// A seeded RNG so a quiz can be replayed exactly (tests; a future "retry this quiz"). mulberry32.
export function seededRand(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Assemble a quiz: pick up to `n` questions across the allowed points, then SHUFFLE EACH QUESTION'S
// CHOICES. The shuffle matters — the bank stores the answer at a fixed index (0 in the seed content),
// and a drill that always puts the answer first teaches position, not grammar.
//
// Returns [{ pointId, index, stem, choices[], answer, why }] where `answer` indexes the SHUFFLED
// choices. `ids` empty/absent = every point with a bank.
export function buildMcqQuiz(bank, { ids, n = 10, rand = Math.random } = {}) {
  const refs = allRefs(bank, ids && ids.length ? ids : null);
  if (!refs.length) return [];
  return shuffle(refs, rand)
    .slice(0, Math.max(1, n))
    .map(({ pointId, index }) => {
      const q = bank[pointId][index];
      const correct = q.choices[q.answer];
      const choices = shuffle(q.choices, rand);
      return { pointId, index, stem: q.stem, choices, answer: choices.indexOf(correct), why: q.why };
    });
}

// Tally a finished (or partial) run. `results` = [{ pointId, correct }]. `byPoint` is what a future
// per-point lens reads: which patterns you actually miss under time pressure.
export function scoreMcq(results) {
  const list = results || [];
  const byPoint = {};
  let right = 0;
  for (const r of list) {
    if (!r || !r.pointId) continue;
    const b = byPoint[r.pointId] || (byPoint[r.pointId] = { right: 0, wrong: 0 });
    if (r.correct) { b.right++; right++; } else b.wrong++;
  }
  const total = list.length;
  return { right, total, pct: total ? Math.round((100 * right) / total) : 0, byPoint };
}

// The points you got wrong at least once — the drill's "study these next" list, ordered worst-first.
export function weakPoints(byPoint) {
  return Object.entries(byPoint || {})
    .filter(([, b]) => b.wrong > 0)
    .sort((a, b) => b[1].wrong - a[1].wrong || a[0].localeCompare(b[0]))
    .map(([id]) => id);
}
