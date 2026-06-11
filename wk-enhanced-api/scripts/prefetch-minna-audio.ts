// prefetch-minna-audio — proactively download every みんなの日本語 native-audio file
// referenced by the curated lessons into OUR storage layer, so we never depend on (or
// lazily round-trip to) vnjpclub.com at play time. The /v1/minna/audio route already
// caches on first play; this just does it up front for the whole catalogue, and makes us
// resilient if vnjpclub goes away.
//
// Mirrors the route's caching EXACTLY: keys.minnaAudio(path) → storage.put(…, 'audio/mpeg').
// Polite to the upstream (a delay between fetches; vnjpclub is a free community resource).
//
// Run from wk-enhanced-api/ (loads .env → storage driver). Use the prod S3_* env to seed
// the prod bucket.
//   bun scripts/prefetch-minna-audio.ts [--lesson N] [--force] [--delay 400] [--dry-run]
//     --lesson N  only this lesson (default: all curated lessons)
//     --force     re-download even if already in storage
//     --delay ms  pause between UPSTREAM fetches (default 400; cache hits don't pause)
//     --dry-run   list what would be fetched, touch nothing
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { getStorage, keys } from '../src/services/storage.ts';
import { fetchMinnaAudio, isValidMinnaAudioPath } from '../src/services/minnaAudio.ts';
import { sleep } from '../src/lib/sleep.ts';

const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(name);
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
};
const has = (name: string) => process.argv.includes(name);

const onlyLesson = arg('--lesson');
const force = has('--force');
const dryRun = has('--dry-run');
const delayMs = arg('--delay') ? Number(arg('--delay')) : 400;

// Collect every audio path the lessons reference (vocab + the whole-conversation file).
const minnaDir = fileURLToPath(new URL('../data/minna/', import.meta.url));
const files = readdirSync(minnaDir)
    .filter(f => /^lesson-\d+\.json$/.test(f))
    .filter(f => !onlyLesson || f === `lesson-${onlyLesson}.json`);

const paths = new Set<string>();
let invalid = 0;
for (const f of files) {
    const L = JSON.parse(readFileSync(join(minnaDir, f), 'utf8'));
    const add = (p: unknown) => {
        if (!p) return;
        if (isValidMinnaAudioPath(p)) paths.add(p);
        else { invalid++; console.warn(`  skip invalid audio path in ${f}: ${p}`); }
    };
    for (const v of L.vocab || []) add(v.audio);
    add(L.conversation?.audio);
}
console.log(`${files.length} lesson(s), ${paths.size} unique audio file(s)${invalid ? `, ${invalid} invalid skipped` : ''}`);

const storage = getStorage();
let fetched = 0, cached = 0, failed = 0;
for (const p of paths) {
    const key = keys.minnaAudio(p);
    if (!force && (await storage.exists(key))) { cached++; continue; }
    if (dryRun) { console.log(`  would fetch ${p}`); fetched++; continue; }
    const bytes = await fetchMinnaAudio(p);
    if (!bytes) { failed++; console.warn(`  FAILED ${p}`); continue; }
    await storage.put(key, bytes, 'audio/mpeg', { acl: 'private' });   // gated content — never public
    fetched++;
    console.log(`  cached ${p} (${(bytes.byteLength / 1024).toFixed(0)} KB)`);
    if (delayMs > 0) await sleep(delayMs);   // be polite to vnjpclub
}

console.log(dryRun
    ? `dry-run: ${fetched} would be fetched, ${cached} already in storage`
    : `done: ${fetched} downloaded, ${cached} already cached${failed ? `, ${failed} failed` : ''}`);
process.exit(failed ? 1 : 0);
