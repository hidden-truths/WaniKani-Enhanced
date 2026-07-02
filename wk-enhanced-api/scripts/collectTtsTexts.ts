// Shared enumeration of the Japanese text the study app sends to /v1/tts — the SINGLE source of
// truth for "which strings get a synth clip." Used by:
//   • generate-tts.ts        — renders + uploads a clip per text (optionally per --variant voice).
//   • seed-audio-variants.ts — records the audio_variants manifest row per text that's in storage.
// Keeping both on this one function means the rendered clips and the manifest catalog can't drift
// apart (add a card → both scripts pick it up the next run).
//
// What it voices (deduped by exact text, since the audio key is content-addressed):
//   • Card READINGS  — ttsText() for every built-in verb + every みんなの日本語 vocab item.
//   • Example SENTENCES — built-in leveled examples (examples.js), Minna vocab leveled examples,
//     and the Minna grammar / lesson / conversation sentences. Ruby is stripped to plain text
//     (plainText), which is exactly what the client's sentence play button requests.
//   • 独り言 SELF-TALK — every built-in phrase (selftalk.js) AND every slot-swap TEMPLATE combo
//     (realizeTemplate over the full cartesian product of each template's fillers — the same text a
//     materialized combo row carries, so the pre-rendered clip serves it). These otherwise fall back
//     to lazy Google TTS at play time; enumerating them here gives the nicer pre-generated voice.
// Text > 200 chars is skipped: the /v1/tts route rejects it, so a clip that long could never play.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
// Cross-project imports into the study app — fine here: scripts/ is excluded from the server's
// tsconfig, and these modules are pure data / DOM-free helpers.
import { VERBS } from '../../study-app/src/data/verbs.js';
import { EXAMPLES } from '../../study-app/src/data/examples.js';
import { SELFTALK } from '../../study-app/src/data/selftalk.js';
import { SELFTALK_TEMPLATES } from '../../study-app/src/data/selftalk-templates.js';
import { GRAMMAR_N3 } from '../../study-app/src/data/grammar-n3.js';
import { ttsText, plainText } from '../../study-app/src/core/text.js';
import { realizeTemplate } from '../../study-app/src/core/selftalk.js';

export type TtsItem = { text: string; label: string };

// Returns the deduped text list + how many were dropped for exceeding the 200-char /v1/tts limit
// (callers log the skip count). Does the filesystem reads (Minna lessons) lazily, on call.
export function collectTtsTexts(): { items: TtsItem[]; skippedLong: number } {
    const items: TtsItem[] = [];
    const seen = new Set<string>();
    let skippedLong = 0;
    function add(text: string, label: string) {
        text = (text || '').trim();
        if (!text) return;
        if (text.length > 200) { skippedLong++; return; }
        if (seen.has(text)) return;
        seen.add(text);
        items.push({ text, label });
    }

    for (const v of VERBS as any[]) add(ttsText(v), `reading:builtin:${v.jp}`);
    for (const rank of Object.keys(EXAMPLES as any)) {
        const tiers = (EXAMPLES as any)[rank];
        for (const tier of Object.keys(tiers)) add(plainText(tiers[tier][0]), `ex:builtin:${rank}:${tier}`);
    }

    const minnaDir = fileURLToPath(new URL('../data/minna/', import.meta.url));
    for (const f of readdirSync(minnaDir).filter(f => /^lesson-\d+\.json$/.test(f))) {
        const L = JSON.parse(readFileSync(join(minnaDir, f), 'utf8'));
        for (const v of L.vocab || []) {
            add(ttsText({ jp: v.dict || v.kanji || v.kana, read: v.dictRead || v.kana, tts: v.tts }), `reading:mnn:${v.key}`);
            if (v.levels) for (const tier of Object.keys(v.levels)) add(plainText(v.levels[tier][0]), `ex:mnn:${v.key}:${tier}`);
        }
        for (const g of L.grammar || []) for (const e of g.examples || []) add(plainText(e.jp), `gram:${f}`);
        for (const e of L.examples || []) add(plainText(e.jp), `ex:${f}`);
        for (const ln of (L.conversation?.lines || [])) add(plainText(ln.jp), `conv:${f}`);
    }

    // 独り言 Self-Talk: built-in phrases + EVERY slot-swap template combo. Both are otherwise unvoiced
    // (lazy Google TTS at play time); pre-rendering them gives the nicer voice. Combos are enumerated
    // from the bundle (not the DB's materialized subset) so all of them get a clip regardless of what's
    // been played — realizeTemplate yields the SAME plain text a materialized combo row carries.
    for (const p of SELFTALK as any[]) add(plainText(p.jp), `st:phrase:${p.id}`);
    for (const t of SELFTALK_TEMPLATES as any[]) {
        const slots = t.slots || [];
        // Mixed-radix odometer over the slots' filler indices → the full cartesian product of combos.
        const idx = slots.map(() => 0);
        for (;;) {
            const picks: Record<string, number> = {};
            slots.forEach((s: any, k: number) => { picks[s.id] = idx[k]; });
            add(realizeTemplate(t, picks).text, `st:combo:${t.id}`);
            let k = slots.length - 1;
            for (; k >= 0; k--) {
                const n = (slots[k].fillers || []).length || 1;
                if (++idx[k] < n) break;
                idx[k] = 0;
            }
            if (k < 0) break; // odometer wrapped past the first slot → all combos enumerated
        }
    }

    // N3 grammar-catalog example sentences (the cloze drill's answer-face ▶ plays these; the
    // rows also live in the store via seed-sentences Pass 5, same plainText key either way).
    for (const p of GRAMMAR_N3 as any[]) {
        (p.examples || []).forEach((ex: any, i: number) => add(plainText(ex.jp), `gp:${p.id}:${i}`));
    }

    return { items, skippedLong };
}
