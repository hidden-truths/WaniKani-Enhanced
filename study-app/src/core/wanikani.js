// 鰐蟹 WaniKani analytics — the PURE, DOM-free derivations over the user's synced
// WaniKani dataset (subjects / assignments / review statistics / level progressions,
// cached in IndexedDB by features/wanikani/sync.js). Everything here takes plain data
// in and returns plain data (or HTML strings, charts-style) out; `nowMs` is always
// injected, never Date.now(), so the whole module is unit-testable (test/wanikani-core).
//
// Vocabulary of the WK v2 API this module assumes (slimmed by slimSubject below):
//   subject    = { id, type:'radical'|'kanji'|'vocabulary', level, chars, meanings, readings,
//                  componentIds, amalgamationIds, similarIds, mnemonics, contextSentences, … }
//   assignment = { subjectId, stage:0..9, availableAt(ms|null), startedAt, passedAt, burnedAt }
//                stage 0 = unlocked-but-lesson-not-taken; 1-4 Apprentice; 5-6 Guru;
//                7 Master; 8 Enlightened; 9 Burned. No assignment row at all = locked.
//   stat       = review_statistic: meaning/reading correct/incorrect + current/max streaks.

/* ---- SRS stage bands ------------------------------------------------------ */

// The five post-lesson bands, in progression order. `jp` is the one-glyph seal label
// (the KAISATSU station-stamp aesthetic); css is the token suffix (--wk-<css>).
export const WK_BANDS = [
  { key: 'apprentice', label: 'Apprentice', jp: '見', css: 'appr', stages: [1, 4] },
  { key: 'guru', label: 'Guru', jp: '達', css: 'guru', stages: [5, 6] },
  { key: 'master', label: 'Master', jp: '主', css: 'master', stages: [7, 7] },
  { key: 'enlightened', label: 'Enlightened', jp: '悟', css: 'enl', stages: [8, 8] },
  { key: 'burned', label: 'Burned', jp: '焼', css: 'burn', stages: [9, 9] },
];

export function stageBand(stage) {
  if (!stage || stage < 1) return 'lesson';
  for (const b of WK_BANDS) if (stage >= b.stages[0] && stage <= b.stages[1]) return b.key;
  return 'burned';
}

// Count assignments per band. `lesson` = unlocked with the lesson not yet taken (stage 0).
// Locked subjects have no assignment at all — the caller derives locked = subjects − rows.
export function bandCounts(assignments) {
  const out = { lesson: 0, apprentice: 0, guru: 0, master: 0, enlightened: 0, burned: 0 };
  for (const a of assignments) { if (!a.hidden) out[stageBand(a.stage)]++; }
  return out;
}

/* ---- Review forecast ------------------------------------------------------ */

// Bucket upcoming reviews into `slots` windows of `stepMs` from `nowMs`. Only scheduled,
// unburned assignments count (stage 1-8 with an availableAt). Already-available reviews
// are reported separately in `availableNow` (they're "do them now", not a forecast bar);
// beyond-window drops. Returns { counts:[…slots], availableNow, windowTotal }.
export function wkForecast(assignments, nowMs, { slots = 24, stepMs = 3600e3 } = {}) {
  const counts = new Array(slots).fill(0);
  let availableNow = 0;
  for (const a of assignments) {
    if (a.hidden || !a.availableAt || !a.startedAt || a.stage < 1 || a.stage > 8) continue;
    if (a.availableAt <= nowMs) { availableNow++; continue; }
    const slot = Math.floor((a.availableAt - nowMs) / stepMs);
    if (slot < slots) counts[slot]++;
  }
  return { counts, availableNow, windowTotal: counts.reduce((s, n) => s + n, 0) };
}

/* ---- Leech detection ------------------------------------------------------ */

