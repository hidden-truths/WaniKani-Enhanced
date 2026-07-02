// Grammar feature barrel + lifecycle. No tab of its own — the grammar system surfaces
// through the 合格 JLPT tab's readiness lens (features/jlpt/view.js), the flashcard's
// cloze branch, and Browse detail; this module just owns boot.
export * from './data.js';
export * from './activate.js';

import { state } from '../../state.js';
import { ensureGrammarPoints, refreshGrammarAnnotations } from './data.js';

// Boot (main.js): if the deck already holds grammar cards, preload the catalog chunk now so
// the first flashcard render has content (otherwise it loads on first JLPT-lens open /
// activation); kick the annotations read-through either way (cheap, cache-first).
export function initGrammar() {
  if (state.DATA.some((v) => v && v.grammar)) ensureGrammarPoints();
  refreshGrammarAnnotations();
}
