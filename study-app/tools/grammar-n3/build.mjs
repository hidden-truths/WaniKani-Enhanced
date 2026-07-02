#!/usr/bin/env node
// Build the generated N3 grammar catalog: validate tools/grammar-n3/{points.json, content/*.json}
// and emit src/data/grammar-n3.js. Fix content in the per-point JSON, never in the generated file.
//
//   node tools/grammar-n3/build.mjs
//
// The manifest (points.json) is the human-vetted syllabus + durable id registry (wave-2 MCQ banks
// key on these ids — never rename a shipped id). Only points that HAVE a content file are emitted;
// manifest ids without content are reported so the catalog can grow incrementally.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plainText, isCleanRuby, rubyToSegments } from '../../src/core/text.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../src/data/grammar-n3.js');
const TAGGER_CATALOG = join(HERE, '../../src/data/grammar.json');

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

// ---- manifest ----
const points = JSON.parse(readFileSync(join(HERE, 'points.json'), 'utf8'));
if (!Array.isArray(points) || !points.length) throw new Error('points.json: expected a non-empty array');

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const seen = new Set();
for (const p of points) {
  const where = `points.json ${p && p.id ? p.id : JSON.stringify(p)}`;
  for (const k of ['id', 'label', 'read', 'mean']) {
    if (!p || typeof p[k] !== 'string' || !p[k].trim()) err(`${where}: missing/empty "${k}"`);
  }
  if (!p || !ID_RE.test(p.id)) err(`${where}: id must be kebab-case`);
  if (p && seen.has(p.id)) err(`${where}: duplicate id`);
  if (p) seen.add(p.id);
}

// ---- id cross-check vs the GiNZA tagger catalog (ONE id vocabulary; see CLAUDE.md D3) ----
// An EXACT collision means "this is the same grammar point as an existing tagger id" — that is
// only valid if the point genuinely is the same pattern (then the id is deliberately shared).
// None of the wave-1 N3 points overlap the N5/N4 tagger set, so exact collisions are errors here;
// loosen to an explicit `"sharedWithTagger": true` manifest flag if a real overlap ever appears.
const tagger = existsSync(TAGGER_CATALOG) ? JSON.parse(readFileSync(TAGGER_CATALOG, 'utf8')) : [];
const taggerIds = new Set(tagger.map((g) => g.id));
for (const p of points) {
  if (taggerIds.has(p.id)) err(`id "${p.id}" collides with src/data/grammar.json (${[...taggerIds].find((i) => i === p.id)}) — same point? share deliberately or rename`);
  for (const t of taggerIds) {
    if (p.id !== t && (p.id.startsWith(t + '-') || t.startsWith(p.id + '-'))) {
      warn(`id "${p.id}" is a near-collision with tagger id "${t}" — fine if the points differ (e.g. hazu vs hazu-ga-nai)`);
    }
  }
}

// ---- content files ----
// Offsets of every ruby (reading-carrying) segment within plainText(jp), for the blank-overlap check.
function rubyRanges(jp) {
  const ranges = [];
  let off = 0;
  for (const s of rubyToSegments(jp)) {
    const len = (s.t || '').length;
    if (s.r != null) ranges.push([off, off + len]);
    off += len;
  }
  return ranges;
}

const contentDir = join(HERE, 'content');
const files = existsSync(contentDir) ? readdirSync(contentDir).filter((f) => f.endsWith('.json')) : [];
const contentById = new Map();
for (const f of files) {
  const c = JSON.parse(readFileSync(join(contentDir, f), 'utf8'));
  const where = `content/${f}`;
  if (!c.id || !seen.has(c.id)) { err(`${where}: id "${c.id}" not in points.json`); continue; }
  if (f !== `${c.id}.json`) err(`${where}: filename must match id "${c.id}"`);
  if (contentById.has(c.id)) err(`${where}: duplicate content for "${c.id}"`);
  if (typeof c.explanation !== 'string' || c.explanation.trim().length < 40) err(`${where}: explanation missing or too short (< 40 chars)`);
  if (typeof c.formation !== 'string' || !c.formation.trim()) err(`${where}: missing formation`);
  const ex = c.examples;
  if (!Array.isArray(ex) || ex.length < 3 || ex.length > 5) err(`${where}: need 3–5 examples (got ${Array.isArray(ex) ? ex.length : typeof ex})`);
  for (const [i, e] of (ex || []).entries()) {
    const at = `${where} example ${i + 1}`;
    if (!e.jp || !e.en || !e.blank) { err(`${at}: jp/en/blank all required`); continue; }
    if (!isCleanRuby(e.jp)) err(`${at}: jp is not clean ruby (only well-formed <ruby>x<rt>y</rt></ruby> allowed)`);
    const plain = plainText(e.jp);
    const start = plain.indexOf(e.blank);
    if (start < 0) { err(`${at}: blank "${e.blank}" not found in plain text "${plain}"`); continue; }
    if (plain.indexOf(e.blank, start + 1) >= 0) warn(`${at}: blank "${e.blank}" occurs more than once — first occurrence will be clozed`);
    const end = start + e.blank.length;
    if (rubyRanges(e.jp).some(([a, b]) => start < b && end > a)) {
      warn(`${at}: blank intersects a ruby segment — the cloze will swallow the furigana; prefer a kana-only span`);
    }
  }
  contentById.set(c.id, c);
}

// ---- report + emit ----
for (const w of warnings) console.warn(`warn: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`\n${errors.length} error(s) — src/data/grammar-n3.js NOT written.`);
  process.exit(1);
}

const emitted = points.filter((p) => contentById.has(p.id));
const missing = points.filter((p) => !contentById.has(p.id)).map((p) => p.id);

const entries = emitted.map((p) => {
  const c = contentById.get(p.id);
  return {
    id: p.id, label: p.label, read: p.read, mean: p.mean, jlpt: 'N3',
    explanation: c.explanation.trim(), formation: c.formation.trim(),
    examples: c.examples.map((e) => ({ jp: e.jp, en: e.en, blank: e.blank })),
  };
});

const header = `// GENERATED by tools/grammar-n3/build.mjs — do not hand-edit.
// Source of truth: tools/grammar-n3/points.json (the vetted N3 syllabus + durable id registry)
// + tools/grammar-n3/content/<id>.json (per-point content; LLM-drafted, human-proofread).
// Regenerate: node tools/grammar-n3/build.mjs
// Loaded LAZILY via dynamic import (features/grammar/data.js ensureGrammarPoints) so the catalog
// code-splits out of the main bundle, like data/jlpt.js. ${emitted.length}/${points.length} points have content.
`;

writeFileSync(OUT, `${header}export const GRAMMAR_N3 = ${JSON.stringify(entries, null, 2)};\n`);
console.log(`wrote src/data/grammar-n3.js: ${emitted.length}/${points.length} points (${entries.reduce((n, p) => n + p.examples.length, 0)} examples)`);
if (missing.length) console.log(`missing content (${missing.length}): ${missing.join(', ')}`);
