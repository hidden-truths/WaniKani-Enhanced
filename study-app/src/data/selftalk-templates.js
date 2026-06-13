// 独り言 SELF-TALK — slot-swap sentence TEMPLATES (P3). CLIENT-ONLY, not seeded to the sentence
// store: a template has no single fixed text/hash/furigana, so it doesn't fit a `sentence` row.
//
// A template is a JP skeleton string with `{slot}` markers + a `slots` array of fillers. Picking a
// filler per slot REALIZES a concrete sentence (core/selftalk.js `realizeTemplate`) whose reading /
// English / plainText are DERIVED with the same helpers a phrase uses — so a realized template
// renders + plays exactly like a phrase. Synth audio keys on the realized plainText (any text, lazily
// cached by /v1/audio/tts — no pre-gen needed or possible). Record-compare keys on the SKELETON id
// (one practiceable item; the reference uses whatever's currently realized). Templates render PLAIN
// ruby (no GiNZA tap-to-lookup over the unbounded combo space — same graceful degradation as
// user-authored phrases).
//
// A template carries `topic` (+ optional `thought`) so it slots into the SAME taxonomy as phrases and
// renders inside that topic's thought cluster. `grammar` is the skeleton's fixed teaching point.
//
// AUTHORING RULE: each filler's `jp` must stay grammatical in the skeleton's surrounding text (the
// skeleton supplies the conjugation tail). Every kanji — in fixed parts AND fillers — needs ruby, or
// the derived reading drifts. MODEL-GENERATED → proofread (esp. that every combo reads naturally).

import { grammarLabel } from './grammar.js';

export const SELFTALK_TEMPLATES = [
  {
    id: 'tpl-minecraft-gather', topic: 'minecraft', thought: 'resources', grammar: ['volitional'],
    en: "I'm running low on {material} — let me go {action}.",
    jp: 'もうすぐ{material}が<ruby>足<rt>た</rt></ruby>りない、{action}に<ruby>行<rt>い</rt></ruby>こう。',
    slots: [
      { id: 'material', label: 'material', fillers: [
        { jp: '<ruby>木<rt>き</rt></ruby>', en: 'wood' },
        { jp: '<ruby>鉄<rt>てつ</rt></ruby>', en: 'iron' },
        { jp: '<ruby>石<rt>いし</rt></ruby>', en: 'stone' },
        { jp: '<ruby>食料<rt>しょくりょう</rt></ruby>', en: 'food' },
      ] },
      { id: 'action', label: 'verb', fillers: [
        { jp: '<ruby>集<rt>あつ</rt></ruby>め', en: 'gather some' },
        { jp: '<ruby>掘<rt>ほ</rt></ruby>り', en: 'go mine some' },
        { jp: '<ruby>探<rt>さが</rt></ruby>し', en: 'look for some' },
      ] },
    ],
  },
  {
    id: 'tpl-friend-invite', topic: 'friend', grammar: ['volitional'],
    en: "Let's go {place} {time}.",
    jp: '{time}、{place}<ruby>行<rt>い</rt></ruby>こうよ。',
    slots: [
      { id: 'time', label: 'when', fillers: [
        { jp: '<ruby>今度<rt>こんど</rt></ruby>', en: 'sometime' },
        { jp: '<ruby>今週末<rt>こんしゅうまつ</rt></ruby>', en: 'this weekend' },
        { jp: '<ruby>明日<rt>あした</rt></ruby>', en: 'tomorrow' },
      ] },
      { id: 'place', label: 'where', fillers: [
        { jp: 'カラオケに', en: 'to karaoke' },
        { jp: '<ruby>映画<rt>えいが</rt></ruby>に', en: 'to a movie' },
        { jp: 'ご<ruby>飯<rt>はん</rt></ruby>に', en: 'out to eat' },
      ] },
    ],
  },
];

// Templates for one topic id (curated bundle is small, so a linear scan is fine). The label helper
// keeps grammar chips on the template card speaking the one shared grammar vocabulary.
export function templatesForTopic(topicId) {
  return SELFTALK_TEMPLATES.filter((t) => t.topic === topicId);
}
export const templateGrammarLabel = grammarLabel;
