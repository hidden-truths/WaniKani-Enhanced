// Pure-core tests for the 鰐蟹 WaniKani analytics (src/core/wanikani.js) — the leech
// scoring, confusion clustering, forecast/band/pace derivations and the sync-time
// slimmers. All time-dependent functions take an injected nowMs (project convention).
import { test, expect } from 'vitest';
import {
  WK_BANDS, stageBand, bandCounts, wkForecast, leechScore, buildLeeches,
  confusionClusters, levelProgress, levelPace, accuracySummary,
  slimSubject, slimAssignment, slimStat, renderWkMarkup, wkEscape,
  primaryMeaning, primaryReading, subjectMatches, timeUntil,
  wkPosTraits, buildWkCard,
} from '../src/core/wanikani.js';

const NOW = Date.parse('2026-07-01T12:00:00Z');
const H = 3600e3, D = 864e5;

/* ---- fixtures ------------------------------------------------------------- */

const subj = (id, type, chars, o = {}) => ({
  id, type, chars, level: o.level || 1, slug: chars, hidden: false,
  meanings: o.meanings || [{ m: 'meaning' + id, primary: true }],
  readings: o.readings || [{ r: 'よみ' + id, primary: true, accepted: true }],
  componentIds: o.componentIds || [], amalgamationIds: o.amalgamationIds || [], similarIds: [],
  ...o,
});
const asg = (subjectId, stage, o = {}) => ({
  id: subjectId * 10, subjectId, type: o.type || 'vocabulary', stage,
  availableAt: o.availableAt !== undefined ? o.availableAt : NOW + H,
  startedAt: o.startedAt !== undefined ? o.startedAt : NOW - 30 * D,
  passedAt: o.passedAt || null, burnedAt: null, unlockedAt: NOW - 40 * D, hidden: !!o.hidden,
});
const stat = (subjectId, o = {}) => ({
  id: subjectId * 100, subjectId, subjectType: o.subjectType || 'vocabulary',
  meaningCorrect: o.mc ?? 10, meaningIncorrect: o.mi ?? 0,
  readingCorrect: o.rc ?? 10, readingIncorrect: o.ri ?? 0,
  meaningCurrentStreak: o.mcs ?? 5, meaningMaxStreak: 8,
  readingCurrentStreak: o.rcs ?? 5, readingMaxStreak: 8,
  percentCorrect: 90, hidden: !!o.hidden,
});
const asMaps = (subjects, assignments) => [
  new Map(subjects.map((s) => [s.id, s])),
  new Map(assignments.map((a) => [a.subjectId, a])),
];

/* ---- stage bands ----------------------------------------------------------- */

test('stageBand maps the 0-9 SRS range onto the five bands + lesson', () => {
  expect(stageBand(0)).toBe('lesson');
  expect(stageBand(1)).toBe('apprentice');
  expect(stageBand(4)).toBe('apprentice');
  expect(stageBand(5)).toBe('guru');
  expect(stageBand(6)).toBe('guru');
  expect(stageBand(7)).toBe('master');
  expect(stageBand(8)).toBe('enlightened');
  expect(stageBand(9)).toBe('burned');
  expect(WK_BANDS.map((b) => b.key)).toEqual(['apprentice', 'guru', 'master', 'enlightened', 'burned']);
});

test('bandCounts tallies per band and skips hidden rows', () => {
  const counts = bandCounts([asg(1, 0), asg(2, 2), asg(3, 4), asg(4, 6), asg(5, 9), asg(6, 3, { hidden: true })]);
  expect(counts).toEqual({ lesson: 1, apprentice: 2, guru: 1, master: 0, enlightened: 0, burned: 1 });
});

/* ---- forecast --------------------------------------------------------------- */

