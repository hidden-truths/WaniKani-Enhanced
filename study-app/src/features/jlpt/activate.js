// 合格 gap-fill → deck activation glue: bulk-add uncovered JLPT-list words as minimal
// tagged cards ({jp, read, mean} from the JMdict-enriched entries, Source: JLPT). The card
// builder is pure core (buildJlptCard); this module owns dedup + persistence, mirroring
// wanikani/activate.js. Dedup = the songs-style headword skip: a word already in the deck
// under the same jp OR read (built-in / みんなの日本語 / 歌 / 鰐蟹) is skipped, not duplicated.
// The `added` day-stamp each card carries is the quota checklist row's live signal — the WK / song /
// Minna builders stamp it too, so the row counts every deck add, not only gap-fill ones.
import { state } from '../../state.js';
import { buildJlptCard, deckWordSet, deckSourceCount } from '../../core/index.js';
import { appendCustomCards } from '../append-cards.js';

// Activate: append tagged minimal cards on monotonic seq ranks, save + rebuild once (via the
// shared appendCustomCards protocol). Entries are the generated [jp, read, mean, cat, type,
// trans] tuples (selectGapBatch output — already uncovered, but the headword skip makes a
// re-click harmless anyway). Dedup tests BOTH the entry's jp AND its read against deckWordSet
// (built-in / みんなの日本語 / 歌 / 鰐蟹). Returns how many were actually added.
export function addJlptWords(entries, level) {
  const have = deckWordSet(state.DATA);
  return appendCustomCards(
    entries,
    (e) => !e || !e[0] || have.has(e[0]) || (!!e[1] && have.has(e[1])),
    (e, rank, today) => buildJlptCard(e, rank, level, today),
  );
}

// How many gap-fill cards the deck holds + the due slice (the "Study them now" CTA copy).
export const jlptDeckCount = () => deckSourceCount('jlptfill');