// The classic leech score: incorrect answers divided by the current streak^1.5, taken
// over the WORSE of the meaning/reading sides. A card you keep missing scores high; a
// card you missed long ago but have since answered right many times decays to ~0.
// Radicals have no reading side — a side with zero attempts is skipped.
export function leechScore(stat) {
  const side = (incorrect, streak, attempts) =>
    attempts > 0 ? incorrect / Math.pow(Math.max(streak, 1), 1.5) : 0;
  return Math.max(
    side(stat.meaningIncorrect, stat.meaningCurrentStreak, stat.meaningCorrect + stat.meaningIncorrect),
    side(stat.readingIncorrect, stat.readingCurrentStreak, stat.readingCorrect + stat.readingIncorrect),
  );
}

// Rank the user's leeches: every subject with an ACTIVE assignment (lesson taken, not
// burned) whose leech score clears `threshold` and which has been missed at least
// `minIncorrect` times total (one early slip isn't a leech). Sorted worst-first.
// Returns [{ subject, stat, assignment, score }].
export function buildLeeches(stats, assignmentsBySubject, subjectsById, { threshold = 1, minIncorrect = 2 } = {}) {
  const out = [];
  for (const st of stats) {
    if (st.hidden) continue;
    const a = assignmentsBySubject.get(st.subjectId);
    if (!a || a.hidden || !a.startedAt || a.stage < 1 || a.stage > 8) continue;
    if (st.meaningIncorrect + st.readingIncorrect < minIncorrect) continue;
    const score = leechScore(st);
    if (score < threshold) continue;
    const subject = subjectsById.get(st.subjectId);
    if (!subject || subject.hidden) continue;
    out.push({ subject, stat: st, assignment: a, score });
  }
  return out.sort((p, q) => q.score - p.score);
}

/* ---- Same-kanji confusion clusters ---------------------------------------- */

// The "words sharing a kanji with slightly different meanings" view: group the leech
// list by component kanji, then attach EVERY vocab the user has started that uses the
// same kanji (leech or not) so the whole confusable family reads side-by-side. A leech
// kanji clusters on itself. Clusters need ≥1 leech + ≥2 started members to be worth
// showing; sorted by leech count, then family size. Returns
// [{ kanji, members: [{ subject, isLeech }] , leechCount }].
export function confusionClusters(leeches, subjectsById, assignmentsBySubject) {
  const leechIds = new Set(leeches.map((l) => l.subject.id));
  const byKanji = new Map();
  for (const l of leeches) {
    const s = l.subject;
    const kanjiIds = s.type === 'vocabulary' ? (s.componentIds || []) : s.type === 'kanji' ? [s.id] : [];
    for (const kid of kanjiIds) {
      const kanji = subjectsById.get(kid);
      if (!kanji || kanji.type !== 'kanji') continue;
      if (!byKanji.has(kid)) byKanji.set(kid, new Set());
      byKanji.get(kid).add(s.id);
    }
  }
  const clusters = [];
  for (const [kid, leechMemberIds] of byKanji) {
    const kanji = subjectsById.get(kid);
    const familyIds = new Set([...(kanji.amalgamationIds || [])]);
    if (leechIds.has(kid)) familyIds.add(kid);           // the kanji itself is a leech
    leechMemberIds.forEach((id) => familyIds.add(id));   // always include the leeches that formed the cluster
    const members = [];
    for (const id of familyIds) {
      const subj = subjectsById.get(id);
      if (!subj || subj.hidden) continue;
      const a = assignmentsBySubject.get(id);
      if (!a || !a.startedAt) continue;                  // only words the user has actually met
      members.push({ subject: subj, isLeech: leechIds.has(id) });
    }
    if (members.length < 2) continue;
    const leechCount = members.filter((m) => m.isLeech).length;
    if (!leechCount) continue;
    members.sort((p, q) => (q.isLeech - p.isLeech) || (p.subject.level - q.subject.level));
    clusters.push({ kanji, members, leechCount });
  }
  return clusters.sort((p, q) => (q.leechCount - p.leechCount) || (q.members.length - p.members.length));
}

/* ---- Level progress + pace ------------------------------------------------ */

