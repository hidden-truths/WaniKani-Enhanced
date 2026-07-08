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

// Tally a finished (or partial) run. `results` = [{ pointId, correct }]. `byPoint` is the run's own
// tally; the DURABLE cross-run record is the trail below.
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

// The points you got wrong at least once IN THIS RUN — the score card's "you missed these" list,
// ordered worst-first. For the cross-run picture use weakestMcqPoints over the trail.
export function weakPoints(byPoint) {
  return Object.entries(byPoint || {})
    .filter(([, b]) => b.wrong > 0)
    .sort((a, b) => b[1].wrong - a[1].wrong || a[0].localeCompare(b[0]))
    .map(([id]) => id);
}

/* ---- the per-point score trail ------------------------------------------------------
   A run is ephemeral; the trail is the durable answer to "which patterns do I keep missing
   under time pressure". It rides the existing `jlpt` synced blob as an optional `mcq` field
   ({ <pointId>: { right, wrong, last } }, `last` = a local day key), so it needs no new blob
   and no server change.

   The counters are MONOTONIC, which is what makes the 409 reconciler trivially correct:
   field-wise MAX, never a sum. Each device's local count already includes everything it has
   pulled from the server, so summing two devices would double-count the shared history. Max
   loses at most the answers one device made while the other was also answering — the honest
   floor, and it can never inflate.

   The trail is written at PICK time (features/jlpt/view.js), not at run end: ending a drill
   early should keep the answers you actually gave. */

// Same shape the point registry validates (tools/grammar-n3/points.json) — a foreign key from a
// stale/hand-edited blob must not land in the trail and then render as a phantom lens row.
const POINT_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const counter = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Sanitize a trail off the wire/localStorage. Entries with no answers at all are DROPPED, so an
// empty trail normalizes to `{}` and the blob can omit the key entirely (the targets/mocks rule).
export function normalizeMcqTrail(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  for (const [id, rec] of Object.entries(o)) {
    if (!POINT_ID.test(id) || !rec || typeof rec !== 'object') continue;
    const right = counter(rec.right);
    const wrong = counter(rec.wrong);
    if (!right && !wrong) continue;
    const e = { right, wrong };
    if (typeof rec.last === 'string' && DAY_KEY.test(rec.last)) e.last = rec.last;
    out[id] = e;
  }
  return out;
}

// Record ONE answer. Pure: returns a new trail, leaving `trail` untouched (the caller assigns it
// back onto the store and saves). `day` is injected — core never reads the clock.
export function applyMcqResult(trail, pointId, correct, day) {
  const out = { ...(trail || {}) };
  if (!POINT_ID.test(String(pointId || ''))) return out;
  const prev = out[pointId] || { right: 0, wrong: 0 };
  const next = {
    right: prev.right + (correct ? 1 : 0),
    wrong: prev.wrong + (correct ? 0 : 1),
  };
  const last = typeof day === 'string' && DAY_KEY.test(day) ? day : prev.last;
  if (last) next.last = last;
  out[pointId] = next;
  return out;
}

// 409 reconcile: field-wise MAX per point (see the monotonic-counter note above), latest `last`.
export function mergeMcqTrail(local, server) {
  const a = normalizeMcqTrail(local);
  const b = normalizeMcqTrail(server);
  const out = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[id] || { right: 0, wrong: 0 };
    const y = b[id] || { right: 0, wrong: 0 };
    const e = { right: Math.max(x.right, y.right), wrong: Math.max(x.wrong, y.wrong) };
    const last = [x.last, y.last].filter(Boolean).sort().pop();   // day keys sort lexicographically
    if (last) e.last = last;
    out[id] = e;
  }
  return out;
}

// One point's lifetime record, or null when it has never been drilled (the lens renders no badge).
export function mcqStat(trail, pointId) {
  const e = (trail || {})[pointId];
  if (!e) return null;
  const seen = e.right + e.wrong;
  if (!seen) return null;
  return { right: e.right, wrong: e.wrong, seen, pct: Math.round((100 * e.right) / seen), last: e.last };
}

// The points you keep getting wrong, worst-first — what the 苦手 drill draws from. Restricted to
// `ids` (the points that actually HAVE a bank; a weak point with no questions can't be drilled).
//
// Weakness is an ACCURACY threshold, not `wrong > 0`. The counters are lifetime, so "has ever been
// missed" would pin a point to the weak list forever — a 9/10 point would keep crowding out one you
// genuinely can't do, and the list would only ever grow. Judging on `pct < maxPct` instead lets a
// point DRAIN off the list as you answer it right, which is the whole behaviour we want.
// `minSeen` keeps a single unlucky tap from branding a point you've barely met.
export function weakestMcqPoints(trail, ids, { n = 0, minSeen = 1, maxPct = 100 } = {}) {
  const allowed = ids && ids.length ? new Set(ids) : null;
  const out = Object.keys(trail || {})
    .filter((id) => !allowed || allowed.has(id))
    .map((id) => ({ id, s: mcqStat(trail, id) }))
    .filter(({ s }) => s && s.seen >= minSeen && s.wrong > 0 && s.pct < maxPct)
    .sort((a, b) => a.s.pct - b.s.pct || b.s.wrong - a.s.wrong || a.id.localeCompare(b.id))
    .map(({ id }) => id);
  return n > 0 ? out.slice(0, n) : out;
}