test('wkForecast buckets scheduled reviews, splits out available-now, drops beyond-window', () => {
  const rows = [
    asg(1, 2, { availableAt: NOW - H }),          // overdue → availableNow
    asg(2, 3, { availableAt: NOW + 30 * 60e3 }),  // slot 0
    asg(3, 5, { availableAt: NOW + 5 * H }),      // slot 5
    asg(4, 8, { availableAt: NOW + 30 * H }),     // beyond a 24h window → dropped
    asg(5, 9, { availableAt: null }),             // burned → ignored
    asg(6, 0, { availableAt: NOW + H, startedAt: null }),  // lesson queue → ignored
  ];
  const f = wkForecast(rows, NOW, { slots: 24, stepMs: H });
  expect(f.availableNow).toBe(1);
  expect(f.counts[0]).toBe(1);
  expect(f.counts[5]).toBe(1);
  expect(f.windowTotal).toBe(2);
});

/* ---- leeches ---------------------------------------------------------------- */

test('leechScore takes the worse side and skips a side with no attempts', () => {
  // meaning fine (streak 6), reading bad: 8 wrong on a streak of 1 → 8
  expect(leechScore(stat(1, { mi: 1, mcs: 6, ri: 8, rcs: 1 }))).toBe(8);
  // radical: reading side has zero attempts — only meaning counts
  expect(leechScore(stat(2, { mi: 4, mcs: 1, rc: 0, ri: 0, rcs: 0 }))).toBe(4);
  // long current streak decays the score below 1
  expect(leechScore(stat(3, { mi: 3, mcs: 9, ri: 0 }))).toBeLessThan(1);
});

test('buildLeeches filters to active assignments, applies threshold + minIncorrect, sorts worst-first', () => {
  const subjects = [subj(1, 'vocabulary', '大変'), subj(2, 'vocabulary', '大切'), subj(3, 'kanji', '変'), subj(4, 'vocabulary', '一切')];
  const assignments = [asg(1, 2), asg(2, 3), asg(3, 9), asg(4, 4)]; // 3 is burned
  const stats = [
    stat(1, { mi: 6, mcs: 1 }),            // score 6 — leech
    stat(2, { mi: 1, ri: 0, mcs: 1 }),     // only 1 miss total → below minIncorrect
    stat(3, { mi: 9, mcs: 1 }),            // burned → excluded
    stat(4, { ri: 3, rcs: 1 }),            // score 3 — leech
  ];
  const [byId, byAsg] = asMaps(subjects, assignments);
  const leeches = buildLeeches(stats, byAsg, byId);
  expect(leeches.map((l) => l.subject.id)).toEqual([1, 4]);
  expect(leeches[0].score).toBeGreaterThan(leeches[1].score);
});

test('confusionClusters groups leech vocab by shared component kanji with started siblings', () => {
  const kanji = subj(10, 'kanji', '生', { amalgamationIds: [21, 22, 23] });
  const v1 = subj(21, 'vocabulary', '生きる', { componentIds: [10] });
  const v2 = subj(22, 'vocabulary', '生まれる', { componentIds: [10] });
  const v3 = subj(23, 'vocabulary', '人生', { componentIds: [10] });   // never started
  const other = subj(30, 'kanji', '別', { amalgamationIds: [] });
  const subjects = [kanji, v1, v2, v3, other];
  const assignments = [asg(10, 5, { type: 'kanji' }), asg(21, 2), asg(22, 3)];
  const [byId, byAsg] = asMaps(subjects, assignments);
  const leeches = [
    { subject: v1, stat: stat(21, { mi: 5, mcs: 1 }), assignment: assignments[1], score: 5 },
  ];
  const clusters = confusionClusters(leeches, byId, byAsg);
  expect(clusters.length).toBe(1);
  expect(clusters[0].kanji.id).toBe(10);
  const ids = clusters[0].members.map((m) => m.subject.id);
  expect(ids).toContain(21);
  expect(ids).toContain(22);      // started sibling rides along for contrast
  expect(ids).not.toContain(23);  // unstarted sibling excluded
  expect(clusters[0].members[0].subject.id).toBe(21);   // leech sorts first
  expect(clusters[0].leechCount).toBe(1);
});

