// JLPT difficulty scoring. Direct port of scoreJlpt() from the userscript.
//
// Returns 1–5 (5=N5 easiest, 1=N1 hardest) = the hardest non-target token
// in the sentence's word_list that we can look up. Returns 0 = "unknown,
// no identifiable tokens" — fail-open sentinel that callers treat as
// passing any ceiling filter. See userscript CLAUDE.md for why fail-open.

import jlptVocab from '../../data/jlpt-vocab.json' with { type: 'json' };

const VOCAB = jlptVocab as Record<string, number>;

export function scoreJlpt(wordList: string[] | undefined, targetWord: string): number {
    if (!wordList?.length) return 0;
    let hardest = 6;
    let anyKnown = false;
    for (const tok of wordList) {
        if (!tok || tok === targetWord) continue;
        const lvl = VOCAB[tok];
        if (typeof lvl !== 'number') continue;
        anyKnown = true;
        if (lvl < hardest) hardest = lvl;
    }
    return anyKnown ? hardest : 0;
}
