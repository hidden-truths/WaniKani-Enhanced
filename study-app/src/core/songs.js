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

// ---- Listen (dictation) ----
// Which content-word tokens to blank for the cloze (easier) difficulty: the line's content words
// (CONTENT_POS — same set songWords/coverage use) in order, capped at `max` (default 4) so a long
// line keeps enough visible context to stay easier than full-line. Returns
// [{ start, end, surface, reading, lemma }] — UTF-16 offsets into the line text (token-aligned per
// the server's offset contract), `reading` (hiragana) is what the typed answer is graded against.
// Pure; `clozeLineParts` consumes the result to render, the Listen grader consumes `reading`.
export function clozeBlanks(line, opts) {
  const max = (opts && opts.max) || 4;
  const out = [];
  for (const t of ((line && line.tokens) || [])) {
    if (!CONTENT_POS.has(t.pos)) continue;
    if (t.start == null || t.end == null) continue;
    out.push({ start: t.start, end: t.end, surface: t.surface, reading: t.reading || '', lemma: t.lemma || t.surface });
    if (out.length >= max) break;
  }
  return out;
}

// The ordered render plan for a cloze line: the line's visible runs (ruby where the furigana has a
// reading, plain text otherwise) interleaved with a gap at each blank token range. Parts are
// { type:'ruby', t, r } | { type:'text', t } | { type:'gap', start, end, surface, reading, lemma }.
// The offset slicing is the tricky bit kept here (and tested): a PLAIN furigana run can contain a
// blank token MID-RUN (e.g. じゃなくて|いい|ね — the いい token sits inside one plain segment), so a
// segment isn't safe to treat as whole; a RUBY segment is always wholly inside one token (the offset
// contract) so it's only ever fully inside or fully outside a blank. `blanks` from clozeBlanks.
export function clozeLineParts(line, blanks) {
  const segs = (line && line.furigana && line.furigana.length) ? line.furigana : [{ t: (line && line.text) || '' }];
  const bl = [...(blanks || [])].sort((a, b) => a.start - b.start);
  const gapAt = (pos) => bl.find((x) => pos >= x.start && pos < x.end);   // the blank covering offset `pos`, if any
  const gapPart = (b) => ({ type: 'gap', start: b.start, end: b.end, surface: b.surface, reading: b.reading, lemma: b.lemma });
  const parts = [];
  let offset = 0;
  // Walk a plain run [a, a+str.length), slicing it into text parts and gaps at blank boundaries.
  const emitPlain = (str, a) => {
    const end = a + str.length;
    let pos = a;
    while (pos < end) {
      const blk = gapAt(pos);
      if (blk) {                                              // inside a blank → skip its chars; emit the gap once
        if (pos === blk.start) parts.push(gapPart(blk));
        pos = Math.min(blk.end, end);
      } else {                                                // visible text up to the next blank start (or run end)
        const next = bl.find((x) => x.start > pos);
        const stop = next ? Math.min(next.start, end) : end;
        parts.push({ type: 'text', t: str.slice(pos - a, stop - a) });
        pos = stop;
      }
    }
  };
  for (const seg of segs) {
    const t = seg.t || '';
    const a = offset; offset += t.length;
    if (seg.r != null) {                                      // ruby seg: wholly inside one token
      const blk = gapAt(a);
      if (blk) { if (a === blk.start) parts.push(gapPart(blk)); }   // a multi-seg blank emits its gap on its first seg only
      else parts.push({ type: 'ruby', t, r: seg.r });
    } else {
      emitPlain(t, a);
    }
  }
  return parts;
}
