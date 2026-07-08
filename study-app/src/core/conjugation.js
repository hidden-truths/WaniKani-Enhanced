// CONJUGATION — pure derivation of inflected forms from a card's `type` field.
//
// The deck already carries everything needed: `read` (kana dictionary form), `jp` (kanji
// headword), `cat` (verb/adjective), `type` (godan/ichidan/irregular · i-adj/na-adj). This
// module turns those into the four drilled forms. No DOM, no state — see core/index.js.
//
// TWO OUTPUTS PER FORM. `kana` is what a typed answer is graded against (the reading is the
// only unambiguous answer); `display` is the kanji-bearing form shown on the answer face.
// Both are derived by the SAME (drop N chars, append ending) rule, applied to `read` and to
// `jp` respectively — which works because a dictionary form's trailing okurigana is kana in
// both strings (書く/かく both end く). Where that assumption breaks (来る, whose stem kanji is
// consumed by the 2-char drop) the irregular table supplies the display form directly.
//
// FAIL CLOSED, NOT OPEN. conjugate() returns null for anything it can't derive correctly —
// an unknown type, a card whose dictionary form doesn't end in the kana the rule expects, or
// a form that would produce grammatical nonsense (see POTENTIAL_SKIP). A null form is simply
// not drilled. Generating a plausible-but-wrong 活用 for an exam learner is the failure mode
// this file exists to prevent, so prefer dropping a card over guessing at it.

// The drilled forms, in teaching order. `label` is the prompt's English ask; `jp` is the
// mono kicker beside it. Adjectives skip `potential` (conjugableForms filters it out).
export const CONJ_FORMS = [
  { id: 'te', label: 'て-form', jp: 'て形' },
  { id: 'past', label: 'Past', jp: 'た形' },
  { id: 'negative', label: 'Negative', jp: 'ない形' },
  { id: 'potential', label: 'Potential', jp: '可能形' },
];
export const CONJ_FORM_IDS = CONJ_FORMS.map(f => f.id);
export const conjFormLabel = id => (CONJ_FORMS.find(f => f.id === id) || {}).label || id;

// Godan て/た endings keyed by the dictionary form's final kana (the 音便 table). Each entry
// is the て-form ending; the past swaps the final て→た / で→だ (pastOf below).
const GODAN_TE = {
  う: 'って', つ: 'って', る: 'って',
  む: 'んで', ぶ: 'んで', ぬ: 'んで',
  く: 'いて', ぐ: 'いで', す: 'して',
};
// う-row → あ-row for the ない stem. Note う→わ (not あ): 買う→買わない, the one row that
// doesn't follow the naive column shift.
const GODAN_NAI = { う: 'わ', く: 'か', ぐ: 'が', す: 'さ', つ: 'た', ぬ: 'な', ぶ: 'ば', む: 'ま', る: 'ら' };
// う-row → え-row for the potential stem (書く→書ける).
const GODAN_E = { う: 'え', く: 'け', ぐ: 'げ', す: 'せ', つ: 'て', ぬ: 'ね', ぶ: 'べ', む: 'め', る: 'れ' };

const pastOf = te => te.slice(0, -1) + (te.endsWith('で') ? 'だ' : 'た');

// Verbs whose potential form is wrong, nonexistent, or a DIFFERENT verb. Keyed on the kanji
// headword because readings collide (買える/変える/帰る all read かえる).
//   できる/使える/買える/待てる — already potential forms; "the potential of 使える" is nonsense.
//   ある/いる               — existence verbs; ありえる/いられる are not what a drill means.
//   分かる                  — 分かれる is "to part/separate", a different verb entirely.
//   くれる                  — 与益 verb; くれられる is ungrammatical.
const POTENTIAL_SKIP = new Set(['できる', '使える', '買える', '待てる', 'ある', 'いる', '分かる', 'くれる']);

// Verbs whose ENTIRE paradigm is irregular, keyed on the exact reading. `display` overrides
// exist only where the (drop N, append) rule would eat a stem kanji — i.e. 来る.
const IRREGULAR = {
  する: { drop: 2, te: 'して', past: 'した', negative: 'しない', potential: 'できる' },
  くる: { drop: 2, te: 'きて', past: 'きた', negative: 'こない', potential: 'こられる' },
  ある: { drop: 1, te: 'あって', past: 'あった', negative: null, potential: null, whole: true },
};
// ある's negative is the suppletive ない — not あらない, and not derivable from any stem.
const ARU_NEGATIVE = 'ない';

// い-adjective irregular: いい inflects off the older よい stem (よかった, never いかった). Only
// the いい READING is irregular — a card read よい conjugates by the regular rule (良い→良かった),
// so it deliberately isn't listed here. The tails below attach to that swapped よ stem.
const II_ADJ_TAIL = { past: 'かった', negative: 'くない', te: 'くて' };

const endsWith = (s, suf) => typeof s === 'string' && s.endsWith(suf);

// Apply (drop N chars, append `ending`) to both strings. `jp` falls back to the kana result
// when the drop would over-consume it (a kana-only headword shorter than the drop).
function shape(card, drop, ending) {
  const kana = card.read.slice(0, card.read.length - drop) + ending;
  const display = card.jp.length > drop ? card.jp.slice(0, card.jp.length - drop) + ending : kana;
  return { kana, display };
}

