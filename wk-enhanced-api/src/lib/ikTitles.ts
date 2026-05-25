// IK title encoding is lossy: lowercase + non-alphanumerics → underscore.
// Multiple original titles collapse to the same encoding ("Kanon (2006)" /
// "Kanon  2006-" → "kanon__2006_"). The canonical reverse map comes from
// /index_meta; this module is the fallback heuristic for misses.
//
// Behavior matches wk-vocab-review-ik.user.js: ikTitleToFolder + decodeIkTitle
// + prettifyTitle. Keep this in sync if the userscript ever diverges.

function decodeIkTitle(title: string): string[] {
    let s = String(title);
    // Year-suffix special case: "kanon__2006_" → "kanon (2006)"
    s = s.replace(/__(\d+)_$/, ' ($1)');
    s = s.replace(/_/g, ' ');
    return s.split(' ').filter(Boolean);
}

function titleCaseTokens(tokens: string[]): string {
    return tokens
        .map((tok, i) => {
            if (tok === 'x') return '×';
            // Short lowercase tokens after the first stay lowercase (la, of, on, etc.)
            if (i > 0 && tok.length <= 3 && /^[a-z]+$/.test(tok)) return tok;
            if (!/^[a-z]/i.test(tok)) return tok;
            return tok[0].toUpperCase() + tok.slice(1);
        })
        .join(' ');
}

export interface IndexMeta {
    [encoded: string]: { title: string; category: string };
}

export function ikTitleToFolder(encodedTitle: string, indexMeta: IndexMeta | null): string {
    const fromMap = indexMeta && indexMeta[encodedTitle];
    if (fromMap?.title) return fromMap.title;
    return titleCaseTokens(decodeIkTitle(encodedTitle));
}

export function prettifyTitle(encodedTitle: string, indexMeta: IndexMeta | null): string {
    const fromMap = indexMeta && indexMeta[encodedTitle];
    if (fromMap?.title) return fromMap.title;
    // For display: drop lone "x" separators that we keep for path-resolution.
    const tokens = decodeIkTitle(encodedTitle).filter((tok) => tok !== 'x');
    return titleCaseTokens(tokens);
}

export function resolveCategory(encodedTitle: string, exampleId: string | undefined, indexMeta: IndexMeta | null): string {
    const fromMap = indexMeta && indexMeta[encodedTitle];
    if (fromMap?.category) return fromMap.category;
    // Fallback: IK example IDs are typically "<category>_<encoded_title>_..."
    if (exampleId) {
        const first = String(exampleId).split('_')[0];
        if (first) return first;
    }
    return 'unknown';
}
