// curate-song — ONE command to add a curated starter song, end to end. Wraps the three steps that
// were previously run by hand (analyze → time → seed) so adding a song is a single invocation:
//
//   1. ANALYZE  pasted lyrics with the Claude pass (services/songAnalyze.ts analyzeLyrics) →
//               per-line furigana / English / grammar / JLPT tokens.
//   2. WRITE    data/songs/<slug>.json in the seed format (the same file the Add flow would persist),
//               via the pure analyzedToSeedFile() below.
//   3. TIME     shell ../song-align/align.py --song <slug> → data/song-timing/<slug>.json (optional;
//               needs the song-align venv + YouTube cookies — see song-align/README.md).
//   4. SEED     shell `bun scripts/seed-songs.ts` → merge lyrics + timing into the DB.
//
// The lyric TEXT is maintainer-supplied (a file you pass in); this only ANNOTATES it — it never
// sources or scrapes lyrics. The analysis is model-generated, so flagged lines are printed for a
// proofread (the CLI analog of the Add-flow review step). Stanza `section` labels aren't auto-detected
// — hand-add them to the seed file if you want Verse/Chorus headings (optional; songs render flat).
//
// Run from wk-enhanced-api/ so .env loads (ANTHROPIC_API_KEY for the analyze step, DATABASE_FILE for
// the seed step):
//   bun scripts/curate-song.ts --slug dry-flower-yuuri --title ドライフラワー --artist 優里 \
//       --url https://www.youtube.com/watch?v=… --lyrics ~/Downloads/song-lyrics/dry-flower-yuuri.txt \
//       --browser safari
//
// Flags: --no-align (skip timing) · --no-seed (skip DB seed) · --no-vocals (faster align) ·
//        --force (overwrite an existing data/songs/<slug>.json) · --dry-run (validate + print, no writes).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { segmentsToRuby } from '../../study-app/src/core/text.js';
import { parseYouTubeId } from '../../study-app/src/core/songs.js';
import { analyzeLyrics, splitLyrics, isAnalysisConfigured, type AnalyzedSong } from '../src/services/songAnalyze.ts';

// ---- seed-file shapes (mirror SongFile in seed-songs.ts) ----
interface SeedToken { surface: string; lemma?: string; reading?: string; pos: string; jlpt?: string; gloss?: string; }
interface SeedLine { jp: string; en?: string; grammar?: string[]; tokens?: SeedToken[]; }
interface SeedFile { extId: string; title: string; artist?: string | null; youtubeId?: string | null; lines: SeedLine[]; }

// PURE: map the analyzer output → the data/songs/<slug>.json seed shape. jp = ruby (or the plain line
// when furigana was flagged/dropped); tokens drop their computed offsets (seed-songs recomputes them
// via the SAME offsetTokens, so they can't drift). Empty en/grammar/tokens are omitted to keep the
// file lean + matching the hand-authored starters. Exported + unit-tested — the only real logic here.
export function analyzedToSeedFile(
    meta: { slug: string; title: string; artist?: string | null; youtubeId?: string | null },
    analyzed: AnalyzedSong,
): SeedFile {
    return {
        extId: `song-${meta.slug}`,
        title: meta.title,
        artist: meta.artist ?? null,
        youtubeId: meta.youtubeId ?? null,
        lines: analyzed.lines.map((l) => {
            const line: SeedLine = { jp: l.furigana ? segmentsToRuby(l.furigana) : l.text };
            if (l.en) line.en = l.en;
            if (l.grammar.length) line.grammar = l.grammar;
            if (l.tokens.length) {
                line.tokens = l.tokens.map((t) => ({
                    surface: t.surface,
                    lemma: t.lemma,
                    reading: t.reading,
                    pos: t.pos,
                    ...(t.jlpt ? { jlpt: t.jlpt } : {}),
                    ...(t.gloss ? { gloss: t.gloss } : {}),
                }));
            }
            return line;
        }),
    };
}

// ---- tiny arg parser (--flag value / --bool) ----
function parseArgs(argv: string[]): Record<string, string | boolean> {
    const out: Record<string, string | boolean> = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) continue;
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) out[key] = true;
        else { out[key] = next; i++; }
    }
    return out;
}

