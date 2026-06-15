// push-tts-variants — copy ALREADY-RENDERED tagged voice clips from the local media dir into a
// (usually prod) storage bucket, WITHOUT re-running `say`. The companion to generate-tts.ts: that
// script renders + uploads in one shot against whatever storage getStorage() resolves; this one
// skips rendering entirely and just ships the bytes you already made locally to a different bucket.
//
// Why this exists: rendering a Siri voice needs a macOS box with the right System Voice (see
// generate-tts.ts). Once you've rendered siri:male / siri:female locally (into dev-data/media), it's
// wasteful to render them a SECOND time just to seed prod — the bytes are identical. This pushes the
// local .m4a files straight to the prod bucket + records the audio_variants manifest rows.
//
// What it pushes: ONLY tagged voice variants under `audio/<provider>/<gender>/<hash>.m4a` (the
// generate-tts.ts --variant layout). It is scoped to a provider whitelist (default `siri`) so it can
// never sweep up the IK voice-actor media that also lives under `audio/<category>/…/*.mp3` — those
// are `.mp3` under category dirs (anime/games/…), never under a provider dir, and we only take `.m4a`.
// The legacy default-voice `tts/<hash>.{m4a,mp3}` clips are NOT touched (push those separately if ever
// needed — they're the smart-default tier, regenerated rarely).
//
// Everything the manifest row needs (text_hash, provider, gender, ext) is encoded in the file PATH,
// so we never need the source text — we read the bytes and derive the key from where the file sits.
//
// BYTES vs MANIFEST — they live in different places, so by default this touches ONLY the bytes:
//   • The .m4a BYTES are the thing that's usually wrong (a clip rendered with the wrong System
//     Voice). They live on THIS machine and go to S3 (reachable from anywhere). That's the default.
//   • The audio_variants MANIFEST row (what makes a voice show up in the Settings picker via
//     /v1/audio/variants) lives in the TARGET env's sqlite — which a push run from your Mac CANNOT
//     reach (DATABASE_FILE would just hit your LOCAL dev DB). So this script does NOT touch the
//     manifest at all; seeding it is seed-audio-variants.ts's job, run ON THE DROPLET against the
//     prod DB (see that script + deploy/README.md). Push the bytes here, seed the manifest there.
//
// Usage — run from wk-enhanced-api/, typically on the Mac that rendered the clips. SOURCE is always
// the LOCAL media dir; DESTINATION is whatever getStorage() resolves, so point STORAGE_DRIVER + S3_*
// at the target bucket:
//
//   # dry-run against prod (lists what WOULD push, no writes):
//   STORAGE_DRIVER=s3 S3_ENDPOINT=… S3_BUCKET=… S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=… \
//   MEDIA_PUBLIC_BASE=… bun scripts/push-tts-variants.ts --dry-run
//
//   # real push, OVERWRITING whatever's in prod (use --force to RE-VOICE clips that were seeded
//   # with the wrong System Voice — without it, existing keys are skipped):
//   STORAGE_DRIVER=s3 … bun scripts/push-tts-variants.ts --force
//
//   flags:
//     --src-dir D       local media root to read from        (default: config.storage.localDir)
//     --provider P      provider dir to scan under audio/     (default: siri)
//     --variant V       only this '<provider>:<gender>' slice (e.g. siri:male); overrides --provider
//     --force           overwrite a key that already exists in the destination (REQUIRED to re-voice)
//     --limit N         cap clips pushed this run (for a quick test)
//     --dry-run         report what would push; no uploads
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/config.ts';
import { getStorage } from '../src/services/storage.ts';

import { arg, has } from './lib/args.ts';

const srcDir = arg('--src-dir') || config.storage.localDir;
const variant = arg('--variant'); // '<provider>:<gender>' — narrows to one slice
const [vProvider, vGender] = variant ? variant.split(':') : [undefined, undefined];
const provider = vProvider || arg('--provider') || 'siri';
const force = has('--force');
const dryRun = has('--dry-run');
const limit = arg('--limit') ? Number(arg('--limit')) : Infinity;

// Map an on-disk gender dir to the manifest's gender value ('default' dir → '' the schema default).
const genderOf = (dir: string) => (dir === 'default' ? '' : dir);

// --- Collect the tagged .m4a clips under <src>/audio/<provider>/<gender>/. ---
type Clip = { key: string; path: string; gender: string };
const clips: Clip[] = [];
const providerRoot = join(srcDir, 'audio', provider);
if (!existsSync(providerRoot)) {
    console.error(`no tagged clips found: ${providerRoot} does not exist (nothing rendered for provider '${provider}'?)`);
    process.exit(1);
}
const genderDirs = readdirSync(providerRoot).filter(g => {
    if (!statSync(join(providerRoot, g)).isDirectory()) return false;
    return vGender ? g === (vGender || 'default') : true; // --variant narrows to one gender dir
});
for (const gdir of genderDirs) {
    const dir = join(providerRoot, gdir);
    for (const f of readdirSync(dir)) {
        if (!f.endsWith('.m4a')) continue; // tagged variants are always .m4a; ignore anything else
        clips.push({
            key: `audio/${provider}/${gdir}/${f}`, // mirrors ttsVariantKey() byte-for-byte
            path: join(dir, f),
            gender: genderOf(gdir),
        });
    }
}
console.log(`found ${clips.length} tagged clip(s) under ${providerRoot}` + (variant ? ` (filter ${variant})` : ` (genders: ${genderDirs.join(', ')})`));
if (!clips.length) { console.log('nothing to push.'); process.exit(0); }

// --- Push each to the destination storage + record the manifest row. ---
const storage = getStorage();
let pushed = 0, skipped = 0;
for (const c of clips) {
    if (pushed + skipped >= limit) break;
    if (!force && (await storage.exists(c.key))) {
        skipped++;
        continue; // already there — pass --force to RE-VOICE (overwrite) a wrong-voiced clip
    }
    if (dryRun) {
        console.log(`would push ${c.key} (${provider}:${c.gender || 'default'})`);
        pushed++;
        continue;
    }
    const bytes = readFileSync(c.path);
    await storage.put(c.key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'audio/mp4');
    pushed++;
}
const verb = dryRun ? 'would push' : 'pushed';
console.log(`${verb} ${pushed} clip(s)` + (skipped ? `; ${skipped} skipped (already in destination — pass --force to overwrite)` : '') + (dryRun ? ' [DRY RUN — no writes]' : ''));
process.exit(0);