// WK levels up when 90% of the level's kanji reach Guru (passed_at). Progress toward
// that gate: passed kanji over the ceil(0.9 · total) needed.
export function levelProgress(subjects, assignmentsBySubject, level) {
  const kanji = subjects.filter((s) => s.type === 'kanji' && s.level === level && !s.hidden);
  const passed = kanji.filter((s) => { const a = assignmentsBySubject.get(s.id); return a && a.passedAt; }).length;
  const needed = Math.max(1, Math.ceil(kanji.length * 0.9));
  return { passed, total: kanji.length, needed, pct: Math.min(100, Math.round((100 * passed) / needed)) };
}

// Days spent on each level, oldest→newest, from the level_progressions collection.
// A level with no pass yet is `current` and measures against nowMs. Abandoned rows
// (resets) are dropped. Returns [{ level, days, current }].
export function levelPace(progressions, nowMs) {
  const out = [];
  for (const p of progressions) {
    if (p.abandonedAt) continue;
    const start = p.startedAt || p.unlockedAt;
    if (!start) continue;
    const end = p.passedAt || nowMs;
    out.push({ level: p.level, days: Math.max(0, (end - start) / 864e5), current: !p.passedAt });
  }
  return out.sort((a, b) => a.level - b.level);
}

/* ---- Accuracy ------------------------------------------------------------- */

const pct = (c, i) => (c + i ? Math.round((100 * c) / (c + i)) : null);

// Lifetime answer accuracy from the review_statistics collection: meaning vs reading
// overall, plus a per-subject-type overall split. kana_vocabulary folds into vocabulary.
export function accuracySummary(stats) {
  const zero = () => ({ mc: 0, mi: 0, rc: 0, ri: 0 });
  const total = zero();
  const byType = { radical: zero(), kanji: zero(), vocabulary: zero() };
  for (const st of stats) {
    if (st.hidden) continue;
    const t = byType[st.subjectType === 'kana_vocabulary' ? 'vocabulary' : st.subjectType] || byType.vocabulary;
    for (const acc of [total, t]) { acc.mc += st.meaningCorrect; acc.mi += st.meaningIncorrect; acc.rc += st.readingCorrect; acc.ri += st.readingIncorrect; }
  }
  const shape = (o) => ({ meaning: pct(o.mc, o.mi), reading: pct(o.rc, o.ri), overall: pct(o.mc + o.rc, o.mi + o.ri) });
  return { total: shape(total), radical: shape(byType.radical), kanji: shape(byType.kanji), vocabulary: shape(byType.vocabulary) };
}

/* ---- Subject slimming (the sync-time shape) -------------------------------- */

// Compact a raw WK /subjects envelope into the shape everything above consumes and the
// IndexedDB cache stores. Drops the heavy fields we never render (all audio variants →
// one mp3; radical character_images → one svg/png url) but keeps the full study surface:
// meanings, readings, mnemonics + hints, context sentences, and the relation id lists
// that power the confusion clusters. kana_vocabulary is folded into 'vocabulary' with
// kana:true (it has no component kanji — clusters just skip it).
export function slimSubject(raw) {
  const d = raw.data;
  const type = raw.object === 'kana_vocabulary' ? 'vocabulary' : raw.object;
  const audio = (d.pronunciation_audios || []).find((a) => a.content_type === 'audio/mpeg');
  const img = (d.character_images || []).find((i) => i.content_type === 'image/svg+xml') || (d.character_images || [])[0];
  return {
    id: raw.id,
    type,
    kana: raw.object === 'kana_vocabulary' || undefined,
    level: d.level,
    slug: d.slug,
    chars: d.characters || null,
    imageUrl: d.characters ? null : (img ? img.url : null),
    docUrl: d.document_url,
    meanings: (d.meanings || []).map((m) => ({ m: m.meaning, primary: !!m.primary })),
    auxMeanings: (d.auxiliary_meanings || []).filter((m) => m.type === 'whitelist').map((m) => m.meaning),
    readings: (d.readings || []).map((r) => ({ r: r.reading, primary: !!r.primary, type: r.type || null, accepted: r.accepted_answer !== false })),
    pos: d.parts_of_speech || [],
    componentIds: d.component_subject_ids || [],
    amalgamationIds: d.amalgamation_subject_ids || [],
    similarIds: d.visually_similar_subject_ids || [],
    meaningMnemonic: d.meaning_mnemonic || null,
    meaningHint: d.meaning_hint || null,
    readingMnemonic: d.reading_mnemonic || null,
    readingHint: d.reading_hint || null,
    contextSentences: (d.context_sentences || []).map((s) => ({ ja: s.ja, en: s.en })),
    audio: audio ? audio.url : null,
    hidden: !!d.hidden_at,
  };
}

