// Apply model-generated furigana ruby to a みんなの日本語 lesson's SENTENCE fields:
//   grammar[].examples[].jp · examples[].jp · conversation.lines[].jp
// (vocab[].levels already ship their own ruby and are left untouched.)
//
// Input per lesson: /tmp/ruby-<n>.json — a flat map { "<original jp>": "<annotated jp>" }.
// The annotated form wraps each kanji span in <ruby>漢<rt>かな</rt></ruby>, inserting ONLY
// ruby/rt tags — every kana, space, punctuation mark and digit stays byte-identical. We
// VALIDATE that invariant (stripping the ruby must reproduce the original exactly) plus
// ruby-tag balance before writing, so a bad generation can never corrupt the lesson text.
// The script — not the generator — owns serialization, so formatting stays consistent.
//
//   cd wk-enhanced-api && bun scripts/apply-furigana.ts [lesson...]   (default: 22 23 24)
import { readFileSync, writeFileSync, existsSync } from 'fs';
// Single source for kanji detection — shared with the study-app TTS picker so the two can't drift
// (scripts/ is outside the server tsconfig and may reach across study-app/, as the seed scripts do).
import { HAS_KANJI } from '../../study-app/src/core/text.js';

const stripRuby = (s: string) => s.replace(/<rt>.*?<\/rt>/g, '').replace(/<\/?ruby>/g, '');
function balanced(s: string): boolean {
  const c = (re: RegExp) => (s.match(re) || []).length;
  const ruby = c(/<ruby>/g), rubyEnd = c(/<\/ruby>/g), rt = c(/<rt>/g), rtEnd = c(/<\/rt>/g);
  return ruby === rubyEnd && rt === rtEnd && ruby === rt && ruby > 0;
}

const lessons = process.argv.slice(2).length ? process.argv.slice(2) : ['22', '23', '24'];
let anyFail = 0;

for (const n of lessons) {
  const file = new URL(`../data/minna/lesson-${n}.json`, import.meta.url).pathname;
  const mapFile = `/tmp/ruby-${n}.json`;
  if (!existsSync(mapFile)) { console.error(`skip L${n}: ${mapFile} not found`); continue; }
  const L = JSON.parse(readFileSync(file, 'utf8'));
  const map: Record<string, string> = JSON.parse(readFileSync(mapFile, 'utf8'));

  const targets: { jp: string }[] = [];
  (L.grammar || []).forEach((g: any) => (g.examples || []).forEach((e: any) => targets.push(e)));
  (L.examples || []).forEach((e: any) => targets.push(e));
  (L.conversation?.lines || []).forEach((ln: any) => targets.push(ln));

  let annotated = 0, kanaOnly = 0, problems = 0;
  for (const t of targets) {
    const orig = t.jp;
    const ann = map[orig];
    if (ann == null) {
      if (HAS_KANJI.test(orig)) { console.error(`  L${n} MISSING: ${orig}`); problems++; }
      else kanaOnly++;
      continue;
    }
    if (ann === orig) { kanaOnly++; continue; }
    if (!HAS_KANJI.test(orig)) { kanaOnly++; continue; }
    if (!balanced(ann)) { console.error(`  L${n} UNBALANCED: ${ann}`); problems++; continue; }
    if (stripRuby(ann) !== orig) {
      console.error(`  L${n} ROUNDTRIP FAIL:\n    orig:  ${orig}\n    strip: ${stripRuby(ann)}`);
      problems++; continue;
    }
    t.jp = ann; annotated++;
  }

  if (problems) { console.error(`L${n}: ${problems} problem(s) — NOT written`); anyFail += problems; continue; }
  writeFileSync(file, JSON.stringify(L, null, 2) + '\n');
  console.log(`L${n}: annotated ${annotated} sentence(s), ${kanaOnly} kana-only → wrote lesson-${n}.json`);
}

process.exit(anyFail ? 1 : 0);
