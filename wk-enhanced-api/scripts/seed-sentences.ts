// seed-sentences — seed the built-in curator content into the store as PUBLIC rows
// (public=1, visibility='public', created_by=NULL). Three passes:
//   1. 独り言 Self-Talk phrases (Phase 1) — one `sentence` row each, idempotent by ext_id
//      (db.upsertPublicSentence).
//   2. Built-in vocab EXAMPLE sentences (Phase 2) — leveled `sentence` rows linked to cards
//      (owner_type='card', owner_id=<rank>, tier='N5'..'N1'), idempotent by hash + card link
//      (db.seedExampleSentence). Identical text shared by several cards/tiers is ONE row + many
//      links (reuse, not duplication).
//   3. 独り言 Self-Talk slot-swap TEMPLATES — the generator STRUCTURE into the separate
//      `sentence_template` table (db.upsertPublicTemplate, idempotent by ext_id). A template has
//      no single fixed text/hash, so it isn't a `sentence` row; its realizations become sentence
//      rows lazily in a later slice. See ../../SENTENCE_STORE_TEMPLATES.md.
// User-authored content is NOT seeded here — those are written live via /v1/sentences (templates
// have no authoring path yet — curator-only).
//
// This is the seed→DB step that makes the store the runtime source of truth while keeping the
// git-tracked study-app bundles (study-app/src/data/{selftalk,examples,selftalk-templates}.js)
// as the curator authoring source. Cross-project import into the study app is the norm for operator scripts (see
// generate-tts.ts); scripts/ is excluded from the server tsconfig and these modules are pure
// data / DOM-free.
//
// Run from wk-enhanced-api/ so .env loads (→ DATABASE_FILE). To seed PROD, point DATABASE_FILE
// at the prod sqlite (or run on the droplet) with the prod env, same pattern as generate-tts.ts.
//   bun scripts/seed-sentences.ts
import { readdirSync, readFileSync } from 'node:fs';
import { SELFTALK } from '../../study-app/src/data/selftalk.js';
import { EXAMPLES } from '../../study-app/src/data/examples.js';
import { SELFTALK_TEMPLATES } from '../../study-app/src/data/selftalk-templates.js';
import { plainText, rubyToSegments } from '../../study-app/src/core/text.js';
import * as db from '../src/db/client.ts';

// concat(seg.t) must reconstruct text — the structural-furigana invariant (the store enforces it
// too, but checking here names the offending source if the bundle ever drifts).
function furiganaFor(jp: string, label: string): { t: string; r?: string }[] {
    const text = plainText(jp);
    const furigana = rubyToSegments(jp);
    const concat = furigana.map((s) => s.t).join('');
    if (concat !== text) {
        console.error(`furigana mismatch for ${label}: ${JSON.stringify(concat)} !== ${JSON.stringify(text)}`);
        process.exit(1);
    }
    return furigana;
}

// ---- Pass 1: 独り言 Self-Talk phrases → public rows ----
let phrases = 0;
for (const p of SELFTALK) {
    db.upsertPublicSentence({
        extId: p.id,
        text: plainText(p.jp),
        furigana: furiganaFor(p.jp, p.id),
        source: 'selftalk',
        translations: { en: p.mean },
        tags: { topic: p.topic, grammar: p.grammar || [], ...(p.thought ? { thought: p.thought } : {}) },
        link: { owner_type: 'selftalk' },
    });
    phrases++;
}
console.log(`seeded ${phrases} Self-Talk built-in phrases into the sentence store`);

