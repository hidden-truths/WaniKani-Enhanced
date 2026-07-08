// JLPT lens — PURE, DOM-free derivations over the bundled JLPT word list
// (data/jlpt.js, ~7.6k words N5–N1) + the app's own study signals. Everything takes
// plain data in (the map, `nowMs`/`dayKey` injected — never Date.now()) so the whole
// module is unit-testable (test/jlpt-core.test.js). The lazy-loading singleton around
// the word data lives in features/jlpt/data.js; this module never imports the data.
//
// The one core→core import: the `jlpt` blob carries the MCQ drill's per-point score trail, whose
// shape + reconcile rules belong to the drill's own module (core/grammar-mcq.js), not here.
import { normalizeMcqTrail, mergeMcqTrail } from './grammar-mcq.js';

export const JLPT_LEVEL_ORDER = ['N5', 'N4', 'N3', 'N2', 'N1'];   // easy → hard

/* ---- word list ------------------------------------------------------------- */

// Parse the compact generated shape ({ N5:'a,b,…', … }) into one Map word → level.
// A word listed at two levels keeps the EASIER one (first write wins in easy→hard order).
export function buildJlptMap(words) {
  const map = new Map();
  for (const lvl of JLPT_LEVEL_ORDER) {
    const s = (words && words[lvl]) || '';
    if (!s) continue;
    for (const w of s.split(',')) if (w && !map.has(w)) map.set(w, lvl);
  }
  return map;
}

// Level of a card/subject: exact headword match first (the list carries kanji forms),
// then the kana reading (covers kana-only listings like ありがとう). '' = not listed.
export function jlptLookup(map, jp, read) {
  if (!map) return '';
  if (jp && map.has(jp)) return map.get(jp);
  if (read && map.has(read)) return map.get(read);
  return '';
}

// How many words the list has at a level (the coverage denominators).
export function jlptLevelTotal(map, level) {
  let n = 0;
  for (const lvl of map.values()) if (lvl === level) n++;
  return n;
}

/* ---- exam countdown --------------------------------------------------------- */

// Days/weeks until an exam date ('YYYY-MM-DD', local midnight). days is calendar days
// (today's exam → 0); past exams report { past: true }.
export function examCountdown(examDate, nowMs) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(examDate || '');
  if (!m) return null;
  const exam = new Date(+m[1], +m[2] - 1, +m[3]);
  const today = new Date(nowMs); today.setHours(0, 0, 0, 0);
  const days = Math.round((exam - today) / 864e5);
  return { days, weeks: Math.floor(days / 7), restDays: days - Math.floor(days / 7) * 7, past: days < 0 };
}

/* ---- vocabulary coverage ------------------------------------------------------ */

// Deck coverage of one JLPT level: of the list's words at `level`, how many are in the
// study deck (matched by headword or reading), and how many of those are SOLID
// (Leitner box ≥ 4). Returns { total, inDeck, solid }.
export function deckJlptCoverage(map, level, data, cards) {
  const total = jlptLevelTotal(map, level);
  let inDeck = 0, solid = 0;
  const seen = new Set();
  for (const v of data || []) {
    const lvl = jlptLookup(map, v.jp, v.read);
    if (lvl !== level) continue;
    const key = map.has(v.jp) ? v.jp : v.read;   // count each LIST word once, not each card
    if (seen.has(key)) continue;
    seen.add(key);
    inDeck++;
    const c = (cards || {})[v.rank];
    if (c && (c.box || 0) >= 4) solid++;
  }
  return { total, inDeck, solid };
}

