// Pure helpers for the 独り言 Self-Talk tab (output/speaking practice). DOM-free so the test
// imports them directly; the DOM/render glue lives in features/selftalk.js, and the built-in
// content + scene/grammar metadata in data/selftalk.js.
//
// Self-Talk is OUTPUT reps, not recognition — there's no SRS box/schedule here. The only persisted
// signal is a lightweight day streak + which phrases were said today (the `practice` record below).

import { plainText, rubyToSegments, segmentsToRuby, segmentsToReading } from './text.js';

// Convert a UI phrase ({id, jp, read?, mean, topic, grammar}) into the sentence-store create/update
// body ({id, text, furigana, translations, tags, link}). text + furigana come from `jp`; when `jp`
// carries no ruby (the derived reading would just echo the kanji) but a `read` is supplied, the whole
// line is encoded as ONE ruby segment so the store can still derive the kana back. The topic is
// written as a sentence_tag(kind='topic'); a legacy-blob phrase still carrying `.scene` is read as a
// fallback so the one-time migration tags it correctly. Pure — shared by the authoring write and
// that legacy-blob → store migration so they build identical bodies.
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
    tags: { topic: (phrase && (phrase.topic ?? phrase.scene)) || '', grammar: Array.isArray(phrase && phrase.grammar) ? phrase.grammar : [], ...(phrase && phrase.thought ? { thought: phrase.thought } : {}) },
    link: { owner_type: 'selftalk' },
  };
}

