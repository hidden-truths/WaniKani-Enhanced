// Pure-core tests for the conjugation drill engine (src/core/conjugation.js): the godan 音便
// table, the ichidan/irregular/adjective paradigms, the documented exceptions (行く, ある, いい,
// 来る), fail-closed behavior, and the form-rotation pick. Plus a sweep over the REAL 100-verb
// dataset (the grammar-core catalog-invariant precedent) so a dataset edit that breaks a
// paradigm — a mistyped `type`, a non-dictionary headword — fails loudly here.
import { test, expect } from 'vitest';
import {
  conjugate, conjugableForms, isConjugable, pickConjForm,
  CONJ_FORMS, CONJ_FORM_IDS, conjFormLabel,
} from '../src/core/conjugation.js';
import { VERBS } from '../src/data/verbs.js';

const verb = (jp, read, type) => ({ jp, read, type, cat: 'verb' });
const adj = (jp, read, type) => ({ jp, read, type, cat: 'adjective' });
// Assert every form of one card in one line: [te, past, negative, potential] displays.
const displays = c => CONJ_FORM_IDS.map(f => { const r = conjugate(c, f); return r ? r.display : null; });
const kanas = c => CONJ_FORM_IDS.map(f => { const r = conjugate(c, f); return r ? r.kana : null; });

test('godan 音便: every final-kana row maps to its て/た ending', () => {
  expect(displays(verb('買う', 'かう', 'godan'))).toEqual(['買って', '買った', '買わない', '買える']);
  expect(displays(verb('待つ', 'まつ', 'godan'))).toEqual(['待って', '待った', '待たない', '待てる']);
  expect(displays(verb('取る', 'とる', 'godan'))).toEqual(['取って', '取った', '取らない', '取れる']);
  expect(displays(verb('読む', 'よむ', 'godan'))).toEqual(['読んで', '読んだ', '読まない', '読める']);
  expect(displays(verb('呼ぶ', 'よぶ', 'godan'))).toEqual(['呼んで', '呼んだ', '呼ばない', '呼べる']);
  expect(displays(verb('死ぬ', 'しぬ', 'godan'))).toEqual(['死んで', '死んだ', '死なない', '死ねる']);
  expect(displays(verb('書く', 'かく', 'godan'))).toEqual(['書いて', '書いた', '書かない', '書ける']);
  expect(displays(verb('泳ぐ', 'およぐ', 'godan'))).toEqual(['泳いで', '泳いだ', '泳がない', '泳げる']);
  expect(displays(verb('話す', 'はなす', 'godan'))).toEqual(['話して', '話した', '話さない', '話せる']);
});

test('godan negative: う→わ, not う→あ', () => {
  expect(conjugate(verb('言う', 'いう', 'godan'), 'negative')).toEqual({ kana: 'いわない', display: '言わない' });
});

test('行く is the て-form exception (って, never いて) — and its compounds inherit it', () => {
  expect(displays(verb('行く', 'いく', 'godan'))).toEqual(['行って', '行った', '行かない', '行ける']);
  expect(displays(verb('持っていく', 'もっていく', 'godan'))[0]).toBe('持っていって');
  expect(displays(verb('連れていく', 'つれていく', 'godan'))[1]).toBe('連れていった');
  // A regular く-verb whose stem merely CONTAINS い is untouched by the exception.
  expect(conjugate(verb('聞く', 'きく', 'godan'), 'te').display).toBe('聞いて');
  expect(conjugate(verb('歩く', 'あるく', 'godan'), 'te').display).toBe('歩いて');
});

test('ichidan drops る', () => {
  expect(displays(verb('食べる', 'たべる', 'ichidan'))).toEqual(['食べて', '食べた', '食べない', '食べられる']);
  expect(kanas(verb('見る', 'みる', 'ichidan'))).toEqual(['みて', 'みた', 'みない', 'みられる']);
  // 着る (ichidan, きる) vs 切る (godan, きる): same reading, the `type` field disambiguates.
  expect(conjugate(verb('着る', 'きる', 'ichidan'), 'te').display).toBe('着て');
  expect(conjugate(verb('切る', 'きる', 'godan'), 'te').display).toBe('切って');
});

