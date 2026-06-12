// seed-sentences — seed the built-in 独り言 Self-Talk phrases into the unified sentence store
// as PUBLIC rows (public=1, visibility='public', created_by=NULL). Idempotent by ext_id: a
// re-run replaces each row + its child translation/tag/link rows with no growth
// (db.upsertPublicSentence). User-authored phrases are NOT seeded here — those are written
// live via POST /v1/sentences.
//
// This is the seed→DB step that makes the store the runtime source of truth while keeping the
// git-tracked study-app bundle (data/selftalk.js) as the curator authoring source. Cross-
// project import into the study app is the norm for operator scripts (see generate-tts.ts);
// scripts/ is excluded from the server tsconfig and these modules are pure data / DOM-free.
//
// Run from wk-enhanced-api/ so .env loads (→ DATABASE_FILE). To seed PROD, point DATABASE_FILE
// at the prod sqlite (or run on the droplet) with the prod env, same pattern as generate-tts.ts.
//   bun scripts/seed-sentences.ts
import { SELFTALK } from '../../study-app/src/data/selftalk.js';
import { plainText, rubyToSegments } from '../../study-app/src/core/text.js';
import * as db from '../src/db/client.ts';

let seeded = 0;
for (const p of SELFTALK) {
    const text = plainText(p.jp);
    const furigana = rubyToSegments(p.jp);
    // Belt-and-suspenders: upsertPublicSentence also enforces this, but checking here names the
    // offending phrase if the bundle's furigana ever drifts.
    const concat = furigana.map((s) => s.t).join('');
    if (concat !== text) {
        console.error(`furigana mismatch for ${p.id}: ${JSON.stringify(concat)} !== ${JSON.stringify(text)}`);
        process.exit(1);
    }
    db.upsertPublicSentence({
        extId: p.id,
        text,
        furigana,
        source: 'selftalk',
        translations: { en: p.mean },
        tags: { scene: p.scene, grammar: p.grammar || [] },
        link: { owner_type: 'selftalk' },
    });
    seeded++;
}
console.log(`seeded ${seeded} Self-Talk built-in phrases into the sentence store`);