// WaniKani coverage of one JLPT level: of the list's words at `level`, how many exist as
// WK vocabulary the user has STARTED (lesson taken), and how many are at Guru or beyond
// (stage ≥ 5 — WK's own "you know this"). Subjects/assignments are the wanikani-tab Maps.
export function wkJlptCoverage(map, level, subjects, assignmentsBySubject) {
  const total = jlptLevelTotal(map, level);
  const byChars = new Map();
  for (const s of subjects ? subjects.values() : []) {
    if (s.type === 'vocabulary' && !s.hidden && s.chars && !byChars.has(s.chars)) byChars.set(s.chars, s.id);
  }
  let onWk = 0, started = 0, guru = 0;
  for (const [word, lvl] of map) {
    if (lvl !== level) continue;
    const id = byChars.get(word);
    if (id == null) continue;
    onWk++;
    const a = assignmentsBySubject && assignmentsBySubject.get(id);
    if (a && a.startedAt && !a.hidden) {
      started++;
      if (a.stage >= 5) guru++;
    }
  }
  return { total, onWk, started, guru };
}

/* ---- pacing coach + gap-fill --------------------------------------------------- */

// Default daily/weekly quotas — the ~1 hour/day study budget. NEVER materialized into the
// synced blob (shouldSeed stays honest); jlptTargets applies them at read time.
export const DEFAULT_TARGETS = { wordsPerDay: 12, grammarPerWeek: 5 };
// The final stretch is review-only: a word added days before the exam can't reach a solid box,
// so the pace math plans against daysLeft minus this buffer.
export const PACE_BUFFER_DAYS = 14;
export const jlptTargets = (store) => ({ ...DEFAULT_TARGETS, ...((store && store.targets) || {}) });

// Every headword AND reading in the deck — the gap-fill's "already have it" set. Same
// matching semantics as deckJlptCoverage (a list word matches a card's jp or read).
export function deckWordSet(data) {
  const s = new Set();
  for (const v of data || []) {
    if (v && v.jp) s.add(v.jp);
    if (v && v.read) s.add(v.read);
  }
  return s;
}

// chars → { stage, started, wkLevel } for visible WK vocabulary (the wanikani-tab Maps) —
// wkJlptCoverage's internals, extracted so the gap/batch math can reuse one index.
export function wkVocabIndex(subjects, assignmentsBySubject) {
  const idx = new Map();
  for (const s of subjects ? subjects.values() : []) {
    if (s.type !== 'vocabulary' || s.hidden || !s.chars || idx.has(s.chars)) continue;
    const a = assignmentsBySubject && assignmentsBySubject.get(s.id);
    const started = !!(a && a.startedAt && !a.hidden);
    idx.set(s.chars, { stage: started ? (a.stage || 0) : 0, started, wkLevel: s.level || 0 });
  }
  return idx;
}

// The level's coverage gap. covered = inDeck OR Guru+ on WK (the readiness lens's union
// semantics); `both` powers the honest-overlap copy; `uncovered` keeps map iteration order.
export function jlptGap(map, level, deckWords, wkIndex) {
  let total = 0, inDeck = 0, guru = 0, both = 0;
  const uncovered = [];
  for (const [word, lvl] of map || []) {
    if (lvl !== level) continue;
    total++;
    const d = !!(deckWords && deckWords.has(word));
    const g = !!(wkIndex && (wkIndex.get(word) || {}).started && wkIndex.get(word).stage >= 5);
    if (d) inDeck++;
    if (g) guru++;
    if (d && g) both++;
    if (!d && !g) uncovered.push(word);
  }
  return { total, covered: inDeck + guru - both, inDeck, guru, both, uncovered };
}

// Today's gap-fill batch: the first `n` uncovered words in tier order, frequency-ordered within
// each tier (entries — the generated data/jlpt-words rows — are already frequency-ordered):
//   ① not on WK at all (WK will never teach these — highest value)
//   ② on WK but locked above the user's current level (won't arrive by exam)
//   ③ on WK, unlocked, lesson not yet taken
//   ④ started but below Guru — WK's SRS is already actively teaching them, add LAST
export function selectGapBatch(entries, uncovered, wkIndex, userWkLevel, n) {
  const want = uncovered instanceof Set ? uncovered : new Set(uncovered || []);
  const tiers = [[], [], [], []];
  for (const e of entries || []) {
    if (!want.has(e[0])) continue;
    const w = wkIndex && wkIndex.get(e[0]);
    const tier = !w ? 0 : !w.started ? ((w.wkLevel || 0) > (userWkLevel || 0) ? 1 : 2) : 3;
    tiers[tier].push(e);
  }
  return tiers.flat().slice(0, Math.max(0, n || 0));
}

