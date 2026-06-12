// Pure helpers for the 独り言 Self-Talk tab (output/speaking practice). DOM-free so the test
// imports them directly; the DOM/render glue lives in features/selftalk.js, and the built-in
// content + scene/grammar metadata in data/selftalk.js.
//
// Self-Talk is OUTPUT reps, not recognition — there's no SRS box/schedule here. The only persisted
// signal is a lightweight day streak + which phrases were said today (the `practice` record below).

import { plainText, rubyToSegments, segmentsToRuby, segmentsToReading } from './text.js';

// Convert a UI phrase ({id, jp, read?, mean, scene, grammar}) into the sentence-store create/update
// body ({id, text, furigana, translations, tags, link}). text + furigana come from `jp`; when `jp`
// carries no ruby (the derived reading would just echo the kanji) but a `read` is supplied, the whole
// line is encoded as ONE ruby segment so the store can still derive the kana back. Pure — shared by
// the authoring write and the one-time legacy-blob → store migration so they build identical bodies.
export function phraseToSentence(phrase) {
  const jp = (phrase && phrase.jp) || '';
  const text = plainText(jp);
  let furigana = rubyToSegments(jp);
  const read = phrase && phrase.read ? String(phrase.read).trim() : '';
  if (read && segmentsToReading(furigana) === text && read !== text) {
    furigana = [{ t: text, r: read }];
  }
  return {
    id: phrase && phrase.id,
    text,
    furigana,
    translations: { en: (phrase && phrase.mean) || '' },
    tags: { scene: (phrase && phrase.scene) || '', grammar: Array.isArray(phrase && phrase.grammar) ? phrase.grammar : [] },
    link: { owner_type: 'selftalk' },
  };
}

// Adapt a store sentence (from GET /v1/sentences) to the phrase shape the Self-Talk UI renders.
// The store keeps furigana as structured segments; the UI wants the `<ruby>` jp + the derived
// kana `read`. `custom` marks a user-authored (private) row → the "yours" badge + edit control.
// Pure (DOM-free) so the render code downstream is unchanged.
export function sentenceToPhrase(s) {
  const fur = (s && s.furigana) || [];
  const tags = (s && s.tags) || {};
  const grammar = Array.isArray(tags.grammar) ? tags.grammar : tags.grammar ? [tags.grammar] : [];
  return {
    id: s && s.id,
    jp: segmentsToRuby(fur),
    read: segmentsToReading(fur),
    mean: (s && s.translations && s.translations.en) || '',
    scene: tags.scene || '',
    grammar,
    custom: !!(s && s.custom),
  };
}

// A small deterministic string hash (FNV-1a, 32-bit). Seeds the daily rotation so "today's set" is
// stable within a day and rotates across days, with no Date.now()/Math.random() (both unavailable
// here and non-deterministic for the test).
export function hashStr(s) {
  let h = 0x811c9dc5;
  const str = String(s == null ? '' : s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// Group phrases by scene in the given scene order (skipping scenes with no phrases). Returns
// [{ scene, items }]. With no/empty sceneOrder, falls back to first-seen order. Pure (read-only).
export function groupByScene(phrases, sceneOrder) {
  const list = phrases || [];
  const order = Array.isArray(sceneOrder) && sceneOrder.length
    ? sceneOrder
    : [...new Set(list.map((p) => p.scene))];
  return order
    .map((scene) => ({ scene, items: list.filter((p) => p.scene === scene) }))
    .filter((g) => g.items.length);
}

// The distinct grammar tokens present across `phrases`, in `grammarOrder` first, then any extras
// alphabetically. Drives the grammar-tier filter chips. Pure.
export function grammarTokens(phrases, grammarOrder) {
  const present = new Set();
  for (const p of phrases || []) for (const g of (p.grammar || [])) present.add(g);
  const ordered = (grammarOrder || []).filter((g) => present.has(g));
  const extras = [...present].filter((g) => !ordered.includes(g)).sort();
  return ordered.concat(extras);
}

// A deterministic "today's set" of up to `n` phrase ids, rotating by `dayKey` (a YYYY-MM-DD string
// from localDay()). Stable within a day, (re)shuffled across days: sort ids by a per-(id, day)
// hash, take the first n. n null/undefined → all ids (still day-shuffled). Pure.
export function todaysSet(phrases, dayKey, n) {
  const ids = (phrases || []).map((p) => p.id);
  const seed = String(dayKey || '');
  const take = n == null ? ids.length : Math.max(0, n);
  return ids
    .map((id) => ({ id, h: hashStr(seed + '|' + id) }))
    .sort((a, b) => a.h - b.h || (a.id < b.id ? -1 : 1))
    .slice(0, take)
    .map((x) => x.id);
}

// ---- practice signal (a lightweight "practiced today" + day streak; NOT SRS) ----
// `practice` shape: { lastDay:'YYYY-MM-DD'|null, streak:int, doneToday:[id…] }.

// Default empty practice record.
export function emptyPractice() { return { lastDay: null, streak: 0, doneToday: [] }; }

// Whole-day difference between two YYYY-MM-DD keys (b − a), or null if either is missing/invalid.
// Parsed as UTC midnights so DST shifts can't perturb the day count.
export function dayDiff(a, b) {
  if (!a || !b) return null;
  const pa = Date.parse(a + 'T00:00:00Z'), pb = Date.parse(b + 'T00:00:00Z');
  if (isNaN(pa) || isNaN(pb)) return null;
  return Math.round((pb - pa) / 86400000);
}

// Record that `phraseId` was practiced on `dayKey`. Returns a NEW practice object:
//   - same day as lastDay → add the id to doneToday (deduped), streak unchanged;
//   - a new day          → streak +1 if lastDay was exactly yesterday, else reset to 1; doneToday=[id].
export function applyPractice(practice, phraseId, dayKey) {
  const p = practice && typeof practice === 'object' ? practice : emptyPractice();
  const lastDay = p.lastDay || null, streak = p.streak || 0;
  const done = Array.isArray(p.doneToday) ? p.doneToday : [];
  if (lastDay === dayKey) {
    return { lastDay, streak: streak || 1, doneToday: done.includes(phraseId) ? done.slice() : done.concat(phraseId) };
  }
  return { lastDay: dayKey, streak: dayDiff(lastDay, dayKey) === 1 ? streak + 1 : 1, doneToday: [phraseId] };
}

// The streak to DISPLAY given today's `dayKey`: the stored streak is "alive" if you practiced today
// or yesterday; if a whole day was missed it reads 0 (broken). Pure — doesn't mutate.
export function practiceStreak(practice, dayKey) {
  const p = practice || {};
  if (!p.lastDay || !p.streak) return 0;
  if (p.lastDay === dayKey) return p.streak;
  return dayDiff(p.lastDay, dayKey) === 1 ? p.streak : 0;   // practiced yesterday → still alive; older → broken
}

// The set of phrase ids practiced TODAY (empty unless lastDay === dayKey) — for the per-phrase ✓.
export function donePhraseIds(practice, dayKey) {
  const p = practice || {};
  return new Set(p.lastDay === dayKey && Array.isArray(p.doneToday) ? p.doneToday : []);
}
