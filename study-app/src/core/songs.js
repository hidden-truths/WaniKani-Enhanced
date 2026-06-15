// Pure helpers for the 歌 / Songs tab — DOM-free + unit-tested (test/core.test.ts). Coverage,
// JLPT bucketing, the known/new vocab split, YouTube id parsing, and the record-compare itemKey.
// Song CONTENT is server-authoritative (the sentence store); these turn it into what the UI shows.

// UD coarse-POS that count as studiable content words (the rest — particles, auxiliaries,
// punctuation — aren't vocabulary). Mirrors the server's CONTENT_POS so coverage agrees.
const CONTENT_POS = new Set(['NOUN', 'PROPN', 'VERB', 'ADJ', 'ADV']);
export const JLPT_ORDER = ['N5', 'N4', 'N3', 'N2', 'N1'];

// Parse a YouTube video id from a watch / youtu.be / embed / shorts URL (client mirror of the
// server parser — embeds the player + validates the Add form). null if not a YouTube URL.
export function parseYouTubeId(url) {
  let id = null;
  try {
    const u = new URL(String(url).trim());
    const host = u.hostname.replace(/^(www\.|m\.)/, '');
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] || null;
    else if (host === 'youtube.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else { const m = u.pathname.match(/^\/(embed|shorts|v)\/([^/?#]+)/); if (m) id = m[2]; }
    }
  } catch (e) { return null; }
  return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
}

// Distinct content words across a song's NORMALIZED lines (features/songs.js flattens the server's
// AssembledSentence into { text, furigana, en, grammar, tokens, clipStartMs, ordinal }). Each line's
// tokens carry jlpt/gloss. Deduped by lemma, first occurrence wins. Drives the Mine panel + coverage.
export function songWords(lines) {
  const seen = new Map();
  for (const ln of (lines || [])) {
    const toks = (ln && ln.tokens) || [];
    for (const t of toks) {
      if (!CONTENT_POS.has(t.pos)) continue;
      const lemma = t.lemma || t.surface;
      if (!lemma || seen.has(lemma)) continue;
      seen.set(lemma, { lemma, reading: t.reading || '', jlpt: t.jlpt || null, gloss: t.gloss || '', pos: t.pos });
    }
  }
  return [...seen.values()];
}

// The headwords the learner already KNOWS — a deck card sitting in a Leitner box (box>0). Keyed by
// the card's headword (jp) + reading so a token lemma (dictionary form) matches either. Pure: takes
// the progress cards map + the live deck.
export function knownHeadwords(cards, DATA) {
  const known = new Set();
  for (const v of (DATA || [])) {
    const c = cards && cards[v.rank];
    if (c && c.box > 0) { if (v.jp) known.add(v.jp); if (v.read) known.add(v.read); }
  }
  return known;
}

// A word's status for Mine: 'known' (a deck card in a Leitner box), 'added' (in the deck but not yet
// studied — box 0, e.g. just activated), or 'new' (not in the deck → addable). `inDeck` is optional;
// without it the result is just known/new.
export function wordStatus(word, known, inDeck) {
  if (known && known.has(word.lemma)) return 'known';
  if (inDeck && inDeck.has(word.lemma)) return 'added';
  return 'new';
}

// Coverage = known content words / total. `words` is [{lemma,…}] (songWords or the library list).
export function coverage(words, known) {
  const total = (words || []).length;
  if (!total) return { known: 0, total: 0, pct: 0 };
  let k = 0;
  for (const w of words) if (known.has(w.lemma)) k++;
  return { known: k, total, pct: Math.round((k / total) * 100) };
}

// Bucket words by JLPT (N5→N1, then unknown '?'), dropping empty buckets; each word gets a
// known/added/new status. `known` = the Leitner-box set; `inDeck` (optional) = all deck headwords.
export function bucketByJlpt(words, known, inDeck) {
  const order = [...JLPT_ORDER, '?'];
  const buckets = new Map(order.map((l) => [l, []]));
  for (const w of (words || [])) {
    const lvl = JLPT_ORDER.includes(w.jlpt) ? w.jlpt : '?';
    buckets.get(lvl).push({ ...w, status: wordStatus(w, known, inDeck) });
  }
  return order.map((level) => ({ level, words: buckets.get(level) })).filter((b) => b.words.length);
}

// Song JLPT badge: the stored/library level if present, else the hardest word level seen.
export function songLevel(words, fallback) {
  if (fallback) return fallback;
  let max = -1;
  for (const w of (words || [])) { const i = JLPT_ORDER.indexOf(w.jlpt); if (i > max) max = i; }
  return max >= 0 ? JLPT_ORDER[max] : null;
}

// Timing coverage for the library badge: how many of a song's normalized lines carry a clip start.
export function lineTimingState(lines) {
  const total = (lines || []).length;
  let timed = 0;
  for (const ln of (lines || [])) if (ln && ln.clipStartMs != null) timed++;
  return { timed, total };
}

// The record-compare itemKey for a song line (Shadow phase). Stable: "<ext_id>:<ordinal>".
export function songLineKey(extId, ordinal) { return `${extId}:${ordinal}`; }

// Distinct grammar points across a song's lines, each with the line count that uses it. `[{id,
// count}]`, most-used first then by id. Drives the Mine grammar panel + the song-level count.
export function songGrammar(lines) {
  const counts = new Map();
  for (const ln of (lines || [])) {
    for (const g of (ln && ln.grammar) || []) counts.set(g, (counts.get(g) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}