test('irregular する/くる, including compounds and the 来る display override', () => {
  expect(displays(verb('する', 'する', 'irregular'))).toEqual(['して', 'した', 'しない', 'できる']);
  expect(displays(verb('勉強する', 'べんきょうする', 'irregular')))
    .toEqual(['勉強して', '勉強した', '勉強しない', '勉強できる']);
  // 来る: the 2-char drop would eat the stem kanji, so the display re-attaches 来.
  expect(displays(verb('来る', 'くる', 'irregular'))).toEqual(['来て', '来た', '来ない', '来られる']);
  expect(kanas(verb('来る', 'くる', 'irregular'))).toEqual(['きて', 'きた', 'こない', 'こられる']);
  // A kana-written compound keeps kana; a kanji-written one keeps 来.
  expect(conjugate(verb('持ってくる', 'もってくる', 'irregular'), 'te').display).toBe('持ってきて');
  expect(conjugate(verb('持って来る', 'もってくる', 'irregular'), 'te').display).toBe('持って来て');
});

test('ある: suppletive negative ない, no potential', () => {
  expect(displays(verb('ある', 'ある', 'godan'))).toEqual(['あって', 'あった', 'ない', null]);
});

test('POTENTIAL_SKIP drops forms that are wrong or a different verb', () => {
  // Already potential forms — "the potential of 使える" is nonsense.
  for (const jp of ['できる', '使える', '買える', '待てる']) {
    expect(conjugate(verb(jp, 'x', 'ichidan'), 'potential')).toBe(null);
  }
  // 分かれる means "to part", not "can understand".
  expect(conjugate(verb('分かる', 'わかる', 'godan'), 'potential')).toBe(null);
  // ...but their other forms still drill.
  expect(conjugate(verb('分かる', 'わかる', 'godan'), 'negative').display).toBe('分からない');
  expect(conjugableForms(verb('分かる', 'わかる', 'godan'))).toEqual(['te', 'past', 'negative']);
});

test('i-adjectives inflect the adjective, not a copula; no potential form', () => {
  expect(displays(adj('高い', 'たかい', 'i-adj'))).toEqual(['高くて', '高かった', '高くない', null]);
  expect(kanas(adj('新しい', 'あたらしい', 'i-adj'))).toEqual(['あたらしくて', 'あたらしかった', 'あたらしくない', null]);
});

test('いい swaps its stem to よ — by suffix, so 〜いい compounds inherit it', () => {
  expect(displays(adj('いい', 'いい', 'i-adj'))).toEqual(['よくて', 'よかった', 'よくない', null]);
  expect(conjugate(adj('良い', 'いい', 'i-adj'), 'past')).toEqual({ kana: 'よかった', display: '良かった' });
  expect(conjugate(adj('かっこいい', 'かっこいい', 'i-adj'), 'past').display).toBe('かっこよかった');
  expect(conjugate(adj('気持ちいい', 'きもちいい', 'i-adj'), 'te').kana).toBe('きもちよくて');
  // よい (the older reading) is REGULAR — it already has the よ stem.
  expect(conjugate(adj('良い', 'よい', 'i-adj'), 'past')).toEqual({ kana: 'よかった', display: '良かった' });
});

test('na-adjectives inflect the copula, stem untouched', () => {
  expect(displays(adj('静か', 'しずか', 'na-adj'))).toEqual(['静かで', '静かだった', '静かじゃない', null]);
});

test('fails CLOSED: unknown type, wrong category, non-dictionary form, unmodeled irregular', () => {
  expect(conjugableForms({ jp: '猫', read: 'ねこ', cat: 'noun', type: '' })).toEqual([]);
  expect(conjugableForms({ jp: 'ゆっくり', read: 'ゆっくり', cat: 'adverb', type: '' })).toEqual([]);
  expect(conjugableForms({ jp: '〜ようになる', read: 'ようになる', cat: 'grammar', type: '' })).toEqual([]);
  expect(conjugableForms(verb('食べ', 'たべ', 'ichidan'))).toEqual([]);   // stem, not a dict form
  expect(conjugableForms(verb('ぐる', 'ぐる', 'irregular'))).toEqual([]); // an irregular we don't model
  expect(conjugableForms(adj('変な', 'へんな', 'i-adj'))).toEqual([]);    // na-adj mistyped as i-adj
  expect(conjugate(null, 'te')).toBe(null);
  expect(conjugate(verb('食べる', 'たべる', 'ichidan'), 'volitional')).toBe(null);
  // A card with no `cat` defaults to verb (attachLevels does this at runtime).
  expect(conjugate({ jp: '食べる', read: 'たべる', type: 'ichidan' }, 'te').display).toBe('食べて');
});

