#!/usr/bin/env node
// Build the generated N3 grammar MCQ bank (wave-2 文法形式判断 drills): validate
// tools/grammar-n3/mcq/<id>.json and emit src/data/grammar-n3-mcq.js. Fix content in the per-point
// JSON, never in the generated file.
//
//   node tools/grammar-n3/build-mcq.mjs
//
// WHY A SIBLING CHUNK, not an `mcq` field on grammar-n3.js: the cloze catalog is loaded for every
// grammar card (the flashcard branch, Browse detail, the coverage lens); the MCQ bank is only needed
// when the user actually opens the drill. Keeping it a separate lazy chunk means the banks cost the
// normal study path nothing, and the cloze catalog's invariants stay untouched as the banks grow.
//
// Banks key on the DURABLE point ids in points.json — never rename a shipped id (see build.mjs).
// A bank may exist for only some points; the drill offers whatever is present.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plainText, isCleanRuby } from '../../src/core/text.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../src/data/grammar-n3-mcq.js');

// The blank the learner fills. Kept in sync with MCQ_GAP in src/core/grammar-mcq.js — the renderer
// splits the stem on it, so a mismatch would render the gap as literal text.
const GAP = '＿＿＿';
const CHOICES_PER_Q = 4;   // the exam always offers four

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const points = JSON.parse(readFileSync(join(HERE, 'points.json'), 'utf8'));
const pointById = new Map(points.map((p) => [p.id, p]));

// The pattern a point's correct answer should contain, e.g. 〜に対して → 「に対して」. Labels carrying
// a parenthetical gloss or a slash alternative ("〜ように (purpose)", "〜といい／〜たらいい") have no
// single span to check, so they opt out of the answer-contains-the-pattern warning.
function labelCore(label) {
  const core = String(label || '').replace(/[〜～]/g, '').trim();
  return /[（(／/\s]/.test(core) ? null : core;
}

// A CONJUGATION-TOLERANT stem of the pattern, for the "is this filed under the right id?" check.
// Real answers are inflected — the 〜ようになる bank's answer is ようになった, and 〜に対して appears as
// に対して — so a literal `includes(core)` false-positives on every well-formed bank. Trimming the
// pattern's own inflecting tail (する/なる wholesale, else one trailing kana) leaves a span every
// inflection keeps. Deliberately loose: this only WARNS, and the exact-`core` duplicate check below
// is what catches a genuinely mis-keyed answer.
function answerStem(core) {
  if (core.length >= 4 && (core.endsWith('する') || core.endsWith('なる'))) return core.slice(0, -2);
  return core.length >= 3 ? core.slice(0, -1) : core;
}

const mcqDir = join(HERE, 'mcq');
const files = existsSync(mcqDir) ? readdirSync(mcqDir).filter((f) => f.endsWith('.json')) : [];
const bankById = new Map();

for (const f of files) {
  const c = JSON.parse(readFileSync(join(mcqDir, f), 'utf8'));
  const where = `mcq/${f}`;
  if (!c.id || !pointById.has(c.id)) { err(`${where}: id "${c.id}" not in points.json`); continue; }
  if (f !== `${c.id}.json`) err(`${where}: filename must match id "${c.id}"`);
  if (bankById.has(c.id)) err(`${where}: duplicate bank for "${c.id}"`);

  const qs = c.questions;
  if (!Array.isArray(qs) || qs.length < 1 || qs.length > 6) {
    err(`${where}: need 1–6 questions (got ${Array.isArray(qs) ? qs.length : typeof qs})`);
    continue;
  }

  const core = labelCore(pointById.get(c.id).label);
  for (const [i, q] of qs.entries()) {
    const at = `${where} question ${i + 1}`;
    if (typeof q.stem !== 'string' || !q.stem) { err(`${at}: missing stem`); continue; }
    if (!isCleanRuby(q.stem)) err(`${at}: stem is not clean ruby (only well-formed <ruby>x<rt>y</rt></ruby> allowed)`);

    const gaps = q.stem.split(GAP).length - 1;
    if (gaps !== 1) err(`${at}: stem must contain the gap "${GAP}" exactly once (found ${gaps})`);

    if (!Array.isArray(q.choices) || q.choices.length !== CHOICES_PER_Q) {
      err(`${at}: need exactly ${CHOICES_PER_Q} choices (got ${Array.isArray(q.choices) ? q.choices.length : typeof q.choices})`);
      continue;
    }
    if (q.choices.some((ch) => typeof ch !== 'string' || !ch.trim())) err(`${at}: every choice must be a non-empty string`);
    // Choices render as plain text inside a button — markup there would be injected, not escaped.
    if (q.choices.some((ch) => /[<>]/.test(ch))) err(`${at}: choices must be plain text (no ruby/markup)`);
    if (new Set(q.choices).size !== q.choices.length) err(`${at}: choices must be distinct — a duplicate makes two options correct`);

    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= CHOICES_PER_Q) {
      err(`${at}: answer must be an index 0..${CHOICES_PER_Q - 1}`);
      continue;
    }
    if (typeof q.why !== 'string' || q.why.trim().length < 20) err(`${at}: "why" missing or too short (< 20 chars) — the explanation IS the teaching`);

    // The answer should actually be this point's pattern (inflected as the sentence needs);
    // otherwise the bank is filed under the wrong id and the per-point lens credits the wrong thing.
    if (core && !q.choices[q.answer].includes(answerStem(core))) {
      warn(`${at}: correct choice "${q.choices[q.answer]}" doesn't look like the point's pattern "${core}" — filed under the right id?`);
    }
    // A distractor carrying the point's own pattern is usually a mis-keyed answer.
    if (core && q.choices.some((ch, j) => j !== q.answer && ch.includes(core))) {
      warn(`${at}: a distractor also contains "${core}" — two plausibly-correct options?`);
    }
    // The filled sentence must read as one string; a stray gap in a choice would nest.
    if (q.choices.some((ch) => ch.includes(GAP))) err(`${at}: a choice contains the gap token`);
  }
  bankById.set(c.id, qs.map((q) => ({ stem: q.stem, choices: q.choices, answer: q.answer, why: q.why.trim() })));
}