// 来る + its compounds (持ってくる). The kana ending starts with the stem mora (き/こ), which
// IS the reading of 来 — so a jp written with the kanji re-attaches 来 and drops that mora.
function shapeKuru(card, ending) {
  const kana = card.read.slice(0, -2) + ending;
  const display = endsWith(card.jp, '来る')
    ? card.jp.slice(0, -2) + '来' + ending.slice(1)   // 来る→来て · 持って来る→持って来て
    : card.jp.slice(0, -2) + ending;                  // 持ってくる→持ってきて (kana-written)
  return { kana, display };
}

// 行く is the classic 音便 exception: く normally takes いて, but 行く takes って (行って, never
// 行いて). Its compounds inherit it (持っていく→持っていって). Only て/past deviate; ない/可能 are
// regular godan. Matched conservatively — the reading alone (〜いく) would be too loose.
const isIkuFamily = card =>
  endsWith(card.read, 'いく') && (endsWith(card.jp, '行く') || endsWith(card.jp, 'いく'));

function conjugateVerb(card, form) {
  const read = card.read;

  // ---- irregular paradigms (exact reading, then the する/くる compound suffixes) ----
  const exact = IRREGULAR[read];
  if (exact && exact.whole) {                       // ある — only 3 forms, negative suppletive
    if (form === 'negative') return { kana: ARU_NEGATIVE, display: ARU_NEGATIVE };
    if (form === 'potential') return null;
    return { kana: exact[form], display: exact[form] };
  }
  if (card.type === 'irregular') {
    if (endsWith(read, 'する')) {
      const e = IRREGULAR['する'][form];
      return e ? shape(card, 2, e) : null;          // 勉強する→勉強して · する→して
    }
    if (endsWith(read, 'くる')) {
      const e = IRREGULAR['くる'][form];
      return e ? shapeKuru(card, e) : null;
    }
    return null;                                    // an irregular we don't model — don't guess
  }

  if (form === 'potential' && POTENTIAL_SKIP.has(card.jp)) return null;

  if (card.type === 'ichidan') {
    if (!endsWith(read, 'る')) return null;         // a mistyped ichidan; don't invent a stem
    const e = { te: 'て', past: 'た', negative: 'ない', potential: 'られる' }[form];
    return e ? shape(card, 1, e) : null;
  }

  if (card.type === 'godan') {
    const last = read.slice(-1);
    if (form === 'te' || form === 'past') {
      const te = isIkuFamily(card) ? 'って' : GODAN_TE[last];
      if (!te) return null;
      return shape(card, 1, form === 'te' ? te : pastOf(te));
    }
    if (form === 'negative') { const s = GODAN_NAI[last]; return s ? shape(card, 1, s + 'ない') : null; }
    if (form === 'potential') { const s = GODAN_E[last]; return s ? shape(card, 1, s + 'る') : null; }
  }
  return null;
}

function conjugateAdjective(card, form) {
  if (form === 'potential') return null;            // adjectives have no potential form

  if (card.type === 'i-adj') {
    if (!endsWith(card.read, 'い')) return null;
    // いい → よかった (the stem swaps い→よ). Matched by SUFFIX, not equality: every 〜いい
    // compound inherits it (かっこいい→かっこよかった, 気持ちいい→気持ちよかった).
    if (endsWith(card.read, 'いい')) {
      const tail = II_ADJ_TAIL[form];
      if (!tail) return null;
      // A kana headword takes the swapped よ stem; a kanji one keeps its kanji (良い→良かった).
      const display = endsWith(card.jp, 'いい') ? card.jp.slice(0, -2) + 'よ' + tail : card.jp.slice(0, -1) + tail;
      return { kana: card.read.slice(0, -2) + 'よ' + tail, display };
    }
    const e = { te: 'くて', past: 'かった', negative: 'くない' }[form];
    return e ? shape(card, 1, e) : null;
  }
  if (card.type === 'na-adj') {                     // な-adj: the copula inflects, stem is whole
    const e = { te: 'で', past: 'だった', negative: 'じゃない' }[form];
    return e ? shape(card, 0, e) : null;
  }
  return null;
}

// The one entry point. Returns `{kana, display}` or null when the form can't be derived
// correctly for this card (see the fail-closed note at the top).
export function conjugate(card, form) {
  if (!card || !card.read || !card.jp || !card.type) return null;
  if (!CONJ_FORM_IDS.includes(form)) return null;
  const cat = card.cat || 'verb';
  if (cat === 'verb') return conjugateVerb(card, form);
  if (cat === 'adjective') return conjugateAdjective(card, form);
  return null;                                      // nouns/adverbs/phrases/grammar don't inflect
}

// The forms this card can actually be drilled on — the source of truth for both the deck
// filter and the per-card form pick (so a card can never be served a form it can't answer).
export function conjugableForms(card) {
  return CONJ_FORM_IDS.filter(f => conjugate(card, f) !== null);
}

// Can this card appear in a conjugation deck at all, given the session's selected forms?
// `allowed` empty/absent = no constraint (all forms).
export function isConjugable(card, allowed) {
  const forms = conjugableForms(card);
  if (!forms.length) return false;
  if (!allowed || !allowed.length) return true;
  return forms.some(f => allowed.includes(f));
}

// Which form to ask THIS time. Rotates deterministically off the card's attempt count so a
// card revisited across sessions cycles its forms instead of re-asking the same one — the
// same trick as pickGrammarExample. Intersected with `allowed` (the session's form chips);
// an empty intersection can't happen because buildDeck filters on isConjugable(card, allowed).
export function pickConjForm(card, allowed, n = 0) {
  const forms = conjugableForms(card).filter(f => !allowed || !allowed.length || allowed.includes(f));
  if (!forms.length) return null;
  return forms[Math.abs(n) % forms.length];
}