test('a leech kanji clusters on itself', () => {
  const k = subj(10, 'kanji', '議', { amalgamationIds: [21] });
  const v = subj(21, 'vocabulary', '会議', { componentIds: [10] });
  const assignments = [asg(10, 2, { type: 'kanji' }), asg(21, 5)];
  const [byId, byAsg] = asMaps([k, v], assignments);
  const leeches = [{ subject: k, stat: stat(10, { mi: 4, mcs: 1 }), assignment: assignments[0], score: 4 }];
  const clusters = confusionClusters(leeches, byId, byAsg);
  expect(clusters.length).toBe(1);
  expect(clusters[0].members.map((m) => m.subject.id).sort()).toEqual([10, 21]);
});

/* ---- level progress + pace --------------------------------------------------- */

test('levelProgress applies the 90% kanji gate', () => {
  const subjects = [];
  for (let i = 1; i <= 10; i++) subjects.push(subj(i, 'kanji', 'k' + i, { level: 22 }));
  const assignments = [];
  for (let i = 1; i <= 5; i++) assignments.push(asg(i, 5, { passedAt: NOW - D }));
  const [, byAsg] = asMaps(subjects, assignments);
  const p = levelProgress(subjects, byAsg, 22);
  expect(p).toEqual({ passed: 5, total: 10, needed: 9, pct: 56 });
});

test('levelPace measures days per level, marks the current one, drops abandoned', () => {
  const prog = [
    { id: 1, level: 1, startedAt: NOW - 30 * D, passedAt: NOW - 20 * D, abandonedAt: null },
    { id: 2, level: 2, startedAt: NOW - 20 * D, passedAt: null, abandonedAt: null },
    { id: 3, level: 1, startedAt: NOW - 60 * D, passedAt: null, abandonedAt: NOW - 50 * D },
  ];
  const pace = levelPace(prog, NOW);
  expect(pace.length).toBe(2);
  expect(pace[0]).toMatchObject({ level: 1, days: 10, current: false });
  expect(pace[1].level).toBe(2);
  expect(pace[1].current).toBe(true);
  expect(Math.round(pace[1].days)).toBe(20);
});

/* ---- accuracy ----------------------------------------------------------------- */

test('accuracySummary splits meaning/reading and per-type', () => {
  const stats = [
    stat(1, { mc: 9, mi: 1, rc: 8, ri: 2, subjectType: 'kanji' }),
    stat(2, { mc: 10, mi: 0, rc: 5, ri: 5, subjectType: 'vocabulary' }),
    stat(3, { mc: 0, mi: 0, rc: 0, ri: 0, subjectType: 'radical' }),
  ];
  const a = accuracySummary(stats);
  expect(a.kanji.meaning).toBe(90);
  expect(a.kanji.reading).toBe(80);
  expect(a.vocabulary.reading).toBe(50);
  expect(a.radical.meaning).toBe(null);   // no attempts → null, not 0
  expect(a.total.overall).toBe(80);       // 32 right of 40
});

/* ---- slimmers ------------------------------------------------------------------ */