// The tagged minimal card for one generated entry [jp, read, mean, cat, type, trans]. Pure: the
// caller assigns the monotonic `rank`. `jlptfill` is the source-facet flag ('jlpt' is taken by
// the LEVEL facet); `added` (the local day key) is the quota checklist row's live signal — the
// WK / song / Minna builders stamp it too, so weeklyAddPace sees every deck add.
export function buildJlptCard(entry, rank, level, todayKey) {
  const [jp, read, mean, cat, type, trans] = entry;
  return {
    rank,
    jp,
    read: read || jp,
    mean: mean || '',
    cat: cat || 'noun', type: type || '', trans: trans || '',
    jlpt: level,
    tags: ['JLPT', 'jlpt-' + String(level).toLowerCase()],
    jlptfill: true,
    added: todayKey,
    mnem: '', tip: `JLPT ${level} word list`, ex: [], accent: null, levels: null, custom: true,
  };
}

// Deck-add pace over the trailing `n` days, from the `added` day-stamps the card builders write.
// EVERY vocab builder stamps it now (gap-fill, 鰐蟹 WK, 歌 songs, みんなの日本語) — so this is all deck
// adds, not just gap-fill.
//
// Which LEVEL an add counts toward is resolved by the injected `levelOf` FIRST, falling back to the
// card's own `jlpt` field. That ordering is load-bearing: `v.jlpt` is per-source and sometimes a
// guess (Minna cards default to 'N4' from the lesson JSON; song cards take the analyzer's label),
// whereas `levelOf` is the authoritative generated word list — the SAME source the coverage/gap lens
// counts with. Without it the pace could refuse to credit an add that demonstrably closed the gap.
// `levelOf` fails soft to '' (map not loaded yet), hence the `|| v.jlpt` fallback.
//
// Grammar cards are excluded: they carry `jlpt:'N3'` but are not vocabulary, and the pacing strip
// paces them separately (grammarPerWeek). They don't stamp `added` today; the guard keeps a future
// stamp from silently inflating the words/day quota.
export function weeklyAddPace(data, todayKey, level, { n = 7, levelOf = null } = {}) {
  const cutoff = shiftDay(todayKey, -(n - 1));
  let today = 0, week = 0;
  for (const v of data || []) {
    if (!v || !v.added || v.grammar) continue;
    const lvl = (levelOf && levelOf(v)) || v.jlpt;
    if (lvl !== level) continue;
    if (v.added === todayKey) today++;
    if (v.added >= cutoff && v.added <= todayKey) week++;
  }
  return { today, week, avgPerDay: week / n };
}

// The pacing verdict: what closing the gap by the exam requires vs the user's targets.
// `grammar` is the injectable {studied, total} from grammarCoverage (null → no grammar line).
// Null-safe: no/past exam date → null (the view falls back to the set-your-date copy).
export function pacePlan({ daysLeft, gap, targets, grammar = null, bufferDays = PACE_BUFFER_DAYS }) {
  if (daysLeft == null || daysLeft < 0) return null;
  const t = { ...DEFAULT_TARGETS, ...(targets || {}) };
  const effDays = Math.max(1, daysLeft - bufferDays);
  const uncovered = gap ? Math.max(0, gap.total - gap.covered) : 0;
  const neededPerDay = Math.ceil(uncovered / effDays);
  const daysToFinish = t.wordsPerDay > 0 ? Math.ceil(uncovered / t.wordsPerDay) : Infinity;
  const slackDays = effDays - daysToFinish;
  const verdict = uncovered === 0 ? 'done' : slackDays >= 7 ? 'ahead' : slackDays >= 0 ? 'on-track' : 'behind';
  const out = {
    effDays, uncovered, neededPerDay,
    targetPerDay: t.wordsPerDay,
    slackDays, slackWeeks: Math.round(slackDays / 7),
    verdict,
  };
  if (grammar && grammar.total) {
    const remaining = Math.max(0, grammar.total - (grammar.studied || 0));
    const weeksLeft = Math.max(1, effDays / 7);
    const weeksToFinish = t.grammarPerWeek > 0 ? remaining / t.grammarPerWeek : Infinity;
    const gSlack = Math.floor(weeksLeft - weeksToFinish);
    out.grammar = {
      remaining,
      neededPerWeek: Math.ceil(remaining / weeksLeft),
      targetPerWeek: t.grammarPerWeek,
      slackWeeks: gSlack,
      verdict: remaining === 0 ? 'done' : gSlack >= 1 ? 'ahead' : gSlack >= 0 ? 'on-track' : 'behind',
    };
  }
  return out;
}

