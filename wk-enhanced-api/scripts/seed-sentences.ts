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
// git-tracked study-app bundles (data/selftalk.js, data/examples.js) as the curator authoring
// source. Cross-project import into the study app is the norm for operator scripts (see
// generate-tts.ts); scripts/ is excluded from the server tsconfig and these modules are pure
// data / DOM-free.
//
// Run from wk-enhanced-api/ so .env loads (→ DATABASE_FILE). To seed PROD, point DATABASE_FILE
// at the prod sqlite (or run on the droplet) with the prod env, same pattern as generate-tts.ts.
//   bun scripts/seed-sentences.ts
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
