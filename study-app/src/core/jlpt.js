// JLPT lens — PURE, DOM-free derivations over the bundled JLPT word list
// (data/jlpt.js, ~7.6k words N5–N1) + the app's own study signals. Everything takes
// plain data in (the map, `nowMs`/`dayKey` injected — never Date.now()) so the whole
// module is unit-testable (test/jlpt-core.test.js). The lazy-loading singleton around
// the word data lives in features/jlpt/data.js; this module never imports the data.

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
// the LEVEL facet); `added` (the local day key) is the quota checklist row's live signal.
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

// Deck-add pace over the trailing `n` days, from the `added` day-stamps buildJlptCard writes.
// Only gap-fill cards carry `added` in wave 1, so this is honestly "gap-fill adds", not all adds.
export function weeklyAddPace(data, todayKey, level, n = 7) {
  const cutoff = shiftDay(todayKey, -(n - 1));
  let today = 0, week = 0;
  for (const v of data || []) {
    if (!v || !v.added || v.jlpt !== level) continue;
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
  return out;
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