test('slimSubject keeps the study surface, picks one mp3, folds kana_vocabulary', () => {
  const raw = {
    id: 3757, object: 'vocabulary',
    data: {
      level: 22, slug: '建築', characters: '建築', document_url: 'https://www.wanikani.com/vocabulary/建築',
      meanings: [{ meaning: 'Architecture', primary: true }, { meaning: 'Construction', primary: false }],
      auxiliary_meanings: [{ meaning: 'Building', type: 'whitelist' }, { meaning: 'Architect', type: 'blacklist' }],
      readings: [{ reading: 'けんちく', primary: true, accepted_answer: true }],
      parts_of_speech: ['noun'], component_subject_ids: [946, 957], amalgamation_subject_ids: [],
      meaning_mnemonic: 'mm', reading_mnemonic: 'rm',
      context_sentences: [{ ja: 'JA', en: 'EN' }],
      pronunciation_audios: [
        { url: 'u.ogg', content_type: 'audio/ogg' },
        { url: 'u.mp3', content_type: 'audio/mpeg' },
      ],
      hidden_at: null,
    },
  };
  const s = slimSubject(raw);
  expect(s).toMatchObject({
    id: 3757, type: 'vocabulary', level: 22, chars: '建築', audio: 'u.mp3',
    componentIds: [946, 957], auxMeanings: ['Building'],
  });
  expect(s.meanings[0]).toEqual({ m: 'Architecture', primary: true });
  expect(s.hidden).toBe(false);

  const kana = slimSubject({ id: 1, object: 'kana_vocabulary', data: { level: 1, slug: 'x', characters: 'それ', meanings: [], readings: [] } });
  expect(kana.type).toBe('vocabulary');
  expect(kana.kana).toBe(true);

  const radical = slimSubject({
    id: 2, object: 'radical',
    data: { level: 1, slug: 'gun', characters: null, meanings: [], character_images: [{ url: 'r.svg', content_type: 'image/svg+xml' }] },
  });
  expect(radical.chars).toBe(null);
  expect(radical.imageUrl).toBe('r.svg');
});

test('slimAssignment/slimStat parse timestamps to epoch ms and normalize types', () => {
  const a = slimAssignment({ id: 1, data: { subject_id: 5, subject_type: 'kana_vocabulary', srs_stage: 4, available_at: '2026-07-01T13:00:00Z', started_at: '2026-06-01T00:00:00Z', unlocked_at: null, passed_at: null, burned_at: null, hidden: false } });
  expect(a.type).toBe('vocabulary');
  expect(a.availableAt).toBe(Date.parse('2026-07-01T13:00:00Z'));
  expect(a.unlockedAt).toBe(null);
  const st = slimStat({ id: 2, data: { subject_id: 5, subject_type: 'kanji', meaning_correct: 1, meaning_incorrect: 2, reading_correct: 3, reading_incorrect: 4, meaning_current_streak: 5, meaning_max_streak: 6, reading_current_streak: 7, reading_max_streak: 8, percentage_correct: 40, hidden: false } });
  expect(st).toMatchObject({ subjectId: 5, meaningIncorrect: 2, readingCurrentStreak: 7, percentCorrect: 40 });
});

/* ---- render helpers -------------------------------------------------------------- */

test('renderWkMarkup escapes HTML then styles only the known WK tags', () => {
  const html = renderWkMarkup('Use <kanji>build</kanji> with <script>alert(1)</script>\n\nNext.');
  expect(html).toContain('<span class="wkm wkm-kanji">build</span>');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).toContain('<br><br>');
  expect(wkEscape('a<b>&"\'')).toBe('a&lt;b&gt;&amp;&quot;&#39;');
});

test('primary pickers + search + timeUntil', () => {
  const s = subj(1, 'vocabulary', '建築', { meanings: [{ m: 'Second', primary: false }, { m: 'Architecture', primary: true }], readings: [{ r: 'けんちく', primary: true }] });
  expect(primaryMeaning(s)).toBe('Architecture');
  expect(primaryReading(s)).toBe('けんちく');
  expect(subjectMatches(s, '建')).toBe(true);
  expect(subjectMatches(s, 'archi')).toBe(true);
  expect(subjectMatches(s, 'けんち')).toBe(true);
  expect(subjectMatches(s, 'zzz')).toBe(false);
  expect(timeUntil(NOW - 1, NOW)).toBe('now');
  expect(timeUntil(NOW + 25 * 60e3, NOW)).toBe('in 25m');
  expect(timeUntil(NOW + 5 * H, NOW)).toBe('in 5h');
  expect(timeUntil(NOW + 3 * D, NOW)).toBe('in 3d');
  expect(timeUntil(null, NOW)).toBe('—');
});

/* ---- deck activation (wk-leech-to-deck) ------------------------------------ */