export function slimAssignment(raw) {
  const d = raw.data;
  const ms = (t) => (t ? Date.parse(t) : null);
  return {
    id: raw.id,
    subjectId: d.subject_id,
    type: d.subject_type === 'kana_vocabulary' ? 'vocabulary' : d.subject_type,
    stage: d.srs_stage,
    availableAt: ms(d.available_at),
    unlockedAt: ms(d.unlocked_at),
    startedAt: ms(d.started_at),
    passedAt: ms(d.passed_at),
    burnedAt: ms(d.burned_at),
    hidden: !!d.hidden,
  };
}

export function slimStat(raw) {
  const d = raw.data;
  return {
    id: raw.id,
    subjectId: d.subject_id,
    subjectType: d.subject_type === 'kana_vocabulary' ? 'vocabulary' : d.subject_type,
    meaningCorrect: d.meaning_correct, meaningIncorrect: d.meaning_incorrect,
    readingCorrect: d.reading_correct, readingIncorrect: d.reading_incorrect,
    meaningCurrentStreak: d.meaning_current_streak, meaningMaxStreak: d.meaning_max_streak,
    readingCurrentStreak: d.reading_current_streak, readingMaxStreak: d.reading_max_streak,
    percentCorrect: d.percentage_correct,
    hidden: !!d.hidden,
  };
}

export function slimProgression(raw) {
  const d = raw.data;
  const ms = (t) => (t ? Date.parse(t) : null);
  return { id: raw.id, level: d.level, unlockedAt: ms(d.unlocked_at), startedAt: ms(d.started_at), passedAt: ms(d.passed_at), completedAt: ms(d.completed_at), abandonedAt: ms(d.abandoned_at) };
}

/* ---- Rendering helpers (pure string builders, charts-style) ---------------- */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const wkEscape = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);

// WK mnemonics carry semantic tags — <kanji>build</kanji>, <radical>, <vocabulary>,
// <reading>, <ja>, <meaning> — that WK's own site renders as coloured highlights. We
// escape EVERYTHING first, then convert only the known tags back into styled spans, so
// arbitrary markup in the text can never reach innerHTML live.
const WK_TAGS = ['kanji', 'radical', 'vocabulary', 'reading', 'meaning', 'ja'];
export function renderWkMarkup(text) {
  if (!text) return '';
  let html = wkEscape(text);
  for (const tag of WK_TAGS) {
    html = html.replaceAll(`&lt;${tag}&gt;`, `<span class="wkm wkm-${tag}">`).replaceAll(`&lt;/${tag}&gt;`, '</span>');
  }
  return html.replace(/\n\n+/g, '<br><br>').replace(/\n/g, '<br>');
}

// Primary meaning / reading pickers (fall back to the first entry).
export const primaryMeaning = (s) => { const m = (s.meanings || []).find((x) => x.primary) || (s.meanings || [])[0]; return m ? m.m : ''; };
export const primaryReading = (s) => { const r = (s.readings || []).find((x) => x.primary) || (s.readings || [])[0]; return r ? r.r : ''; };

// Case-insensitive subject search over characters, slug, meanings and readings.
export function subjectMatches(s, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (s.chars && s.chars.includes(q)) return true;
  if (s.slug && s.slug.toLowerCase().includes(needle)) return true;
  if ((s.meanings || []).some((m) => m.m.toLowerCase().includes(needle))) return true;
  if ((s.readings || []).some((r) => r.r.includes(q))) return true;
  return false;
}