// ---- Pass 2: built-in vocab EXAMPLE sentences → public rows linked to cards ----
// Group by plainText so identical sentences (shared across cards/tiers) collapse to ONE
// seedExampleSentence call carrying the full card-link set → one row + many links.
type ExGroup = { text: string; furigana: { t: string; r?: string }[]; en: string; links: db.SentenceLink[] };
const byText = new Map<string, ExGroup>();
let links = 0;
for (const [rank, tiers] of Object.entries(EXAMPLES)) {
    for (const [tier, pair] of Object.entries(tiers as Record<string, [string, string]>)) {
        const [jp, en] = pair;
        const text = plainText(jp);
        let g = byText.get(text);
        if (!g) {
            g = { text, furigana: furiganaFor(jp, `EXAMPLES[${rank}][${tier}]`), en, links: [] };
            byText.set(text, g);
        } else if (g.en !== en) {
            // Same Japanese, different English across cards — a data smell (the translation is on
            // the sentence, not the link, so the first one wins). Surface it; don't fail.
            console.warn(`reused sentence "${text}" has differing translations: keeping ${JSON.stringify(g.en)}, ignoring ${JSON.stringify(en)} (EXAMPLES[${rank}][${tier}])`);
        }
        g.links.push({ owner_type: 'card', owner_id: String(rank), tier, ordinal: 0 });
        links++;
    }
}
for (const g of byText.values()) {
    db.seedExampleSentence({ text: g.text, furigana: g.furigana, translations: { en: g.en }, cardLinks: g.links });
}
console.log(`seeded ${byText.size} example sentences (${links} links across ${Object.keys(EXAMPLES).length} cards) into the sentence store`);

// ---- Pass 3: 独り言 Self-Talk slot-swap TEMPLATES → public sentence_template rows ----
// The generator STRUCTURE only (skeleton + slots + fillers), idempotent by ext_id. Each filler-
// combo's furigana integrity is guarded by the study-app dataset test (test/core.test.ts), and
// realizations are materialized as sentence rows lazily in a later slice — neither happens here.
let templates = 0;
for (const t of SELFTALK_TEMPLATES) {
    db.upsertPublicTemplate({
        extId: t.id,
        source: 'selftalk',
        topic: t.topic,
        thought: t.thought ?? null,
        grammar: t.grammar || [],
        en: t.en,
        jp: t.jp,
        slots: t.slots,
    });
    templates++;
}
console.log(`seeded ${templates} Self-Talk slot-swap templates into the sentence_template table`);

// ---- Pass 4: みんなの日本語 (Minna) sentences → GATED store rows (public=0, Phase 3) ----
// Grammar-point examples, lesson examples, and conversation lines from the curated lesson JSON
// (data/minna/lesson-<n>.json) become sentence rows (source='minna', public=0 — copyright-gated;
// dark to getSentences, served only by the email-gated /v1/minna route via db.getMinnaAnnotations)
// linked by owner_type ∈ grammar_point|lesson|conversation. The row's existence is what lets the
// offline GiNZA batch attach tap-to-lookup tokens (sentence-nlp/parse.py now reads these too).
// ext_id is position-derived (`mnn-<lesson>-<type>-<idx>`), so re-seeding is idempotent.
const minnaDir = new URL('../data/minna/', import.meta.url);
let minnaCount = 0;
const seedMinna = (extId: string, jp: string, en: string, link: db.SentenceLink) => {
    if (!jp || typeof jp !== 'string') return;
    db.seedMinnaSentence({ extId, text: plainText(jp), furigana: furiganaFor(jp, extId), translations: en ? { en } : {}, link });
    minnaCount++;
};
const minnaFiles = readdirSync(minnaDir).filter((f) => /^lesson-\d+\.json$/.test(f)).sort();
for (const file of minnaFiles) {
    const n = Number(file.match(/lesson-(\d+)/)![1]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lesson = JSON.parse(readFileSync(new URL(file, minnaDir), 'utf8')) as any;
    (lesson.grammar ?? []).forEach((g: { examples?: { jp: string; en: string }[] }, gi: number) =>
        (g.examples ?? []).forEach((e, ei) =>
            seedMinna(`mnn-${n}-g${gi}-${ei}`, e.jp, e.en, { owner_type: 'grammar_point', owner_id: `mnn-${n}-g${gi}`, ordinal: ei })));
    (lesson.examples ?? []).forEach((e: { jp: string; en: string }, i: number) =>
        seedMinna(`mnn-${n}-ex-${i}`, e.jp, e.en, { owner_type: 'lesson', owner_id: String(n), ordinal: i }));
    (lesson.conversation?.lines ?? []).forEach((ln: { role?: string; jp: string; en: string }, i: number) =>
        seedMinna(`mnn-${n}-conv-${i}`, ln.jp, ln.en, { owner_type: 'conversation', owner_id: `mnn-${n}-conv`, role: ln.role ?? null, ordinal: i }));
}
console.log(`seeded ${minnaCount} みんなの日本語 sentences (gated, public=0) from ${minnaFiles.length} lessons into the sentence store`);
