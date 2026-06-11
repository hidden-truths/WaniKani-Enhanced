// generate-tts — pre-generate Apple-voice TTS for study-app text that has no native
// audio, and upload it into our storage layer so /v1/tts serves it (preferring these
// .m4a clips over Google — see services/tts.ts ttsKey + the /v1/tts handler).
//
// What it voices (deduped by exact text, since the key is content-addressed):
//   • Card READINGS  — ttsText() for every built-in verb + every みんなの日本語 vocab item
//     (the text the study app already sends to /v1/tts via speakWord()).
//   • Example SENTENCES — the built-in leveled examples (examples.js), the Minna vocab
//     leveled examples, and the Minna grammar / lesson / conversation sentences. Ruby is
//     stripped to plain text (plainText), which is exactly what the client's sentence
//     play button requests — so the keys line up.
//
// Pipeline: collect text → skip what's already in storage → jp-tts (one batch, one synth
// process) renders .m4a into a temp dir → upload each to storage at ttsKey(text,'m4a').
//
// Run from wk-enhanced-api/ (loads .env → storage driver). To seed PROD, run with the
// prod S3_* env so getStorage() targets the real bucket. jp-tts must be built first:
//   swiftc -O scripts/jp-tts.swift -o scripts/jp-tts
//   bun scripts/generate-tts.ts [--voice Kyoko] [--rate 0.5] [--force] [--limit N] [--filter <substr>]
//     --force    re-generate + re-upload even if the clip is already in storage
//     --limit N  cap the number of clips generated this run (for a quick test)
//     --filter S only items whose label contains S (e.g. "reading", "mnn", "ex:")
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
// Cross-project imports into the study app — fine here: scripts/ is excluded from the
// server's tsconfig, and these modules are pure data / DOM-free helpers.
import { VERBS } from '../../study-app/src/data/verbs.js';
import { EXAMPLES } from '../../study-app/src/data/examples.js';
import { ttsText, plainText } from '../../study-app/src/core/text.js';
import { ttsKey } from '../src/services/tts.ts';
import { getStorage } from '../src/services/storage.ts';

const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(name);
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
};
const has = (name: string) => process.argv.includes(name);

const voice = arg('--voice') || 'Kyoko';
const rate = arg('--rate');
const force = has('--force');
const limit = arg('--limit') ? Number(arg('--limit')) : Infinity;
const filter = arg('--filter');

// --- Collect the text to voice (deduped; the /v1/tts route rejects text > 200 chars,
//     so a clip longer than that could never be played — skip it). ---
type Item = { text: string; label: string };
const items: Item[] = [];
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

let pool = filter ? items.filter(i => i.label.includes(filter)) : items;
console.log(`collected ${items.length} unique clip(s) (${skippedLong} skipped as >200 chars)` + (filter ? `; ${pool.length} match --filter ${filter}` : ''));

// --- Skip what's already in storage (unless --force). ---
const storage = getStorage();
const todo: { item: Item; key: string; out: string }[] = [];
const tmpDir = '/tmp/tts-gen';
mkdirSync(tmpDir, { recursive: true });
for (const item of pool) {
    if (todo.length >= limit) break;
    const key = ttsKey(item.text, 'm4a');
    if (!force && (await storage.exists(key))) continue;
    todo.push({ item, key, out: join(tmpDir, key.replace('tts/', '')) });
}
console.log(`${todo.length} to generate` + (force ? ' (--force: ignoring storage)' : `; ${pool.length - todo.length} skipped (already in storage${Number.isFinite(limit) ? ' or beyond --limit' : ''})`));
if (!todo.length) { console.log('nothing to do.'); process.exit(0); }

// --- Render with jp-tts (one batch → one synth process). ---
const bin = fileURLToPath(new URL('./jp-tts', import.meta.url));
if (!existsSync(bin)) {
    console.error(`jp-tts not built. Run:\n  swiftc -O scripts/jp-tts.swift -o scripts/jp-tts`);
    process.exit(2);
}
const manifestPath = join(tmpDir, 'manifest.json');
writeFileSync(manifestPath, JSON.stringify(todo.map(t => ({ text: t.item.text, out: t.out }))));
const jpArgs = ['--batch', manifestPath, '--voice', voice, ...(rate ? ['--rate', rate] : [])];
console.log(`jp-tts ${jpArgs.join(' ')}`);
const proc = Bun.spawn([bin, ...jpArgs], { stdout: 'inherit', stderr: 'inherit' });
await proc.exited;

// --- Upload the rendered clips to storage. ---
let uploaded = 0, missing = 0;
for (const t of todo) {
    if (!existsSync(t.out)) { missing++; continue; }
    const bytes = readFileSync(t.out);
    await storage.put(t.key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'audio/mp4');
    uploaded++;
}
console.log(`uploaded ${uploaded} clip(s) to storage` + (missing ? `; ${missing} failed to render` : ''));
process.exit(missing ? 1 : 0);
