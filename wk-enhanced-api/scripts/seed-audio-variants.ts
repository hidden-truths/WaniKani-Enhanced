// seed-audio-variants — populate the `audio_variants` MANIFEST (the catalog GET /v1/audio/variants
// reads, which drives the study app's Settings voice picker) for tagged voice clips that are already
// in storage. This is the manifest HALF of seeding a voice; push-tts-variants.ts / generate-tts.ts
// own the BYTES half.
//
// Why a separate script: a clip's bytes live in the (S3) bucket, but its manifest row lives in the
// env's sqlite. When you push clips from your Mac to the prod bucket (push-tts-variants.ts) you can't
// reach the droplet's DB, so the Settings picker still shows the voice as "not generated" even though
// the audio is there. Run THIS on the droplet (repo mounted, prod env_file → DATABASE_FILE + S3 creds)
// — exactly like seed-sentences.ts — to write the rows where /v1/audio/variants reads them.
//
// How it knows what to record, with no input from your Mac: it re-derives the exact text set via the
// shared collectTtsTexts() (same enumeration generate-tts.ts renders from, so they can't drift), and
// for each (text, gender) checks storage.exists(ttsVariantKey(...)) against the bucket — recording a
// manifest row ONLY for a clip that's actually present. So it's self-correcting (never advertises a
// voice whose bytes aren't there) and idempotent (insertAudioVariant is an upsert). Re-run any time.
//
// Usage — run wherever DATABASE_FILE points at the target DB AND the S3_* env points at the bucket
// holding the clips (on the droplet, via the same `docker compose run -v /opt/wk-enhanced-api:/repo`
// pattern as seed-sentences.ts — see deploy/README.md):
//   bun scripts/seed-audio-variants.ts [--provider siri] [--genders male,female] [--limit N]
//     --provider P   provider tag to seed         (default: siri)
//     --genders G    comma-sep gender list        (default: male,female; '' / 'default' allowed)
//     --limit N      cap rows examined this run    (for a quick test)
import { collectTtsTexts } from './collectTtsTexts.ts';
import { ttsVariantKey, ttsTextHash } from '../src/services/tts.ts';
import { getStorage } from '../src/services/storage.ts';
import * as db from '../src/db/client.ts';

import { arg } from './lib/args.ts';

const provider = arg('--provider') || 'siri';
// 'default' is the schema's empty-gender sentinel — accept it as an alias for ''.
const genders = (arg('--genders') || 'male,female').split(',').map(g => (g.trim() === 'default' ? '' : g.trim()));
const limit = arg('--limit') ? Number(arg('--limit')) : Infinity;

const { items } = collectTtsTexts();
const pool = Number.isFinite(limit) ? items.slice(0, limit) : items;
console.log(`enumerated ${items.length} text(s); checking ${pool.length} × [${genders.map(g => g || 'default').join(', ')}] for provider '${provider}'`);

const storage = getStorage();
// Per gender: how many clips are present (→ manifest row written) vs absent in the bucket.
const present: Record<string, number> = {};
const absent: Record<string, number> = {};
for (const g of genders) { present[g] = 0; absent[g] = 0; }

for (const item of pool) {
    // ttsVariantKey embeds ttsTextHash(text) as the object's basename, so the manifest's text_hash
    // is exactly that — same function, guaranteed to match the stored object.
    const hash = ttsTextHash(item.text);
    for (const g of genders) {
        if (await storage.exists(ttsVariantKey(item.text, provider, g, 'm4a'))) {
            db.insertAudioVariant(hash, provider, g, 'm4a'); // idempotent upsert
            present[g]++;
        } else {
            absent[g]++;
        }
    }
}

for (const g of genders) {
    console.log(`  ${provider}:${g || 'default'} → recorded ${present[g]} present` + (absent[g] ? `, ${absent[g]} not in storage (skipped)` : ''));
}
process.exit(0);