function die(msg: string): never {
    console.error(`curate-song: ${msg}`);
    process.exit(1);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const slug = typeof args.slug === 'string' ? args.slug : '';
    const title = typeof args.title === 'string' ? args.title : '';
    const artist = typeof args.artist === 'string' ? args.artist : null;
    const lyricsPath = typeof args.lyrics === 'string' ? args.lyrics : '';
    const url = typeof args.url === 'string' ? args.url : '';
    const browser = typeof args.browser === 'string' ? args.browser : '';
    const dryRun = args['dry-run'] === true;
    const doAlign = args['no-align'] !== true;
    const doSeed = args['no-seed'] !== true;
    const vocals = args['no-vocals'] !== true;
    const force = args.force === true;

    if (!slug || !/^[a-z0-9-]+$/.test(slug)) die('--slug <kebab-case-slug> is required');
    if (!title) die('--title <song title> is required');
    if (!lyricsPath) die('--lyrics <path to a lyrics .txt> is required');
    if (!existsSync(lyricsPath)) die(`lyrics file not found: ${lyricsPath}`);
    const youtubeId = url ? parseYouTubeId(url) : null;
    if (url && !youtubeId) die(`could not parse a YouTube id from --url ${url}`);
    if (doAlign && !youtubeId) die('timing needs --url (or pass --no-align to skip it)');

    const lines = splitLyrics(readFileSync(lyricsPath, 'utf8'));
    if (!lines.length) die('the lyrics file has no non-empty lines');

    const songsDir = fileURLToPath(new URL('../data/songs', import.meta.url));
    const seedPath = `${songsDir}/${slug}.json`;
    const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

    console.log(`curate-song: ${slug} — ${lines.length} lines, video ${youtubeId ?? '(none)'}${dryRun ? ' [DRY RUN]' : ''}`);

    // 1+2. Analyze → write the seed file (unless it exists and we're not forcing).
    if (existsSync(seedPath) && !force) {
        console.log(`  · ${slug}.json exists — reusing it (pass --force to re-analyze + overwrite)`);
    } else if (dryRun) {
        console.log(`  · would analyze ${lines.length} lines and write data/songs/${slug}.json`);
    } else {
        if (!isAnalysisConfigured()) die('analyze needs ANTHROPIC_API_KEY in the env (.env) — or pre-write data/songs/' + slug + '.json and re-run with --no-* ... ');
        console.log('  · analyzing lyrics with Claude …');
        const analyzed = await analyzeLyrics({ lines, title, artist: artist ?? undefined });
        const seed = analyzedToSeedFile({ slug, title, artist, youtubeId }, analyzed);
        writeFileSync(seedPath, JSON.stringify(seed, null, 2) + '\n', 'utf8');
        const flagged = analyzed.lines.filter((l) => l.flags.length);
        console.log(`  → wrote data/songs/${slug}.json (${seed.lines.length} lines, ${analyzed.profile.grammarCount} grammar points)`);
        if (flagged.length) {
            console.log(`  ‼ ${flagged.length} line(s) flagged — PROOFREAD these in the seed file:`);
            for (const l of flagged) console.log(`      line ${l.index}: ${l.flags.join(', ')} — ${l.text}`);
        }
    }

    // 3. Timing (forced alignment). Shells the song-align venv python so the heavy ML deps stay there.
    if (doAlign && !dryRun) {
        console.log('  · aligning timing (song-align) …');
        const py = `${repoRoot}song-align/.venv/bin/python3`;
        const align = existsSync(py) ? py : 'python3';
        const alignArgs = [`${repoRoot}song-align/align.py`, '--song', slug];
        if (!vocals) alignArgs.push('--no-vocals');
        if (browser) alignArgs.push('--cookies-from-browser', browser);
        const r = spawnSync(align, alignArgs, { stdio: 'inherit' });
        if (r.status !== 0) console.error(`  ! alignment failed (exit ${r.status}) — the song still seeds UNTIMED; fix cookies/JS-runtime (song-align/README.md) and re-run`);
    } else if (doAlign) {
        console.log('  · would align timing (song-align/align.py --song ' + slug + ')');
    }

    // 4. Seed (lyrics + any timing sidecar) into the DB.
    if (doSeed && !dryRun) {
        console.log('  · seeding the store …');
        const r = spawnSync('bun', ['scripts/seed-songs.ts'], { stdio: 'inherit', cwd: fileURLToPath(new URL('..', import.meta.url)) });
        if (r.status !== 0) die('seed failed — see the output above');
    } else if (doSeed) {
        console.log('  · would seed (bun scripts/seed-songs.ts)');
    }

    console.log(dryRun
        ? '\nDry run complete — re-run without --dry-run to analyze, time, and seed.'
        : `\nDone. Spot-check ${slug} in the app, then commit data/songs/${slug}.json + data/song-timing/${slug}.json.`);
}

// Only run the CLI when invoked directly — importing this module (the unit test) must NOT run main().
if (import.meta.main) main();