test('isConjugable respects the session form selection', () => {
  const aru = verb('ある', 'ある', 'godan');
  expect(isConjugable(aru)).toBe(true);                    // no constraint
  expect(isConjugable(aru, [])).toBe(true);                // empty = no constraint
  expect(isConjugable(aru, ['te'])).toBe(true);
  expect(isConjugable(aru, ['potential'])).toBe(false);    // its only allowed form is dropped
  expect(isConjugable({ jp: '猫', read: 'ねこ', cat: 'noun', type: '' }, ['te'])).toBe(false);
});

test('pickConjForm rotates deterministically over the allowed forms', () => {
  const v = verb('食べる', 'たべる', 'ichidan');
  expect([0, 1, 2, 3, 4].map(n => pickConjForm(v, ['te', 'past'], n))).toEqual(['te', 'past', 'te', 'past', 'te']);
  expect(pickConjForm(v, [], 0)).toBe('te');               // no constraint = all four, in order
  expect(pickConjForm(v, [], 3)).toBe('potential');
  // Never returns a form the card can't answer, even when explicitly allowed.
  expect(pickConjForm(verb('ある', 'ある', 'godan'), ['potential'], 0)).toBe(null);
  expect(pickConjForm({ jp: '猫', read: 'ねこ', cat: 'noun', type: '' }, [], 0)).toBe(null);
});

test('CONJ_FORMS metadata is coherent with the form ids', () => {
  expect(CONJ_FORM_IDS).toEqual(['te', 'past', 'negative', 'potential']);
  expect(CONJ_FORMS.every(f => f.id && f.label && f.jp)).toBe(true);
  expect(conjFormLabel('te')).toBe('て-form');
  expect(conjFormLabel('nope')).toBe('nope');   // fail-soft label
});

// ---- Dataset invariants (the real 100 built-ins) ----

test('every built-in verb is drillable on at least one form', () => {
  const dead = VERBS.filter(v => !conjugableForms({ ...v, cat: 'verb' }).length);
  expect(dead.map(v => v.jp)).toEqual([]);
});

test('every built-in conjugation ends in the ending its form requires', () => {
  const tail = { te: /(?:て|で)$/, past: /(?:た|だ)$/, negative: /ない$/, potential: /る$/ };
  const bad = [];
  for (const v of VERBS) {
    const card = { ...v, cat: 'verb' };
    for (const f of conjugableForms(card)) {
      const { kana, display } = conjugate(card, f);
      if (!tail[f].test(kana) || !tail[f].test(display)) bad.push(`${v.jp} ${f} → ${display}/${kana}`);
    }
  }
  expect(bad).toEqual([]);
});

test('every built-in conjugation keeps the headword kanji in its display form', () => {
  // The (drop N, append) rule must never eat a stem kanji — the 来る trap. Checks the first
  // character survives for any kanji-written headword.
  const bad = VERBS
    .filter(v => /[㐀-鿿]/.test(v.jp))
    .flatMap(v => conjugableForms({ ...v, cat: 'verb' })
      .map(f => ({ v, f, d: conjugate({ ...v, cat: 'verb' }, f).display }))
      .filter(({ v: c, d }) => !d.startsWith(c.jp[0]))
      .map(({ v: c, f, d }) => `${c.jp} ${f} → ${d}`));
  expect(bad).toEqual([]);
});

test('the potential-skip set is exactly the built-ins with no potential form', () => {
  const noPotential = VERBS.filter(v => !conjugate({ ...v, cat: 'verb' }, 'potential')).map(v => v.jp);
  expect(noPotential.sort()).toEqual(['ある', 'いる', 'くれる', 'できる', '使える', '分かる', '待てる', '買える'].sort());
});