/* ---- daily checklist record ----------------------------------------------------- */

// The synced blob's `days` map: { 'YYYY-MM-DD': { <taskId>: 1 } }. These helpers are the
// pure record ops; the task DEFINITIONS (labels, auto-signals, deep-links) live in the
// feature layer (features/jlpt/view.js) since they read live app state.

export const JLPT_DAYS_KEEP = 60;   // rolling window — enough for the heatmap + streak math

// Normalize an arbitrary parsed blob into the store shape. Pure; tolerates junk.
// `level` must be a known JLPT level; `examDate` a YYYY-MM-DD string; days values fold
// to {taskId:1}. Old days beyond JLPT_DAYS_KEEP (relative to `todayKey`) are pruned.
export function normalizeJlpt(o, todayKey, defaults = {}) {
  const base = {
    level: defaults.level || 'N3',
    examDate: defaults.examDate || '',
    days: {},
  };
  if (!o || typeof o !== 'object') return base;
  if (JLPT_LEVEL_ORDER.includes(o.level)) base.level = o.level;
  if (typeof o.examDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.examDate)) base.examDate = o.examDate;
  // Optional pacing targets: clamp to sane ints, drop junk, and OMIT the key entirely when
  // empty so a pre-targets blob round-trips byte-identical (defaults live in DEFAULT_TARGETS,
  // applied at read via jlptTargets — never materialized here).
  if (o.targets && typeof o.targets === 'object') {
    const clean = {};
    for (const k of ['wordsPerDay', 'grammarPerWeek']) {
      const v = Math.round(Number(o.targets[k]));
      if (Number.isFinite(v) && v >= 1 && v <= 99) clean[k] = v;
    }
    if (Object.keys(clean).length) base.targets = clean;
  }
  // Mock-test log. Like `targets`, the key is OMITTED when empty so a pre-mocks blob round-trips
  // byte-identical (and shouldSeed stays honest). Deliberately NOT subject to the days{} cutoff
  // below — an old sitting is the most informative data point the readiness view has.
  const mocks = normalizeMocks(o.mocks);
  if (mocks.length) base.mocks = mocks;
  // The 文法形式判断 per-point score trail. Same omit-when-empty rule, and likewise EXEMPT from the
  // days{} cutoff — it's a lifetime record of which patterns you miss, not a daily tick.
  const mcq = normalizeMcqTrail(o.mcq);
  if (Object.keys(mcq).length) base.mcq = mcq;
  const cutoff = todayKey ? shiftDay(todayKey, -JLPT_DAYS_KEEP) : null;
  for (const [day, rec] of Object.entries(o.days || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !rec || typeof rec !== 'object') continue;
    if (cutoff && day < cutoff) continue;
    const clean = {};
    for (const [k, v] of Object.entries(rec)) if (v) clean[k] = 1;
    if (Object.keys(clean).length) base.days[day] = clean;
  }
  return base;
}

