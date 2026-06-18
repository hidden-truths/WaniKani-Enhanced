// verify-prod — READ-ONLY post-deploy check: does prod actually serve everything we seed/push from
// data/ + the study-app bundles? Answers "is prod in sync with my local content?" in one command.
//
// It makes ONLY anonymous GETs against the public read endpoints (no cookie, no admin token, no S3 /
// DB creds, no .env needed) and compares what prod returns to what's authored locally:
//   • health      — /v1/health                              (status ok + warmed-word count)
//   • songs       — /v1/songs                       vs data/songs/*.json (by ext id; 0-line scaffolds skipped)
//   • selftalk    — /v1/sentences?ownerType=selftalk        vs SELFTALK
//   • examples    — /v1/sentences?ownerType=card            vs EXAMPLES (rank×tier) link count
//   • annotations — /v1/sentences?ownerType=card&annotate=1 (how many card rows carry GiNZA tokens)
//   • templates   — /v1/templates                  vs SELFTALK_TEMPLATES
//   • voices      — /v1/audio/variants?text=  for a SAMPLE of collectTtsTexts(): are siri:male+female live?
//
// SCOPE LIMITS (deliberate — be honest about them):
//   • Voices are SAMPLED over HTTP, not exhaustive. The catalog endpoint is per-text, so this probes N
//     of them (default 24; --sample N, or --full for all of collectTtsTexts() — slower, ~1175 GETs).
//     For an AUTHORITATIVE full byte+manifest reconcile, run seed-audio-variants.ts ON THE DROPLET (it
//     checks storage.exists() per clip). A green sample here means "the push + manifest path is working";
//     a red one names exactly which texts are missing a voice.
//   • Bytes-only surfaces with no public catalog (default-voice tts/<hash> clips, Minna native MP3s)
//     can't be counted anonymously — noted, not asserted.
//   • Gated content (Minna lessons, /v1/audio/native) needs a cookie — out of scope for this anon check.
//
// Exit code: 0 if everything authored locally is present on prod, 1 if any drift (a missing song, prod
// count < local, a sampled voice absent) — so it's safe to wire into a deploy script or a cron heartbeat.
//
// Run from wk-enhanced-api/ (reads local files + hits the network; needs no env):
//   bun scripts/verify-prod.ts                                # check prod (api.wkenhanced.dev)
//   bun scripts/verify-prod.ts --base http://localhost:3000   # check a local/dev server instead
//   bun scripts/verify-prod.ts --sample 60                    # bigger voice sample
//   bun scripts/verify-prod.ts --full                         # exhaustive voice probe (every text)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
// Cross-project imports into the study app — same pattern as the other operator scripts (scripts/ is
// excluded from the server tsconfig; these are pure data / DOM-free helpers). collectTtsTexts is the
// SAME enumeration generate-tts.ts / seed-audio-variants.ts use, so the voice sample can't drift from
// what we actually render. None of these pull in config / DB / S3 / @anthropic-ai/sdk, so this script
// stays standalone (unlike seed-songs.ts — see its header).
import { SELFTALK } from '../../study-app/src/data/selftalk.js';
import { EXAMPLES } from '../../study-app/src/data/examples.js';
import { SELFTALK_TEMPLATES } from '../../study-app/src/data/selftalk-templates.js';
import { collectTtsTexts } from './collectTtsTexts.ts';
import { arg, has } from './lib/args.ts';

const BASE = (arg('--base') || 'https://api.wkenhanced.dev').replace(/\/+$/, '');
const sampleSize = Number(arg('--sample')) || 24;
const full = has('--full');

let failures = 0;
const pass = (m: string) => console.log(`  ✓ ${m}`);
const fail = (m: string) => { console.log(`  ✗ ${m}`); failures++; };
const note = (m: string) => console.log(`  · ${m}`);

async function getJson(path: string): Promise<any> {
    const res = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
    return res.json();
}

// Evenly spread a sample across a list (not just the first N) so a gap anywhere is likelier to be caught.
function sampleEvenly<T>(arr: T[], n: number): T[] {
    if (n >= arr.length) return arr;
    const step = arr.length / n;
    const out: T[] = [];
    for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
    return out;
}

console.log(`verify-prod → ${BASE}\n`);

// ---- health ----
console.log('health');
try {
    const h = await getJson('/v1/health');
    h.status === 'ok' ? pass(`status ok · ${h.warmedWords ?? '?'} warmed words`) : fail(`status=${h.status}`);
} catch (e: any) { fail(e.message); }

