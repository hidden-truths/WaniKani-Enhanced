// JLPT word-list singleton — the lazy loader around the generated data/jlpt.js
// (dynamic import → its own Vite chunk, ~60KB of word data kept out of the main
// bundle) plus the synchronous lookup every surface shares. core/jlpt.js stays pure
// (map passed in); THIS module owns the "is it loaded yet" state.
//
// jlptOf() is deliberately SYNC and fails soft ('' before the chunk lands) so hot
// paths (wanikani activation, row badges) never await — ensureJlptMap() is kicked
// at boot (initJlpt) and takes ~ms, so in practice the map is ready long before any
// user action reads it.
import { state } from '../../state.js';
import { buildJlptMap, jlptLookup } from '../../core/index.js';
import { loadCustom, saveCustom } from '../../persistence/custom.js';
import { rebuildData } from '../custom-cards.js';

let map = null;
let loading = null;

export function ensureJlptMap() {
  if (map) return Promise.resolve(map);
  loading = loading || import('../../data/jlpt.js').then((m) => {
    map = buildJlptMap(m.JLPT_WORDS);
    return map;
  });
  return loading;
}

// ---- per-level enriched word entries (the gap-fill card source) ----
// The generated data/jlpt-words/<level>.js files: frequency-ordered [jp, read, mean, cat,
// type, trans] tuples (JMdict-enriched — the bare jlpt.js map has no readings/glosses).
// LITERAL loader map so Vite code-splits one chunk per level; only the target level's
// ~150KB ever loads. jlptWords() is the sync fail-soft twin (null before the chunk lands).
const WORD_LOADERS = {
  N5: () => import('../../data/jlpt-words/N5.js'),
  N4: () => import('../../data/jlpt-words/N4.js'),
  N3: () => import('../../data/jlpt-words/N3.js'),
  N2: () => import('../../data/jlpt-words/N2.js'),
  N1: () => import('../../data/jlpt-words/N1.js'),
};
const wordsByLevel = {};
const wordsLoading = {};

export function ensureJlptWords(level) {
  if (wordsByLevel[level]) return Promise.resolve(wordsByLevel[level]);
  if (!WORD_LOADERS[level]) return Promise.resolve(null);
  wordsLoading[level] = wordsLoading[level] || WORD_LOADERS[level]().then((m) => {
    wordsByLevel[level] = m.WORDS;
    return m.WORDS;
  });
  return wordsLoading[level];
}

// The level's entry array when loaded, else null (render code branches on it).
export const jlptWords = (level) => wordsByLevel[level] || null;

// The map when loaded, else null (render code branches on it).
export const jlptMap = () => map;

// Sync level lookup: 'N5'..'N1' or '' (unknown word OR map not loaded yet).
export const jlptOf = (jp, read) => (map ? jlptLookup(map, jp, read) : '');

// One-time backfill: machine-made activation cards written before the JLPT lens
// existed (鰐蟹 activations stamped jlpt:'') get their level patched in place once the
// map is up. Only touches wanikani:true cards with an EMPTY jlpt — user-authored cards
// keep whatever the user set. Saves (and pushes) only when something changed.
export function backfillWkJlpt() {
  if (!map) return 0;
  const cs = loadCustom();
  let patched = 0;
  for (const v of cs.verbs) {
    if (!v.wanikani || v.jlpt) continue;
    const lvl = jlptLookup(map, v.jp, v.read);
    if (lvl) { v.jlpt = lvl; patched++; }
  }
  if (patched) { saveCustom(cs); rebuildData(); }
  return patched;
}

// Hydrate state.jlptStore-adjacent card model after a cloud pull too (cloud.js's
// custom pull rebuilds DATA; a later map load still needs this pass) — cheap no-op
// when nothing qualifies.
export function ensureJlptReady() {
  return ensureJlptMap().then(() => { backfillWkJlpt(); return map; });
}
