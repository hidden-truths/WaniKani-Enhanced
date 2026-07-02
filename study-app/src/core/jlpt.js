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
  return {
    level: a.level || b.level || 'N3',
    examDate: a.examDate || b.examDate || '',
    days,
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