// Short human "when" for a review timestamp: now / in 23m / in 4h / in 3d / a date.
export function timeUntil(ms, nowMs) {
  if (ms == null) return '—';
  const d = ms - nowMs;
  if (d <= 0) return 'now';
  if (d < 3600e3) return 'in ' + Math.max(1, Math.round(d / 60e3)) + 'm';
  if (d < 48 * 3600e3) return 'in ' + Math.round(d / 3600e3) + 'h';
  return 'in ' + Math.round(d / 864e5) + 'd';
}

/* ---- Deck activation (wk-leech-to-deck) ------------------------------------ */

// Map a WK subject's parts_of_speech list onto the deck's card taxonomy. The specific
// verb kinds win over the generic scan; the generic scan matches '… verb' with the
// space so 'adverb' can never read as a verb. Unrecognized pos (counter, numeral,
// proper noun, …) land in the noun bucket — the deck's own default — so a new WK pos
// string can never make an un-renderable card. trans only means something on verbs;
// a both-ways verb (rare) stays ''.
export function wkPosTraits(pos) {
  const list = (pos || []).map((p) => String(p).toLowerCase());
  const has = (s) => list.includes(s);
  let cat = null, type = '';
  if (has('godan verb')) { cat = 'verb'; type = 'godan'; }
  else if (has('ichidan verb')) { cat = 'verb'; type = 'ichidan'; }
  else if (list.some((p) => p === 'verb' || p.endsWith(' verb'))) cat = 'verb';
  else if (has('い adjective') || has('i adjective')) { cat = 'adjective'; type = 'i-adj'; }
  else if (has('な adjective') || has('na adjective')) { cat = 'adjective'; type = 'na-adj'; }
  else if (list.some((p) => p.endsWith('adjective'))) cat = 'adjective';
  else if (has('adverb')) cat = 'adverb';
  else if (has('expression') || has('interjection') || has('conjunction') || has('particle')) cat = 'phrase';
  else cat = 'noun';
  const t = has('transitive verb'), i = has('intransitive verb');
  const trans = cat === 'verb' && t !== i ? (t ? 't' : 'i') : '';
  return { cat, type, trans };
}

// Build the tagged custom-card object for a WK VOCABULARY subject (Source:鰐蟹) —
// the songs/minna activation shape. Pure: the caller assigns the monotonic `rank`
// and owns dedup + persistence. The deck's Leitner SRS takes over from here; the WK
// SRS schedule is never written back (read-only token), the wkId keeps provenance.
// mnem/tip/ex[jp] are innerHTML'd by the flashcard/Browse notes, so everything is
// escaped here — the WK mnemonics via renderWkMarkup (escape-then-style, keeping the
// coloured <kanji>/<reading>/… highlights the user already learned from).
export function buildWkCard(s, rank) {
  const { cat, type, trans } = wkPosTraits(s.pos);
  const alts = (s.meanings || []).filter((m) => !m.primary).map((m) => m.m);
  const from = `WaniKani level ${s.level}` + (s.docUrl
    ? ` · <a href="${wkEscape(s.docUrl)}" target="_blank" rel="noopener">wanikani.com</a>` : '');
  return {
    rank,
    jp: s.chars,
    read: primaryReading(s) || s.chars,
    mean: [primaryMeaning(s), ...alts.slice(0, 2)].filter(Boolean).join(', '),
    cat, type, trans,
    jlpt: '',
    tags: ['鰐蟹', 'wk-l' + s.level],
    wanikani: true,
    wkId: s.id,
    mnem: s.meaningMnemonic ? renderWkMarkup(s.meaningMnemonic) : '',
    tip: (s.readingMnemonic ? '<b>Reading:</b> ' + renderWkMarkup(s.readingMnemonic) + '<br><br>' : '') + from,
    ex: (s.contextSentences || []).map((cs) => [wkEscape(cs.ja), cs.en]),
    accent: null,
    levels: null,
    custom: true,
  };
}
