// N3 grammar system — PURE, DOM-free derivations over the generated grammar catalog
// (data/grammar-n3.js) + the deck/SRS state. Everything takes plain data in (points array,
// DATA, cards map, dayStartMs injected — never Date.now()) so the module is unit-testable
// (test/grammar-core.test.js). The lazy-loading singleton around the catalog chunk lives in
// features/grammar/data.js; this module never imports the data.
//
// A grammar POINT becomes an ordinary custom card (cat:'grammar', the sixth category) carrying
// only the display snapshot {jp: label, read, mean} + the durable `grammarId`; the heavy content
// (explanation/formation/examples) always renders by grammarId lookup into the loaded catalog,
// so a content fix reaches existing cards without re-activation. Wave-2 MCQ banks key on the
// same ids — never rename a shipped id (tools/grammar-n3/points.json is the registry).

import { escapeHtml, plainText } from './text.js';

// The tagged custom-card object for a grammar point (the songs/WK activation shape). Pure:
// the caller assigns the monotonic `rank`. No embedded content beyond the snapshot — see above.
export function buildGrammarCard(p, rank) {
  return {
    rank,
    jp: p.label,
    read: p.read,
    mean: p.mean,
    cat: 'grammar', type: '', trans: '',
    jlpt: p.jlpt || 'N3',
    tags: ['文法'],
    grammar: true,
    grammarId: p.id,
    mnem: '', tip: '', ex: [], accent: null, levels: null, custom: true,
  };
}

// Deterministic example rotation: attempt n (the card's attempts.length) → example index, so
// prompt and answer agree within one render and each review shows the next sentence.
export function pickGrammarExample(examples, n) {
  const len = (examples || []).length;
  if (!len) return null;
  return examples[((n % len) + len) % len];
}

// The cloze blank spec for an example: [{start, end, surface}] with UTF-16 offsets into
// plainText(jp) — the shape core/songs.js clozeLineParts consumes. The build validator
// guarantees blank ∈ plainText for shipped content; a stale/foreign example fails soft to []
// (= no cloze; the caller renders the sentence un-blanked rather than breaking the card).
export function grammarBlank(example) {
  const blank = example && example.blank;
  if (!blank) return [];
  const start = plainText(example.jp || '').indexOf(blank);
  if (start < 0) return [];
  return [{ start, end: start + blank.length, surface: blank }];
}

// Render clozeLineParts output to HTML. mode 'gap' (prompt face): each blank is an opaque
// ＿-run whose width only loosely tracks the answer (2–6 chars, so length isn't a giveaway).
// mode 'reveal' (answer face): the blank text returns, marked. Text is escaped; ruby segments
// re-wrap so the global data-furigana flip keeps working.
export function clozePartsToHtml(parts, mode) {
  return (parts || []).map((p) => {
    if (p.type === 'ruby') return `<ruby>${escapeHtml(p.t)}<rt>${escapeHtml(p.r)}</rt></ruby>`;
    if (p.type === 'text') return escapeHtml(p.t);
    if (mode === 'reveal') return `<mark class="gp-hit">${escapeHtml(p.surface || '')}</mark>`;
    const width = Math.max(2, Math.min(6, (p.surface || '').length));
    return `<span class="cloze-gap" role="img" aria-label="blank">${'＿'.repeat(width)}</span>`;
  }).join('');
}

// The grammarIds already activated into the deck — the idempotent-activation dedup index
// (songs/WK skip style, deliberately NOT Minna overlays).
export function grammarDeckIndex(data) {
  const s = new Set();
  for (const v of data || []) if (v && v.grammar && v.grammarId) s.add(v.grammarId);
  return s;
}

// Catalog-wide study status: per point new (not in deck) / added (box 0) / learning (box 1–3) /
// solid (box ≥ 4), plus the aggregate counts the JLPT-tab lens and the pacing coach read
// (pacePlan takes {studied: inDeck, total}).
export function grammarCoverage(points, data, cards) {
  const rankById = new Map();
  for (const v of data || []) if (v && v.grammar && v.grammarId) rankById.set(v.grammarId, v.rank);
  let inDeck = 0, learning = 0, solid = 0;
  const rows = (points || []).map((p) => {
    const rank = rankById.get(p.id);
    let status = 'new';
    if (rank != null) {
      inDeck++;
      const box = (((cards || {})[rank]) || {}).box || 0;
      if (box >= 4) { status = 'solid'; solid++; }
      else if (box >= 1) { status = 'learning'; learning++; }
      else status = 'added';
    }
    return { id: p.id, rank, status };
  });
  return { total: (points || []).length, inDeck, learning, solid, points: rows };
}

// The 法 checklist row's live signal: was ANY grammar card graded since local midnight?
// Reads the `last` grade-stamp cardStat gained for exactly this (merged with max on 409).
export function grammarReviewedToday(data, cards, dayStartMs) {
  for (const v of data || []) {
    if (!v || !v.grammar) continue;
    const c = (cards || {})[v.rank];
    if (c && (c.last || 0) >= dayStartMs) return true;
  }
  return false;
}
