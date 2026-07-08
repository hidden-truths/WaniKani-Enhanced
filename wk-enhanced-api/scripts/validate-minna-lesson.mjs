#!/usr/bin/env node
// Mechanical validator for a curated みんなの日本語 lesson-<n>.json (book II backfill).
// Mirrors the CARDS.md "Validation" contract + the apply-furigana byte-safety intent, but
// works on inline-ruby files (ruby is generated into every jp field, not applied separately).
// Usage: node scripts/validate-minna-lesson.mjs <n> [<n> ...]   (bare = 26..50)
import { readFileSync } from 'node:fs';

const AUDIO_RE = /^\/Audio\/[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*\.mp3$/;
const RUBY_RE = /<ruby>(.*?)<rt>(.*?)<\/rt><\/ruby>/g;

// Strip balanced <ruby>base<rt>reading</rt></ruby> → base. Then assert no stray ruby tags remain.
function stripRuby(s) {
  return s.replace(RUBY_RE, '$1');
}
function rubyErrors(s, where, errs) {
  // count opening/closing tags to catch imbalance the regex would silently skip
  const open = (s.match(/<ruby>/g) || []).length;
  const close = (s.match(/<\/ruby>/g) || []).length;
  const rtOpen = (s.match(/<rt>/g) || []).length;
  const rtClose = (s.match(/<\/rt>/g) || []).length;
  if (open !== close || rtOpen !== rtClose || open !== rtOpen)
    errs.push(`${where}: unbalanced ruby tags (ruby ${open}/${close}, rt ${rtOpen}/${rtClose})`);
  const stripped = stripRuby(s);
  if (/<\/?(ruby|rt)>/.test(stripped))
    errs.push(`${where}: stray ruby/rt tag survives strip → "${s.slice(0, 60)}"`);
  return stripped;
}

function validate(n) {
  const errs = [];
  const warns = [];
  const path = new URL(`../data/minna/lesson-${n}.json`, import.meta.url);
  let d;
  try { d = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { return { n, errs: [`JSON parse/read failed: ${e.message}`], warns }; }

  if (d.lesson !== n) errs.push(`lesson field is ${d.lesson}, expected ${n}`);
  if (!d.title) warns.push('missing title');
  if (!d.theme) warns.push('missing theme');
  if (!Array.isArray(d.vocab) || !d.vocab.length) errs.push('vocab[] missing/empty');

  (d.vocab || []).forEach((v, i) => {
    const w = `vocab[${i}]`;
    if (v.key !== `mnn:${n}:${i}`) errs.push(`${w}.key is "${v.key}", expected "mnn:${n}:${i}"`);
    for (const f of ['kana', 'mean', 'dict', 'dictRead', 'cat']) if (!v[f]) errs.push(`${w}.${f} empty`);
    if (v.audio && !AUDIO_RE.test(v.audio)) errs.push(`${w}.audio bad shape: ${v.audio}`);
    if (v.context && /[<]/.test(v.context)) warns.push(`${w}.context has markup`);
    if (v.accent != null && !(Number.isInteger(v.accent) && v.accent >= 0 && v.accent <= 12))
      errs.push(`${w}.accent not int 0-12: ${v.accent}`);
    if (v.cat === 'verb' && !['godan', 'ichidan', 'irregular'].includes(v.type))
      warns.push(`${w} verb has type="${v.type}"`);
    if (v.levels) {
      const tiers = ['N5', 'N4', 'N3', 'N2', 'N1'];
      const missing = tiers.filter(t => !Array.isArray(v.levels[t]) || !v.levels[t][0] || !v.levels[t][1]);
      if (missing.length) errs.push(`${w}.levels missing/empty tiers: ${missing.join(',')}`);
      // headword stem: kanji stem (dict without trailing kana) or the kana headword
      const kanjiStem = (v.kanji || '').replace(/[ぁ-ゖァ-ヺ〜～\[\]（）()、,。]/g, '').replace(/～.*/, '');
      const stem = kanjiStem || v.dictRead || v.kana;
      for (const t of tiers) {
        if (!v.levels[t]) continue;
        const bad = rubyErrors(v.levels[t][0], `${w}.levels.${t}`, errs);
        if (stem && !bad.includes(stem[0])) {
          // soft: require at least the first char of the stem present
          warns.push(`${w}.levels.${t}: headword stem "${stem}" (char "${stem[0]}") not obviously in "${stripRuby(v.levels[t][0])}"`);
        }
      }
      if (!v.mnem) warns.push(`${w} has levels but no mnem`);
      if (!v.tip) warns.push(`${w} has levels but no tip`);
    }
  });

  (d.grammar || []).forEach((g, i) => {
    if (!g.pattern) errs.push(`grammar[${i}].pattern empty`);
    if (!g.explain) warns.push(`grammar[${i}].explain empty`);
    (g.examples || []).forEach((ex, j) => {
      if (!ex.jp || !ex.en) errs.push(`grammar[${i}].examples[${j}] missing jp/en`);
      else rubyErrors(ex.jp, `grammar[${i}].examples[${j}].jp`, errs);
    });
  });
  if (!d.grammar || !d.grammar.length) warns.push('no grammar[]');

  (d.examples || []).forEach((ex, i) => {
    if (!ex.jp || !ex.en) errs.push(`examples[${i}] missing jp/en`);
    else rubyErrors(ex.jp, `examples[${i}].jp`, errs);
  });

  const c = d.conversation;
  if (!c) errs.push('conversation missing');
  else {
    if (!c.audio || !AUDIO_RE.test(c.audio)) errs.push(`conversation.audio bad/absent: ${c.audio}`);
    if (!Array.isArray(c.lines) || !c.lines.length) errs.push('conversation.lines missing/empty');
    (c.lines || []).forEach((ln, i) => {
      if (!ln.jp || !ln.en) errs.push(`conversation.lines[${i}] missing jp/en`);
      else rubyErrors(ln.jp, `conversation.lines[${i}].jp`, errs);
    });
  }

  return { n, errs, warns, vocab: (d.vocab || []).length, withLevels: (d.vocab || []).filter(v => v.levels).length };
}

const args = process.argv.slice(2);
const lessons = args.length ? args.map(Number) : Array.from({ length: 25 }, (_, i) => 26 + i);
let totalErr = 0;
for (const n of lessons) {
  const r = validate(n);
  totalErr += r.errs.length;
  const status = r.errs.length ? '❌' : (r.warns?.length ? '⚠️ ' : '✅');
  console.log(`${status} L${n}  vocab=${r.vocab ?? '?'} withLevels=${r.withLevels ?? '?'}  errs=${r.errs.length} warns=${r.warns?.length ?? 0}`);
  for (const e of r.errs) console.log(`   ERR  ${e}`);
  for (const w of (r.warns || []).slice(0, 12)) console.log(`   warn ${w}`);
  if ((r.warns || []).length > 12) console.log(`   … +${r.warns.length - 12} more warns`);
}
console.log(`\n${totalErr === 0 ? 'ALL CLEAN' : totalErr + ' ERRORS'} across ${lessons.length} lessons`);
process.exit(totalErr ? 1 : 0);