// 409 conflict merge: union the day records both ways (a done task on either device
// stays done); scalars keep LOCAL (the device the user is acting on — mergeMinna's rule).
export function mergeJlpt(local, server) {
  const a = local || {}, b = server || {};
  const days = {};
  for (const day of new Set([...Object.keys(a.days || {}), ...Object.keys(b.days || {})])) {
    days[day] = { ...((b.days || {})[day] || {}), ...((a.days || {})[day] || {}) };
  }
  const out = {
    level: a.level || b.level || 'N3',
    examDate: a.examDate || b.examDate || '',
    days,
  };
  // Per-field union, local wins (device A can set wordsPerDay while B sets grammarPerWeek);
  // key omitted when neither side has targets, matching normalizeJlpt.
  const targets = { ...(b.targets || {}), ...(a.targets || {}) };
  if (Object.keys(targets).length) out.targets = targets;
  // Mocks union by id, LOCAL wins on a collision (the device the user is editing on — the
  // scalars' rule). normalizeMocks re-sorts + re-caps, so a merge can't grow the blob unbounded.
  // Server-first so the local entry overwrites it in the Map.
  const mocks = normalizeMocks([...(b.mocks || []), ...(a.mocks || [])]);
  if (mocks.length) out.mocks = mocks;
  // MCQ trail: field-wise max per point (monotonic counters — see mergeMcqTrail), key omitted when
  // neither side has drilled. NOT a union-of-sums: both sides already contain the shared history.
  const mcq = mergeMcqTrail(a.mcq, b.mcq);
  if (Object.keys(mcq).length) out.mcq = mcq;
  return out;
}

/* ---- mock-test log ----------------------------------------------------------- */
//
// The one readiness signal the tab can't DERIVE: an actual scored practice paper. A mock is
// `{ id:'<date>-<level>', date, level, scores:{vocab, grammarReading, listening}, total, notes }`
// living in a `mocks` array on the jlpt blob — union-merged by id on a 409 and EXEMPT from the
// 60-day `days{}` pruning (a mock from six months ago is the most interesting data point there is).
//
// SHAPE CAVEAT: the three-section score report is the N1/N2/N3 paper. N4/N5 report only TWO
// sections (言語知識・読解 out of 120 + 聴解 out of 60), so their scores can't be split into this
// shape from a real score report. Each mock stores its own `level`, so an N4/N5 shape can be added
// later per-record; today the feature layer only offers the form for N1–N3.

export const JLPT_MOCKS_KEEP = 50;   // plenty of sittings; the blob is PUT whole, so it stays bounded

// The N1–N3 answer sheet: three sections, 60 points each, 180 total.
export const MOCK_SECTIONS = [
  { key: 'vocab', jp: '文字・語彙', en: 'Vocabulary', max: 60 },
  { key: 'grammarReading', jp: '文法・読解', en: 'Grammar & Reading', max: 60 },
  { key: 'listening', jp: '聴解', en: 'Listening', max: 60 },
];
export const MOCK_SECTION_KEYS = MOCK_SECTIONS.map((s) => s.key);
export const MOCK_MAX_TOTAL = MOCK_SECTIONS.reduce((s, x) => s + x.max, 0);
// Levels whose real score report matches MOCK_SECTIONS (three sections). N4/N5 don't — see above.
export const MOCK_LEVELS = ['N3', 'N2', 'N1'];

// Official JLPT pass criteria: you must clear the overall total AND every sectional minimum —
// 55/60/50 with a 15 in listening is a FAIL. Sourced from the JLPT scoring rules, not derived;
// worth re-checking against jlpt.jp before trusting a borderline verdict.
export const MOCK_PASS = {
  N1: { total: 100, section: 19 },
  N2: { total: 90, section: 19 },
  N3: { total: 95, section: 19 },
  N4: { total: 90, section: 19 },
  N5: { total: 80, section: 19 },
};

export const mockId = (date, level) => `${date}-${level}`;