test('wkPosTraits maps WK parts_of_speech onto the deck taxonomy', () => {
  expect(wkPosTraits(['transitive verb', 'godan verb'])).toEqual({ cat: 'verb', type: 'godan', trans: 't' });
  expect(wkPosTraits(['intransitive verb', 'ichidan verb'])).toEqual({ cat: 'verb', type: 'ichidan', trans: 'i' });
  expect(wkPosTraits(['する verb'])).toEqual({ cat: 'verb', type: '', trans: '' });
  // 'adverb' must never read as a verb (the ' verb' suffix scan needs the space)
  expect(wkPosTraits(['adverb'])).toEqual({ cat: 'adverb', type: '', trans: '' });
  expect(wkPosTraits(['い adjective'])).toEqual({ cat: 'adjective', type: 'i-adj', trans: '' });
  expect(wkPosTraits(['な adjective', 'noun'])).toEqual({ cat: 'adjective', type: 'na-adj', trans: '' });
  expect(wkPosTraits(['expression'])).toEqual({ cat: 'phrase', type: '', trans: '' });
  expect(wkPosTraits(['noun'])).toEqual({ cat: 'noun', type: '', trans: '' });
  expect(wkPosTraits(['proper noun'])).toEqual({ cat: 'noun', type: '', trans: '' });
  expect(wkPosTraits([])).toEqual({ cat: 'noun', type: '', trans: '' });
  // a both-ways verb claims neither transitivity
  expect(wkPosTraits(['transitive verb', 'intransitive verb', 'godan verb']).trans).toBe('');
});

test('buildWkCard builds a tagged Source:鰐蟹 custom card from a vocab subject', () => {
  const s = subj(21, 'vocabulary', '変える', {
    level: 19,
    pos: ['transitive verb', 'ichidan verb'],
    meanings: [{ m: 'To Change Something', primary: true }, { m: 'To Alter', primary: false }],
    readings: [{ r: 'かえる', primary: true, accepted: true }],
    meaningMnemonic: 'You <kanji>change</kanji> it.',
    readingMnemonic: 'Read as <reading>かえる</reading>.',
    contextSentences: [{ ja: '色を変える。', en: 'Change the color.' }],
    docUrl: 'https://www.wanikani.com/vocabulary/変える',
  });
  const c = buildWkCard(s, 123);
  expect(c.rank).toBe(123);
  expect(c.jp).toBe('変える');
  expect(c.read).toBe('かえる');
  expect(c.mean).toBe('To Change Something, To Alter');
  expect(c.cat).toBe('verb'); expect(c.type).toBe('ichidan'); expect(c.trans).toBe('t');
  expect(c.tags).toEqual(['鰐蟹', 'wk-l19']);
  expect(c.wanikani).toBe(true); expect(c.wkId).toBe(21); expect(c.custom).toBe(true);
  // mnem/tip are innerHTML'd downstream — WK markup pre-rendered, never raw
  expect(c.mnem).toContain('<span class="wkm wkm-kanji">change</span>');
  expect(c.tip).toContain('wkm-reading');
  expect(c.tip).toContain('WaniKani level 19');
  expect(c.tip).toContain('wanikani.com');
  expect(c.ex).toEqual([['色を変える。', 'Change the color.']]);
  expect(c.jlpt).toBe('');
});

test('buildWkCard: kana vocab falls back to chars for the reading; hostile text stays escaped', () => {
  const kana = subj(31, 'vocabulary', 'ばら', { level: 22, pos: ['noun'], readings: [] });
  expect(buildWkCard(kana, 1).read).toBe('ばら');
  const hostile = subj(32, 'vocabulary', '毒', {
    level: 5, pos: ['noun'],
    meaningMnemonic: '<script>alert(1)</script> poison',
    contextSentences: [{ ja: '<img onerror=x>毒です。', en: 'It is poison.' }],
  });
  const c = buildWkCard(hostile, 2);
  expect(c.mnem).not.toContain('<script>');
  expect(c.ex[0][0]).not.toContain('<img');
  expect(c.ex[0][0]).toContain('&lt;img');
});