for (const w of warnings) console.warn(`warn: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`\n${errors.length} error(s) — src/data/grammar-n3-mcq.js NOT written.`);
  process.exit(1);
}

// Emit in points.json order so the drill's default question order follows the syllabus.
const bank = {};
for (const p of points) if (bankById.has(p.id)) bank[p.id] = bankById.get(p.id);

const nPoints = Object.keys(bank).length;
const nQuestions = Object.values(bank).reduce((n, qs) => n + qs.length, 0);

const header = `// GENERATED by tools/grammar-n3/build-mcq.mjs — do not hand-edit.
// Source of truth: tools/grammar-n3/mcq/<id>.json (LLM-drafted, human-proofread), keyed on the
// durable point ids in tools/grammar-n3/points.json.
// Regenerate: node tools/grammar-n3/build-mcq.mjs
// The wave-2 文法形式判断 (fill-the-blank) bank. A SIBLING chunk to grammar-n3.js, lazily imported
// only when the drill opens (features/grammar/data.js ensureGrammarMcq) — the cloze catalog is on
// the hot path for every grammar card, this is not.
// Shape: { <pointId>: [{ stem (clean ruby, one ＿＿＿ gap), choices[4], answer (index), why }] }
// ${nPoints}/${points.length} points have an MCQ bank (${nQuestions} questions).
`;

writeFileSync(OUT, `${header}export const GRAMMAR_N3_MCQ = ${JSON.stringify(bank, null, 2)};\n`);
console.log(`wrote src/data/grammar-n3-mcq.js: ${nPoints}/${points.length} points (${nQuestions} questions)`);
const missing = points.filter((p) => !bankById.has(p.id)).length;
if (missing) console.log(`no bank yet (${missing}): the drill offers only the ${nPoints} point(s) above`);