// Sum the three sections. Missing/junk sections count 0 — a partially-entered mock still totals.
export function mockTotal(scores) {
  return MOCK_SECTION_KEYS.reduce((sum, k) => {
    const v = Math.round(Number((scores || {})[k]));
    return sum + (Number.isFinite(v) && v > 0 ? Math.min(v, 60) : 0);
  }, 0);
}

// Normalize one mock. Returns null for anything unusable (no date, unknown level) so a junk
// entry is DROPPED rather than rendered as a 0/180 fail the user never sat. `total` is always
// recomputed from the sections — a stored total is a cache, never the truth.
export function normalizeMock(m) {
  if (!m || typeof m !== 'object') return null;
  if (typeof m.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(m.date)) return null;
  if (!JLPT_LEVEL_ORDER.includes(m.level)) return null;
  const scores = {};
  for (const k of MOCK_SECTION_KEYS) {
    const v = Math.round(Number((m.scores || {})[k]));
    scores[k] = Number.isFinite(v) ? Math.max(0, Math.min(v, 60)) : 0;
  }
  const out = { id: typeof m.id === 'string' && m.id ? m.id : mockId(m.date, m.level), date: m.date, level: m.level, scores, total: mockTotal(scores) };
  if (typeof m.notes === 'string' && m.notes.trim()) out.notes = m.notes.trim().slice(0, 500);
  return out;
}

// Dedupe by id (LAST wins — a re-entered sitting overwrites), newest date first, capped.
export function normalizeMocks(list) {
  if (!Array.isArray(list)) return [];
  const byId = new Map();
  for (const m of list) { const c = normalizeMock(m); if (c) byId.set(c.id, c); }
  return [...byId.values()]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.id < b.id ? 1 : -1)))
    .slice(0, JLPT_MOCKS_KEEP);
}

// Pass/fail for one mock, against ITS OWN level (you might sit an N4 paper on the way to N3).
// `shortfall` is how many points short of the total mark; `weakSections` are the sections under
// the sectional minimum — the two numbers that tell you what to study next.
export function mockVerdict(mock) {
  if (!mock) return null;
  const marks = MOCK_PASS[mock.level] || MOCK_PASS.N3;
  const weakSections = MOCK_SECTION_KEYS.filter((k) => (mock.scores[k] || 0) < marks.section);
  const totalOk = mock.total >= marks.total;
  return {
    pass: totalOk && !weakSections.length,
    total: mock.total, needTotal: marks.total, needSection: marks.section,
    shortfall: Math.max(0, marks.total - mock.total),
    totalOk, weakSections,
  };
}

// The trend across sittings of ONE level (mixing levels would compare different papers).
// `mocks` is newest-first (normalizeMocks order). Returns oldest→newest points for a sparkline
// plus the latest mock and its delta against the previous sitting (null when there's only one).
export function mockTrend(mocks, level) {
  const rows = (mocks || []).filter((m) => m.level === level);
  if (!rows.length) return null;
  const chron = [...rows].reverse();                     // oldest → newest
  const latest = chron[chron.length - 1];
  const prev = chron.length > 1 ? chron[chron.length - 2] : null;
  return {
    points: chron.map((m) => ({ date: m.date, total: m.total })),
    latest, prev,
    delta: prev ? latest.total - prev.total : null,
    best: Math.max(...chron.map((m) => m.total)),
  };
}

// 'YYYY-MM-DD' + n days (local-date arithmetic, no TZ drift: noon anchor).
export function shiftDay(dayKey, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return dayKey;
  const d = new Date(+m[1], +m[2] - 1, +m[3], 12);
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// The last `n` days (oldest → today) with each day's done-fraction over `taskCount` —
// the checklist heatmap model. done caps at taskCount (a stale task id can't overflow).
export function checklistHeat(days, todayKey, n, taskCount) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = shiftDay(todayKey, -i);
    const rec = (days || {})[day] || {};
    const done = Math.min(Object.keys(rec).length, taskCount);
    out.push({ day, done, frac: taskCount ? done / taskCount : 0 });
  }
  return out;
}
