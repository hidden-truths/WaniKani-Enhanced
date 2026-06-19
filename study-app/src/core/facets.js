// Deck filter model — the AND'd-facet predicate + the card stamp/label helpers.
//
// A card is shown iff it satisfies ALL facets: within a facet the selected tokens OR,
// across facets they AND, then intersect with jlpt + the rank range. passes()/oneGroup()
// are pure given a card; the 'leech'/'due' status tokens consult the SRS module (which
// reads state.store). See the test for the headline "AND across, OR within" behavior.
import { isLeech, isDue } from './srs.js';

// Conjugation/word-class subtype labels (the `type` field).
export const TYPE_LABEL = { godan: 'GODAN', ichidan: 'ICHIDAN', irregular: 'IRREG', 'i-adj': 'い-ADJ', 'na-adj': 'な-ADJ' };
// Part-of-speech categories (the `cat` field); 'verb' is the historical default.
export const CATS = ['verb', 'adjective', 'noun', 'adverb', 'phrase'];
export const CAT_LABEL = { verb: 'VERB', adjective: 'ADJ', noun: 'NOUN', adverb: 'ADVERB', phrase: 'PHRASE' };

// The color token a card paints with (spine / hanko stamp): its subtype if it has one,
// else its category.
export const colorClass = v => v.type || v.cat || '';
// The hanko stamp: the subtype label when present (GODAN / い-ADJ), else the bare category.
export function cardStamp(v) {
  if (v.type && TYPE_LABEL[v.type]) return { label: TYPE_LABEL[v.type], cls: v.type };
  return { label: CAT_LABEL[v.cat] || (v.cat || '').toUpperCase(), cls: v.cat || '' };
}
// The single class kanji shown inside a metro line-bullet (五/一/不/い/な/名/副/句), keyed by
// colorClass. Used by Browse / Stats / the flashcard nphead via the shared .line-bullet.
export const BULLET_KANJI = { godan: '五', ichidan: '一', irregular: '不', 'i-adj': 'い', 'na-adj': 'な', verb: '動', adjective: '形', noun: '名', adverb: '副', phrase: '句' };
export const classKanji = v => BULLET_KANJI[colorClass(v)] || '語';

// Does card v match a single group token d?
export function oneGroup(v, d) {
  if (d === 'all') return true;
  if (d === 'leech') return isLeech(v.rank);
  if (d === 'due') return isDue(v.rank);
  if (d === 'minna') return !!v.minna;                         // source facet: any みんなの日本語 card
  if (d === 'italki') return !!v.italki;                       // source facet: covered in an iTalki lesson
  if (d === 'song') return !!v.song;                           // source facet: any word mined from a 歌/song
  if (CATS.includes(d)) return (v.cat || 'verb') === d;        // part-of-speech facet
  if (['godan', 'ichidan', 'irregular'].includes(d)) return v.type === d;
  if (d === 'suru' || d === 'fake') return v.tags.includes(d);
  if (d === 'trans') return v.trans === 't';
  if (d === 'intrans') return v.trans === 'i';
  return v.tags.includes(d);
}
// A facet array imposes no constraint if it's empty or contains 'all'.
export const facetAll = arr => !arr || arr.length === 0 || arr.includes('all');
// One AND'd facet: no constraint if empty, else the card must match one token (OR).
export const facetMatch = (v, arr) => !arr || arr.length === 0 || arr.some(d => oneGroup(v, d));
// The single source of truth for "should this card appear?" (a missing facet array = no constraint).
export function passes(v, c) {
  if (!facetMatch(v, c.cat)) return false;
  if (!facetMatch(v, c.type)) return false;
  if (!facetMatch(v, c.trans)) return false;
  if (!facetMatch(v, c.topic)) return false;
  if (!facetMatch(v, c.status)) return false;
  if (!facetMatch(v, c.source)) return false;
  if (!facetAll(c.jlpt) && !c.jlpt.includes(v.jlpt)) return false;
  if (v.rank < c.rmin || v.rank > c.rmax) return false;                     // rank AND
  return true;
}

// Token → facet routing. topic is the default; per-lesson tokens (mnn-l23) → source.
export const DECK_FACETS = ['cat', 'type', 'trans', 'topic', 'status', 'source'];
export const TOKEN_FACET = {
  verb: 'cat', adjective: 'cat', noun: 'cat', adverb: 'cat', phrase: 'cat',
  godan: 'type', ichidan: 'type', irregular: 'type', suru: 'type', fake: 'type',
  trans: 'trans', intrans: 'trans', 'ti-pair': 'trans', leech: 'status', due: 'status',
  minna: 'source', italki: 'source', song: 'source',
};
// topic is the default; per-lesson (mnn-l23) AND per-song (song-<extId>) tokens → source.
export const tokenFacet = t => TOKEN_FACET[t] || (/^mnn-l\d+$/.test(t) || /^song-/.test(t) ? 'source' : 'topic');

// Token → human label for the active-filter recap line.
export const DECK_LABEL = { verb: 'Verb', adjective: 'Adjective', noun: 'Noun', adverb: 'Adverb', phrase: 'Phrase', godan: 'Godan', ichidan: 'Ichidan', irregular: 'Irregular', suru: 'Suru', fake: 'Fake-ichidan', trans: 'Transitive', intrans: 'Intransitive', 'ti-pair': 'T/I pairs', leech: 'Leeches', due: 'Due cards', motion: 'Motion', transit: 'Transit', wearing: 'Wearing', speaking: 'Speaking', communication: 'Communication', giving: 'Giving/Recv', emotion: 'Emotion', cognition: 'Cognition', perception: 'Perception', existence: 'Existence', change: 'Change', ability: 'Ability', onoff: 'On/Off', daily: 'Daily', body: 'Body', work: 'Work', study: 'Study', food: 'Food', money: 'Money', minna: 'みんなの日本語', italki: 'iTalki', song: '歌' };
// Token → recap label. Per-lesson source tokens (mnn-l23) render as "L23"; per-song (song-<id>) as "歌".
export function deckLabel(t) { const m = /^mnn-l(\d+)$/.exec(t); if (m) return 'L' + m[1]; if (/^song-/.test(t)) return '歌'; return DECK_LABEL[t] || t; }
// Build the active-facet parts for a config (one part per non-empty facet).
export function filterSummary(c) {
  const parts = [];
  [c.cat, c.type, c.trans, c.topic, c.status, c.source].forEach(arr => {
    if (arr && arr.length) parts.push(arr.map(deckLabel).join('/'));
  });
  if (!facetAll(c.jlpt)) parts.push(c.jlpt.join('/'));
  if (c.rmin > 1 || c.rmax < 100) parts.push('rank ' + c.rmin + '–' + c.rmax);
  return parts;
}
