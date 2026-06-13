// seed-annotations — load the offline GiNZA artifact (../sentence-nlp/parse.py output) into the
// sentence_annotation table. The server-side half of the NLP phase: the heavy parsing happens
// OFFLINE on a maintainer machine (no Python on the prod droplet); this just reads the committed
// JSON and upserts. Mirrors seed-sentences.ts.
//
// Each annotation is keyed by the sentence's content `hash` (= ttsTextHash(text)), which is
// environment-independent — so an artifact parsed offline on a Mac seeds PROD correctly (same text
// → same hash → resolves the prod row). The seed:
//   • resolves the public row by hash (getPublicSentenceByHash) — annotations target the public
//     corpus only, exactly what the offline batch can see;
//   • guards against a stale artifact (DB text must equal the artifact's echoed text);
//   • upserts via db.upsertAnnotation, which RE-ASSERTS the token offset contract against the real
//     V8 engine and THROWS on any mismatch — so a malformed artifact aborts the seed (and the
//     deploy) instead of landing bad offsets in prod.
// Idempotent: re-running replaces each row's annotation in place (no growth).
//
// Run from wk-enhanced-api/ so .env loads (→ DATABASE_FILE). To seed PROD, point DATABASE_FILE at
// the prod sqlite / run on the droplet AFTER seed-sentences.ts (the rows must exist first), same
// pattern as generate-tts.ts / seed-sentences.ts.
//   bun scripts/seed-annotations.ts
import { readFileSync } from 'node:fs';
import * as db from '../src/db/client.ts';

interface Artifact {
    parser: string;
    annotations: {
        hash: string;
        ext_id: string;
        text: string;
        tokens: db.AnnotationToken[];
        bunsetsu: db.AnnotationBunsetsu[];
        grammar: string[];
    }[];
}

const artifactPath = new URL('../data/annotations.json', import.meta.url);
const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as Artifact;

let seeded = 0;
let missing = 0;
let stale = 0;
let grammarRows = 0;
let grammarTags = 0;
for (const a of artifact.annotations) {
    const row = db.getPublicSentenceByHash(a.hash);
    if (!row) {
        // The sentence isn't in the store (corpus changed since the parse, or seed-sentences.ts
        // hasn't run). Skip rather than fail — annotations are additive.
        missing++;
        continue;
    }
    if (row.text !== a.text) {
        // The DB row's text disagrees with what was parsed for this hash — a stale artifact.
        // Skip it; its offsets are not trustworthy against the current text.
        stale++;
        console.warn(`stale artifact for hash ${a.hash.slice(0, 12)} (${a.ext_id}): DB text != artifact text — skipped`);
        continue;
    }
    try {
        db.upsertAnnotation({ sentenceId: row.id, tokens: a.tokens, bunsetsu: a.bunsetsu, parser: artifact.parser });
    } catch (err) {
        // The offset gate rejected this annotation — name the offender, then re-throw so the
        // deploy step fails loudly (a bad artifact must never silently land).
        console.error(`offset gate FAILED for ${a.ext_id} (hash ${a.hash.slice(0, 12)})`);
        throw err;
    }
    // Grammar tags go onto EXAMPLE rows only (source='example'). Self-Talk rows keep their
    // hand-authored grammar tags (curated, intentional) — we don't clobber them with GiNZA's.
    if (row.source === 'example') {
        db.setGrammarTags(row.id, a.grammar);
        if (a.grammar.length) grammarRows++;
        grammarTags += a.grammar.length;
    }
    seeded++;
}

console.log(
    `seeded ${seeded} annotations (${missing} not in store, ${stale} stale); ` +
        `${grammarTags} grammar tags on ${grammarRows} example rows — parser ${artifact.parser}`,
);
