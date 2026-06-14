// Server-side port of the study-app's template REALIZATION (study-app/src/core/selftalk.js
// realizeTemplate + study-app/src/core/text.js plainText / rubyToSegments).
//
// Slice-2 decision #1 is server-RECONSTRUCTS: the realize route gets ONLY the picks from the client
// and rebuilds the concrete sentence (text + furigana + English + combo key) from the stored
// skeleton, so the server is authoritative — a client can't materialize a public row whose text
// doesn't match the curated template. The runtime container ships only src/ + data/ (NOT study-app/,
// which is a separate container), so these tiny pure helpers are PORTED here rather than imported.
//
// KEEP BYTE-FOR-BYTE ALIGNED with the study-app originals: a divergence would make a
// server-materialized combo's text/hash/furigana disagree with what the client plays (the client's
// lazy /v1/audio/tts key is plainText(jp) of the SAME realization). Same "direct port of client
// logic" convention as lib/jlpt.ts. The structural-furigana invariant concat(seg.t) === text is
// re-asserted again at the DB write (db.materializeTemplateRealization → assertFuriganaMatches).

import type { FuriganaSeg, TemplateSlot } from '../db/client.ts';

// The (clamped, default-0) filler index chosen for a slot. Port of core/selftalk.js.
export function templatePickIndex(slot: TemplateSlot, picks: Record<string, number>): number {
    const n = (slot?.fillers || []).length;
    const i = (picks && picks[slot?.id]) || 0;
    return n ? Math.max(0, Math.min(n - 1, i)) : 0;
}

// Strip furigana ruby back to the base sentence. Port of core/text.js plainText (the <span> strip is
// a no-op on curated skeleton input — there are no tap-overlay spans server-side — but kept so the
// two implementations stay identical).
export function plainText(s: string): string {
    return String(s)
        .replace(/<rt>.*?<\/rt>/g, '')
        .replace(/<\/?ruby>/g, '')
        .replace(/<\/?span[^>]*>/g, '');
}

// Parse curated ruby markup into [{t, r?}] segments; concat(seg.t) === plainText(jp). Port of
// core/text.js rubyToSegments.
const RUBY_BLOCK = /<ruby>(.*?)<rt>(.*?)<\/rt><\/ruby>/g;
export function rubyToSegments(jp: string): FuriganaSeg[] {
    const s = String(jp);
    const segs: FuriganaSeg[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    RUBY_BLOCK.lastIndex = 0;
    while ((m = RUBY_BLOCK.exec(s))) {
        if (m.index > last) segs.push({ t: s.slice(last, m.index) }); // plain run before this ruby block
        segs.push(m[2] ? { t: m[1]!, r: m[2] } : { t: m[1]! });
        last = m.index + m[0].length;
    }
    if (last < s.length) segs.push({ t: s.slice(last) }); // trailing plain run
    return segs;
}

export interface RealizedCombo {
    jp: string; // realized skeleton with the picked fillers substituted (ruby preserved)
    text: string; // plainText(jp) — the audio key + the hash input
    furigana: FuriganaSeg[]; // rubyToSegments(jp); concat(seg.t) === text
    mean: string; // realized English
    role: string; // canonical combo key over ALL slots ('slotId:idx,…') — the sentence_link role
}

// Realize a template for `picks` (slotId → filler index; missing / out-of-range → 0): substitute the
// picked filler into each {slotId} marker, then derive text + furigana + English. Port of
// core/selftalk.js realizeTemplate. The `role` is built over EVERY slot in skeleton order (not just
// the keys the client sent), so the combo key is canonical regardless of which slots were explicitly
// picked — two requests for the same effective combo produce the same role (idempotent link).
export function realizeTemplate(
    template: { jp: string; en: string; slots: TemplateSlot[] },
    picks: Record<string, number>,
): RealizedCombo {
    const slots = template?.slots || [];
    const fill = (id: string, get: (f: { jp?: string; en?: string }) => string | undefined): string => {
        const s = slots.find((x) => x.id === id);
        if (!s) return '';
        return get((s.fillers || [])[templatePickIndex(s, picks)] || {}) || '';
    };
    const jp = String(template?.jp || '').replace(/\{(\w+)\}/g, (_, id: string) => fill(id, (f) => f.jp));
    const mean = String(template?.en || '').replace(/\{(\w+)\}/g, (_, id: string) => fill(id, (f) => f.en));
    const role = slots.map((s) => `${s.id}:${templatePickIndex(s, picks)}`).join(',');
    return { jp, text: plainText(jp), furigana: rubyToSegments(jp), mean, role };
}