// ---- songs: every seedable data/songs/*.json must appear in /v1/songs (matched by ext id) ----
console.log('\nsongs (data/songs → /v1/songs)');
try {
    const songDir = fileURLToPath(new URL('../data/songs/', import.meta.url));
    const timingDir = fileURLToPath(new URL('../data/song-timing/', import.meta.url));
    const local = readdirSync(songDir).filter(f => f.endsWith('.json')).map(f => {
        const s = JSON.parse(readFileSync(join(songDir, f), 'utf8'));
        return { extId: s.extId as string, lines: s.lines?.length ?? 0, timed: existsSync(join(timingDir, f)) };
    });
    const seedable = local.filter(s => s.lines > 0); // 0-line scaffolds aren't seeded (seed-songs skips them)
    const scaffolds = local.length - seedable.length;
    const prod = await getJson('/v1/songs');
    const byId = new Map<string, any>((prod.songs ?? []).map((s: any) => [s.id, s]));

    const missing = seedable.filter(s => !byId.has(s.extId));
    missing.length
        ? fail(`${missing.length} song(s) MISSING on prod: ${missing.map(s => s.extId).join(', ')} — run seed-songs.ts`)
        : pass(`all ${seedable.length} seedable song(s) present${scaffolds ? ` (${scaffolds} scaffold(s) skipped)` : ''}`);

    // A song that has a local timing sidecar should come back fully timed (timedCount === lineCount).
    const withSidecar = seedable.filter(s => s.timed);
    const untimed = withSidecar.filter(s => byId.has(s.extId) && byId.get(s.extId).timedCount < byId.get(s.extId).lineCount);
    untimed.length
        ? fail(`${untimed.length} song(s) have a local timing sidecar but aren't fully timed on prod: ${untimed.map(s => s.extId).join(', ')}`)
        : pass(`timing in sync (${withSidecar.length} song(s) with sidecars, all fully timed on prod)`);

    const extra = (prod.songs ?? []).filter((s: any) => !s.custom && !seedable.some(l => l.extId === s.id));
    if (extra.length) note(`prod has ${extra.length} public song(s) not in your working tree (prod ahead of local?): ${extra.map((s: any) => s.id).join(', ')}`);
} catch (e: any) { fail(e.message); }

// ---- sentences: selftalk phrases + card example links (anon → public rows only) ----
console.log('\nsentences (bundles → /v1/sentences)');
try {
    const stProd = ((await getJson('/v1/sentences?ownerType=selftalk')).sentences ?? []).length;
    const stLocal = (SELFTALK as any[]).length;
    stProd >= stLocal
        ? pass(`selftalk: ${stProd} on prod ≥ ${stLocal} local${stProd > stLocal ? ' (prod ahead)' : ''}`)
        : fail(`selftalk: ${stProd} on prod < ${stLocal} local — under-seeded (run seed-sentences.ts)`);

    const cardProd = ((await getJson('/v1/sentences?ownerType=card')).sentences ?? []).length;
    let links = 0;
    for (const tiers of Object.values(EXAMPLES as any)) links += Object.keys(tiers as any).length;
    cardProd >= links
        ? pass(`examples: ${cardProd} link(s) on prod ≥ ${links} local`)
        : fail(`examples: ${cardProd} on prod < ${links} local — under-seeded (run seed-sentences.ts)`);

    const annRows = (await getJson('/v1/sentences?ownerType=card&annotate=1')).sentences ?? [];
    const annotated = annRows.filter((s: any) => s.annotation).length;
    annotated > 0
        ? pass(`annotations: ${annotated}/${annRows.length} card sentence(s) carry GiNZA tokens`)
        : fail(`annotations: 0 card sentences carry tokens — seed-annotations.ts not run?`);
} catch (e: any) { fail(e.message); }

// ---- templates ----
console.log('\ntemplates (SELFTALK_TEMPLATES → /v1/templates)');
try {
    const prodT = ((await getJson('/v1/templates')).templates ?? []).length;
    const localT = (SELFTALK_TEMPLATES as any[]).length;
    prodT >= localT
        ? pass(`${prodT} on prod ≥ ${localT} local${prodT > localT ? ' (prod ahead)' : ''}`)
        : fail(`${prodT} on prod < ${localT} local — under-seeded (run seed-sentences.ts)`);
} catch (e: any) { fail(e.message); }

// ---- voices: sample collectTtsTexts() against /v1/audio/variants (siri male + female) ----
console.log('\nvoices (sampled /v1/audio/variants — siri:male + siri:female)');
try {
    const { items } = collectTtsTexts();
    const pool = full ? items : sampleEvenly(items, Math.min(sampleSize, items.length));
    const missing: string[] = [];
    let okCount = 0;
    const CONC = 8; // small concurrency — stay a polite client (these are no-store endpoints)
    for (let i = 0; i < pool.length; i += CONC) {
        const results = await Promise.all(pool.slice(i, i + CONC).map(async it => {
            try {
                const v = await getJson(`/v1/audio/variants?text=${encodeURIComponent(it.text)}`);
                const live = new Set((v.variants ?? []).filter((x: any) => x.available).map((x: any) => x.id));
                return live.has('siri:male') && live.has('siri:female') ? null : it.text;
            } catch { return it.text; }
        }));
        for (const r of results) { if (r) missing.push(r); else okCount++; }
    }
    const scope = full ? `all ${items.length}` : `${pool.length} of ${items.length} sampled`;
    missing.length === 0
        ? pass(`${okCount}/${pool.length} texts have siri:male+female (${scope})`)
        : fail(`${missing.length}/${pool.length} sampled texts MISSING a siri voice — e.g. ${missing.slice(0, 5).map(t => JSON.stringify(t)).join(', ')}${missing.length > 5 ? ' …' : ''}`);
    if (!full) note(`sample only — for a full byte+manifest reconcile run seed-audio-variants.ts ON THE DROPLET`);
    note(`default-voice (tts/<hash>) clips + Minna native MP3s have no public catalog — not checked here`);
} catch (e: any) { fail(e.message); }

// ---- summary ----
console.log('');
if (failures === 0) {
    console.log('✓ prod is in sync with local content');
    process.exit(0);
}
console.log(`✗ ${failures} check(s) failed — see above`);
process.exit(1);