// Adapt a store sentence (from GET /v1/sentences) to the phrase shape the Self-Talk UI renders.
// The store keeps furigana as structured segments; the UI wants the `<ruby>` jp + the derived
// kana `read`. `custom` marks a user-authored (private) row → the "yours" badge + edit control.
// `furigana` (the raw segments) + `tokens` (GiNZA, only when fetched with ?annotate=1; null on
// user-authored rows the offline batch never parsed) ride along for the Phase-4 tap-to-lookup
// overlay; the render falls back to plain ruby when tokens are absent. `topic` reads the
// sentence_tag(kind='topic'), falling back to the legacy `scene` tag so rows authored before the
// grid (and not yet re-seeded/re-saved) still land under their topic. Pure (DOM-free).
export function sentenceToPhrase(s) {
  const fur = (s && s.furigana) || [];
  const tags = (s && s.tags) || {};
  const grammar = Array.isArray(tags.grammar) ? tags.grammar : tags.grammar ? [tags.grammar] : [];
  return {
    id: s && s.id,
    jp: segmentsToRuby(fur),
    read: segmentsToReading(fur),
    mean: (s && s.translations && s.translations.en) || '',
    topic: (tags.topic ?? tags.scene) || '',
    ...(tags.thought ? { thought: tags.thought } : {}),   // optional sub-cluster within the topic
    grammar,
    custom: !!(s && s.custom),
    furigana: Array.isArray(fur) ? fur : [],
    tokens: s && s.annotation && Array.isArray(s.annotation.tokens) ? s.annotation.tokens : null,
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

// Group phrases by topic in the given topic order (skipping topics with no phrases). Returns
// [{ topic, items }]. With no/empty topicOrder, falls back to first-seen order. Pure (read-only).
export function groupByTopic(phrases, topicOrder) {
  const list = phrases || [];
  const order = Array.isArray(topicOrder) && topicOrder.length
    ? topicOrder
    : [...new Set(list.map((p) => p.topic))];
  return order
    .map((topic) => ({ topic, items: list.filter((p) => p.topic === topic) }))
    .filter((g) => g.items.length);
}

// Build the category→topic grid model the Self-Talk grid renders. For each registered category,
// keep its topics that have ≥1 phrase, each annotated with { count, done } (done = how many of that
// topic's phrases are in `doneSet`, today's practiced ids); drop empty topics, then empty categories.
// Any phrase whose `topic` isn't registered anywhere is folded into a trailing { id:'__other__' }
// category (one cell per stray topic value) so content can never silently vanish. `taxonomy` is
// passed in (= SELFTALK_TAXONOMY) to keep this DOM-free + data-free. Pure (read-only).
export function topicGrid(phrases, taxonomy, doneSet) {
  const done = doneSet instanceof Set ? doneSet : new Set(doneSet || []);
  const tally = new Map();   // topicId -> { count, done }
  for (const p of phrases || []) {
    const t = tally.get(p.topic) || { count: 0, done: 0 };
    t.count++; if (done.has(p.id)) t.done++;
    tally.set(p.topic, t);
  }
  const seen = new Set();
  const cats = (taxonomy || []).map((c) => {
    const topics = (c.topics || []).map((t) => {
      seen.add(t.id);
      const v = tally.get(t.id);
      return v ? { ...t, count: v.count, done: v.done } : null;
    }).filter(Boolean);
    return topics.length ? { id: c.id, label: c.label, jp: c.jp, icon: c.icon, topics } : null;
  }).filter(Boolean);
  const orphans = [...tally.keys()].filter((id) => !seen.has(id));
  if (orphans.length) {
    cats.push({
      id: '__other__', label: 'Other', jp: '', icon: null,
      topics: orphans.map((id) => ({ id, label: id || '—', jp: '', count: tally.get(id).count, done: tally.get(id).done })),
    });
  }
  return cats;
}

// Group a topic's phrases into "sentence thoughts" — labeled sub-clusters within the topic — using
// the topic's `thoughts` registry ([{id,label}]). Clusters come in registry order; any phrase with
// no registered thought collects into a trailing LABEL-LESS group (id/label null), so grouped and
// loose lines coexist. A topic with no thoughts → a single label-less group, i.e. the topic view
// renders flat (backward-compatible with every flat topic). Pure (read-only).
export function groupByThought(phrases, thoughtsOrder) {
  const list = phrases || [];
  const order = Array.isArray(thoughtsOrder) ? thoughtsOrder : [];
  const groups = order
    .map((t) => ({ id: t.id, label: t.label, items: list.filter((p) => p.thought === t.id) }))
    .filter((g) => g.items.length);
  const claimed = new Set(order.map((t) => t.id));
  const loose = list.filter((p) => !p.thought || !claimed.has(p.thought));
  if (loose.length) groups.push({ id: null, label: null, items: loose });
  return groups;
}

// ---- slot-swap templates (P3) — pure realization ----
// A template is a JP skeleton string with `{slot}` markers + a `slots:[{id,fillers:[{jp,en}]}]`
// array; it has NO single fixed text, so it lives client-side (data/selftalk-templates.js), never in
// the sentence store. Realizing it for a set of picks reuses the SAME furigana helpers a phrase does,
// so a realized template is shaped exactly like one.

// The (clamped, default-0) filler index chosen for a slot.
export function templatePickIndex(slot, picks) {
  const n = ((slot && slot.fillers) || []).length;
  const i = (picks && picks[slot && slot.id]) || 0;
  return n ? Math.max(0, Math.min(n - 1, i)) : 0;
}

// Realize a template for `picks` (slotId → filler index; missing/out-of-range → 0): substitute each
// {slotId} marker in the skeleton `jp`/`en` with the chosen filler, then DERIVE reading + plainText
// from the now-fully-ruby jp. `text` (the plainText) is the /v1/audio/tts key AND the record-compare
// reference text. Returns { jp, read, mean, text }. Pure.
export function realizeTemplate(tpl, picks) {
  const slots = (tpl && tpl.slots) || [];
  const fill = (id, get) => {
    const s = slots.find((x) => x.id === id);
    if (!s) return '';
    return get((s.fillers || [])[templatePickIndex(s, picks)] || {}) || '';
  };
  const jp = String((tpl && tpl.jp) || '').replace(/\{(\w+)\}/g, (_, id) => fill(id, (f) => f.jp));
  const mean = String((tpl && tpl.en) || '').replace(/\{(\w+)\}/g, (_, id) => fill(id, (f) => f.en));
  const segs = rubyToSegments(jp);
  return { jp, read: segmentsToReading(segs), mean, text: plainText(jp) };
}

// Advance one slot to its next filler (wrapping). Returns a NEW picks object. Pure.
export function cyclePick(tpl, picks, slotId) {
  const slot = ((tpl && tpl.slots) || []).find((s) => s.id === slotId);
  if (!slot || !(slot.fillers || []).length) return { ...(picks || {}) };
  return { ...(picks || {}), [slotId]: (templatePickIndex(slot, picks) + 1) % slot.fillers.length };
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
