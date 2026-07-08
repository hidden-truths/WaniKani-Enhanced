// 合格 gap-fill → deck activation glue: bulk-add uncovered JLPT-list words as minimal
// tagged cards ({jp, read, mean} from the JMdict-enriched entries, Source: JLPT). The card
// builder is pure core (buildJlptCard); this module owns dedup + persistence, mirroring
// wanikani/activate.js. Dedup = the songs-style headword skip: a word already in the deck
// under the same jp OR read (built-in / みんなの日本語 / 歌 / 鰐蟹) is skipped, not duplicated.
// The `added` day-stamp each card carries is the quota checklist row's live signal — the WK / song /
// Minna builders stamp it too, so the row counts every deck add, not only gap-fill ones.
import { state } from '../../state.js';
import { buildJlptCard, deckWordSet, isDue } from '../../core/index.js';
import { localDay } from '../../config.js';
import { loadCustom, saveCustom } from '../../persistence/custom.js';
import { rebuildData, refreshAfterVerbChange } from '../custom-cards.js';

// Activate: append tagged minimal cards on monotonic seq ranks, save + rebuild once.
// Entries are the generated [jp, read, mean, cat, type, trans] tuples (selectGapBatch
// output — already uncovered, but the headword skip makes a re-click harmless anyway).
// Returns how many were actually added.
export function addJlptWords(entries, level) {
  const have = deckWordSet(state.DATA);
  const adds = (entries || []).filter((e) => e && e[0] && !have.has(e[0]) && !(e[1] && have.has(e[1])));
  if (!adds.length) return 0;
  const cs = loadCustom();
  const today = localDay();
  for (const e of adds) {
    cs.seq = (cs.seq || 100) + 1;
    cs.verbs.push(buildJlptCard(e, cs.seq, level, today));
  }
  saveCustom(cs);
  rebuildData();
  refreshAfterVerbChange();
  return adds.length;
}

// How many gap-fill cards the deck holds + the due slice (the "Study them now" CTA copy).
export function jlptDeckCount() {
  let n = 0, due = 0;
  for (const v of state.DATA) if (v.jlptfill) { n++; if (isDue(v.rank)) due++; }
  return { n, due };
}
